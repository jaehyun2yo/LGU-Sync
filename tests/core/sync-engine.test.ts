import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncEngine } from '../../src/core/sync-engine'

vi.mock('node:fs/promises', () => ({
  stat: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}))

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { stat: mockStat } = await vi.importMock<typeof import('node:fs/promises')>('node:fs/promises')
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

// Mocks
function mockFileDetector(): IFileDetector {
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
    // expose for testing
    _handlers: handlers,
  } as IFileDetector & { _handlers: typeof handlers }
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
      const id = `file-${Math.random()}`
      files.set(id, { ...file, id, status: 'detected' })
      return id
    }),
    updateFileStatus: vi.fn().mockImplementation((id, status, extra) => {
      const file = files.get(id)
      if (file) {
        file.status = status
        if (extra && typeof extra === 'object') {
          Object.assign(file, extra)
        }
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
    initialize: vi.fn(),
    close: vi.fn(),
  }
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

function mockConfigManager(): IConfigManager {
  return {
    get: vi.fn().mockImplementation((section: string) => {
      if (section === 'sync') return { pollingIntervalSec: 5, maxConcurrentDownloads: 5, maxConcurrentUploads: 3, snapshotIntervalMin: 10 }
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
  let detector: IFileDetector & { _handlers: Array<(files: DetectedFile[], strategy: DetectionStrategy) => void> }
  let lguplus: ILGUplusClient
  let uploader: IWebhardUploader
  let state: IStateManager
  let retry: IRetryManager
  let config: IConfigManager
  let notification: INotificationService

  beforeEach(() => {
    eventBus = new EventBus()
    detector = mockFileDetector() as any
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
      await engine.start() // should not throw
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
        if (extra && typeof extra === 'object') {
          Object.assign(fileData, extra)
        }
      })

      ;(state.getFolder as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1',
        lguplus_folder_id: '1001',
        lguplus_folder_name: '테스트업체',
        self_webhard_path: 'webhard-folder-id',
        enabled: true,
      })

      ;(lguplus.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        size: 1024,
        filename: 'test.dxf',
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

  describe('downloadOnly() - local file skip', () => {
    const fileId = 'skip-test-file'
    const fileData = {
      id: fileId,
      folder_id: 'f1',
      file_name: 'test.dxf',
      file_path: '/test.dxf',
      file_size: 1024,
      status: 'detected',
      lguplus_file_id: '5001',
      download_path: undefined as string | undefined,
    }

    beforeEach(() => {
      ;(state.getFile as ReturnType<typeof vi.fn>).mockImplementation(() => ({ ...fileData }))
      ;(config.get as ReturnType<typeof vi.fn>).mockImplementation((section: string) => {
        if (section === 'system') return { tempDownloadPath: './downloads' }
        if (section === 'sync') return { pollingIntervalSec: 5, maxConcurrentDownloads: 5, maxConcurrentUploads: 3, snapshotIntervalMin: 10 }
        return {}
      })
    })

    afterEach(() => {
      mockStat.mockReset()
      // Default: file not found
      mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    })

    it('로컬 파일이 존재하고 크기가 일치하면 다운로드를 스킵한다', async () => {
      mockStat.mockResolvedValue({
        isFile: () => true,
        size: 1024,
      } as any)

      const result = await engine.downloadOnly(fileId)

      expect(result.success).toBe(true)
      expect(result.skipped).toBe(true)
      expect(lguplus.downloadFile).not.toHaveBeenCalled()
      expect(state.updateFileStatus).toHaveBeenCalledWith(
        fileId,
        'downloaded',
        expect.objectContaining({ download_path: expect.any(String) }),
      )
    })

    it('로컬 파일이 존재하지 않으면 정상 다운로드한다', async () => {
      mockStat.mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      )

      const result = await engine.downloadOnly(fileId)

      expect(result.success).toBe(true)
      expect(result.skipped).toBeUndefined()
      expect(lguplus.downloadFile).toHaveBeenCalled()
    })

    it('로컬 파일 크기가 불일치하면 재다운로드한다', async () => {
      mockStat.mockResolvedValue({
        isFile: () => true,
        size: 999,
      } as any)

      const result = await engine.downloadOnly(fileId)

      expect(result.success).toBe(true)
      expect(lguplus.downloadFile).toHaveBeenCalled()
    })

    it('file_size가 0이면 파일 존재만으로 스킵한다', async () => {
      ;(state.getFile as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        ...fileData,
        file_size: 0,
      }))

      mockStat.mockResolvedValue({
        isFile: () => true,
        size: 12345,
      } as any)

      const result = await engine.downloadOnly(fileId)

      expect(result.success).toBe(true)
      expect(result.skipped).toBe(true)
      expect(lguplus.downloadFile).not.toHaveBeenCalled()
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

      // Make getFile return data so syncFile can proceed (but will fail download - that's ok for this test)
      ;(state.getFile as ReturnType<typeof vi.fn>).mockImplementation((id: string) => ({
        id,
        folder_id: 'f1',
        file_name: 'test.dxf',
        file_path: '/test.dxf',
        file_size: 1024,
        status: 'detected',
        lguplus_file_id: '100',
      }))

      await engine.fullSync()

      const saveFileCalls = (state.saveFile as ReturnType<typeof vi.fn>).mock.calls

      // Root file: /테스트업체/root.dxf
      expect(saveFileCalls[0][0].file_path).toBe('/테스트업체/root.dxf')

      // Deep file: /테스트업체/2026년/Q1/deep.dxf
      expect(saveFileCalls[1][0].file_path).toBe('/테스트업체/2026년/Q1/deep.dxf')
    })
  })
})
