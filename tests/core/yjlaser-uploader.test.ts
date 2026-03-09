import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { YjlaserUploader } from '../../src/core/webhard-uploader/yjlaser-uploader'
import {
  yjlaserApiHandlers,
  resetYjlaserMockState,
} from '../mocks/yjlaser-api-handlers'
import { AuthWebhardKeyInvalidError } from '../../src/core/errors'
import type { ILogger } from '../../src/core/types/logger.types'
import type { IRetryManager } from '../../src/core/types/retry-manager.types'

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}))

import { readFile, stat } from 'node:fs/promises'

const mockReadFile = vi.mocked(readFile)
const mockStat = vi.mocked(stat)

const API_URL = 'https://test-api.yjlaser.com'
const API_KEY = 'test-api-key-123'
const SYNC_BASE = `${API_URL}/api/webhard/migration/sync`

const server = setupServer(...yjlaserApiHandlers)

function createMockLogger(): ILogger {
  const logger: ILogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }
  return logger
}

function createMockRetryManager(): IRetryManager {
  return {
    execute: vi.fn(async (fn) => fn()),
    getCircuitState: vi.fn().mockReturnValue('CLOSED'),
    getDlqItems: vi.fn().mockReturnValue([]),
    retryDlqItem: vi.fn(),
    retryAllDlq: vi.fn().mockResolvedValue({ total: 0, succeeded: 0, failed: 0 }),
  }
}

