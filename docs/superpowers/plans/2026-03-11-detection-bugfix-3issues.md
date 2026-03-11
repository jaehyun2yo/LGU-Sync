# 실시간 감지 버그 3건 수정 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실시간 감지 페이지의 3가지 버그를 수정: (1) 통계 카드 영속 표시, (2) GUEST 경로 제거, (3) 시작 시 기존 파일 감지

**Architecture:** detection-store에서 status→running 전환 시 stats 초기화, sync-engine의 getPathSegments에서 GUEST 세그먼트 필터링, FileDetector의 baseline 로직에서 첫 실행 시 기존 파일도 감지하도록 변경

**Tech Stack:** TypeScript, Zustand, Vitest

---

## Chunk 1: 통계 카드 영속 표시 (Bug #1)

### 문제 분석

스크린샷에서 감지 10건, 완료 0건, 실패 6건이 표시되지만, 감지가 시작되고 첫 이벤트가 발생하기 전까지 `currentSessionStats`가 `null`이어서 통계 카드가 보이지 않는다.

**근본 원인:**
- `detection-store.ts:207-209` — `handleStatusChanged`에서 status가 `running`으로 바뀔 때 `currentSessionStats`를 초기화하지 않음
- `detection-store.ts:186` — `handleDetectionEvent`에서 `event.stats && currentSessionStats`를 모두 체크하므로, `currentSessionStats`가 null이면 stats가 있어도 업데이트 안 됨

**수정 방향:**
- `handleStatusChanged`에서 `running` 상태로 전환 시 `currentSessionStats`를 0으로 초기화
- `handleDetectionEvent`에서 `currentSessionStats`가 null이어도 stats가 있으면 초기화

### Task 1: detection-store stats 초기화 수정

**Files:**
- Modify: `src/renderer/stores/detection-store.ts:199-221` (handleStatusChanged)
- Modify: `src/renderer/stores/detection-store.ts:171-197` (handleDetectionEvent)
- Test: `tests/renderer/detection-store.test.ts` (신규)

- [ ] **Step 1: 테스트 파일 생성**

`tests/renderer/detection-store.test.ts` 생성:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDetectionStore } from '../../src/renderer/stores/detection-store'

// window.electronAPI mock
vi.stubGlobal('window', {
  electronAPI: {
    invoke: vi.fn().mockResolvedValue({ success: true, data: null }),
    on: vi.fn().mockReturnValue(() => {}),
    off: vi.fn(),
  },
})

