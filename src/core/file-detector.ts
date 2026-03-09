import type { IFileDetector } from './types/file-detector.types'
import type { ILGUplusClient, UploadHistoryItem } from './types/lguplus-client.types'
import type { IStateManager } from './types/state-manager.types'
import type { IEventBus, DetectedFile, DetectionStrategy, OperCode } from './types/events.types'
import type { ILogger } from './types/logger.types'
import { diffSnapshot } from './snapshot-diff'

/** DN(다운로드)은 본인 다운로드 기록이므로 감지에서 제외 */
const EXCLUDED_OPER_CODES = new Set<string>(['DN'])

type DetectionHandler = (files: DetectedFile[], strategy: DetectionStrategy) => void

export interface FileDetectorOptions {
  pollingIntervalMs?: number
  strategy?: 'polling' | 'snapshot'
}

export class FileDetector implements IFileDetector {
  private client: ILGUplusClient
  private state: IStateManager
  private eventBus: IEventBus
  private logger: ILogger
  private pollingIntervalMs: number
  private strategy: 'polling' | 'snapshot'
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
    this.strategy = options?.strategy ?? 'polling'
  }

  start(): void {
    if (this.pollingTimer) return

    this.logger.info('Starting file detector', {
      intervalMs: this.pollingIntervalMs,
      strategy: this.strategy,
    })

    const pollFn =
      this.strategy === 'snapshot' ? () => this.pollBySnapshot() : () => this.pollForFiles()

    // Initial poll
    pollFn()

    this.pollingTimer = setInterval(pollFn, this.pollingIntervalMs)
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
    return this.strategy === 'snapshot' ? this.pollBySnapshot() : this.pollForFiles()
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

  private async pollBySnapshot(): Promise<DetectedFile[]> {
    try {
      const folders = this.state.getFolders(true)
      const allDetected: DetectedFile[] = []

      for (const folder of folders) {
        const folderId = Number(folder.lguplus_folder_id)
        const { items } = await this.client.getFileList(folderId)

        // DB에서 이 폴더의 기존 파일 ID 집합 조회
        const existingFiles = this.state.getFilesByFolder(folder.id)
        const knownFileIds = new Set(
          existingFiles
            .map((f) => Number(f.lguplus_file_id))
            .filter((id) => !isNaN(id)),
        )

        const diff = diffSnapshot(items, knownFileIds, folder.lguplus_folder_id)
        allDetected.push(...diff.newFiles)
      }

      if (allDetected.length > 0) {
        this.notifyDetection(allDetected, 'snapshot')
        this.logger.info(`Snapshot detected ${allDetected.length} new files`, {
          count: allDetected.length,
        })
      }

      return allDetected
    } catch (error) {
      this.logger.error('Snapshot polling failed', error as Error)
      return []
    }
  }

  private async pollForFiles(): Promise<DetectedFile[]> {
    try {
      const lastHistoryNo = this.state.getCheckpoint('last_history_no')
      const lastNo = lastHistoryNo ? parseInt(lastHistoryNo, 10) : 0

      // operCode='' → 모든 변동 이력 조회 (UP, D, MV, RN, CP, FC, FD, FMV, FRN, DN)
      const history = await this.client.getUploadHistory({ operCode: '' })

      // Filter new items (historyNo > lastNo) and exclude DN (본인 다운로드)
      const newItems = history.items.filter(
        (item) => item.historyNo > lastNo && !EXCLUDED_OPER_CODES.has(item.itemOperCode),
      )

      if (newItems.length === 0) {
        return []
      }

      // Convert to DetectedFile format
      const detectedFiles: DetectedFile[] = newItems.map((item) =>
        this.toDetectedFile(item),
      )

      // Update checkpoint to highest historyNo (DN 포함 전체 중 max)
      const allNewItems = history.items.filter((item) => item.historyNo > lastNo)
      const maxHistoryNo = Math.max(...allNewItems.map((i) => i.historyNo))
      this.state.saveCheckpoint('last_history_no', String(maxHistoryNo))

      // Notify handlers
      this.notifyDetection(detectedFiles, 'polling')

      this.logger.info(`Detected ${detectedFiles.length} new events`, {
        count: detectedFiles.length,
        maxHistoryNo,
        operCodes: [...new Set(newItems.map((i) => i.itemOperCode))],
      })

      return detectedFiles
    } catch (error) {
      this.logger.error('Polling failed', error as Error)
      return []
    }
  }

  private toDetectedFile(item: UploadHistoryItem): DetectedFile {
    // 폴더 관련 operCode (FC, FD, FMV, FRN)는 확장자가 없을 수 있음
    const isFolderOp = ['FC', 'FD', 'FMV', 'FRN'].includes(item.itemOperCode)
    const fileName = isFolderOp
      ? item.itemSrcName
      : `${item.itemSrcName}.${item.itemSrcExtension}`
    const filePath = isFolderOp
      ? `${item.itemFolderFullpath}${item.itemSrcName}`
      : `${item.itemFolderFullpath}${item.itemSrcName}.${item.itemSrcExtension}`

    return {
      fileName,
      filePath,
      fileSize: 0, // Size not available in history, will be fetched during download
      historyNo: item.historyNo,
      folderId: String(item.itemFolderId),
      operCode: item.itemOperCode as OperCode,
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
