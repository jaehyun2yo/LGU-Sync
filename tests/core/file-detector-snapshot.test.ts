import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FileDetector } from '../../src/core/file-detector'
import { EventBus } from '../../src/core/event-bus'
import { Logger } from '../../src/core/logger'
import type { ILGUplusClient, LGUplusFileItem } from '../../src/core/types'
import type { IStateManager } from '../../src/core/types/state-manager.types'
import type { SyncFolderRow, SyncFileRow } from '../../src/core/db/types'

// 헬퍼: LGUplusFileItem 생성
function makeFileItem(overrides: Partial<LGUplusFileItem> = {}): LGUplusFileItem {
  return {
    itemId: 1001,
    itemName: 'drawing1.dxf',
    itemSize: 50000,
    itemExtension: 'dxf',
    parentFolderId: 100,
    updatedAt: '2026-03-09 10:00:00',
    isFolder: false,
    ...overrides,
  }
}

// 헬퍼: SyncFolderRow 생성
function makeFolderRow(overrides: Partial<SyncFolderRow> = {}): SyncFolderRow {
  return {
    id: 'folder-uuid-1',
    lguplus_folder_id: '100',
    lguplus_folder_name: '원컴퍼니',
    lguplus_folder_path: '/올리기전용/원컴퍼니',
    self_webhard_path: null,
    company_name: '원컴퍼니',
    enabled: true,
    auto_detected: false,
    files_synced: 0,
    bytes_synced: 0,
    last_synced_at: null,
    created_at: '2026-03-09T00:00:00Z',
    updated_at: '2026-03-09T00:00:00Z',
    ...overrides,
  }
}

// 헬퍼: SyncFileRow 생성 (최소 필드)
function makeFileRow(overrides: Partial<SyncFileRow> = {}): SyncFileRow {
  return {
    id: 'file-uuid-1',
    folder_id: 'folder-uuid-1',
    history_no: null,
    file_name: 'drawing1.dxf',
    file_path: '/올리기전용/원컴퍼니/drawing1.dxf',
    file_size: 50000,
    file_extension: 'dxf',
    lguplus_file_id: '1001',
    lguplus_updated_at: null,
    status: 'completed',
    download_path: null,
    self_webhard_file_id: null,
    md5_hash: null,
    retry_count: 0,
    last_error: null,
    detected_at: '2026-03-09T00:00:00Z',
    download_started_at: null,
    download_completed_at: null,
    upload_started_at: null,
    upload_completed_at: null,
    created_at: '2026-03-09T00:00:00Z',
    updated_at: '2026-03-09T00:00:00Z',
    ...overrides,
  }
}

// Mock LGU+ client
function createMockLGUplusClient(): ILGUplusClient {
  return {
    login: vi.fn(),
    logout: vi.fn(),
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
    downloadFile: vi.fn().mockResolvedValue({ success: true, size: 0, filename: '' }),
    batchDownload: vi
      .fn()
      .mockResolvedValue({ success: 0, failed: 0, totalSize: 0, failedFiles: [] }),
    getUploadHistory: vi.fn().mockResolvedValue({ total: 0, pageSize: 20, items: [] }),
    on: vi.fn(),
  }
}

// Mock StateManager
function createMockStateManager(): Partial<IStateManager> {
  return {
    getCheckpoint: vi.fn().mockReturnValue(null),
    saveCheckpoint: vi.fn(),
    getFileByHistoryNo: vi.fn().mockReturnValue(null),
    getFolders: vi.fn().mockReturnValue([]),
    getFilesByFolder: vi.fn().mockReturnValue([]),
  }
}

