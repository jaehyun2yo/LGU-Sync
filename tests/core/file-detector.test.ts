import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FileDetector } from '../../src/core/file-detector'
import { EventBus } from '../../src/core/event-bus'
import { Logger } from '../../src/core/logger'
import type { ILGUplusClient, UploadHistoryResponse } from '../../src/core/types'
import type { IStateManager } from '../../src/core/types/state-manager.types'

// Minimal mock LGU+ client
function createMockLGUplusClient(
  historyItems: UploadHistoryResponse = { total: 0, pageSize: 20, items: [] },
): ILGUplusClient {
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
    getDownloadUrlInfo: vi.fn().mockResolvedValue(null),
    downloadFile: vi.fn().mockResolvedValue({ success: true, size: 0, filename: '' }),
    batchDownload: vi.fn().mockResolvedValue({ success: 0, failed: 0, totalSize: 0, failedFiles: [] }),
    getUploadHistory: vi.fn().mockResolvedValue(historyItems),
    on: vi.fn(),
  }
}

// Minimal mock StateManager
function createMockStateManager(): Partial<IStateManager> {
  return {
    getCheckpoint: vi.fn().mockReturnValue(null),
    saveCheckpoint: vi.fn(),
    getFileByHistoryNo: vi.fn().mockReturnValue(null),
    getFolders: vi.fn().mockReturnValue([]),
  }
}

