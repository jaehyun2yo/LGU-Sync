import type { IFileDetector } from './types/file-detector.types'
import type { ILGUplusClient, UploadHistoryItem } from './types/lguplus-client.types'
import type { IStateManager } from './types/state-manager.types'
import type { IEventBus, DetectedFile, DetectionStrategy, OperCode } from './types/events.types'
import type { ILogger } from './types/logger.types'
import { diffSnapshot } from './snapshot-diff'

/** DN(다운로드)은 본인 다운로드 기록이므로 감지에서 제외 */
const EXCLUDED_OPER_CODES = new Set<string>(['DN'])

/** 유효한 operCode 목록 (런타임 검증용) */
const VALID_OPER_CODES = new Set<string>([
  'UP', 'D', 'MV', 'RN', 'CP', 'FC', 'FD', 'FMV', 'FRN', 'DN',
])

/** 다중 페이지 조회 시 최대 페이지 수 */
const MAX_POLL_PAGES = 10

/** 에러 백오프 임계값 */
const BACKOFF_FAILURE_THRESHOLD = 5
const ERROR_NOTIFY_THRESHOLD = 3
const MAX_BACKOFF_INTERVAL_MS = 60_000

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
  private originalIntervalMs: number
  private strategy: 'polling' | 'snapshot'
  private pollingTimer: ReturnType<typeof setInterval> | null = null
  private handlers: DetectionHandler[] = []
  private consecutiveFailures = 0

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
    this.originalIntervalMs = this.pollingIntervalMs
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
    this.originalIntervalMs = intervalMs
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

      // 폴더를 배치 단위로 병렬 스캔 (concurrency 3)
      const SNAPSHOT_CONCURRENCY = 3
      for (let i = 0; i < folders.length; i += SNAPSHOT_CONCURRENCY) {
        const batch = folders.slice(i, i + SNAPSHOT_CONCURRENCY)
        const results = await Promise.allSettled(
          batch.map((folder) => this.scanSingleFolder(folder)),
        )

        for (const result of results) {
          if (result.status === 'fulfilled') {
            allDetected.push(...result.value)
          }
        }
      }

      if (allDetected.length > 0) {
        this.notifyDetection(allDetected, 'snapshot')
        this.logger.info(`Snapshot detected ${allDetected.length} changes`, {
          count: allDetected.length,
        })
      }

      this.onPollSuccess()
      return allDetected
    } catch (error) {
      this.onPollFailure(error as Error)
      return []
    }
  }

  private async scanSingleFolder(
    folder: { id: string; lguplus_folder_id: string },
  ): Promise<DetectedFile[]> {
    const folderId = Number(folder.lguplus_folder_id)
    const { items } = await this.client.getFileList(folderId)

    const existingFiles = this.state.getFilesByFolder(folder.id)
    const knownFileIds = new Set(
      existingFiles
        .map((f) => Number(f.lguplus_file_id))
        .filter((id) => !isNaN(id)),
    )

    const diff = diffSnapshot(items, knownFileIds, folder.lguplus_folder_id)
    const detected: DetectedFile[] = [...diff.newFiles]

    if (diff.deletedFileIds.length > 0) {
      for (const itemId of diff.deletedFileIds) {
        detected.push({
          fileName: `deleted-${itemId}`,
          filePath: '',
          fileSize: 0,
          folderId: folder.lguplus_folder_id,
          operCode: 'D' as OperCode,
        })
      }
    }

    return detected
  }

  private async pollForFiles(): Promise<DetectedFile[]> {
    try {
      const lastHistoryNo = this.state.getCheckpoint('last_history_no')
      const lastNo = lastHistoryNo ? parseInt(lastHistoryNo, 10) : 0

      // 다중 페이지 조회: 첫 페이지로 total/pageSize 파악 후 남은 페이지 순차 조회
      const allHistoryItems: UploadHistoryItem[] = []
      const firstPage = await this.client.getUploadHistory({ operCode: '', page: 1 })
      allHistoryItems.push(...firstPage.items)

      const totalPages = Math.min(
        Math.ceil(firstPage.total / (firstPage.pageSize || 20)),
        MAX_POLL_PAGES,
      )

      // 2페이지 이상 필요하고, 첫 페이지에서 lastNo 초과 항목이 있으면 추가 페이지 조회
      if (totalPages > 1 && firstPage.items.some((i) => i.historyNo > lastNo)) {
        for (let page = 2; page <= totalPages; page++) {
          const pageResult = await this.client.getUploadHistory({ operCode: '', page })
          allHistoryItems.push(...pageResult.items)

          // 이 페이지의 모든 항목이 lastNo 이하이면 더 이상 조회 불필요
          if (pageResult.items.every((i) => i.historyNo <= lastNo)) break
        }
      }

      // lastNo 초과 && DN 제외 필터
      const newItems = allHistoryItems.filter(
        (item) => item.historyNo > lastNo && !EXCLUDED_OPER_CODES.has(item.itemOperCode),
      )

      if (newItems.length === 0) {
        this.onPollSuccess()
        return []
      }

      // DetectedFile로 변환
      const detectedFiles: DetectedFile[] = newItems.map((item) =>
        this.toDetectedFile(item),
      )

      // checkpoint 갱신: DN 포함 전체 중 max historyNo
      const allNewItems = allHistoryItems.filter((item) => item.historyNo > lastNo)
      const maxHistoryNo = Math.max(...allNewItems.map((i) => i.historyNo))
      this.state.saveCheckpoint('last_history_no', String(maxHistoryNo))

      // Notify handlers
      this.notifyDetection(detectedFiles, 'polling')

      this.logger.info(`Detected ${detectedFiles.length} new events`, {
        count: detectedFiles.length,
        maxHistoryNo,
        operCodes: [...new Set(newItems.map((i) => i.itemOperCode))],
      })

      this.onPollSuccess()
      return detectedFiles
    } catch (error) {
      this.onPollFailure(error as Error)
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

    // operCode 런타임 검증
    const operCode: OperCode = VALID_OPER_CODES.has(item.itemOperCode)
      ? (item.itemOperCode as OperCode)
      : 'UP' // 알 수 없는 코드는 UP으로 폴백

    return {
      fileName,
      filePath,
      fileSize: 0, // Size not available in history, will be fetched during download
      historyNo: item.historyNo,
      folderId: String(item.itemFolderId),
      operCode,
    }
  }

  /** 폴링 성공 시 실패 카운터 리셋 및 간격 복원 */
  private onPollSuccess(): void {
    if (this.consecutiveFailures > 0) {
      this.consecutiveFailures = 0

      // 백오프 상태였으면 원래 간격으로 복원
      if (this.pollingIntervalMs !== this.originalIntervalMs) {
        this.logger.info('Restoring original polling interval', {
          from: this.pollingIntervalMs,
          to: this.originalIntervalMs,
        })
        this.pollingIntervalMs = this.originalIntervalMs
        if (this.pollingTimer) {
          this.stop()
          this.start()
        }
      }
    }
  }

  /** 폴링 실패 시 카운터 증가 및 백오프 적용 */
  private onPollFailure(error: Error): void {
    this.consecutiveFailures++
    this.logger.error(`Polling failed (${this.consecutiveFailures} consecutive)`, error)

    // N회 연속 실패 시 에러 이벤트 발행
    if (this.consecutiveFailures >= ERROR_NOTIFY_THRESHOLD) {
      this.logger.warn('Multiple consecutive polling failures', {
        failures: this.consecutiveFailures,
      })
    }

    // 백오프: 폴링 간격 2배 증가 (최대 60초)
    if (this.consecutiveFailures >= BACKOFF_FAILURE_THRESHOLD) {
      const newInterval = Math.min(this.pollingIntervalMs * 2, MAX_BACKOFF_INTERVAL_MS)
      if (newInterval !== this.pollingIntervalMs) {
        this.logger.warn('Applying backoff to polling interval', {
          from: this.pollingIntervalMs,
          to: newInterval,
        })
        this.pollingIntervalMs = newInterval
        if (this.pollingTimer) {
          this.stop()
          this.start()
        }
      }
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
