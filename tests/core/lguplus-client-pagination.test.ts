import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LGUplusClient } from '../../src/core/lguplus-client'
import type { ILogger } from '../../src/core/types/logger.types'
import type { IRetryManager } from '../../src/core/types/retry.types'

function createMockLogger(): ILogger {
  const logger: any = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    flush: vi.fn(),
    child: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  return logger as ILogger
}

function createMockRetry(): IRetryManager {
  return {
    execute: vi.fn(),
    getCircuitState: vi.fn(),
    resetCircuit: vi.fn(),
  } as unknown as IRetryManager
}

function makeFileItem(id: number) {
  return {
    itemId: id,
    itemName: `file-${id}.txt`,
    itemSize: 1000,
    itemExtension: 'txt',
    parentFolderId: 1,
    updatedAt: '2026-01-01',
    isFolder: false,
  }
}

describe('getAllFiles pagination resilience', () => {
  let client: LGUplusClient
  let mockLogger: ILogger

  beforeEach(() => {
    mockLogger = createMockLogger()
    const mockRetry = createMockRetry()
    client = new LGUplusClient('https://only.webhard.co.kr', mockLogger, mockRetry)
  })

  it('should continue fetching remaining pages when a batch fails', async () => {
    // Setup: 7 pages total, 2 items per page = 14 items total
    // Page 1: fetched normally (first call)
    // Batch 1 (pages 2,3,4): succeeds → 6 more items
    // Batch 2 (pages 5,6,7): Promise.all fails → individual retry
    //   - Page 5: succeeds individually → 2 more items
    //   - Page 6: fails individually → skipped
    //   - Page 7: succeeds individually → 2 more items

    let callCount = 0
    vi.spyOn(client as any, 'getFileList').mockImplementation(
      async (_folderId: number, opts?: { page?: number }) => {
        callCount++
        const page = opts?.page ?? 1

        // Page 1: initial call
        if (page === 1) {
          return { items: [makeFileItem(1), makeFileItem(2)], total: 14 }
        }

        // Pages 2-4: succeed normally (called in batch via Promise.all)
        if (page >= 2 && page <= 4) {
          return { items: [makeFileItem(page * 10), makeFileItem(page * 10 + 1)], total: 14 }
        }

        // Pages 5-7: first call in Promise.all batch → fail
        // On individual retry: page 5 and 7 succeed, page 6 fails
        if (page === 5 || page === 7) {
          // Check if this is a batch call (callCount <= 10 means batch phase)
          // or individual retry. Since Promise.all fails on first error,
          // individual retry calls will always succeed for page 5 and 7
          if (callCount <= 7) {
            // Batch phase: page 5 or 6 or 7 called together, make one fail
            if (page === 5) throw new Error('Batch network error')
          }
          return { items: [makeFileItem(page * 10), makeFileItem(page * 10 + 1)], total: 14 }
        }

        if (page === 6) {
          throw new Error('Page 6 always fails')
        }

        return { items: [], total: 14 }
      },
    )

    const result = await client.getAllFiles(1)

    // Should have items from: page 1 (2) + batch 1 pages 2,3,4 (6) + retried page 5 (2) + retried page 7 (2) = 12
    // Page 6 failed individually → skipped
    expect(result.length).toBe(12)

    // Logger should have been called for the batch failure and page 6 skip
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should return all items when no failures occur', async () => {
    vi.spyOn(client as any, 'getFileList').mockImplementation(
      async (_folderId: number, opts?: { page?: number }) => {
        const page = opts?.page ?? 1
        if (page === 1) {
          return { items: [makeFileItem(1), makeFileItem(2)], total: 4 }
        }
        return { items: [makeFileItem(3), makeFileItem(4)], total: 4 }
      },
    )

    const result = await client.getAllFiles(1)
    expect(result.length).toBe(4)
  })

  it('should return first page items even if all subsequent batches fail', async () => {
    vi.spyOn(client as any, 'getFileList').mockImplementation(
      async (_folderId: number, opts?: { page?: number }) => {
        const page = opts?.page ?? 1
        if (page === 1) {
          return { items: [makeFileItem(1), makeFileItem(2)], total: 6 }
        }
        throw new Error('All other pages fail')
      },
    )

    const result = await client.getAllFiles(1)
    // Should still have the first page results
    expect(result.length).toBe(2)
    // Both batch failure and individual page failures should be logged
    expect(mockLogger.warn).toHaveBeenCalled()
  })
})
