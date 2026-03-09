import type {
  ISyncEngine,
  FullSyncOptions,
  FullSyncResult,
  SyncResult,
} from './types/sync-engine.types'
import type { BatchRetryResult } from './types/retry-manager.types'
import type { IFileDetector } from './types/file-detector.types'
import type { ILGUplusClient } from './types/lguplus-client.types'
import type { IWebhardUploader } from './types/webhard-uploader.types'
import type { IStateManager } from './types/state-manager.types'
import type { IRetryManager } from './types/retry-manager.types'
import type { IConfigManager } from './types/config.types'
import type { INotificationService } from './types/notification.types'
import type { IEventBus, EngineStatus, DetectedFile, DetectionStrategy } from './types/events.types'
import type { ILogger } from './types/logger.types'
import {
  SyncAppError,
  FileDownloadTransferError,
  FileUploadError,
} from './errors'

export interface SyncEngineDeps {
  detector: IFileDetector
  lguplus: ILGUplusClient
  uploader: IWebhardUploader
  state: IStateManager
  retry: IRetryManager
  eventBus: IEventBus
  logger: ILogger
  config: IConfigManager
  notification: INotificationService
}

const DEFAULT_MAX_CONCURRENT = 5

export class SyncEngine implements ISyncEngine {
  private _status: EngineStatus = 'idle'
  private deps: SyncEngineDeps
  private logger: ILogger
  private detectionUnsubscribe?: () => void

  /** 진행 중인 동기화 Promise 추적 */
  private activeSyncs = new Set<Promise<SyncResult>>()
  /** 동시성 제한 초과 시 대기 큐 */
  private syncQueue: DetectedFile[] = []
  private maxConcurrent: number

  constructor(deps: SyncEngineDeps) {
    this.deps = deps
    this.logger = deps.logger.child({ module: 'sync-engine' })
    this.maxConcurrent = this.getMaxConcurrent()
  }

  get status(): EngineStatus {
    return this._status
  }

  async start(): Promise<void> {
    if (this._status === 'syncing') return

    const prev = this._status
    this._status = 'syncing'
    this.deps.eventBus.emit('engine:status', { prev, next: 'syncing' })

    // Subscribe to file detection events
    this.detectionUnsubscribe = this.deps.detector.onFilesDetected(
      (files, strategy) => this.handleDetectedFiles(files, strategy),
    )

    // Start the detector
    this.deps.detector.start()

    this.logger.info('SyncEngine started')
  }

  async stop(): Promise<void> {
    const prev = this._status
    this._status = 'stopping'

    // Unsubscribe from detector events
    if (this.detectionUnsubscribe) {
      this.detectionUnsubscribe()
      this.detectionUnsubscribe = undefined
    }

    // Stop the detector
    this.deps.detector.stop()

    // Clear pending queue
    this.syncQueue.length = 0

    // Graceful shutdown: 진행 중인 작업 완료 대기
    if (this.activeSyncs.size > 0) {
      this.logger.info(`Waiting for ${this.activeSyncs.size} active sync(s) to complete`)
      await Promise.allSettled([...this.activeSyncs])
    }

    this._status = 'stopped'
    this.deps.eventBus.emit('engine:status', { prev, next: 'stopped' })

    this.logger.info('SyncEngine stopped')
  }

  async pause(): Promise<void> {
    if (this._status !== 'syncing') return

    const prev = this._status
    this._status = 'paused'
    this.deps.eventBus.emit('engine:status', { prev, next: 'paused' })

    this.deps.detector.stop()
    this.logger.info('SyncEngine paused')
  }

  async resume(): Promise<void> {
    if (this._status !== 'paused') return

    const prev = this._status
    this._status = 'syncing'
    this.deps.eventBus.emit('engine:status', { prev, next: 'syncing' })

    this.deps.detector.start()

    // Resume queued items
    this.drainQueue()

    this.logger.info('SyncEngine resumed')
  }

  async fullSync(options?: FullSyncOptions): Promise<FullSyncResult> {
    const start = Date.now()
    let scannedFiles = 0
    let newFiles = 0
    let syncedFiles = 0
    let failedFiles = 0

    try {
      const folders = this.deps.state.getFolders(true)
      const targetFolders = options?.folderIds
        ? folders.filter((f) => options.folderIds!.includes(f.id))
        : folders

      // 폴더 스캔을 병렬로 (concurrency=3)
      const SCAN_CONCURRENCY = 3
      for (let i = 0; i < targetFolders.length; i += SCAN_CONCURRENCY) {
        const batch = targetFolders.slice(i, i + SCAN_CONCURRENCY)
        const results = await Promise.allSettled(
          batch.map((folder) => this.scanFolder(folder, options)),
        )

        for (const result of results) {
          if (result.status === 'fulfilled') {
            scannedFiles += result.value.scannedFiles
            newFiles += result.value.newFiles
            syncedFiles += result.value.syncedFiles
            failedFiles += result.value.failedFiles
          } else {
            failedFiles++
          }
        }
      }
    } catch (error) {
      this.logger.error('Full sync failed', error as Error)
    }

    return {
      scannedFiles,
      newFiles,
      syncedFiles,
      failedFiles,
      durationMs: Date.now() - start,
    }
  }

