# 남은 API 연결 구현 계획 (TDD)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** LGU+ 파일 다운로드, DLQ 일괄 재시도, 로그 내보내기 3개 TODO를 구현하여 동기화 파이프라인을 100% 완성한다.

**Architecture:** `downloadFile()`은 `getDownloadUrlInfo()`로 URL을 받은 뒤 Node.js `fs.createWriteStream` + `fetch` 스트림으로 파일을 저장하고, 크기 검증 후 `DownloadResult`를 반환한다. `retryAllDlq()`는 StateManager의 DLQ 항목을 조회하여 SyncEngine.syncFile()을 재호출한다. `logs:export`는 DB 로그를 CSV/JSON으로 직렬화하여 임시 파일로 저장한다.

**Tech Stack:** Node.js `node:fs`, `node:path`, `node:os`, MSW 2.x, Vitest, TypeScript

---

## 변경 파일 요약

| 파일 | 작업 | Task |
|------|------|------|
| `tests/mocks/lguplus-handlers.ts` | 수정 | 1 |
| `tests/core/lguplus-client.test.ts` | 수정 | 1-2 |
| `src/core/lguplus-client.ts` | 수정 | 2 |
| `tests/core/retry-manager.test.ts` | 수정 | 3-4 |
| `src/core/retry-manager.ts` | 수정 | 4 |
| `tests/main/ipc-router.test.ts` | 신규 | 5-6 |
| `src/main/ipc-router.ts` | 수정 | 6 |

---

## Task 1: downloadFile() MSW 핸들러 + 테스트 작성 (RED)

**Files:**
- Modify: `tests/mocks/lguplus-handlers.ts` — 다운로드 스트림 핸들러 추가
- Modify: `tests/core/lguplus-client.test.ts` — downloadFile 테스트 추가

**Step 1: MSW 핸들러에 파일 다운로드 엔드포인트 추가**

`tests/mocks/lguplus-handlers.ts` 맨 끝, `lguplusHandlers` 배열에 추가:

```typescript
// File download (binary stream)
http.get(`${BASE_URL}/download/:fileId`, ({ params, request }) => {
  if (!validSession) {
    return HttpResponse.json({ result: 'fail' }, { status: 401 })
  }
  const fileId = Number(params.fileId)

  if (fileId === 9999) {
    return HttpResponse.json({ result: 'fail' }, { status: 404 })
  }

  // Return mock binary content (10240 bytes matching fileSize in download-info)
  const content = Buffer.alloc(10240, 0x41) // 'A' repeated
  return new HttpResponse(content, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': '10240',
    },
  })
}),
```

**Step 2: downloadFile() 테스트 작성**

`tests/core/lguplus-client.test.ts`의 `Files & History` describe 블록 안에 추가:

```typescript
import { writeFile, readFile, stat, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// describe 밖 상단에 추가
let tmpDir: string

// beforeEach 안에 추가
tmpDir = await mkdir(path.join(os.tmpdir(), `lguplus-test-${Date.now()}`), { recursive: true }).then(() => path.join(os.tmpdir(), `lguplus-test-${Date.now()}`))

// afterEach 추가
afterEach(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
})
```

실제로는 vi.mock('node:fs/promises')로 fs를 모킹하여 MSW 응답 → 파일 쓰기를 검증:

