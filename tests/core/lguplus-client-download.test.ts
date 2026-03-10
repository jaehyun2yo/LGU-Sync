import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LGUplusClient } from '../../src/core/lguplus-client'
import { FileDownloadUrlFetchError } from '../../src/core/errors'
import type { ILogger } from '../../src/core/types/logger.types'
import type { IRetryManager } from '../../src/core/types/retry-manager.types'

// Mock fs/promises to avoid actual file writes
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

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

// Helper: create a ReadableStream that yields chunks of given sizes
function createChunkedStream(chunkSizes: number[]): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index < chunkSizes.length) {
        const size = chunkSizes[index]
        controller.enqueue(new Uint8Array(size).fill(65)) // fill with 'A'
        index++
      } else {
        controller.close()
      }
    },
  })
}

describe('downloadFile streaming progress', () => {
  let client: LGUplusClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    const mockLogger = createMockLogger()
    const mockRetry = createMockRetry()
    client = new LGUplusClient('https://only.webhard.co.kr', mockLogger, mockRetry)
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should call onProgress multiple times during streaming download', async () => {
    const totalSize = 3000
    const chunkSizes = [1000, 1000, 1000] // 3 chunks

    // Mock getDownloadUrlInfo
    vi.spyOn(client as any, 'getDownloadUrlInfo').mockResolvedValue({
      url: 'https://example.com/download',
      session: 'sess',
      nonce: 'nonce',
      userId: 'user',
      fileOwnerEncId: 'owner',
      fileName: 'test.txt',
      fileSize: totalSize,
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: createChunkedStream(chunkSizes),
      headers: new Headers(),
    })

    const onProgress = vi.fn()

    const result = await client.downloadFile(12345, '/tmp/test.txt', onProgress)
    expect(result.success).toBe(true)
    expect(result.size).toBe(totalSize)

    // onProgress should be called more than once (intermediate + final)
    expect(onProgress.mock.calls.length).toBeGreaterThan(1)

    // Last call should report full size
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1]
    expect(lastCall[0]).toBe(totalSize)
    expect(lastCall[1]).toBe(totalSize)
  })

  it('should report increasing progress bytes', async () => {
    const totalSize = 5000
    const chunkSizes = [1000, 1500, 1200, 1300]

    vi.spyOn(client as any, 'getDownloadUrlInfo').mockResolvedValue({
      url: 'https://example.com/download',
      session: 'sess',
      nonce: 'nonce',
      userId: 'user',
      fileOwnerEncId: 'owner',
      fileName: 'test.txt',
      fileSize: totalSize,
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: createChunkedStream(chunkSizes),
      headers: new Headers(),
    })

    const progressCalls: Array<[number, number]> = []
    const onProgress = vi.fn((downloaded: number, total: number) => {
      progressCalls.push([downloaded, total])
    })

    await client.downloadFile(12345, '/tmp/test.txt', onProgress)

    // Bytes should be monotonically increasing
    for (let i = 1; i < progressCalls.length; i++) {
      expect(progressCalls[i][0]).toBeGreaterThanOrEqual(progressCalls[i - 1][0])
    }

    // All calls should report the same total
    for (const [, total] of progressCalls) {
      expect(total).toBe(totalSize)
    }

    // Final reported bytes should equal totalSize
    expect(progressCalls[progressCalls.length - 1][0]).toBe(totalSize)
  })

  it('should fallback to buffer when res.body is null', async () => {
    const totalSize = 2000

    vi.spyOn(client as any, 'getDownloadUrlInfo').mockResolvedValue({
      url: 'https://example.com/download',
      session: 'sess',
      nonce: 'nonce',
      userId: 'user',
      fileOwnerEncId: 'owner',
      fileName: 'test.txt',
      fileSize: totalSize,
    })

    const buffer = new ArrayBuffer(totalSize)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      arrayBuffer: () => Promise.resolve(buffer),
      headers: new Headers(),
    })

    const onProgress = vi.fn()

    const result = await client.downloadFile(12345, '/tmp/test.txt', onProgress)
    expect(result.success).toBe(true)
    // Fallback should still call onProgress at least once
    expect(onProgress).toHaveBeenCalledWith(totalSize, totalSize)
  })
})

describe('downloadFile error handling', () => {
  let client: LGUplusClient
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    const mockLogger = createMockLogger()
    const mockRetry = createMockRetry()
    client = new LGUplusClient('https://only.webhard.co.kr', mockLogger, mockRetry)
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('getDownloadUrlInfo가 null이면 FileDownloadUrlFetchError를 throw한다', async () => {
    vi.spyOn(client as any, 'getDownloadUrlInfo').mockResolvedValue(null)

    await expect(client.downloadFile(12345, '/tmp/test.dxf')).rejects.toThrow(
      /Failed to get download URL/,
    )
  })

  it('throw된 에러가 FileDownloadUrlFetchError 인스턴스이다', async () => {
    vi.spyOn(client as any, 'getDownloadUrlInfo').mockResolvedValue(null)

    try {
      await client.downloadFile(99999, '/tmp/test.dxf')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(FileDownloadUrlFetchError)
      expect((err as any).context.fileId).toBe(99999)
    }
  })
})
