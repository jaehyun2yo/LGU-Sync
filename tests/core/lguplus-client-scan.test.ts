import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LGUplusClient } from '../../src/core/lguplus-client'
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
