# Snapshot Detection Strategy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** FileDetector에 snapshot 기반 감지 전략을 추가하여 거래처(게스트) 업로드를 포함한 모든 외부웹하드 변동을 실시간 감지할 수 있게 한다.

**Architecture:** 기존 FileDetector에 `snapshot` 전략을 추가한다. 폴링 주기마다 등록된 폴더의 파일 목록(`getFileList`)을 조회하고, DB의 기존 파일 목록과 비교하여 신규/삭제/수정 파일을 감지한다. 기존 `polling`(history 기반) 전략은 유지하되, `snapshot` 전략을 기본으로 전환한다.

**Tech Stack:** TypeScript, Vitest, 기존 ILGUplusClient/IStateManager 인터페이스

---

## 현재 문제 분석 (tests/core/file-detector-limitations.test.ts)

| 한계 | 원인 | 영향 |
|------|------|------|
| 거래처 업로드 미감지 | `getUploadHistory()`는 로그인 유저 이력만 반환 | 핵심 용도 불가 |
| 20개 초과 누락 | page 1만 조회, checkpoint가 max로 갱신 | 대량 업로드 시 파일 손실 |
| 삭제/이동 미감지 | operCode='UP'만 필터링 | 삭제된 파일이 DB에 잔존 |
| snapshot 미구현 | DetectionStrategy에 타입만 존재 | 폴더 내용 비교 불가 |

## 해결 전략

```
[기존] polling: getUploadHistory() → historyNo 비교 → 자기 업로드만 감지
[신규] snapshot: getFileList(folderId) → DB 파일목록과 비교 → 모든 변동 감지
```

**하이브리드 구조:**
- `snapshot` 전략을 주 감지 메커니즘으로 사용 (모든 변동 감지)
- `polling` 전략은 보조적으로 유지 (빠른 감지, 선택적)
- FileDetector가 설정에 따라 전략을 선택할 수 있도록 확장

---

### Task 1: Snapshot 비교 로직 단위 테스트 작성

**Files:**
- Create: `tests/core/snapshot-detector.test.ts`

**Step 1: 신규 파일 감지 테스트 작성**

```typescript
// tests/core/snapshot-detector.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// snapshot 비교 함수: 현재 폴더 파일 목록 vs DB 파일 목록 → 신규/삭제 파일 반환
// 이 함수는 아직 미구현 → 테스트 먼저 작성 (TDD)

import type { LGUplusFileItem } from '../../src/core/types/lguplus-client.types'
import type { DetectedFile } from '../../src/core/types/events.types'

// 테스트 대상 함수 시그니처 (아직 미구현)
// diffSnapshot(currentFiles: LGUplusFileItem[], knownFileIds: Set<number>, folderId: string): SnapshotDiff
interface SnapshotDiff {
  newFiles: DetectedFile[]
  deletedFileIds: number[]
}

describe('Snapshot 비교 로직', () => {
  it('폴더에 새 파일이 있으면 newFiles로 반환한다', () => {
    // ...
  })

  it('DB에는 있지만 폴더에 없는 파일은 deletedFileIds로 반환한다', () => {
    // ...
  })

  it('이미 알려진 파일은 신규로 감지하지 않는다', () => {
    // ...
  })

  it('빈 폴더는 빈 결과를 반환한다', () => {
    // ...
  })
})
```

**Step 2: 테스트 실행하여 실패 확인**

Run: `npx vitest run tests/core/snapshot-detector.test.ts`
Expected: FAIL — `diffSnapshot` 미존재

**Step 3: Commit**

```bash
git add tests/core/snapshot-detector.test.ts
git commit -m "test: add failing tests for snapshot detection diff logic"
```

---

### Task 2: diffSnapshot 비교 함수 구현

**Files:**
- Create: `src/core/snapshot-diff.ts`
- Modify: `tests/core/snapshot-detector.test.ts` — import 경로 추가

**Step 1: diffSnapshot 함수 구현**

