# 공유 폴더스캔 캐시 + 실시간 감지 테스트 구현 플랜

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 폴더 스캔 결과를 TestPage 탭 간 + 메인 동기화에서 공유하는 캐시(30분 TTL) 구현, 실시간 감지 테스트 탭 추가

**Architecture:** 기존 `FolderTreeCache`를 `ScanResultCache`로 확장하여 `MigrationFolderInfo[]` 전체 트리를 30분 TTL로 캐싱. DI 컨테이너에서 싱글턴으로 공유. 실시간 감지 테스트는 TestPage 4번째 탭으로 추가하며, `test:realtime-start`/`test:realtime-stop` IPC 채널로 FileDetector 기반 폴링+자동 동기화 실행.

**Tech Stack:** TypeScript, React 19, Electron IPC, Zustand, Lucide React

---

## Task 1: ScanResultCache 클래스 구현

**Files:**
- Modify: `src/core/folder-tree-cache.ts`

**Step 1: FolderTreeCache에 스캔 결과 캐시 메서드 추가**

`folder-tree-cache.ts`에 `MigrationFolderInfo[]` 전체 트리를 저장/조회하는 메서드를 추가한다. 기존 `subFoldersCache`/`fileCountCache`는 그대로 유지.

```typescript
// folder-tree-cache.ts에 추가할 코드

import type { MigrationFolderInfo } from '../shared/ipc-types'

// 기존 CacheEntry<T> 인터페이스 활용

// 클래스 내부에 추가:
private scanResultCache: CacheEntry<MigrationFolderInfo[]> | null = null
private scanResultTtlMs: number

// constructor 수정: scanResultTtlMs 옵션 추가
constructor(options?: { ttlMs?: number; scanResultTtlMs?: number }) {
  this.ttlMs = options?.ttlMs ?? 5 * 60 * 1000
  this.scanResultTtlMs = options?.scanResultTtlMs ?? 30 * 60 * 1000 // 30분
}

getScanResult(): { data: MigrationFolderInfo[]; cachedAt: number } | null {
  if (!this.scanResultCache || Date.now() > this.scanResultCache.expiresAt) {
    this.scanResultCache = null
    return null
  }
  return {
    data: this.scanResultCache.data,
    cachedAt: this.scanResultCache.expiresAt - this.scanResultTtlMs,
  }
}

setScanResult(folders: MigrationFolderInfo[]): void {
  this.scanResultCache = {
    data: folders,
    expiresAt: Date.now() + this.scanResultTtlMs,
  }
}

invalidateScanResult(): void {
  this.scanResultCache = null
}

// clear() 메서드에도 추가:
// this.scanResultCache = null
```

**Step 2: typecheck 확인**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/core/folder-tree-cache.ts
git commit -m "feat: add scan result cache to FolderTreeCache (30min TTL)"
```

---

## Task 2: DI 컨테이너에서 FolderTreeCache를 CoreServices에 노출

**Files:**
- Modify: `src/core/container.ts`

**Step 1: CoreServices 인터페이스에 folderCache 추가**

```typescript
// container.ts의 CoreServices 인터페이스에 추가:
import { FolderTreeCache } from './folder-tree-cache'

export interface CoreServices {
  // ... 기존 필드들 ...
  folderCache: FolderTreeCache
}
```

**Step 2: createCoreServices 반환값에 folderCache 추가**

```typescript
// return 블록에 추가:
return {
  // ... 기존 ...
  folderCache,
}
```

**Step 3: FolderTreeCache 생성 시 scanResultTtlMs 옵션 전달**

```typescript
// 기존: const folderCache = new FolderTreeCache()
// 변경:
const folderCache = new FolderTreeCache({ scanResultTtlMs: 30 * 60 * 1000 })
```

**Step 4: typecheck 확인**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/container.ts
git commit -m "feat: expose FolderTreeCache in CoreServices for shared scan cache"
```

---

## Task 3: ipc-router에서 캐시 적용 (test:scan-folders)

**Files:**
- Modify: `src/main/ipc-router.ts`
- Modify: `src/shared/ipc-types.ts`

