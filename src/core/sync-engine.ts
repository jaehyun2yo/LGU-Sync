import type {
  ISyncEngine,
  FullSyncOptions,
  FullSyncResult,
  SyncResult,
} from './types/sync-engine.types'
import type { IFileDetector } from './types/file-detector.types'
import type { ILGUplusClient } from './types/lguplus-client.types'
import type { IWebhardUploader } from './types/webhard-uploader.types'
import type { IStateManager } from './types/state-manager.types'
import type { IRetryManager } from './types/retry-manager.types'
import type { IConfigManager } from './types/config.types'
import type { INotificationService } from './types/notification.types'
import type { IEventBus, EngineStatus, DetectedFile, DetectionStrategy } from './types/events.types'
import type { ILogger } from './types/logger.types'
import { v4 as uuid } from 'uuid'

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

export class SyncEngine implements ISyncEngine {
  private _status: EngineStatus = 'idle'
  private deps: SyncEngineDeps
  private logger: ILogger
  private detectionUnsubscribe?: () => void

  constructor(deps: SyncEngineDeps) {
    this.deps = deps
    this.logger = deps.logger.child({ module: 'sync-engine' })
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

      for (const folder of targetFolders) {
        try {
          // Get all files from LGU+ folder (deep scan)
          const files = await this.deps.lguplus.getAllFilesDeep(
            Number(folder.lguplus_folder_id),
          )
          scannedFiles += files.length

          for (const file of files) {
            // Check if already synced
            const existing = this.deps.state.getFileByHistoryNo(file.itemId)
            if (existing && existing.status === 'completed' && !options?.forceRescan) {
              continue
            }

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

            // Sync the file
            const result = await this.syncFile(fileId)
            if (result.success) {
              syncedFiles++
            } else {
              failedFiles++
            }
          }
        } catch (error) {
          this.logger.error(`Full sync failed for folder ${folder.id}`, error as Error)
          failedFiles++
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

      const downloadResult = await this.deps.retry.execute(
        () =>
          this.deps.lguplus.downloadFile(
            lguplusFileId,
            `${this.getTempPath()}/${file.file_name}`,
          ),
        { maxRetries: 3, baseDelayMs: 1000, circuitName: 'lguplus-download' },
      )

      if (!downloadResult.success) {
        this.deps.state.updateFileStatus(fileId, 'dl_failed', {
          last_error: 'Download failed',
        })
        this.deps.eventBus.emit('sync:failed', { error: { message: 'Download failed' } as any, fileId })
        return { success: false, fileId, error: 'Download failed' }
      }

      this.deps.state.updateFileStatus(fileId, 'downloaded', {
        download_completed_at: new Date().toISOString(),
        download_path: `${this.getTempPath()}/${file.file_name}`,
      })

      this.logger.info(`File downloaded: ${file.file_name}`, { fileId })
      return { success: true, fileId }
    } catch (error) {
      const errMsg = (error as Error).message
      this.deps.state.updateFileStatus(fileId, 'dl_failed', {
        last_error: errMsg,
        retry_count: (file.retry_count ?? 0) + 1,
      })
      this.deps.eventBus.emit('sync:failed', { error: error as any, fileId })
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

      let uploadFolderId = this.deps.state.getFolder(file.folder_id)?.self_webhard_path
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
        this.deps.state.updateFileStatus(fileId, 'ul_failed', {
          last_error: uploadResult.error ?? 'Upload failed',
        })
        this.deps.eventBus.emit('sync:failed', { error: { message: uploadResult.error ?? 'Upload failed' } as any, fileId })
        return { success: false, fileId, error: 'Upload failed' }
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
      this.deps.eventBus.emit('sync:failed', { error: error as any, fileId })
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

  private handleDetectedFiles(files: DetectedFile[], strategy: DetectionStrategy): void {
    if (this._status !== 'syncing') return

    this.logger.info(`Detected ${files.length} files via ${strategy}`)

    for (const detected of files) {
      // Map LGU+ folder ID to internal UUID
      const folder = this.deps.state.getFolderByLguplusId(detected.folderId)
      if (!folder) {
        this.logger.warn(
          `Skipping file ${detected.fileName}: no registered folder for LGU+ folder ID ${detected.folderId}`,
        )
        continue
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

      // Queue for sync
      this.syncFile(fileId).catch((error) => {
        this.logger.error(`Failed to sync detected file ${fileId}`, error as Error)
      })
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