```typescript
// src/core/snapshot-diff.ts
import type { LGUplusFileItem } from './types/lguplus-client.types'
import type { DetectedFile } from './types/events.types'

export interface SnapshotDiff {
  newFiles: DetectedFile[]
  deletedFileIds: number[]
}

/**
 * 현재 폴더 파일 목록과 이미 알려진 파일 ID 집합을 비교하여
 * 신규 파일과 삭제된 파일을 반환한다.
 */
export function diffSnapshot(
  currentFiles: LGUplusFileItem[],
  knownFileIds: Set<number>,
  folderId: string,
): SnapshotDiff {
  const currentFileIds = new Set(currentFiles.map((f) => f.itemId))

  // 신규 파일: 현재 폴더에 있지만 DB에 없는 파일
  const newFiles: DetectedFile[] = currentFiles
    .filter((f) => !f.isFolder && !knownFileIds.has(f.itemId))
    .map((f) => ({
      fileName: f.itemName,
      filePath: f.relativePath
        ? `${f.relativePath}/${f.itemName}`
        : f.itemName,
      fileSize: f.itemSize,
      folderId,
    }))

  // 삭제된 파일: DB에 있지만 현재 폴더에 없는 파일
  const deletedFileIds = [...knownFileIds].filter((id) => !currentFileIds.has(id))

  return { newFiles, deletedFileIds }
}
```

**Step 2: 테스트 통과 확인**

Run: `npx vitest run tests/core/snapshot-detector.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/core/snapshot-diff.ts tests/core/snapshot-detector.test.ts
git commit -m "feat: implement diffSnapshot for folder content comparison"
```

---

### Task 3: FileDetector에 snapshot 전략 추가

**Files:**
- Modify: `src/core/file-detector.ts` — snapshot 폴링 메서드 추가
- Modify: `src/core/types/file-detector.types.ts` — 옵션 타입 확장

**Step 1: 기존 테스트가 깨지지 않는지 확인**

Run: `npx vitest run tests/core/file-detector.test.ts`
Expected: PASS

**Step 2: FileDetector 옵션에 strategy 추가**

```typescript
// src/core/file-detector.ts (수정)

export interface FileDetectorOptions {
  pollingIntervalMs?: number
  strategy?: 'polling' | 'snapshot'  // 추가
}
```

**Step 3: snapshot 폴링 메서드 구현**

FileDetector에 `pollBySnapshot()` 메서드를 추가한다:
- `state.getFolders(true)`로 감시 대상 폴더 목록 조회
- 각 폴더에 대해 `client.getFileList(folderId)` 호출
- DB의 기존 파일 목록과 `diffSnapshot()` 비교
- 신규 파일을 `DetectedFile[]`로 반환

```typescript
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
      this.logger.info(`Snapshot detected ${allDetected.length} new files`)
    }

    return allDetected
  } catch (error) {
    this.logger.error('Snapshot polling failed', error as Error)
    return []
  }
}
```

**Step 4: start()에서 strategy에 따라 분기**

```typescript
start(): void {
  if (this.pollingTimer) return

  const pollFn = this.strategy === 'snapshot'
    ? () => this.pollBySnapshot()
    : () => this.pollForFiles()

  pollFn()
  this.pollingTimer = setInterval(pollFn, this.pollingIntervalMs)
}
```

**Step 5: 기존 테스트 + 새 테스트 실행**

Run: `npx vitest run tests/core/file-detector.test.ts tests/core/snapshot-detector.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/core/file-detector.ts src/core/types/file-detector.types.ts
git commit -m "feat: add snapshot detection strategy to FileDetector"
```

---

### Task 4: Snapshot 전략 통합 테스트 작성

**Files:**
- Create: `tests/core/file-detector-snapshot.test.ts`

**Step 1: snapshot 전략 통합 테스트 작성**