**Step 1: IPC 타입에 forceRefresh 요청 + cachedAt 응답 추가**

`ipc-types.ts` 수정:

```typescript
// 기존:
// 'test:scan-folders': { request: void; response: ApiResponse<MigrationFolderInfo[]> }
// 변경:
'test:scan-folders': {
  request: { forceRefresh?: boolean } | void
  response: ApiResponse<{ folders: MigrationFolderInfo[]; cachedAt: number | null }>
}
```

**Step 2: ipc-router.ts의 test:scan-folders 핸들러에 캐시 로직 추가**

```typescript
ipcMain.handle('test:scan-folders', async (_event, request) => {
  try {
    const forceRefresh = request?.forceRefresh ?? false

    // 캐시 확인 (forceRefresh가 아닌 경우)
    if (!forceRefresh) {
      const cached = folderCache.getScanResult()
      if (cached) {
        return ok({ folders: cached.data, cachedAt: cached.cachedAt })
      }
    }

    // 기존 스캔 로직 (현재 코드 유지)
    await folderDiscovery.discoverFolders()
    const homeId = await lguplus.getGuestFolderRootId()
    if (!homeId) return fail('TEST_SCAN_FAILED', 'HOME folder not found')

    const rootFolders = await lguplus.getSubFolders(homeId)
    const settled = await mapWithConcurrency(rootFolders, 3, async (rf) => {
      // ... 기존 로직 동일 ...
    })
    const result = settled
      .filter((r): r is PromiseFulfilledResult<MigrationFolderInfo> => r.status === 'fulfilled')
      .map((r) => r.value)

    // 캐시 저장
    folderCache.setScanResult(result)

    return ok({ folders: result, cachedAt: null })
  } catch (e) {
    return fail('TEST_SCAN_FAILED', (e as Error).message)
  }
})
```

**Step 3: ipc-router에서 folderCache 참조 추가**

`registerIpcHandlers` 함수에서 `services` 인자에서 `folderCache`를 destructuring:

```typescript
const { eventBus, logger, config, state, retry, lguplus, uploader, detector, notification, engine, folderDiscovery, folderCache } = services
```

**Step 4: typecheck 확인**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/shared/ipc-types.ts src/main/ipc-router.ts
git commit -m "feat: apply scan result cache to test:scan-folders IPC handler"
```

---

## Task 4: Renderer에서 캐시 상태 표시 및 새로고침 버튼

**Files:**
- Modify: `src/renderer/pages/TestPage.tsx`

**Step 1: handleScan에서 새 응답 형식 처리 + cachedAt 상태 추가**

```typescript
// TestPage 컴포넌트 내부에 상태 추가:
const [cachedAt, setCachedAt] = useState<number | null>(null)

// handleScan 수정:
const handleScan = useCallback(async (forceRefresh = false) => {
  updateTabState(tab, { state: 'scanning', error: null, results: [], summary: null })
  try {
    const res = await window.electronAPI.invoke('test:scan-folders', { forceRefresh })
    if (res.success && res.data) {
      setFolders(res.data.folders)
      setCachedAt(res.data.cachedAt)
      const allIds = collectAllIds(res.data.folders)
      setSelectedIds(new Set(allIds))
      setExpandedIds(new Set())
      updateTabState(tab, { state: 'selecting' })
    } else {
      updateTabState(tab, { error: res.error?.message ?? '스캔 실패', state: 'idle' })
    }
  } catch {
    updateTabState(tab, { error: '폴더 스캔 중 오류가 발생했습니다', state: 'idle' })
  }
}, [tab, updateTabState])
```

**Step 2: selecting 상태에서 캐시 정보 + 새로고침 버튼 표시**

selecting 상태의 상단 바에 캐시 정보 표시:

```tsx
{/* 다시 스캔 버튼 옆에 캐시 정보 */}
{cachedAt && (
  <span className="text-xs text-muted-foreground">
    마지막 스캔: {formatTimeAgo(cachedAt)}
  </span>
)}
<button onClick={() => handleScan(true)}>
  <RefreshCw className="h-3.5 w-3.5" />
  새로고침
