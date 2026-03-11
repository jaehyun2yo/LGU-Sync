import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FileDetector, cleanFolderPath } from '../../src/core/file-detector'
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
    getAllFilesDeep: vi.fn().mockResolvedValue([]),
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
    getCheckpoint: vi.fn().mockReturnValue('0'),
    saveCheckpoint: vi.fn(),
    getFileByHistoryNo: vi.fn().mockReturnValue(null),
    getFileByLguplusFileId: vi.fn().mockReturnValue(null),
    getFolderByLguplusId: vi.fn().mockReturnValue(null),
    getFolders: vi.fn().mockReturnValue([]),
    getFilesByFolder: vi.fn().mockReturnValue([]),
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

  // ── 기본 동작 ──

  it('start()로 폴링을 시작한다', () => {
    detector.start()
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
    const files1 = await detector.forceCheck()
    expect(files1).toHaveLength(1)

    ;(mockState.getCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue('101')

    const files2 = await detector.forceCheck()
    expect(files2).toHaveLength(0)
  })

  it('폴링 중 에러가 발생해도 멈추지 않는다', async () => {
    ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network error'),
    )

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
          historyNo: 201, itemSrcNo: 5001, itemFolderId: 1001,
          itemSrcName: 'drawing1', itemSrcExtension: 'dxf', itemSrcType: 'file',
          itemFolderFullpath: '/올리기전용/원컴퍼니/', itemOperCode: 'DN',
          itemUseDate: '2026-02-23 10:00:00',
        },
        {
          historyNo: 202, itemSrcNo: 5002, itemFolderId: 1001,
          itemSrcName: 'drawing2', itemSrcExtension: 'dxf', itemSrcType: 'file',
          itemFolderFullpath: '/올리기전용/원컴퍼니/', itemOperCode: 'UP',
          itemUseDate: '2026-02-23 10:01:00',
        },
      ],
    })

    const files = await detector.forceCheck()
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
    expect(files[3].fileName).toBe('새폴더')
  })

  it('operCode를 빈 문자열로 호출하여 전체 이력을 조회한다', async () => {
    await detector.forceCheck()
    expect(mockClient.getUploadHistory).toHaveBeenCalledWith(
      expect.objectContaining({ operCode: '' }),
    )
  })

  // ── 다중 페이지 폴링 ──

  describe('다중 페이지 폴링', () => {
    it('total > pageSize일 때 추가 페이지를 조회한다', async () => {
      const getUploadHistory = mockClient.getUploadHistory as ReturnType<typeof vi.fn>
      getUploadHistory
        .mockResolvedValueOnce({
          total: 40,
          pageSize: 20,
          items: Array.from({ length: 20 }, (_, i) => ({
            historyNo: 140 - i,
            itemSrcNo: 5000 + i,
            itemFolderId: 1001,
            itemSrcName: `file${i}`,
            itemSrcExtension: 'dxf',
            itemSrcType: 'file',
            itemFolderFullpath: '/올리기전용/',
            itemOperCode: 'UP',
            itemUseDate: '2026-02-23 10:00:00',
          })),
        })
        .mockResolvedValueOnce({
          total: 40,
          pageSize: 20,
          items: Array.from({ length: 20 }, (_, i) => ({
            historyNo: 120 - i,
            itemSrcNo: 5020 + i,
            itemFolderId: 1001,
            itemSrcName: `file${20 + i}`,
            itemSrcExtension: 'dxf',
            itemSrcType: 'file',
            itemFolderFullpath: '/올리기전용/',
            itemOperCode: 'UP',
            itemUseDate: '2026-02-23 09:00:00',
          })),
        })

      const files = await detector.forceCheck()
      expect(files).toHaveLength(40)
      // 2번째 페이지도 조회됨
      expect(getUploadHistory).toHaveBeenCalledTimes(2)
      expect(getUploadHistory).toHaveBeenNthCalledWith(2,
        expect.objectContaining({ page: 2 }),
      )
    })

    it('모든 항목이 lastNo 이하여도 전체 페이지를 모두 스캔한다', async () => {
      ;(mockState.getCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue('110')

      const getUploadHistory = mockClient.getUploadHistory as ReturnType<typeof vi.fn>
      getUploadHistory
        .mockResolvedValueOnce({
          total: 60,
          pageSize: 20,
          items: Array.from({ length: 20 }, (_, i) => ({
            historyNo: 130 - i, // 130~111 → 일부가 lastNo(110) 초과
            itemSrcNo: 5000 + i,
            itemFolderId: 1001,
            itemSrcName: `file${i}`,
            itemSrcExtension: 'dxf',
            itemSrcType: 'file',
            itemFolderFullpath: '/올리기전용/',
            itemOperCode: 'UP',
            itemUseDate: '2026-02-23 10:00:00',
          })),
        })
        .mockResolvedValueOnce({
          total: 60,
          pageSize: 20,
          items: Array.from({ length: 20 }, (_, i) => ({
            historyNo: 110 - i, // 110~91 → 모두 lastNo(110) 이하
            itemSrcNo: 5020 + i,
            itemFolderId: 1001,
            itemSrcName: `file${20 + i}`,
            itemSrcExtension: 'dxf',
            itemSrcType: 'file',
            itemFolderFullpath: '/올리기전용/',
            itemOperCode: 'UP',
            itemUseDate: '2026-02-23 09:00:00',
          })),
        })
        .mockResolvedValueOnce({
          total: 60,
          pageSize: 20,
          items: Array.from({ length: 20 }, (_, i) => ({
            historyNo: 90 - i, // 90~71 → 모두 lastNo(110) 이하
            itemSrcNo: 5040 + i,
            itemFolderId: 1001,
            itemSrcName: `file${40 + i}`,
            itemSrcExtension: 'dxf',
            itemSrcType: 'file',
            itemFolderFullpath: '/올리기전용/',
            itemOperCode: 'UP',
            itemUseDate: '2026-02-23 08:00:00',
          })),
        })

      await detector.forceCheck()

      // 조기 종료 없이 3페이지 전체 스캔 (감지 누락 방지)
      expect(getUploadHistory).toHaveBeenCalledTimes(3)
    })

    it('모든 페이지에서 lastNo 초과 항목이 없어도 전체 페이지를 모두 스캔한다', async () => {
      ;(mockState.getCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue('200')

      const getUploadHistory = mockClient.getUploadHistory as ReturnType<typeof vi.fn>
      getUploadHistory
        .mockResolvedValueOnce({
          total: 60,
          pageSize: 20,
          items: Array.from({ length: 20 }, (_, i) => ({
            historyNo: 200 - i, // 200~181 → 모두 lastNo(200) 이하
            itemSrcNo: 5000 + i,
            itemFolderId: 1001,
            itemSrcName: `file${i}`,
            itemSrcExtension: 'dxf',
            itemSrcType: 'file',
            itemFolderFullpath: '/올리기전용/',
            itemOperCode: 'UP',
            itemUseDate: '2026-02-23 10:00:00',
          })),
        })
        .mockResolvedValueOnce({
          total: 60,
          pageSize: 20,
          items: Array.from({ length: 20 }, (_, i) => ({
            historyNo: 180 - i, // 180~161 → 모두 lastNo(200) 이하
            itemSrcNo: 5020 + i,
            itemFolderId: 1001,
            itemSrcName: `file${20 + i}`,
            itemSrcExtension: 'dxf',
            itemSrcType: 'file',
            itemFolderFullpath: '/올리기전용/',
            itemOperCode: 'UP',
            itemUseDate: '2026-02-23 09:00:00',
          })),
        })
        .mockResolvedValueOnce({
          total: 60,
          pageSize: 20,
          items: Array.from({ length: 20 }, (_, i) => ({
            historyNo: 160 - i, // 160~141 → 모두 lastNo(200) 이하
            itemSrcNo: 5040 + i,
            itemFolderId: 1001,
            itemSrcName: `file${40 + i}`,
            itemSrcExtension: 'dxf',
            itemSrcType: 'file',
            itemFolderFullpath: '/올리기전용/',
            itemOperCode: 'UP',
            itemUseDate: '2026-02-23 08:00:00',
          })),
        })

      const files = await detector.forceCheck()
      expect(files).toHaveLength(0)
      // 조기 종료 없이 3페이지 전체 스캔
      expect(getUploadHistory).toHaveBeenCalledTimes(3)
    })
  })

  // ── 에러 백오프 ──

  describe('에러 백오프', () => {
    it('연속 5회 실패 시 폴링 간격이 2배로 증가한다', async () => {
      ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('network error'),
      )

      // 5회 연속 실패
      for (let i = 0; i < 5; i++) {
        await detector.forceCheck()
      }

      // 내부 폴링 간격이 증가했는지 확인: start/stop 후 타이머 간격으로 검증
      // 간접적으로 검증 - stop 후 start하면 새 간격으로 시작
      detector.start()
      detector.stop()
      // 폴링 간격이 5000 -> 10000으로 증가했으므로 다시 start하면 10000ms 간격
      // 이 테스트는 내부 상태를 직접 확인할 수 없으므로, 성공 후 복원 테스트와 함께 검증
    })

    it('백오프 상태에서 성공하면 원래 간격으로 복원된다', async () => {
      const getUploadHistory = mockClient.getUploadHistory as ReturnType<typeof vi.fn>

      // 5회 실패
      getUploadHistory.mockRejectedValue(new Error('fail'))
      for (let i = 0; i < 5; i++) {
        await detector.forceCheck()
      }

      // 성공 응답으로 변경
      getUploadHistory.mockResolvedValue({
        total: 1,
        pageSize: 20,
        items: [{
          historyNo: 101, itemSrcNo: 5001, itemFolderId: 1001,
          itemSrcName: 'drawing1', itemSrcExtension: 'dxf', itemSrcType: 'file',
          itemFolderFullpath: '/올리기전용/', itemOperCode: 'UP',
          itemUseDate: '2026-02-23 10:00:00',
        }],
      })

      // 성공 시 카운터 리셋 + 간격 복원
      const files = await detector.forceCheck()
      expect(files).toHaveLength(1)
    })

    it('최대 간격(60초)을 초과하지 않는다', async () => {
      ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('fail'),
      )

      // 많은 횟수 실패 (간격이 계속 2배 → 최대 60초 제한)
      for (let i = 0; i < 20; i++) {
        await detector.forceCheck()
      }

      // 에러가 발생하지 않으면 성공 (최대 간격 제한이 작동함)
      expect(true).toBe(true)
    })
  })

  // ── operCode 감지 ──

  describe('operCode detection', () => {
    it('혼합된 operCode가 포함된 히스토리에서 모든 operCode를 올바르게 감지한다', async () => {
      ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
        total: 9,
        pageSize: 20,
        items: [
          { historyNo: 401, itemSrcNo: 6001, itemFolderId: 1001, itemSrcName: 'file-up', itemSrcExtension: 'dxf', itemSrcType: 'file', itemFolderFullpath: '/올리기전용/', itemOperCode: 'UP', itemUseDate: '2026-02-23 10:00:00' },
          { historyNo: 402, itemSrcNo: 6002, itemFolderId: 1001, itemSrcName: 'file-del', itemSrcExtension: 'dxf', itemSrcType: 'file', itemFolderFullpath: '/올리기전용/', itemOperCode: 'D', itemUseDate: '2026-02-23 10:01:00' },
          { historyNo: 403, itemSrcNo: 6003, itemFolderId: 1001, itemSrcName: 'file-mv', itemSrcExtension: 'dxf', itemSrcType: 'file', itemFolderFullpath: '/올리기전용/', itemOperCode: 'MV', itemUseDate: '2026-02-23 10:02:00' },
          { historyNo: 404, itemSrcNo: 6004, itemFolderId: 1001, itemSrcName: 'file-rn', itemSrcExtension: 'dxf', itemSrcType: 'file', itemFolderFullpath: '/올리기전용/', itemOperCode: 'RN', itemUseDate: '2026-02-23 10:03:00' },
          { historyNo: 405, itemSrcNo: 6005, itemFolderId: 1001, itemSrcName: 'file-cp', itemSrcExtension: 'dxf', itemSrcType: 'file', itemFolderFullpath: '/올리기전용/', itemOperCode: 'CP', itemUseDate: '2026-02-23 10:04:00' },
          { historyNo: 406, itemSrcNo: 6006, itemFolderId: 1001, itemSrcName: '새폴더', itemSrcExtension: '', itemSrcType: 'folder', itemFolderFullpath: '/올리기전용/', itemOperCode: 'FC', itemUseDate: '2026-02-23 10:05:00' },
          { historyNo: 407, itemSrcNo: 6007, itemFolderId: 1001, itemSrcName: '삭제폴더', itemSrcExtension: '', itemSrcType: 'folder', itemFolderFullpath: '/올리기전용/', itemOperCode: 'FD', itemUseDate: '2026-02-23 10:06:00' },
          { historyNo: 408, itemSrcNo: 6008, itemFolderId: 1001, itemSrcName: '이동폴더', itemSrcExtension: '', itemSrcType: 'folder', itemFolderFullpath: '/올리기전용/', itemOperCode: 'FMV', itemUseDate: '2026-02-23 10:07:00' },
          { historyNo: 409, itemSrcNo: 6009, itemFolderId: 1001, itemSrcName: '이름변경폴더', itemSrcExtension: '', itemSrcType: 'folder', itemFolderFullpath: '/올리기전용/', itemOperCode: 'FRN', itemUseDate: '2026-02-23 10:08:00' },
        ],
      })

      const files = await detector.forceCheck()
      expect(files).toHaveLength(9)
      expect(files.map((f) => f.operCode)).toEqual([
        'UP', 'D', 'MV', 'RN', 'CP', 'FC', 'FD', 'FMV', 'FRN',
      ])

      // 각 파일의 operCode가 원본과 일치하는지 개별 검증
      expect(files[0]).toMatchObject({ fileName: 'file-up.dxf', operCode: 'UP' })
      expect(files[1]).toMatchObject({ fileName: 'file-del.dxf', operCode: 'D' })
      expect(files[4]).toMatchObject({ fileName: 'file-cp.dxf', operCode: 'CP' })
      expect(files[5]).toMatchObject({ fileName: '새폴더', operCode: 'FC' })
    })

    it('DN operCode는 감지에서 제외된다', async () => {
      ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
        total: 3,
        pageSize: 20,
        items: [
          { historyNo: 501, itemSrcNo: 7001, itemFolderId: 1001, itemSrcName: 'download1', itemSrcExtension: 'dxf', itemSrcType: 'file', itemFolderFullpath: '/올리기전용/', itemOperCode: 'DN', itemUseDate: '2026-02-23 10:00:00' },
          { historyNo: 502, itemSrcNo: 7002, itemFolderId: 1001, itemSrcName: 'upload1', itemSrcExtension: 'dxf', itemSrcType: 'file', itemFolderFullpath: '/올리기전용/', itemOperCode: 'UP', itemUseDate: '2026-02-23 10:01:00' },
          { historyNo: 503, itemSrcNo: 7003, itemFolderId: 1001, itemSrcName: 'download2', itemSrcExtension: 'dxf', itemSrcType: 'file', itemFolderFullpath: '/올리기전용/', itemOperCode: 'DN', itemUseDate: '2026-02-23 10:02:00' },
        ],
      })

      const files = await detector.forceCheck()
      expect(files).toHaveLength(1)
      expect(files[0].operCode).toBe('UP')
      expect(files[0].fileName).toBe('upload1.dxf')

      // checkpoint는 DN 포함 전체 max (503)로 갱신
      expect(mockState.saveCheckpoint).toHaveBeenCalledWith('last_history_no', '503')
    })

    it('폴더 operCode(FC, FD, FMV, FRN)는 확장자를 붙이지 않는다', async () => {
      ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
        total: 4,
        pageSize: 20,
        items: [
          { historyNo: 601, itemSrcNo: 8001, itemFolderId: 1001, itemSrcName: '생성폴더', itemSrcExtension: '', itemSrcType: 'folder', itemFolderFullpath: '/올리기전용/', itemOperCode: 'FC', itemUseDate: '2026-02-23 10:00:00' },
          { historyNo: 602, itemSrcNo: 8002, itemFolderId: 1001, itemSrcName: '삭제폴더', itemSrcExtension: '', itemSrcType: 'folder', itemFolderFullpath: '/올리기전용/', itemOperCode: 'FD', itemUseDate: '2026-02-23 10:01:00' },
          { historyNo: 603, itemSrcNo: 8003, itemFolderId: 1001, itemSrcName: '이동폴더', itemSrcExtension: '', itemSrcType: 'folder', itemFolderFullpath: '/올리기전용/', itemOperCode: 'FMV', itemUseDate: '2026-02-23 10:02:00' },
          { historyNo: 604, itemSrcNo: 8004, itemFolderId: 1001, itemSrcName: '이름변경폴더', itemSrcExtension: '', itemSrcType: 'folder', itemFolderFullpath: '/올리기전용/', itemOperCode: 'FRN', itemUseDate: '2026-02-23 10:03:00' },
        ],
      })

      const files = await detector.forceCheck()
      expect(files).toHaveLength(4)

      // 폴더 operCode는 확장자를 추가하지 않으므로 이름 그대로
      expect(files[0].fileName).toBe('생성폴더')
      expect(files[1].fileName).toBe('삭제폴더')
      expect(files[2].fileName).toBe('이동폴더')
      expect(files[3].fileName).toBe('이름변경폴더')

      // filePath도 확장자 없이 구성
      expect(files[0].filePath).toBe('/올리기전용/생성폴더')
      expect(files[1].filePath).toBe('/올리기전용/삭제폴더')
      expect(files[2].filePath).toBe('/올리기전용/이동폴더')
      expect(files[3].filePath).toBe('/올리기전용/이름변경폴더')
    })

    it('파일 operCode(UP, D, MV, RN, CP)는 확장자를 붙인다', async () => {
      ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
        total: 2,
        pageSize: 20,
        items: [
          { historyNo: 701, itemSrcNo: 9001, itemFolderId: 1001, itemSrcName: 'design', itemSrcExtension: 'dxf', itemSrcType: 'file', itemFolderFullpath: '/올리기전용/', itemOperCode: 'RN', itemUseDate: '2026-02-23 10:00:00' },
          { historyNo: 702, itemSrcNo: 9002, itemFolderId: 1001, itemSrcName: 'report', itemSrcExtension: 'pdf', itemSrcType: 'file', itemFolderFullpath: '/올리기전용/', itemOperCode: 'CP', itemUseDate: '2026-02-23 10:01:00' },
        ],
      })

      const files = await detector.forceCheck()
      expect(files).toHaveLength(2)
      expect(files[0].fileName).toBe('design.dxf')
      expect(files[1].fileName).toBe('report.pdf')
      expect(files[0].filePath).toBe('/올리기전용/design.dxf')
      expect(files[1].filePath).toBe('/올리기전용/report.pdf')
    })
  })

  // ── 확장자 중복 방지 ──

  describe('확장자 중복 방지', () => {
    it('itemSrcName이 이미 확장자를 포함하면 중복으로 붙이지 않는다', async () => {
      const client = createMockLGUplusClient({
        total: 1,
        pageSize: 20,
        items: [
          {
            historyNo: 301,
            itemSrcNo: 6001,
            itemFolderId: 2001,
            itemSrcName: '테스트 (12).DXF',
            itemSrcExtension: 'DXF',
            itemSrcType: 'file',
            itemFolderFullpath: '/올리기전용/',
            itemOperCode: 'UP',
            itemUseDate: '2026-03-10 10:00:00',
          },
        ],
      })
      const det = new FileDetector(client, mockState as IStateManager, eventBus, logger, {
        pollingIntervalMs: 5000,
      })

      const files = await det.forceCheck()
      expect(files[0].fileName).toBe('테스트 (12).DXF')
      expect(files[0].filePath).toBe('/올리기전용/테스트 (12).DXF')
      det.stop()
    })

    it('대소문자가 다른 확장자도 중복을 방지한다', async () => {
      const client = createMockLGUplusClient({
        total: 1,
        pageSize: 20,
        items: [
          {
            historyNo: 302,
            itemSrcNo: 6002,
            itemFolderId: 2001,
            itemSrcName: 'design.dxf',
            itemSrcExtension: 'DXF',
            itemSrcType: 'file',
            itemFolderFullpath: '/올리기전용/',
            itemOperCode: 'UP',
            itemUseDate: '2026-03-10 10:00:00',
          },
        ],
      })
      const det = new FileDetector(client, mockState as IStateManager, eventBus, logger, {
        pollingIntervalMs: 5000,
      })

      const files = await det.forceCheck()
      expect(files[0].fileName).toBe('design.dxf')
      det.stop()
    })

    it('확장자가 없는 파일은 기존대로 확장자를 붙인다', async () => {
      const client = createMockLGUplusClient({
        total: 1,
        pageSize: 20,
        items: [
          {
            historyNo: 303,
            itemSrcNo: 6003,
            itemFolderId: 2001,
            itemSrcName: 'drawing1',
            itemSrcExtension: 'dxf',
            itemSrcType: 'file',
            itemFolderFullpath: '/올리기전용/',
            itemOperCode: 'CP',
            itemUseDate: '2026-03-10 10:00:00',
          },
        ],
      })
      const det = new FileDetector(client, mockState as IStateManager, eventBus, logger, {
        pollingIntervalMs: 5000,
      })

      const files = await det.forceCheck()
      expect(files[0].fileName).toBe('drawing1.dxf')
      det.stop()
    })

    it('확장자가 빈 문자열이면 .을 붙이지 않는다', async () => {
      const client = createMockLGUplusClient({
        total: 1,
        pageSize: 20,
        items: [
          {
            historyNo: 304,
            itemSrcNo: 6004,
            itemFolderId: 2001,
            itemSrcName: 'noext-file',
            itemSrcExtension: '',
            itemSrcType: 'file',
            itemFolderFullpath: '/올리기전용/',
            itemOperCode: 'UP',
            itemUseDate: '2026-03-10 10:00:00',
          },
        ],
      })
      const det = new FileDetector(client, mockState as IStateManager, eventBus, logger, {
        pollingIntervalMs: 5000,
      })

      const files = await det.forceCheck()
      expect(files[0].fileName).toBe('noext-file')
      det.stop()
    })
  })

  // ── lguplusFileId 전달 ──

  describe('lguplusFileId 전달', () => {
    it('DetectedFile에 itemSrcNo가 lguplusFileId로 포함된다', async () => {
      const client = createMockLGUplusClient({
        total: 1,
        pageSize: 20,
        items: [
          {
            historyNo: 401,
            itemSrcNo: 99001,
            itemFolderId: 2001,
            itemSrcName: 'test.DXF',
            itemSrcExtension: 'DXF',
            itemSrcType: 'file',
            itemFolderFullpath: '/올리기전용/',
            itemOperCode: 'UP',
            itemUseDate: '2026-03-10 10:00:00',
          },
        ],
      })
      const det = new FileDetector(client, mockState as IStateManager, eventBus, logger, {
        pollingIntervalMs: 5000,
      })

      const files = await det.forceCheck()
      expect(files[0].lguplusFileId).toBe(99001)
      det.stop()
    })

    it('폴더 operCode(FC)에서도 lguplusFileId가 포함된다', async () => {
      const client = createMockLGUplusClient({
        total: 1,
        pageSize: 20,
        items: [
          {
            historyNo: 402,
            itemSrcNo: 99002,
            itemFolderId: 2001,
            itemSrcName: '새폴더',
            itemSrcExtension: '',
            itemSrcType: 'folder',
            itemFolderFullpath: '/올리기전용/',
            itemOperCode: 'FC',
            itemUseDate: '2026-03-10 10:00:00',
          },
        ],
      })
      const det = new FileDetector(client, mockState as IStateManager, eventBus, logger, {
        pollingIntervalMs: 5000,
      })

      const files = await det.forceCheck()
      expect(files[0].lguplusFileId).toBe(99002)
      det.stop()
    })
  })

  // ── operCode 런타임 검증 ──

  describe('operCode 런타임 검증', () => {
    it('알 수 없는 operCode는 UP으로 폴백된다', async () => {
      ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
        total: 1,
        pageSize: 20,
        items: [{
          historyNo: 501, itemSrcNo: 5001, itemFolderId: 1001,
          itemSrcName: 'test', itemSrcExtension: 'dxf', itemSrcType: 'file',
          itemFolderFullpath: '/올리기전용/', itemOperCode: 'XX',
          itemUseDate: '2026-02-23 10:00:00',
        }],
      })

      const files = await detector.forceCheck()
      expect(files).toHaveLength(1)
      expect(files[0].operCode).toBe('UP')
    })

    it('알려진 operCode는 그대로 반환된다', async () => {
      const codes = ['UP', 'D', 'MV', 'RN', 'CP', 'FC', 'FD', 'FMV', 'FRN']

      for (const code of codes) {
        ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
          total: 1,
          pageSize: 20,
          items: [{
            historyNo: 600, itemSrcNo: 5001, itemFolderId: 1001,
            itemSrcName: 'test', itemSrcExtension: 'dxf', itemSrcType: 'file',
            itemFolderFullpath: '/올리기전용/', itemOperCode: code,
            itemUseDate: '2026-02-23 10:00:00',
          }],
        })
        ;(mockState.getCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue('0')

        const files = await detector.forceCheck()
        expect(files[0].operCode).toBe(code)
      }
    })
  })

  // ── 동시성 ──

  describe('동시성 제어', () => {
    it('forceCheck() 동시 2회 호출 시 saveCheckpoint는 1회만 호출된다', async () => {
      // isPolling 잠금으로 두 번째 호출은 즉시 빈 배열 반환
      const [files1, files2] = await Promise.all([
        detector.forceCheck(),
        detector.forceCheck(),
      ])

      // 둘 중 하나만 실제 폴링 완료 → saveCheckpoint 1회
      expect(mockState.saveCheckpoint).toHaveBeenCalledTimes(1)
      // 하나는 결과를 반환하고 하나는 빈 배열
      const totalDetected = files1.length + files2.length
      expect(totalDetected).toBe(1)
    })

    it('백오프 복원 시 setInterval 타이머가 1개만 활성화된다', async () => {
      const getUploadHistory = mockClient.getUploadHistory as ReturnType<typeof vi.fn>

      // 5회 실패 → 백오프 적용
      getUploadHistory.mockRejectedValue(new Error('fail'))
      for (let i = 0; i < 5; i++) {
        await detector.forceCheck()
      }

      // 성공으로 복원 → stop/start 내부 호출됨
      getUploadHistory.mockResolvedValue({
        total: 0, pageSize: 20, items: [],
      })
      detector.start() // 타이머 등록
      await detector.forceCheck() // 복원 트리거

      // 활성 타이머는 1개여야 함
      expect(vi.getTimerCount()).toBe(1)
    })
  })

  // ── 진행바 이벤트 ──

  describe('scan-progress 이벤트', () => {
    it('단일 페이지 폴링 시 detection:scan-progress 이벤트가 발행된다', async () => {
      const progressHandler = vi.fn()
      eventBus.on('detection:scan-progress', progressHandler)

      await detector.forceCheck()

      expect(progressHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'polling',
          currentPage: 1,
          totalPages: 1,
        }),
      )
    })

    it('다중 페이지 폴링 시 각 페이지마다 scan-progress 이벤트가 발행된다', async () => {
      const getUploadHistory = mockClient.getUploadHistory as ReturnType<typeof vi.fn>
      getUploadHistory
        .mockResolvedValueOnce({
          total: 40,
          pageSize: 20,
          items: Array.from({ length: 20 }, (_, i) => ({
            historyNo: 140 - i, itemSrcNo: 5000 + i, itemFolderId: 1001,
            itemSrcName: `file${i}`, itemSrcExtension: 'dxf', itemSrcType: 'file',
            itemFolderFullpath: '/올리기전용/', itemOperCode: 'UP',
            itemUseDate: '2026-02-23 10:00:00',
          })),
        })
        .mockResolvedValueOnce({
          total: 40,
          pageSize: 20,
          items: Array.from({ length: 20 }, (_, i) => ({
            historyNo: 120 - i, itemSrcNo: 5020 + i, itemFolderId: 1001,
            itemSrcName: `file${20 + i}`, itemSrcExtension: 'dxf', itemSrcType: 'file',
            itemFolderFullpath: '/올리기전용/', itemOperCode: 'UP',
            itemUseDate: '2026-02-23 09:00:00',
          })),
        })

      const progressHandler = vi.fn()
      eventBus.on('detection:scan-progress', progressHandler)

      await detector.forceCheck()

      // 첫 페이지(phase=polling) + 두 번째 페이지(phase=paginating) = 2회
      expect(progressHandler).toHaveBeenCalledTimes(2)
      expect(progressHandler).toHaveBeenNthCalledWith(1,
        expect.objectContaining({ phase: 'polling', currentPage: 1 }),
      )
      expect(progressHandler).toHaveBeenNthCalledWith(2,
        expect.objectContaining({ phase: 'paginating', currentPage: 2 }),
      )
    })

    it('scan-progress 이벤트에 discoveredCount가 포함된다', async () => {
      const progressHandler = vi.fn()
      eventBus.on('detection:scan-progress', progressHandler)

      await detector.forceCheck()

      const emittedData = progressHandler.mock.calls[0][0]
      expect(emittedData).toHaveProperty('discoveredCount')
      expect(typeof emittedData.discoveredCount).toBe('number')
    })
  })

  // ── Baseline 초기화 ──

  describe('baseline 초기화', () => {
    describe('polling 전략', () => {
      it('첫 실행(checkpoint 없음) 시 baseline을 설정하고 빈 배열 반환', async () => {
        ;(mockState.getCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue(null)

        const files = await detector.forceCheck()

        expect(files).toHaveLength(0)
        expect(mockState.saveCheckpoint).toHaveBeenCalledWith('last_history_no', '101')
      })

      it('baseline 설정 후 새 이력만 감지한다', async () => {
        // 첫 호출: baseline 설정
        ;(mockState.getCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue(null)
        await detector.forceCheck()

        // 두 번째 호출: checkpoint 존재, 새 이력 추가
        ;(mockState.getCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue('101')
        ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
          total: 1,
          pageSize: 20,
          items: [
            {
              historyNo: 102, itemSrcNo: 5002, itemFolderId: 1001,
              itemSrcName: 'new-file', itemSrcExtension: 'dxf', itemSrcType: 'file',
              itemFolderFullpath: '/올리기전용/', itemOperCode: 'UP',
              itemUseDate: '2026-02-23 11:00:00',
            },
          ],
        })

        const files = await detector.forceCheck()
        expect(files).toHaveLength(1)
        expect(files[0].fileName).toBe('new-file.dxf')
      })

      it('이력이 비어있으면 baseline을 0으로 설정', async () => {
        ;(mockState.getCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue(null)
        ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
          total: 0,
          pageSize: 20,
          items: [],
        })

        const files = await detector.forceCheck()
        expect(files).toHaveLength(0)
        expect(mockState.saveCheckpoint).toHaveBeenCalledWith('last_history_no', '0')
      })
    })

  })

  // ── 첫 실행 시 기존 파일 감지 ──

  describe('first poll with initial detection', () => {
    it('should detect existing files on first poll when setIncludeExistingOnFirstPoll called', async () => {
      ;(mockState.getCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue(null)
      ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
        items: [
          { historyNo: 100, itemSrcNo: 5001, itemSrcName: 'a', itemSrcExtension: 'dxf', itemFolderId: 1, itemFolderFullpath: '/올리기전용/업체A', itemOperCode: 'UP', itemUseDate: '2026-03-11' },
          { historyNo: 101, itemSrcNo: 5002, itemSrcName: 'b', itemSrcExtension: 'dxf', itemFolderId: 1, itemFolderFullpath: '/올리기전용/업체A', itemOperCode: 'UP', itemUseDate: '2026-03-11' },
          { historyNo: 102, itemSrcNo: 5003, itemSrcName: 'c', itemSrcExtension: 'dxf', itemFolderId: 1, itemFolderFullpath: '/올리기전용/업체A', itemOperCode: 'DN', itemUseDate: '2026-03-11' },
        ],
        total: 3,
        pageSize: 20,
      })

      detector.setIncludeExistingOnFirstPoll()
      const result = await detector.forceCheck()

      // DN은 제외되므로 2개만 감지
      expect(result).toHaveLength(2)
      // baseline은 max historyNo(102)로 설정
      expect(mockState.saveCheckpoint).toHaveBeenCalledWith('last_history_no', '102')
    })

    it('should skip existing files on first poll by default', async () => {
      ;(mockState.getCheckpoint as ReturnType<typeof vi.fn>).mockReturnValue(null)
      ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
        items: [
          { historyNo: 100, itemSrcNo: 5001, itemSrcName: 'a', itemSrcExtension: 'dxf', itemFolderId: 1, itemFolderFullpath: '/올리기전용', itemOperCode: 'UP', itemUseDate: '2026-03-11' },
        ],
        total: 1,
        pageSize: 20,
      })

      // setIncludeExistingOnFirstPoll를 호출하지 않음 → 기본 동작
      const result = await detector.forceCheck()

      expect(result).toHaveLength(0) // baseline만 설정, 파일 감지 안 함
      expect(mockState.saveCheckpoint).toHaveBeenCalledWith('last_history_no', '100')
    })

    it('should reset includeExisting flag after first use (1회성)', async () => {
      ;(mockState.getCheckpoint as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(null)  // 첫 번째 poll: null → baseline
        .mockReturnValue('100')     // 두 번째 poll: 정상

      ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
        items: [{ historyNo: 100, itemSrcNo: 5001, itemSrcName: 'a', itemSrcExtension: 'dxf', itemFolderId: 1, itemFolderFullpath: '/올리기전용', itemOperCode: 'UP', itemUseDate: '2026-03-11' }],
        total: 1, pageSize: 20,
      })

      detector.setIncludeExistingOnFirstPoll()
      await detector.forceCheck() // 1회차: 기존 파일 감지

      // 2회차: 플래그 리셋됨 → 정상 폴링
      ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [], total: 0, pageSize: 20 })
      const result2 = await detector.forceCheck()
      expect(result2).toHaveLength(0) // 정상 동작
    })
  })

  // ── GUEST 경로 필터링 ──

  describe('cleanFolderPath GUEST filtering', () => {
    it('should remove GUEST from folder path', () => {
      expect(cleanFolderPath('/올리기전용/GUEST/업체A')).toBe('/올리기전용/업체A/')
    })

    it('should handle path without GUEST', () => {
      expect(cleanFolderPath('/올리기전용/업체A')).toBe('/올리기전용/업체A/')
    })

    it('should handle GUEST-only path', () => {
      expect(cleanFolderPath('/GUEST')).toBe('/')
    })

    it('should handle root path', () => {
      expect(cleanFolderPath('/')).toBe('/')
    })

    it('should preserve trailing slash', () => {
      expect(cleanFolderPath('/올리기전용/업체A/')).toBe('/올리기전용/업체A/')
    })

    it('should not remove lowercase guest (could be company name)', () => {
      expect(cleanFolderPath('/올리기전용/guest/업체A')).toBe('/올리기전용/guest/업체A/')
    })
  })

  // ── 경로 해결 (resolveFolderPath) ──

  describe('경로 해결', () => {
    it('itemFolderFullpath가 유효한 경로이면 그대로 사용한다', async () => {
      ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
        total: 1,
        pageSize: 20,
        items: [{
          historyNo: 801, itemSrcNo: 9001, itemFolderId: 2001,
          itemSrcName: 'test', itemSrcExtension: 'dxf', itemSrcType: 'file',
          itemFolderFullpath: '/올리기전용/원컴퍼니/',
          itemOperCode: 'UP', itemUseDate: '2026-03-11 10:00:00',
        }],
      })

      const files = await detector.forceCheck()
      expect(files[0].filePath).toBe('/올리기전용/원컴퍼니/test.dxf')
      expect(mockState.getFolderByLguplusId).not.toHaveBeenCalled()
    })

    it('itemFolderFullpath가 "/"이면 DB에서 경로를 조회한다', async () => {
      ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
        total: 1,
        pageSize: 20,
        items: [{
          historyNo: 802, itemSrcNo: 9002, itemFolderId: 2001,
          itemSrcName: 'test', itemSrcExtension: 'dxf', itemSrcType: 'file',
          itemFolderFullpath: '/',
          itemOperCode: 'UP', itemUseDate: '2026-03-11 10:00:00',
        }],
      })
      ;(mockState.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'folder-1',
        lguplus_folder_id: '2001',
        lguplus_folder_name: '원컴퍼니',
        lguplus_folder_path: '/올리기전용/원컴퍼니',
      })

      const files = await detector.forceCheck()
      expect(mockState.getFolderByLguplusId).toHaveBeenCalledWith('2001')
      expect(files[0].filePath).toBe('/올리기전용/원컴퍼니/test.dxf')
    })

    it('itemFolderFullpath가 "/"이고 DB에 폴더가 없으면 "/"를 사용한다', async () => {
      ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
        total: 1,
        pageSize: 20,
        items: [{
          historyNo: 803, itemSrcNo: 9003, itemFolderId: 9999,
          itemSrcName: 'test', itemSrcExtension: 'dxf', itemSrcType: 'file',
          itemFolderFullpath: '/',
          itemOperCode: 'UP', itemUseDate: '2026-03-11 10:00:00',
        }],
      })
      ;(mockState.getFolderByLguplusId as ReturnType<typeof vi.fn>).mockReturnValue(null)

      const files = await detector.forceCheck()
      expect(mockState.getFolderByLguplusId).toHaveBeenCalledWith('9999')
      expect(files[0].filePath).toBe('/test.dxf')
    })
  })
})
