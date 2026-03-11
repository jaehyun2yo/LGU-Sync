# 실시간 감지 시스템 아키텍처 설계서

- **날짜:** 2026-03-11
- **목적:** TestPage의 실시간 감지 탭을 독립 페이지로 분리하고, 백그라운드 감지 서비스, 감지 세션 DB, 다운타임 복구, 감지 로직 개선을 포함한 전면 아키텍처 개편

---

## 목차

1. [전체 아키텍처 개요](#1-전체-아키텍처-개요)
2. [실시간감지 전용 페이지](#2-실시간감지-전용-페이지)
3. [IPC 채널 설계](#3-ipc-채널-설계)
4. [백그라운드 감지 서비스](#4-백그라운드-감지-서비스)
5. [감지 세션 DB 스키마](#5-감지-세션-db-스키마)
6. [다운타임 복구 알고리즘](#6-다운타임-복구-알고리즘)
7. [감지 로직 개선](#7-감지-로직-개선)
8. [파일별 변경 범위](#8-파일별-변경-범위)

---

## 1. 전체 아키텍처 개요

### 현재 구조의 문제점

1. **실시간 감지가 TestPage 안에 종속** — 테스트 도구와 프로덕션 기능이 혼재
2. **앱 시작 시 수동 감지** — `test:realtime-start`를 UI에서 호출해야 감지 시작
3. **세션 추적 없음** — 감지 시작/종료 기록이 없어 비정상 종료 복구 불가
4. **감지 누락 가능** — 폴링 간격 사이 다중 파일 업로드 시 일부 누락 가능
5. **IPC 채널이 `test:` 네임스페이스** — 프로덕션 기능에 부적절한 이름

### 목표 아키텍처

```
┌─ Main Process ──────────────────────────────────────────────┐
│                                                             │
│  ┌─ DetectionService (NEW) ────────────────────────────┐    │
│  │  - 앱 시작 시 자동 감지 시작 (설정 기반)              │    │
│  │  - 감지 세션 생명주기 관리                            │    │
│  │  - 다운타임 복구                                      │    │
│  │  - 트레이 상태 연동                                   │    │
│  └─┬───────────────────────────────────────────────────┘    │
│    │ 소유                                                    │
│    ▼                                                         │
│  ┌─ SyncEngine (기존) ─────────────────────────────────┐    │
│  │  - FileDetector (폴링)                               │    │
│  │  - Download + Upload 파이프라인                       │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─ IPC Router ────────────────────────────────────────┐    │
│  │  detection:start / stop / status / history            │    │
│  │  detection:session-event (push)                       │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                          ▲ IPC
                          │
┌─ Renderer Process ──────┴──────────────────────────────────┐
│                                                             │
│  ┌─ RealtimeDetectionPage (NEW) ───────────────────────┐   │
│  │  - 감지 상태 패널 (running/stopped/recovering)       │   │
│  │  - 실시간 이벤트 로그 (스트리밍)                     │   │
│  │  - 감지 세션 기록 테이블                              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ detection-store (NEW Zustand) ─────────────────────┐   │
│  │  - detectionStatus, events[], sessions[]             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 실시간감지 전용 페이지

### 2.1 PageId 추가

**파일:** `src/renderer/stores/ui-store.ts`

```typescript
export type PageId =
  | 'dashboard'
  | 'file-explorer'
  | 'folder-settings'
  | 'sync-log'
  | 'statistics'
  | 'migration'
  | 'realtime-detection'  // NEW
  | 'test'
  | 'settings'
```

### 2.2 페이지 컴포넌트 구성

**파일:** `src/renderer/pages/RealtimeDetectionPage.tsx` (NEW)

```
RealtimeDetectionPage
├── DetectionStatusPanel        // 감지 상태 카드
│   ├── 현재 상태 (running/stopped/recovering)
│   ├── 감지 시작/중지 버튼
│   ├── 현재 세션 통계 (감지/다운로드/실패 건수)
│   └── 마지막 폴링 시각
├── RealtimeEventLog            // 실시간 이벤트 로그
│   ├── 자동 스크롤 이벤트 목록 (최대 500건)
│   ├── operCode별 컬러 뱃지
│   ├── 필터 (operCode, 시간 범위)
│   └── 로그 초기화 버튼
└── DetectionSessionHistory     // 세션 기록 테이블
    ├── 세션 ID, 시작/종료 시각
    ├── 종료 사유 (manual/crash/app-quit)
    ├── 감지/다운로드/실패 건수
    └── 페이지네이션
```

### 2.3 App.tsx 라우팅 변경

**파일:** `src/renderer/App.tsx`

```typescript
// import 추가
import { RealtimeDetectionPage } from './pages/RealtimeDetectionPage'

// PageRouter switch 추가
case 'realtime-detection':
  return <RealtimeDetectionPage />
```

### 2.4 사이드바 메뉴 추가

**파일:** `src/renderer/components/Layout.tsx` (또는 Sidebar 컴포넌트)

사이드바 메뉴 항목에 '실시간 감지' 추가. `Radio` 아이콘 사용 (TestPage에서 이관).

```typescript
{ id: 'realtime-detection', label: '실시간 감지', icon: Radio }
```

키보드 단축키: `Ctrl+8` → `'realtime-detection'`

### 2.5 Zustand 스토어

**파일:** `src/renderer/stores/detection-store.ts` (NEW)

```typescript
import { create } from 'zustand'

export type DetectionStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'recovering'

export interface DetectionEvent {
  id: string
  type: 'started' | 'detected' | 'downloaded' | 'failed' | 'error' | 'stopped' | 'recovery'
  message: string
  timestamp: string
  fileName?: string
  operCode?: string
  sessionId?: string
}

export interface DetectionSession {
  id: string
  startedAt: string
  stoppedAt: string | null
  stopReason: 'manual' | 'crash' | 'app-quit' | 'error' | null
  filesDetected: number
  filesDownloaded: number
  filesFailed: number
  lastHistoryNo: number | null
}

interface DetectionState {
  status: DetectionStatus
  events: DetectionEvent[]
  sessions: DetectionSession[]
  currentSessionId: string | null
  lastPollAt: string | null
  autoStartEnabled: boolean
}

interface DetectionActions {
  setStatus: (status: DetectionStatus) => void
  addEvent: (event: DetectionEvent) => void
  clearEvents: () => void
  setSessions: (sessions: DetectionSession[]) => void
  setCurrentSessionId: (id: string | null) => void
  setLastPollAt: (time: string) => void
  setAutoStartEnabled: (enabled: boolean) => void
  fetchStatus: () => Promise<void>
  fetchSessions: () => Promise<void>
  startDetection: () => Promise<void>
  stopDetection: () => Promise<void>
}

export type DetectionStore = DetectionState & DetectionActions
```

---

## 3. IPC 채널 설계

### 3.1 현재 채널 → 신규 채널 매핑

| 현재 (deprecated) | 신규 | 용도 |
|---|---|---|
| `test:realtime-start` | `detection:start` | 감지 시작 |
| `test:realtime-stop` | `detection:stop` | 감지 중지 |
| (없음) | `detection:status` | 감지 상태 조회 |
| (없음) | `detection:sessions` | 세션 기록 조회 |
| (없음) | `detection:recover` | 수동 복구 트리거 |
| `test:realtime-event` | `detection:event` | 실시간 이벤트 푸시 |

### 3.2 IpcChannelMap 추가

**파일:** `src/shared/ipc-types.ts`

```typescript
// ── Detection types ──

export interface DetectionStartRequest {
  /** 앱 시작 자동감지인지 수동인지 구분 */
  source: 'manual' | 'auto-start' | 'recovery'
}

export interface DetectionStatusResponse {
  /** 현재 감지 상태 */
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'recovering'
  /** 현재 세션 ID (없으면 null) */
  currentSessionId: string | null
  /** 현재 세션 통계 */
  currentSession: {
    filesDetected: number
    filesDownloaded: number
    filesFailed: number
    startedAt: string
    lastHistoryNo: number | null
  } | null
  /** 마지막 폴링 시각 */
  lastPollAt: string | null
  /** 자동 시작 설정 여부 */
  autoStartEnabled: boolean
}

export interface DetectionSessionInfo {
  id: string
  startedAt: string
  stoppedAt: string | null
  stopReason: 'manual' | 'crash' | 'app-quit' | 'error' | null
  filesDetected: number
  filesDownloaded: number
  filesFailed: number
  lastHistoryNo: number | null
}

export interface DetectionSessionsRequest {
  page?: number
  pageSize?: number
}

export interface DetectionRecoverResult {
  recoveredFiles: number
  failedFiles: number
  fromHistoryNo: number
  toHistoryNo: number
}

// IpcChannelMap에 추가:
export interface IpcChannelMap {
  // ... 기존 채널들 ...

  // Detection
  'detection:start': { request: DetectionStartRequest; response: ApiResponse<void> }
  'detection:stop': { request: void; response: ApiResponse<void> }
  'detection:status': { request: void; response: ApiResponse<DetectionStatusResponse> }
  'detection:sessions': {
    request: DetectionSessionsRequest
    response: ApiResponse<Paginated<DetectionSessionInfo>>
  }
  'detection:recover': { request: void; response: ApiResponse<DetectionRecoverResult> }
}
```

### 3.3 IpcEventMap 추가

```typescript
export interface DetectionEventPush {
  type: 'started' | 'detected' | 'downloaded' | 'failed' | 'error' | 'stopped' | 'recovery'
  message: string
  timestamp: string
  fileName?: string
  operCode?: string
  sessionId?: string
  /** 감지/다운로드/실패 건수 (현재 세션) */
  stats?: {
    filesDetected: number
    filesDownloaded: number
    filesFailed: number
  }
}

export interface DetectionStatusPush {
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'recovering'
  sessionId: string | null
}

// IpcEventMap에 추가:
export interface IpcEventMap {
  // ... 기존 이벤트들 ...

  'detection:event': DetectionEventPush
  'detection:status-changed': DetectionStatusPush
}
```

### 3.4 하위 호환성

기존 `test:realtime-start`, `test:realtime-stop`, `test:realtime-event` 채널은 **즉시 제거하지 않고** deprecated 표시 후 한 버전 유지. TestPage의 realtime 탭은 새 IPC 채널을 사용하도록 변경한 후 제거.

---

## 4. 백그라운드 감지 서비스

### 4.1 DetectionService 클래스

**파일:** `src/core/detection-service.ts` (NEW)

```typescript
import type { ISyncEngine } from './types/sync-engine.types'
import type { IStateManager } from './types/state-manager.types'
import type { IEventBus, DetectedFile, DetectionStrategy } from './types/events.types'
import type { IConfigManager } from './types/config.types'
import type { ILogger } from './types/logger.types'
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

  /** 감지 시작 (세션 생성, 엔진 시작, 이벤트 구독) */
  start(source: 'manual' | 'auto-start' | 'recovery'): Promise<void>

  /** 감지 중지 (세션 종료, 엔진 중지) */
  stop(reason: DetectionStopReason): Promise<void>

  /** 현재 세션 통계 */
  getSessionStats(): DetectionSessionStats

  /** 다운타임 복구 실행 */
  recover(): Promise<{ recoveredFiles: number; failedFiles: number }>
}

export class DetectionService implements IDetectionService {
  private _status: DetectionServiceStatus = 'stopped'
  private _currentSessionId: string | null = null
  private _stats: DetectionSessionStats = { filesDetected: 0, filesDownloaded: 0, filesFailed: 0 }

  private engine: ISyncEngine
  private state: IStateManager
  private eventBus: IEventBus
  private config: IConfigManager
  private logger: ILogger
  private folderDiscovery: IFolderDiscovery

  // EventBus 리스너 해제 함수들
  private cleanupFns: (() => void)[] = []

  constructor(deps: {
    engine: ISyncEngine
    state: IStateManager
    eventBus: IEventBus
    config: IConfigManager
    logger: ILogger
    folderDiscovery: IFolderDiscovery
  }) {
    this.engine = deps.engine
    this.state = deps.state
    this.eventBus = deps.eventBus
    this.config = deps.config
    this.logger = deps.logger.child({ module: 'detection-service' })
    this.folderDiscovery = deps.folderDiscovery
  }

  get status(): DetectionServiceStatus { return this._status }
  get currentSessionId(): string | null { return this._currentSessionId }

  async start(source: 'manual' | 'auto-start' | 'recovery'): Promise<void> {
    if (this._status === 'running' || this._status === 'starting') return

    this._status = 'starting'
    this.emitStatusChange()

    try {
      // 1. 폴더 발견 (미등록 폴더 자동 등록)
      await this.folderDiscovery.discoverFolders()

      // 2. 다운타임 복구 (auto-start 시)
      if (source === 'auto-start') {
        await this.checkAndRecover()
      }

      // 3. DB에 감지 세션 생성
      const lastHistoryNo = this.state.getCheckpoint('last_history_no')
      this._currentSessionId = this.state.createDetectionSession({
        start_source: source,
        start_history_no: lastHistoryNo ? parseInt(lastHistoryNo, 10) : null,
      })

      // 4. 통계 초기화
      this._stats = { filesDetected: 0, filesDownloaded: 0, filesFailed: 0 }

      // 5. 이벤트 구독
      this.subscribeEvents()

      // 6. SyncEngine 시작 (이미 running이면 skip)
      if (this.engine.status !== 'syncing') {
        await this.engine.start()
      }

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

    // 이벤트 구독 해제
    for (const cleanup of this.cleanupFns) cleanup()
    this.cleanupFns = []

    // SyncEngine 중지
    await this.engine.stop()

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
    // 6장 다운타임 복구 알고리즘 참조
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

  /** 다운타임 복구: 마지막 세션의 비정상 종료 감지 → 누락 파일 복구 */
  private async checkAndRecover(): Promise<{ recoveredFiles: number; failedFiles: number }> {
    // 6장 참조
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

    // 복구 최대 범위: 7일
    const MAX_RECOVERY_DAYS = 7
    const recoveryLimit = new Date()
    recoveryLimit.setDate(recoveryLimit.getDate() - MAX_RECOVERY_DAYS)

    // last_history_no 이후의 히스토리를 다시 스캔
    const fromHistoryNo = lastSession.last_history_no ?? 0

    // FileDetector.forceCheck()로 누락 파일 재스캔
    // checkpoint를 복구 시점으로 되돌리고 forceCheck 실행
    this.state.saveCheckpoint('last_history_no', String(fromHistoryNo))

    let recoveredFiles = 0
    let failedFiles = 0

    try {
      const detected = await this.engine.deps?.detector?.forceCheck?.() ?? []
      recoveredFiles = detected.length
      // 감지된 파일은 SyncEngine이 자동으로 처리
    } catch (error) {
      this.logger.error('Recovery failed', error as Error)
      failedFiles++
    }

    this.logger.info('Recovery completed', { recoveredFiles, failedFiles })
    return { recoveredFiles, failedFiles }
  }
}
```

### 4.2 DI 컨테이너 등록

**파일:** `src/core/container.ts`

```typescript
import { DetectionService } from './detection-service'
import type { IDetectionService } from './detection-service'

export interface CoreServices {
  // ... 기존 서비스들 ...
  detectionService: IDetectionService  // NEW
}

export function createCoreServices(options: CoreOptions): CoreServices {
  // ... 기존 생성 코드 ...

  const detectionService = new DetectionService({
    engine,
    state,
    eventBus,
    config,
    logger,
    folderDiscovery,
  })

  return {
    // ... 기존 ...
    detectionService,
  }
}
```

### 4.3 앱 시작 시 자동 감지

**파일:** `src/main/index.ts`

현재 `index.ts`의 Step 8 (자동 로그인 + 엔진 시작) 로직을 `DetectionService.start('auto-start')`로 교체:

```typescript
// 기존 코드:
// await coreServices.engine.start()
// coreServices.logger.info('Auto-started sync engine')

// 변경 코드:
await coreServices.detectionService.start('auto-start')
coreServices.logger.info('Auto-started detection service')
```

### 4.4 설정 옵션 추가

**파일:** `src/core/types/config.types.ts`

```typescript
export interface AppConfig {
  // ... 기존 ...
  system: {
    autoStart: boolean
    startMinimized: boolean
    tempDownloadPath: string
    logRetentionDays: number
    autoDetection: boolean  // NEW: 앱 시작 시 자동 감지 (기본값 true)
  }
}
```

**파일:** `src/core/config-manager.ts`

```typescript
// DEFAULT_CONFIG.system에 추가:
system: {
  // ... 기존 ...
  autoDetection: true,
}
```

### 4.5 트레이 아이콘 상태 반영

**파일:** `src/main/tray-manager.ts`

트레이 매니저의 컨텍스트 메뉴에 '감지 시작/중지' 항목 추가:

```typescript
export interface TrayCallbacks {
  onShow: () => void
  onPauseResume: () => void
  onFullSync: () => void
  onDetectionToggle: () => void  // NEW
  onQuit: () => void
}

// 컨텍스트 메뉴 항목 추가:
{
  label: isDetectionRunning ? '감지 중지' : '감지 시작',
  click: () => this.callbacks.onDetectionToggle(),
}
```

트레이 툴팁에 감지 상태 표시:
- `syncing` + detection running → "동기화중 (감지 활성)"
- `idle` + detection stopped → "대기중"

### 4.6 Graceful Shutdown 연동

**파일:** `src/main/index.ts`

```typescript
app.on('before-quit', async (event) => {
  // DetectionService 종료 (세션 기록 저장)
  if (coreServices.detectionService.status === 'running') {
    await coreServices.detectionService.stop('app-quit')
  }
  // ... 기존 cleanup ...
})
```

---

## 5. 감지 세션 DB 스키마

### 5.1 detection_sessions 테이블

**파일:** `src/core/db/schema.ts`

```sql
CREATE TABLE IF NOT EXISTS detection_sessions (
    id                TEXT PRIMARY KEY,
    start_source      TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'auto-start' | 'recovery'
    status            TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'completed' | 'crashed'
    started_at        TEXT NOT NULL DEFAULT (datetime('now')),
    stopped_at        TEXT,                              -- NULL이면 비정상 종료
    stop_reason       TEXT,                              -- 'manual' | 'crash' | 'app-quit' | 'error'
    files_detected    INTEGER NOT NULL DEFAULT 0,
    files_downloaded  INTEGER NOT NULL DEFAULT 0,
    files_failed      INTEGER NOT NULL DEFAULT 0,
    start_history_no  INTEGER,                           -- 시작 시점 checkpoint
    last_history_no   INTEGER,                           -- 마지막 처리 checkpoint
    error_message     TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ds_status ON detection_sessions(status);
CREATE INDEX IF NOT EXISTS idx_ds_started ON detection_sessions(started_at);
```

### 5.2 StateManager 확장

**파일:** `src/core/state-manager.ts`

```typescript
// ── Detection Sessions ──

createDetectionSession(data: {
  start_source: string
  start_history_no: number | null
}): string {
  const id = uuid()
  this.db.prepare(
    `INSERT INTO detection_sessions (id, start_source, start_history_no)
     VALUES (?, ?, ?)`
  ).run(id, data.start_source, data.start_history_no)
  return id
}

endDetectionSession(id: string, data: {
  stop_reason: string
  files_detected: number
  files_downloaded: number
  files_failed: number
  last_history_no: number | null
}): void {
  this.db.prepare(
    `UPDATE detection_sessions
     SET stopped_at = datetime('now'),
         status = 'completed',
         stop_reason = ?,
         files_detected = ?,
         files_downloaded = ?,
         files_failed = ?,
         last_history_no = ?
     WHERE id = ?`
  ).run(
    data.stop_reason,
    data.files_detected,
    data.files_downloaded,
    data.files_failed,
    data.last_history_no,
    id,
  )
}

updateDetectionSession(id: string, data: {
  files_detected?: number
  files_downloaded?: number
  files_failed?: number
  last_history_no?: number | null
}): void {
  const updates: string[] = []
  const params: unknown[] = []

  if (data.files_detected !== undefined) {
    updates.push('files_detected = ?')
    params.push(data.files_detected)
  }
  if (data.files_downloaded !== undefined) {
    updates.push('files_downloaded = ?')
    params.push(data.files_downloaded)
  }
  if (data.files_failed !== undefined) {
    updates.push('files_failed = ?')
    params.push(data.files_failed)
  }
  if (data.last_history_no !== undefined) {
    updates.push('last_history_no = ?')
    params.push(data.last_history_no)
  }

  if (updates.length === 0) return
  params.push(id)

  this.db.prepare(
    `UPDATE detection_sessions SET ${updates.join(', ')} WHERE id = ?`
  ).run(...params)
}

getLastDetectionSession(): DetectionSessionRow | null {
  return this.db.prepare(
    'SELECT * FROM detection_sessions ORDER BY started_at DESC LIMIT 1'
  ).get() as DetectionSessionRow | null
}

getDetectionSessions(options?: {
  page?: number
  pageSize?: number
}): { items: DetectionSessionRow[]; total: number } {
  const page = options?.page ?? 1
  const pageSize = options?.pageSize ?? 20
  const offset = (page - 1) * pageSize

  const total = (this.db.prepare(
    'SELECT COUNT(*) as cnt FROM detection_sessions'
  ).get() as { cnt: number }).cnt

  const items = this.db.prepare(
    'SELECT * FROM detection_sessions ORDER BY started_at DESC LIMIT ? OFFSET ?'
  ).all(pageSize, offset) as DetectionSessionRow[]

  return { items, total }
}
```

### 5.3 DB Row 타입

**파일:** `src/core/db/types.ts`

```typescript
export interface DetectionSessionRow {
  id: string
  start_source: string
  status: string
  started_at: string
  stopped_at: string | null
  stop_reason: string | null
  files_detected: number
  files_downloaded: number
  files_failed: number
  start_history_no: number | null
  last_history_no: number | null
  error_message: string | null
  created_at: string
}
```

### 5.4 IStateManager 인터페이스 확장

**파일:** `src/core/types/state-manager.types.ts`

```typescript
export interface IStateManager {
  // ... 기존 메서드 ...

  // Detection Sessions
  createDetectionSession(data: {
    start_source: string
    start_history_no: number | null
  }): string

  endDetectionSession(id: string, data: {
    stop_reason: string
    files_detected: number
    files_downloaded: number
    files_failed: number
    last_history_no: number | null
  }): void

  updateDetectionSession(id: string, data: {
    files_detected?: number
    files_downloaded?: number
    files_failed?: number
    last_history_no?: number | null
  }): void

  getLastDetectionSession(): DetectionSessionRow | null

  getDetectionSessions(options?: {
    page?: number
    pageSize?: number
  }): { items: DetectionSessionRow[]; total: number }
}
```

---

## 6. 다운타임 복구 알고리즘

### 6.1 복구 흐름

```
앱 시작
  │
  ▼
DetectionService.start('auto-start')
  │
  ├─ checkAndRecover() 호출
  │   │
  │   ▼
  │   getLastDetectionSession()
  │   │
  │   ├─ 세션 없음 → 복구 불필요 (첫 실행)
  │   │
  │   ├─ stopped_at !== NULL → 정상 종료 → 복구 불필요
  │   │
  │   └─ stopped_at === NULL → 비정상 종료 (crash)
  │       │
  │       ▼
  │       1. 비정상 세션 마감 (stop_reason: 'crash')
  │       2. last_history_no 확인
  │       3. 복구 범위 계산 (최대 7일)
  │       4. checkpoint를 last_history_no로 롤백
  │       5. FileDetector.forceCheck()로 누락 파일 재스캔
  │       6. SyncEngine이 자동으로 다운로드/업로드 처리
  │       7. 복구 결과 로깅
  │
  ▼
정상 감지 시작
```

### 6.2 복구 최대 범위

- **7일** 이전의 히스토리는 복구하지 않음 (LGU+ API의 히스토리 보관 기간 고려)
- 7일 초과 시 경고 로그 + UI 알림 발행

### 6.3 복구 안전장치

1. **중복 방지**: `StateManager.getFileByHistoryNo()`로 이미 처리된 파일 skip
2. **재시도 제한**: `RetryManager`의 서킷 브레이커가 연속 실패 시 차단
3. **복구 세션 구분**: `start_source: 'recovery'`로 복구 세션 별도 기록

---

## 7. 감지 로직 개선

### 7.1 깊은 폴더 100% 스캔

현재 `FileDetector.pollForFiles()`는 히스토리 API에 의존하므로 깊은 폴더의 직접 파일 목록을 조회하지 않음. 히스토리 기반 감지는 폴더 깊이와 무관하게 모든 변경을 감지하므로 **구조적으로는 문제없음**.

단, 다음 시나리오에서 누락 가능:
- **히스토리 페이징 부족**: `MAX_POLL_PAGES = 10`으로 제한 → 한번에 200건 이상 변경 시 누락

**개선 방안:**

```typescript
// file-detector.ts 수정

// MAX_POLL_PAGES를 설정으로 이동
const MAX_POLL_PAGES = 50  // 10 → 50으로 증가 (최대 1000건)

// 조기 종료 조건 강화: lastNo 이하 항목만 있는 페이지가 연속 2회이면 종료
private shouldStopPagination(
  pageItems: UploadHistoryItem[],
  lastNo: number,
  consecutiveOldPages: number
): { stop: boolean; consecutiveOld: number } {
  const hasNewItems = pageItems.some(i => i.historyNo > lastNo)
  if (!hasNewItems) {
    return {
      stop: consecutiveOldPages + 1 >= 2,
      consecutiveOld: consecutiveOldPages + 1,
    }
  }
  return { stop: false, consecutiveOld: 0 }
}
```

### 7.2 체크포인트 기반 누락 방지

현재 구현은 `last_history_no` 단일 체크포인트에 의존. 다중 파일 동시 감지 시 일부만 처리되고 크래시하면 checkpoint는 갱신되지만 일부 파일이 미처리.

**개선 방안: 2단계 체크포인트**

```
단계 1: 감지 (detection) — historyNo 수집만, checkpoint 미갱신
단계 2: 커밋 (commit) — 모든 파일이 saveFile() 완료 후 checkpoint 갱신
```

**파일:** `src/core/file-detector.ts` 수정

```typescript
private async pollForFiles(): Promise<DetectedFile[]> {
  // ... 기존 히스토리 조회 로직 ...

  // 변경: checkpoint를 즉시 갱신하지 않음
  // DetectedFile[]을 반환하고, 핸들러가 모든 파일을 DB에 저장한 후
  // checkpoint를 갱신하도록 위임

  const detectedFiles: DetectedFile[] = newItems.map(item => this.toDetectedFile(item))

  // maxHistoryNo는 반환값에 포함
  const maxHistoryNo = Math.max(...allNewItems.map(i => i.historyNo))

  // checkpoint 갱신은 핸들러에서 수행
  this.notifyDetection(detectedFiles, 'polling')

  // 핸들러가 처리 완료 후 checkpoint 갱신
  this.state.saveCheckpoint('last_history_no', String(maxHistoryNo))

  return detectedFiles
}
```

> **참고**: 현재 구현에서도 checkpoint는 모든 파일을 `notifyDetection()` 한 후에 갱신되므로, 핸들러 내의 `saveFile()`이 동기이면 안전함. 다만, SyncEngine.handleDetectedFiles가 비동기 다운로드를 시작만 하고 리턴하므로, 다운로드 완료 전 크래시 시에는 checkpoint가 이미 갱신되어 있어 문제. 이 경우 **다운타임 복구**가 보완 역할을 함.

### 7.3 다운로드 100% 보장: 큐잉 + 재시도

현재 `SyncEngine`의 `enqueueFileSync` + `syncQueue`는 이미 큐잉 구조를 갖추고 있음. 추가 개선:

1. **영속 큐**: 현재 `syncQueue`는 메모리 배열 → 크래시 시 유실. `sync_files` 테이블의 `status = 'detected'` 레코드가 사실상 영속 큐 역할을 하므로, 다운타임 복구 시 `status = 'detected'`인 파일을 재처리.

2. **DLQ 자동 재시도**: `DetectionService`에 주기적 DLQ 재시도 로직 추가

```typescript
// detection-service.ts
private dlqRetryTimer: ReturnType<typeof setInterval> | null = null

private startDlqRetry(): void {
  // 5분마다 DLQ 재시도
  this.dlqRetryTimer = setInterval(async () => {
    try {
      const result = await this.engine.retryAllDlq()
      if (result.succeeded > 0) {
        this.logger.info('DLQ auto-retry completed', result)
      }
    } catch (error) {
      this.logger.error('DLQ auto-retry failed', error as Error)
    }
  }, 5 * 60 * 1000)
}
```

---

## 8. 파일별 변경 범위

### 신규 파일

| 파일 | 설명 |
|------|------|
| `src/core/detection-service.ts` | DetectionService 클래스 (감지 생명주기, 세션, 복구) |
| `src/renderer/pages/RealtimeDetectionPage.tsx` | 실시간감지 전용 페이지 |
| `src/renderer/stores/detection-store.ts` | 감지 상태 Zustand 스토어 |

### 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/shared/ipc-types.ts` | `detection:` IPC 채널/이벤트 타입 추가 |
| `src/renderer/stores/ui-store.ts` | PageId에 `'realtime-detection'` 추가 |
| `src/renderer/App.tsx` | RealtimeDetectionPage 라우팅, 키보드 단축키, IPC 이벤트 구독 |
| `src/renderer/components/Layout.tsx` | 사이드바 '실시간 감지' 메뉴 항목 추가 |
| `src/core/container.ts` | `DetectionService` DI 등록 |
| `src/core/state-manager.ts` | `detection_sessions` CRUD 메서드 추가 |
| `src/core/types/state-manager.types.ts` | `IStateManager`에 세션 메서드 추가 |
| `src/core/db/schema.ts` | `CREATE_DETECTION_SESSIONS` DDL 추가, `ALL_CREATE_STATEMENTS` 배열에 등록 |
| `src/core/db/types.ts` | `DetectionSessionRow` 타입 추가 |
| `src/core/types/events.types.ts` | `EventMap`에 `detection:status-change` 이벤트 추가 |
| `src/core/types/config.types.ts` | `system.autoDetection` 설정 추가 |
| `src/core/config-manager.ts` | `DEFAULT_CONFIG`에 `autoDetection: true` 추가 |
| `src/core/file-detector.ts` | `MAX_POLL_PAGES` 증가, 조기 종료 로직 개선 |
| `src/main/index.ts` | 앱 시작 시 `DetectionService.start('auto-start')`, graceful shutdown 연동 |
| `src/main/ipc-router.ts` | `detection:` IPC 핸들러 추가, `test:realtime-*` deprecated 표시 |
| `src/main/tray-manager.ts` | 감지 시작/중지 메뉴 항목, 상태 반영 |
| `src/renderer/pages/TestPage.tsx` | realtime 탭 제거 (새 페이지로 이관 완료 후) |
| `src/preload/index.ts` | 변경 없음 (ElectronAPI 인터페이스가 타입으로 확장됨) |

### EventMap 확장

**파일:** `src/core/types/events.types.ts`

```typescript
export interface EventMap {
  // ... 기존 이벤트 ...

  // Detection service lifecycle
  'detection:status-change': {
    status: DetectionServiceStatus
    sessionId: string | null
  }
}
```

> `DetectionServiceStatus` 타입은 `detection-service.ts`에서 export하므로 순환 의존 방지를 위해 events.types.ts에서는 string literal union으로 재정의하거나, 별도 `detection.types.ts`로 분리.

---

## 부록: 구현 우선순위

| 순서 | 작업 | 담당 | 의존성 |
|------|------|------|--------|
| 1 | DB 스키마 + StateManager 확장 | core-dev | 없음 |
| 2 | DetectionService 구현 | core-dev | 1 |
| 3 | IPC 채널 + 핸들러 | core-dev | 2 |
| 4 | detection-store + RealtimeDetectionPage | frontend-dev | 3 |
| 5 | App.tsx 라우팅 + 사이드바 | frontend-dev | 4 |
| 6 | 트레이 연동 | core-dev | 2 |
| 7 | TestPage realtime 탭 제거 | frontend-dev | 4,5 |
| 8 | E2E 테스트 | e2e-tester | 4,5,6,7 |
