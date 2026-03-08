# 폴더 구조 보존 다운로드 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 외부웹하드 폴더 구조를 그대로 보존하여 로컬에 다운로드하고, 기존 파일의 최신 여부를 검증하여 스킵 또는 재다운로드한다.

**Architecture:** `SyncEngine.downloadOnly()`의 다운로드 경로를 `${tempPath}/${file.file_name}`(flat) → `${tempPath}${file.file_path}`(폴더구조 보존)으로 변경. `fullSync()`에서 `lguplus_updated_at`을 저장하여 기존 파일의 최신 여부를 비교 판단. DB 스키마에 `lguplus_updated_at` 컬럼 추가.

**Tech Stack:** TypeScript, better-sqlite3, Vitest, node:fs/promises

---

## 현재 문제점

1. **다운로드 경로가 flat**: `${tempPath}/${file.file_name}`으로 모든 파일이 같은 디렉토리에 저장됨. 동일 파일명의 다른 폴더 파일이 덮어쓰기됨.
2. **최신 데이터 검증 부재**: `fullSync()`에서 `history_no` 존재 + `completed` 상태면 무조건 스킵. LGU+에서 파일이 업데이트되어도 감지 불가.

## 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `src/core/db/schema.ts` | `sync_files`에 `lguplus_updated_at` 컬럼 추가 |
| `src/core/db/types.ts` | `SyncFileRow`, `SyncFileInsert`에 `lguplus_updated_at` 필드 추가 |
| `src/core/state-manager.ts` | `saveFile()` INSERT에 `lguplus_updated_at` 추가, `updateFileStatus` allowedFields에 추가 |
| `src/core/sync-engine.ts` | 다운로드 경로에 `file_path` 사용, `fullSync()`에서 `updatedAt` 비교 로직 |
| `tests/core/sync-engine.test.ts` | 새 테스트 추가 및 기존 테스트 경로 수정 |

---

### Task 1: DB 스키마에 `lguplus_updated_at` 컬럼 추가

**Files:**
- Modify: `src/core/db/schema.ts:36-66`
- Modify: `src/core/db/types.ts:65-109`

**Step 1: 스키마 변경 테스트용 타입 확인 (읽기 전용)**

기존 `SyncFileRow`, `SyncFileInsert` 타입 확인.

**Step 2: `schema.ts`에 `lguplus_updated_at` 컬럼 추가**

`src/core/db/schema.ts`의 `CREATE_SYNC_FILES`에 컬럼 추가:

```typescript
// sync_files 테이블 정의 내, lguplus_file_id 아래에 추가:
    lguplus_updated_at    TEXT,
```

또한 `ALL_CREATE_STATEMENTS` 배열 뒤에 마이그레이션 SQL 추가:

```typescript
export const MIGRATIONS = [
  `ALTER TABLE sync_files ADD COLUMN lguplus_updated_at TEXT;`,
]
```

**Step 3: `types.ts`의 `SyncFileRow`와 `SyncFileInsert`에 필드 추가**

```typescript
// SyncFileRow에 추가:
  lguplus_updated_at: string | null

// SyncFileInsert에 추가:
  lguplus_updated_at?: string | null
```

`SyncFileInsertSchema`에도 추가:

```typescript
  lguplus_updated_at: z.string().nullable().optional(),
```

**Step 4: `state-manager.ts`의 `saveFile()`과 `updateFileStatus()` 수정**

`saveFile()` INSERT문에 `lguplus_updated_at` 추가:

```typescript
.prepare(
  `INSERT INTO sync_files (id, folder_id, history_no, file_name, file_path, file_size, file_extension, lguplus_file_id, lguplus_updated_at, detected_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
.run(
  id,
  file.folder_id,
  file.history_no ?? null,
  file.file_name,
  file.file_path,
  file.file_size ?? 0,
  file.file_extension ?? null,
  file.lguplus_file_id ?? null,
  file.lguplus_updated_at ?? null,
  file.detected_at,
)
```

`updateFileStatus()`의 `allowedFields`에 `'lguplus_updated_at'` 추가.

`StateManager.initialize()`에 마이그레이션 실행 (기존 DB 호환):

```typescript
// 테이블 생성 후:
for (const migration of MIGRATIONS) {
  try {
    this.db.exec(migration)
  } catch {
    // 이미 적용된 마이그레이션 무시 (duplicate column 등)
  }
}
```

**Step 5: typecheck 실행**

Run: `npx tsc --noEmit`
Expected: PASS (에러 없음)

**Step 6: Commit**

```bash
git add src/core/db/schema.ts src/core/db/types.ts src/core/state-manager.ts
git commit -m "feat: add lguplus_updated_at column to sync_files for freshness check"
```

---

### Task 2: 다운로드 경로에 폴더 구조 보존

**Files:**
- Modify: `src/core/sync-engine.ts:173-243`
- Test: `tests/core/sync-engine.test.ts`

**Step 1: 실패하는 테스트 작성 — 다운로드 경로에 폴더 구조 반영 검증**

`tests/core/sync-engine.test.ts`의 `downloadOnly()` describe 블록에 추가:

```typescript
it('다운로드 경로에 file_path의 폴더 구조가 반영된다', async () => {
  const fileWithSubPath = {
    id: 'structured-path-file',
    folder_id: 'f1',
    file_name: 'deep.dxf',
    file_path: '/테스트업체/2026년/Q1/deep.dxf',
    file_size: 1024,
    status: 'detected',
    lguplus_file_id: '5001',
    download_path: undefined as string | undefined,
  }

  ;(state.getFile as ReturnType<typeof vi.fn>).mockImplementation(() => ({ ...fileWithSubPath }))

  mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

  await engine.downloadOnly('structured-path-file')

  // downloadFile이 폴더 구조를 포함한 경로로 호출되어야 함
  expect(lguplus.downloadFile).toHaveBeenCalledWith(
    5001,
    './downloads/테스트업체/2026년/Q1/deep.dxf',
  )
})
```

**Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run tests/core/sync-engine.test.ts --reporter=verbose`
Expected: FAIL — `downloadFile`이 `./downloads/deep.dxf`로 호출됨

**Step 3: `downloadOnly()` 수정 — `file_path` 기반 경로 구성**

`src/core/sync-engine.ts` `downloadOnly()` 메서드에서 3곳 변경:

```typescript
// 변경 전 (line 181):
const destPath = `${this.getTempPath()}/${file.file_name}`

// 변경 후:
const destPath = `${this.getTempPath()}${file.file_path}`
```

이로써:
- line 181: `destPath` 계산
- line 214: `lguplus.downloadFile()` 호출 시 경로
- line 229: `download_path` DB 저장 시 경로

모두 `${this.getTempPath()}${file.file_path}` 패턴 적용. (`file_path`는 이미 `/`로 시작)

```typescript
async downloadOnly(fileId: string): Promise<SyncResult> {
  const file = this.deps.state.getFile(fileId)
  if (!file) {
    return { success: false, fileId, error: 'File not found' }
  }

  try {
    const destPath = `${this.getTempPath()}${file.file_path}`
    const checkPath = file.download_path ?? destPath

    if (await this.isLocalFileValid(checkPath, file.file_size)) {
      this.logger.info(`Download skipped (file exists): ${file.file_name}`, { fileId, path: checkPath })
      this.deps.state.updateFileStatus(fileId, 'downloaded', {
        download_completed_at: new Date().toISOString(),
        download_path: checkPath,
      })
      return { success: true, fileId, skipped: true }
    }

    this.deps.state.updateFileStatus(fileId, 'downloading', {
      download_started_at: new Date().toISOString(),
    })

    this.deps.eventBus.emit('sync:progress', {
      fileId,
      fileName: file.file_name,
      progress: 0,
      speedBps: 0,
      phase: 'downloading',
      fileSize: file.file_size,
    })

    const lguplusFileId = file.lguplus_file_id
      ? Number(file.lguplus_file_id)
      : file.history_no ?? 0

    const downloadResult = await this.deps.retry.execute(
      () =>
        this.deps.lguplus.downloadFile(lguplusFileId, destPath),
      { maxRetries: 3, baseDelayMs: 1000, circuitName: 'lguplus-download' },
    )

    if (!downloadResult.success) {
      this.deps.state.updateFileStatus(fileId, 'dl_failed', {
        last_error: 'Download failed',
      })
      this.deps.eventBus.emit('sync:failed', { error: { message: 'Download failed' } as any, fileId })
      return { success: false, fileId, error: 'Download failed' }
    }

    this.deps.state.updateFileStatus(fileId, 'downloaded', {
      download_completed_at: new Date().toISOString(),
      download_path: destPath,
    })

    this.logger.info(`File downloaded: ${file.file_name}`, { fileId })
    return { success: true, fileId }
  } catch (error) {
    // ... (기존 에러 핸들링 유지)
  }
}
```

**Step 4: 테스트 실행 → 성공 확인**

Run: `npx vitest run tests/core/sync-engine.test.ts --reporter=verbose`
Expected: PASS

**Step 5: 기존 테스트가 깨지지 않았는지 확인**

기존 `downloadOnly() - local file skip` 테스트의 `fileData.file_path`가 `/test.dxf`이므로, `destPath`는 `./downloads/test.dxf`가 됨 — 기존 동작과 동일.

Run: `npx vitest run tests/core/sync-engine.test.ts --reporter=verbose`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/core/sync-engine.ts tests/core/sync-engine.test.ts
git commit -m "feat: preserve folder structure in download path using file_path"
```

---

### Task 3: fullSync()에서 최신 데이터 검증 로직 추가

**Files:**
- Modify: `src/core/sync-engine.ts:105-171`
- Test: `tests/core/sync-engine.test.ts`

**Step 1: 실패하는 테스트 작성 — updatedAt 변경 시 재동기화**

```typescript
it('기존 파일의 updatedAt이 변경되면 재동기화한다', async () => {
  ;(state.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([
    { id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '테스트업체', enabled: true },
  ])

  ;(lguplus.getAllFilesDeep as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      itemId: 100,
      itemName: 'updated.dxf',
      itemSize: 2048,
      itemExtension: 'dxf',
      parentFolderId: 1001,
      updatedAt: '2026-03-08 15:00:00',
      isFolder: false,
    },
  ])

  // 기존 파일 레코드: 이전 updatedAt으로 completed 상태
  ;(state.getFileByHistoryNo as ReturnType<typeof vi.fn>).mockReturnValue({
    id: 'existing-file',
    status: 'completed',
    lguplus_updated_at: '2026-03-01 10:00:00',
  })

  ;(state.getFile as ReturnType<typeof vi.fn>).mockImplementation((id: string) => ({
    id,
    folder_id: 'f1',
    file_name: 'updated.dxf',
    file_path: '/테스트업체/updated.dxf',
    file_size: 2048,
    status: 'detected',
    lguplus_file_id: '100',
  }))

  const result = await engine.fullSync()

  // 기존 completed 파일이지만 updatedAt이 다르므로 status를 리셋하고 재동기화
  expect(state.updateFileStatus).toHaveBeenCalledWith(
    'existing-file',
    'detected',
    expect.objectContaining({ lguplus_updated_at: '2026-03-08 15:00:00' }),
  )
  expect(result.newFiles).toBe(1)
})

