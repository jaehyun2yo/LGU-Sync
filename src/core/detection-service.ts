import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ISyncEngine } from './types/sync-engine.types'
import type { IStateManager } from './types/state-manager.types'
import type { IEventBus, DetectedFile, DetectionStrategy } from './types/events.types'
import type { IConfigManager } from './types/config.types'
import type { ILogger } from './types/logger.types'
import type { IFileDetector } from './types/file-detector.types'
import type { IFolderDiscovery } from './types/folder.types'

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
      const totalSteps = source === 'auto-start' ? 6 : 5
      let currentStep = 0

      // 1. 폴더 발견 (미등록 폴더 자동 등록)
      this.eventBus.emit('detection:start-progress', {
        step: 'folder-discovery', message: '폴더 스캔 중...', current: ++currentStep, total: totalSteps,
      })
      try {
        await this.folderDiscovery.discoverFolders()
      } catch (error) {
        this.logger.warn('Folder discovery failed during detection start', {
          error: (error as Error).message,
        })
      }

      // 1-1. 다운로드 폴더에 디렉토리 구조 생성
      this.eventBus.emit('detection:start-progress', {
        step: 'download-folders', message: '다운로드 폴더 생성 중...', current: ++currentStep, total: totalSteps,
      })
      await this.createDownloadFolders()

      // 2. 다운타임 복구 (auto-start 시)
      if (source === 'auto-start') {
        this.eventBus.emit('detection:start-progress', {
          step: 'recovery', message: '다운타임 복구 중...', current: ++currentStep, total: totalSteps,
        })
        await this.checkAndRecover()
      }

      // 3. DB에 감지 세션 생성
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

      // 5. SyncEngine 시작 (이미 running이면 skip)
      this.eventBus.emit('detection:start-progress', {
        step: 'engine', message: '감지 엔진 시작 중...', current: ++currentStep, total: totalSteps,
      })
      if (this.engine.status !== 'syncing') {
        await this.engine.start()
      }

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

  /** 다운로드 폴더에 LGU+ 폴더 구조를 미리 생성 */
  private async createDownloadFolders(): Promise<void> {
    try {
      const tempPath = this.config.get('system').tempDownloadPath
      const folders = this.state.getFolders()

      let created = 0
      for (const folder of folders) {
        const folderPath = folder.lguplus_folder_path
        if (!folderPath) continue

        // lguplus_folder_path는 '/올리기전용/업체A/sub1' 형태
        const segments = folderPath.split('/').filter(Boolean)
        if (segments.length === 0) continue

        const dirPath = join(tempPath, ...segments)
        try {
          await mkdir(dirPath, { recursive: true })
          created++
        } catch {
          // ignore individual folder creation errors
        }
      }

      if (created > 0) {
        this.logger.info('Download directories created', { created, total: folders.length })
      }
    } catch (error) {
      this.logger.warn('Failed to create download directories', {
        error: (error as Error).message,
      })
    }
  }

  /** 다운타임 복구: 마지막 세션의 비정상 종료 감지 → 누락 파일 복구 */
  private async checkAndRecover(): Promise<{ recoveredFiles: number; failedFiles: number }> {
    const lastSession = this.state.getLastDetectionSession()
    if (!lastSession) return { recoveredFiles: 0, failedFiles: 0 }

    // stopped_at이 NULL이면 비정상 종료
    const isCrash = lastSession.stopped_at === null
    if (!isCrash) return { recoveredFiles: 0, failedFiles: 0 }

    this.logger.warn('Detected abnormal shutdown, starting recovery', {
      sessionId: lastSession.id,
      lastHistoryNo: lastSession.last_history_no,
    })

    this._status = 'recovering'
    this.emitStatusChange()

    // 비정상 종료 세션 마감
    this.state.endDetectionSession(lastSession.id, {
      stop_reason: 'crash',
      files_detected: lastSession.files_detected,
      files_downloaded: lastSession.files_downloaded,
      files_failed: lastSession.files_failed,
      last_history_no: lastSession.last_history_no,
    })

    // last_history_no 이후의 히스토리를 다시 스캔
    const fromHistoryNo = lastSession.last_history_no ?? 0

    // checkpoint를 복구 시점으로 되돌리고 forceCheck 실행
    this.state.saveCheckpoint('last_history_no', String(fromHistoryNo))

    let recoveredFiles = 0
    let failedFiles = 0

    try {
      const detected = await this.detector.forceCheck()
      recoveredFiles = detected.length
      // 감지된 파일은 SyncEngine이 자동으로 처리
    } catch (error) {
      this.logger.error('Recovery failed', error as Error)
      failedFiles++
    }

    this.logger.info('Recovery completed', { recoveredFiles, failedFiles })
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