describe('detection-store stats', () => {
  beforeEach(() => {
    // 스토어 초기화
    useDetectionStore.setState({
      status: 'stopped',
      currentSessionStats: null,
      currentSessionId: null,
      events: [],
      startingStep: null,
    })
  })

  it('should initialize currentSessionStats when status changes to running', () => {
    const store = useDetectionStore.getState()
    store.handleStatusChanged({ status: 'running', sessionId: 'sess-1' })

    const state = useDetectionStore.getState()
    expect(state.currentSessionStats).not.toBeNull()
    expect(state.currentSessionStats?.filesDetected).toBe(0)
    expect(state.currentSessionStats?.filesDownloaded).toBe(0)
    expect(state.currentSessionStats?.filesFailed).toBe(0)
    expect(state.currentSessionStats?.startedAt).toBeTruthy()
  })

  it('should clear currentSessionStats when status changes to stopped', () => {
    // 먼저 running 상태로 설정
    useDetectionStore.setState({
      status: 'running',
      currentSessionStats: {
        filesDetected: 5,
        filesDownloaded: 3,
        filesFailed: 2,
        startedAt: new Date().toISOString(),
      },
    })

    const store = useDetectionStore.getState()
    store.handleStatusChanged({ status: 'stopped', sessionId: null })

    const state = useDetectionStore.getState()
    expect(state.currentSessionStats).toBeNull()
  })

  it('should update stats from event even when currentSessionStats was null', () => {
    // currentSessionStats가 null인 상태에서 stats가 포함된 이벤트 수신
    const store = useDetectionStore.getState()
    store.handleDetectionEvent({
      type: 'detected',
      message: '업로드 감지됨',
      timestamp: new Date().toISOString(),
      fileName: 'test.dxf',
      stats: { filesDetected: 1, filesDownloaded: 0, filesFailed: 0 },
    })

    const state = useDetectionStore.getState()
    expect(state.currentSessionStats).not.toBeNull()
    expect(state.currentSessionStats?.filesDetected).toBe(1)
  })

  it('should update existing stats from event', () => {
    useDetectionStore.setState({
      currentSessionStats: {
        filesDetected: 3,
        filesDownloaded: 1,
        filesFailed: 0,
        startedAt: new Date().toISOString(),
      },
    })

    const store = useDetectionStore.getState()
    store.handleDetectionEvent({
      type: 'downloaded',
      message: '동기화 완료',
      timestamp: new Date().toISOString(),
      fileName: 'test.dxf',
      stats: { filesDetected: 3, filesDownloaded: 2, filesFailed: 0 },
    })

    const state = useDetectionStore.getState()
    expect(state.currentSessionStats?.filesDownloaded).toBe(2)
  })
})
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run tests/renderer/detection-store.test.ts`
Expected: 'should initialize currentSessionStats when status changes to running' FAIL, 'should update stats from event even when currentSessionStats was null' FAIL

- [ ] **Step 3: handleStatusChanged 수정 — running 시 stats 초기화**

`src/renderer/stores/detection-store.ts` — `handleStatusChanged` 함수 수정:

```typescript
  handleStatusChanged: (event) => {
    set((state) => {
      const updates: Partial<DetectionState> = {
        status: event.status,
        currentSessionId: event.sessionId,
      }

      // 시작 완료 시 startingStep 리셋 + stats 항상 초기화 (클린 스타트 보장)
      if (event.status === 'running') {
        updates.startingStep = null
        updates.currentSessionStats = {
          filesDetected: 0,
          filesDownloaded: 0,
          filesFailed: 0,
          startedAt: new Date().toISOString(),
        }
      }

      // 감지가 종료되면 세션 목록 새로고침
      if (event.status === 'stopped') {
        updates.currentSessionStats = null
        updates.startingStep = null
        // 비동기로 세션 목록 갱신
        get().fetchSessions()
      }

      return updates
    })
  },
```

- [ ] **Step 4: handleDetectionEvent 수정 — null stats 허용**

`src/renderer/stores/detection-store.ts` — `handleDetectionEvent` 함수의 stats 업데이트 부분 수정:

```typescript
      // stats가 제공되면 세션 통계 업데이트 (currentSessionStats가 null이어도 초기화)
      if (event.stats) {
        currentSessionStats = {
          ...(currentSessionStats ?? { startedAt: new Date().toISOString() }),
          filesDetected: event.stats.filesDetected,
          filesDownloaded: event.stats.filesDownloaded,
          filesFailed: event.stats.filesFailed,
        }
      }
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `npx vitest run tests/renderer/detection-store.test.ts`
Expected: ALL PASS

- [ ] **Step 6: 커밋**

```bash
git add src/renderer/stores/detection-store.ts tests/renderer/detection-store.test.ts
git commit -m "fix: initialize detection stats on status=running to persist stats cards"
```

---

## Chunk 2: GUEST 경로 제거 (Bug #2)

### 문제 분석

LGU+ 웹하드 API가 반환하는 경로에 `GUEST`라는 중간 폴더가 포함됨. 예: `/올리기전용/GUEST/업체A/파일.dxf`. 다운로드 시 이 경로 그대로 사용하면 로컬 폴더 구조가 잘못됨.

**영향 받는 코드 2곳:**
1. `sync-engine.ts:738-742` — `getPathSegments()`: 다운로드/업로드 경로 생성
2. `file-detector.ts:242-263` — `resolveFolderPath()`: 감지 시 폴더 경로 해결

**수정 방향:**
- `getPathSegments()`에서 `GUEST` 세그먼트를 필터링
- `resolveFolderPath()`에서도 동일하게 `GUEST` 제거

### Task 2: GUEST 경로 세그먼트 필터링

**Files:**
- Modify: `src/core/sync-engine.ts:738-742` (getPathSegments)
- Modify: `src/core/file-detector.ts:242-263` (resolveFolderPath)
- Test: `tests/core/sync-engine.test.ts` (기존 파일에 추가)
- Test: `tests/core/file-detector.test.ts` (기존 파일에 추가)

