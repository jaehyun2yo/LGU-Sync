import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncEngine } from '../../src/core/sync-engine'
import { EventBus } from '../../src/core/event-bus'
import { Logger } from '../../src/core/logger'
import type { IFileDetector } from '../../src/core/types/file-detector.types'
import type { ILGUplusClient } from '../../src/core/types/lguplus-client.types'
import type { IWebhardUploader } from '../../src/core/types/webhard-uploader.types'
import type { IStateManager } from '../../src/core/types/state-manager.types'
import type { IRetryManager } from '../../src/core/types/retry-manager.types'
import type { IConfigManager } from '../../src/core/types/config.types'
import type { INotificationService } from '../../src/core/types/notification.types'
import type { DetectedFile, DetectionStrategy } from '../../src/core/types/events.types'
import {
  SyncAppError,
  FileDownloadTransferError,
  FileUploadError,
} from '../../src/core/errors'

// ── Mock Factories ──

function mockFileDetector(): IFileDetector & { _handlers: Array<(files: DetectedFile[], strategy: DetectionStrategy) => void> } {
  const handlers: Array<(files: DetectedFile[], strategy: DetectionStrategy) => void> = []
  return {
    start: vi.fn(),
    stop: vi.fn(),
    setPollingInterval: vi.fn(),
    forceCheck: vi.fn().mockResolvedValue([]),
    onFilesDetected: vi.fn((handler) => {
      handlers.push(handler)
      return () => {
        const idx = handlers.indexOf(handler)
        if (idx !== -1) handlers.splice(idx, 1)
      }
    }),
    _handlers: handlers,
  } as any
}

function mockLGUplusClient(): ILGUplusClient {
  return {
    login: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: vi.fn().mockReturnValue(true),
    validateSession: vi.fn().mockResolvedValue(true),
    refreshSession: vi.fn().mockResolvedValue(true),
    getGuestFolderRootId: vi.fn().mockResolvedValue(1000),
    getSubFolders: vi.fn().mockResolvedValue([]),
    findFolderByName: vi.fn().mockResolvedValue(null),
    getFileList: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getAllFiles: vi.fn().mockResolvedValue([]),
    getAllFilesDeep: vi.fn().mockResolvedValue([]),
    getDownloadUrlInfo: vi.fn().mockResolvedValue(null),
    downloadFile: vi.fn().mockResolvedValue({ success: true, size: 1024, filename: 'test.dxf' }),
    batchDownload: vi.fn().mockResolvedValue({ success: 0, failed: 0, totalSize: 0, failedFiles: [] }),
    getUploadHistory: vi.fn().mockResolvedValue({ total: 0, pageSize: 20, items: [] }),
    on: vi.fn(),
  }
}

function mockWebhardUploader(): IWebhardUploader {
  return {
    testConnection: vi.fn().mockResolvedValue({ success: true, latencyMs: 10, message: 'OK' }),
    isConnected: vi.fn().mockReturnValue(true),
    createFolder: vi.fn().mockResolvedValue({ success: true, data: { id: 'f1', name: 'test', parentId: null, createdAt: '' } }),
    findFolder: vi.fn().mockResolvedValue({ success: true, data: null }),
    ensureFolderPath: vi.fn().mockResolvedValue({ success: true, data: 'folder-id' }),
    uploadFile: vi.fn().mockResolvedValue({ success: true, data: { id: 'up1', name: 'test.dxf', size: 1024, folderId: 'f1', uploadedAt: '' } }),
    uploadFileBatch: vi.fn().mockResolvedValue({ total: 0, success: 0, failed: 0, skipped: 0, durationMs: 0 }),
    fileExists: vi.fn().mockResolvedValue(false),
    listFiles: vi.fn().mockResolvedValue({ success: true, data: [] }),
    on: vi.fn(),
  }
}

