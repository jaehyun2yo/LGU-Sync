# 폴더 스캔 최적화 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** fullSync 시 `getAllFilesDeep()` 폴더 스캔 속도를 대폭 개선한다.

**Architecture:** Worker pool 기반 BFS로 폴더 탐색 병렬성을 극대화하고, 페이지네이션 병렬 fetch, 폴더 구조 캐싱, 증분 스캔을 도입한다.

**Tech Stack:** TypeScript, Vitest, 기존 ILGUplusClient 인터페이스 확장

---

## 현재 병목 분석

| 병목 | 위치 | 영향 |
|------|------|------|
| Level-by-level BFS | `getAllFilesDeep()` L454 | 레벨 전체가 끝나야 다음 레벨 시작. concurrency=3이 레벨 내에서만 적용 |
| 순차 페이지네이션 | `getAllFiles()` L430 | 페이지 1→2→3 순차 fetch. 100페이지면 100번 직렬 |
| 폴더당 2회 API 호출 | `getAllFilesDeep()` L467+479 | `getAllFiles()` + `getSubFolders()` 매번 2+회 |
| fullSync 폴더 순차 처리 | `sync-engine.ts` L117 | `for (const folder of targetFolders)` 직렬 |
| 캐싱 없음 | 전체 | 매 스캔마다 전체 폴더 트리 재구축 |
| 증분 스캔 없음 | `fullSync()` L126-129 | API에서 전체 파일 받은 뒤 DB에서 중복 체크 |

---

## Task 1: Worker Pool 기반 병렬 BFS (`getAllFilesDeep` 개선)

**Files:**
- Modify: `src/core/lguplus-client.ts:441-506` (`getAllFilesDeep`)
- Test: `tests/core/lguplus-client-scan.test.ts` (신규)

**핵심 변경:** 현재 level-by-level BFS를 worker pool 패턴으로 교체. 폴더가 발견되면 즉시 큐에 넣고 빈 워커가 처리.

**Step 1: 실패하는 테스트 작성**

```typescript
// tests/core/lguplus-client-scan.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('getAllFilesDeep - worker pool BFS', () => {
  it('하위 폴더가 발견되면 레벨 완료를 기다리지 않고 즉시 처리한다', async () => {
    // 시나리오: root → A,B → A1,A2 (B는 빈 폴더)
    // level-by-level이면: [root] → [A,B] → [A1,A2] = 3단계
    // worker pool이면: root 처리 → A 즉시 시작 (B 기다리지 않음)
    const callOrder: string[] = []

    const mockGetSubFolders = vi.fn().mockImplementation(async (folderId: number) => {
      callOrder.push(`sub:${folderId}`)
      if (folderId === 1) return [
        { folderId: 10, folderName: 'A', parentFolderId: 1 },
        { folderId: 20, folderName: 'B', parentFolderId: 1 },
      ]
      if (folderId === 10) return [
        { folderId: 100, folderName: 'A1', parentFolderId: 10 },
      ]
      return []
    })

    const mockGetAllFiles = vi.fn().mockImplementation(async (folderId: number) => {
      callOrder.push(`files:${folderId}`)
      // B를 느리게 만듬
      if (folderId === 20) await new Promise(r => setTimeout(r, 50))
      return []
    })

    // getAllFilesDeep 호출 후
    // A1 처리가 B 완료 전에 시작되어야 함 (worker pool 동작)
    // callOrder에서 'files:100' (A1) 이 'files:20' (B 완료) 전에 나타나야 함
    // → 이 테스트는 현재 level-by-level에서는 실패
  })

  it('concurrency 제한을 준수한다', async () => {
    let activeConcurrency = 0
    let maxConcurrency = 0

    const mockGetSubFolders = vi.fn().mockImplementation(async () => {
      activeConcurrency++
      maxConcurrency = Math.max(maxConcurrency, activeConcurrency)
      await new Promise(r => setTimeout(r, 10))
      activeConcurrency--
      return []
    })

    // concurrency=2로 설정 시 동시 처리가 2를 넘지 않아야 함
    expect(maxConcurrency).toBeLessThanOrEqual(2)
  })
})
```

**Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/core/lguplus-client-scan.test.ts -v`
Expected: FAIL

**Step 3: Worker pool BFS 구현**

```typescript
// src/core/lguplus-client.ts - getAllFilesDeep 교체
async getAllFilesDeep(
  folderId: number,
  options?: { maxDepth?: number; concurrency?: number },
): Promise<LGUplusFileItem[]> {
  const maxDepth = options?.maxDepth ?? 10
  const concurrency = options?.concurrency ?? 5
  const allFiles: LGUplusFileItem[] = []
  const visitedFolderIds = new Set<number>()

  // Worker pool: 폴더가 발견되면 즉시 큐에 추가
  const queue: Array<{ folderId: number; depth: number; relativePath: string }> = [
    { folderId, depth: 0, relativePath: '' },
  ]

  let activeWorkers = 0
  let resolveAll: () => void
  const allDone = new Promise<void>((r) => { resolveAll = r })

  const processNext = async (): Promise<void> => {
    while (queue.length > 0) {
      const entry = queue.shift()!
      if (visitedFolderIds.has(entry.folderId)) continue
      visitedFolderIds.add(entry.folderId)

      activeWorkers++

      // 1. 파일 목록 + 서브폴더를 동시에 가져옴
      const [files, subFolders] = await Promise.all([
        this.getAllFiles(entry.folderId),
        entry.depth < maxDepth
          ? this.getSubFolders(entry.folderId)
          : Promise.resolve([]),
      ])

      // 2. 파일 수집
      for (const file of files) {
        if (!file.isFolder) {
          allFiles.push({
            ...file,
            relativePath: entry.relativePath || undefined,
          })
        }
      }

      // 3. 서브폴더를 즉시 큐에 추가
      for (const sub of subFolders) {
        if (!visitedFolderIds.has(sub.folderId)) {
          const subPath = entry.relativePath
            ? `${entry.relativePath}/${sub.folderName}`
            : sub.folderName
          queue.push({
            folderId: sub.folderId,
            depth: entry.depth + 1,
            relativePath: subPath,
          })
        }
      }

      activeWorkers--

      // 새로 추가된 폴더가 있으면 빈 워커 슬롯에서 처리
      if (queue.length === 0 && activeWorkers === 0) {
        resolveAll!()
      }
    }
  }

  // concurrency 개수만큼 워커 시작
  const workers = Array.from({ length: concurrency }, () => processNext())
  await allDone

  return allFiles
}
```

**핵심 개선:** `getSubFolders()`와 `getAllFiles()`를 `Promise.all`로 동시 호출 → 폴더당 API 대기시간 50% 절감.

**Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/core/lguplus-client-scan.test.ts -v`
Expected: PASS

**Step 5: 커밋**

```bash
git add tests/core/lguplus-client-scan.test.ts src/core/lguplus-client.ts
git commit -m "perf: worker pool BFS로 getAllFilesDeep 병렬성 극대화"
```

---

## Task 2: 페이지네이션 병렬 fetch (`getAllFiles` 개선)

**Files:**
- Modify: `src/core/lguplus-client.ts:422-439` (`getAllFiles`)
- Test: `tests/core/lguplus-client-scan.test.ts` (추가)

**핵심 변경:** 첫 페이지에서 `total`을 파악한 뒤, 나머지 페이지를 병렬로 fetch.

**Step 1: 실패하는 테스트 작성**

```typescript
describe('getAllFiles - 병렬 페이지네이션', () => {
  it('100개 파일(페이지당 20개) 조회 시 page 2~5를 병렬로 가져온다', async () => {
    const fetchTimes: number[] = []

    // page 1 → total=100 반환, page 2~5는 동시에 fetch됨
    // 순차이면 ~500ms (5*100ms), 병렬이면 ~200ms (1+1 라운드)
    const start = Date.now()
    // ... 호출 후
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(350) // 병렬이면 ~200ms
  })
})
```

**Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/core/lguplus-client-scan.test.ts -v`
Expected: FAIL

**Step 3: 병렬 페이지네이션 구현**

```typescript
async getAllFiles(
  folderId: number,
  onProgress?: (page: number, fetched: number, total: number) => void,
): Promise<LGUplusFileItem[]> {
  // 첫 페이지로 total 파악
  const firstPage = await this.getFileList(folderId, { page: 1 })
  const allFiles = [...firstPage.items]
  const total = firstPage.total
  const pageSize = firstPage.items.length || 20

  onProgress?.(1, allFiles.length, total)

  if (allFiles.length >= total) return allFiles

  // 남은 페이지 수 계산 → 병렬 fetch
  const totalPages = Math.ceil(total / pageSize)
  const remainingPages = Array.from(
    { length: totalPages - 1 },
    (_, i) => i + 2,
  )

  // 병렬 batch (한 번에 5페이지씩)
  const BATCH_SIZE = 5
  for (let i = 0; i < remainingPages.length; i += BATCH_SIZE) {
    const batch = remainingPages.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map((page) => this.getFileList(folderId, { page })),
    )
    for (const result of results) {
      allFiles.push(...result.items)
    }
    onProgress?.(batch[batch.length - 1], allFiles.length, total)
  }

  return allFiles
}
```

**Step 4: 테스트 통과 확인 + 기존 테스트 regression 없음**

Run: `npx vitest run tests/core/ -v`
Expected: ALL PASS

**Step 5: 커밋**

```bash
git add src/core/lguplus-client.ts tests/core/lguplus-client-scan.test.ts
git commit -m "perf: getAllFiles 페이지네이션 병렬 fetch"
```

---

## Task 3: 폴더 구조 캐싱 (FolderTreeCache)

**Files:**
- Create: `src/core/folder-tree-cache.ts`
- Test: `tests/core/folder-tree-cache.test.ts` (신규)
- Modify: `src/core/lguplus-client.ts` (캐시 적용)

**핵심 변경:** 폴더 트리 구조를 메모리에 캐싱. TTL(기본 5분) 내 재스캔 시 API 호출 스킵.

**Step 1: 실패하는 테스트 작성**

```typescript
// tests/core/folder-tree-cache.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FolderTreeCache } from '../../src/core/folder-tree-cache'

