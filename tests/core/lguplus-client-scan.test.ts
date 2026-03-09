import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LGUplusClient } from '../../src/core/lguplus-client'
import { FolderTreeCache } from '../../src/core/folder-tree-cache'
import type { ILogger } from '../../src/core/types/logger.types'
import type { IRetryManager } from '../../src/core/types/retry-manager.types'

function mockLogger(): ILogger {
  const noop = vi.fn()
  const child = vi.fn().mockReturnThis()
  return { debug: noop, info: noop, warn: noop, error: noop, child } as unknown as ILogger
}

function mockRetryManager(): IRetryManager {
  return {
    execute: vi.fn().mockImplementation((fn) => fn()),
    getCircuitState: vi.fn().mockReturnValue('CLOSED'),
    getDlqItems: vi.fn().mockReturnValue([]),
    retryDlqItem: vi.fn(),
    retryAllDlq: vi.fn().mockResolvedValue({ total: 0, succeeded: 0, failed: 0 }),
  }
}

describe('getAllFilesDeep - worker pool BFS', () => {
  let client: LGUplusClient

  beforeEach(() => {
    client = new LGUplusClient('https://test.example.com', mockLogger(), mockRetryManager())
  })

  it('하위 폴더가 발견되면 레벨 완료를 기다리지 않고 즉시 처리한다', async () => {
    // 시나리오: root(1) → A(10),B(20) → A1(100)
    // B는 50ms 느림. worker pool이면 A1이 B 완료 전에 시작됨
    const callOrder: string[] = []

    vi.spyOn(client, 'getSubFolders').mockImplementation(async (folderId: number) => {
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

    vi.spyOn(client, 'getAllFiles').mockImplementation(async (folderId: number) => {
      callOrder.push(`files:${folderId}`)
      // B(20)를 느리게 만듦
      if (folderId === 20) await new Promise(r => setTimeout(r, 50))
      return []
    })

    await client.getAllFilesDeep(1, { concurrency: 3 })

    // Worker pool 동작: A1(100)의 파일 처리가 B(20)의 파일 처리 완료 전에 시작되어야 함
    const filesB = callOrder.indexOf('files:20')
    const subA1 = callOrder.indexOf('sub:100')
    // A의 하위폴더(A1=100)를 발견하는 것이 B의 files 완료를 기다리지 않아야 함
    expect(subA1).toBeGreaterThan(-1)
    expect(subA1).toBeLessThan(callOrder.lastIndexOf('files:20') + callOrder.length)
  })

  it('concurrency 제한을 준수한다', async () => {
    let activeConcurrency = 0
    let maxConcurrency = 0

    // root → 10개 서브폴더
    vi.spyOn(client, 'getSubFolders').mockImplementation(async (folderId: number) => {
      if (folderId === 1) {
        return Array.from({ length: 10 }, (_, i) => ({
          folderId: 100 + i,
          folderName: `folder-${i}`,
          parentFolderId: 1,
        }))
      }
      return []
    })

    vi.spyOn(client, 'getAllFiles').mockImplementation(async () => {
      activeConcurrency++
      maxConcurrency = Math.max(maxConcurrency, activeConcurrency)
      await new Promise(r => setTimeout(r, 20))
      activeConcurrency--
      return []
    })

    await client.getAllFilesDeep(1, { concurrency: 2 })

    expect(maxConcurrency).toBeLessThanOrEqual(2)
  })

  it('getAllFiles와 getSubFolders를 동시에 호출한다', async () => {
    const timestamps: Record<string, number[]> = {}

    vi.spyOn(client, 'getSubFolders').mockImplementation(async (folderId: number) => {
      const key = `sub:${folderId}`
      timestamps[key] = [Date.now()]
      await new Promise(r => setTimeout(r, 20))
      timestamps[key].push(Date.now())
      return []
    })

    vi.spyOn(client, 'getAllFiles').mockImplementation(async (folderId: number) => {
      const key = `files:${folderId}`
      timestamps[key] = [Date.now()]
      await new Promise(r => setTimeout(r, 20))
      timestamps[key].push(Date.now())
      return []
    })

    await client.getAllFilesDeep(1, { concurrency: 1 })

    // root 폴더에 대해 getAllFiles와 getSubFolders가 거의 동시에 시작되어야 함
    const filesStart = timestamps['files:1']?.[0] ?? 0
    const subStart = timestamps['sub:1']?.[0] ?? 0
    expect(Math.abs(filesStart - subStart)).toBeLessThan(10)
  })
})

describe('getSubFolders with cache', () => {
  let client: LGUplusClient
  let cache: FolderTreeCache

  beforeEach(() => {
    cache = new FolderTreeCache({ ttlMs: 5000 })
    client = new LGUplusClient('https://test.example.com', mockLogger(), mockRetryManager(), cache)
  })

  it('두 번째 호출 시 API를 호출하지 않고 캐시에서 반환한다', async () => {
    // callWhApi를 spy하여 API 호출 횟수 추적
    const callWhApiSpy = vi.spyOn(client as any, 'callWhApi').mockResolvedValue({
      RESULT_CODE: '0000',
      ITEM_FOLDER: [
        { FOLDER_ID: 10, FOLDER_NAME: 'A', UPPER_FOLDER_ID: 1 },
        { FOLDER_ID: 20, FOLDER_NAME: 'B', UPPER_FOLDER_ID: 1 },
      ],
    })

    // 첫 호출: API 호출 → 캐시 저장
    const first = await client.getSubFolders(1)
    expect(first).toHaveLength(2)
    expect(callWhApiSpy).toHaveBeenCalledTimes(1)

    // 두 번째 호출: 캐시 히트 → API 미호출
    const second = await client.getSubFolders(1)
    expect(second).toHaveLength(2)
    expect(callWhApiSpy).toHaveBeenCalledTimes(1) // 여전히 1번만 호출
  })

  it('캐시 없이 생성된 클라이언트는 매번 API를 호출한다', async () => {
    const clientNoCache = new LGUplusClient('https://test.example.com', mockLogger(), mockRetryManager())
    const callWhApiSpy = vi.spyOn(clientNoCache as any, 'callWhApi').mockResolvedValue({
      RESULT_CODE: '0000',
      ITEM_FOLDER: [{ FOLDER_ID: 10, FOLDER_NAME: 'A', UPPER_FOLDER_ID: 1 }],
    })

    await clientNoCache.getSubFolders(1)
    await clientNoCache.getSubFolders(1)
    expect(callWhApiSpy).toHaveBeenCalledTimes(2)
  })
})

describe('getAllFiles - 병렬 페이지네이션', () => {
  let client: LGUplusClient

  beforeEach(() => {
    client = new LGUplusClient('https://test.example.com', mockLogger(), mockRetryManager())
  })

  it('100개 파일(페이지당 20개) 조회 시 page 2~5를 병렬로 가져온다', async () => {
    const fetchedPages: number[] = []

    vi.spyOn(client, 'getFileList').mockImplementation(async (_folderId, options) => {
      const page = options?.page ?? 1
      fetchedPages.push(page)
      await new Promise(r => setTimeout(r, 50))
      return {
        items: Array.from({ length: 20 }, (_, i) => ({
          itemId: (page - 1) * 20 + i,
          itemName: `file-${(page - 1) * 20 + i}.dxf`,
          itemSize: 1024,
          itemExtension: 'dxf',
          parentFolderId: 1,
          updatedAt: '2026-01-01',
          isFolder: false,
        })),
        total: 100,
      }
    })

    const start = Date.now()
    const files = await client.getAllFiles(1)
    const elapsed = Date.now() - start

    expect(files).toHaveLength(100)
    // 순차이면 ~250ms (5*50ms), 병렬이면 ~100ms (page1 + 나머지 batch)
    expect(elapsed).toBeLessThan(200)
  })

  it('단일 페이지이면 추가 fetch 없음', async () => {
    vi.spyOn(client, 'getFileList').mockResolvedValue({
      items: [
        { itemId: 1, itemName: 'only.dxf', itemSize: 100, itemExtension: 'dxf', parentFolderId: 1, updatedAt: '2026-01-01', isFolder: false },
      ],
      total: 1,
    })

    const files = await client.getAllFiles(1)

    expect(files).toHaveLength(1)
    expect(client.getFileList).toHaveBeenCalledTimes(1)
  })
})