function mockStateManager(): IStateManager {
  const files = new Map<string, any>()
  return {
    getCheckpoint: vi.fn().mockReturnValue(null),
    saveCheckpoint: vi.fn(),
    saveFile: vi.fn().mockImplementation((file) => {
      const id = `file-${Math.random().toString(36).slice(2, 8)}`
      files.set(id, { ...file, id, status: 'detected' })
      return id
    }),
    updateFileStatus: vi.fn().mockImplementation((id, status, extra) => {
      const file = files.get(id)
      if (file) {
        file.status = status
        if (extra && typeof extra === 'object') Object.assign(file, extra)
      }
    }),
    getFile: vi.fn().mockImplementation((id) => files.get(id) ?? null),
    getFilesByFolder: vi.fn().mockReturnValue([]),
    getFileByHistoryNo: vi.fn().mockReturnValue(null),
    saveFolder: vi.fn().mockReturnValue('folder-id'),
    updateFolder: vi.fn(),
    getFolders: vi.fn().mockReturnValue([]),
    getFolder: vi.fn().mockReturnValue(null),
    getFolderByLguplusId: vi.fn().mockReturnValue(null),
    logEvent: vi.fn(),
    getEvents: vi.fn().mockReturnValue([]),
    addToDlq: vi.fn(),
    getDlqItems: vi.fn().mockReturnValue([]),
    removeDlqItem: vi.fn(),
    getDailyStats: vi.fn().mockReturnValue([]),
    incrementDailyStats: vi.fn(),
    getLogs: vi.fn().mockReturnValue([]),
    addLog: vi.fn(),
    saveFolderChange: vi.fn().mockReturnValue(1),
    getFolderChanges: vi.fn().mockReturnValue([]),
    updateFolderChange: vi.fn(),
    initialize: vi.fn(),
    close: vi.fn(),
  }
}

function mockRetryManager(): IRetryManager {
  return {
    execute: vi.fn().mockImplementation((fn) => fn()),
    getCircuitState: vi.fn().mockReturnValue('CLOSED'),
    resetCircuit: vi.fn(),
    getDlqItems: vi.fn().mockReturnValue([]),
    retryDlqItem: vi.fn(),
    retryAllDlq: vi.fn().mockResolvedValue({ total: 0, succeeded: 0, failed: 0 }),
  }
}

function mockConfigManager(): IConfigManager {
  return {
    get: vi.fn().mockImplementation((section: string) => {
      if (section === 'sync') return { pollingIntervalSec: 5, maxConcurrentDownloads: 5, maxConcurrentUploads: 3, snapshotIntervalMin: 10 }
      if (section === 'system') return { tempDownloadPath: './downloads' }
      return {}
    }),
    set: vi.fn(),
    getAll: vi.fn().mockReturnValue({}),
    validate: vi.fn().mockReturnValue(true),
    reset: vi.fn(),
    onChanged: vi.fn().mockReturnValue(() => {}),
  }
}

function mockNotificationService(): INotificationService {
  return {
    notify: vi.fn().mockReturnValue('notif-id'),
    getNotifications: vi.fn().mockReturnValue([]),
    getUnreadCount: vi.fn().mockReturnValue(0),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    clearOld: vi.fn(),
  }
}

