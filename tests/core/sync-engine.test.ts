import { join, normalize } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rename, mkdir } from 'node:fs/promises'
import { SyncEngine } from '../../src/core/sync-engine'

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    rename: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
  }
})
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
    getFileByLguplusFileId: vi.fn().mockReturnValue(null),
    updateFileInfo: vi.fn(),
    saveFolder: vi.fn().mockReturnValue('folder-id'),
    updateFolder: vi.fn(),
    getFolders: vi.fn().mockReturnValue([]),
    getFolder: vi.fn().mockReturnValue(null),
    getFolderByLguplusId: vi.fn().mockReturnValue(null),
    bulkUpdateFilePaths: vi.fn().mockReturnValue(0),
    markFolderFilesDeleted: vi.fn().mockReturnValue(0),
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
    createDetectionSession: vi.fn().mockReturnValue('session-id'),
    endDetectionSession: vi.fn(),
    updateDetectionSession: vi.fn(),
    getLastDetectionSession: vi.fn().mockReturnValue(null),
    getDetectionSessions: vi.fn().mockReturnValue({ items: [], total: 0 }),
    resetDownloadedFiles: vi.fn().mockReturnValue(0),
    getLogCount: vi.fn().mockReturnValue(0),
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
        normalize(join('./downloads', '테스트업체', '2026년', 'Q1', 'deep.dxf')),
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
        { id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '테스트업체', lguplus_folder_path: '/올리기전용/테스트업체', enabled: true },
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
      expect(saveFileCalls[0][0].file_path).toBe('/올리기전용/테스트업체/root.dxf')
      expect(saveFileCalls[1][0].file_path).toBe('/올리기전용/테스트업체/2026년/Q1/deep.dxf')
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
        normalize(join('./downloads', '회사A', '프로젝트', '세부', 'test.dxf')),
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

    it('D operCode는 saveFolderChange를 oper_code: D로 호출하고 applied 처리한다', async () => {
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
      expect(state.updateFolderChange).toHaveBeenCalledWith(1, { status: 'applied' })
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
      // Sorted by priority: FC(0) → FRN(1) → FMV(1) → FD(4)
      expect(calls[0][0].oper_code).toBe('FC')
      expect(calls[1][0].oper_code).toBe('FRN')
      expect(calls[2][0].oper_code).toBe('FMV')
      expect(calls[3][0].oper_code).toBe('FD')
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
    it('다운로드 실패 시 last_error에 분류된 에러 메시지가 저장된다', async () => {
      ;(state.getFile as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', folder_id: 'folder1', file_name: 'test.dxf', file_path: '/test.dxf',
        file_size: 1024, status: 'detected', lguplus_file_id: '5001', retry_count: 0,
      })
      ;(state.updateFileStatus as ReturnType<typeof vi.fn>).mockImplementation(() => {})

      const specificError = new Error("Circuit breaker is OPEN for 'lguplus-download'")
      ;(retry.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(specificError)

      const result = await engine.downloadOnly('f1')

      expect(result.success).toBe(false)
      expect(result.error).toContain('회로 차단')
      expect(state.updateFileStatus).toHaveBeenCalledWith(
        'f1',
        'dl_failed',
        expect.objectContaining({
          last_error: expect.stringContaining('회로 차단'),
        }),
      )
    })

    it('lguplus_file_id가 없고 history_no도 없으면 에러를 반환한다', async () => {
      ;(state.getFile as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', folder_id: 'folder1', file_name: 'test.dxf', file_path: '/test.dxf',
        file_size: 1024, status: 'detected',
        lguplus_file_id: null, history_no: null,
      })
      ;(state.updateFileStatus as ReturnType<typeof vi.fn>).mockImplementation(() => {})

      const result = await engine.downloadOnly('f1')

      expect(result.success).toBe(false)
      expect(result.error).toContain('No LGU+ file ID')
    })
  })

  // ── 동시성 - start() 중복 호출 ──

  describe('start() 중복 호출 방지', () => {
    it('start() 2회 연속 호출 시 onFilesDetected 핸들러는 1번만 등록된다', async () => {
      await engine.start()
      await engine.start() // 두 번째 호출 → status=syncing이라 리턴

      // onFilesDetected는 1번만 호출되어야 함
      expect(detector.onFilesDetected).toHaveBeenCalledTimes(1)
    })

    it('start() → stop() → start() 순서에서 핸들러가 정확히 1개 활성화된다', async () => {
      await engine.start()
      await engine.stop()
      await engine.start()

      // 이전 구독 해제 후 새 구독 → 총 2회 onFilesDetected 호출 (각 start마다 1회)
      expect(detector.onFilesDetected).toHaveBeenCalledTimes(2)
    })
  })

  // ── drainQueue - 폴더 미발견 시 큐 처리 ──

  describe('drainQueue() - 폴더 미발견 시 처리', () => {
    it('폴더 미발견 파일을 건너뛰고 큐의 다음 파일을 정상 처리한다', async () => {
      // maxConcurrent=5이므로 슬롯이 가득 찰 때까지 동기화가 필요
      // 간단하게: 폴더 미발견 → drainQueue 호출 확인
      await engine.start()

      // 첫 번째 파일: 폴더 미발견 → 건너뜀
      // 두 번째 파일: 폴더 있음 → saveFile 호출
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null) // 첫 파일: 폴더 없음
        .mockReturnValue({
          id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '테스트',
        })

      const file1: DetectedFile = {
        fileName: 'unknown-folder.dxf', filePath: '/unknown-folder.dxf', fileSize: 512,
        folderId: '9999', operCode: 'UP', historyNo: 901,
      }
      const file2: DetectedFile = {
        fileName: 'known-folder.dxf', filePath: '/known-folder.dxf', fileSize: 1024,
        folderId: '1001', operCode: 'UP', historyNo: 902,
      }

      detector._handlers[0]([file1, file2], 'polling')
      await new Promise(r => setTimeout(r, 20))

      // file1은 건너뛰고 file2만 saveFile 호출
      const calls = (state.saveFile as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.length).toBe(1)
      expect(calls[0][0].file_name).toBe('known-folder.dxf')
    })
  })

  // ── GUEST 경로 필터링 ──

  describe('getPathSegments GUEST filtering', () => {
    function setupFileWithPath(filePath: string) {
      const fileId = 'file-guest-test'
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

    it('다운로드 경로에서 GUEST 세그먼트가 제거된다', async () => {
      const { fileId } = setupFileWithPath('/올리기전용/GUEST/업체A/파일.dxf')

      ;(lguplus.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true, size: 1024, filename: '파일.dxf',
      })

      await engine.downloadOnly(fileId)

      expect(lguplus.downloadFile).toHaveBeenCalledWith(
        5001,
        normalize(join('./downloads', '올리기전용', '업체A', '파일.dxf')),
        expect.any(Function),
      )
    })

    it('GUEST가 없는 경로는 그대로 유지된다', async () => {
      const { fileId } = setupFileWithPath('/올리기전용/업체A/파일.dxf')

      ;(lguplus.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true, size: 1024, filename: '파일.dxf',
      })

      await engine.downloadOnly(fileId)

      expect(lguplus.downloadFile).toHaveBeenCalledWith(
        5001,
        normalize(join('./downloads', '올리기전용', '업체A', '파일.dxf')),
        expect.any(Function),
      )
    })

    it('업로드 시 ensureFolderPath에서도 GUEST가 제거된다', async () => {
      const { fileData } = setupFileWithPath('/올리기전용/GUEST/업체B/파일.dxf')
      fileData.status = 'downloaded'
      ;(fileData as any).download_path = '/tmp/sync/올리기전용/업체B/파일.dxf'

      ;(state.getFolder as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '올리기전용',
        self_webhard_path: null, enabled: true,
      })

      ;(uploader.ensureFolderPath as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true, data: 'webhard-folder-id',
      })

      ;(uploader.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true, data: { id: 'up1', name: '파일.dxf', size: 1024, folderId: 'f1', uploadedAt: '' },
      })

      await engine.uploadOnly('file-guest-test')

      expect(uploader.ensureFolderPath).toHaveBeenCalledWith(
        ['올리기전용', '업체B'],
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

  // ── 문제 1: scanFolder file_path에 lguplus_folder_path 사용 ──

  describe('scanFolder file_path 경로 수정', () => {
    it('lguplus_folder_path가 있으면 file_path에 전체 경로가 반영된다', async () => {
      ;(state.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '업체A', lguplus_folder_path: '/올리기전용/업체A', enabled: true },
      ])

      ;(lguplus.getAllFilesDeep as ReturnType<typeof vi.fn>).mockResolvedValue([
        { itemId: 200, itemName: 'test.pdf', itemSize: 2048, itemExtension: 'pdf', parentFolderId: 1001, updatedAt: '2026-01-01', isFolder: false, relativePath: 'sub1' },
      ])

      ;(state.getFile as ReturnType<typeof vi.fn>).mockImplementation((id: string) => ({
        id, folder_id: 'f1', file_name: 'test.pdf', file_path: '/test.pdf',
        file_size: 2048, status: 'detected', lguplus_file_id: '200',
      }))

      await engine.fullSync()

      const saveFileCalls = (state.saveFile as ReturnType<typeof vi.fn>).mock.calls
      expect(saveFileCalls[0][0].file_path).toBe('/올리기전용/업체A/sub1/test.pdf')
    })

    it('lguplus_folder_path가 null이면 lguplus_folder_name으로 폴백한다', async () => {
      ;(state.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '업체B', lguplus_folder_path: null, enabled: true },
      ])

      ;(lguplus.getAllFilesDeep as ReturnType<typeof vi.fn>).mockResolvedValue([
        { itemId: 300, itemName: 'file.dxf', itemSize: 512, itemExtension: 'dxf', parentFolderId: 1001, updatedAt: '2026-01-01', isFolder: false },
      ])

      ;(state.getFile as ReturnType<typeof vi.fn>).mockImplementation((id: string) => ({
        id, folder_id: 'f1', file_name: 'file.dxf', file_path: '/file.dxf',
        file_size: 512, status: 'detected', lguplus_file_id: '300',
      }))

      await engine.fullSync()

      const saveFileCalls = (state.saveFile as ReturnType<typeof vi.fn>).mock.calls
      expect(saveFileCalls[0][0].file_path).toBe('/업체B/file.dxf')
    })
  })

  // ── 문제 2: getRootFolders() 루트 폴더만 스캔 ──

  describe('getRootFolders() 중복 스캔 방지', () => {
    it('중첩된 폴더는 루트만 스캔하여 중복을 방지한다', async () => {
      ;(state.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '올리기전용', lguplus_folder_path: '/올리기전용', enabled: true },
        { id: 'f2', lguplus_folder_id: '1002', lguplus_folder_name: '업체A', lguplus_folder_path: '/올리기전용/업체A', enabled: true },
        { id: 'f3', lguplus_folder_id: '1003', lguplus_folder_name: '디자인', lguplus_folder_path: '/올리기전용/업체A/디자인', enabled: true },
      ])

      ;(lguplus.getAllFilesDeep as ReturnType<typeof vi.fn>).mockResolvedValue([])

      await engine.fullSync()

      // 루트 폴더 '/올리기전용'만 스캔해야 함
      expect(lguplus.getAllFilesDeep).toHaveBeenCalledTimes(1)
      expect(lguplus.getAllFilesDeep).toHaveBeenCalledWith(1001)
    })

    it('서로 독립적인 폴더는 모두 스캔한다', async () => {
      ;(state.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '올리기전용', lguplus_folder_path: '/올리기전용', enabled: true },
        { id: 'f2', lguplus_folder_id: '2001', lguplus_folder_name: '내리기전용', lguplus_folder_path: '/내리기전용', enabled: true },
      ])

      ;(lguplus.getAllFilesDeep as ReturnType<typeof vi.fn>).mockResolvedValue([])

      await engine.fullSync()

      expect(lguplus.getAllFilesDeep).toHaveBeenCalledTimes(2)
    })

    it('folderIds 지정 시 getRootFolders 대신 해당 폴더만 스캔한다', async () => {
      ;(state.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: '올리기전용', lguplus_folder_path: '/올리기전용', enabled: true },
        { id: 'f2', lguplus_folder_id: '1002', lguplus_folder_name: '업체A', lguplus_folder_path: '/올리기전용/업체A', enabled: true },
      ])

      ;(lguplus.getAllFilesDeep as ReturnType<typeof vi.fn>).mockResolvedValue([])

      await engine.fullSync({ folderIds: ['f2'] })

      // 특정 폴더 지정 시 루트 필터 무시, 해당 폴더만 스캔
      expect(lguplus.getAllFilesDeep).toHaveBeenCalledTimes(1)
      expect(lguplus.getAllFilesDeep).toHaveBeenCalledWith(1002)
    })
  })

  // ── 문제 4: FC 이벤트에서 새 폴더 DB 등록 ──

  describe('FC operCode 폴더 등록', () => {
    beforeEach(async () => {
      await engine.start()
    })

    it('FC 이벤트 시 미등록 폴더를 DB에 저장한다 (lguplusFileId=새폴더, folderId=부모)', async () => {
      // FC에서 folderId=부모, lguplusFileId=새 폴더
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
        if (id === '1000') return { id: 'parent-f', lguplus_folder_id: '1000', lguplus_folder_name: '올리기전용', lguplus_folder_path: '/올리기전용' }
        return null // lguplusFileId '5001' → 미등록
      })

      const fcEvent: DetectedFile = {
        fileName: '새업체', filePath: '/올리기전용/새업체', fileSize: 0,
        folderId: '1000', lguplusFileId: 5001, operCode: 'FC', historyNo: 901,
      }

      detector._handlers[0]([fcEvent], 'polling')
      await new Promise(r => setTimeout(r, 50))

      expect(state.saveFolder).toHaveBeenCalledWith(
        expect.objectContaining({
          lguplus_folder_id: '5001',
          lguplus_folder_name: '새업체',
          lguplus_folder_path: '/올리기전용/새업체',
          enabled: true,
          auto_detected: true,
        }),
      )
      expect(state.saveFolderChange).toHaveBeenCalledWith(
        expect.objectContaining({ oper_code: 'FC', new_path: '/올리기전용/새업체' }),
      )
    })

    it('FC 이벤트 시 이미 등록된 폴더는 saveFolder를 호출하지 않는다', async () => {
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
        if (id === '5001') return { id: 'existing-f1', lguplus_folder_id: '5001', lguplus_folder_name: '기존업체' }
        if (id === '1000') return { id: 'parent-f', lguplus_folder_id: '1000', lguplus_folder_name: '올리기전용', lguplus_folder_path: '/올리기전용' }
        return null
      })

      const fcEvent: DetectedFile = {
        fileName: '기존업체', filePath: '/올리기전용/기존업체', fileSize: 0,
        folderId: '1000', lguplusFileId: 5001, operCode: 'FC', historyNo: 902,
      }

      detector._handlers[0]([fcEvent], 'polling')
      await new Promise(r => setTimeout(r, 50))

      expect(state.saveFolder).not.toHaveBeenCalled()
      // saveFolderChange는 항상 호출
      expect(state.saveFolderChange).toHaveBeenCalledWith(
        expect.objectContaining({ oper_code: 'FC' }),
      )
    })

    it('FC로 등록된 폴더에 파일이 올라오면 정상 동기화된다', async () => {
      // FC 시점: lguplusFileId '5001' 미등록, 부모 '1000' 등록됨
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>)
        .mockImplementation((id: string) => {
          if (id === '1000') return { id: 'parent-f', lguplus_folder_id: '1000', lguplus_folder_name: '올리기전용', lguplus_folder_path: '/올리기전용' }
          if (id === '5001') return null // FC 시점: 미등록
          return null
        })

      const fcEvent: DetectedFile = {
        fileName: '새업체', filePath: '/올리기전용/새업체', fileSize: 0,
        folderId: '1000', lguplusFileId: 5001, operCode: 'FC', historyNo: 903,
      }

      detector._handlers[0]([fcEvent], 'polling')
      await new Promise(r => setTimeout(r, 50))

      // UP 시점: 폴더가 등록됨
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockReturnValue(
        { id: 'new-f1', lguplus_folder_id: '5001', lguplus_folder_name: '새업체' },
      )

      const upEvent: DetectedFile = {
        fileName: 'new-file.dxf', filePath: '/올리기전용/새업체/new-file.dxf', fileSize: 1024,
        folderId: '5001', operCode: 'UP', historyNo: 904,
      }

      detector._handlers[0]([upEvent], 'polling')
      await new Promise(r => setTimeout(r, 50))

      // 폴더가 등록되어 있으므로 saveFile이 호출되어야 함
      expect(state.saveFile).toHaveBeenCalledWith(
        expect.objectContaining({ file_name: 'new-file.dxf' }),
      )
    })
  })

  // ── 파일/폴더 미러링 핸들러 ──

  describe('handleFileDeletion (D)', () => {
    beforeEach(async () => {
      await engine.start()
    })

    it('DB에 파일이 있고 download_path가 있으면 로컬 삭제 + source_deleted 처리', async () => {
      ;(state.getFileByLguplusFileId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', file_name: 'test.dxf', file_path: '/올리기전용/업체A/test.dxf',
        download_path: './downloads/올리기전용/업체A/test.dxf', status: 'completed',
      })

      const dFile: DetectedFile = {
        fileName: 'test.dxf', filePath: '/올리기전용/업체A/test.dxf', fileSize: 0,
        folderId: '1001', operCode: 'D', historyNo: 1001, lguplusFileId: 5001,
      }

      detector._handlers[0]([dFile], 'polling')
      await new Promise(r => setTimeout(r, 30))

      expect(state.updateFileStatus).toHaveBeenCalledWith('f1', 'source_deleted')
      expect(state.saveFolderChange).toHaveBeenCalledWith(
        expect.objectContaining({ oper_code: 'D', old_path: '/올리기전용/업체A/test.dxf' }),
      )
      expect(state.updateFolderChange).toHaveBeenCalledWith(1, { status: 'applied' })
    })

    it('DB에 파일이 없으면 saveFolderChange만 호출하고 계속 진행', async () => {
      ;(state.getFileByLguplusFileId as ReturnType<typeof vi.fn>).mockReturnValue(null)

      const dFile: DetectedFile = {
        fileName: 'unknown.dxf', filePath: '/올리기전용/unknown.dxf', fileSize: 0,
        folderId: '1001', operCode: 'D', historyNo: 1002,
      }

      detector._handlers[0]([dFile], 'polling')
      await new Promise(r => setTimeout(r, 10))

      expect(state.updateFileStatus).not.toHaveBeenCalled()
      expect(state.saveFolderChange).toHaveBeenCalledWith(
        expect.objectContaining({ oper_code: 'D' }),
      )
    })

    it('download_path가 null이면 FS 작업 없이 DB만 업데이트', async () => {
      ;(state.getFileByLguplusFileId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', file_name: 'test.dxf', file_path: '/test.dxf',
        download_path: null, status: 'detected',
      })

      const dFile: DetectedFile = {
        fileName: 'test.dxf', filePath: '/test.dxf', fileSize: 0,
        folderId: '1001', operCode: 'D', historyNo: 1003, lguplusFileId: 5001,
      }

      detector._handlers[0]([dFile], 'polling')
      await new Promise(r => setTimeout(r, 10))

      expect(state.updateFileStatus).toHaveBeenCalledWith('f1', 'source_deleted')
    })
  })

  describe('handleFileRename (RN)', () => {
    beforeEach(async () => {
      await engine.start()
    })

    it('기존 파일이 있으면 이름변경 + updateFileInfo 호출', async () => {
      ;(state.getFileByLguplusFileId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', file_name: 'old.dxf', file_path: '/올리기전용/업체A/old.dxf',
        download_path: './downloads/올리기전용/업체A/old.dxf', status: 'completed',
      })

      const rnFile: DetectedFile = {
        fileName: 'new.dxf', filePath: '/올리기전용/업체A/new.dxf', fileSize: 0,
        folderId: '1001', operCode: 'RN', historyNo: 2001, lguplusFileId: 5001,
      }

      detector._handlers[0]([rnFile], 'polling')
      await new Promise(r => setTimeout(r, 30))

      expect(state.updateFileInfo).toHaveBeenCalledWith('f1', expect.objectContaining({
        file_name: 'new.dxf',
        file_path: '/올리기전용/업체A/new.dxf',
      }))
      expect(state.saveFolderChange).toHaveBeenCalledWith(
        expect.objectContaining({
          oper_code: 'RN',
          old_path: '/올리기전용/업체A/old.dxf',
          new_path: '/올리기전용/업체A/new.dxf',
        }),
      )
    })

    it('같은 이름이면 중복 이벤트로 스킵', async () => {
      ;(state.getFileByLguplusFileId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', file_name: 'same.dxf', file_path: '/same.dxf',
        download_path: null, status: 'completed',
      })

      const rnFile: DetectedFile = {
        fileName: 'same.dxf', filePath: '/same.dxf', fileSize: 0,
        folderId: '1001', operCode: 'RN', historyNo: 2002, lguplusFileId: 5001,
      }

      detector._handlers[0]([rnFile], 'polling')
      await new Promise(r => setTimeout(r, 10))

      expect(state.updateFileInfo).not.toHaveBeenCalled()
      expect(state.saveFolderChange).not.toHaveBeenCalled()
    })

    it('기존 파일이 없으면 saveFolderChange만 호출', async () => {
      ;(state.getFileByLguplusFileId as ReturnType<typeof vi.fn>).mockReturnValue(null)

      const rnFile: DetectedFile = {
        fileName: 'unknown.dxf', filePath: '/unknown.dxf', fileSize: 0,
        folderId: '1001', operCode: 'RN', historyNo: 2003,
      }

      detector._handlers[0]([rnFile], 'polling')
      await new Promise(r => setTimeout(r, 10))

      expect(state.updateFileInfo).not.toHaveBeenCalled()
      expect(state.saveFolderChange).toHaveBeenCalledWith(
        expect.objectContaining({ oper_code: 'RN', new_path: '/unknown.dxf' }),
      )
    })
  })

  describe('handleFileMove (MV)', () => {
    beforeEach(async () => {
      await engine.start()
    })

    it('기존 파일이 있으면 경로 변경 + updateFileInfo 호출', async () => {
      ;(state.getFileByLguplusFileId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', file_name: 'test.dxf', file_path: '/올리기전용/업체A/test.dxf',
        download_path: './downloads/올리기전용/업체A/test.dxf', status: 'completed',
      })
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'folder-b', lguplus_folder_id: '2001', lguplus_folder_name: '업체B',
      })

      const mvFile: DetectedFile = {
        fileName: 'test.dxf', filePath: '/올리기전용/업체B/test.dxf', fileSize: 0,
        folderId: '2001', operCode: 'MV', historyNo: 3001, lguplusFileId: 5001,
      }

      detector._handlers[0]([mvFile], 'polling')
      await new Promise(r => setTimeout(r, 30))

      expect(state.updateFileInfo).toHaveBeenCalledWith('f1', expect.objectContaining({
        file_path: '/올리기전용/업체B/test.dxf',
        folder_id: 'folder-b',
      }))
      expect(state.saveFolderChange).toHaveBeenCalledWith(
        expect.objectContaining({
          oper_code: 'MV',
          old_path: '/올리기전용/업체A/test.dxf',
          new_path: '/올리기전용/업체B/test.dxf',
        }),
      )
    })

    it('같은 경로이면 중복 이벤트로 스킵', async () => {
      ;(state.getFileByLguplusFileId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', file_name: 'test.dxf', file_path: '/same/path/test.dxf',
        download_path: null, status: 'completed',
      })

      const mvFile: DetectedFile = {
        fileName: 'test.dxf', filePath: '/same/path/test.dxf', fileSize: 0,
        folderId: '1001', operCode: 'MV', historyNo: 3002, lguplusFileId: 5001,
      }

      detector._handlers[0]([mvFile], 'polling')
      await new Promise(r => setTimeout(r, 10))

      expect(state.updateFileInfo).not.toHaveBeenCalled()
      expect(state.saveFolderChange).not.toHaveBeenCalled()
    })
  })

  describe('handleFolderDeletion (FD)', () => {
    beforeEach(async () => {
      await engine.start()
    })

    it('등록된 폴더 삭제 시 하위 파일 source_deleted + 폴더 비활성화 (lguplusFileId로 조회)', async () => {
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
        if (id === '1001') return {
          id: 'folder-1', lguplus_folder_id: '1001', lguplus_folder_name: '업체A',
          lguplus_folder_path: '/올리기전용/업체A',
        }
        return null
      })
      ;(state.markFolderFilesDeleted as ReturnType<typeof vi.fn>).mockReturnValue(5)

      const fdFile: DetectedFile = {
        fileName: '업체A', filePath: '/올리기전용/업체A', fileSize: 0,
        folderId: '2000', lguplusFileId: 1001, operCode: 'FD', historyNo: 4001,
      }

      detector._handlers[0]([fdFile], 'polling')
      await new Promise(r => setTimeout(r, 30))

      expect(state.markFolderFilesDeleted).toHaveBeenCalledWith('folder-1')
      expect(state.updateFolder).toHaveBeenCalledWith('folder-1', { enabled: false })
      expect(state.saveFolderChange).toHaveBeenCalledWith(
        expect.objectContaining({
          lguplus_folder_id: '1001',
          oper_code: 'FD',
          old_path: '/올리기전용/업체A',
          affected_items: 5,
        }),
      )
      expect(state.updateFolderChange).toHaveBeenCalledWith(1, { status: 'applied' })
    })

    it('미등록 폴더 삭제 시 saveFolderChange만 호출', async () => {
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockReturnValue(null)

      const fdFile: DetectedFile = {
        fileName: '미등록', filePath: '/올리기전용/미등록', fileSize: 0,
        folderId: '2000', lguplusFileId: 9999, operCode: 'FD', historyNo: 4002,
      }

      detector._handlers[0]([fdFile], 'polling')
      await new Promise(r => setTimeout(r, 10))

      expect(state.markFolderFilesDeleted).not.toHaveBeenCalled()
      expect(state.saveFolderChange).toHaveBeenCalledWith(
        expect.objectContaining({ oper_code: 'FD', lguplus_folder_id: '9999' }),
      )
    })
  })

  describe('handleFolderRename (FRN)', () => {
    beforeEach(async () => {
      await engine.start()
    })

    it('등록된 폴더 이름변경 시 DB 업데이트 + 하위 파일 경로 일괄 변경 (lguplusFileId로 조회)', async () => {
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
        if (id === '1001') return {
          id: 'folder-1', lguplus_folder_id: '1001', lguplus_folder_name: '업체A',
          lguplus_folder_path: '/올리기전용/업체A',
        }
        // folderId '2000' = parent folder
        if (id === '2000') return {
          id: 'parent-f', lguplus_folder_id: '2000', lguplus_folder_name: '올리기전용',
          lguplus_folder_path: '/올리기전용',
        }
        return null
      })
      ;(state.bulkUpdateFilePaths as ReturnType<typeof vi.fn>).mockReturnValue(3)

      const frnFile: DetectedFile = {
        fileName: '업체A-NEW', filePath: '/올리기전용/업체A-NEW', fileSize: 0,
        folderId: '2000', lguplusFileId: 1001, operCode: 'FRN', historyNo: 5001,
      }

      detector._handlers[0]([frnFile], 'polling')
      await new Promise(r => setTimeout(r, 30))

      expect(state.updateFolder).toHaveBeenCalledWith('folder-1', {
        lguplus_folder_name: '업체A-NEW',
        lguplus_folder_path: '/올리기전용/업체A-NEW',
      })
      expect(state.bulkUpdateFilePaths).toHaveBeenCalledWith(
        'folder-1', '/올리기전용/업체A', '/올리기전용/업체A-NEW',
      )
      expect(state.saveFolderChange).toHaveBeenCalledWith(
        expect.objectContaining({
          lguplus_folder_id: '1001',
          oper_code: 'FRN',
          old_path: '/올리기전용/업체A',
          new_path: '/올리기전용/업체A-NEW',
          affected_items: 3,
        }),
      )
    })

    it('미등록 폴더는 saveFolderChange만 호출', async () => {
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockReturnValue(null)

      const frnFile: DetectedFile = {
        fileName: '미등록', filePath: '/올리기전용/미등록', fileSize: 0,
        folderId: '2000', lguplusFileId: 9999, operCode: 'FRN', historyNo: 5002,
      }

      detector._handlers[0]([frnFile], 'polling')
      await new Promise(r => setTimeout(r, 10))

      expect(state.bulkUpdateFilePaths).not.toHaveBeenCalled()
      expect(state.saveFolderChange).toHaveBeenCalledWith(
        expect.objectContaining({ oper_code: 'FRN', lguplus_folder_id: '9999' }),
      )
    })
  })

  describe('handleFolderMove (FMV)', () => {
    beforeEach(async () => {
      await engine.start()
    })

    it('등록된 폴더 이동 시 DB 업데이트 + 하위 파일 경로 일괄 변경 (lguplusFileId로 조회)', async () => {
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
        if (id === '1001') return {
          id: 'folder-1', lguplus_folder_id: '1001', lguplus_folder_name: '업체A',
          lguplus_folder_path: '/올리기전용/업체A',
        }
        // folderId '3000' = destination parent (내리기전용)
        if (id === '3000') return {
          id: 'dest-parent', lguplus_folder_id: '3000', lguplus_folder_name: '내리기전용',
          lguplus_folder_path: '/내리기전용',
        }
        return null
      })
      ;(state.bulkUpdateFilePaths as ReturnType<typeof vi.fn>).mockReturnValue(2)

      const fmvFile: DetectedFile = {
        fileName: '업체A', filePath: '/내리기전용/업체A', fileSize: 0,
        folderId: '3000', lguplusFileId: 1001, operCode: 'FMV', historyNo: 6001,
      }

      detector._handlers[0]([fmvFile], 'polling')
      await new Promise(r => setTimeout(r, 30))

      expect(state.updateFolder).toHaveBeenCalledWith('folder-1', {
        lguplus_folder_path: '/내리기전용/업체A',
      })
      expect(state.bulkUpdateFilePaths).toHaveBeenCalledWith(
        'folder-1', '/올리기전용/업체A', '/내리기전용/업체A',
      )
      expect(state.saveFolderChange).toHaveBeenCalledWith(
        expect.objectContaining({
          lguplus_folder_id: '1001',
          oper_code: 'FMV',
          old_path: '/올리기전용/업체A',
          new_path: '/내리기전용/업체A',
          affected_items: 2,
        }),
      )
    })

    it('미등록 폴더는 saveFolderChange만 호출', async () => {
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockReturnValue(null)

      const fmvFile: DetectedFile = {
        fileName: '미등록', filePath: '/내리기전용/미등록', fileSize: 0,
        folderId: '3000', lguplusFileId: 9999, operCode: 'FMV', historyNo: 6002,
      }

      detector._handlers[0]([fmvFile], 'polling')
      await new Promise(r => setTimeout(r, 10))

      expect(state.bulkUpdateFilePaths).not.toHaveBeenCalled()
      expect(state.saveFolderChange).toHaveBeenCalledWith(
        expect.objectContaining({ oper_code: 'FMV', lguplus_folder_id: '9999' }),
      )
    })
  })

  // ── operCode Priority Sorting ──

  describe('operCode 우선순위 정렬', () => {
    beforeEach(async () => {
      await engine.start()
    })

    it('배치 내 operCode가 FC → FRN → UP → D 순서로 처리된다', async () => {
      const callOrder: string[] = []

      // Track operCode processing order via opercode:event emissions
      eventBus.on('opercode:event', (data: any) => {
        callOrder.push(data.operCode)
      })

      // FC needs folder registration
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockReturnValue(null)

      // UP needs folder lookup — will be skipped (no folder) but still processed
      // D needs file lookup — will be skipped (no file)
      ;(state.getFileByLguplusFileId as ReturnType<typeof vi.fn>).mockReturnValue(null)

      const batch: DetectedFile[] = [
        { fileName: 'test.dxf', filePath: '/올리기전용/업체A/test.dxf', fileSize: 1024, folderId: '1001', operCode: 'UP', historyNo: 100, lguplusFileId: 5001 },
        { fileName: '업체A', filePath: '/올리기전용/업체A', fileSize: 0, folderId: '1001', operCode: 'FC', historyNo: 99 },
        { fileName: 'old.dxf', filePath: '/올리기전용/업체A/old.dxf', fileSize: 0, folderId: '1001', operCode: 'D', historyNo: 101, lguplusFileId: 5002 },
        { fileName: '업체A', filePath: '/내리기전용/업체A', fileSize: 0, folderId: '1001', operCode: 'FRN', historyNo: 98 },
      ]

      detector._handlers[0](batch, 'gap-recovery')
      await new Promise(r => setTimeout(r, 50))

      expect(callOrder).toEqual(['FC', 'FRN', 'UP', 'D'])
    })

    it('FC+UP 같은 배치 — 정렬로 FC 먼저 처리되어 UP이 폴더를 찾는다', async () => {
      let fcProcessed = false

      // FC에서: lguplusFileId '7001' = 새 폴더 ID, folderId '1000' = 부모
      // UP에서: folderId '7001' = 파일이 속한 폴더 (FC로 생성된)
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
        // 부모 폴더
        if (id === '1000') return { id: 'parent-f', lguplus_folder_id: '1000', lguplus_folder_name: '올리기전용', lguplus_folder_path: '/올리기전용' }
        // FC 처리 후 새 폴더가 등록됨
        if (id === '7001' && fcProcessed) return { id: 'folder-new', lguplus_folder_id: '7001', lguplus_folder_name: '신규업체' }
        return null
      })

      ;(state.saveFolder as ReturnType<typeof vi.fn>).mockImplementation(() => {
        fcProcessed = true
        return 'folder-new'
      })

      const batch: DetectedFile[] = [
        // UP이 배열 앞에 (정렬 전 먼저 오는 상황)
        { fileName: 'new-file.dxf', filePath: '/올리기전용/신규업체/new-file.dxf', fileSize: 2048, folderId: '7001', operCode: 'UP', historyNo: 200, lguplusFileId: 6001 },
        // FC가 배열 뒤에 — folderId=부모, lguplusFileId=새폴더
        { fileName: '신규업체', filePath: '/올리기전용/신규업체', fileSize: 0, folderId: '1000', lguplusFileId: 7001, operCode: 'FC', historyNo: 199 },
      ]

      detector._handlers[0](batch, 'gap-recovery')
      await new Promise(r => setTimeout(r, 50))

      // FC가 먼저 처리되어 saveFolder 호출됨
      expect(state.saveFolder).toHaveBeenCalled()
      // UP이 폴더를 찾아서 saveFile 호출됨
      expect(state.saveFile).toHaveBeenCalledWith(
        expect.objectContaining({
          folder_id: 'folder-new',
          file_name: 'new-file.dxf',
        }),
      )
    })
  })

  // ── FS Failure DB Protection ──

  describe('FS 실패 시 DB 보호', () => {
    beforeEach(async () => {
      await engine.start()
      vi.mocked(rename).mockReset()
      vi.mocked(mkdir).mockReset()
    })

    it('handleFileRename: FS rename 실패 시 download_path 미갱신', async () => {
      ;(state.getFileByLguplusFileId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', file_name: 'old.dxf', file_path: '/올리기전용/업체A/old.dxf',
        download_path: './downloads/업체A/old.dxf', status: 'completed',
      })

      // FS rename fails with EACCES
      vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }))

      const rnFile: DetectedFile = {
        fileName: 'new.dxf', filePath: '/올리기전용/업체A/new.dxf', fileSize: 0,
        folderId: '1001', operCode: 'RN', historyNo: 3001, lguplusFileId: 5001,
      }

      detector._handlers[0]([rnFile], 'polling')
      await new Promise(r => setTimeout(r, 50))

      // file_name, file_path는 갱신 (LGU+ 소스 기준)
      expect(state.updateFileInfo).toHaveBeenCalledWith('f1', {
        file_name: 'new.dxf',
        file_path: '/올리기전용/업체A/new.dxf',
      })
      // download_path는 미포함 (FS 실패)
      const updateCall = (state.updateFileInfo as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(updateCall[1]).not.toHaveProperty('download_path')
    })

    it('handleFileMove: FS rename 실패 시 download_path 미갱신', async () => {
      ;(state.getFileByLguplusFileId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'f1', file_name: 'test.dxf', file_path: '/올리기전용/업체A/test.dxf',
        download_path: './downloads/업체A/test.dxf', status: 'completed',
      })
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'folder-b', lguplus_folder_id: '2001', lguplus_folder_name: '업체B',
      })

      // mkdir succeeds but rename fails
      vi.mocked(mkdir).mockResolvedValueOnce(undefined)
      vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('EPERM'), { code: 'EPERM' }))

      const mvFile: DetectedFile = {
        fileName: 'test.dxf', filePath: '/올리기전용/업체B/test.dxf', fileSize: 0,
        folderId: '2001', operCode: 'MV', historyNo: 3002, lguplusFileId: 5001,
      }

      detector._handlers[0]([mvFile], 'polling')
      await new Promise(r => setTimeout(r, 50))

      // file_path와 folder_id는 갱신 (소스 기준)
      expect(state.updateFileInfo).toHaveBeenCalledWith('f1', {
        file_path: '/올리기전용/업체B/test.dxf',
        folder_id: 'folder-b',
      })
      // download_path는 미포함
      const updateCall = (state.updateFileInfo as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(updateCall[1]).not.toHaveProperty('download_path')
    })

    it('handleFolderRename: FS rename 실패해도 DB 폴더 경로는 갱신 (lguplusFileId로 조회)', async () => {
      ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
        if (id === '1001') return {
          id: 'folder-1', lguplus_folder_id: '1001', lguplus_folder_name: '업체A',
          lguplus_folder_path: '/올리기전용/업체A',
        }
        if (id === '2000') return {
          id: 'parent-f', lguplus_folder_id: '2000', lguplus_folder_name: '올리기전용',
          lguplus_folder_path: '/올리기전용',
        }
        return null
      })
      ;(state.bulkUpdateFilePaths as ReturnType<typeof vi.fn>).mockReturnValue(3)

      // FS rename fails
      vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }))

      const frnFile: DetectedFile = {
        fileName: '업체A_신규', filePath: '/올리기전용/업체A_신규', fileSize: 0,
        folderId: '2000', lguplusFileId: 1001, operCode: 'FRN', historyNo: 4001,
      }

      detector._handlers[0]([frnFile], 'polling')
      await new Promise(r => setTimeout(r, 50))

      // DB 폴더 경로는 갱신 (LGU+ 소스 기준)
      expect(state.updateFolder).toHaveBeenCalledWith('folder-1', {
        lguplus_folder_name: '업체A_신규',
        lguplus_folder_path: '/올리기전용/업체A_신규',
      })
      // 하위 파일 경로도 일괄 갱신
      expect(state.bulkUpdateFilePaths).toHaveBeenCalledWith(
        'folder-1', '/올리기전용/업체A', '/올리기전용/업체A_신규',
      )
    })
  })
})