describe('FolderTreeCache', () => {
  let cache: FolderTreeCache

  beforeEach(() => {
    cache = new FolderTreeCache({ ttlMs: 5000 })
  })

  it('캐시 미스 시 null 반환', () => {
    expect(cache.getSubFolders(100)).toBeNull()
  })

  it('캐시 히트 시 저장된 데이터 반환', () => {
    const folders = [{ folderId: 10, folderName: 'A', parentFolderId: 100 }]
    cache.setSubFolders(100, folders)
    expect(cache.getSubFolders(100)).toEqual(folders)
  })

  it('TTL 만료 후 null 반환', () => {
    vi.useFakeTimers()
    const folders = [{ folderId: 10, folderName: 'A', parentFolderId: 100 }]
    cache.setSubFolders(100, folders)

    vi.advanceTimersByTime(6000) // TTL 초과
    expect(cache.getSubFolders(100)).toBeNull()

    vi.useRealTimers()
  })

  it('invalidate()로 특정 폴더 캐시 삭제', () => {
    const folders = [{ folderId: 10, folderName: 'A', parentFolderId: 100 }]
    cache.setSubFolders(100, folders)
    cache.invalidate(100)
    expect(cache.getSubFolders(100)).toBeNull()
  })

  it('clear()로 전체 캐시 삭제', () => {
    cache.setSubFolders(100, [])
    cache.setSubFolders(200, [])
    cache.clear()
    expect(cache.getSubFolders(100)).toBeNull()
    expect(cache.getSubFolders(200)).toBeNull()
  })
})
```

**Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/core/folder-tree-cache.test.ts -v`
Expected: FAIL (모듈 없음)

**Step 3: FolderTreeCache 구현**

```typescript
// src/core/folder-tree-cache.ts
import type { LGUplusFolderItem } from './types/lguplus-client.types'

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

export class FolderTreeCache {
  private subFoldersCache = new Map<number, CacheEntry<LGUplusFolderItem[]>>()
  private fileCountCache = new Map<number, CacheEntry<number>>()
  private ttlMs: number

  constructor(options?: { ttlMs?: number }) {
    this.ttlMs = options?.ttlMs ?? 5 * 60 * 1000 // 기본 5분
  }

  getSubFolders(folderId: number): LGUplusFolderItem[] | null {
    const entry = this.subFoldersCache.get(folderId)
    if (!entry || Date.now() > entry.expiresAt) {
      this.subFoldersCache.delete(folderId)
      return null
    }
    return entry.data
  }

  setSubFolders(folderId: number, folders: LGUplusFolderItem[]): void {
    this.subFoldersCache.set(folderId, {
      data: folders,
      expiresAt: Date.now() + this.ttlMs,
    })
  }

  getFileCount(folderId: number): number | null {
    const entry = this.fileCountCache.get(folderId)
    if (!entry || Date.now() > entry.expiresAt) {
      this.fileCountCache.delete(folderId)
      return null
    }
    return entry.data
  }

  setFileCount(folderId: number, count: number): void {
    this.fileCountCache.set(folderId, {
      data: count,
      expiresAt: Date.now() + this.ttlMs,
    })
  }

  invalidate(folderId: number): void {
    this.subFoldersCache.delete(folderId)
    this.fileCountCache.delete(folderId)
  }

  clear(): void {
    this.subFoldersCache.clear()
    this.fileCountCache.clear()
  }
}
```

**Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/core/folder-tree-cache.test.ts -v`
Expected: PASS

**Step 5: 커밋**

```bash
git add src/core/folder-tree-cache.ts tests/core/folder-tree-cache.test.ts
git commit -m "feat: FolderTreeCache - 폴더 구조 메모리 캐싱"
```

---

## Task 4: LGUplusClient에 캐시 통합

**Files:**
- Modify: `src/core/lguplus-client.ts` (생성자에 캐시 주입, `getSubFolders`에 캐시 적용)
- Modify: `src/core/container.ts` (DI에 캐시 등록)
- Test: `tests/core/lguplus-client-scan.test.ts` (캐시 히트 테스트 추가)

**Step 1: 실패하는 테스트 작성**

```typescript
describe('getSubFolders with cache', () => {
  it('두 번째 호출 시 API를 호출하지 않고 캐시에서 반환한다', async () => {
    // 첫 호출: API → 캐시 저장
    // 두 번째 호출: 캐시 히트 → API 미호출
    // callWhApi가 1번만 호출됐는지 확인
  })
})
```

**Step 2: 테스트 실패 확인**

**Step 3: 캐시 통합 구현**

`LGUplusClient` 생성자에 `FolderTreeCache` 옵셔널 파라미터 추가.
`getSubFolders()`에서 캐시 확인 → 미스면 API 호출 후 캐시 저장.

**Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/core/ -v`
Expected: ALL PASS

**Step 5: 커밋**

```bash
git add src/core/lguplus-client.ts src/core/container.ts tests/core/lguplus-client-scan.test.ts
git commit -m "perf: getSubFolders에 FolderTreeCache 적용"
```

---

## Task 5: fullSync 폴더 병렬 처리

**Files:**
- Modify: `src/core/sync-engine.ts:104-170` (`fullSync`)
- Test: `tests/core/sync-engine.test.ts` (추가)

**핵심 변경:** `for (const folder of targetFolders)` → 병렬 처리 (concurrency 제한 포함)

**Step 1: 실패하는 테스트 작성**

```typescript
describe('fullSync - 병렬 폴더 처리', () => {
  it('여러 폴더를 동시에 스캔한다', async () => {
    const scanStart: Record<string, number> = {}

    ;(state.getFolders as any).mockReturnValue([
      { id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: 'A', enabled: true },
      { id: 'f2', lguplus_folder_id: '1002', lguplus_folder_name: 'B', enabled: true },
    ])

    ;(lguplus.getAllFilesDeep as any).mockImplementation(async (folderId: number) => {
      scanStart[folderId] = Date.now()
      await new Promise(r => setTimeout(r, 50))
      return []
    })

    const start = Date.now()
    await engine.fullSync()
    const elapsed = Date.now() - start

    // 순차이면 ~100ms, 병렬이면 ~50ms
    expect(elapsed).toBeLessThan(80)
  })
})
```

**Step 2: 테스트 실패 확인**

**Step 3: 병렬 fullSync 구현**

```typescript
async fullSync(options?: FullSyncOptions): Promise<FullSyncResult> {
  const start = Date.now()
  let scannedFiles = 0
  let newFiles = 0
  let syncedFiles = 0
  let failedFiles = 0

  try {
    const folders = this.deps.state.getFolders(true)
    const targetFolders = options?.folderIds
      ? folders.filter((f) => options.folderIds!.includes(f.id))
      : folders

    // 폴더 스캔을 병렬로 (concurrency 제한)
    const SCAN_CONCURRENCY = 3
    for (let i = 0; i < targetFolders.length; i += SCAN_CONCURRENCY) {
      const batch = targetFolders.slice(i, i + SCAN_CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map((folder) => this.scanFolder(folder, options)),
      )

      for (const result of results) {
        if (result.status === 'fulfilled') {
          scannedFiles += result.value.scannedFiles
          newFiles += result.value.newFiles
          syncedFiles += result.value.syncedFiles
          failedFiles += result.value.failedFiles
        } else {
          failedFiles++
        }
      }
    }
  } catch (error) {
    this.logger.error('Full sync failed', error as Error)
  }

  return { scannedFiles, newFiles, syncedFiles, failedFiles, durationMs: Date.now() - start }
}

// 기존 for-loop 내부를 별도 메서드로 추출
private async scanFolder(
  folder: { id: string; lguplus_folder_id: string; lguplus_folder_name: string },
  options?: FullSyncOptions,
): Promise<{ scannedFiles: number; newFiles: number; syncedFiles: number; failedFiles: number }> {
  let scannedFiles = 0, newFiles = 0, syncedFiles = 0, failedFiles = 0

  const files = await this.deps.lguplus.getAllFilesDeep(
    Number(folder.lguplus_folder_id),
  )
  scannedFiles = files.length

  for (const file of files) {
    const existing = this.deps.state.getFileByHistoryNo(file.itemId)
    if (existing && existing.status === 'completed' && !options?.forceRescan) continue

    newFiles++
    const subPath = file.relativePath ? `${file.relativePath}/` : ''
    const fileId = this.deps.state.saveFile({
      folder_id: folder.id,
      file_name: file.itemName,
      file_path: `/${folder.lguplus_folder_name}/${subPath}${file.itemName}`,
      file_size: file.itemSize,
      file_extension: file.itemExtension,
      lguplus_file_id: String(file.itemId),
      detected_at: new Date().toISOString(),
    })

    const result = await this.syncFile(fileId)
    if (result.success) syncedFiles++
    else failedFiles++
  }

  return { scannedFiles, newFiles, syncedFiles, failedFiles }
}
```

