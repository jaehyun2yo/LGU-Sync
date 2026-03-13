import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ISyncEngine } from './types/sync-engine.types'
import type { IStateManager } from './types/state-manager.types'
import type { IEventBus, DetectedFile, DetectionStrategy } from './types/events.types'
import type { IConfigManager } from './types/config.types'
import type { ILogger } from './types/logger.types'
import type { IFileDetector } from './types/file-detector.types'
import type { IFolderDiscovery } from './types/folder.types'
import { filterPathSegments } from './path-utils'

export type DetectionServiceStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'recovering'
export type DetectionStopReason = 'manual' | 'crash' | 'app-quit' | 'error'

export interface DetectionSessionStats {
  filesDetected: number
  filesDownloaded: number
  filesFailed: number
}

export interface IDetectionService {
  readonly status: DetectionServiceStatus
  readonly currentSessionId: string | null

  start(source: 'manual' | 'auto-start' | 'recovery'): Promise<void>
  stop(reason: DetectionStopReason): Promise<void>
  getSessionStats(): DetectionSessionStats
  recover(): Promise<{ recoveredFiles: number; failedFiles: number }>
}

/** DLQ 자동 재시도 간격 (5분) */
const DLQ_RETRY_INTERVAL_MS = 5 * 60 * 1000

/** engine.stop() 타임아웃 (5초) */
const ENGINE_STOP_TIMEOUT_MS = 5_000

export class DetectionService implements IDetectionService {
  private _status: DetectionServiceStatus = 'stopped'
  private _currentSessionId: string | null = null
  private _stats: DetectionSessionStats = { filesDetected: 0, filesDownloaded: 0, filesFailed: 0 }

  private engine: ISyncEngine
  private detector: IFileDetector
  private state: IStateManager
  private eventBus: IEventBus
  private config: IConfigManager
  private logger: ILogger
  private folderDiscovery: IFolderDiscovery

  private cleanupFns: (() => void)[] = []
  private dlqRetryTimer: ReturnType<typeof setInterval> | null = null

  constructor(deps: {
    engine: ISyncEngine
    detector: IFileDetector
    state: IStateManager
    eventBus: IEventBus
    config: IConfigManager
    logger: ILogger
    folderDiscovery: IFolderDiscovery
  }) {
    this.engine = deps.engine
    this.detector = deps.detector
    this.state = deps.state
    this.eventBus = deps.eventBus
    this.config = deps.config
    this.logger = deps.logger.child({ module: 'detection-service' })
    this.folderDiscovery = deps.folderDiscovery
  }

  get status(): DetectionServiceStatus {
    return this._status
  }

  get currentSessionId(): string | null {
    return this._currentSessionId
  }

  async start(source: 'manual' | 'auto-start' | 'recovery'): Promise<void> {
    if (this._status === 'running' || this._status === 'starting') return

    this._status = 'starting'
    this.emitStatusChange()

    try {
      const totalSteps = 6
      let currentStep = 0

      // 1. 폴더 발견 (미등록 폴더 자동 등록)
      //    실패해도 기존 DB 폴더 기준으로 1-1 단계에서 디렉토리를 생성하므로 중단하지 않음
      this.eventBus.emit('detection:start-progress', {
        step: 'folder-discovery', message: '폴더 스캔 중...', current: ++currentStep, total: totalSteps,
      })
      let discoverySucceeded = false
      try {
        const discoveryResult = await this.folderDiscovery.discoverFolders()
        discoverySucceeded = true
        this.logger.info('Folder discovery completed', {
          total: discoveryResult.total,
          newFolders: discoveryResult.newFolders,
        })
      } catch (error) {
        this.logger.warn(
          'Folder discovery failed — will use existing DB folders for directory structure',
          { error: (error as Error).message },
        )
      }

      // 1-1. 다운로드 폴더에 디렉토리 구조 사전 생성
      //      discovery 성공/실패 여부와 무관하게 항상 실행
      //      (discovery 실패 시 기존 DB 폴더 기준, 성공 시 갱신된 DB 기준)
      this.eventBus.emit('detection:start-progress', {
        step: 'download-folders',
        message: discoverySucceeded ? '다운로드 폴더 생성 중...' : '다운로드 폴더 생성 중 (폴더 스캔 실패, DB 기준)...',
        current: ++currentStep,
        total: totalSteps,
      })
      await this.createDownloadFolders()

      // 2. DB에 감지 세션 생성
      this.eventBus.emit('detection:start-progress', {
        step: 'session', message: '세션 준비 중...', current: ++currentStep, total: totalSteps,
      })
      const lastHistoryNo = this.state.getCheckpoint('last_history_no')
      this._currentSessionId = this.state.createDetectionSession({
        start_source: source,
        start_history_no: lastHistoryNo ? parseInt(lastHistoryNo, 10) : null,
      })

      // 4. 통계 초기화 + 이벤트 구독
      this._stats = { filesDetected: 0, filesDownloaded: 0, filesFailed: 0 }
      this.subscribeEvents()

      // 4-1. manual 시작이고 첫 실행(checkpoint 없음)이면 기존 파일도 감지
      if (source === 'manual') {
        const checkpoint = this.state.getCheckpoint('last_history_no')
        if (checkpoint === null) {
          this.detector.setIncludeExistingOnFirstPoll()
        }
      }

      // 4. SyncEngine 시작 (이미 running이면 skip)
      this.eventBus.emit('detection:start-progress', {
        step: 'engine', message: '감지 엔진 시작 중...', current: ++currentStep, total: totalSteps,
      })
      if (this.engine.status !== 'syncing') {
        await this.engine.start()
      }

      // 5. 다운타임 갭 복구 (SyncEngine 구독 후 실행 → 감지 파일이 실제 다운로드됨)
      this.eventBus.emit('detection:start-progress', {
        step: 'recovery', message: '다운타임 복구 중...', current: ++currentStep, total: totalSteps,
      })
      await this.checkAndRecover()

      // 6. DLQ 자동 재시도 시작
      this.eventBus.emit('detection:start-progress', {
        step: 'dlq', message: '재시도 큐 초기화 중...', current: ++currentStep, total: totalSteps,
      })
      this.startDlqRetry()

      this._status = 'running'
      this.emitStatusChange()
      this.logger.info('Detection started', { sessionId: this._currentSessionId, source })
    } catch (error) {
      this._status = 'stopped'
      this.emitStatusChange()
      throw error
    }
  }