describe('FileDetector', () => {
  let detector: FileDetector
  let mockClient: ILGUplusClient
  let mockState: Partial<IStateManager>
  let eventBus: EventBus
  let logger: Logger

  beforeEach(() => {
    vi.useFakeTimers()
    eventBus = new EventBus()
    logger = new Logger({ minLevel: 'error' })
    mockClient = createMockLGUplusClient({
      total: 1,
      pageSize: 20,
      items: [
        {
          historyNo: 101,
          itemSrcNo: 5001,
          itemFolderId: 1001,
          itemSrcName: 'drawing1',
          itemSrcExtension: 'dxf',
          itemSrcType: 'file',
          itemFolderFullpath: '/올리기전용/원컴퍼니/',
          itemOperCode: 'UP',
          itemUseDate: '2026-02-23 10:00:00',
        },
      ],
    })
    mockState = createMockStateManager()

    detector = new FileDetector(
      mockClient,
      mockState as IStateManager,
      eventBus,
      logger,
      { pollingIntervalMs: 5000 },
    )
  })

  afterEach(() => {
    detector.stop()
    vi.useRealTimers()
  })

  it('start()로 폴링을 시작한다', () => {
    detector.start()
    // Polling timer should be active
    expect(vi.getTimerCount()).toBeGreaterThan(0)
  })

  it('stop()으로 폴링을 중지한다', () => {
    detector.start()
    detector.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('setPollingInterval()로 폴링 간격을 변경한다', () => {
    detector.setPollingInterval(10000)
    detector.start()
    // Should still have timers
    expect(vi.getTimerCount()).toBeGreaterThan(0)
  })

  it('forceCheck()로 수동 감지를 실행한다', async () => {
    const files = await detector.forceCheck()
    expect(files).toHaveLength(1)
    expect(files[0].fileName).toBe('drawing1.dxf')
    expect(files[0].operCode).toBe('UP')
  })

  it('onFilesDetected()로 핸들러를 등록하고 파일 감지 시 호출된다', async () => {
    const handler = vi.fn()
    detector.onFilesDetected(handler)

    await detector.forceCheck()

    expect(handler).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ fileName: 'drawing1.dxf', operCode: 'UP' }),
      ]),
      'polling',
    )
  })

  it('onFilesDetected()가 반환한 함수로 구독 해제', async () => {
    const handler = vi.fn()
    const unsubscribe = detector.onFilesDetected(handler)
    unsubscribe()

    await detector.forceCheck()

    expect(handler).not.toHaveBeenCalled()
  })

  it('이미 처리된 historyNo는 중복 감지하지 않는다', async () => {
    // First call: detect the file
    const files1 = await detector.forceCheck()
    expect(files1).toHaveLength(1)

    // Mark as already seen via checkpoint
    ;(mockState.getCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue('101')

    // Second call: no new files
    const files2 = await detector.forceCheck()
    expect(files2).toHaveLength(0)
  })

  it('폴링 중 에러가 발생해도 멈추지 않는다', async () => {
    ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network error'),
    )

    // Should not throw
    const files = await detector.forceCheck()
    expect(files).toHaveLength(0)
  })

  it('getUploadHistory에서 빈 응답이면 빈 배열 반환', async () => {
    ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      total: 0,
      pageSize: 20,
      items: [],
    })

    const files = await detector.forceCheck()
    expect(files).toHaveLength(0)
  })

  it('detection:found 이벤트를 EventBus로 발행한다', async () => {
    const handler = vi.fn()
    eventBus.on('detection:found', handler)

    await detector.forceCheck()

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        files: expect.arrayContaining([
          expect.objectContaining({ fileName: 'drawing1.dxf', operCode: 'UP' }),
        ]),
        strategy: 'polling',
      }),
    )
  })

  it('DN(다운로드) operCode는 감지에서 제외한다', async () => {
    ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      total: 2,
      pageSize: 20,
      items: [
        {
          historyNo: 201,
          itemSrcNo: 5001,
          itemFolderId: 1001,
          itemSrcName: 'drawing1',
          itemSrcExtension: 'dxf',
          itemSrcType: 'file',
          itemFolderFullpath: '/올리기전용/원컴퍼니/',
          itemOperCode: 'DN',
          itemUseDate: '2026-02-23 10:00:00',
        },
        {
          historyNo: 202,
          itemSrcNo: 5002,
          itemFolderId: 1001,
          itemSrcName: 'drawing2',
          itemSrcExtension: 'dxf',
          itemSrcType: 'file',
          itemFolderFullpath: '/올리기전용/원컴퍼니/',
          itemOperCode: 'UP',
          itemUseDate: '2026-02-23 10:01:00',
        },
      ],
    })

    const files = await detector.forceCheck()

    // DN은 필터링되고 UP만 반환
    expect(files).toHaveLength(1)
    expect(files[0].fileName).toBe('drawing2.dxf')
    expect(files[0].operCode).toBe('UP')

    // checkpoint는 DN 포함 전체 중 max (202)로 갱신
    expect(mockState.saveCheckpoint).toHaveBeenCalledWith('last_history_no', '202')
  })

  it('모든 operCode를 감지한다 (DN 제외)', async () => {
    ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      total: 4,
      pageSize: 20,
      items: [
        {
          historyNo: 301, itemSrcNo: 5001, itemFolderId: 1001,
          itemSrcName: 'file1', itemSrcExtension: 'dxf', itemSrcType: 'file',
          itemFolderFullpath: '/올리기전용/', itemOperCode: 'D',
          itemUseDate: '2026-02-23 10:00:00',
        },
        {
          historyNo: 302, itemSrcNo: 5002, itemFolderId: 1001,
          itemSrcName: 'file2', itemSrcExtension: 'dxf', itemSrcType: 'file',
          itemFolderFullpath: '/올리기전용/', itemOperCode: 'MV',
          itemUseDate: '2026-02-23 10:01:00',
        },
        {
          historyNo: 303, itemSrcNo: 5003, itemFolderId: 1001,
          itemSrcName: 'file3', itemSrcExtension: 'dxf', itemSrcType: 'file',
          itemFolderFullpath: '/올리기전용/', itemOperCode: 'RN',
          itemUseDate: '2026-02-23 10:02:00',
        },
        {
          historyNo: 304, itemSrcNo: 5004, itemFolderId: 1001,
          itemSrcName: '새폴더', itemSrcExtension: '', itemSrcType: 'folder',
          itemFolderFullpath: '/올리기전용/', itemOperCode: 'FC',
          itemUseDate: '2026-02-23 10:03:00',
        },
      ],
    })

    const files = await detector.forceCheck()

    expect(files).toHaveLength(4)
    expect(files.map((f) => f.operCode)).toEqual(['D', 'MV', 'RN', 'FC'])
    // 폴더 operCode(FC)는 확장자 없이 이름만
    expect(files[3].fileName).toBe('새폴더')
  })

  it('operCode를 빈 문자열로 호출하여 전체 이력을 조회한다', async () => {
    await detector.forceCheck()

    expect(mockClient.getUploadHistory).toHaveBeenCalledWith({ operCode: '' })
  })
})