```typescript
// tests/core/file-detector-snapshot.test.ts
describe('FileDetector - snapshot 전략', () => {
  it('snapshot 전략으로 시작하면 getFileList를 호출한다', async () => {
    // strategy: 'snapshot'으로 FileDetector 생성
    // forceCheck() 호출
    // getFileList가 호출되었는지 확인
    // getUploadHistory는 호출되지 않았는지 확인
  })

  it('폴더에 새 파일이 있으면 감지하여 핸들러를 호출한다', async () => {
    // mockClient.getFileList → 파일 1개 반환
    // mockState.getFilesByFolder → 빈 배열 (기존 파일 없음)
    // forceCheck() → 1개 감지
  })

  it('이미 DB에 있는 파일은 중복 감지하지 않는다', async () => {
    // mockClient.getFileList → 파일 1개 반환
    // mockState.getFilesByFolder → 같은 파일 ID 반환
    // forceCheck() → 0개 감지
  })

  it('게스트가 업로드한 파일도 정상적으로 감지한다', async () => {
    // 핵심 시나리오: history API에는 안 나오지만 폴더에는 파일이 있음
    // strategy: 'snapshot'
    // getFileList → 거래처 업로드 파일 반환
    // forceCheck() → 감지됨!
  })

  it('strategy를 snapshot으로 설정하면 EventBus에 snapshot strategy로 발행한다', async () => {
    // eventBus.on('detection:found', handler)
    // forceCheck()
    // handler가 strategy: 'snapshot'으로 호출되었는지 확인
  })
})
```

**Step 2: 테스트 실행**

Run: `npx vitest run tests/core/file-detector-snapshot.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/core/file-detector-snapshot.test.ts
git commit -m "test: add integration tests for snapshot detection strategy"
```

---

### Task 5: IPC 핸들러에 snapshot 전략 옵션 추가

**Files:**
- Modify: `src/shared/ipc-types.ts` — `RealtimeTestStartRequest`에 strategy 필드 추가
- Modify: `src/main/ipc-router.ts` — `test:realtime-start` 핸들러에서 strategy 분기

**Step 1: IPC 타입 확장**

```typescript
// src/shared/ipc-types.ts (수정)
export interface RealtimeTestStartRequest {
  enableDownload: boolean
  enableUpload: boolean
  enableNotification: boolean
  pollingIntervalMs?: number
  strategy?: 'polling' | 'snapshot'  // 추가
}
```

**Step 2: IPC 핸들러에서 strategy 전달**

`test:realtime-start` 핸들러에서 `detector.forceCheck()` 대신, strategy에 따라:
- `'snapshot'`: 직접 `getFileList()` 기반 감지 수행
- `'polling'` (기본): 기존 `detector.forceCheck()` 사용

**Step 3: 기존 테스트 통과 확인**

Run: `npx vitest run tests/core/file-detector.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/shared/ipc-types.ts src/main/ipc-router.ts
git commit -m "feat: add snapshot strategy option to realtime detection IPC"
```

---

### Task 6: TestPage UI에 strategy 선택 옵션 추가

**Files:**
- Modify: `src/renderer/pages/TestPage.tsx` — strategy 라디오 버튼 추가

**Step 1: UI에 strategy 선택 추가**

```tsx
// realtimeOptions에 strategy 필드 추가
const [realtimeOptions, setRealtimeOptions] = useState({
  enableDownload: true,
  enableUpload: true,
  enableNotification: true,
  strategy: 'snapshot' as 'polling' | 'snapshot',  // 기본값: snapshot
})
```

**Step 2: 라디오 버튼 UI 추가**

```tsx
<div className="flex items-center gap-4">
  <label className="flex items-center gap-1">
    <input
      type="radio"
      name="strategy"
      value="snapshot"
      checked={realtimeOptions.strategy === 'snapshot'}
      onChange={() => setRealtimeOptions(prev => ({ ...prev, strategy: 'snapshot' }))}
      disabled={realtimeRunning}
    />
    <span>Snapshot (폴더 스캔)</span>
  </label>
  <label className="flex items-center gap-1">
    <input
      type="radio"
      name="strategy"
      value="polling"
      checked={realtimeOptions.strategy === 'polling'}
      onChange={() => setRealtimeOptions(prev => ({ ...prev, strategy: 'polling' }))}
      disabled={realtimeRunning}
    />
    <span>Polling (이력 기반)</span>
  </label>
</div>
```