  async stop(reason: DetectionStopReason): Promise<void> {
    if (this._status === 'stopped' || this._status === 'stopping') return

    this._status = 'stopping'
    this.emitStatusChange()

    // DLQ 자동 재시도 중지
    this.stopDlqRetry()

    // 이벤트 구독 해제
    for (const cleanup of this.cleanupFns) cleanup()
    this.cleanupFns = []

    // SyncEngine 중지 (타임아웃 적용 — hang 방지)
    try {
      await Promise.race([
        this.engine.stop(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('engine.stop() timed out')), ENGINE_STOP_TIMEOUT_MS),
        ),
      ])
    } catch (error) {
      this.logger.warn('Engine stop timed out, forcing shutdown', {
        error: (error as Error).message,
      })
    }

    // DB 세션 종료
    if (this._currentSessionId) {
      const lastHistoryNo = this.state.getCheckpoint('last_history_no')
      this.state.endDetectionSession(this._currentSessionId, {
        stop_reason: reason,
        files_detected: this._stats.filesDetected,
        files_downloaded: this._stats.filesDownloaded,
        files_failed: this._stats.filesFailed,
        last_history_no: lastHistoryNo ? parseInt(lastHistoryNo, 10) : null,
      })
      this._currentSessionId = null
    }

    this._status = 'stopped'
    this.emitStatusChange()
    this.logger.info('Detection stopped', { reason })
  }

  getSessionStats(): DetectionSessionStats {
    return { ...this._stats }
  }

  async recover(): Promise<{ recoveredFiles: number; failedFiles: number }> {
    return this.checkAndRecover()
  }

  // --- Private ---

  private subscribeEvents(): void {
    // 감지 이벤트 추적
    const onDetection = ({ files }: { files: DetectedFile[]; strategy: DetectionStrategy }): void => {
      this._stats.filesDetected += files.length
      this.updateSessionStats()
    }
    this.eventBus.on('detection:found', onDetection)
    this.cleanupFns.push(() => this.eventBus.off('detection:found', onDetection))

    // 파일 완료 추적
    const onCompleted = (): void => {
      this._stats.filesDownloaded++
      this.updateSessionStats()
    }
    this.eventBus.on('file:completed', onCompleted)
    this.cleanupFns.push(() => this.eventBus.off('file:completed', onCompleted))

    // 실패 추적
    const onFailed = (): void => {
      this._stats.filesFailed++
      this.updateSessionStats()
    }
    this.eventBus.on('sync:failed', onFailed)
    this.cleanupFns.push(() => this.eventBus.off('sync:failed', onFailed))
  }

  private updateSessionStats(): void {
    if (!this._currentSessionId) return
    this.state.updateDetectionSession(this._currentSessionId, {
      files_detected: this._stats.filesDetected,
      files_downloaded: this._stats.filesDownloaded,
      files_failed: this._stats.filesFailed,
      last_history_no: this.getCurrentHistoryNo(),
    })
  }

  private getCurrentHistoryNo(): number | null {
    const val = this.state.getCheckpoint('last_history_no')
    return val ? parseInt(val, 10) : null
  }

  private emitStatusChange(): void {
    this.eventBus.emit('detection:status-change', {
      status: this._status,
      sessionId: this._currentSessionId,
    })
  }

  /** 다운로드 폴더에 LGU+ 폴더 구조를 미리 생성
   *  - GUEST 등 제외 세그먼트를 filterPathSegments로 정리하여 downloadOnly()의 경로와 일치시킴
   *  - 개별 폴더 생성 실패는 무시하되 실패 건수를 로그로 남김
   */
  private async createDownloadFolders(): Promise<void> {
    try {
      const tempPath = this.config.get('system').tempDownloadPath
      const folders = this.state.getFolders()

      let created = 0
      let failed = 0
      for (const folder of folders) {
        const folderPath = folder.lguplus_folder_path
        if (!folderPath) continue

        // filterPathSegments로 GUEST 등 제외 세그먼트 정리 (downloadOnly()와 동일한 방식)
        const rawSegments = folderPath.split('/').filter(Boolean)
        const segments = filterPathSegments(rawSegments)
        if (segments.length === 0) continue

        const dirPath = join(tempPath, ...segments)
        try {
          await mkdir(dirPath, { recursive: true })
          created++
        } catch (err) {
          failed++
          this.logger.debug('Failed to create individual download directory', {
            dirPath,
            error: (err as Error).message,
          })
        }
      }

      this.logger.info('Download directories prepared', { created, failed, total: folders.length })
    } catch (error) {
      this.logger.warn('Failed to create download directories', {
        error: (error as Error).message,
      })
    }
  }

  /** 다운타임 갭 복구: 크래시 세션 마감 + 중지-재시작 사이 누락 파일 감지·다운로드 */
  private async checkAndRecover(): Promise<{ recoveredFiles: number; failedFiles: number }> {
    const lastSession = this.state.getLastDetectionSession()
    if (!lastSession) return { recoveredFiles: 0, failedFiles: 0 }

    // stopped_at이 NULL이면 비정상 종료 → 세션 마감 + checkpoint 되돌림
    const isCrash = lastSession.stopped_at === null
    if (isCrash) {
      this.logger.warn('Detected abnormal shutdown, closing crashed session', {
        sessionId: lastSession.id,
        lastHistoryNo: lastSession.last_history_no,
      })
      this.state.endDetectionSession(lastSession.id, {
        stop_reason: 'crash',
        files_detected: lastSession.files_detected,
        files_downloaded: lastSession.files_downloaded,
        files_failed: lastSession.files_failed,
        last_history_no: lastSession.last_history_no,
      })
      const fromHistoryNo = lastSession.last_history_no ?? 0
      this.state.saveCheckpoint('last_history_no', String(fromHistoryNo))
    }

    // 정상/비정상 모두: 현재 checkpoint 이후 누락 파일을 즉시 감지하여 다운로드
    this._status = 'recovering'
    this.emitStatusChange()

    let recoveredFiles = 0
    let failedFiles = 0

    try {
      const detected = await this.detector.forceCheck()
      recoveredFiles = detected.length
      // SyncEngine이 이미 시작된 상태이므로 감지된 파일은 자동으로 다운로드됨
    } catch (error) {
      this.logger.error('Recovery failed', error as Error)
      failedFiles++
    }

    if (recoveredFiles > 0 || isCrash) {
      this.logger.info('Gap recovery completed', { recoveredFiles, failedFiles, isCrash })
    }
    return { recoveredFiles, failedFiles }
  }

  /** DLQ 자동 재시도 시작 (5분 간격) */
  private startDlqRetry(): void {
    this.dlqRetryTimer = setInterval(async () => {
      try {
        const result = await this.engine.retryAllDlq()
        if (result.succeeded > 0) {
          this.logger.info('DLQ auto-retry completed', result)
        }
      } catch (error) {
        this.logger.error('DLQ auto-retry failed', error as Error)
      }
    }, DLQ_RETRY_INTERVAL_MS)
  }

  /** DLQ 자동 재시도 중지 */
  private stopDlqRetry(): void {
    if (this.dlqRetryTimer) {
      clearInterval(this.dlqRetryTimer)
      this.dlqRetryTimer = null
    }
  }
}