  private async scanFolder(
    folder: { id: string; lguplus_folder_id: string; lguplus_folder_name: string },
    options?: FullSyncOptions,
  ): Promise<{ scannedFiles: number; newFiles: number; syncedFiles: number; failedFiles: number }> {
    let scannedFiles = 0
    let newFiles = 0
    let syncedFiles = 0
    let failedFiles = 0

    // Deep scan to include sub-folders with relativePath
    const files = await this.deps.lguplus.getAllFilesDeep(
      Number(folder.lguplus_folder_id),
    )
    scannedFiles = files.length

    // 새 파일 ID를 먼저 수집
    const newFileIds: string[] = []
    for (const file of files) {
      const existing = this.deps.state.getFileByHistoryNo(file.itemId)
      if (existing && existing.status === 'completed' && !options?.forceRescan) {
        continue
      }

      // In-progress file -> skip
      if (existing) continue

      newFiles++

      // Save file record (preserve relativePath in file_path)
      const subPath = file.relativePath ? `${file.relativePath}/` : ''
      const fileId = this.deps.state.saveFile({
        folder_id: folder.id,
        file_name: file.itemName,
        file_path: `/${folder.lguplus_folder_name}/${subPath}${file.itemName}`,
        file_size: file.itemSize,
        file_extension: file.itemExtension,
        lguplus_file_id: String(file.itemId),
        detected_at: new Date().toISOString(),
      })

      newFileIds.push(fileId)
    }

    // Worker pool로 병렬 동기화
    let nextIdx = 0
    const processWorker = async (): Promise<void> => {
      while (true) {
        const idx = nextIdx++
        if (idx >= newFileIds.length) break
        const result = await this.syncFile(newFileIds[idx])
        if (result.success) syncedFiles++
        else failedFiles++
      }
    }

    const workerCount = Math.min(this.maxConcurrent, newFileIds.length)
    if (workerCount > 0) {
      await Promise.all(Array.from({ length: workerCount }, () => processWorker()))
    }

    return { scannedFiles, newFiles, syncedFiles, failedFiles }
  }

  async downloadOnly(fileId: string): Promise<SyncResult> {
    const file = this.deps.state.getFile(fileId)
    if (!file) {
      return { success: false, fileId, error: 'File not found' }
    }

    try {
      this.deps.state.updateFileStatus(fileId, 'downloading', {
        download_started_at: new Date().toISOString(),
      })

      this.deps.eventBus.emit('sync:progress', {
        fileId,
        fileName: file.file_name,
        progress: 0,
        speedBps: 0,
        phase: 'downloading',
        fileSize: file.file_size,
      })

      const lguplusFileId = file.lguplus_file_id
        ? Number(file.lguplus_file_id)
        : file.history_no ?? 0

      const segments = this.getPathSegments(file.file_path)
      const subPath = segments.join('/')
      const destPath = subPath
        ? `${this.getTempPath()}/${subPath}/${file.file_name}`
        : `${this.getTempPath()}/${file.file_name}`

      const downloadResult = await this.deps.retry.execute(
        () =>
          this.deps.lguplus.downloadFile(lguplusFileId, destPath, (downloadedBytes, totalBytes) => {
            this.deps.eventBus.emit('sync:progress', {
              fileId,
              fileName: file.file_name,
              progress: totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0,
              speedBps: 0,
              phase: 'downloading',
              fileSize: totalBytes,
            })
          }),
        { maxRetries: 3, baseDelayMs: 1000, circuitName: 'lguplus-download' },
      )

      if (!downloadResult.success) {
        this.deps.state.updateFileStatus(fileId, 'dl_failed', {
          last_error: 'Download failed',
        })
        this.emitSyncFailed('Download failed', fileId)
        return { success: false, fileId, error: 'Download failed' }
      }

      this.deps.state.updateFileStatus(fileId, 'downloaded', {
        download_completed_at: new Date().toISOString(),
        download_path: destPath,
      })

      this.logger.info(`File downloaded: ${file.file_name}`, { fileId })
      return { success: true, fileId }
    } catch (error) {
      const errMsg = (error as Error).message
      this.deps.state.updateFileStatus(fileId, 'dl_failed', {
        last_error: errMsg,
        retry_count: (file.retry_count ?? 0) + 1,
      })
      this.emitSyncFailed(error, fileId)
      this.logger.error(`Download failed for file ${fileId}`, error as Error)
      return { success: false, fileId, error: errMsg }
    }
  }