describe('FileDetector - snapshot 전략', () => {
  let detector: FileDetector
  let mockClient: ILGUplusClient
  let mockState: Partial<IStateManager>
  let eventBus: EventBus
  let logger: Logger

  beforeEach(() => {
    vi.useFakeTimers()
    eventBus = new EventBus()
    logger = new Logger({ minLevel: 'error' })
    mockClient = createMockLGUplusClient()
    mockState = createMockStateManager()
  })

  afterEach(() => {
    detector?.stop()
    vi.useRealTimers()
  })

  function createDetector(strategy: 'polling' | 'snapshot' = 'snapshot') {
    detector = new FileDetector(mockClient, mockState as IStateManager, eventBus, logger, {
      pollingIntervalMs: 5000,
      strategy,
    })
    return detector
  }

  it('snapshot 전략으로 시작하면 getFileList를 호출하고 getUploadHistory는 호출하지 않는다', async () => {
    // 폴더 1개 등록
    ;(mockState.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([makeFolderRow()])
    ;(mockClient.getFileList as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [],
      total: 0,
    })

    createDetector('snapshot')
    await detector.forceCheck()

    expect(mockClient.getFileList).toHaveBeenCalledWith(100)
    expect(mockClient.getUploadHistory).not.toHaveBeenCalled()
  })

  it('폴더에 새 파일이 있으면 감지하여 핸들러를 호출한다', async () => {
    const handler = vi.fn()

    ;(mockState.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([makeFolderRow()])
    ;(mockState.getFilesByFolder as ReturnType<typeof vi.fn>).mockReturnValue([])
    ;(mockClient.getFileList as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [makeFileItem({ itemId: 1001, itemName: 'drawing1.dxf', itemSize: 50000 })],
      total: 1,
    })

    createDetector('snapshot')
    detector.onFilesDetected(handler)

    const files = await detector.forceCheck()

    expect(files).toHaveLength(1)
    expect(files[0].fileName).toBe('drawing1.dxf')
    expect(files[0].operCode).toBe('UP')
    expect(handler).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ fileName: 'drawing1.dxf', operCode: 'UP' })]),
      'snapshot',
    )
  })

  it('이미 DB에 있는 파일은 중복 감지하지 않는다', async () => {
    ;(mockState.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([makeFolderRow()])
    // DB에 이미 같은 파일 ID가 있음
    ;(mockState.getFilesByFolder as ReturnType<typeof vi.fn>).mockReturnValue([
      makeFileRow({ lguplus_file_id: '1001' }),
    ])
    ;(mockClient.getFileList as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [makeFileItem({ itemId: 1001, itemName: 'drawing1.dxf' })],
      total: 1,
    })

    createDetector('snapshot')
    const files = await detector.forceCheck()

    expect(files).toHaveLength(0)
  })

  it('게스트가 업로드한 파일도 정상적으로 감지한다', async () => {
    // 핵심 시나리오: history API에는 안 나오지만 폴더에는 파일이 있음
    ;(mockState.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([makeFolderRow()])
    ;(mockState.getFilesByFolder as ReturnType<typeof vi.fn>).mockReturnValue([])
    // getUploadHistory는 빈 결과 (게스트 업로드는 history에 안 나옴)
    ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      total: 0,
      pageSize: 20,
      items: [],
    })
    // 하지만 getFileList에는 파일이 있음 (거래처가 직접 업로드)
    ;(mockClient.getFileList as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [
        makeFileItem({ itemId: 2001, itemName: 'guest-upload.dxf', itemSize: 75000 }),
      ],
      total: 1,
    })

    createDetector('snapshot')
    const files = await detector.forceCheck()

    // snapshot 전략이므로 감지됨!
    expect(files).toHaveLength(1)
    expect(files[0].fileName).toBe('guest-upload.dxf')
  })

  it('EventBus에 snapshot strategy로 발행한다', async () => {
    const eventHandler = vi.fn()
    eventBus.on('detection:found', eventHandler)

    ;(mockState.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([makeFolderRow()])
    ;(mockState.getFilesByFolder as ReturnType<typeof vi.fn>).mockReturnValue([])
    ;(mockClient.getFileList as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [makeFileItem()],
      total: 1,
    })

    createDetector('snapshot')
    await detector.forceCheck()

    expect(eventHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'snapshot',
        files: expect.arrayContaining([
          expect.objectContaining({ fileName: 'drawing1.dxf' }),
        ]),
      }),
    )
  })

  it('여러 폴더의 파일을 한 번에 감지한다', async () => {
    const folder1 = makeFolderRow({
      id: 'folder-1',
      lguplus_folder_id: '100',
      lguplus_folder_name: '원컴퍼니',
    })
    const folder2 = makeFolderRow({
      id: 'folder-2',
      lguplus_folder_id: '200',
      lguplus_folder_name: '대성목형',
    })

    ;(mockState.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([folder1, folder2])
    ;(mockState.getFilesByFolder as ReturnType<typeof vi.fn>).mockReturnValue([])
    ;(mockClient.getFileList as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [makeFileItem({ itemId: 1001, itemName: 'file-a.dxf' })],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [makeFileItem({ itemId: 2001, itemName: 'file-b.dxf' })],
        total: 1,
      })

    createDetector('snapshot')
    const files = await detector.forceCheck()

    expect(files).toHaveLength(2)
    expect(mockClient.getFileList).toHaveBeenCalledTimes(2)
    expect(mockClient.getFileList).toHaveBeenCalledWith(100)
    expect(mockClient.getFileList).toHaveBeenCalledWith(200)
  })

  it('snapshot 폴링 에러 시 빈 배열 반환 (크래시 안 함)', async () => {
    ;(mockState.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([makeFolderRow()])
    ;(mockClient.getFileList as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network error'),
    )

    createDetector('snapshot')
    const files = await detector.forceCheck()

    expect(files).toHaveLength(0)
  })

  it('감시 폴더가 없으면 빈 배열 반환', async () => {
    ;(mockState.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([])

    createDetector('snapshot')
    const files = await detector.forceCheck()

    expect(files).toHaveLength(0)
  })
})
