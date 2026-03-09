# 다운로드 진행바 + 폴더 스캔 정확도 버그 수정 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 다운로드 진행 시 진행바가 실시간으로 올라가도록 수정하고, 폴더 스캔 시 파일 개수/용량이 정확하게 표시되도록 수정한다.

**Architecture:** 두 개의 독립적인 버그 수정. Bug 1은 다운로드를 스트리밍 방식으로 변경하고 진행 이벤트 파이프라인을 수정. Bug 2는 getAllFiles() 페이지네이션 에러 처리를 개선하고 migration:scan의 파일 수/용량 계산을 수정.

**Tech Stack:** TypeScript, Node.js fetch (ReadableStream), EventBus, Electron IPC, Zustand

---

## Bug 1: 다운로드 진행바 퍼센티지 미증가

### 근본 원인 분석

**증상:** 다운로드 진행 시 진행바가 0%에서 멈춰있다가 완료 시 갑자기 100%로 점프.

**원인 체인 (4계층 모두 문제):**

| 계층 | 파일 | 라인 | 문제 |
|------|------|------|------|
| Core | `lguplus-client.ts` | 759 | `res.arrayBuffer()`로 전체 파일을 한번에 버퍼링 → 스트리밍 없음 |
| Core | `sync-engine.ts` | 225-228 | `downloadFile()` 호출 시 `onProgress` 콜백을 전달하지 않음 |
| Core | `sync-engine.ts` | 206-213 | 다운로드 시작 시 `progress: 0`인 이벤트만 1회 발생 |
| Main | `ipc-router.ts` | 1358-1370 | `completedFiles: data.progress >= 100 ? 1 : 0` → 0% 또는 100%만 가능 |
| Renderer | `sync-store.ts` | 176-177 | `fullSyncProgress`에 `completedFiles/totalFiles` 사용 → 0% or 100% |

**참고:** `events.types.ts:40-44`에 `download:progress` 이벤트가 이미 정의되어 있으나, 어디서도 emit하지 않고 bridge도 없음.

---

### Task 1: downloadFile()에 스트리밍 다운로드 구현

**Files:**
- Modify: `src/core/lguplus-client.ts:716-771`
- Test: `tests/core/lguplus-client-download.test.ts` (신규)

**Step 1: 실패하는 테스트 작성**

```typescript
// tests/core/lguplus-client-download.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('downloadFile streaming progress', () => {
  it('should call onProgress multiple times during download', async () => {
    // onProgress가 여러 번 호출되어야 한다는 테스트
    // 실제 구현 전이므로 현재 코드에서는 최대 1번만 호출됨
    const onProgress = vi.fn()
    // ... mock fetch to return a large response
    // ... call downloadFile with onProgress
    expect(onProgress.mock.calls.length).toBeGreaterThan(1)
  })

  it('should report increasing progress bytes', async () => {
    const progressCalls: Array<[number, number]> = []
    const onProgress = vi.fn((downloaded: number, total: number) => {
      progressCalls.push([downloaded, total])
    })
    // ... call downloadFile
    // 바이트가 점진적으로 증가해야 함
    for (let i = 1; i < progressCalls.length; i++) {
      expect(progressCalls[i][0]).toBeGreaterThanOrEqual(progressCalls[i - 1][0])
    }
  })
})
```

**Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/core/lguplus-client-download.test.ts`
Expected: FAIL (onProgress는 최대 1번만 호출됨)

**Step 3: downloadFile()을 스트리밍 방식으로 변경**

`src/core/lguplus-client.ts:744-769` 변경:

현재 코드:
```typescript
const buffer = Buffer.from(await res.arrayBuffer())
if (buffer.byteLength !== info.fileSize) {
  throw new FileDownloadSizeMismatchError(...)
}
await mkdir(dirname(destPath), { recursive: true })
await writeFile(destPath, buffer)
onProgress?.(buffer.byteLength, info.fileSize)
```

수정 코드:
```typescript
const totalSize = info.fileSize
await mkdir(dirname(destPath), { recursive: true })

const body = res.body
if (!body) {
  // ReadableStream 미지원 시 fallback
  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.byteLength !== totalSize) {
    throw new FileDownloadSizeMismatchError(
      `Size mismatch: expected ${totalSize}, got ${buffer.byteLength}`,
    )
  }
  await writeFile(destPath, buffer)
  onProgress?.(buffer.byteLength, totalSize)
  return { success: true, size: buffer.byteLength, filename: info.fileName }
}

// 스트리밍 다운로드
const chunks: Buffer[] = []
let downloadedBytes = 0
const reader = body.getReader()