it('기존 파일의 updatedAt이 동일하면 스킵한다', async () => {
  ;(state.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([
    { id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '테스트업체', enabled: true },
  ])

  ;(lguplus.getAllFilesDeep as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      itemId: 100,
      itemName: 'same.dxf',
      itemSize: 1024,
      itemExtension: 'dxf',
      parentFolderId: 1001,
      updatedAt: '2026-03-01 10:00:00',
      isFolder: false,
    },
  ])

  ;(state.getFileByHistoryNo as ReturnType<typeof vi.fn>).mockReturnValue({
    id: 'existing-file',
    status: 'completed',
    lguplus_updated_at: '2026-03-01 10:00:00',
  })

  const result = await engine.fullSync()

  expect(state.saveFile).not.toHaveBeenCalled()
  expect(result.newFiles).toBe(0)
})
```

**Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run tests/core/sync-engine.test.ts --reporter=verbose`
Expected: FAIL — 현재 `fullSync`는 `updatedAt` 비교 없이 무조건 스킵

**Step 3: `fullSync()` 수정 — `updatedAt` 비교 + `lguplus_updated_at` 저장**

> **주의:** `history_no`에 UNIQUE 인덱스가 있으므로, 업데이트된 파일은 새 레코드를 INSERT하면 안 되고 기존 레코드의 status를 리셋해야 함.