**Step 3: handleRealtimeStart에서 strategy 전달**

```tsx
const handleRealtimeStart = async () => {
  const result = await window.electronAPI.invoke('test:realtime-start', {
    ...realtimeOptions,
    pollingIntervalMs: 30000,
  })
  if (result.success) setRealtimeRunning(true)
}
```

**Step 4: typecheck 확인**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/pages/TestPage.tsx
git commit -m "feat: add strategy selector to realtime detection test UI"
```

---

### Task 7: 기존 SyncEngine을 snapshot 전략으로 전환

**Files:**
- Modify: `src/core/container.ts` — FileDetector 생성 시 strategy 옵션 전달

**Step 1: container.ts에서 FileDetector 기본 strategy 변경**

```typescript
// src/core/container.ts (수정)
const detector = new FileDetector(lguplus, state, eventBus, logger, {
  pollingIntervalMs: syncConfig.pollingIntervalSec * 1000,
  strategy: 'snapshot',  // 기본 전략을 snapshot으로 변경
})
```

**Step 2: 전체 테스트 실행**

Run: `npm run test`
Expected: PASS (기존 테스트는 strategy 옵션 없이 생성 → 기본 'polling' 유지)

**Step 3: Commit**

```bash
git add src/core/container.ts
git commit -m "feat: default to snapshot detection strategy in DI container"
```

---

### Task 8: 작업 기록 작성

**Files:**
- Create: `docs/work-logs/008-스냅샷-감지전략.md`

**Step 1: 작업 기록 작성**

```markdown
# 008. 스냅샷 감지 전략 추가

- **날짜:** 2026-03-09

## 변경 요약
FileDetector에 snapshot 기반 감지 전략을 추가하여 거래처(게스트) 업로드를 포함한 모든 외부웹하드 변동을 감지할 수 있게 함.

## 변경 파일
- `src/core/snapshot-diff.ts` — 폴더 파일 목록 비교 함수
- `src/core/file-detector.ts` — snapshot 전략 추가
- `src/core/types/file-detector.types.ts` — strategy 옵션 타입
- `src/shared/ipc-types.ts` — IPC 타입에 strategy 필드
- `src/main/ipc-router.ts` — IPC 핸들러 snapshot 분기
- `src/renderer/pages/TestPage.tsx` — UI strategy 선택
- `src/core/container.ts` — 기본 전략 snapshot 전환

## 주요 결정사항
- getUploadHistory()는 로그인 유저 이력만 반환하므로 거래처 업로드 감지 불가
- getFileList()로 폴더 내용을 직접 비교하는 snapshot 방식이 유일한 해결책
- 기존 polling 전략은 제거하지 않고 선택 가능하게 유지

## 검증
- tests/core/file-detector-limitations.test.ts: 한계 증명 (11 PASS)
- tests/core/snapshot-detector.test.ts: 비교 로직 테스트
- tests/core/file-detector-snapshot.test.ts: 통합 테스트
- typecheck / lint PASS
```

**Step 2: Commit**

```bash
git add docs/work-logs/008-스냅샷-감지전략.md
git commit -m "docs: add work log for snapshot detection strategy"
```

---

## 전체 Task 요약

| Task | 내용 | 파일 수 |
|------|------|--------|
| 1 | Snapshot 비교 로직 실패 테스트 작성 | 1 create |
| 2 | diffSnapshot 비교 함수 구현 | 1 create, 1 modify |
| 3 | FileDetector에 snapshot 전략 추가 | 2 modify |
| 4 | Snapshot 통합 테스트 작성 | 1 create |
| 5 | IPC 핸들러에 strategy 옵션 추가 | 2 modify |
| 6 | TestPage UI에 strategy 선택 추가 | 1 modify |
| 7 | SyncEngine 기본 전략 snapshot 전환 | 1 modify |
| 8 | 작업 기록 작성 | 1 create |