```typescript
describe('Download', () => {
  beforeEach(async () => {
    await client.login('testuser', 'testpass')
  })

  it('downloadFile() 성공 시 DownloadResult 반환', async () => {
    const result = await client.downloadFile(5001, '/tmp/test.dxf')
    expect(result.success).toBe(true)
    expect(result.size).toBe(10240)
    expect(result.filename).toBe('test.dxf')
  })

  it('downloadFile() — 파일 없으면 success: false', async () => {
    // download-info에서 null 반환되는 fileId 사용
    // MSW 핸들러에 fileId 9999 → 404 매핑 필요
    const result = await client.downloadFile(9999, '/tmp/notfound.dxf')
    expect(result.success).toBe(false)
    expect(result.size).toBe(0)
  })

  it('downloadFile() — 크기 불일치 시 FileDownloadSizeMismatchError', async () => {
    // 크기 불일치 시나리오 (별도 MSW override 사용)
    server.use(
      http.get(`${BASE_URL}/download/:fileId`, () => {
        // download-info는 fileSize: 10240이지만 실제 3바이트만 반환
        return new HttpResponse(Buffer.from('abc'), {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        })
      }),
    )
    await expect(client.downloadFile(5001, '/tmp/mismatch.dxf'))
      .rejects.toThrow('size mismatch')
  })

  it('downloadFile() — 서버 500 시 FileDownloadTransferError', async () => {
    server.use(
      http.get(`${BASE_URL}/download/:fileId`, () => {
        return new HttpResponse(null, { status: 500 })
      }),
    )
    await expect(client.downloadFile(5001, '/tmp/error.dxf'))
      .rejects.toThrow()
  })

  it('downloadFile() — onProgress 콜백이 호출된다', async () => {
    const progress = vi.fn()
    await client.downloadFile(5001, '/tmp/progress.dxf', progress)
    expect(progress).toHaveBeenCalled()
    // 마지막 호출: (totalBytes, totalBytes)
    const lastCall = progress.mock.calls[progress.mock.calls.length - 1]
    expect(lastCall[0]).toBe(10240) // downloadedBytes
    expect(lastCall[1]).toBe(10240) // totalBytes
  })
})
```

**Step 3: 테스트 실행 — RED 확인**

Run: `npx vitest run tests/core/lguplus-client.test.ts`
Expected: Download describe 내 5개 테스트 FAIL (downloadFile이 아직 stub)

**Step 4: Commit**

```bash
git add tests/mocks/lguplus-handlers.ts tests/core/lguplus-client.test.ts
git commit -m "test: add downloadFile() RED tests and MSW download handler"
```

---

## Task 2: downloadFile() 구현 (GREEN)

**Files:**
- Modify: `src/core/lguplus-client.ts:151-168` — downloadFile 메서드 교체

**Step 1: downloadFile() 구현**

`src/core/lguplus-client.ts`의 downloadFile 메서드를 교체:

```typescript
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  FileDownloadNotFoundError,
  FileDownloadTransferError,
  FileDownloadSizeMismatchError,
  FileDownloadUrlFetchError,
} from './errors'

// ...

async downloadFile(
  fileId: number,
  destPath: string,
  onProgress?: ProgressCallback,
): Promise<DownloadResult> {
  // 1. Get download URL info
  const info = await this.getDownloadUrlInfo(fileId)
  if (!info) {
    return { success: false, size: 0, filename: '' }
  }

  // 2. Ensure destination directory exists
  await mkdir(dirname(destPath), { recursive: true })

  // 3. Download file via HTTP GET
  const res = await fetch(info.url, {
    headers: this.getHeaders(),
  })

  if (res.status === 404) {
    throw new FileDownloadNotFoundError(`File ${fileId} not found on server`)
  }

  if (!res.ok || !res.body) {
    throw new FileDownloadTransferError(
      `Download failed: HTTP ${res.status}`,
    )
  }

  // 4. Stream to file with progress tracking
  let downloadedBytes = 0
  const totalBytes = info.fileSize
  const fileStream = createWriteStream(destPath)

  const reader = res.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      fileStream.write(value)
      downloadedBytes += value.byteLength
      onProgress?.(downloadedBytes, totalBytes)
    }
  } finally {
    fileStream.end()
    // Wait for stream to finish
    await new Promise<void>((resolve, reject) => {
      fileStream.on('finish', resolve)
      fileStream.on('error', reject)
    })
  }

  // 5. Verify size
  if (downloadedBytes !== totalBytes) {
    throw new FileDownloadSizeMismatchError(
      `Download size mismatch: expected ${totalBytes}, got ${downloadedBytes}`,
    )
  }

  this.logger.info('File downloaded', {
    fileId,
    filename: info.fileName,
    size: downloadedBytes,
  })

  return {
    success: true,
    size: downloadedBytes,
    filename: info.fileName,
  }
}
```

주의: 테스트 환경에서 `createWriteStream`은 실제 파일 시스템에 쓰기 때문에 `vi.mock('node:fs')`로 모킹해야 할 수 있음. 또는 MSW + 메모리 기반 접근을 사용.

**실제 구현 전략 — fs mock 사용:**