- [ ] **Step 1: sync-engine 테스트 추가**

`tests/core/sync-engine.test.ts`에 GUEST 필터링 테스트 추가:

```typescript
describe('getPathSegments GUEST filtering', () => {
  it('should remove GUEST segment from path', () => {
    // getPathSegments는 private이므로 downloadOnly 경로로 간접 검증
    // 또는 리팩토링하여 테스트 가능하게 만들기
    const segments = '/올리기전용/GUEST/업체A/파일.dxf'
      .split(/[/\\]/)
      .filter(Boolean)
      .filter((s) => s !== 'GUEST')
      .slice(0, -1) // exclude filename
    expect(segments).toEqual(['올리기전용', '업체A'])
  })

  it('should handle path without GUEST', () => {
    const segments = '/올리기전용/업체A/파일.dxf'
      .split(/[/\\]/)
      .filter(Boolean)
      .filter((s) => s !== 'GUEST')
      .slice(0, -1)
    expect(segments).toEqual(['올리기전용', '업체A'])
  })

  it('should handle path with only GUEST', () => {
    const segments = '/GUEST/파일.dxf'
      .split(/[/\\]/)
      .filter(Boolean)
      .filter((s) => s !== 'GUEST')
      .slice(0, -1)
    expect(segments).toEqual([])
  })
})
```

- [ ] **Step 2: file-detector 테스트 추가**

`tests/core/file-detector.test.ts`에 GUEST 경로 필터링 테스트 추가 — `resolveFolderPath`는 private이므로 `cleanFolderPath` 유틸 함수로 추출 후 테스트:

```typescript
// src/core/file-detector.ts에서 export할 유틸 함수 (resolveFolderPath 내부 로직)
import { cleanFolderPath } from '../../src/core/file-detector'

describe('cleanFolderPath GUEST filtering', () => {
  it('should remove GUEST from folder path', () => {
    expect(cleanFolderPath('/올리기전용/GUEST/업체A')).toBe('/올리기전용/업체A/')
  })

  it('should handle path without GUEST', () => {
    expect(cleanFolderPath('/올리기전용/업체A')).toBe('/올리기전용/업체A/')
  })

  it('should handle GUEST-only path', () => {
    expect(cleanFolderPath('/GUEST')).toBe('/')
  })

  it('should handle root path', () => {
    expect(cleanFolderPath('/')).toBe('/')
  })

  it('should preserve trailing slash', () => {
    expect(cleanFolderPath('/올리기전용/업체A/')).toBe('/올리기전용/업체A/')
  })

  it('should not remove lowercase guest (could be company name)', () => {
    expect(cleanFolderPath('/올리기전용/guest/업체A')).toBe('/올리기전용/guest/업체A/')
  })
})
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

Run: `npx vitest run tests/core/sync-engine.test.ts tests/core/file-detector.test.ts`

- [ ] **Step 4: sync-engine getPathSegments 수정**

`src/core/sync-engine.ts` — `getPathSegments` 메서드 수정:

```typescript
  /** LGU+ 웹하드 경로 중 불필요한 중간 폴더(GUEST 등)를 제거 */
  private static readonly EXCLUDED_PATH_SEGMENTS = new Set(['GUEST'])

  private getPathSegments(filePath: string): string[] {
    // forward + backward slash 모두 분리 (Windows 혼합 경로 대응)
    const parts = filePath.split(/[/\\]/).filter(Boolean)
    return parts
      .slice(0, -1) // exclude filename
      .filter((seg) => !SyncEngine.EXCLUDED_PATH_SEGMENTS.has(seg))
  }
```

- [ ] **Step 5: file-detector에 cleanFolderPath 유틸 추출 + resolveFolderPath 수정**

`src/core/file-detector.ts` — 경로 클리닝 로직을 export 유틸로 추출하고 resolveFolderPath에서 활용:

```typescript
/** LGU+ 웹하드 경로에서 불필요한 중간 폴더(GUEST 등)를 제거하는 유틸 */
const EXCLUDED_PATH_SEGMENTS = new Set(['GUEST'])