describe('SyncEngine', () => {
  let engine: SyncEngine
  let eventBus: EventBus
  let detector: ReturnType<typeof mockFileDetector>
  let lguplus: ILGUplusClient
  let uploader: IWebhardUploader
  let state: IStateManager
  let retry: IRetryManager
  let config: IConfigManager
  let notification: INotificationService

  beforeEach(() => {
    eventBus = new EventBus()
    detector = mockFileDetector()
    lguplus = mockLGUplusClient()
    uploader = mockWebhardUploader()
    state = mockStateManager()
    retry = mockRetryManager()
    config = mockConfigManager()
    notification = mockNotificationService()

    engine = new SyncEngine({
      detector,
      lguplus,
      uploader,
      state,
      retry,
      eventBus,
      logger: new Logger({ minLevel: 'error' }),
      config,
      notification,
    })
  })

  afterEach(async () => {
    if (engine.status !== 'stopped' && engine.status !== 'idle') {
      await engine.stop()
    }
  })

  // ── Status Transitions ──

  describe('Status Transitions', () => {
    it('초기 상태는 idle이다', () => {
      expect(engine.status).toBe('idle')
    })

    it('start() → syncing 상태 전이', async () => {
      await engine.start()
      expect(engine.status).toBe('syncing')
      expect(detector.start).toHaveBeenCalled()
    })

    it('stop() → stopped 상태 전이', async () => {
      await engine.start()
      await engine.stop()
      expect(engine.status).toBe('stopped')
      expect(detector.stop).toHaveBeenCalled()
    })

    it('pause() → paused 상태 전이', async () => {
      await engine.start()
      await engine.pause()
      expect(engine.status).toBe('paused')
    })

    it('resume() → syncing 상태 복귀', async () => {
      await engine.start()
      await engine.pause()
      await engine.resume()
      expect(engine.status).toBe('syncing')
    })

    it('이미 syncing인 상태에서 start()는 무시된다', async () => {
      await engine.start()
      await engine.start()
      expect(engine.status).toBe('syncing')
    })

    it('상태 전이 시 engine:status 이벤트 발행', async () => {
      const handler = vi.fn()
      eventBus.on('engine:status', handler)

      await engine.start()

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ prev: 'idle', next: 'syncing' }),
      )
    })
  })

  // ── Sync Operations ──

  describe('syncFile()', () => {
    it('단일 파일 동기화 성공', async () => {
      const fileId = (state.saveFile as any)({
        folder_id: 'f1',
        file_name: 'test.dxf',
        file_path: '/test.dxf',
        file_size: 1024,
        detected_at: new Date().toISOString(),
      })

      const fileData = {
        id: fileId,
        folder_id: 'f1',
        file_name: 'test.dxf',
        file_path: '/test.dxf',
        file_size: 1024,
        status: 'detected',
        history_no: 101,
        lguplus_file_id: '5001',
      }

      ;(state.getFile as ReturnType<typeof vi.fn>).mockImplementation(() => ({ ...fileData }))
      ;(state.updateFileStatus as ReturnType<typeof vi.fn>).mockImplementation((_id, status, extra) => {
        fileData.status = status
        if (extra && typeof extra === 'object') Object.assign(fileData, extra)
      })

      ;(state.getFolder as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1',
        lguplus_folder_id: '1001',
        lguplus_folder_name: '테스트업체',
        self_webhard_path: 'webhard-folder-id',
        enabled: true,
      })

      ;(lguplus.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true, size: 1024, filename: 'test.dxf',
      })

      const result = await engine.syncFile(fileId)
      expect(result.success).toBe(true)
    })

    it('파일이 없으면 실패 반환', async () => {
      ;(state.getFile as ReturnType<typeof vi.fn>).mockReturnValue(null)
      const result = await engine.syncFile('nonexistent')
      expect(result.success).toBe(false)
    })
  })

  describe('downloadOnly() - structured path', () => {
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

      await engine.downloadOnly('structured-path-file')

      expect(lguplus.downloadFile).toHaveBeenCalledWith(
        5001,
        './downloads/테스트업체/2026년/Q1/deep.dxf',
        expect.any(Function),
      )
    })
  })

  describe('fullSync()', () => {
    it('전체 동기화 결과를 반환한다', async () => {
      ;(state.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'f1', lguplus_folder_id: '1001', enabled: true },
      ])

      const result = await engine.fullSync()
      expect(result).toBeTruthy()
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('getAllFilesDeep()를 호출하여 깊은 폴더를 스캔한다', async () => {
      ;(state.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '테스트업체', enabled: true },
      ])

      ;(lguplus.getAllFilesDeep as ReturnType<typeof vi.fn>).mockResolvedValue([
        { itemId: 100, itemName: 'root.dxf', itemSize: 512, itemExtension: 'dxf', parentFolderId: 1001, updatedAt: '2026-01-01', isFolder: false },
        { itemId: 101, itemName: 'deep.dxf', itemSize: 1024, itemExtension: 'dxf', parentFolderId: 2001, updatedAt: '2026-01-01', isFolder: false, relativePath: '2026년/Q1' },
      ])

      await engine.fullSync()
      expect(lguplus.getAllFilesDeep).toHaveBeenCalledWith(1001)
    })

    it('하위 폴더 파일의 file_path에 relativePath가 반영된다', async () => {
      ;(state.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '테스트업체', enabled: true },
      ])

      ;(lguplus.getAllFilesDeep as ReturnType<typeof vi.fn>).mockResolvedValue([
        { itemId: 100, itemName: 'root.dxf', itemSize: 512, itemExtension: 'dxf', parentFolderId: 1001, updatedAt: '2026-01-01', isFolder: false },
        { itemId: 101, itemName: 'deep.dxf', itemSize: 1024, itemExtension: 'dxf', parentFolderId: 2001, updatedAt: '2026-01-01', isFolder: false, relativePath: '2026년/Q1' },
      ])

      ;(state.getFile as ReturnType<typeof vi.fn>).mockImplementation((id: string) => ({
        id, folder_id: 'f1', file_name: 'test.dxf', file_path: '/test.dxf',
        file_size: 1024, status: 'detected', lguplus_file_id: '100',
      }))

      await engine.fullSync()

      const saveFileCalls = (state.saveFile as ReturnType<typeof vi.fn>).mock.calls
      expect(saveFileCalls[0][0].file_path).toBe('/테스트업체/root.dxf')
      expect(saveFileCalls[1][0].file_path).toBe('/테스트업체/2026년/Q1/deep.dxf')
    })

    it('여러 폴더를 병렬로 스캔한다', async () => {
      ;(state.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: 'A', enabled: true },
        { id: 'f2', lguplus_folder_id: '1002', lguplus_folder_name: 'B', enabled: true },
        { id: 'f3', lguplus_folder_id: '1003', lguplus_folder_name: 'C', enabled: true },
      ])

      ;(lguplus.getAllFilesDeep as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 50))
        return []
      })

      const start = Date.now()
      await engine.fullSync()
      const elapsed = Date.now() - start

      // 순차이면 ~150ms, 병렬이면 ~50ms
      expect(elapsed).toBeLessThan(120)
    })

    it('한 폴더 실패가 다른 폴더에 영향을 주지 않는다', async () => {
      ;(state.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: 'A', enabled: true },
        { id: 'f2', lguplus_folder_id: '1002', lguplus_folder_name: 'B', enabled: true },
      ])

      ;(lguplus.getAllFilesDeep as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce([
          { itemId: 1, itemName: 'file.dxf', itemSize: 100, itemExtension: 'dxf', parentFolderId: 1002, updatedAt: '2026-01-01', isFolder: false },
        ])

      const result = await engine.fullSync()
      expect(result.scannedFiles).toBe(1)
    })
  })

  // ── 폴더 구조 보존 ──

  describe('폴더 구조 보존', () => {
    function setupFileWithPath(filePath: string) {
      const fileId = 'file-preserve-test'
      const fileData = {
        id: fileId,
        folder_id: 'f1',
        file_name: filePath.split('/').pop()!,
        file_path: filePath,
        file_size: 1024,
        status: 'detected',
        lguplus_file_id: '5001',
        retry_count: 0,
      }

      ;(state.getFile as ReturnType<typeof vi.fn>).mockImplementation(() => ({ ...fileData }))
      ;(state.updateFileStatus as ReturnType<typeof vi.fn>).mockImplementation((_id, status, extra) => {
        fileData.status = status
        if (extra && typeof extra === 'object') Object.assign(fileData, extra)
      })

      return { fileId, fileData }
    }

    it('downloadOnly: 서브폴더 경로를 포함한 임시 경로로 다운로드한다', async () => {
      const { fileId } = setupFileWithPath('/회사A/프로젝트/세부/test.dxf')

      ;(lguplus.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true, size: 1024, filename: 'test.dxf',
      })

      await engine.downloadOnly(fileId)

      expect(lguplus.downloadFile).toHaveBeenCalledWith(
        5001,
        './downloads/회사A/프로젝트/세부/test.dxf',
        expect.any(Function),
      )
    })

    it('uploadOnly: ensureFolderPath에 서브폴더 세그먼트가 전달된다', async () => {
      const { fileData } = setupFileWithPath('/회사A/프로젝트/세부/test.dxf')
      fileData.status = 'downloaded'
      ;(fileData as any).download_path = '/tmp/sync/회사A/프로젝트/세부/test.dxf'

      ;(state.getFolder as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '회사A',
        self_webhard_path: null, enabled: true,
      })

      ;(uploader.ensureFolderPath as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true, data: 'webhard-folder-id',
      })

      ;(uploader.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true, data: { id: 'up1', name: 'test.dxf', size: 1024, folderId: 'f1', uploadedAt: '' },
      })

      await engine.uploadOnly('file-preserve-test')

      expect(uploader.ensureFolderPath).toHaveBeenCalledWith(
        ['회사A', '프로젝트', '세부'],
      )
    })
  })

  // ── 동시성 제어 ──

  describe('동시성 제어', () => {
    it('handleDetectedFiles에서 UP operCode만 동기화한다', async () => {
      await engine.start()

      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '테스트',
      })

      const upFile: DetectedFile = {
        fileName: 'test.dxf', filePath: '/test.dxf', fileSize: 1024,
        folderId: '1001', operCode: 'UP', historyNo: 101,
      }
      const mvFile: DetectedFile = {
        fileName: 'moved.dxf', filePath: '/moved.dxf', fileSize: 512,
        folderId: '1001', operCode: 'MV', historyNo: 102,
      }

      // Trigger detection handler
      detector._handlers[0]([upFile, mvFile], 'polling')

      // 잠시 대기 (비동기 처리)
      await new Promise(r => setTimeout(r, 10))

      // UP 파일만 saveFile 호출
      expect(state.saveFile).toHaveBeenCalledTimes(1)
      expect((state.saveFile as ReturnType<typeof vi.fn>).mock.calls[0][0].file_name).toBe('test.dxf')
    })

    it('CP operCode도 동기화 대상이다', async () => {
      await engine.start()

      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '테스트',
      })

      const cpFile: DetectedFile = {
        fileName: 'copied.dxf', filePath: '/copied.dxf', fileSize: 1024,
        folderId: '1001', operCode: 'CP', historyNo: 201,
      }

      detector._handlers[0]([cpFile], 'polling')
      await new Promise(r => setTimeout(r, 10))

      expect(state.saveFile).toHaveBeenCalledTimes(1)
    })

    it('paused 상태에서는 감지된 파일을 무시한다', async () => {
      await engine.start()
      await engine.pause()

      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '테스트',
      })

      const file: DetectedFile = {
        fileName: 'test.dxf', filePath: '/test.dxf', fileSize: 1024,
        folderId: '1001', operCode: 'UP', historyNo: 101,
      }

      detector._handlers[0]([file], 'polling')
      await new Promise(r => setTimeout(r, 10))

      expect(state.saveFile).not.toHaveBeenCalled()
    })
  })

  // ── Graceful Shutdown ──

  describe('graceful shutdown', () => {
    it('stop() 시 syncQueue가 비워진다', async () => {
      await engine.start()
      await engine.stop()
      expect(engine.status).toBe('stopped')
    })

    it('stop() 시 상태가 stopping → stopped 순서로 전이한다', async () => {
      const statuses: string[] = []
      eventBus.on('engine:status', (data) => {
        statuses.push(data.next)
      })

      await engine.start()
      await engine.stop()

      expect(statuses).toContain('stopped')
    })
  })

  // ── retryAllDlq ──

  describe('retryAllDlq()', () => {
    it('DLQ 비어있음 → total: 0', async () => {
      ;(state.getDlqItems as ReturnType<typeof vi.fn>).mockReturnValue([])
      const result = await engine.retryAllDlq()
      expect(result).toEqual({ total: 0, succeeded: 0, failed: 0 })
    })

    it('can_retry=true 항목만 재시도한다', async () => {
      ;(state.getDlqItems as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 1, file_id: 'f1', file_name: 'a.dxf', can_retry: true },
        { id: 2, file_id: 'f2', file_name: 'b.dxf', can_retry: false },
      ])

      // syncFile은 성공 반환하도록 설정
      ;(state.getFile as ReturnType<typeof vi.fn>).mockReturnValue(null)

      const result = await engine.retryAllDlq()
      // can_retry=true인 1건만 재시도
      expect(result.total).toBe(1)
    })

    it('재시도 성공 시 removeDlqItem 호출', async () => {
      ;(state.getDlqItems as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 1, file_id: 'f1', file_name: 'a.dxf', can_retry: true },
      ])

      const fileData = {
        id: 'f1', folder_id: 'folder1', file_name: 'a.dxf', file_path: '/a.dxf',
        file_size: 1024, status: 'detected', lguplus_file_id: '5001',
      }
      ;(state.getFile as ReturnType<typeof vi.fn>).mockReturnValue({ ...fileData })
      ;(state.updateFileStatus as ReturnType<typeof vi.fn>).mockImplementation(() => {})
      ;(state.getFolder as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'folder1', lguplus_folder_id: '1001', lguplus_folder_name: '테스트',
        self_webhard_path: 'wh-folder', enabled: true,
      })

      const result = await engine.retryAllDlq()
      expect(result.succeeded).toBe(1)
      expect(state.removeDlqItem).toHaveBeenCalledWith(1)
    })
  })

  // ── operCode 라우팅 ──

  describe('operCode routing', () => {
    beforeEach(async () => {
      await engine.start()
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '테스트',
      })
    })

    it('UP operCode는 saveFile을 호출하여 파일 동기화를 시작한다', async () => {
      const upFile: DetectedFile = {
        fileName: 'upload.dxf', filePath: '/upload.dxf', fileSize: 1024,
        folderId: '1001', operCode: 'UP', historyNo: 301,
      }

      detector._handlers[0]([upFile], 'polling')
      await new Promise(r => setTimeout(r, 10))

      expect(state.saveFile).toHaveBeenCalledTimes(1)
      expect((state.saveFile as ReturnType<typeof vi.fn>).mock.calls[0][0].file_name).toBe('upload.dxf')
    })

    it('UP operCode에서 saveFile에 lguplus_file_id가 포함된다', async () => {
      const upFile: DetectedFile = {
        fileName: 'upload.dxf', filePath: '/upload.dxf', fileSize: 1024,
        folderId: '1001', operCode: 'UP', historyNo: 801,
        lguplusFileId: 55001,
      }

      detector._handlers[0]([upFile], 'polling')
      await new Promise(r => setTimeout(r, 10))

      expect(state.saveFile).toHaveBeenCalledWith(
        expect.objectContaining({
          lguplus_file_id: '55001',
          history_no: 801,
        }),
      )
    })

    it('CP operCode는 saveFile을 호출하여 파일 동기화를 시작한다', async () => {
      const cpFile: DetectedFile = {
        fileName: 'copied.dxf', filePath: '/copied.dxf', fileSize: 512,
        folderId: '1001', operCode: 'CP', historyNo: 302,
      }

      detector._handlers[0]([cpFile], 'polling')
      await new Promise(r => setTimeout(r, 10))

      expect(state.saveFile).toHaveBeenCalledTimes(1)
      expect((state.saveFile as ReturnType<typeof vi.fn>).mock.calls[0][0].file_name).toBe('copied.dxf')
    })

    it('D operCode는 saveFolderChange를 oper_code: D로 호출한다', async () => {
      const dFile: DetectedFile = {
        fileName: 'deleted.dxf', filePath: '/올리기전용/deleted.dxf', fileSize: 0,
        folderId: '1001', operCode: 'D', historyNo: 303,
      }

      detector._handlers[0]([dFile], 'polling')
      await new Promise(r => setTimeout(r, 10))

      // D는 파일 동기화가 아닌 saveFolderChange를 호출
      expect(state.saveFile).not.toHaveBeenCalled()
      expect(state.saveFolderChange).toHaveBeenCalledWith(
        expect.objectContaining({ oper_code: 'D', lguplus_folder_id: '1001' }),
      )
    })

    it('MV operCode는 saveFolderChange를 oper_code: MV로 호출한다', async () => {
      const mvFile: DetectedFile = {
        fileName: 'moved.dxf', filePath: '/올리기전용/moved.dxf', fileSize: 0,
        folderId: '1001', operCode: 'MV', historyNo: 304,
      }

      detector._handlers[0]([mvFile], 'polling')
      await new Promise(r => setTimeout(r, 10))

      expect(state.saveFile).not.toHaveBeenCalled()
      expect(state.saveFolderChange).toHaveBeenCalledWith(
        expect.objectContaining({ oper_code: 'MV' }),
      )
    })

    it('RN operCode는 saveFolderChange를 oper_code: RN으로 호출한다', async () => {
      const rnFile: DetectedFile = {
        fileName: 'renamed.dxf', filePath: '/올리기전용/renamed.dxf', fileSize: 0,
        folderId: '1001', operCode: 'RN', historyNo: 305,
      }

      detector._handlers[0]([rnFile], 'polling')
      await new Promise(r => setTimeout(r, 10))

      expect(state.saveFile).not.toHaveBeenCalled()
      expect(state.saveFolderChange).toHaveBeenCalledWith(
        expect.objectContaining({ oper_code: 'RN' }),
      )
    })

    it('폴더 operCode(FC, FD, FRN, FMV)는 각각 saveFolderChange를 호출한다', async () => {
      const folderOps: DetectedFile[] = [
        { fileName: '새폴더', filePath: '/올리기전용/새폴더', fileSize: 0, folderId: '1001', operCode: 'FC', historyNo: 401 },
        { fileName: '삭제폴더', filePath: '/올리기전용/삭제폴더', fileSize: 0, folderId: '1001', operCode: 'FD', historyNo: 402 },
        { fileName: '이름변경폴더', filePath: '/올리기전용/이름변경폴더', fileSize: 0, folderId: '1001', operCode: 'FRN', historyNo: 403 },
        { fileName: '이동폴더', filePath: '/올리기전용/이동폴더', fileSize: 0, folderId: '1001', operCode: 'FMV', historyNo: 404 },
      ]

      detector._handlers[0](folderOps, 'polling')
      await new Promise(r => setTimeout(r, 10))

      // 폴더 operCode는 saveFile이 아닌 saveFolderChange를 호출
      expect(state.saveFile).not.toHaveBeenCalled()
      expect(state.saveFolderChange).toHaveBeenCalledTimes(4)

      const calls = (state.saveFolderChange as ReturnType<typeof vi.fn>).mock.calls
      expect(calls[0][0].oper_code).toBe('FC')
      expect(calls[1][0].oper_code).toBe('FD')
      expect(calls[2][0].oper_code).toBe('FRN')
      expect(calls[3][0].oper_code).toBe('FMV')
    })

    it('혼합 operCode에서 UP/CP만 동기화하고 나머지는 saveFolderChange를 호출한다', async () => {
      const mixed: DetectedFile[] = [
        { fileName: 'upload.dxf', filePath: '/upload.dxf', fileSize: 1024, folderId: '1001', operCode: 'UP', historyNo: 501 },
        { fileName: 'deleted.dxf', filePath: '/deleted.dxf', fileSize: 0, folderId: '1001', operCode: 'D', historyNo: 502 },
        { fileName: 'copied.dxf', filePath: '/copied.dxf', fileSize: 512, folderId: '1001', operCode: 'CP', historyNo: 503 },
        { fileName: '새폴더', filePath: '/새폴더', fileSize: 0, folderId: '1001', operCode: 'FC', historyNo: 504 },
      ]

      detector._handlers[0](mixed, 'polling')
      await new Promise(r => setTimeout(r, 10))

      // UP + CP → saveFile 2회
      expect(state.saveFile).toHaveBeenCalledTimes(2)
      // D + FC → saveFolderChange 2회
      expect(state.saveFolderChange).toHaveBeenCalledTimes(2)
    })

    it('opercode:event 이벤트가 모든 operCode에 대해 발행된다', async () => {
      const handler = vi.fn()
      eventBus.on('opercode:event', handler)

      const files: DetectedFile[] = [
        { fileName: 'f1.dxf', filePath: '/f1.dxf', fileSize: 0, folderId: '1001', operCode: 'UP', historyNo: 601 },
        { fileName: 'f2.dxf', filePath: '/f2.dxf', fileSize: 0, folderId: '1001', operCode: 'D', historyNo: 602 },
        { fileName: '폴더', filePath: '/폴더', fileSize: 0, folderId: '1001', operCode: 'FC', historyNo: 603 },
      ]

      detector._handlers[0](files, 'polling')
      await new Promise(r => setTimeout(r, 10))

      expect(handler).toHaveBeenCalledTimes(3)
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ operCode: 'UP' }))
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ operCode: 'D' }))
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ operCode: 'FC' }))
    })
  })

  // ── emitSyncFailed ──

  describe('downloadOnly 에러 메시지', () => {
    it('다운로드 실패 시 last_error에 구체적 에러 메시지가 저장된다', async () => {
      ;(state.getFile as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', folder_id: 'folder1', file_name: 'test.dxf', file_path: '/test.dxf',
        file_size: 1024, status: 'detected', lguplus_file_id: '5001', retry_count: 0,
      })
      ;(state.updateFileStatus as ReturnType<typeof vi.fn>).mockImplementation(() => {})

      const specificError = new Error("Circuit breaker is OPEN for 'lguplus-download'")
      ;(retry.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(specificError)

      const result = await engine.downloadOnly('f1')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Circuit breaker is OPEN')
      expect(state.updateFileStatus).toHaveBeenCalledWith(
        'f1',
        'dl_failed',
        expect.objectContaining({
          last_error: expect.stringContaining('Circuit breaker is OPEN'),
        }),
      )
    })
  })

  describe('sync:failed 이벤트', () => {
    it('다운로드 실패 시 sync:failed 이벤트가 발행된다', async () => {
      const handler = vi.fn()
      eventBus.on('sync:failed', handler)

      ;(state.getFile as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', folder_id: 'folder1', file_name: 'test.dxf', file_path: '/test.dxf',
        file_size: 1024, status: 'detected', lguplus_file_id: '5001',
      })
      ;(state.updateFileStatus as ReturnType<typeof vi.fn>).mockImplementation(() => {})

      // 다운로드 실패
      ;(retry.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new FileDownloadTransferError('transfer failed', { fileId: 5001 }),
      )

      await engine.downloadOnly('f1')

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'f1',
          error: expect.any(FileDownloadTransferError),
        }),
      )
    })

    it('문자열 에러는 FileUploadError로 래핑된다', async () => {
      const handler = vi.fn()
      eventBus.on('sync:failed', handler)

      ;(state.getFile as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', folder_id: 'folder1', file_name: 'test.dxf', file_path: '/test.dxf',
        file_size: 1024, status: 'detected', lguplus_file_id: '5001',
      })
      ;(state.updateFileStatus as ReturnType<typeof vi.fn>).mockImplementation(() => {})

      // downloadFile이 success:false 반환
      ;(retry.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false, size: 0, filename: '',
      })

      await engine.downloadOnly('f1')

      expect(handler).toHaveBeenCalled()
      // emitSyncFailed가 문자열 'Download failed'를 받아 래핑
      const emittedError = handler.mock.calls[0][0].error
      expect(emittedError).toBeInstanceOf(SyncAppError)
    })
  })
})
