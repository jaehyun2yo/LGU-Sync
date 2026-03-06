import type { IFileDetector } from './types/file-detector.types'
import type { ILGUplusClient, UploadHistoryItem } from './types/lguplus-client.types'
import type { IStateManager } from './types/state-manager.types'
import type { IEventBus, DetectedFile, DetectionStrategy } from './types/events.types'
import type { ILogger } from './types/logger.types'

type DetectionHandler = (files: DetectedFile[], strategy: DetectionStrategy) => void

export interface FileDetectorOptions {
  pollingIntervalMs?: number
}

export class FileDetector implements IFileDetector {
  private client: ILGUplusClient
  private state: IStateManager
  private eventBus: IEventBus
  private logger: ILogger
  private pollingIntervalMs: number
  private pollingTimer: ReturnType<typeof setInterval> | null = null
  private handlers: DetectionHandler[] = []

  constructor(
    client: ILGUplusClient,
    state: IStateManager,
    eventBus: IEventBus,
    logger: ILogger,
    options?: FileDetectorOptions,
  ) {
    this.client = client
    this.state = state
    this.eventBus = eventBus
    this.logger = logger.child({ module: 'file-detector' })
    this.pollingIntervalMs = options?.pollingIntervalMs ?? 5000
  }

  start(): void {
    if (this.pollingTimer) return

    this.logger.info('Starting file detector', { intervalMs: this.pollingIntervalMs })

    // Initial poll
    this.pollForFiles()

    this.pollingTimer = setInterval(() => {
      this.pollForFiles()
    }, this.pollingIntervalMs)
  }

  stop(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
      this.pollingTimer = null
      this.logger.info('File detector stopped')
    }
  }

  setPollingInterval(intervalMs: number): void {
    this.pollingIntervalMs = intervalMs
    if (this.pollingTimer) {
      this.stop()
      this.start()
    }
  }

  async forceCheck(): Promise<DetectedFile[]> {
    return this.pollForFiles()
  }

  onFilesDetected(handler: DetectionHandler): () => void {
    this.handlers.push(handler)
    return () => {
      const idx = this.handlers.indexOf(handler)
      if (idx !== -1) {
        this.handlers.splice(idx, 1)
      }
    }
  }

  private async pollForFiles(): Promise<DetectedFile[]> {
    try {
      const lastHistoryNo = this.state.getCheckpoint('last_history_no')
      const lastNo = lastHistoryNo ? parseInt(lastHistoryNo, 10) : 0

      const history = await this.client.getUploadHistory()

      // Filter new items (historyNo > lastNo)
      const newItems = history.items.filter((item) => item.historyNo > lastNo)

      if (newItems.length === 0) {
        return []
      }

      // Convert to DetectedFile format
      const detectedFiles: DetectedFile[] = newItems.map((item) =>
        this.toDetectedFile(item),
      )

      // Update checkpoint to highest historyNo
      const maxHistoryNo = Math.max(...newItems.map((i) => i.historyNo))
      this.state.saveCheckpoint('last_history_no', String(maxHistoryNo))

      // Notify handlers
      this.notifyDetection(detectedFiles, 'polling')

      this.logger.info(`Detected ${detectedFiles.length} new files`, {
        count: detectedFiles.length,
        maxHistoryNo,
      })

      return detectedFiles
    } catch (error) {
      this.logger.error('Polling failed', error as Error)
      return []
    }
  }

  private toDetectedFile(item: UploadHistoryItem): DetectedFile {
    return {
      fileName: `${item.itemSrcName}.${item.itemSrcExtension}`,
      filePath: `${item.itemFolderFullpath}${item.itemSrcName}.${item.itemSrcExtension}`,
      fileSize: 0, // Size not available in history, will be fetched during download
      historyNo: item.historyNo,
      folderId: String(item.itemFolderId),
    }
  }

  private notifyDetection(files: DetectedFile[], strategy: DetectionStrategy): void {
    // Notify registered handlers
    for (const handler of [...this.handlers]) {
      handler(files, strategy)
    }

    // Emit via EventBus
    this.eventBus.emit('detection:found', { files, strategy })
  }
}