</button>
```

**Step 3: formatTimeAgo 유틸 함수 추가**

```typescript
function formatTimeAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '방금 전'
  if (diffMin < 60) return `${diffMin}분 전`
  const diffHr = Math.floor(diffMin / 60)
  return `${diffHr}시간 ${diffMin % 60}분 전`
}
```

**Step 4: idle 상태의 "폴더 스캔 시작" 버튼도 handleScan() 호출 유지**

기존 `onClick={handleScan}` → `onClick={() => handleScan()}` (기본 forceRefresh=false)

**Step 5: 탭 전환 시 이미 스캔 결과가 있으면 바로 selecting 상태로**

```typescript
// 탭 변경 시 folders가 이미 있고 해당 탭이 idle이면 selecting으로 전환
useEffect(() => {
  if (folders.length > 0 && currentTabState.state === 'idle') {
    updateTabState(tab, { state: 'selecting' })
  }
}, [tab]) // tab 변경 시만 실행
```

**Step 6: typecheck 확인**

Run: `npm run typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add src/renderer/pages/TestPage.tsx
git commit -m "feat: show scan cache status and force-refresh button in TestPage"
```

---

## Task 5: IPC 타입 추가 — 실시간 감지 테스트

**Files:**
- Modify: `src/shared/ipc-types.ts`

**Step 1: 실시간 감지 관련 타입 정의**

```typescript
// ── Realtime detection test types ──

export interface RealtimeTestStartRequest {
  /** 감지 시 자동 다운로드 */
  enableDownload: boolean
  /** 감지 시 자동 업로드 */
  enableUpload: boolean
  /** 감지 시 알림 (OS + 앱 내) */
  enableNotification: boolean
  /** 폴링 주기 (ms), 기본 30000 */
  pollingIntervalMs?: number
}

export interface RealtimeTestEvent {
  type: 'started' | 'detecting' | 'detected' | 'downloading' | 'downloaded' | 'uploading' | 'uploaded' | 'error' | 'stopped'
  message: string
  timestamp: string
  fileName?: string
  success?: boolean
  error?: string
}
```

**Step 2: IpcChannelMap에 채널 추가**

```typescript
// IpcChannelMap 내 Test 섹션에 추가:
'test:realtime-start': {
  request: RealtimeTestStartRequest
  response: ApiResponse<void>
}
'test:realtime-stop': {
  request: void
  response: ApiResponse<void>
}
```

**Step 3: IpcEventMap에 이벤트 추가**

```typescript
// IpcEventMap에 추가:
'test:realtime-event': RealtimeTestEvent
```

**Step 4: typecheck 확인**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/shared/ipc-types.ts
git commit -m "feat: add IPC types for realtime detection test"
```

---

## Task 6: ipc-router에 실시간 감지 핸들러 구현

**Files:**
- Modify: `src/main/ipc-router.ts`

**Step 1: 실시간 감지 테스트 상태 변수 추가**

`registerIpcHandlers` 함수 최상단에:

```typescript
let realtimeTestTimer: ReturnType<typeof setInterval> | null = null
let realtimeTestRunning = false
```

**Step 2: test:realtime-start 핸들러 구현**

