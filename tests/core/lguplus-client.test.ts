import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { LGUplusClient } from '../../src/core/lguplus-client'
import { Logger } from '../../src/core/logger'
import { RetryManager } from '../../src/core/retry-manager'
import { lguplusHandlers, resetMockSession } from '../mocks/lguplus-handlers'
import {
  AuthSessionExpiredError,
  ApiResponseParseError,
  NetworkConnectionError,
  FileDownloadSizeMismatchError,
  FileDownloadTransferError,
} from '../../src/core/errors'

vi.mock('node:fs/promises')

// Mock node:fs for createWriteStream
vi.mock('node:fs', () => {
  const { PassThrough } = require('node:stream')
  return {
    createWriteStream: vi.fn(() => {
      const stream = new PassThrough()
      let bytesWritten = 0
      const originalWrite = stream.write.bind(stream)
      stream.write = (chunk: Buffer, ...args: any[]) => {
        bytesWritten += chunk.byteLength
        return originalWrite(chunk, ...args)
      }
      stream.on('end', () => stream.emit('finish'))
      return stream
    }),
  }
})

const server = setupServer(...lguplusHandlers)

describe('LGUplusClient', () => {
  let client: LGUplusClient
  let logger: Logger
  let retry: RetryManager

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' })
  })

  afterAll(() => {
    server.close()
  })

  beforeEach(() => {
    server.resetHandlers()
    resetMockSession()
    logger = new Logger({ minLevel: 'error' })
    retry = new RetryManager(logger)
    client = new LGUplusClient('https://only.webhard.co.kr', logger, retry)
  })

  // ── Auth ──

  describe('Auth', () => {
    it('login() 성공 시 세션을 저장한다', async () => {
      const result = await client.login('testuser', 'testpass')
      expect(result.success).toBe(true)
      expect(client.isAuthenticated()).toBe(true)
    })

    it('login() 실패 시 success=false와 message를 반환', async () => {
      const result = await client.login('baduser', 'badpass')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.message).toBeTruthy()
      }
      expect(client.isAuthenticated()).toBe(false)
    })

    it('logout() 후 인증 상태가 해제된다', async () => {
      await client.login('testuser', 'testpass')
      expect(client.isAuthenticated()).toBe(true)
      await client.logout()
      expect(client.isAuthenticated()).toBe(false)
    })

    it('validateSession() — 유효한 세션', async () => {
      await client.login('testuser', 'testpass')
      const valid = await client.validateSession()
      expect(valid).toBe(true)
    })

    it('validateSession() — 미인증 시 false', async () => {
      const valid = await client.validateSession()
      expect(valid).toBe(false)
    })
  })

  // ── Folders ──

  describe('Folders', () => {
    beforeEach(async () => {
      await client.login('testuser', 'testpass')
    })

    it('getGuestFolderRootId() — 루트 폴더 ID 반환', async () => {
      const rootId = await client.getGuestFolderRootId()
      expect(rootId).toBe(1000)
    })

    it('getSubFolders() — 하위 폴더 목록 반환', async () => {
      const folders = await client.getSubFolders(1000)
      expect(folders).toHaveLength(2)
      expect(folders[0].folderName).toBe('올리기전용')
    })

    it('findFolderByName() — 이름으로 폴더 ID 찾기', async () => {
      const id = await client.findFolderByName(1000, '올리기전용')
      expect(id).toBe(1001)
    })

    it('findFolderByName() — 없는 폴더는 null', async () => {
      const id = await client.findFolderByName(1000, '없는폴더')
      expect(id).toBeNull()
    })
  })

  // ── Files & History ──

  describe('Files & History', () => {
    beforeEach(async () => {
      await client.login('testuser', 'testpass')
    })

    it('getFileList() — 파일 목록 반환', async () => {
      const { items, total } = await client.getFileList(1001)
      expect(items).toHaveLength(1)
      expect(items[0].itemName).toBe('test.dxf')
      expect(total).toBe(1)
    })

    it('getUploadHistory() — 업로드 이력 반환', async () => {
      const history = await client.getUploadHistory()
      expect(history.items).toHaveLength(2)
      expect(history.items[0].historyNo).toBe(101)
    })

    it('getDownloadUrlInfo() — 다운로드 URL 정보 반환', async () => {
      const info = await client.getDownloadUrlInfo(5001)
      expect(info).toBeTruthy()
      expect(info!.fileName).toBe('test.dxf')
      expect(info!.fileSize).toBe(10240)
    })
  })

  // ── Download ──

  describe('Download', () => {
    beforeEach(async () => {
      await client.login('testuser', 'testpass')
      const { mkdir, unlink } = await import('node:fs/promises')
      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(unlink).mockResolvedValue(undefined)
    })

    it('성공 시 파일을 다운로드하고 결과를 반환한다', async () => {
      const result = await client.downloadFile(5001, '/tmp/test.dxf')
      expect(result).toEqual({ success: true, size: 10240, filename: 'test.dxf' })
      const { createWriteStream } = await import('node:fs')
      expect(createWriteStream).toHaveBeenCalled()
    })

    it('파일 없음 (fileId=9999) → success: false', async () => {
      const result = await client.downloadFile(9999, '/tmp/missing.dxf')
      expect(result).toEqual({ success: false, size: 0, filename: '' })
    })

    it('크기 불일치 시 FileDownloadSizeMismatchError를 throw한다', async () => {
      server.use(
        http.get('https://whfile1.webhard.co.kr/file/download', () => {
          const content = Buffer.alloc(5000, 0x41)
          return new HttpResponse(content, {
            status: 200,
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '5000' },
          })
        }),
      )
      await expect(client.downloadFile(5001, '/tmp/test.dxf')).rejects.toThrow(
        FileDownloadSizeMismatchError,
      )
    })

    it('서버 500 시 FileDownloadTransferError를 throw한다', async () => {
      server.use(
        http.get('https://whfile1.webhard.co.kr/file/download', () => {
          return new HttpResponse(null, { status: 500 })
        }),
      )
      await expect(client.downloadFile(5001, '/tmp/test.dxf')).rejects.toThrow(
        FileDownloadTransferError,
      )
    })

    it('onProgress 콜백이 호출된다', async () => {
      const progress = vi.fn()
      await client.downloadFile(5001, '/tmp/test.dxf', progress)
      expect(progress).toHaveBeenCalledWith(10240, 10240)
    })
  })

  // ── callWhApi 세션 재시도 ──

  describe('callWhApi 세션 재시도', () => {
    beforeEach(async () => {
      await client.login('testuser', 'testpass')
    })

    it('RESULT_CODE=9999 → refreshSession → 재시도 성공', async () => {
      let callCount = 0
      server.use(
        http.post('https://only.webhard.co.kr/wh', async () => {
          callCount++
          if (callCount === 1) {
            return HttpResponse.json({
              RESULT_CODE: '9999',
              RESULT_MSG: '로그인이 필요합니다',
            })
          }
          return HttpResponse.json({
            RESULT_CODE: '0000',
            RESULT_MSG: 'OK',
            ITEM_FOLDER: [{ FOLDER_ID: 1000, FOLDER_NAME: 'HOME', UPPER_FOLDER_ID: 0 }],
          })
        }),
      )

      const rootId = await client.getGuestFolderRootId()
      expect(rootId).toBe(1000)
      expect(callCount).toBe(2)
    })

    it('세션 만료 후 refreshSession 실패 → AuthSessionExpiredError', async () => {
      server.use(
        http.post('https://only.webhard.co.kr/wh', async () => {
          return HttpResponse.json({
            RESULT_CODE: '9999',
            RESULT_MSG: '로그인이 필요합니다',
          })
        }),
        http.get('https://only.webhard.co.kr/login', () => {
          return new HttpResponse('<html><title>Login</title></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          })
        }),
        http.post('https://only.webhard.co.kr/login-process', () => {
          return new HttpResponse(null, {
            status: 302,
            headers: { Location: '/login?error=1' },
          })
        }),
      )

      await expect(client.getGuestFolderRootId()).rejects.toThrow(AuthSessionExpiredError)
    })

    it('HTML 응답(세션 만료) → refreshSession → 재시도 성공', async () => {
      let callCount = 0
      server.use(
        http.post('https://only.webhard.co.kr/wh', async () => {
          callCount++
          if (callCount === 1) {
            return new HttpResponse('<!DOCTYPE html><html><body>Login Required</body></html>', {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            })
          }
          return HttpResponse.json({
            RESULT_CODE: '0000',
            RESULT_MSG: 'OK',
            ITEM_FOLDER: [{ FOLDER_ID: 1000, FOLDER_NAME: 'HOME' }],
          })
        }),
      )

      const rootId = await client.getGuestFolderRootId()
      expect(rootId).toBe(1000)
    })

    it('JSON 파싱 실패 → ApiResponseParseError', async () => {
      server.use(
        http.post('https://only.webhard.co.kr/wh', async () => {
          return new HttpResponse('not-json-but-not-html-either', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          })
        }),
      )

      await expect(client.getGuestFolderRootId()).rejects.toThrow(ApiResponseParseError)
    })

    it('빈 응답 → 에러 없이 처리', async () => {
      server.use(
        http.post('https://only.webhard.co.kr/wh', async () => {
          return new HttpResponse('  ', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }),
      )

      // 빈 응답 → RESULT_CODE=0000으로 처리 → 폴더 없으므로 null
      const rootId = await client.getGuestFolderRootId()
      expect(rootId).toBeNull()
    })
  })

  // ── callWhApi 네트워크 재시도 ──

  describe('callWhApi 네트워크 재시도', () => {
    beforeEach(async () => {
      await client.login('testuser', 'testpass')
    })

    it('네트워크 에러 → 재시도 후 성공', async () => {
      let callCount = 0
      server.use(
        http.post('https://only.webhard.co.kr/wh', async () => {
          callCount++
          if (callCount === 1) {
            return HttpResponse.error()
          }
          return HttpResponse.json({
            RESULT_CODE: '0000',
            RESULT_MSG: 'OK',
            ITEM_FOLDER: [{ FOLDER_ID: 1000, FOLDER_NAME: 'HOME' }],
          })
        }),
      )

      const rootId = await client.getGuestFolderRootId()
      expect(rootId).toBe(1000)
      expect(callCount).toBeGreaterThanOrEqual(2)
    })

    it('네트워크 3회 모두 실패 → NetworkConnectionError', async () => {
      server.use(
        http.post('https://only.webhard.co.kr/wh', async () => {
          return HttpResponse.error()
        }),
      )

      await expect(client.getGuestFolderRootId()).rejects.toThrow(NetworkConnectionError)
    })
  })

  // ── 세션 이벤트 ──

  describe('세션 이벤트', () => {
    it('session-expired 이벤트에 reason이 전달된다', async () => {
      const handler = vi.fn()
      client.on('session-expired', handler)

      await client.login('testuser', 'testpass')

      server.use(
        http.post('https://only.webhard.co.kr/wh', async () => {
          return HttpResponse.json({
            RESULT_CODE: '9999',
            RESULT_MSG: '로그인이 필요합니다',
          })
        }),
        http.get('https://only.webhard.co.kr/login', () => {
          return new HttpResponse('<html><title>Login</title></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          })
        }),
        http.post('https://only.webhard.co.kr/login-process', () => {
          return new HttpResponse(null, {
            status: 302,
            headers: { Location: '/login?error=1' },
          })
        }),
      )

      try {
        await client.getGuestFolderRootId()
      } catch {
        // expected
      }

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.any(String) }),
      )
    })

    it('session-refreshed 이벤트가 재로그인 성공 시 발행된다', async () => {
      const handler = vi.fn()
      client.on('session-refreshed', handler)

      await client.login('testuser', 'testpass')

      let callCount = 0
      server.use(
        http.post('https://only.webhard.co.kr/wh', async () => {
          callCount++
          if (callCount === 1) {
            return HttpResponse.json({
              RESULT_CODE: '9999',
              RESULT_MSG: '로그인이 필요합니다',
            })
          }
          return HttpResponse.json({
            RESULT_CODE: '0000',
            RESULT_MSG: 'OK',
            ITEM_FOLDER: [],
          })
        }),
      )

      await client.getGuestFolderRootId()
      expect(handler).toHaveBeenCalled()
    })
  })
})