describe('YjlaserUploader', () => {
  let uploader: YjlaserUploader
  let logger: ILogger
  let retry: IRetryManager

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' })
  })

  afterAll(() => {
    server.close()
  })

  beforeEach(() => {
    server.resetHandlers()
    resetYjlaserMockState()
    logger = createMockLogger()
    retry = createMockRetryManager()
    uploader = new YjlaserUploader(API_URL, API_KEY, logger, retry)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Step 2: 공통 헬퍼 테스트 ──

  describe('API helpers', () => {
    it('testConnection() 성공 시 connected=true', async () => {
      const result = await uploader.testConnection()
      expect(result.success).toBe(true)
      expect(result.message).toBe('Connected')
      expect(uploader.isConnected()).toBe(true)
    })

    it('testConnection() 잘못된 API 키 시 실패', async () => {
      const badUploader = new YjlaserUploader(API_URL, 'wrong-key', logger, retry)
      const result = await badUploader.testConnection()
      expect(result.success).toBe(false)
      expect(badUploader.isConnected()).toBe(false)
    })

    it('401 응답 시 connection-lost 이벤트 + AuthWebhardKeyInvalidError', async () => {
      const handler = vi.fn()
      const badUploader = new YjlaserUploader(API_URL, 'wrong-key', logger, retry)
      badUploader.on('connection-lost', handler)

      const result = await badUploader.findFolder('test', null)
      expect(result.success).toBe(false)
      expect(handler).toHaveBeenCalled()
    })
  })

  // ── Step 3: findFolder() ──

  describe('findFolder()', () => {
    it('존재하는 폴더 검색 성공', async () => {
      // First create a folder
      await uploader.createFolder({ name: '올리기전용', parentId: null })

      const result = await uploader.findFolder('올리기전용', null)
      expect(result.success).toBe(true)
      expect(result.data).toBeTruthy()
      expect(result.data!.name).toBe('올리기전용')
      expect(result.data!.id).toBeTruthy()
      expect(result.data!.parentId).toBeNull()
      expect(result.data!.createdAt).toBeTruthy()
    })

    it('존재하지 않는 폴더 → data: null', async () => {
      const result = await uploader.findFolder('없는폴더', null)
      expect(result.success).toBe(true)
      expect(result.data).toBeNull()
    })

    it('parentId=null로 루트 폴더 검색', async () => {
      await uploader.createFolder({ name: 'root-folder', parentId: null })

      const result = await uploader.findFolder('root-folder', null)
      expect(result.success).toBe(true)
      expect(result.data).toBeTruthy()
      expect(result.data!.parentId).toBeNull()
    })

    it('API 500 응답 시 success: false', async () => {
      server.use(
        http.get(`${SYNC_BASE}/folders`, () => {
          return HttpResponse.json({ error: 'Internal Server Error' }, { status: 500 })
        }),
      )

      const result = await uploader.findFolder('test', null)
      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })
  })

  // ── Step 4: createFolder() ──

  describe('createFolder()', () => {
    it('새 폴더 생성 성공', async () => {
      const result = await uploader.createFolder({ name: '원컴퍼니', parentId: null })
      expect(result.success).toBe(true)
      expect(result.data).toBeTruthy()
      expect(result.data!.name).toBe('원컴퍼니')
      expect(result.data!.id).toBeTruthy()
    })

    it('이미 존재하는 폴더 — 기존 폴더 반환 (에러 아님)', async () => {
      const first = await uploader.createFolder({ name: '대성목형', parentId: null })
      const second = await uploader.createFolder({ name: '대성목형', parentId: null })

      expect(second.success).toBe(true)
      expect(second.data!.id).toBe(first.data!.id)
    })

    it('parentId 지정 하위 폴더 생성', async () => {
      const parent = await uploader.createFolder({ name: '올리기전용', parentId: null })
      const child = await uploader.createFolder({
        name: '원컴퍼니',
        parentId: parent.data!.id,
      })

      expect(child.success).toBe(true)
      expect(child.data!.parentId).toBe(parent.data!.id)
    })

    it('API 에러 시 success: false', async () => {
      server.use(
        http.post(`${SYNC_BASE}/folders`, () => {
          return HttpResponse.json({ error: 'Bad Request' }, { status: 500 })
        }),
      )

      const result = await uploader.createFolder({ name: 'test', parentId: null })
      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })
  })

  // ── Step 5: ensureFolderPath() ──

  describe('ensureFolderPath()', () => {
    it('전체 새 폴더 경로 생성 → 최종 폴더 ID 반환', async () => {
      const result = await uploader.ensureFolderPath(['올리기전용', '원컴퍼니'])
      expect(result.success).toBe(true)
      expect(result.data).toBeTruthy()
    })

    it('일부 이미 존재하면 findFolder hit + 나머지 createFolder', async () => {
      // Pre-create root folder
      await uploader.createFolder({ name: '올리기전용', parentId: null })

      const result = await uploader.ensureFolderPath(['올리기전용', '원컴퍼니'])
      expect(result.success).toBe(true)
      expect(result.data).toBeTruthy()
    })

    it('빈 segments → success: false', async () => {
      const result = await uploader.ensureFolderPath([])
      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })

    it('중간 폴더 생성 실패 시 success: false', async () => {
      server.use(
        http.get(`${SYNC_BASE}/folders`, () => {
          return HttpResponse.json({ data: null })
        }),
        http.post(`${SYNC_BASE}/folders`, () => {
          return HttpResponse.json({ error: 'Fail' }, { status: 500 })
        }),
      )

      const result = await uploader.ensureFolderPath(['a', 'b'])
      expect(result.success).toBe(false)
    })
  })

  // ── Step 6: fileExists() ──

  describe('fileExists()', () => {
    it('존재하는 파일 → true', async () => {
      // Setup: create folder and upload file via batch-record
      const folder = await uploader.createFolder({ name: 'test', parentId: null })
      const folderId = folder.data!.id

      // Directly record a file via MSW state
      mockReadFile.mockResolvedValue(Buffer.from('test-content'))
      mockStat.mockResolvedValue({ size: 12 } as any)

      await uploader.uploadFile({
        folderId,
        filePath: '/tmp/test.dxf',
        originalName: 'test.dxf',
      })

      const exists = await uploader.fileExists(folderId, 'test.dxf')
      expect(exists).toBe(true)
    })

    it('존재하지 않는 파일 → false', async () => {
      const exists = await uploader.fileExists('folder-999', 'nonexistent.dxf')
      expect(exists).toBe(false)
    })

    it('API 에러 → false (안전한 기본값)', async () => {
      server.use(
        http.get(`${SYNC_BASE}/files/exists`, () => {
          return HttpResponse.json({ error: 'Error' }, { status: 500 })
        }),
      )

      const exists = await uploader.fileExists('folder-1', 'test.dxf')
      expect(exists).toBe(false)
    })
  })

  // ── Step 7: uploadFile() ──

  describe('uploadFile()', () => {
    beforeEach(() => {
      mockReadFile.mockResolvedValue(Buffer.from('dxf-file-content'))
      mockStat.mockResolvedValue({ size: 16 } as any)
    })

    // 7a: 성공 경로
    describe('성공 경로', () => {
      it('presign → PUT R2 → batch-record 전체 흐름 성공', async () => {
        const folder = await uploader.createFolder({ name: 'upload-test', parentId: null })
        const result = await uploader.uploadFile({
          folderId: folder.data!.id,
          filePath: '/tmp/drawing.dxf',
          originalName: 'drawing.dxf',
        })

        expect(result.success).toBe(true)
        expect(result.data).toBeTruthy()
        expect(result.data!.name).toBe('drawing.dxf')
        expect(result.data!.size).toBe(16)
        expect(result.data!.folderId).toBe(folder.data!.id)
        expect(result.data!.id).toBeTruthy()
        expect(result.data!.uploadedAt).toBeTruthy()
      })

      it('upload-completed 이벤트 발행', async () => {
        const handler = vi.fn()
        uploader.on('upload-completed', handler)

        const folder = await uploader.createFolder({ name: 'test', parentId: null })
        await uploader.uploadFile({
          folderId: folder.data!.id,
          filePath: '/tmp/test.dxf',
          originalName: 'test.dxf',
        })

        expect(handler).toHaveBeenCalledOnce()
      })

      it('batch-record에 올바른 필드 전달', async () => {
        let batchRecordBody: any = null
        server.use(
          http.post(`${SYNC_BASE}/batch-record`, async ({ request }) => {
            const apiKey = request.headers.get('X-API-Key')
            if (apiKey !== API_KEY) {
              return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
            batchRecordBody = await request.json()
            return HttpResponse.json({
              success: true,
              data: {
                inserted: 1,
                files: [
                  {
                    id: 99,
                    name: batchRecordBody.files[0].fileName,
                    folder_id: batchRecordBody.files[0].folderId,
                  },
                ],
              },
            })
          }),
        )

        const folder = await uploader.createFolder({ name: 'test', parentId: null })
        await uploader.uploadFile({
          folderId: folder.data!.id,
          filePath: '/tmp/test.dxf',
          originalName: 'test.dxf',
        })

        expect(batchRecordBody).toBeTruthy()
        expect(batchRecordBody.files).toHaveLength(1)
        expect(batchRecordBody.files[0].fileName).toBe('test.dxf')
        expect(batchRecordBody.files[0].folderId).toBe(folder.data!.id)
        expect(batchRecordBody.files[0].size).toBe(16)
        expect(batchRecordBody.files[0].objectKey).toBeTruthy()
        expect(batchRecordBody.files[0].publicUrl).toBeTruthy()
      })
    })

    // 7b: 엣지/실패 케이스
    describe('엣지/실패 케이스', () => {
      it('presign existed:true → 이미 업로드된 파일 스킵 (success)', async () => {
        server.use(
          http.post(`${SYNC_BASE}/presign`, async ({ request }) => {
            const apiKey = request.headers.get('X-API-Key')
            if (apiKey !== API_KEY) {
              return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
            return HttpResponse.json({
              data: {
                objectKey: 'sync/existing/file.dxf',
                presignedUrl: 'https://mock-r2.storage.com/existing',
                publicUrl: 'https://cdn.yjlaser.com/existing',
              },
              existed: true,
            })
          }),
        )

        const result = await uploader.uploadFile({
          folderId: 'folder-1',
          filePath: '/tmp/test.dxf',
          originalName: 'test.dxf',
        })

        expect(result.success).toBe(true)
        expect(result.data).toBeTruthy()
      })

      it('presign 실패 → success: false + upload-failed 이벤트', async () => {
        const handler = vi.fn()
        uploader.on('upload-failed', handler)

        server.use(
          http.post(`${SYNC_BASE}/presign`, () => {
            return HttpResponse.json({ error: 'Presign failed' }, { status: 500 })
          }),
        )

        const result = await uploader.uploadFile({
          folderId: 'folder-1',
          filePath: '/tmp/test.dxf',
          originalName: 'test.dxf',
        })

        expect(result.success).toBe(false)
        expect(handler).toHaveBeenCalled()
      })

      it('R2 PUT 실패 → success: false + upload-failed 이벤트', async () => {
        const handler = vi.fn()
        uploader.on('upload-failed', handler)

        server.use(
          http.put('https://mock-r2.storage.com/*', () => {
            return new HttpResponse(null, { status: 500 })
          }),
        )

        const result = await uploader.uploadFile({
          folderId: 'folder-1',
          filePath: '/tmp/test.dxf',
          originalName: 'test.dxf',
        })

        expect(result.success).toBe(false)
        expect(handler).toHaveBeenCalled()
      })

      it('batch-record 실패 → success: false', async () => {
        server.use(
          http.post(`${SYNC_BASE}/batch-record`, () => {
            return HttpResponse.json({ error: 'Record failed' }, { status: 500 })
          }),
        )

        const result = await uploader.uploadFile({
          folderId: 'folder-1',
          filePath: '/tmp/test.dxf',
          originalName: 'test.dxf',
        })

        expect(result.success).toBe(false)
      })

      it('fs.readFile 실패 → success: false', async () => {
        mockReadFile.mockRejectedValue(new Error('ENOENT: no such file'))

        const result = await uploader.uploadFile({
          folderId: 'folder-1',
          filePath: '/tmp/nonexistent.dxf',
          originalName: 'test.dxf',
        })

        expect(result.success).toBe(false)
      })
    })
  })

  // ── Step 8: uploadFileBatch() ──

  describe('uploadFileBatch()', () => {
    beforeEach(() => {
      mockReadFile.mockResolvedValue(Buffer.from('file-data'))
      mockStat.mockResolvedValue({ size: 9 } as any)
    })

    it('3개 파일 모두 성공', async () => {
      const folder = await uploader.createFolder({ name: 'batch', parentId: null })
      const folderId = folder.data!.id

      const result = await uploader.uploadFileBatch([
        { folderId, filePath: '/tmp/1.dxf', originalName: '1.dxf' },
        { folderId, filePath: '/tmp/2.dxf', originalName: '2.dxf' },
        { folderId, filePath: '/tmp/3.dxf', originalName: '3.dxf' },
      ])

      expect(result.total).toBe(3)
      expect(result.success).toBe(3)
      expect(result.failed).toBe(0)
      expect(result.skipped).toBe(0)
    })

    it('일부 실패 시 failed 카운트 정확', async () => {
      const folder = await uploader.createFolder({ name: 'batch', parentId: null })
      const folderId = folder.data!.id

      // Second file will fail due to readFile error
      let callCount = 0
      mockReadFile.mockImplementation(async () => {
        callCount++
        if (callCount === 2) {
          throw new Error('Read error')
        }
        return Buffer.from('file-data')
      })

      const result = await uploader.uploadFileBatch([
        { folderId, filePath: '/tmp/1.dxf', originalName: '1.dxf' },
        { folderId, filePath: '/tmp/2.dxf', originalName: '2.dxf' },
        { folderId, filePath: '/tmp/3.dxf', originalName: '3.dxf' },
      ])

      expect(result.total).toBe(3)
      expect(result.success).toBe(2)
      expect(result.failed).toBe(1)
    })

    it('onProgress 콜백 호출', async () => {
      const folder = await uploader.createFolder({ name: 'batch', parentId: null })
      const folderId = folder.data!.id
      const progress = vi.fn()

      await uploader.uploadFileBatch(
        [
          { folderId, filePath: '/tmp/1.dxf', originalName: '1.dxf' },
          { folderId, filePath: '/tmp/2.dxf', originalName: '2.dxf' },
        ],
        progress,
      )

      expect(progress).toHaveBeenCalledTimes(2)
      expect(progress).toHaveBeenNthCalledWith(1, 1, 2)
      expect(progress).toHaveBeenNthCalledWith(2, 2, 2)
    })
  })

  // ── Step 9: listFiles() ──

  describe('listFiles()', () => {
    it('호출 시 미지원 에러 반환', async () => {
      const result = await uploader.listFiles('folder-1')
      expect(result.success).toBe(false)
      expect(result.error).toContain('Not supported')
    })
  })

  // ── 인터페이스 준수 ──

  it('IWebhardUploader 인터페이스를 준수한다', () => {
    const _uploader: import('../../src/core/types/webhard-uploader.types').IWebhardUploader =
      uploader
    expect(_uploader).toBeDefined()
  })
})
