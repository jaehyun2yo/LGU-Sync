import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MockUploader } from '../../src/core/webhard-uploader/mock-uploader'
import type { IWebhardUploader } from '../../src/core/types'

describe('WebhardUploader (MockUploader)', () => {
  let uploader: MockUploader

  beforeEach(() => {
    uploader = new MockUploader()
  })

  // ── Connection ──

  it('testConnection() 성공', async () => {
    const result = await uploader.testConnection()
    expect(result.success).toBe(true)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('isConnected() 기본값은 true', () => {
    expect(uploader.isConnected()).toBe(true)
  })

  it('연결 해제 시 connection-lost 이벤트가 발생한다', () => {
    const handler = vi.fn()
    uploader.on('connection-lost', handler)
    uploader.setConnected(false)
    expect(handler).toHaveBeenCalledOnce()
    expect(uploader.isConnected()).toBe(false)
  })

  // ── Folders ──

  it('createFolder() 성공', async () => {
    const result = await uploader.createFolder({ name: '원컴퍼니', parentId: null })
    expect(result.success).toBe(true)
    expect(result.data!.name).toBe('원컴퍼니')
    expect(result.data!.id).toBeTruthy()
  })

  it('findFolder() — 존재하는 폴더', async () => {
    await uploader.createFolder({ name: '원컴퍼니', parentId: null })
    const result = await uploader.findFolder('원컴퍼니', null)
    expect(result.success).toBe(true)
    expect(result.data).toBeTruthy()
    expect(result.data!.name).toBe('원컴퍼니')
  })

  it('findFolder() — 없는 폴더', async () => {
    const result = await uploader.findFolder('없는폴더', null)
    expect(result.success).toBe(true)
    expect(result.data).toBeNull()
  })

  it('ensureFolderPath() 중첩 폴더 생성', async () => {
    const result = await uploader.ensureFolderPath(['올리기전용', '원컴퍼니', '2026-02'])
    expect(result.success).toBe(true)
    expect(result.data).toBeTruthy()
  })

  // ── Files ──

  it('uploadFile() 성공', async () => {
    const folder = await uploader.createFolder({ name: 'test', parentId: null })
    const result = await uploader.uploadFile({
      folderId: folder.data!.id,
      filePath: '/tmp/test.dxf',
      originalName: 'test.dxf',
    })
    expect(result.success).toBe(true)
    expect(result.data!.name).toBe('test.dxf')
  })

  it('uploadFile() 시 upload-completed 이벤트 발생', async () => {
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

  it('fileExists() — 업로드 후 true', async () => {
    const folder = await uploader.createFolder({ name: 'test', parentId: null })
    await uploader.uploadFile({
      folderId: folder.data!.id,
      filePath: '/tmp/test.dxf',
      originalName: 'test.dxf',
    })

    const exists = await uploader.fileExists(folder.data!.id, 'test.dxf')
    expect(exists).toBe(true)
  })

  it('fileExists() — 없는 파일은 false', async () => {
    const folder = await uploader.createFolder({ name: 'test', parentId: null })
    const exists = await uploader.fileExists(folder.data!.id, 'nonexistent.dxf')
    expect(exists).toBe(false)
  })

  it('listFiles() — 업로드한 파일 목록 반환', async () => {
    const folder = await uploader.createFolder({ name: 'test', parentId: null })
    await uploader.uploadFile({
      folderId: folder.data!.id,
      filePath: '/tmp/a.dxf',
      originalName: 'a.dxf',
    })
    await uploader.uploadFile({
      folderId: folder.data!.id,
      filePath: '/tmp/b.dxf',
      originalName: 'b.dxf',
    })

    const result = await uploader.listFiles(folder.data!.id)
    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(2)
  })

  it('uploadFileBatch() 여러 파일 일괄 업로드', async () => {
    const folder = await uploader.createFolder({ name: 'batch', parentId: null })
    const progress = vi.fn()

    const result = await uploader.uploadFileBatch(
      [
        { folderId: folder.data!.id, filePath: '/tmp/1.dxf', originalName: '1.dxf' },
        { folderId: folder.data!.id, filePath: '/tmp/2.dxf', originalName: '2.dxf' },
        { folderId: folder.data!.id, filePath: '/tmp/3.dxf', originalName: '3.dxf' },
      ],
      progress,
    )

    expect(result.total).toBe(3)
    expect(result.success).toBe(3)
    expect(result.failed).toBe(0)
    expect(progress).toHaveBeenCalledTimes(3)
  })

  // ── Disconnected State ──

  it('연결 해제 상태에서 uploadFile은 실패한다', async () => {
    uploader.setConnected(false)
    const result = await uploader.uploadFile({
      folderId: 'any',
      filePath: '/tmp/test.dxf',
      originalName: 'test.dxf',
    })
    expect(result.success).toBe(false)
  })

  it('IWebhardUploader 인터페이스를 준수한다', () => {
    const _uploader: IWebhardUploader = uploader
    expect(_uploader).toBeDefined()
  })
})
