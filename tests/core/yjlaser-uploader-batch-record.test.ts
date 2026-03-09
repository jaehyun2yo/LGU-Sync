import { describe, it, expect, vi, beforeEach } from 'vitest'
import { YjlaserUploader } from '../../src/core/webhard-uploader/yjlaser-uploader'
import type { ILogger } from '../../src/core/types/logger.types'
import type { IRetryManager } from '../../src/core/types/retry-manager.types'

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
}))

// Mock node:fs (createReadStream for streaming upload)
vi.mock('node:fs', () => {
  const { Readable } = require('node:stream')
  return {
    createReadStream: vi.fn(() => Readable.from(Buffer.from('mock-file-content'))),
  }
})

import { stat } from 'node:fs/promises'

const mockStat = vi.mocked(stat)

const mockLogger: ILogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
}

const mockRetry: IRetryManager = {
  execute: vi.fn((fn: () => Promise<unknown>) => fn()),
  getCircuitState: vi.fn().mockReturnValue('closed'),
  resetCircuit: vi.fn(),
}

describe('YjlaserUploader.uploadFile batch-record response', () => {
  let uploader: YjlaserUploader

  beforeEach(() => {
    uploader = new YjlaserUploader(
      'https://test.yjlaser.net',
      'test-api-key',
      mockLogger,
      mockRetry,
    )
    vi.restoreAllMocks()
    // Re-apply mocks after restoreAllMocks
    vi.mocked(mockLogger.child).mockReturnThis()
    // createReadStream mock is already set up globally
    mockStat.mockResolvedValue({ size: 12 } as any)
  })

  it('should correctly parse batch-record response with { data: { files } } format', async () => {
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
    expect(result.data!.size).toBe(12)
    expect(result.data!.uploadedAt).toBeTruthy()
  })

  it('should handle empty files array in batch-record response', async () => {
    vi.spyOn(globalThis, 'fetch')
      // presign
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
      // batch-record with empty files
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: { inserted: 0, files: [] },
          }),
          { status: 200 },
        ),
      )

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
          data: {
            objectKey: 'uploads/test.ai',
            presignedUrl: '',
            publicUrl: '',
          },
          existed: true,
        }),
        { status: 200 },
      ),
    )

    const result = await uploader.uploadFile({
      folderId: 'folder-uuid',
      filePath: '/tmp/test.ai',
      originalName: 'test.ai',
    })

    expect(result.success).toBe(true)
    expect(result.data!.id).toBe('uploads/test.ai') // uses objectKey as id
  })
})
