# Upload batch-record 응답 형식 불일치 수정 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `/batch-record` API 응답 파싱 버그를 수정하여 테스트 업로드 기능이 정상 동작하도록 한다.

**Architecture:** 클라이언트(`YjlaserUploader.uploadFile`)가 서버 `/batch-record` 응답을 잘못된 형식으로 파싱하고 있음. 서버는 `{ data: { inserted, files } }` 구조를 반환하지만 클라이언트는 `{ data: Array<...> }` 구조를 기대하여 `recordRes.data[0]`에서 TypeError 발생. 응답 파싱을 서버 실제 형식에 맞게 수정하고, null 안전 처리를 추가한다.

**Tech Stack:** TypeScript, Vitest

---

## 근본 원인 분석

**서버 응답 (실제):**
```json
{
  "success": true,
  "data": {
    "inserted": 1,
    "files": [{ "id": 123, "name": "file.ai", "folder_id": "uuid" }]
  }
}
```

**클라이언트 기대 (잘못됨):**
```typescript
const recordRes = await this.apiPost<{
  data: Array<{ id: string; objectKey: string; publicUrl: string; ... }>
}>('/batch-record', { ... })
const recorded = recordRes.data[0]  // ← data는 객체이지 배열이 아님!
```

**에러:** `recordRes.data`가 `{ inserted, files }` 객체이므로 `recordRes.data[0]`은 `undefined` → `undefined.id`에서 TypeError.

---

### Task 1: uploadFile의 batch-record 응답 파싱 수정

**Files:**
- Modify: `src/core/webhard-uploader/yjlaser-uploader.ts:241-270`

**Step 1: batch-record 응답 타입과 파싱 로직 수정**

`yjlaser-uploader.ts` 241-270행의 기존 코드:

```typescript
// 4. Record metadata via batch-record
const recordRes = await this.apiPost<{
  data: Array<{
    id: string
    objectKey: string
    publicUrl: string
    folderId: string
    fileName: string
    size: number
    createdAt: string
  }>
}>('/batch-record', {
  files: [
    {
      objectKey: presignRes.data.objectKey,
      publicUrl: presignRes.data.publicUrl,
      folderId: params.folderId,
      fileName: params.originalName,
      size,
    },
  ],
})

const recorded = recordRes.data[0]
const uploadedFile: UploadedFileInfo = {
  id: recorded.id,
  name: recorded.fileName,
  size: recorded.size,
  folderId: recorded.folderId,
  uploadedAt: recorded.createdAt,
}
```

수정 후:

```typescript
// 4. Record metadata via batch-record
const recordRes = await this.apiPost<{
  success: boolean
  data: {
    inserted: number
    files: Array<{ id: number; name: string; folder_id: string }>
  }
}>('/batch-record', {
  files: [
    {
      objectKey: presignRes.data.objectKey,
      publicUrl: presignRes.data.publicUrl,
      folderId: params.folderId,
      fileName: params.originalName,
      size,
    },
  ],
})

const recorded = recordRes.data?.files?.[0]
if (!recorded) {
  throw new Error(
    `batch-record returned no file data (inserted: ${recordRes.data?.inserted ?? 'unknown'})`,
  )
}
const uploadedFile: UploadedFileInfo = {
  id: String(recorded.id),
  name: recorded.name,
  size,
  folderId: recorded.folder_id,
  uploadedAt: new Date().toISOString(),
}
```

핵심 변경:
1. 응답 타입을 `{ data: { inserted, files } }`로 수정 (서버 실제 반환 형식)
2. `recordRes.data[0]` → `recordRes.data?.files?.[0]` (올바른 경로)
3. null 체크 추가 (files 배열이 비었을 때 명확한 에러 메시지)
4. `recorded.id`가 서버에서 number로 오므로 `String()` 변환
5. 서버가 `size`, `createdAt` 필드를 반환하지 않으므로 로컬 값 사용

**Step 2: typecheck 실행**

Run: `npm run typecheck`
Expected: PASS (타입 변경이 내부 로직에만 영향)

**Step 3: 기존 테스트 실행**

Run: `npm run test`
Expected: PASS (mock-uploader는 별도 구현이므로 영향 없음)

**Step 4: Commit**

```bash
git add src/core/webhard-uploader/yjlaser-uploader.ts
git commit -m "fix: correct batch-record API response parsing in uploadFile

Server returns { data: { inserted, files } } but client expected
{ data: Array<...> }, causing TypeError on data[0].id"
```

---

### Task 2: 단위 테스트 추가