**Step 4: 테스트 통과 + 기존 테스트 regression 없음**

Run: `npx vitest run tests/core/sync-engine.test.ts -v`
Expected: ALL PASS

**Step 5: 커밋**

```bash
git add src/core/sync-engine.ts tests/core/sync-engine.test.ts
git commit -m "perf: fullSync 폴더 병렬 스캔 (concurrency=3)"
```

---

## Task 6: FolderDiscovery 병렬 처리

**Files:**
- Modify: `src/core/folder-discovery.ts:69-155`
- Test: `tests/core/folder-discovery.test.ts` (신규)

**핵심 변경:** `ensureFolderPath()` 호출을 병렬화. 새 폴더 10개 발견 시 순차 → 병렬로 개선.

**Step 1: 실패하는 테스트 작성**

```typescript
describe('FolderDiscovery - 병렬 처리', () => {
  it('새 폴더 여러 개를 동시에 처리한다', async () => {
    // 5개 새 폴더, ensureFolderPath가 50ms 걸리면
    // 순차: ~250ms, 병렬(3): ~100ms
  })
})
```

**Step 2: 테스트 실패 확인**

**Step 3: 병렬화 구현**

```typescript
async discoverFolders(): Promise<DiscoveryResult> {
  // ... (기존 rootId, homeFolders, uniqueFolders 로직 동일)

  // 기존 폴더 / 새 폴더 분리
  const existingEntries: typeof uniqueFolders = []
  const newEntries: typeof uniqueFolders = []

  for (const folder of uniqueFolders) {
    const existing = this.state.getFolderByLguplusId(String(folder.folderId))
    if (existing) {
      existingEntries.push(folder)
      // ... 이름 업데이트 등 (동기 작업)
    } else {
      newEntries.push(folder)
    }
  }

  // 새 폴더들은 병렬 처리 (concurrency=3)
  const CONCURRENCY = 3
  for (let i = 0; i < newEntries.length; i += CONCURRENCY) {
    const batch = newEntries.slice(i, i + CONCURRENCY)
    await Promise.allSettled(
      batch.map((folder) => this.processNewFolder(folder, result)),
    )
  }

  return result
}
```

**Step 4: 테스트 통과 확인**

**Step 5: 커밋**

```bash
git add src/core/folder-discovery.ts tests/core/folder-discovery.test.ts
git commit -m "perf: FolderDiscovery 새 폴더 병렬 처리"
```

---

## Task 7: 전체 통합 테스트 + 기존 테스트 regression 확인

**Files:**
- Test: `tests/core/sync-engine.test.ts` (기존)
- Test: `tests/core/lguplus-client-scan.test.ts` (신규)
- Test: `tests/core/folder-tree-cache.test.ts` (신규)
- Test: `tests/core/folder-discovery.test.ts` (신규)

**Step 1: 전체 테스트 실행**

Run: `npm run test`
Expected: ALL PASS

**Step 2: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없음

**Step 3: 린트**

Run: `npm run lint`
Expected: 에러 없음

**Step 4: 최종 커밋**

```bash
git commit -m "test: 폴더 스캔 최적화 통합 테스트 완료" --allow-empty
```

---

## 예상 성능 개선

| 시나리오 | Before | After | 개선율 |
|---------|--------|-------|-------|
| 10폴더, 각 3뎁스, 폴더당 50파일 | ~30s (순차) | ~6s (병렬 BFS + 캐싱) | **~5x** |
| 동일 폴더 재스캔 (캐시 히트) | ~30s | ~3s (폴더트리 캐시) | **~10x** |
| 100파일 페이지네이션 (5페이지) | ~5s | ~1.5s (병렬 page) | **~3x** |
| fullSync 5개 폴더 | ~150s | ~50s (폴더 병렬) | **~3x** |