// 진행 이벤트 스로틀: 200ms 간격
let lastProgressAt = 0
const PROGRESS_INTERVAL_MS = 200

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  const chunk = Buffer.from(value)
  chunks.push(chunk)
  downloadedBytes += chunk.byteLength

  const now = Date.now()
  if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
    onProgress?.(downloadedBytes, totalSize)
    lastProgressAt = now
  }
}

const buffer = Buffer.concat(chunks)
if (buffer.byteLength !== totalSize) {
  throw new FileDownloadSizeMismatchError(
    `Size mismatch: expected ${totalSize}, got ${buffer.byteLength}`,
  )
}

await writeFile(destPath, buffer)
// 최종 100% 진행 이벤트
onProgress?.(buffer.byteLength, totalSize)
```

**Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/core/lguplus-client-download.test.ts`
Expected: PASS

**Step 5: 커밋**

```bash
git add src/core/lguplus-client.ts tests/core/lguplus-client-download.test.ts
git commit -m "feat: stream downloads with periodic progress callbacks"
```

---

### Task 2: sync-engine에서 다운로드 진행 이벤트 연결

**Files:**
- Modify: `src/core/sync-engine.ts:195-256` (downloadOnly 메서드)

**Step 1: sync-engine downloadOnly에서 onProgress 콜백 전달**

현재 코드 (`sync-engine.ts:225-228`):
```typescript
const downloadResult = await this.deps.retry.execute(
  () =>
    this.deps.lguplus.downloadFile(lguplusFileId, destPath),
  { maxRetries: 3, baseDelayMs: 1000, circuitName: 'lguplus-download' },
)
```

수정 코드:
```typescript
const downloadResult = await this.deps.retry.execute(
  () =>
    this.deps.lguplus.downloadFile(lguplusFileId, destPath, (downloadedBytes, totalBytes) => {
      this.deps.eventBus.emit('sync:progress', {
        fileId,
        fileName: file.file_name,
        progress: totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0,
        speedBps: 0,
        phase: 'downloading',
        fileSize: totalBytes,
      })
    }),
  { maxRetries: 3, baseDelayMs: 1000, circuitName: 'lguplus-download' },
)
```

**Step 2: typecheck 확인**

Run: `npm run typecheck`
Expected: PASS

**Step 3: 커밋**

```bash
git add src/core/sync-engine.ts
git commit -m "fix: wire download progress callback to EventBus in sync-engine"
```

---

### Task 3: IPC 브릿지에서 바이트 기반 진행도 정확히 전달

**Files:**
- Modify: `src/main/ipc-router.ts:1358-1370`

**Step 1: sync:progress 브릿지 수정**

현재 코드:
```typescript
'sync:progress': (data: { fileId: string; fileName: string; progress: number; speedBps: number; phase: string; fileSize: number }) => {
  send('sync:progress', {
    phase: (data.phase as 'downloading' | 'uploading') ?? 'downloading',
    fileId: data.fileId,
    currentFile: data.fileName,
    completedFiles: data.progress >= 100 ? 1 : 0,    // ← 버그
    totalFiles: 1,
    completedBytes: Math.round((data.progress / 100) * data.fileSize),
    totalBytes: data.fileSize,
    speedBps: data.speedBps,
    estimatedRemainingMs: 0,
  })
}
```

수정 코드:
```typescript
'sync:progress': (data: { fileId: string; fileName: string; progress: number; speedBps: number; phase: string; fileSize: number }) => {
  const completedBytes = Math.round((data.progress / 100) * data.fileSize)
  send('sync:progress', {
    phase: (data.phase as 'downloading' | 'uploading') ?? 'downloading',
    fileId: data.fileId,
    currentFile: data.fileName,
    completedFiles: data.progress >= 100 ? 1 : 0,
    totalFiles: 1,
    completedBytes,
    totalBytes: data.fileSize,
    speedBps: data.speedBps,
    estimatedRemainingMs: 0,
  })
}
```

> Note: 이 계층에서의 변환 자체는 크게 틀리지 않음. 핵심 수정은 Task 1/2에서 진행 이벤트가 실제로 여러 번 발생하게 한 것이고, 이제 `data.progress`가 0~100 사이 중간값으로 들어옴.

**Step 2: 커밋**

```bash
git add src/main/ipc-router.ts
git commit -m "fix: ensure IPC bridge passes intermediate progress values"
```

---

### Task 4: Renderer sync-store에서 fullSyncProgress 계산 수정

**Files:**
- Modify: `src/renderer/stores/sync-store.ts:172-182`

**Step 1: fullSyncProgress 계산식 수정**

