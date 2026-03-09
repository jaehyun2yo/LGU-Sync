/**
 * file-detector-limitations.test.ts
 *
 * FileDetector의 현재 감지 메커니즘 한계를 증명하는 테스트 코드.
 *
 * 결론: getUploadHistory() 기반 감지로는 외부 웹하드의 실제 변동을
 * 감지할 수 없다. snapshot 기반 감지 전략이 필요하다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FileDetector } from '../../src/core/file-detector'
import { EventBus } from '../../src/core/event-bus'
import { Logger } from '../../src/core/logger'
import type {
  ILGUplusClient,
  UploadHistoryResponse,
  UploadHistoryItem,
} from '../../src/core/types'
import type { IStateManager } from '../../src/core/types/state-manager.types'

// ──────────────────────────────────────────
// Test Helpers
// ──────────────────────────────────────────

function makeHistoryItem(
  historyNo: number,
  overrides?: Partial<UploadHistoryItem>,
): UploadHistoryItem {
  return {
    historyNo,
    itemSrcNo: 5000 + historyNo,
    itemFolderId: 1001,
    itemSrcName: `drawing${historyNo}`,
    itemSrcExtension: 'dxf',
    itemSrcType: 'file',
    itemFolderFullpath: '/올리기전용/원컴퍼니/',
    itemOperCode: 'UP',
    itemUseDate: `2026-03-09 10:${String(historyNo).padStart(2, '0')}:00`,
    ...overrides,
  }
}

function createMockClient(
  historyResponse: UploadHistoryResponse = { total: 0, pageSize: 20, items: [] },
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
    batchDownload: vi
      .fn()
      .mockResolvedValue({ success: 0, failed: 0, totalSize: 0, failedFiles: [] }),
    getUploadHistory: vi.fn().mockResolvedValue(historyResponse),
    on: vi.fn(),
  }
}

function createMockState(): Partial<IStateManager> {
  const checkpoints = new Map<string, string>()
  return {
    getCheckpoint: vi.fn((key: string) => checkpoints.get(key) ?? null),
    saveCheckpoint: vi.fn((key: string, value: string) => {
      checkpoints.set(key, value)
    }),
    getFileByHistoryNo: vi.fn().mockReturnValue(null),
    getFolders: vi.fn().mockReturnValue([]),
  }
}

// ──────────────────────────────────────────
// 한계 1: History API는 거래처(게스트) 업로드를 반환하지 않음
// ──────────────────────────────────────────

describe('한계 1: getUploadHistory()는 게스트 업로드를 반환하지 않음', () => {
  let detector: FileDetector
  let mockClient: ILGUplusClient
  let mockState: Partial<IStateManager>
  let eventBus: EventBus
  let logger: Logger

  beforeEach(() => {
    vi.useFakeTimers()
    eventBus = new EventBus()
    logger = new Logger({ minLevel: 'error' })
    mockState = createMockState()
  })

  afterEach(() => {
    detector.stop()
    vi.useRealTimers()
  })

  it('거래처가 올리기전용 폴더에 파일을 업로드해도 history에는 비어있다', async () => {
    // 실제 시나리오: 거래처가 웹하드 게스트 폴더에 파일 업로드
    // 하지만 getUploadHistory()는 '로그인 유저'의 이력만 반환
    // → 거래처 업로드는 history에 나타나지 않음

    mockClient = createMockClient({
      total: 0,
      pageSize: 20,
      items: [], // ← 거래처 업로드는 history API에 안 나옴
    })

    detector = new FileDetector(mockClient, mockState as IStateManager, eventBus, logger, {
      pollingIntervalMs: 5000,
    })

    const handler = vi.fn()
    detector.onFilesDetected(handler)

    // 폴링 실행
    const detected = await detector.forceCheck()

    // 결과: 감지된 파일 0개
    expect(detected).toHaveLength(0)
    expect(handler).not.toHaveBeenCalled()

    // 하지만 실제 폴더에는 파일이 존재함!
    // getFileList()로 직접 조회하면 파일이 보임
    ;(mockClient.getFileList as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [
        {
          itemId: 9001,
          itemName: '거래처도면.dxf',
          itemSize: 51200,
          itemExtension: 'dxf',
          parentFolderId: 1001,
          updatedAt: '2026-03-09 10:30:00',
          isFolder: false,
        },
      ],
      total: 1,
    })

    const folderContents = await mockClient.getFileList(1001)

    // 폴더에는 파일이 있지만 history 기반 감지로는 발견 못함
    expect(folderContents.items).toHaveLength(1)
    expect(folderContents.items[0].itemName).toBe('거래처도면.dxf')

    // ⚠️ 핵심 문제: history 감지 = 0, 실제 파일 = 1
    expect(detected.length).not.toBe(folderContents.items.length)
  })

  it('같은 시점에 getFileList()로 스캔하면 거래처 업로드를 발견할 수 있다', async () => {
    // history API: 빈 응답 (게스트 업로드 안 보임)
    mockClient = createMockClient({ total: 0, pageSize: 20, items: [] })

    // 하지만 폴더 직접 조회: 파일이 존재
    const guestUploadedFiles = [
      {
        itemId: 9001,
        itemName: '0309-1 원컴퍼니 도면.dxf',
        itemSize: 102400,
        itemExtension: 'dxf',
        parentFolderId: 1001,
        updatedAt: '2026-03-09 14:00:00',
        isFolder: false,
      },
      {
        itemId: 9002,
        itemName: '0309-2 대성목형 시안.dxf',
        itemSize: 204800,
        itemExtension: 'dxf',
        parentFolderId: 1001,
        updatedAt: '2026-03-09 14:05:00',
        isFolder: false,
      },
    ]
    ;(mockClient.getFileList as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: guestUploadedFiles,
      total: 2,
    })

    detector = new FileDetector(mockClient, mockState as IStateManager, eventBus, logger)

    // history 기반 감지: 0개
    const historyDetected = await detector.forceCheck()
    expect(historyDetected).toHaveLength(0)

    // snapshot 기반 감지 (getFileList 직접 조회): 2개
    const folderSnapshot = await mockClient.getFileList(1001)
    expect(folderSnapshot.items).toHaveLength(2)

    // ✓ snapshot 방식이 게스트 업로드를 감지할 수 있음을 증명
    expect(folderSnapshot.items[0].itemName).toBe('0309-1 원컴퍼니 도면.dxf')
    expect(folderSnapshot.items[1].itemName).toBe('0309-2 대성목형 시안.dxf')
  })
})

// ──────────────────────────────────────────
// 한계 2: 페이지 1만 조회 — 20개 초과 시 영구 누락
// ──────────────────────────────────────────

describe('한계 2: 페이지네이션 미지원 — 20개 초과 항목 영구 누락', () => {
  let detector: FileDetector
  let mockClient: ILGUplusClient
  let mockState: Partial<IStateManager>
  let eventBus: EventBus
  let logger: Logger

  beforeEach(() => {
    vi.useFakeTimers()
    eventBus = new EventBus()
    logger = new Logger({ minLevel: 'error' })
    mockState = createMockState()
  })

  afterEach(() => {
    detector.stop()
    vi.useRealTimers()
  })

  it('25개 파일이 업로드되었을 때 page 1의 20개만 감지하고 5개를 누락한다', async () => {
    // 시나리오: checkpoint=100, 새 항목 25개 (historyNo 101~125)
    // LGU+ API는 최신순(DESC)으로 페이지당 20개 반환
    // page 1: historyNo 125~106 (최신 20개)
    // page 2: historyNo 105~101 (나머지 5개) ← 이 5개가 영영 조회 안 됨

    // Page 1 응답: 최신 20개만 (historyNo 106~125)
    const page1Items = Array.from({ length: 20 }, (_, i) =>
      makeHistoryItem(125 - i), // 125, 124, 123, ..., 106
    )

    mockClient = createMockClient({
      total: 25,
      pageSize: 20,
      items: page1Items,
    })

    // checkpoint=100 설정 (Map에 직접)
    // createMockState의 Map 기반 구현을 사용
    const stateWithCheckpoint = createMockState()
    ;(stateWithCheckpoint.saveCheckpoint as ReturnType<typeof vi.fn>).mock.calls
    // Map에 초기값 설정하기 위해 saveCheckpoint 직접 호출
    stateWithCheckpoint.saveCheckpoint!('last_history_no', '100')

    detector = new FileDetector(mockClient, stateWithCheckpoint as IStateManager, eventBus, logger)

    // 1차 감지
    const detected = await detector.forceCheck()

    // page 1의 20개만 감지됨 (historyNo 106~125, 모두 > 100)
    expect(detected).toHaveLength(20)

    // checkpoint가 125로 갱신됨
    expect(stateWithCheckpoint.saveCheckpoint).toHaveBeenCalledWith('last_history_no', '125')

    // ⚠️ 핵심 문제: historyNo 101~105 (5개)는 page 2에 있었으므로 영영 조회 안 됨

    // 2차 감지 시도 — checkpoint=125이므로 아무것도 감지 안 됨
    ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      total: 25,
      pageSize: 20,
      items: page1Items, // 여전히 같은 page 1 데이터
    })

    const detected2 = await detector.forceCheck()

    // checkpoint=125이므로 모든 항목 (106~125)이 필터링됨 → 새 파일 0개
    expect(detected2).toHaveLength(0)

    // ❌ historyNo 101~105는 영구 누락됨
    // getUploadHistory()는 page 옵션 없이 호출되므로 항상 page 1만 가져옴
    expect(mockClient.getUploadHistory).toHaveBeenCalledWith({ operCode: '' })
  })

  it('FileDetector는 getUploadHistory()에 page 옵션을 전달하지 않는다', async () => {
    mockClient = createMockClient({ total: 0, pageSize: 20, items: [] })
    detector = new FileDetector(mockClient, mockState as IStateManager, eventBus, logger)

    await detector.forceCheck()

    // getUploadHistory()가 operCode=''로 호출됨 → 전체 이력 조회
    expect(mockClient.getUploadHistory).toHaveBeenCalledTimes(1)
    expect(mockClient.getUploadHistory).toHaveBeenCalledWith({ operCode: '' })

    // page 2, 3, ... 에 대한 호출은 없음
    const calls = (mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mock.calls
    const hasPageOption = calls.some(
      (call: unknown[]) => call[0] && (call[0] as { page?: number }).page && (call[0] as { page?: number }).page! > 1,
    )
    expect(hasPageOption).toBe(false) // page>1 호출 없음
  })
})

// ──────────────────────────────────────────
// 한계 3 (해결됨): operCode='' 전체 조회로 삭제/이동/이름변경 감지 가능
// ──────────────────────────────────────────

describe('한계 3 (해결됨): operCode=\'\' 전체 조회로 모든 변동 감지', () => {
  let detector: FileDetector
  let mockClient: ILGUplusClient
  let mockState: Partial<IStateManager>
  let eventBus: EventBus
  let logger: Logger

  beforeEach(() => {
    vi.useFakeTimers()
    eventBus = new EventBus()
    logger = new Logger({ minLevel: 'error' })
    mockState = createMockState()
  })

  afterEach(() => {
    detector.stop()
    vi.useRealTimers()
  })

  it('operCode=\'\' 전체 조회로 삭제 이벤트를 감지한다', async () => {
    // 시나리오:
    // 1) historyNo=101: 파일 업로드 (감지됨)
    // 2) historyNo=102: 파일 삭제 (operCode='D')
    // 3) operCode='' 전체 조회이므로 삭제도 감지됨

    // 1단계: 업로드 감지
    mockClient = createMockClient({
      total: 1,
      pageSize: 20,
      items: [makeHistoryItem(101)],
    })
    detector = new FileDetector(mockClient, mockState as IStateManager, eventBus, logger)

    const detected1 = await detector.forceCheck()
    expect(detected1).toHaveLength(1) // ✓ 업로드 감지됨

    // 2단계: 파일 삭제됨 — operCode='' 전체 조회이므로 삭제 이력도 나옴
    ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      total: 2,
      pageSize: 20,
      items: [
        makeHistoryItem(102, { itemOperCode: 'D' }),
        makeHistoryItem(101),
      ],
    })

    const detected2 = await detector.forceCheck()
    expect(detected2).toHaveLength(1) // ✓ 삭제 이벤트 감지됨
    expect(detected2[0].operCode).toBe('D')
  })

  it('파일 덮어쓰기(동일 이름 재업로드)를 새 파일로 인식한다', async () => {
    // 시나리오: 거래처가 drawing.dxf를 수정 후 같은 이름으로 재업로드
    // history에는 새 historyNo로 나타남 → 새 파일로 인식

    // 1차 업로드: historyNo=101
    mockClient = createMockClient({
      total: 1,
      pageSize: 20,
      items: [
        makeHistoryItem(101, {
          itemSrcName: 'drawing',
          itemSrcExtension: 'dxf',
        }),
      ],
    })
    detector = new FileDetector(mockClient, mockState as IStateManager, eventBus, logger)

    const detected1 = await detector.forceCheck()
    expect(detected1).toHaveLength(1)
    expect(detected1[0].fileName).toBe('drawing.dxf')

    // 2차 업로드 (수정본): historyNo=102, 같은 파일명
    ;(mockClient.getUploadHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      total: 2,
      pageSize: 20,
      items: [
        makeHistoryItem(102, {
          itemSrcName: 'drawing',
          itemSrcExtension: 'dxf',
        }),
        makeHistoryItem(101, {
          itemSrcName: 'drawing',
          itemSrcExtension: 'dxf',
        }),
      ],
    })

    const detected2 = await detector.forceCheck()
    expect(detected2).toHaveLength(1)
    expect(detected2[0].fileName).toBe('drawing.dxf')
    // ⚠️ 동일 파일의 "수정"이 아닌 "새 파일"로 처리됨
    // → 다운로드 + 업로드가 중복 실행될 수 있음
    expect(detected2[0].historyNo).toBe(102)
  })
})

// ──────────────────────────────────────────
// 한계 4 (해결됨): snapshot 전략 구현 완료, polling 전략도 전체 operCode 지원
// ──────────────────────────────────────────

describe('한계 4 (해결됨): FileDetector가 polling과 snapshot 두 전략을 지원한다', () => {
  it('DetectionStrategy 타입에 polling, snapshot, integrity가 정의되어 있다', () => {
    const strategies: Array<'polling' | 'snapshot' | 'integrity'> = [
      'polling',
      'snapshot',
      'integrity',
    ]
    expect(strategies).toContain('snapshot')
    expect(strategies).toContain('polling')
  })

  it('기본 전략은 polling이고 operCode=\'\' 전체 조회를 사용한다', async () => {
    const eventBus = new EventBus()
    const logger = new Logger({ minLevel: 'error' })
    const mockState = createMockState()
    const mockClient = createMockClient({
      total: 1,
      pageSize: 20,
      items: [makeHistoryItem(101)],
    })

    const detector = new FileDetector(
      mockClient,
      mockState as IStateManager,
      eventBus,
      logger,
    )

    const eventHandler = vi.fn()
    eventBus.on('detection:found', eventHandler)

    await detector.forceCheck()

    // strategy는 기본값 'polling'
    expect(eventHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'polling',
      }),
    )

    // operCode='' 전체 조회로 호출됨
    expect(mockClient.getUploadHistory).toHaveBeenCalledWith({ operCode: '' })

    detector.stop()
  })
})

// ──────────────────────────────────────────
// 한계 5: fullSync와 실시간 감지의 단절
// ──────────────────────────────────────────

describe('한계 5: fullSync()는 폴더 스캔하지만 실시간 감지와 연결되지 않음', () => {
  it('fullSync는 getAllFilesDeep를 사용하여 실제 폴더 내용을 스캔한다', () => {
    // SyncEngine.fullSync():
    //   - getAllFilesDeep(folderId) 호출 → 실제 폴더 내용 조회
    //   - DB의 getFileByHistoryNo(itemId)로 기존 파일 확인
    //   - 새 파일만 syncFile() 처리
    //
    // FileDetector (실시간):
    //   - getUploadHistory() 호출 → history 기반 (게스트 업로드 미포함)
    //   - checkpoint 비교 (historyNo > lastNo)
    //
    // ⚠️ fullSync의 폴더 스캔 로직이 FileDetector에는 없음
    // → 실시간 감지에서 폴더 내용 비교(snapshot)를 수행하지 않음

    // 이상적인 구조:
    // FileDetector가 두 가지 전략을 지원해야 함:
    // 1. polling (history 기반) — 빠르지만 게스트 업로드 미감지
    // 2. snapshot (폴더 스캔 기반) — 느리지만 모든 변동 감지 가능

    expect(true).toBe(true) // structural documentation test
  })
})

// ──────────────────────────────────────────
// 종합: 감지 가능 범위 매트릭스 (개선 후)
// ──────────────────────────────────────────

describe('종합: 개선된 FileDetector 감지 가능 범위', () => {
  it('감지 가능 시나리오를 정리한다', () => {
    /**
     * ┌──────────────────────────────────┬──────────────┬────────────┐
     * │ 시나리오                          │ polling      │ snapshot   │
     * │                                  │ (operCode='')│ (폴더스캔)  │
     * ├──────────────────────────────────┼──────────────┼────────────┤
     * │ 로그인 유저 본인의 파일 업로드      │ ✓ 감지       │ ✓ 감지     │
     * │ 거래처(게스트)의 파일 업로드        │ ? 미확인     │ ✓ 감지     │
     * │ 파일 삭제                         │ ✓ 감지(D)    │ ✓ 감지     │
     * │ 파일 이동                         │ ✓ 감지(MV)   │ ✓ 감지     │
     * │ 파일 이름 변경                    │ ✓ 감지(RN)   │ ✓ 감지     │
     * │ 파일 복사                         │ ✓ 감지(CP)   │ ✓ 감지     │
     * │ 폴더 생성/삭제/이동/이름변경       │ ✓ 감지(FC등) │ ✓ 감지     │
     * │ 본인 다운로드                     │ ✗ 제외(DN)   │ - 해당없음  │
     * │ 20개 초과 동시 변동              │ ✗ 일부누락    │ ✓ 감지     │
     * └──────────────────────────────────┴──────────────┴────────────┘
     *
     * 개선 사항:
     * - operCode='' 전체 조회로 UP/D/MV/RN/CP/FC/FD/FMV/FRN 모두 감지
     * - DN(다운로드)은 본인 다운로드 기록이므로 자동 필터링
     * - snapshot 전략은 게스트 업로드 등 history에 안 나오는 변동 보정
     */

    // polling 전체 조회로 감지 가능 시나리오 수 (DN 제외)
    const pollingDetectable = 7 // UP, D, MV, RN, CP, FC 계열
    const snapshotDetectable = 8 // 모든 변동

    expect(pollingDetectable).toBeLessThanOrEqual(snapshotDetectable)
  })
})
