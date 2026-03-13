import { join, normalize, dirname } from 'node:path'
import { mkdir, rename, unlink, rm } from 'node:fs/promises'
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
import { normalizeFolderPath, filterPathSegments } from './path-utils'

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

/** operCode 처리 우선순위 — 폴더 구조 먼저, 삭제 마지막 */
const OPERCODE_PRIORITY: Record<string, number> = {
  FC: 0, FRN: 1, FMV: 1,       // 폴더 구조 먼저
  UP: 2, CP: 2,                 // 파일 동기화
  RN: 3, MV: 3,                 // 파일 변경
  D: 4, FD: 4,                  // 삭제 마지막
}

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

    // 핸들러 중복 방지: 기존 구독이 있으면 먼저 해제
    this.detectionUnsubscribe?.()

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
      // Step 1: 다운로드 폴더 사전 생성 (플로우 2단계)
      await this.createDownloadDirs()

      // Step 2: 루트 폴더만 스캔 (중첩 폴더 중복 방지)
      const allFolders = options?.folderIds
        ? this.deps.state.getFolders(true).filter((f) => options.folderIds!.includes(f.id))
        : this.getRootFolders()

      const targetFolders = allFolders

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
    folder: { id: string; lguplus_folder_id: string; lguplus_folder_name: string; lguplus_folder_path?: string | null },
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
      const basePath = folder.lguplus_folder_path ?? `/${folder.lguplus_folder_name}`
      const fileId = this.deps.state.saveFile({
        folder_id: folder.id,
        file_name: file.itemName,
        file_path: `${basePath}/${subPath}${file.itemName}`,
        file_size: file.itemSize,
        file_extension: file.itemExtension,
        lguplus_file_id: String(file.itemSrcNo ?? file.itemId),
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

      const fi = { fileName: file.file_name, filePath: file.file_path }

      if (!lguplusFileId) {
        const errMsg = `No LGU+ file ID available for file ${fileId} (${file.file_name})`
        this.logger.error(errMsg)
        this.deps.state.updateFileStatus(fileId, 'dl_failed', { last_error: errMsg })
        this.emitSyncFailed(errMsg, fileId, fi)
        return { success: false, fileId, error: errMsg }
      }

      // path.join + normalize로 OS 호환 경로 생성 (혼합 슬래시 방지)
      const segments = this.getPathSegments(file.file_path)
      const destPath = segments.length > 0
        ? normalize(join(this.getTempPath(), ...segments, file.file_name))
        : normalize(join(this.getTempPath(), file.file_name))

      this.logger.debug('Download path resolved', { fileId, destPath, segments, filePath: file.file_path })

      // 다운로드 대상 디렉토리 사전 생성 (startup mirroring이 실패했거나 새 폴더인 경우 대비)
      await mkdir(dirname(destPath), { recursive: true })

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
        const errMsg = `Download returned empty result for file ${file.lguplus_file_id}`
        this.deps.state.updateFileStatus(fileId, 'dl_failed', { last_error: errMsg })
        this.emitSyncFailed(errMsg, fileId, fi)
        return { success: false, fileId, error: errMsg }
      }

      this.deps.state.updateFileStatus(fileId, 'downloaded', {
        download_completed_at: new Date().toISOString(),
        download_path: destPath,
      })

      this.logger.info(`File downloaded: ${file.file_name}`, { fileId })
      return { success: true, fileId }
    } catch (error) {
      const errMsg = classifyDownloadError(error as Error, file.file_name, file.file_path)
      this.deps.state.updateFileStatus(fileId, 'dl_failed', {
        last_error: errMsg,
        retry_count: (file.retry_count ?? 0) + 1,
      })
      this.emitSyncFailed(error, fileId, { fileName: file.file_name, filePath: file.file_path })
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
        this.emitSyncFailed(errMsg, fileId, { fileName: file.file_name, filePath: file.file_path })
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
      const errMsg = classifyUploadError(error as Error, file.file_name)
      this.deps.state.updateFileStatus(fileId, 'ul_failed', {
        last_error: errMsg,
        retry_count: (file.retry_count ?? 0) + 1,
      })
      this.emitSyncFailed(error, fileId, { fileName: file.file_name, filePath: file.file_path })
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

    // Step 2: Mark as completed (upload skipped)
    const file = this.deps.state.getFile(fileId)
    if (file) {
      this.deps.state.updateFileStatus(fileId, 'completed', {
        upload_completed_at: new Date().toISOString(),
      })

      const today = new Date().toISOString().slice(0, 10)
      this.deps.state.incrementDailyStats(today, 1, 0, file.file_size)

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

  /** operCode에 따라 파일 동기화(UP/CP) 또는 이벤트별 처리를 수행
   *  갭 복구 배치에서 FC(폴더생성)가 UP보다 먼저 처리되도록 우선순위 정렬 수행
   */
  private async handleDetectedFiles(files: DetectedFile[], strategy: DetectionStrategy): Promise<void> {
    if (this._status !== 'syncing') return

    this.logger.info(`Detected ${files.length} events via ${strategy}`)

    // operCode 우선순위 정렬: 폴더 구조(FC) → 파일 동기화(UP/CP) → 삭제(D/FD)
    const sorted = [...files].sort((a, b) =>
      (OPERCODE_PRIORITY[a.operCode] ?? 5) - (OPERCODE_PRIORITY[b.operCode] ?? 5),
    )

    for (const detected of sorted) {
      const { operCode } = detected

      // Emit opercode event for UI timeline
      this.deps.eventBus.emit('opercode:event', {
        operCode,
        fileName: detected.fileName,
        filePath: detected.filePath,
        folderId: detected.folderId,
        historyNo: detected.historyNo,
        timestamp: new Date().toISOString(),
      })

      switch (operCode) {
        case 'UP':
        case 'CP':
          // File upload/copy → download + upload sync
          this.enqueueFileSync(detected)
          break

        case 'D':
          // File deletion → mark as source_deleted in DB
          this.handleFileDeletion(detected)
          break

        case 'RN':
          // File rename → await FS then update DB
          await this.handleFileRename(detected)
          break

        case 'MV':
          // File move → await FS then update DB
          await this.handleFileMove(detected)
          break

        case 'FC':
          // Folder creation → await DB registration + local dir creation
          await this.handleFolderCreate(detected)
          break

        case 'FD':
          // Folder deletion → mark affected files as source_deleted
          this.handleFolderDeletion(detected)
          break

        case 'FRN':
          // Folder rename → await FS then update DB
          await this.handleFolderRename(detected)
          break

        case 'FMV':
          // Folder move → await FS then update DB
          await this.handleFolderMove(detected)
          break

        default:
          this.logger.warn(`Unknown operCode: ${operCode}`, {
            fileName: detected.fileName,
            filePath: detected.filePath,
          })
      }
    }
  }

  /** File deletion: delete local file + mark as source_deleted */
  private handleFileDeletion(detected: DetectedFile): void {
    const lguplusFileId = detected.lguplusFileId ? String(detected.lguplusFileId) : null
    const existing = lguplusFileId
      ? this.deps.state.getFileByLguplusFileId(lguplusFileId)
      : null

    this.logger.info(`File deleted: ${detected.fileName}`, {
      operCode: 'D',
      folderId: detected.folderId,
      filePath: detected.filePath,
      existingFileId: existing?.id,
    })

    // Delete local file if it was downloaded
    if (existing?.download_path) {
      unlink(existing.download_path).catch((err) => {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(`Failed to delete local file: ${existing.download_path}`, err as Error)
        }
      })
    }

    if (existing) {
      this.deps.state.updateFileStatus(existing.id, 'source_deleted')
    }

    const changeId = this.deps.state.saveFolderChange({
      lguplus_folder_id: detected.folderId,
      oper_code: 'D',
      old_path: detected.filePath,
    })
    this.deps.state.updateFolderChange(changeId, { status: 'applied' })
  }

  /** File rename: await FS rename → conditionally update DB download_path */
  private async handleFileRename(detected: DetectedFile): Promise<void> {
    const lguplusFileId = detected.lguplusFileId ? String(detected.lguplusFileId) : null
    const existing = lguplusFileId
      ? this.deps.state.getFileByLguplusFileId(lguplusFileId)
      : null

    this.logger.info(`File renamed: ${detected.fileName}`, {
      operCode: 'RN',
      folderId: detected.folderId,
      filePath: detected.filePath,
      existingFileId: existing?.id,
    })

    if (!existing) {
      this.deps.state.saveFolderChange({
        lguplus_folder_id: detected.folderId,
        oper_code: 'RN',
        new_path: detected.filePath,
      })
      return
    }

    const oldName = existing.file_name
    const newName = detected.fileName
    if (oldName === newName) return // duplicate event

    const oldFilePath = existing.file_path
    // Build new file_path by replacing the filename part
    const pathParts = oldFilePath.split('/')
    pathParts[pathParts.length - 1] = newName
    const newFilePath = pathParts.join('/')

    // FS rename first — only update download_path if FS succeeds
    let newDownloadPath: string | null = null
    if (existing.download_path) {
      const target = normalize(join(dirname(existing.download_path), newName))
      try {
        await rename(existing.download_path, target)
        newDownloadPath = target
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(`Failed to rename local file: ${existing.download_path}`, err as Error)
        }
        // FS failed → download_path not updated (DB stays consistent)
      }
    }

    this.deps.state.updateFileInfo(existing.id, {
      file_name: newName,
      file_path: newFilePath,  // source path always updated (LGU+ truth)
      ...(newDownloadPath ? { download_path: newDownloadPath } : {}),
    })

    this.deps.state.saveFolderChange({
      lguplus_folder_id: detected.folderId,
      oper_code: 'RN',
      old_path: oldFilePath,
      new_path: newFilePath,
    })
  }

  /** File move: await FS move → conditionally update DB download_path */
  private async handleFileMove(detected: DetectedFile): Promise<void> {
    const lguplusFileId = detected.lguplusFileId ? String(detected.lguplusFileId) : null
    const existing = lguplusFileId
      ? this.deps.state.getFileByLguplusFileId(lguplusFileId)
      : null

    this.logger.info(`File moved: ${detected.fileName}`, {
      operCode: 'MV',
      folderId: detected.folderId,
      filePath: detected.filePath,
      existingFileId: existing?.id,
    })

    if (!existing) {
      this.deps.state.saveFolderChange({
        lguplus_folder_id: detected.folderId,
        oper_code: 'MV',
        new_path: detected.filePath,
      })
      return
    }

    const oldFilePath = existing.file_path
    const newFilePath = detected.filePath
    if (oldFilePath === newFilePath) return // duplicate event

    // FS move first — only update download_path if FS succeeds
    let newDownloadPath: string | null = null
    if (existing.download_path) {
      const newSegments = this.getPathSegments(newFilePath)
      const target = newSegments.length > 0
        ? normalize(join(this.getTempPath(), ...newSegments, detected.fileName))
        : normalize(join(this.getTempPath(), detected.fileName))

      try {
        await mkdir(dirname(target), { recursive: true })
        await rename(existing.download_path, target)
        newDownloadPath = target
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(`Failed to move local file: ${existing.download_path}`, err as Error)
        }
        // FS failed → download_path not updated (DB stays consistent)
      }
    }

    // Look up new folder by detected.folderId
    const newFolder = this.deps.state.getFolderByLguplusId(detected.folderId)

    this.deps.state.updateFileInfo(existing.id, {
      file_path: newFilePath,  // source path always updated (LGU+ truth)
      ...(newDownloadPath ? { download_path: newDownloadPath } : {}),
      ...(newFolder ? { folder_id: newFolder.id } : {}),
    })

    this.deps.state.saveFolderChange({
      lguplus_folder_id: detected.folderId,
      oper_code: 'MV',
      old_path: oldFilePath,
      new_path: newFilePath,
    })
  }

  /** Folder creation: register in DB + create local download dir
   *  NOTE: detected.folderId = itemFolderId = PARENT folder ID (container)
   *        detected.lguplusFileId = itemSrcNo = NEW folder's own ID (subject)
   */
  private async handleFolderCreate(detected: DetectedFile): Promise<void> {
    // FC에서 새 폴더의 실제 ID는 lguplusFileId (itemSrcNo)
    const newFolderLguplusId = detected.lguplusFileId ? String(detected.lguplusFileId) : null

    this.logger.info(`Folder created: ${detected.fileName}`, {
      operCode: 'FC',
      parentFolderId: detected.folderId,
      newFolderLguplusId,
      filePath: detected.filePath,
    })

    // 부모 폴더의 DB 경로를 기준으로 새 폴더 경로 산출 (API 경로 불일치 방지)
    const parentFolder = this.deps.state.getFolderByLguplusId(detected.folderId)
    const parentPath = parentFolder?.lguplus_folder_path ?? ''
    const newFolderPath = parentPath
      ? `${parentPath}/${detected.fileName}`
      : normalizeFolderPath(detected.filePath)

    // 새 폴더의 lguplusId로 중복 확인 (부모 ID가 아닌 새 폴더 자체 ID)
    const existing = newFolderLguplusId
      ? this.deps.state.getFolderByLguplusId(newFolderLguplusId)
      : null

    if (!existing) {
      // 새 폴더 DB 등록 — 새 폴더의 자체 ID를 lguplus_folder_id로 저장
      if (newFolderLguplusId) {
        this.deps.state.saveFolder({
          lguplus_folder_id: newFolderLguplusId,
          lguplus_folder_name: detected.fileName,
          lguplus_folder_path: newFolderPath,
          enabled: true,
          auto_detected: true,
        })
      }

      // 로컬 다운로드 디렉토리 생성
      const segments = filterPathSegments(newFolderPath.split('/').filter(Boolean))
      if (segments.length > 0) {
        try {
          await mkdir(join(this.getTempPath(), ...segments), { recursive: true })
        } catch (err) {
          this.logger.warn(`Failed to create local folder for FC: ${newFolderPath}`, err as Error)
        }
      }
    }

    this.deps.state.saveFolderChange({
      lguplus_folder_id: newFolderLguplusId ?? detected.folderId,
      oper_code: 'FC',
      new_path: newFolderPath,
    })
  }

  /** Folder deletion: delete local dir + mark files as source_deleted
   *  NOTE: detected.lguplusFileId = itemSrcNo = deleted folder's own ID
   */
  private handleFolderDeletion(detected: DetectedFile): void {
    // FD에서 삭제된 폴더의 실제 ID는 lguplusFileId (itemSrcNo)
    const deletedFolderLguplusId = detected.lguplusFileId ? String(detected.lguplusFileId) : null
    const folder = deletedFolderLguplusId
      ? this.deps.state.getFolderByLguplusId(deletedFolderLguplusId)
      : null

    this.logger.info(`Folder deleted: ${detected.fileName}`, {
      operCode: 'FD',
      parentFolderId: detected.folderId,
      deletedFolderLguplusId,
      filePath: detected.filePath,
      existingFolderId: folder?.id,
    })

    // Delete local directory
    const folderPath = folder?.lguplus_folder_path ?? normalizeFolderPath(detected.filePath)
    const segments = filterPathSegments(folderPath.split('/').filter(Boolean))
    if (segments.length > 0) {
      const localDir = join(this.getTempPath(), ...segments)
      rm(localDir, { recursive: true, force: true }).catch((err) => {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(`Failed to delete local folder: ${localDir}`, err as Error)
        }
      })
    }

    let affectedItems = 0
    if (folder) {
      affectedItems = this.deps.state.markFolderFilesDeleted(folder.id)
      this.deps.state.updateFolder(folder.id, { enabled: false })
    }

    const changeId = this.deps.state.saveFolderChange({
      lguplus_folder_id: deletedFolderLguplusId ?? detected.folderId,
      oper_code: 'FD',
      old_path: folderPath,
      affected_items: affectedItems,
    })
    this.deps.state.updateFolderChange(changeId, { status: 'applied' })
  }

  /** Folder rename: await FS rename → update DB paths (DB always updated for source truth)
   *  NOTE: detected.lguplusFileId = itemSrcNo = renamed folder's own ID
   */
  private async handleFolderRename(detected: DetectedFile): Promise<void> {
    // FRN에서 이름 변경된 폴더의 실제 ID는 lguplusFileId (itemSrcNo)
    const renamedFolderLguplusId = detected.lguplusFileId ? String(detected.lguplusFileId) : null
    const folder = renamedFolderLguplusId
      ? this.deps.state.getFolderByLguplusId(renamedFolderLguplusId)
      : null

    this.logger.info(`Folder renamed: ${detected.fileName}`, {
      operCode: 'FRN',
      parentFolderId: detected.folderId,
      renamedFolderLguplusId,
      filePath: detected.filePath,
      existingFolderId: folder?.id,
    })

    if (!folder) {
      this.deps.state.saveFolderChange({
        lguplus_folder_id: renamedFolderLguplusId ?? detected.folderId,
        oper_code: 'FRN',
        new_path: detected.filePath,
      })
      return
    }

    const oldPath = folder.lguplus_folder_path ?? ''
    // 부모 폴더의 DB 경로 기반으로 새 경로 산출 (API 경로 불일치 방지)
    const parentFolder = this.deps.state.getFolderByLguplusId(detected.folderId)
    const parentPath = parentFolder?.lguplus_folder_path ?? ''
    const newPath = parentPath
      ? `${parentPath}/${detected.fileName}`
      : normalizeFolderPath(detected.filePath)
    if (oldPath === newPath) return // duplicate event

    // Rename local directory — FS failure is non-fatal (logged only)
    const oldSegments = filterPathSegments(oldPath.split('/').filter(Boolean))
    const newSegments = filterPathSegments(newPath.split('/').filter(Boolean))
    if (oldSegments.length > 0 && newSegments.length > 0) {
      const oldLocalDir = join(this.getTempPath(), ...oldSegments)
      const newLocalDir = join(this.getTempPath(), ...newSegments)
      try {
        await rename(oldLocalDir, newLocalDir)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(`Failed to rename local folder: ${oldLocalDir}`, err as Error)
        }
      }
    }

    // Update folder record (source path always updated — LGU+ truth)
    this.deps.state.updateFolder(folder.id, {
      lguplus_folder_name: detected.fileName,
      lguplus_folder_path: newPath,
    })

    // Cascade: update child file paths
    const affected = this.deps.state.bulkUpdateFilePaths(folder.id, oldPath, newPath)

    this.deps.state.saveFolderChange({
      lguplus_folder_id: renamedFolderLguplusId ?? detected.folderId,
      oper_code: 'FRN',
      old_path: oldPath,
      new_path: newPath,
      affected_items: affected,
    })
  }

  /** Folder move: await FS move → update DB paths (DB always updated for source truth)
   *  NOTE: detected.lguplusFileId = itemSrcNo = moved folder's own ID
   *        detected.folderId = itemFolderId = destination parent folder ID
   */
  private async handleFolderMove(detected: DetectedFile): Promise<void> {
    // FMV에서 이동된 폴더의 실제 ID는 lguplusFileId (itemSrcNo)
    const movedFolderLguplusId = detected.lguplusFileId ? String(detected.lguplusFileId) : null
    const folder = movedFolderLguplusId
      ? this.deps.state.getFolderByLguplusId(movedFolderLguplusId)
      : null

    this.logger.info(`Folder moved: ${detected.fileName}`, {
      operCode: 'FMV',
      destParentFolderId: detected.folderId,
      movedFolderLguplusId,
      filePath: detected.filePath,
      existingFolderId: folder?.id,
    })

    if (!folder) {
      this.deps.state.saveFolderChange({
        lguplus_folder_id: movedFolderLguplusId ?? detected.folderId,
        oper_code: 'FMV',
        new_path: detected.filePath,
      })
      return
    }

    const oldPath = folder.lguplus_folder_path ?? ''
    // 이동 대상(새 부모) 폴더의 DB 경로 기반으로 새 경로 산출
    const destParentFolder = this.deps.state.getFolderByLguplusId(detected.folderId)
    const destParentPath = destParentFolder?.lguplus_folder_path ?? ''
    const newPath = destParentPath
      ? `${destParentPath}/${detected.fileName}`
      : normalizeFolderPath(detected.filePath)
    if (oldPath === newPath) return // duplicate event

    // Move local directory — FS failure is non-fatal (logged only)
    const oldSegments = filterPathSegments(oldPath.split('/').filter(Boolean))
    const newSegments = filterPathSegments(newPath.split('/').filter(Boolean))
    if (oldSegments.length > 0 && newSegments.length > 0) {
      const oldLocalDir = join(this.getTempPath(), ...oldSegments)
      const newLocalDir = join(this.getTempPath(), ...newSegments)
      try {
        await mkdir(dirname(newLocalDir), { recursive: true })
        await rename(oldLocalDir, newLocalDir)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(`Failed to move local folder: ${oldLocalDir}`, err as Error)
        }
      }
    }

    // Update folder record (source path always updated — LGU+ truth)
    this.deps.state.updateFolder(folder.id, {
      lguplus_folder_path: newPath,
    })

    // Cascade: update child file paths
    const affected = this.deps.state.bulkUpdateFilePaths(folder.id, oldPath, newPath)

    this.deps.state.saveFolderChange({
      lguplus_folder_id: movedFolderLguplusId ?? detected.folderId,
      oper_code: 'FMV',
      old_path: oldPath,
      new_path: newPath,
      affected_items: affected,
    })
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
      this.drainQueue()
      return
    }

    // Save file to state with internal folder UUID
    const fileId = this.deps.state.saveFile({
      folder_id: folder.id,
      history_no: detected.historyNo,
      lguplus_file_id: detected.lguplusFileId ? String(detected.lguplusFileId) : null,
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
  private emitSyncFailed(
    errorOrMsg: unknown,
    fileId: string,
    fileInfo?: { fileName?: string; filePath?: string },
  ): void {
    const ctx: Record<string, unknown> = { fileId }
    if (fileInfo?.fileName) ctx.fileName = fileInfo.fileName
    if (fileInfo?.filePath) ctx.filePath = fileInfo.filePath

    let syncError: SyncAppError
    if (errorOrMsg instanceof SyncAppError) {
      syncError = errorOrMsg
      // Merge file info into existing context if missing
      if (fileInfo?.fileName && !syncError.context.fileName) {
        ;(syncError.context as Record<string, unknown>).fileName = fileInfo.fileName
      }
      if (fileInfo?.filePath && !syncError.context.filePath) {
        ;(syncError.context as Record<string, unknown>).filePath = fileInfo.filePath
      }
    } else if (errorOrMsg instanceof Error) {
      syncError = new FileDownloadTransferError(errorOrMsg.message, ctx)
    } else {
      syncError = new FileUploadError(String(errorOrMsg), ctx)
    }
    this.deps.eventBus.emit('sync:failed', { error: syncError, fileId })
  }

  /** 다른 폴더의 하위가 아닌 최상위(루트) 폴더만 반환 — 중복 스캔 방지 */
  private getRootFolders() {
    const all = this.deps.state.getFolders(true)
    return all.filter((f) => {
      const path = f.lguplus_folder_path
      if (!path) return true // path 없으면 루트로 취급
      return !all.some(
        (other) =>
          other.id !== f.id &&
          other.lguplus_folder_path &&
          path.startsWith(other.lguplus_folder_path + '/'),
      )
    })
  }

  /** fullSync 시작 시 모든 등록 폴더에 대한 로컬 다운로드 디렉토리 사전 생성
   *  filterPathSegments로 GUEST 등 제외 세그먼트를 정리하여 downloadOnly()와 경로를 일치시킴
   */
  private async createDownloadDirs(): Promise<void> {
    const tempPath = this.getTempPath()
    const folders = this.deps.state.getFolders()
    for (const folder of folders) {
      if (!folder.lguplus_folder_path) continue
      const rawSegments = folder.lguplus_folder_path.split('/').filter(Boolean)
      const segments = filterPathSegments(rawSegments)
      if (segments.length === 0) continue
      await mkdir(join(tempPath, ...segments), { recursive: true })
    }
  }

  private getPathSegments(filePath: string): string[] {
    // breadcrumb( > ) 및 forward + backward slash 모두 분리 (Windows 혼합 경로 대응)
    const parts = filePath.replace(/ > /g, '/').split(/[/\\]/).filter(Boolean)
    return filterPathSegments(parts.slice(0, -1)) // exclude filename
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

/** 다운로드 에러를 사용자가 알아보기 쉬운 한글 메시지로 분류 */
function classifyDownloadError(error: Error, fileName: string, filePath: string): string {
  const msg = error.message
  const code = (error as NodeJS.ErrnoException).code

  // 파일시스템 에러
  if (code === 'ENOENT' || msg.includes('ENOENT')) {
    return `[경로 오류] 다운로드 경로를 찾을 수 없습니다 — 파일: ${fileName}, 경로: ${filePath}`
  }
  if (code === 'EACCES' || code === 'EPERM' || msg.includes('EACCES') || msg.includes('EPERM')) {
    return `[권한 오류] 다운로드 폴더에 쓰기 권한이 없습니다 — ${fileName}`
  }
  if (code === 'ENOSPC' || msg.includes('ENOSPC')) {
    return `[디스크 공간 부족] 다운로드할 공간이 부족합니다 — ${fileName}`
  }
  if (code === 'ENAMETOOLONG' || msg.includes('ENAMETOOLONG')) {
    return `[경로 길이 초과] 파일 경로가 너무 깁니다 — ${fileName}`
  }

  // SyncAppError 계층
  if (error instanceof SyncAppError) {
    const c = error.code
    if (c === 'AUTH_SESSION_EXPIRED') {
      return `[세션 만료] LGU+ 로그인 세션이 만료되었습니다 — ${fileName}`
    }
    if (c === 'DL_FILE_NOT_FOUND') {
      return `[파일 없음] 서버에서 파일을 찾을 수 없습니다 — ${fileName} (삭제되었거나 이동됨)`
    }
    if (c === 'DL_URL_FETCH_FAILED') {
      return `[URL 오류] 다운로드 URL을 가져올 수 없습니다 — ${fileName}`
    }
    if (c === 'DL_SIZE_MISMATCH') {
      return `[크기 불일치] 다운로드된 파일 크기가 다릅니다 — ${fileName} (네트워크 불안정)`
    }
    if (c === 'DL_TRANSFER_FAILED') {
      return `[전송 실패] 다운로드 중 전송 오류 발생 — ${fileName}`
    }
    if (c === 'DL_CIRCUIT_OPEN') {
      return `[회로 차단] 반복 실패로 다운로드가 일시 중단되었습니다 — ${fileName}`
    }
    return `[${c}] ${error.message} — ${fileName}`
  }

  // 네트워크 에러
  if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET')) {
    return `[네트워크 오류] 서버 연결에 실패했습니다 — ${fileName}`
  }
  if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
    return `[시간 초과] 다운로드 시간이 초과되었습니다 — ${fileName}`
  }

  // Circuit breaker
  if (msg.includes('circuit') || msg.includes('Circuit')) {
    return `[회로 차단] 반복 실패로 다운로드가 일시 중단되었습니다 — ${fileName}`
  }

  // 기본
  return `[다운로드 실패] ${msg} — ${fileName}`
}

/** 업로드 에러를 사용자가 알아보기 쉬운 한글 메시지로 분류 */
function classifyUploadError(error: Error, fileName: string): string {
  const msg = error.message
  const code = (error as NodeJS.ErrnoException).code

  if (code === 'ENOENT' || msg.includes('ENOENT')) {
    return `[파일 없음] 다운로드된 파일을 찾을 수 없어 업로드 불가 — ${fileName}`
  }
  if (msg.includes('folder path not configured') || msg.includes('Self-webhard')) {
    return `[폴더 미설정] 자체웹하드 업로드 폴더가 설정되지 않았습니다 — ${fileName}`
  }
  if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET')) {
    return `[네트워크 오류] 자체웹하드 서버 연결에 실패했습니다 — ${fileName}`
  }
  if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
    return `[시간 초과] 업로드 시간이 초과되었습니다 — ${fileName}`
  }
  if (msg.includes('circuit') || msg.includes('Circuit')) {
    return `[회로 차단] 반복 실패로 업로드가 일시 중단되었습니다 — ${fileName}`
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized') || msg.includes('Forbidden')) {
    return `[인증 오류] 자체웹하드 API 인증에 실패했습니다 — ${fileName}`
  }

  return `[업로드 실패] ${msg} — ${fileName}`
}