export function cleanFolderPath(folderPath: string): string {
  const segments = folderPath
    .split('/')
    .filter((seg) => seg !== '' && !EXCLUDED_PATH_SEGMENTS.has(seg))
  if (segments.length === 0) return '/'
  return `/${segments.join('/')}/`
}
```

`resolveFolderPath` 메서드 수정:

```typescript
  private resolveFolderPath(item: UploadHistoryItem): string {
    const apiPath = item.itemFolderFullpath?.trim()

    // API 경로가 유효하면 사용 (루트 "/" 만 있는 경우 제외)
    if (apiPath && apiPath !== '/') {
      return cleanFolderPath(apiPath)
    }

    // DB에서 폴더 경로 조회
    const folder = this.state.getFolderByLguplusId(String(item.itemFolderId))
    if (folder?.lguplus_folder_path) {
      return cleanFolderPath(folder.lguplus_folder_path)
    }

    // 폴백: 루트 경로 사용
    this.logger.warn('Could not resolve folder path, using root', {
      folderId: item.itemFolderId,
      apiPath: item.itemFolderFullpath,
    })
    return '/'
  }
```

- [ ] **Step 6: 테스트 실행 → 통과 확인**

Run: `npx vitest run tests/core/sync-engine.test.ts tests/core/file-detector.test.ts`
Expected: ALL PASS

- [ ] **Step 7: typecheck 확인**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 8: 커밋**

```bash
git add src/core/sync-engine.ts src/core/file-detector.ts tests/core/sync-engine.test.ts tests/core/file-detector.test.ts
git commit -m "fix: remove GUEST folder segment from download/detection paths"
```

---

## Chunk 3: 시작 시 기존 파일 감지 (Bug #3)

### 문제 분석

`FileDetector.pollForFiles()` 첫 실행 시 `last_history_no`가 null이면 baseline을 설정하고 **빈 배열을 반환**한다 (`file-detector.ts:115-123`). 이로 인해 감지 시작 전 이미 올라와 있던 파일은 영원히 감지되지 않음.

**사용자 시나리오:**
1. 거래처가 파일을 LGU+ 웹하드에 업로드
2. 사용자가 "감지 시작" 클릭
3. baseline이 방금 업로드된 파일의 historyNo로 설정됨
4. 해당 파일은 이미 baseline 이하이므로 감지 안 됨

**수정 방향:**
- `DetectionService.start()`에서 **`manual` 시작 시** baseline 이전 파일도 감지하는 옵션 추가
- `FileDetector`에 `pollWithBaseline()` 메서드 추가: 첫 실행 시 baseline을 설정하면서 동시에 감지된 파일을 반환
- `auto-start` 시에는 기존 동작 유지 (이미 다운타임 복구 로직이 있음)

### Task 3: 첫 실행 시 기존 파일 감지

**Files:**
- Modify: `src/core/file-detector.ts:108-124` (pollForFiles baseline 로직)
- Modify: `src/core/types/file-detector.types.ts` (IFileDetector 인터페이스)
- Modify: `src/core/detection-service.ts:78-150` (start에서 초기 감지 실행)
- Test: `tests/core/file-detector.test.ts` (기존 파일에 추가)

- [ ] **Step 1: file-detector 테스트 추가 — 첫 실행 시 파일 감지**

`tests/core/file-detector.test.ts`에 추가 (기존 mock 구조 활용):

```typescript
describe('first poll with initial detection', () => {
  // 이 테스트들은 FileDetector를 직접 인스턴스화하여 검증
  // mockClient, mockState, mockEventBus, mockLogger는 기존 테스트에서 사용하는 mock 재활용

  it('should detect existing files on first poll when setIncludeExistingOnFirstPoll called', async () => {
    // Setup: last_history_no checkpoint가 null (첫 실행)
    mockState.getCheckpoint.mockReturnValue(null)
    // Setup: 기존 파일 3개 반환
    mockClient.getUploadHistory.mockResolvedValue({
      items: [
        { historyNo: 100, itemSrcNo: 'f1', itemSrcName: 'a', itemSrcExtension: 'dxf', itemFolderId: 1, itemFolderFullpath: '/올리기전용/업체A', itemOperCode: 'UP', itemRegDate: '2026-03-11' },
        { historyNo: 101, itemSrcNo: 'f2', itemSrcName: 'b', itemSrcExtension: 'dxf', itemFolderId: 1, itemFolderFullpath: '/올리기전용/업체A', itemOperCode: 'UP', itemRegDate: '2026-03-11' },
        { historyNo: 102, itemSrcNo: 'f3', itemSrcName: 'c', itemSrcExtension: 'dxf', itemFolderId: 1, itemFolderFullpath: '/올리기전용/업체A', itemOperCode: 'DN', itemRegDate: '2026-03-11' },
      ],
      total: 3,
      pageSize: 20,
    })

    detector.setIncludeExistingOnFirstPoll()
    const result = await detector.forceCheck()

    // DN은 제외되므로 2개만 감지
    expect(result).toHaveLength(2)
    // baseline은 max historyNo(102)로 설정
    expect(mockState.saveCheckpoint).toHaveBeenCalledWith('last_history_no', '102')
  })

  it('should skip existing files on first poll by default', async () => {
    mockState.getCheckpoint.mockReturnValue(null)
    mockClient.getUploadHistory.mockResolvedValue({
      items: [
        { historyNo: 100, itemSrcNo: 'f1', itemSrcName: 'a', itemSrcExtension: 'dxf', itemFolderId: 1, itemFolderFullpath: '/올리기전용', itemOperCode: 'UP', itemRegDate: '2026-03-11' },
      ],
      total: 1,
      pageSize: 20,
    })

    // setIncludeExistingOnFirstPoll를 호출하지 않음 → 기본 동작
    const result = await detector.forceCheck()

    expect(result).toHaveLength(0) // baseline만 설정, 파일 감지 안 함
    expect(mockState.saveCheckpoint).toHaveBeenCalledWith('last_history_no', '100')
  })

  it('should reset includeExisting flag after first use (1회성)', async () => {
    mockState.getCheckpoint
      .mockReturnValueOnce(null)  // 첫 번째 poll: null → baseline
      .mockReturnValue('100')     // 두 번째 poll: 정상

    mockClient.getUploadHistory.mockResolvedValue({
      items: [{ historyNo: 100, itemSrcNo: 'f1', itemSrcName: 'a', itemSrcExtension: 'dxf', itemFolderId: 1, itemFolderFullpath: '/올리기전용', itemOperCode: 'UP', itemRegDate: '2026-03-11' }],
      total: 1, pageSize: 20,
    })

    detector.setIncludeExistingOnFirstPoll()
    await detector.forceCheck() // 1회차: 기존 파일 감지

    // 2회차: 플래그 리셋됨 → 정상 폴링
    mockClient.getUploadHistory.mockResolvedValue({ items: [], total: 0, pageSize: 20 })
    const result2 = await detector.forceCheck()
    expect(result2).toHaveLength(0) // 정상 동작
  })
})
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run tests/core/file-detector.test.ts`

- [ ] **Step 3: FileDetector에 includeExisting 옵션 추가**

`src/core/file-detector.ts` — `FileDetectorOptions` 및 `pollForFiles` 수정:

```typescript
export interface FileDetectorOptions {
  pollingIntervalMs?: number
}
```

`pollForFiles` 메서드의 baseline 분기 수정 (line 114-123):

```typescript
  private async pollForFiles(): Promise<DetectedFile[]> {
    if (this.isPolling) return []
    this.isPolling = true
    try {
      const lastHistoryNo = this.state.getCheckpoint('last_history_no')

      // Baseline: 첫 실행 시
      if (lastHistoryNo === null) {
        const firstPage = await this.client.getUploadHistory({ operCode: '', page: 1 })
        const maxNo = firstPage.items.length > 0
          ? Math.max(...firstPage.items.map((i) => i.historyNo))
          : 0
        this.state.saveCheckpoint('last_history_no', String(maxNo))
        this.logger.info('Polling baseline established', { maxHistoryNo: maxNo })

        // _includeExistingOnFirstPoll 플래그가 설정되었으면 기존 파일도 감지
        if (this._includeExistingOnFirstPoll && firstPage.items.length > 0) {
          this._includeExistingOnFirstPoll = false // 1회성
          const validItems = firstPage.items.filter(
            (item) => !EXCLUDED_OPER_CODES.has(item.itemOperCode),
          )
          if (validItems.length > 0) {
            const detectedFiles = validItems.map((item) => this.toDetectedFile(item))
            this.notifyDetection(detectedFiles, 'polling')
            this.logger.info(`Initial detection: ${detectedFiles.length} existing files`, {
              count: detectedFiles.length,
            })
            this.onPollSuccess()
            return detectedFiles
          }
        }

        this.onPollSuccess()
        return []
      }

      // ... 이후 기존 코드 동일
```

`FileDetector` 클래스에 필드 및 메서드 추가 — `_isRunning` 필드 아래(line 40)에 선언:

```typescript
  // line 40: private _isRunning = false 아래에 추가
  private _includeExistingOnFirstPoll = false
```

`isRunning` getter 아래(line 92)에 public 메서드 추가:

```typescript
  /** 다음 첫 폴링에서 기존 파일도 감지하도록 설정 (1회성) */
  setIncludeExistingOnFirstPoll(): void {
    this._includeExistingOnFirstPoll = true
  }
```

- [ ] **Step 4: IFileDetector 인터페이스 업데이트**

`src/core/types/file-detector.types.ts` — `IFileDetector`에 메서드 추가:

```typescript
export interface IFileDetector {
  start(): void
  stop(): void
  forceCheck(): Promise<DetectedFile[]>
  onFilesDetected(handler: DetectionHandler): () => void
  setPollingInterval(intervalMs: number): void
  readonly isRunning: boolean
  /** 다음 첫 폴링에서 기존 파일도 감지하도록 설정 (1회성) */
  setIncludeExistingOnFirstPoll(): void
}
```

- [ ] **Step 5: DetectionService.start()에서 초기 감지 플래그 설정**

`src/core/detection-service.ts` — `start()` 메서드에서 SyncEngine 시작 전에 플래그 설정:

기존 step 5 (SyncEngine 시작) 직전에 삽입 — `detection-service.ts:128` 부근:

```typescript
      // 4-1. manual 시작이고 첫 실행(checkpoint 없음)이면 기존 파일도 감지
      if (source === 'manual') {
        const checkpoint = this.state.getCheckpoint('last_history_no')
        if (checkpoint === null) {
          this.detector.setIncludeExistingOnFirstPoll()
        }
      }

      // 5. SyncEngine 시작 (이미 running이면 skip) — 기존 코드 그대로
      this.eventBus.emit('detection:start-progress', {
        step: 'engine', message: '감지 엔진 시작 중...', current: ++currentStep, total: totalSteps,
      })
      if (this.engine.status !== 'syncing') {
        await this.engine.start()
      }
```

- [ ] **Step 6: 테스트 실행 → 통과 확인**

Run: `npx vitest run tests/core/file-detector.test.ts`
Expected: ALL PASS

- [ ] **Step 7: 전체 테스트 + typecheck**

Run: `npm run typecheck && npm run test`
Expected: ALL PASS, no type errors

- [ ] **Step 8: 커밋**

```bash
git add src/core/file-detector.ts src/core/detection-service.ts src/core/types/file-detector.types.ts tests/core/file-detector.test.ts
git commit -m "feat: detect existing files on manual detection start (first poll)"
```

---

## 주의사항

### GUEST 경로 필터링 범위
- `GUEST`는 LGU+ 웹하드 시스템의 중간 폴더로, **대소문자 정확히 `GUEST`만** 제거
- `guest`, `Guest` 등은 실제 업체명일 수 있으므로 제거하지 않음
- 향후 추가 제거 대상이 있으면 `EXCLUDED_PATH_SEGMENTS` Set에 추가

### 기존 파일 감지 범위
- `manual` 시작 + 첫 실행(checkpoint 없음)일 때만 기존 파일 감지
- `auto-start`는 다운타임 복구 로직(`checkAndRecover`)이 이미 처리
- 첫 페이지(20건)만 감지 — 전체 히스토리를 불필요하게 스캔하지 않음
- 1회성 플래그로 이후 폴링은 정상 동작

### 테스트 mock 호환성
- `IFileDetector` 인터페이스에 `setIncludeExistingOnFirstPoll` 추가
- 기존 mock(`sync-engine.test.ts:22-38`, `pipeline-integration.test.ts:34-56`)은 모두 `as any` 캐스팅 사용 → TypeScript 오류 없음
- 새로 추가되는 file-detector 테스트에서는 실제 FileDetector 인스턴스를 사용하므로 mock 불필요