  async uploadOnly(fileId: string): Promise<SyncResult> {
    const file = this.deps.state.getFile(fileId)
    if (!file) {
      return { success: false, fileId, error: 'File not found' }
    }

    const downloadPath = file.download_path
    if (!downloadPath) {
      return { success: false, fileId, error: 'File not downloaded yet (no download_path)' }
    }

    try {
      this.deps.state.updateFileStatus(fileId, 'uploading', {
        upload_started_at: new Date().toISOString(),
      })

      this.deps.eventBus.emit('sync:progress', {
        fileId,
        fileName: file.file_name,
        progress: 50,
        speedBps: 0,
        phase: 'uploading',
        fileSize: file.file_size,
      })

      // Build upload folder path from file_path segments (preserves sub-folder structure)
      const pathSegments = this.getPathSegments(file.file_path)
      let uploadFolderId: string | undefined | null

      if (pathSegments.length > 0) {
        const ensureResult = await this.deps.uploader.ensureFolderPath(pathSegments)
        if (ensureResult.success && ensureResult.data) {
          uploadFolderId = ensureResult.data
        }
      } else {
        // Fallback: use cached folder path or create from folder name
        uploadFolderId = this.deps.state.getFolder(file.folder_id)?.self_webhard_path
        if (!uploadFolderId) {
          const folder = this.deps.state.getFolder(file.folder_id)
          if (folder) {
            const ensureResult = await this.deps.uploader.ensureFolderPath([
              folder.lguplus_folder_name,
            ])
            if (ensureResult.success && ensureResult.data) {
              uploadFolderId = ensureResult.data
              this.deps.state.updateFolder(folder.id, { self_webhard_path: uploadFolderId })
            }
          }
        }
      }

      if (!uploadFolderId) {
        this.deps.state.updateFileStatus(fileId, 'ul_failed', {
          last_error: 'Self-webhard folder path not configured',
        })
        return { success: false, fileId, error: 'Self-webhard folder path not configured' }
      }

      const uploadResult = await this.deps.retry.execute(
        () =>
          this.deps.uploader.uploadFile({
            folderId: uploadFolderId!,
            filePath: downloadPath,
            originalName: file.file_name,
          }),
        { maxRetries: 3, baseDelayMs: 1000, circuitName: 'webhard-upload' },
      )

      if (!uploadResult.success) {
        const errMsg = uploadResult.error ?? 'Upload failed'
        this.deps.state.updateFileStatus(fileId, 'ul_failed', {
          last_error: errMsg,
        })
        this.emitSyncFailed(errMsg, fileId)
        return { success: false, fileId, error: errMsg }
      }

      this.deps.state.updateFileStatus(fileId, 'completed', {
        self_webhard_file_id: uploadResult.data?.id,
        upload_completed_at: new Date().toISOString(),
      })

      const today = new Date().toISOString().slice(0, 10)
      this.deps.state.incrementDailyStats(today, 1, 0, file.file_size)

      this.logger.info(`File uploaded: ${file.file_name}`, { fileId })
      return { success: true, fileId }
    } catch (error) {
      const errMsg = (error as Error).message
      this.deps.state.updateFileStatus(fileId, 'ul_failed', {
        last_error: errMsg,
        retry_count: (file.retry_count ?? 0) + 1,
      })
      this.emitSyncFailed(error, fileId)
      this.logger.error(`Upload failed for file ${fileId}`, error as Error)
      return { success: false, fileId, error: errMsg }
    }
  }

  async syncFile(fileId: string): Promise<SyncResult> {
    const syncStartTime = Date.now()

    // Step 1: Download
    const dlResult = await this.downloadOnly(fileId)
    if (!dlResult.success) {
      return dlResult
    }

    // Step 2: Upload
    const ulResult = await this.uploadOnly(fileId)
    if (!ulResult.success) {
      return ulResult
    }

    // Step 3: Emit completion event
    const file = this.deps.state.getFile(fileId)
    if (file) {
      this.deps.eventBus.emit('file:completed', {
        fileId,
        fileName: file.file_name,
        fileSize: file.file_size,
        folderPath: file.file_path,
        durationMs: Date.now() - syncStartTime,
      })
    }

    return { success: true, fileId }
  }