현재 코드:
```typescript
set({
  activeTransfers: transfers.slice(0, 5),
  fullSyncProgress: {
    phase: event.phase,
    progress:
      event.totalFiles > 0 ? (event.completedFiles / event.totalFiles) * 100 : 0,
    currentFile: event.currentFile,
    speedBps: event.speedBps,
    estimatedRemainingMs: event.estimatedRemainingMs,
  },
})
```

수정 코드:
```typescript
set({
  activeTransfers: transfers.slice(0, 5),
  fullSyncProgress: {
    phase: event.phase,
    progress: event.totalBytes > 0
      ? (event.completedBytes / event.totalBytes) * 100
      : (event.totalFiles > 0 ? (event.completedFiles / event.totalFiles) * 100 : 0),
    currentFile: event.currentFile,
    speedBps: event.speedBps,
    estimatedRemainingMs: event.estimatedRemainingMs,
  },
})
```

> 바이트 정보가 있으면 바이트 기반 진행도 사용, 없으면 파일 수 기반 fallback.

**Step 2: typecheck 확인**

Run: `npm run typecheck`
Expected: PASS

**Step 3: 커밋**

```bash
git add src/renderer/stores/sync-store.ts
git commit -m "fix: use byte-based progress for fullSyncProgress display"
```

---

## Bug 2: 폴더 스캔 파일 개수/용량 부정확

### 근본 원인 분석

**증상:** "ㄱ 내리기전용", "ㄱ 올리기전용" 폴더의 파일 개수와 용량이 실제와 다르게 표시됨.

**원인 체인:**

| 원인 | 파일 | 라인 | 영향 |
|------|------|------|------|
| `getAllFiles()` 배치 실패 시 `break` | `lguplus-client.ts` | 523 | 나머지 페이지 전부 무시 → 파일 수 부족 |
| `migration:scan`에서 `totalSize: 0` 하드코딩 | `ipc-router.ts` | 388 | 폴더 용량이 항상 0으로 표시 |
| `migration:scan`에서 `getFileList().total` 사용 | `ipc-router.ts` | 377 | API `total`에 폴더 항목 포함 → 파일 수 과다 |
| `getFileList()` total vs filtered items 불일치 | `lguplus-client.ts` | 467-482 | total은 "ㄴ상위 폴더 이동" 포함, items는 필터됨 → 페이지 수 계산 오차 |

---

### Task 5: getAllFiles() 배치 실패 시 나머지 페이지 계속 처리

**Files:**
- Modify: `src/core/lguplus-client.ts:506-525`
- Test: `tests/core/lguplus-client-pagination.test.ts` (신규)

**Step 1: 실패하는 테스트 작성**

```typescript
// tests/core/lguplus-client-pagination.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('getAllFiles pagination resilience', () => {
  it('should continue fetching remaining pages when a batch fails', async () => {
    // 5페이지 중 2번째 배치(페이지 4-5) 실패 시에도
    // 1번째 배치(페이지 2-3)의 결과는 포함되어야 함
    // 그리고 3번째 배치(페이지 6-7)도 시도해야 함
  })
})
```

**Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/core/lguplus-client-pagination.test.ts`
Expected: FAIL (현재 break 때문에 첫 실패 이후 중단)

**Step 3: break → continue로 변경**

`src/core/lguplus-client.ts:506-525` 수정:

현재 코드:
```typescript
const BATCH_SIZE = 3
for (let i = 0; i < remainingPages.length; i += BATCH_SIZE) {
  const batch = remainingPages.slice(i, i + BATCH_SIZE)
  try {
    const results = await Promise.all(
      batch.map((page) => this.getFileList(folderId, { page })),
    )
    for (const result of results) {
      allFiles.push(...result.items)
    }
    onProgress?.(batch[batch.length - 1], allFiles.length, total)
  } catch (error) {
    this.logger.warn(`Failed to fetch page batch for folder ${folderId}`, {
      batch,
      error: (error as Error).message,
    })
    break  // ← 여기가 문제
  }
}
```

수정 코드:
```typescript
const BATCH_SIZE = 3
for (let i = 0; i < remainingPages.length; i += BATCH_SIZE) {
  const batch = remainingPages.slice(i, i + BATCH_SIZE)
  try {
    const results = await Promise.all(
      batch.map((page) => this.getFileList(folderId, { page })),
    )
    for (const result of results) {
      allFiles.push(...result.items)
    }
    onProgress?.(batch[batch.length - 1], allFiles.length, total)
  } catch (error) {
    this.logger.warn(`Failed to fetch page batch for folder ${folderId}, continuing with remaining pages`, {
      batch,
      error: (error as Error).message,
    })
    // 실패한 배치의 개별 페이지를 하나씩 재시도
    for (const page of batch) {
      try {
        const result = await this.getFileList(folderId, { page })
        allFiles.push(...result.items)
      } catch {
        this.logger.warn(`Failed to fetch page ${page} for folder ${folderId}, skipping`)
      }
    }
  }
}
```

**Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/core/lguplus-client-pagination.test.ts`
Expected: PASS