테스트에서 `node:fs`와 `node:fs/promises`를 모킹하되, `downloadFile()` 구현은 실제 파일 I/O를 사용하는 것이 맞음 (Electron main process에서 실행). 테스트에서는 `vi.mock`으로 `createWriteStream` 등을 모킹.

**대안 — 더 간단한 구현 (Buffer 기반):**

스트림 대신 `arrayBuffer()`로 전체 응답을 읽고 `writeFile`로 한 번에 쓰는 방식. CAD 파일이 수 MB~수십 MB이므로 메모리에 충분히 적재 가능:

```typescript
async downloadFile(
  fileId: number,
  destPath: string,
  onProgress?: ProgressCallback,
): Promise<DownloadResult> {
  const info = await this.getDownloadUrlInfo(fileId)
  if (!info) {
    return { success: false, size: 0, filename: '' }
  }

  await mkdir(dirname(destPath), { recursive: true })

  const res = await fetch(info.url, { headers: this.getHeaders() })

  if (res.status === 404) {
    throw new FileDownloadNotFoundError(`File ${fileId} not found`)
  }
  if (!res.ok) {
    throw new FileDownloadTransferError(`Download failed: HTTP ${res.status}`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())

  if (buffer.byteLength !== info.fileSize) {
    throw new FileDownloadSizeMismatchError(
      `Size mismatch: expected ${info.fileSize}, got ${buffer.byteLength}`,
    )
  }

  await writeFile(destPath, buffer)
  onProgress?.(buffer.byteLength, info.fileSize)

  this.logger.info('File downloaded', {
    fileId,
    filename: info.fileName,
    size: buffer.byteLength,
  })

  return {
    success: true,
    size: buffer.byteLength,
    filename: info.fileName,
  }
}
```

이 방식이 테스트하기 훨씬 쉽고, `vi.mock('node:fs/promises')`의 `writeFile`과 `mkdir`만 모킹하면 됨.

**Step 2: import 추가**

`src/core/lguplus-client.ts` 상단에:

```typescript
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  FileDownloadNotFoundError,
  FileDownloadTransferError,
  FileDownloadSizeMismatchError,
} from './errors'
```

**Step 3: 테스트에서 fs 모킹 추가**

`tests/core/lguplus-client.test.ts` 상단:

```typescript
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}))
```

그리고 download-info 핸들러에서 fileId 9999일 때 null 반환하도록 수정:

```typescript
http.post(`${BASE_URL}/wh/download-info`, async ({ request }) => {
  if (!validSession) {
    return HttpResponse.json({ result: 'fail' }, { status: 401 })
  }
  const body = await request.json() as Record<string, unknown>
  const fileId = body.fileId as number

  if (fileId === 9999) {
    return HttpResponse.json({ result: 'success', data: null })
  }

  return HttpResponse.json({
    result: 'success',
    data: {
      url: `${BASE_URL}/download/${fileId}`,
      session: 'dl-session-123',
      nonce: 'nonce-abc',
      userId: 'testuser',
      fileOwnerEncId: 'enc-owner-1',
      fileName: 'test.dxf',
      fileSize: 10240,
    },
  })
})
```

**Step 4: 테스트 실행 — GREEN 확인**

Run: `npx vitest run tests/core/lguplus-client.test.ts`
Expected: ALL PASS

**Step 5: 전체 테스트 확인**

Run: `npx vitest run`
Expected: 기존 테스트 전부 통과 (state-manager 네이티브 모듈 이슈 제외)

**Step 6: 타입체크**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 7: Commit**

```bash
git add src/core/lguplus-client.ts tests/core/lguplus-client.test.ts tests/mocks/lguplus-handlers.ts
git commit -m "feat: implement downloadFile() with size verification and error handling"
```

---

## Task 3: retryAllDlq() 테스트 작성 (RED)

**Files:**
- Modify: `tests/core/retry-manager.test.ts` — retryAllDlq 테스트 추가

**Step 1: 기존 테스트 파일 구조 확인**

`tests/core/retry-manager.test.ts` 하단에 새 describe 블록 추가:

```typescript
describe('retryAllDlq()', () => {
  it('DLQ 항목이 없으면 total: 0 반환', async () => {
    const result = await retry.retryAllDlq()
    expect(result).toEqual({ total: 0, succeeded: 0, failed: 0 })
  })

  it('재시도 가능한 DLQ 항목을 처리한다', async () => {
    // RetryManager가 StateManager와 SyncEngine을 주입받아야 함
    // 구현 방식에 따라 테스트 수정 필요
  })

  it('can_retry=false인 항목은 건너뛴다', async () => {
    // ...
  })
})
```

**중요 설계 결정:**

`retryAllDlq()`는 현재 `RetryManager`에 정의되어 있지만, DLQ 항목을 조회하려면 `StateManager`가, 파일을 재동기화하려면 `SyncEngine`이 필요하다. 현재 `RetryManager`는 `ILogger`만 주입받는다.

**선택지:**
1. `RetryManager`에 `StateManager`와 `SyncEngine`을 주입 → 순환 의존 위험
2. `retryAllDlq()`를 `SyncEngine`으로 이동 → IPC 핸들러 수정 필요
3. `RetryManager`에 콜백/전략 패턴으로 재시도 로직 주입

**권장: 선택지 3 — 콜백 주입**

```typescript
// RetryManager constructor에 옵션 추가
interface RetryManagerDeps {
  getDlqItems: () => DlqRow[]
  retryItem: (item: DlqRow) => Promise<boolean>
  removeDlqItem: (id: number) => void
  updateDlqRetryCount: (id: number) => void
}
```

하지만 현재 `IRetryManager` 인터페이스를 변경하지 않고, `container.ts`에서 초기화 시 deps를 주입하는 방식이 가장 깔끔함.

**실제 구현 방식:**

`RetryManager`에 `setDlqDeps()` 메서드를 추가하여 순환 의존 없이 나중에 주입:

```typescript
// container.ts에서:
const retry = new RetryManager(logger)
// ... engine 생성 후
retry.setDlqDeps({
  getDlqItems: () => state.getDlqItems(),
  retrySyncFile: (fileId: string) => engine.syncFile(fileId),
  removeDlqItem: (id: number) => state.removeDlqItem(id),
})
```

**Step 2: 테스트 작성**

```typescript
describe('retryAllDlq()', () => {
  let mockGetDlqItems: ReturnType<typeof vi.fn>
  let mockRetrySyncFile: ReturnType<typeof vi.fn>
  let mockRemoveDlqItem: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockGetDlqItems = vi.fn().mockReturnValue([])
    mockRetrySyncFile = vi.fn().mockResolvedValue({ success: true, fileId: '1' })
    mockRemoveDlqItem = vi.fn()

    retry.setDlqDeps({
      getDlqItems: mockGetDlqItems,
      retrySyncFile: mockRetrySyncFile,
      removeDlqItem: mockRemoveDlqItem,
    })
  })

  it('DLQ 항목이 없으면 { total: 0, succeeded: 0, failed: 0 }', async () => {
    const result = await retry.retryAllDlq()
    expect(result).toEqual({ total: 0, succeeded: 0, failed: 0 })
  })

  it('재시도 가능한 항목을 재동기화한다', async () => {
    mockGetDlqItems.mockReturnValue([
      { id: 1, event_id: 'e1', file_id: 'f1', file_name: 'a.dxf', file_path: '/a', folder_id: null, failure_reason: 'err', error_code: null, retry_count: 1, max_retries: 3, can_retry: true, last_retry_at: null, next_retry_at: null, created_at: '', updated_at: '' },
      { id: 2, event_id: 'e2', file_id: 'f2', file_name: 'b.dxf', file_path: '/b', folder_id: null, failure_reason: 'err', error_code: null, retry_count: 1, max_retries: 3, can_retry: true, last_retry_at: null, next_retry_at: null, created_at: '', updated_at: '' },
    ])

    const result = await retry.retryAllDlq()
    expect(result.total).toBe(2)
    expect(result.succeeded).toBe(2)
    expect(result.failed).toBe(0)
    expect(mockRetrySyncFile).toHaveBeenCalledTimes(2)
    expect(mockRemoveDlqItem).toHaveBeenCalledTimes(2)
  })

  it('can_retry=false 항목은 건너뛴다', async () => {
    mockGetDlqItems.mockReturnValue([
      { id: 1, event_id: 'e1', file_id: 'f1', file_name: 'a.dxf', file_path: '/a', folder_id: null, failure_reason: 'err', error_code: null, retry_count: 10, max_retries: 10, can_retry: false, last_retry_at: null, next_retry_at: null, created_at: '', updated_at: '' },
    ])

    const result = await retry.retryAllDlq()
    expect(result.total).toBe(0)
    expect(mockRetrySyncFile).not.toHaveBeenCalled()
  })

  it('재시도 실패 시 failed 카운트 증가', async () => {
    mockRetrySyncFile.mockResolvedValue({ success: false, fileId: 'f1', error: 'still broken' })
    mockGetDlqItems.mockReturnValue([
      { id: 1, event_id: 'e1', file_id: 'f1', file_name: 'a.dxf', file_path: '/a', folder_id: null, failure_reason: 'err', error_code: null, retry_count: 1, max_retries: 3, can_retry: true, last_retry_at: null, next_retry_at: null, created_at: '', updated_at: '' },
    ])

    const result = await retry.retryAllDlq()
    expect(result.total).toBe(1)
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(mockRemoveDlqItem).not.toHaveBeenCalled()
  })

  it('deps 미설정 시 빈 결과 반환', async () => {
    const freshRetry = new RetryManager(logger)
    const result = await freshRetry.retryAllDlq()
    expect(result).toEqual({ total: 0, succeeded: 0, failed: 0 })
  })
})
```