  async retryAllDlq(): Promise<BatchRetryResult> {
    const items = this.deps.state.getDlqItems()
    const retryable = items.filter((i) => i.can_retry)

    let succeeded = 0
    let failed = 0

    for (const item of retryable) {
      try {
        const fileId = item.file_id ?? item.file_name
        await this.syncFile(fileId)
        this.deps.state.removeDlqItem(item.id)
        succeeded++
      } catch (error) {
        this.logger.error(`DLQ retry failed for item ${item.id}`, error as Error)
        failed++
      }
    }

    return { total: retryable.length, succeeded, failed }
  }

  /** operCode에 따라 파일 동기화(UP/CP) 또는 이벤트 로깅을 수행 */
  private handleDetectedFiles(files: DetectedFile[], strategy: DetectionStrategy): void {
    if (this._status !== 'syncing') return

    this.logger.info(`Detected ${files.length} events via ${strategy}`)

    for (const detected of files) {
      const { operCode } = detected

      // 파일 업로드/복사 -> 다운로드+업로드 동기화
      if (operCode === 'UP' || operCode === 'CP') {
        this.enqueueFileSync(detected)
        continue
      }

      // 폴더/파일 변경 이벤트 -> 로깅만 (삭제, 이동, 이름변경 등)
      this.logger.info(`Event [${operCode}] ${detected.fileName}`, {
        operCode,
        filePath: detected.filePath,
        folderId: detected.folderId,
        historyNo: detected.historyNo,
      })
    }
  }

  /** 동시성 제어: 파일 동기화를 큐에 넣고 슬롯이 비면 실행 */
  private enqueueFileSync(detected: DetectedFile): void {
    if (this.activeSyncs.size >= this.maxConcurrent) {
      this.syncQueue.push(detected)
      return
    }

    this.startFileSync(detected)
  }

  /** 개별 파일 동기화 시작 및 추적 */
  private startFileSync(detected: DetectedFile): void {
    // Map LGU+ folder ID to internal UUID
    const folder = this.deps.state.getFolderByLguplusId(detected.folderId)
    if (!folder) {
      this.logger.warn(
        `Skipping file ${detected.fileName}: no registered folder for LGU+ folder ID ${detected.folderId}`,
      )
      return
    }

    // Save file to state with internal folder UUID
    const fileId = this.deps.state.saveFile({
      folder_id: folder.id,
      history_no: detected.historyNo,
      file_name: detected.fileName,
      file_path: detected.filePath,
      file_size: detected.fileSize,
      detected_at: new Date().toISOString(),
    })

    // 추적 가능한 Promise로 동기화 실행
    const syncPromise = this.syncFile(fileId)
      .catch((error) => {
        this.logger.error(`Failed to sync detected file ${fileId}`, error as Error)
        return { success: false, fileId, error: (error as Error).message } as SyncResult
      })
      .finally(() => {
        this.activeSyncs.delete(syncPromise)
        this.drainQueue()
      })

    this.activeSyncs.add(syncPromise)
  }

  /** 큐에서 다음 항목을 꺼내 실행 */
  private drainQueue(): void {
    while (this.syncQueue.length > 0 && this.activeSyncs.size < this.maxConcurrent) {
      if (this._status !== 'syncing') break
      const next = this.syncQueue.shift()!
      this.startFileSync(next)
    }
  }

  /** Error 또는 문자열을 SyncAppError로 래핑하여 sync:failed 이벤트 발행 */
  private emitSyncFailed(errorOrMsg: unknown, fileId: string): void {
    let syncError: SyncAppError
    if (errorOrMsg instanceof SyncAppError) {
      syncError = errorOrMsg
    } else if (errorOrMsg instanceof Error) {
      syncError = new FileDownloadTransferError(errorOrMsg.message, { fileId })
    } else {
      syncError = new FileUploadError(String(errorOrMsg), { fileId })
    }
    this.deps.eventBus.emit('sync:failed', { error: syncError, fileId })
  }

  private getPathSegments(filePath: string): string[] {
    const parts = filePath.split('/').filter(Boolean)
    return parts.slice(0, -1) // exclude filename
  }

  private getMaxConcurrent(): number {
    try {
      const syncConfig = this.deps.config.get('sync')
      return syncConfig.maxConcurrentDownloads ?? DEFAULT_MAX_CONCURRENT
    } catch {
      return DEFAULT_MAX_CONCURRENT
    }
  }

  private getTempPath(): string {
    try {
      const system = this.deps.config.get('system')
      return system.tempDownloadPath
    } catch {
      return './downloads'
    }
  }
}