```typescript
for (const file of files) {
  const existing = this.deps.state.getFileByHistoryNo(file.itemId)

  if (existing && existing.status === 'completed' && !options?.forceRescan) {
    if (existing.lguplus_updated_at === file.updatedAt) {
      continue  // 최신 데이터 → 스킵
    }
    // updatedAt이 다르면 기존 레코드를 리셋하여 재동기화
    this.deps.state.updateFileStatus(existing.id, 'detected', {
      lguplus_updated_at: file.updatedAt,
    })
    newFiles++
    const result = await this.syncFile(existing.id)
    if (result.success) syncedFiles++
    else failedFiles++
    continue
  }

  // 기존 레코드가 없거나 completed가 아닌 경우 → 새 레코드 생성
  if (existing) continue  // 진행 중인 파일은 스킵

  newFiles++

  const subPath = file.relativePath ? `${file.relativePath}/` : ''
  const fileId = this.deps.state.saveFile({
    folder_id: folder.id,
    file_name: file.itemName,
    file_path: `/${folder.lguplus_folder_name}/${subPath}${file.itemName}`,
    file_size: file.itemSize,
    file_extension: file.itemExtension,
    lguplus_file_id: String(file.itemId),
    lguplus_updated_at: file.updatedAt,
    detected_at: new Date().toISOString(),
  })

  const result = await this.syncFile(fileId)
  if (result.success) {
    syncedFiles++
  } else {
    failedFiles++
  }
}
```

**Step 4: 테스트 실행 → 성공 확인**

Run: `npx vitest run tests/core/sync-engine.test.ts --reporter=verbose`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/sync-engine.ts tests/core/sync-engine.test.ts
git commit -m "feat: validate file freshness via updatedAt before skipping in fullSync"
```

---

### Task 4: 전체 테스트 및 타입체크 검증

**Files:**
- 변경 없음 (검증만)

**Step 1: TypeScript 타입체크**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 2: 전체 단위 테스트**

Run: `npm run test`
Expected: PASS (config-manager 1개 기존 실패 제외)

**Step 3: Commit (필요 시)**

모든 테스트 통과 확인 후, 누락된 파일이 있으면 추가 커밋.

```bash
git add -A
git commit -m "test: verify structured download and freshness check"
```

---

## 참고사항

- `lguplus-client.ts`의 `downloadFile()` 내부에서 이미 `mkdir(dirname(destPath), { recursive: true })`를 호출하므로, 중간 폴더 자동 생성은 별도 처리 불필요.
- `file_path`는 이미 `/회사명/하위폴더/.../파일명` 구조로 저장되므로, `downloadOnly()`에서 이를 그대로 활용.
- `history_no` UNIQUE 인덱스 때문에 같은 `itemId`로 새 레코드를 INSERT하면 충돌. 따라서 `updatedAt`이 변경된 파일은 기존 레코드의 status를 `detected`로 리셋하고 `syncFile(existing.id)`로 재동기화.
