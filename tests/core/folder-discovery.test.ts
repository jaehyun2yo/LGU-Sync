import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FolderDiscovery } from '../../src/core/folder-discovery'
import type { ILGUplusClient } from '../../src/core/types/lguplus-client.types'
import type { IWebhardUploader } from '../../src/core/types/webhard-uploader.types'
import type { IStateManager } from '../../src/core/types/state-manager.types'
import type { ILogger } from '../../src/core/types/logger.types'

function mockLogger(): ILogger {
  const noop = vi.fn()
  const child = vi.fn().mockReturnThis()
  return { debug: noop, info: noop, warn: noop, error: noop, child } as unknown as ILogger
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
    ensureFolderPath: vi.fn().mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 50))
      return { success: true, data: 'folder-id' }
    }),
    uploadFile: vi.fn().mockResolvedValue({ success: true, data: { id: 'up1', name: 'test.dxf', size: 1024, folderId: 'f1', uploadedAt: '' } }),
    uploadFileBatch: vi.fn().mockResolvedValue({ total: 0, success: 0, failed: 0, skipped: 0, durationMs: 0 }),
    fileExists: vi.fn().mockResolvedValue(false),
    listFiles: vi.fn().mockResolvedValue({ success: true, data: [] }),
    on: vi.fn(),
  }
}

function mockStateManager(): IStateManager {
  return {
    getCheckpoint: vi.fn().mockReturnValue(null),
    saveCheckpoint: vi.fn(),
    saveFile: vi.fn().mockReturnValue('file-id'),
    updateFileStatus: vi.fn(),
    updateFileInfo: vi.fn(),
    getFile: vi.fn().mockReturnValue(null),
    getFilesByFolder: vi.fn().mockReturnValue([]),
    getFileByHistoryNo: vi.fn().mockReturnValue(null),
    getFileByLguplusFileId: vi.fn().mockReturnValue(null),
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
    getLogCount: vi.fn().mockReturnValue(0),
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
    initialize: vi.fn(),
    close: vi.fn(),
  }
}

describe('FolderDiscovery - 병렬 처리', () => {
  let discovery: FolderDiscovery
  let lguplus: ILGUplusClient
  let uploader: IWebhardUploader
  let state: IStateManager

  beforeEach(() => {
    lguplus = mockLGUplusClient()
    uploader = mockWebhardUploader()
    state = mockStateManager()
    discovery = new FolderDiscovery(lguplus, uploader, state, mockLogger())
  })

  it('새 폴더 여러 개를 동시에 처리한다', async () => {
    // HOME → 올리기전용 → 5개 새 폴더 (재귀 탐색)
    // 올리기전용 자체도 새 폴더로 등록됨 → 총 6개
    ;(lguplus.getGuestFolderRootId as ReturnType<typeof vi.fn>).mockResolvedValue(1000)

    // 기본: leaf 노드는 빈 배열 반환
    ;(lguplus.getSubFolders as ReturnType<typeof vi.fn>).mockResolvedValue([])

    // discoverAncestorPrefix: HOME → [올리기전용] (prefix 탐색용 1st call)
    ;(lguplus.getSubFolders as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { folderId: 2000, folderName: '올리기전용', parentFolderId: 1000 },
    ])
    // discoverRecursive: HOME → [올리기전용] (실제 탐색용 2nd call)
    ;(lguplus.getSubFolders as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { folderId: 2000, folderName: '올리기전용', parentFolderId: 1000 },
    ])
    // 올리기전용 → [Company-0 ~ Company-4]
    ;(lguplus.getSubFolders as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      Array.from({ length: 5 }, (_, i) => ({
        folderId: 3000 + i,
        folderName: `Company-${i}`,
        parentFolderId: 2000,
      })),
    )

    // 각 ensureFolderPath가 50ms 걸림
    ;(uploader.ensureFolderPath as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 50))
      return { success: true, data: 'folder-id' }
    })

    // 모든 폴더가 새 폴더
    ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockReturnValue(null)

    const start = Date.now()
    const result = await discovery.discoverFolders()
    const elapsed = Date.now() - start

    // 올리기전용(1) + Company-0~4(5) = 6개 새 폴더
    expect(result.newFolders).toBe(6)
    expect(result.total).toBe(6)
    // 순차이면 ~300ms (6*50ms), 병렬(3)이면 ~150ms 이내
    expect(elapsed).toBeLessThan(250)
  })

  it('기존 폴더는 병렬 처리 없이 즉시 처리된다', async () => {
    ;(lguplus.getGuestFolderRootId as ReturnType<typeof vi.fn>).mockResolvedValue(1000)

    // 기본: leaf 노드는 빈 배열 반환
    ;(lguplus.getSubFolders as ReturnType<typeof vi.fn>).mockResolvedValue([])

    // discoverAncestorPrefix: HOME → [올리기전용] (prefix 탐색용 1st call)
    ;(lguplus.getSubFolders as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { folderId: 2000, folderName: '올리기전용', parentFolderId: 1000 },
    ])
    // discoverRecursive: HOME → [올리기전용] (실제 탐색용 2nd call)
    ;(lguplus.getSubFolders as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { folderId: 2000, folderName: '올리기전용', parentFolderId: 1000 },
    ])
    // 올리기전용 → [ExistingCo]
    ;(lguplus.getSubFolders as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { folderId: 3000, folderName: 'ExistingCo', parentFolderId: 2000 },
    ])

    ;(state.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'existing-id',
      lguplus_folder_name: 'ExistingCo',
    })

    const result = await discovery.discoverFolders()
    // 올리기전용(1) + ExistingCo(1) = 2개 기존 폴더
    expect(result.existingFolders).toBe(2)
    expect(result.newFolders).toBe(0)
    // ensureFolderPath는 호출되지 않아야 함
    expect(uploader.ensureFolderPath).not.toHaveBeenCalled()
  })
})