**Step 3: 테스트 실행 — RED 확인**

Run: `npx vitest run tests/core/retry-manager.test.ts`
Expected: retryAllDlq 테스트 FAIL (`setDlqDeps` 메서드 없음)

**Step 4: Commit**

```bash
git add tests/core/retry-manager.test.ts
git commit -m "test: add retryAllDlq() RED tests with DLQ deps injection"
```

---

## Task 4: retryAllDlq() 구현 (GREEN)

**Files:**
- Modify: `src/core/retry-manager.ts` — setDlqDeps + retryAllDlq 구현
- Modify: `src/core/container.ts` — DLQ deps 주입

**Step 1: RetryManager에 DLQ deps 타입 및 메서드 추가**

`src/core/retry-manager.ts`에 추가:

```typescript
import type { SyncResult } from './types/sync-engine.types'

interface DlqDeps {
  getDlqItems: () => DlqItem[]
  retrySyncFile: (fileId: string) => Promise<SyncResult>
  removeDlqItem: (id: number) => void
}

// 클래스 내부:
private dlqDeps?: DlqDeps

setDlqDeps(deps: DlqDeps): void {
  this.dlqDeps = deps
}

async retryAllDlq(): Promise<BatchRetryResult> {
  if (!this.dlqDeps) {
    return { total: 0, succeeded: 0, failed: 0 }
  }

  const items = this.dlqDeps.getDlqItems()
  const retryable = items.filter((item) => item.can_retry)
  let succeeded = 0
  let failed = 0

  for (const item of retryable) {
    try {
      const fileId = item.file_id ?? item.event_id
      const result = await this.dlqDeps.retrySyncFile(fileId)
      if (result.success) {
        succeeded++
        this.dlqDeps.removeDlqItem(item.id)
      } else {
        failed++
      }
    } catch {
      failed++
    }
  }

  return { total: retryable.length, succeeded, failed }
}
```

**주의:** `DlqItem` 타입의 `can_retry`는 `boolean`이고, `file_id`는 `string | null`이므로 null인 경우 `event_id`를 fallback으로 사용.

**Step 2: container.ts에서 DLQ deps 주입**

`src/core/container.ts`의 `createCoreServices()` 함수 끝부분에:

```typescript
// After engine creation
retry.setDlqDeps({
  getDlqItems: () => state.getDlqItems(),
  retrySyncFile: (fileId: string) => engine.syncFile(fileId),
  removeDlqItem: (id: number) => state.removeDlqItem(id),
})
```

**Step 3: SyncResult 타입 확인**

`src/core/types/sync-engine.types.ts`에서 `SyncResult` 확인:

```typescript
export interface SyncResult {
  success: boolean
  fileId: string
  error?: string
}
```

**Step 4: DlqItem import 추가**

`retry-manager.ts`에 이미 `DlqItem`이 import되어 있는지 확인. 현재:

```typescript
import type { IRetryManager, CircuitState, RetryOptions, DlqItem, BatchRetryResult } from './types/retry-manager.types'
```

✅ 이미 import됨.

**Step 5: 테스트 실행 — GREEN 확인**

Run: `npx vitest run tests/core/retry-manager.test.ts`
Expected: ALL PASS

**Step 6: 전체 테스트 + 타입체크**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

**Step 7: Commit**

```bash
git add src/core/retry-manager.ts src/core/container.ts tests/core/retry-manager.test.ts
git commit -m "feat: implement retryAllDlq() with DLQ deps injection pattern"
```

---

## Task 5: logs:export 테스트 작성 (RED)

**Files:**
- Create: `tests/main/ipc-router.test.ts` — logs:export 테스트

**Step 1: 테스트 파일 생성**

IPC 핸들러는 Electron의 `ipcMain`에 의존하므로, 직접 핸들러 함수를 추출하여 테스트하는 것이 현실적. 또는 `logs:export`에 해당하는 로직을 별도 함수로 추출하여 단위 테스트.

`tests/main/ipc-router.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { exportLogs } from '../../src/main/ipc-router'

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('node:os', () => ({
  tmpdir: vi.fn().mockReturnValue('/tmp'),
}))

import { writeFile } from 'node:fs/promises'

const mockWriteFile = vi.mocked(writeFile)

describe('exportLogs()', () => {
  const mockLogs = [
    { id: 1, level: 'info', message: 'Sync started', category: 'sync', context: '{"foo":"bar"}', stack_trace: null, created_at: '2026-02-24T10:00:00Z' },
    { id: 2, level: 'error', message: 'Download failed', category: 'download', context: null, stack_trace: 'Error: timeout', created_at: '2026-02-24T10:01:00Z' },
  ]

  let mockGetLogs: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetLogs = vi.fn().mockReturnValue(mockLogs)
  })

  it('JSON 형식으로 내보내기', async () => {
    const result = await exportLogs(mockGetLogs, { format: 'json' })
    expect(result.filePath).toMatch(/\.json$/)
    expect(mockWriteFile).toHaveBeenCalledOnce()
    const writtenContent = mockWriteFile.mock.calls[0][1] as string
    const parsed = JSON.parse(writtenContent)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].message).toBe('Sync started')
  })

  it('CSV 형식으로 내보내기', async () => {
    const result = await exportLogs(mockGetLogs, { format: 'csv' })
    expect(result.filePath).toMatch(/\.csv$/)
    expect(mockWriteFile).toHaveBeenCalledOnce()
    const writtenContent = mockWriteFile.mock.calls[0][1] as string
    expect(writtenContent).toContain('id,level,message,category,timestamp')
    expect(writtenContent).toContain('Sync started')
  })

  it('날짜 필터가 getLogs에 전달된다', async () => {
    await exportLogs(mockGetLogs, {
      format: 'json',
      dateFrom: '2026-02-24',
      dateTo: '2026-02-25',
    })
    expect(mockGetLogs).toHaveBeenCalledWith({
      from: '2026-02-24',
      to: '2026-02-25',
    })
  })

  it('로그가 없으면 빈 배열/헤더만 출력', async () => {
    mockGetLogs.mockReturnValue([])
    const result = await exportLogs(mockGetLogs, { format: 'json' })
    const writtenContent = mockWriteFile.mock.calls[0][1] as string
    expect(JSON.parse(writtenContent)).toEqual([])
  })
})
```

**Step 2: 테스트 실행 — RED 확인**

Run: `npx vitest run tests/main/ipc-router.test.ts`
Expected: FAIL (`exportLogs` 함수 없음)

**Step 3: Commit**

```bash
git add tests/main/ipc-router.test.ts
git commit -m "test: add logs:export RED tests"
```

---

## Task 6: logs:export 구현 (GREEN)

**Files:**
- Modify: `src/main/ipc-router.ts` — exportLogs 함수 추가 + 핸들러 연결

**Step 1: exportLogs 함수 구현**

`src/main/ipc-router.ts` 하단에 export 함수 추가:

```typescript
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface LogRow {
  id: number
  level: string
  message: string
  category: string
  context: string | null
  stack_trace: string | null
  created_at: string
}

interface LogQuery {
  from?: string
  to?: string
}

export async function exportLogs(
  getLogs: (query: LogQuery) => LogRow[],
  request: { format: 'csv' | 'json'; dateFrom?: string; dateTo?: string },
): Promise<{ filePath: string }> {
  const logs = getLogs({
    from: request.dateFrom,
    to: request.dateTo,
  })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const ext = request.format
  const filePath = join(tmpdir(), `webhard-sync-logs-${timestamp}.${ext}`)

  let content: string

  if (request.format === 'json') {
    const data = logs.map((l) => ({
      id: l.id,
      level: l.level,
      message: l.message,
      category: l.category,
      timestamp: l.created_at,
      details: l.context ? JSON.parse(l.context) : undefined,
      stackTrace: l.stack_trace ?? undefined,
    }))
    content = JSON.stringify(data, null, 2)
  } else {
    const header = 'id,level,message,category,timestamp,stackTrace'
    const rows = logs.map((l) => {
      const msg = l.message.replace(/"/g, '""')
      const stack = (l.stack_trace ?? '').replace(/"/g, '""')
      return `${l.id},${l.level},"${msg}",${l.category},${l.created_at},"${stack}"`
    })
    content = [header, ...rows].join('\n')
  }

  await writeFile(filePath, content, 'utf-8')

  return { filePath }
}
```

**Step 2: IPC 핸들러에서 exportLogs 호출**

`ipc-router.ts`의 `logs:export` 핸들러 수정:

```typescript
ipcMain.handle('logs:export', async (_event, request) => {
  try {
    const result = await exportLogs(
      (query) => state.getLogs(query),
      request,
    )
    return ok(result)
  } catch (e) {
    return fail('LOGS_EXPORT_FAILED', (e as Error).message)
  }
})
```

**Step 3: 테스트 실행 — GREEN 확인**

Run: `npx vitest run tests/main/ipc-router.test.ts`
Expected: ALL PASS

**Step 4: 전체 테스트 + 타입체크**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/ipc-router.ts tests/main/ipc-router.test.ts
git commit -m "feat: implement logs:export with JSON/CSV format support"
```

---

## Task 7: 통합 검증

**Step 1: 전체 테스트 스위트 실행**

Run: `npx vitest run`
Expected: state-manager 네이티브 모듈 이슈 외 전부 PASS

**Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: 구현 완료 상태 확인**

| 모듈 | 메서드 | 상태 |
|------|--------|------|
| `lguplus-client.ts` | `downloadFile()` | ✅ 완성 |
| `retry-manager.ts` | `retryAllDlq()` | ✅ 완성 |
| `ipc-router.ts` | `logs:export` | ✅ 완성 |

**Step 4: 최종 커밋**

```bash
git add -A
git commit -m "feat: complete all remaining API connections

- downloadFile(): LGU+ 웹하드 파일 다운로드 with size verification
- retryAllDlq(): DLQ 항목 일괄 재시도 with deps injection
- logs:export: JSON/CSV 로그 내보내기"
```

---

## 에러 클래스 참조표

| 에러 클래스 | 코드 | 용도 | retryable |
|-------------|------|------|-----------|
| `FileDownloadNotFoundError` | `DL_FILE_NOT_FOUND` | 404 파일 없음 | ❌ |
| `FileDownloadTransferError` | `DL_TRANSFER_FAILED` | HTTP 에러/전송 실패 | ✅ |
| `FileDownloadSizeMismatchError` | `DL_SIZE_MISMATCH` | 크기 불일치 | ✅ |
| `FileDownloadUrlFetchError` | `DL_URL_FETCH_FAILED` | URL 조회 실패 | ✅ |
| `AuthSessionExpiredError` | `AUTH_SESSION_EXPIRED` | 401 세션 만료 | ✅ |

## 테스트 커버리지 목표

| 파일 | 테스트 | 커버 항목 |
|------|--------|----------|
| `lguplus-client.test.ts` | ~10개 추가 | 다운로드 성공/실패/크기검증/404/500/진행률 |
| `retry-manager.test.ts` | ~5개 추가 | DLQ 빈목록/재시도성공/실패/스킵/deps미설정 |
| `ipc-router.test.ts` | ~4개 추가 | JSON/CSV/날짜필터/빈로그 |