```typescript
ipcMain.handle('test:realtime-start', async (_event, request: RealtimeTestStartRequest) => {
  try {
    if (realtimeTestRunning) {
      return fail('REALTIME_ALREADY_RUNNING', '실시간 감지가 이미 실행 중입니다.')
    }
    realtimeTestRunning = true
    const intervalMs = request.pollingIntervalMs ?? 30000

    const sendEvent = (evt: RealtimeTestEvent) => {
      _event.sender.send('test:realtime-event', evt)
    }

    sendEvent({
      type: 'started',
      message: `실시간 감지 시작 (주기: ${intervalMs / 1000}초)`,
      timestamp: new Date().toISOString(),
    })

    const poll = async () => {
      if (!realtimeTestRunning) return

      sendEvent({
        type: 'detecting',
        message: '새 파일 감지 중...',
        timestamp: new Date().toISOString(),
      })

      try {
        const detected = await detector.forceCheck()
        if (detected.length === 0) return

        // 알림
        if (request.enableNotification) {
          const { Notification: ElectronNotification } = await import('electron')
          new ElectronNotification({
            title: '새 파일 감지됨',
            body: `${detected.length}개 파일이 감지되었습니다.`,
          }).show()

          notification.notify({
            type: 'info',
            title: '새 파일 감지',
            message: `${detected.length}개 파일이 감지되었습니다.`,
            groupKey: 'realtime-detection',
          })
        }

        for (const file of detected) {
          sendEvent({
            type: 'detected',
            message: `파일 감지: ${file.fileName}`,
            timestamp: new Date().toISOString(),
            fileName: file.fileName,
          })

          if (!request.enableDownload && !request.enableUpload) continue

          // 폴더 매칭
          const dbFolder = state.getFolderByLguplusId(file.folderId)
          if (!dbFolder) continue

          const fileId = state.saveFile({
            folder_id: dbFolder.id,
            file_name: file.fileName,
            file_path: file.filePath,
            file_size: file.fileSize,
            file_extension: file.fileName.split('.').pop() ?? '',
            lguplus_file_id: String(file.historyNo),
            detected_at: new Date().toISOString(),
          })

          // 다운로드
          if (request.enableDownload) {
            sendEvent({
              type: 'downloading',
              message: `다운로드 중: ${file.fileName}`,
              timestamp: new Date().toISOString(),
              fileName: file.fileName,
            })

            const dlResult = await engine.downloadOnly(fileId)
            sendEvent({
              type: 'downloaded',
              message: dlResult.success
                ? `다운로드 완료: ${file.fileName}`
                : `다운로드 실패: ${file.fileName}`,
              timestamp: new Date().toISOString(),
              fileName: file.fileName,
              success: dlResult.success,
              error: dlResult.error,
            })

            if (!dlResult.success) continue
          }

          // 업로드
          if (request.enableUpload) {
            sendEvent({
              type: 'uploading',
              message: `업로드 중: ${file.fileName}`,
              timestamp: new Date().toISOString(),
              fileName: file.fileName,
            })

            const ulResult = await engine.uploadOnly(fileId)
            sendEvent({
              type: 'uploaded',
              message: ulResult.success
                ? `업로드 완료: ${file.fileName}`
                : `업로드 실패: ${file.fileName}`,
              timestamp: new Date().toISOString(),
              fileName: file.fileName,
              success: ulResult.success,
              error: ulResult.error,
            })
          }
        }
      } catch (e) {
        sendEvent({
          type: 'error',
          message: `감지 오류: ${(e as Error).message}`,
          timestamp: new Date().toISOString(),
          error: (e as Error).message,
        })
      }
    }

    // 즉시 1회 실행 + 인터벌
    poll()
    realtimeTestTimer = setInterval(poll, intervalMs)

    return ok(undefined)
  } catch (e) {
    realtimeTestRunning = false
    return fail('REALTIME_START_FAILED', (e as Error).message)
  }
})
```

**Step 3: test:realtime-stop 핸들러 구현**

```typescript
ipcMain.handle('test:realtime-stop', async () => {
  try {
    if (realtimeTestTimer) {
      clearInterval(realtimeTestTimer)
      realtimeTestTimer = null
    }
    realtimeTestRunning = false

    // 정지 이벤트는 직접 send (win 참조 필요)
    win.webContents.send('test:realtime-event', {
      type: 'stopped',
      message: '실시간 감지가 중지되었습니다.',
      timestamp: new Date().toISOString(),
    })

    return ok(undefined)
  } catch (e) {
    return fail('REALTIME_STOP_FAILED', (e as Error).message)
  }
})
```

**Step 4: typecheck 확인**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/ipc-router.ts
git commit -m "feat: implement realtime detection test IPC handlers"
```

---

## Task 7: TestPage에 실시간 감지 탭 UI 구현

**Files:**
- Modify: `src/renderer/pages/TestPage.tsx`

**Step 1: 타입 및 상수 확장**

```typescript
// TestTab 타입 확장:
type TestTab = 'download' | 'upload' | 'full-sync' | 'realtime'