**Files:**
- Create: `tests/core/yjlaser-uploader-batch-record.test.ts`

**Step 1: batch-record 응답 파싱 테스트 작성**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { YjlaserUploader } from '../../src/core/webhard-uploader/yjlaser-uploader'

// Mock dependencies
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
}

const mockRetry = {
  execute: vi.fn((fn: () => Promise<any>) => fn()),
  getCircuitState: vi.fn(),
  resetCircuit: vi.fn(),
}

describe('YjlaserUploader.uploadFile batch-record response', () => {
  let uploader: YjlaserUploader

  beforeEach(() => {
    uploader = new YjlaserUploader(
      'https://test.yjlaser.net',
      'test-api-key',
      mockLogger as any,
      mockRetry as any,
    )
    vi.restoreAllMocks()
  })

  it('should correctly parse batch-record response with { data: { files } } format', async () => {
    // Mock fetch for presign → R2 PUT → batch-record
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      // presign call
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              objectKey: 'uploads/test.ai',
              presignedUrl: 'https://r2.example.com/presigned',
              publicUrl: 'https://cdn.example.com/test.ai',
            },
            existed: false,
          }),
          { status: 200 },
        ),
      )
      // R2 PUT
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      // batch-record call
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              inserted: 1,
              files: [{ id: 42, name: 'test.ai', folder_id: 'folder-uuid' }],
            },
          }),
          { status: 200 },
        ),
      )

    // Mock fs.readFile and fs.stat
    const fs = await import('node:fs/promises')
    vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('test'))
    vi.spyOn(fs, 'stat').mockResolvedValue({ size: 4 } as any)

    const result = await uploader.uploadFile({
      folderId: 'folder-uuid',
      filePath: '/tmp/test.ai',
      originalName: 'test.ai',
    })

    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()
    expect(result.data!.id).toBe('42')
    expect(result.data!.name).toBe('test.ai')
    expect(result.data!.folderId).toBe('folder-uuid')
  })

  it('should handle empty files array in batch-record response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              objectKey: 'uploads/test.ai',
              presignedUrl: 'https://r2.example.com/presigned',
              publicUrl: 'https://cdn.example.com/test.ai',
            },
            existed: false,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: { inserted: 0, files: [] },
          }),
          { status: 200 },
        ),
      )

    const fs = await import('node:fs/promises')
    vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('test'))
    vi.spyOn(fs, 'stat').mockResolvedValue({ size: 4 } as any)

    const result = await uploader.uploadFile({
      folderId: 'folder-uuid',
      filePath: '/tmp/test.ai',
      originalName: 'test.ai',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('batch-record returned no file data')
  })

  it('should skip upload when presign returns existed: true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { objectKey: 'uploads/test.ai', presignedUrl: '', publicUrl: '' },
          existed: true,
        }),
        { status: 200 },
      ),
    )

    const fs = await import('node:fs/promises')
    vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('test'))
    vi.spyOn(fs, 'stat').mockResolvedValue({ size: 4 } as any)

    const result = await uploader.uploadFile({
      folderId: 'folder-uuid',
      filePath: '/tmp/test.ai',
      originalName: 'test.ai',
    })

    expect(result.success).toBe(true)
    expect(result.data!.id).toBe('uploads/test.ai') // uses objectKey as id
  })
})
```

**Step 2: 테스트 실행하여 실패 확인 (수정 전) 또는 성공 확인 (수정 후)**

Run: `npx vitest run tests/core/yjlaser-uploader-batch-record.test.ts`
Expected: PASS (Task 1 수정이 이미 적용된 경우)

**Step 3: Commit**

```bash
git add tests/core/yjlaser-uploader-batch-record.test.ts
git commit -m "test: add unit tests for uploadFile batch-record response parsing"
```

---

### Task 3: 빌드 & 수동 검증

**Step 1: 전체 테스트 + typecheck**

Run: `npm run typecheck && npm run test`
Expected: 모든 테스트 PASS

**Step 2: 빌드**

Run: `npm run build`
Expected: PASS

**Step 3: 수동 검증**

1. `npm run dev`로 앱 실행
2. 테스트 페이지 → 다운로드 탭에서 폴더 선택 후 다운로드 테스트 실행
3. 업로드 탭에서 같은 폴더 선택 후 업로드 테스트 실행
4. "Upload failed" 대신 성공 확인

**Step 4: 작업 로그 작성 & Commit**

`docs/work-logs/008-업로드-batch-record-응답수정.md` 작성 후 커밋.