**Step 5: 커밋**

```bash
git add src/core/lguplus-client.ts tests/core/lguplus-client-pagination.test.ts
git commit -m "fix: retry individual pages on batch failure in getAllFiles"
```

---

### Task 6: migration:scan에서 정확한 fileCount와 totalSize 계산

**Files:**
- Modify: `src/main/ipc-router.ts:365-396`

**Step 1: migration:scan 핸들러 수정**

현재 코드:
```typescript
ipcMain.handle('migration:scan', async () => {
  try {
    await folderDiscovery.discoverFolders()
    const folders = state.getFolders()
    const result = await Promise.all(
      folders.map(async (f) => {
        let fileCount = 0
        try {
          const files = await lguplus.getFileList(Number(f.lguplus_folder_id))
          fileCount = files.total          // ← 폴더 포함된 total 사용
        } catch {
          // silently fail
        }
        const syncedFiles = state.getFilesByFolder(f.id, { status: 'completed' })
        return {
          id: f.id,
          lguplusFolderId: f.lguplus_folder_id,
          folderName: f.lguplus_folder_name,
          fileCount,
          syncedCount: syncedFiles.length,
          totalSize: 0,                    // ← 하드코딩 0
        }
      }),
    )
    return ok(result)
  } catch (e) {
    return fail('MIGRATION_SCAN_FAILED', (e as Error).message)
  }
})
```

수정 코드:
```typescript
ipcMain.handle('migration:scan', async () => {
  try {
    await folderDiscovery.discoverFolders()
    const folders = state.getFolders()
    const result = await Promise.all(
      folders.map(async (f) => {
        let fileCount = 0
        let totalSize = 0
        try {
          const files = await lguplus.getAllFiles(Number(f.lguplus_folder_id))
          const nonFolders = files.filter((file) => !file.isFolder)
          fileCount = nonFolders.length
          totalSize = nonFolders.reduce((sum, file) => sum + file.itemSize, 0)
        } catch {
          // silently fail
        }
        const syncedFiles = state.getFilesByFolder(f.id, { status: 'completed' })
        return {
          id: f.id,
          lguplusFolderId: f.lguplus_folder_id,
          folderName: f.lguplus_folder_name,
          fileCount,
          syncedCount: syncedFiles.length,
          totalSize,
        }
      }),
    )
    return ok(result)
  } catch (e) {
    return fail('MIGRATION_SCAN_FAILED', (e as Error).message)
  }
})
```

**변경 포인트:**
1. `getFileList()` → `getAllFiles()` 사용 (모든 페이지 가져옴)
2. `files.filter(!isFolder)` 적용 (폴더 항목 제외)
3. `totalSize` 실제 계산 (`reduce`로 합산)

**Step 2: typecheck 확인**

Run: `npm run typecheck`
Expected: PASS

**Step 3: 커밋**

```bash
git add src/main/ipc-router.ts
git commit -m "fix: use getAllFiles with folder filter and calculate real totalSize in migration:scan"
```

---

### Task 7: 전체 통합 테스트 및 typecheck

**Step 1: 전체 typecheck**

Run: `npm run typecheck`
Expected: PASS (에러 0)

**Step 2: 전체 테스트**

Run: `npm run test`
Expected: 기존 테스트 + 신규 테스트 모두 PASS

**Step 3: lint**

Run: `npm run lint`
Expected: PASS

**Step 4: 최종 커밋 (필요시)**

```bash
git add -A
git commit -m "chore: fix any remaining lint/type issues from progress and scan fixes"
```

---

## 요약

| Task | 수정 대상 | 효과 |
|------|----------|------|
| 1 | `lguplus-client.ts` downloadFile | 스트리밍 다운로드로 실시간 진행 콜백 |
| 2 | `sync-engine.ts` downloadOnly | onProgress → EventBus 연결 |
| 3 | `ipc-router.ts` bridge | 중간 progress 값 정확 전달 |
| 4 | `sync-store.ts` handleProgress | 바이트 기반 진행도 표시 |
| 5 | `lguplus-client.ts` getAllFiles | 배치 실패 시 나머지 페이지 계속 처리 |
| 6 | `ipc-router.ts` migration:scan | 정확한 fileCount + totalSize 계산 |
| 7 | 전체 | 통합 검증 |