// ALL_TABS 확장:
const ALL_TABS: TestTab[] = ['download', 'upload', 'full-sync', 'realtime']

// import 추가:
import { Radio } from 'lucide-react' // 실시간 감지 아이콘
import type { RealtimeTestEvent } from '../../shared/ipc-types'

// TAB_CONFIG 확장:
realtime: {
  label: '실시간 감지',
  icon: Radio,
  description: '새 파일 감지 시 자동으로 다운로드/업로드를 실행합니다.',
}
```

**Step 2: 실시간 감지 상태 관리**

```typescript
// TestPage 컴포넌트 내부에 상태 추가:
const [realtimeRunning, setRealtimeRunning] = useState(false)
const [realtimeEvents, setRealtimeEvents] = useState<RealtimeTestEvent[]>([])
const [realtimeOptions, setRealtimeOptions] = useState({
  enableDownload: true,
  enableUpload: true,
  enableNotification: true,
})

// 실시간 이벤트 수신
useIpcEvent('test:realtime-event', useCallback((data: RealtimeTestEvent) => {
  setRealtimeEvents((prev) => [data, ...prev].slice(0, 200)) // 최대 200개
  if (data.type === 'stopped') setRealtimeRunning(false)
}, []))
```

**Step 3: 실시간 감지 시작/중지 핸들러**

```typescript
const handleRealtimeStart = useCallback(async () => {
  setRealtimeEvents([])
  const res = await window.electronAPI.invoke('test:realtime-start', {
    ...realtimeOptions,
    pollingIntervalMs: 30000,
  })
  if (res.success) {
    setRealtimeRunning(true)
  }
}, [realtimeOptions])

const handleRealtimeStop = useCallback(async () => {
  await window.electronAPI.invoke('test:realtime-stop')
  setRealtimeRunning(false)
}, [])
```

**Step 4: 실시간 감지 탭 UI 렌더링**

realtime 탭일 때는 기존 상태 머신(idle/scanning/selecting/testing/complete) 대신 별도 UI를 렌더링.

```tsx
{/* Realtime tab */}
{tab === 'realtime' && (
  <div className="flex flex-col gap-4 flex-1 min-h-0">
    {/* Options */}
    <div className="flex items-center gap-6 p-4 rounded-lg border border-border bg-card">
      <span className="text-sm font-medium">감지 시 동작:</span>
      {([
        { key: 'enableDownload', label: '다운로드', icon: Download },
        { key: 'enableUpload', label: '업로드', icon: Upload },
        { key: 'enableNotification', label: '알림', icon: Bell },
      ] as const).map(({ key, label, icon: Icon }) => (
        <label key={key} className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={realtimeOptions[key]}
            onChange={(e) =>
              setRealtimeOptions((prev) => ({ ...prev, [key]: e.target.checked }))
            }
            disabled={realtimeRunning}
            className="rounded border-border"
          />
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm">{label}</span>
        </label>
      ))}
    </div>

    {/* Start/Stop button */}
    <div className="flex items-center gap-3">
      {realtimeRunning ? (
        <button
          type="button"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-error text-error-foreground hover:bg-error/90 transition-colors"
          onClick={handleRealtimeStop}
        >
          <StopCircle className="h-4 w-4" />
          감지 중지
        </button>
      ) : (
        <button
          type="button"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          onClick={handleRealtimeStart}
        >
          <PlayCircle className="h-4 w-4" />
          감지 시작
        </button>
      )}
      {realtimeRunning && (
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
          </span>
          <span className="text-sm text-success">감지 중...</span>
        </div>
      )}
      {realtimeEvents.length > 0 && (
        <button
          type="button"
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setRealtimeEvents([])}
        >
          로그 지우기
        </button>
      )}
    </div>

    {/* Event log */}
    <div className="flex-1 min-h-0 rounded-lg border border-border bg-card overflow-hidden flex flex-col">
      <div className="flex items-center px-4 py-2 border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground">
        <span className="w-20">시간</span>
        <span className="w-20">상태</span>
        <span className="flex-1">메시지</span>
      </div>
      <div className="flex-1 overflow-y-auto font-mono text-xs">
        {realtimeEvents.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
            {realtimeRunning ? '새 파일 감지 대기 중...' : '감지를 시작하면 로그가 여기에 표시됩니다'}
          </div>
        ) : (
          realtimeEvents.map((evt, idx) => (
            <div
              key={idx}
              className="flex items-center px-4 py-1.5 border-b border-border/30 hover:bg-accent/30"
            >
              <span className="w-20 shrink-0 text-muted-foreground">
                {new Date(evt.timestamp).toLocaleTimeString('ko-KR')}
              </span>
              <span className={cn('w-20 shrink-0', getEventColor(evt.type))}>
                {getEventLabel(evt.type)}
              </span>
              <span className="flex-1 truncate">{evt.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  </div>
)}
```

**Step 5: 이벤트 타입 라벨/색상 헬퍼 함수 추가**

```typescript
function getEventColor(type: RealtimeTestEvent['type']): string {
  switch (type) {
    case 'started': return 'text-info'
    case 'detecting': return 'text-muted-foreground'
    case 'detected': return 'text-warning'
    case 'downloading': case 'uploading': return 'text-info'
    case 'downloaded': case 'uploaded': return 'text-success'
    case 'error': return 'text-error'
    case 'stopped': return 'text-muted-foreground'
    default: return 'text-foreground'
  }
}

function getEventLabel(type: RealtimeTestEvent['type']): string {
  switch (type) {
    case 'started': return '시작'
    case 'detecting': return '감지중'
    case 'detected': return '감지됨'
    case 'downloading': return '다운로드'
    case 'downloaded': return '완료'
    case 'uploading': return '업로드'
    case 'uploaded': return '완료'
    case 'error': return '오류'
    case 'stopped': return '중지'
    default: return type
  }
}
```

**Step 6: import 추가 확인**

```typescript
// lucide-react에서 추가 import:
import { Bell, Radio, StopCircle } from 'lucide-react'
```

**Step 7: realtime 탭일 때 기존 idle/scanning/selecting/testing/complete 렌더링 스킵**

기존 상태별 렌더링 블록에 `tab !== 'realtime'` 조건 추가:

```tsx
{tab !== 'realtime' && state === 'idle' && ( ... )}
{tab !== 'realtime' && state === 'scanning' && ( ... )}
{tab !== 'realtime' && state === 'selecting' && ( ... )}
{tab !== 'realtime' && state === 'testing' && ( ... )}
{tab !== 'realtime' && state === 'complete' && summary && ( ... )}
```

**Step 8: typecheck 확인**

Run: `npm run typecheck`
Expected: PASS

**Step 9: Commit**

```bash
git add src/renderer/pages/TestPage.tsx
git commit -m "feat: add realtime detection test tab with start/stop and event log"
```

---

## Task 8: 통합 테스트 및 최종 검증

**Step 1: 전체 typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 2: 전체 lint**

Run: `npm run lint`
Expected: PASS (또는 경고만)

**Step 3: 단위 테스트**

Run: `npm run test`
Expected: 기존 테스트 모두 PASS

**Step 4: 수동 검증 체크리스트**

- [ ] TestPage 다운로드 탭에서 폴더 스캔 → 결과 캐시됨
- [ ] 업로드 탭으로 전환 시 스캔 없이 바로 폴더 목록 표시
- [ ] 전체 동기화 탭으로 전환 시에도 동일
- [ ] "새로고침" 버튼 클릭 시 캐시 무시하고 재스캔
- [ ] 30분 경과 후 스캔 시 캐시 미스로 재스캔 실행
- [ ] "마지막 스캔: N분 전" 표시 정상
- [ ] 실시간 감지 탭: 시작/중지 토글 동작
- [ ] 체크박스 3개(다운로드/업로드/알림) 개별 ON/OFF
- [ ] 실시간 감지 중 이벤트 로그 표시
- [ ] OS 알림 팝업 표시 (enableNotification 체크 시)
- [ ] 앱 내 알림 생성 확인

**Step 5: Commit (lint/format 수정 사항 있으면)**

```bash
git add -A
git commit -m "chore: fix lint and format for shared scan cache + realtime detection"
```
