/**
 * pipeline-integration.test.ts
 *
 * FileDetector → SyncEngine → LGUplusClient 전체 파이프라인 통합 테스트.
 * 실제 서비스 대신 mock을 사용하되, 실제 EventBus를 통해 컴포넌트 간 통신을 검증.
 *
 * 검증 포인트:
 * 1. 파이프라인 전체 흐름 (감지 → 다운로드 → 업로드 → 완료)
 * 2. scanFolder 병렬화
 * 3. RetryManager HALF_OPEN 프로브 동작
 * 4. 에러 복구 시나리오 (다운로드 실패 → 재시도 → 성공)
 * 5. 동시성 제어 (maxConcurrent 초과 시 큐 대기)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncEngine } from '../../src/core/sync-engine'
import { RetryManager } from '../../src/core/retry-manager'
import { EventBus } from '../../src/core/event-bus'
import { Logger } from '../../src/core/logger'
import type { IFileDetector } from '../../src/core/types/file-detector.types'
import type { ILGUplusClient } from '../../src/core/types/lguplus-client.types'
import type { IWebhardUploader } from '../../src/core/types/webhard-uploader.types'
import type { IStateManager } from '../../src/core/types/state-manager.types'
import type { IConfigManager } from '../../src/core/types/config.types'
import type { INotificationService } from '../../src/core/types/notification.types'
import type { DetectedFile, DetectionStrategy, EventMap } from '../../src/core/types/events.types'
import {
  NetworkTimeoutError,
  FileDownloadTransferError,
} from '../../src/core/errors'

// Mock node:fs/promises to avoid real filesystem operations in tests
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}))

// ── Mock Factories ──

function createMockDetector(): IFileDetector & {
  _handlers: Array<(files: DetectedFile[], strategy: DetectionStrategy) => void>
  _emit: (files: DetectedFile[], strategy?: DetectionStrategy) => void
} {
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
    _emit: (files, strategy = 'polling') => {
      for (const h of handlers) h(files, strategy)
    },
  } as any
}

function createMockLGUplus(): ILGUplusClient {
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

function createMockUploader(): IWebhardUploader {
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

function createMockState(): IStateManager {
  const files = new Map<string, any>()
  let fileCounter = 0
  return {
    getCheckpoint: vi.fn().mockReturnValue(null),
    saveCheckpoint: vi.fn(),
    saveFile: vi.fn().mockImplementation((file) => {
      const id = `file-${++fileCounter}`
      files.set(id, { ...file, id, status: 'detected', retry_count: 0 })
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
    getFolderByLguplusId: vi.fn().mockImplementation((lguplusId: string) => ({
      id: 'folder-uuid-1',
      lguplus_folder_id: lguplusId,
      lguplus_folder_name: 'test-folder',
      enabled: true,
    })),
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

function createMockConfig(overrides?: Record<string, any>): IConfigManager {
  return {
    get: vi.fn().mockImplementation((section: string) => {
      if (section === 'sync') return { pollingIntervalSec: 5, maxConcurrentDownloads: 2, maxConcurrentUploads: 2, snapshotIntervalMin: 10, ...overrides }
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

function createMockNotification(): INotificationService {
  return {
    notify: vi.fn(),
    requestPermission: vi.fn().mockResolvedValue(true),
    isSupported: vi.fn().mockReturnValue(true),
  }
}

function makeDetectedFile(overrides?: Partial<DetectedFile>): DetectedFile {
  return {
    fileName: 'drawing.dxf',
    filePath: '/test-folder/drawing.dxf',
    fileSize: 1024,
    historyNo: 101,
    folderId: '1001',
    operCode: 'UP',
    ...overrides,
  }
}

// ── Tests ──

describe('Pipeline Integration: FileDetector → SyncEngine → LGUplusClient', () => {
  let engine: SyncEngine
  let detector: ReturnType<typeof createMockDetector>
  let lguplus: ILGUplusClient
  let uploader: IWebhardUploader
  let state: IStateManager
  let eventBus: EventBus
  let logger: Logger

  beforeEach(() => {
    vi.useFakeTimers()
    eventBus = new EventBus()
    logger = new Logger({ minLevel: 'error' })
    detector = createMockDetector()
    lguplus = createMockLGUplus()
    uploader = createMockUploader()
    state = createMockState()
    const retry = createRetryPassthrough()
    const config = createMockConfig()
    const notification = createMockNotification()

    engine = new SyncEngine({
      detector,
      lguplus,
      uploader,
      state,
      retry,
      eventBus,
      logger,
      config,
      notification,
    })
  })

  afterEach(async () => {
    await engine.stop()
    vi.useRealTimers()
  })

  // ── 1. 전체 파이프라인 ──

  describe('전체 파이프라인 흐름', () => {
    it('감지 → 다운로드 → file:completed 이벤트까지 전체 흐름', async () => {
      const completedHandler = vi.fn()
      eventBus.on('file:completed', completedHandler)

      await engine.start()

      // FileDetector가 파일을 감지
      detector._emit([makeDetectedFile()])

      // Promise 해결을 위해 타이머 진행
      await vi.advanceTimersByTimeAsync(100)

      // 다운로드 호출 확인
      expect(lguplus.downloadFile).toHaveBeenCalled()

      // file:completed 이벤트 발행 확인 (upload 없이 download -> completed)
      expect(completedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'drawing.dxf',
        }),
      )
    })

    it('여러 파일 감지 시 모두 처리된다', async () => {
      await engine.start()

      const files = [
        makeDetectedFile({ fileName: 'a.dxf', historyNo: 101 }),
        makeDetectedFile({ fileName: 'b.dxf', historyNo: 102 }),
        makeDetectedFile({ fileName: 'c.dxf', historyNo: 103 }),
      ]

      detector._emit(files)
      await vi.advanceTimersByTimeAsync(200)

      // 3개 파일 모두 state에 저장됨
      expect(state.saveFile).toHaveBeenCalledTimes(3)
    })

    it('operCode=D 파일은 동기화하지 않고 로깅만 한다', async () => {
      await engine.start()

      detector._emit([makeDetectedFile({ operCode: 'D', fileName: 'deleted.dxf' })])
      await vi.advanceTimersByTimeAsync(100)

      // 삭제 이벤트는 saveFile 호출하지 않음
      expect(state.saveFile).not.toHaveBeenCalled()
      expect(lguplus.downloadFile).not.toHaveBeenCalled()
    })
  })

  // ── 2. 에러 복구 시나리오 ──

  describe('에러 복구 시나리오', () => {
    it('다운로드 실패 시 sync:failed 이벤트가 발행된다', async () => {
      const failHandler = vi.fn()
      eventBus.on('sync:failed', failHandler)

      ;(lguplus.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        size: 0,
        filename: '',
      })

      await engine.start()
      detector._emit([makeDetectedFile()])
      await vi.advanceTimersByTimeAsync(100)

      expect(failHandler).toHaveBeenCalled()
    })

    it('다운로드 성공 시 completed 상태로 업데이트된다', async () => {
      await engine.start()
      detector._emit([makeDetectedFile()])
      await vi.advanceTimersByTimeAsync(100)

      // syncFile은 download only + completed (upload 없음)
      expect(state.updateFileStatus).toHaveBeenCalledWith(
        expect.any(String),
        'completed',
        expect.objectContaining({ upload_completed_at: expect.any(String) }),
      )
    })

    it('다운로드 예외 발생 시 dl_failed 상태로 전이', async () => {
      // RetryManager가 실제로 예외를 전파하도록 설정
      ;(lguplus.downloadFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new FileDownloadTransferError('network timeout'),
      )

      await engine.start()
      detector._emit([makeDetectedFile()])
      await vi.advanceTimersByTimeAsync(100)

      // classifyDownloadError가 SyncAppError(DL_TRANSFER_FAILED)를 한글 분류 메시지로 변환
      expect(state.updateFileStatus).toHaveBeenCalledWith(
        expect.any(String),
        'dl_failed',
        expect.objectContaining({
          last_error: expect.stringContaining('전송 실패'),
        }),
      )
    })
  })

  // ── 3. engine:status 이벤트 ──

  describe('engine:status 이벤트', () => {
    it('start → syncing, stop → stopped 전이를 이벤트로 추적할 수 있다', async () => {
      const statusEvents: Array<{ prev: string; next: string }> = []
      eventBus.on('engine:status', (data) => statusEvents.push(data))

      await engine.start()
      await engine.stop()

      expect(statusEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ next: 'syncing' }),
          expect.objectContaining({ next: 'stopped' }),
        ]),
      )
    })

    it('pause → resume 전이를 이벤트로 추적할 수 있다', async () => {
      const statusEvents: Array<{ prev: string; next: string }> = []
      eventBus.on('engine:status', (data) => statusEvents.push(data))

      await engine.start()
      await engine.pause()
      await engine.resume()

      expect(statusEvents).toContainEqual(
        expect.objectContaining({ prev: 'syncing', next: 'paused' }),
      )
      expect(statusEvents).toContainEqual(
        expect.objectContaining({ prev: 'paused', next: 'syncing' }),
      )
    })
  })

  // ── 4. sync:progress 이벤트 ──

  describe('sync:progress 이벤트', () => {
    it('다운로드 시작 시 progress=0, phase=downloading 이벤트 발행', async () => {
      const progressEvents: EventMap['sync:progress'][] = []
      eventBus.on('sync:progress', (data) => progressEvents.push(data))

      await engine.start()
      detector._emit([makeDetectedFile()])
      await vi.advanceTimersByTimeAsync(100)

      const downloadProgress = progressEvents.filter((p) => p.phase === 'downloading')
      expect(downloadProgress.length).toBeGreaterThanOrEqual(1)
      expect(downloadProgress[0].progress).toBe(0)
    })
  })
})

describe('RetryManager HALF_OPEN 프로브 통합', () => {
  it('HALF_OPEN 상태에서 프로브 요청이 동시에 하나만 실행된다', async () => {
    const logger = new Logger({ minLevel: 'error' })
    const retry = new RetryManager(logger, {
      failureThreshold: 2,
      resetTimeoutMs: 50,
    })

    const fn = vi.fn().mockRejectedValue(new NetworkTimeoutError('fail'))

    // 서킷을 OPEN으로 만들기
    for (let i = 0; i < 2; i++) {
      try {
        await retry.execute(fn, { maxRetries: 0, baseDelayMs: 1, circuitName: 'probe-test' })
      } catch {
        // expected
      }
    }
    expect(retry.getCircuitState('probe-test')).toBe('OPEN')

    // resetTimeout 대기
    await new Promise((r) => setTimeout(r, 60))
    expect(retry.getCircuitState('probe-test')).toBe('HALF_OPEN')

    // 첫 번째 프로브는 진행됨
    const probe1 = retry.execute(fn, { maxRetries: 0, baseDelayMs: 1, circuitName: 'probe-test' })
      .catch(() => 'failed')

    // 두 번째 프로브는 즉시 거부됨 (probeInFlight)
    const probe2Promise = retry.execute(fn, { maxRetries: 0, baseDelayMs: 1, circuitName: 'probe-test' })
    await expect(probe2Promise).rejects.toThrow('probe in progress')

    await probe1
  })

  it('HALF_OPEN 프로브 성공 시 CLOSED로 전환되고 이후 요청 정상 처리', async () => {
    const logger = new Logger({ minLevel: 'error' })
    const retry = new RetryManager(logger, {
      failureThreshold: 2,
      resetTimeoutMs: 50,
    })

    const fn = vi.fn().mockRejectedValue(new NetworkTimeoutError('fail'))

    // 서킷 열기
    for (let i = 0; i < 2; i++) {
      try {
        await retry.execute(fn, { maxRetries: 0, baseDelayMs: 1, circuitName: 'recover' })
      } catch { /* expected */ }
    }

    // HALF_OPEN 대기
    await new Promise((r) => setTimeout(r, 60))

    // 프로브 성공
    fn.mockResolvedValue('recovered')
    const result = await retry.execute(fn, { maxRetries: 0, baseDelayMs: 1, circuitName: 'recover' })
    expect(result).toBe('recovered')
    expect(retry.getCircuitState('recover')).toBe('CLOSED')

    // 이후 요청도 정상
    fn.mockResolvedValue('normal')
    const result2 = await retry.execute(fn, { maxRetries: 0, baseDelayMs: 1, circuitName: 'recover' })
    expect(result2).toBe('normal')
  })
})

describe('fullSync 병렬 폴더 스캔', () => {
  it('여러 폴더를 병렬로 스캔하고 결과를 합산한다', async () => {
    const eventBus = new EventBus()
    const logger = new Logger({ minLevel: 'error' })
    const detector = createMockDetector()
    const lguplus = createMockLGUplus()
    const uploader = createMockUploader()
    const state = createMockState()
    const retry = createRetryPassthrough()
    const config = createMockConfig()
    const notification = createMockNotification()

    // 3개 폴더 등록
    ;(state.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: 'folder-a', enabled: true },
      { id: 'f2', lguplus_folder_id: '1002', lguplus_folder_name: 'folder-b', enabled: true },
      { id: 'f3', lguplus_folder_id: '1003', lguplus_folder_name: 'folder-c', enabled: true },
    ])

    // 각 폴더에 파일 2개씩
    ;(lguplus.getAllFilesDeep as ReturnType<typeof vi.fn>).mockImplementation((folderId: number) => {
      return Promise.resolve([
        { itemId: folderId * 10 + 1, itemName: `file-${folderId}-1.dxf`, itemSize: 1024, itemExtension: 'dxf', isFolder: false },
        { itemId: folderId * 10 + 2, itemName: `file-${folderId}-2.dxf`, itemSize: 2048, itemExtension: 'dxf', isFolder: false },
      ])
    })

    const engine = new SyncEngine({
      detector, lguplus, uploader, state, retry, eventBus, logger, config, notification,
    })

    const result = await engine.fullSync()

    // 3개 폴더 * 2개 파일 = 6개 스캔
    expect(result.scannedFiles).toBe(6)
    // 모두 새 파일 (getFileByHistoryNo가 null 반환)
    expect(result.newFiles).toBe(6)
    // 모든 파일 동기화 성공
    expect(result.syncedFiles).toBe(6)
    expect(result.failedFiles).toBe(0)

    await engine.stop()
  })

  it('일부 폴더 스캔 실패 시 다른 폴더는 정상 처리된다', async () => {
    const eventBus = new EventBus()
    const logger = new Logger({ minLevel: 'error' })
    const detector = createMockDetector()
    const lguplus = createMockLGUplus()
    const uploader = createMockUploader()
    const state = createMockState()
    const retry = createRetryPassthrough()
    const config = createMockConfig()
    const notification = createMockNotification()

    ;(state.getFolders as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 'f1', lguplus_folder_id: '1001', lguplus_folder_name: 'good-folder', enabled: true },
      { id: 'f2', lguplus_folder_id: '1002', lguplus_folder_name: 'bad-folder', enabled: true },
    ])

    ;(lguplus.getAllFilesDeep as ReturnType<typeof vi.fn>).mockImplementation((folderId: number) => {
      if (folderId === 1002) return Promise.reject(new Error('network error'))
      return Promise.resolve([
        { itemId: 1, itemName: 'file.dxf', itemSize: 1024, itemExtension: 'dxf', isFolder: false },
      ])
    })

    const engine = new SyncEngine({
      detector, lguplus, uploader, state, retry, eventBus, logger, config, notification,
    })

    const result = await engine.fullSync()

    // good-folder에서 1개 성공, bad-folder는 실패
    expect(result.scannedFiles).toBe(1)
    expect(result.syncedFiles).toBe(1)
    expect(result.failedFiles).toBe(1) // bad-folder 스캔 자체 실패

    await engine.stop()
  })
})

describe('동시성 제어 통합', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('maxConcurrent=2일 때 3번째 파일은 큐에 대기한다', async () => {
    const eventBus = new EventBus()
    const logger = new Logger({ minLevel: 'error' })
    const detector = createMockDetector()
    const lguplus = createMockLGUplus()
    const uploader = createMockUploader()
    const state = createMockState()
    const retry = createRetryPassthrough()
    const config = createMockConfig({ maxConcurrentDownloads: 2 })
    const notification = createMockNotification()

    // 다운로드가 완료되기까지 시간이 걸리도록 설정
    let resolvers: Array<(value: any) => void> = []
    ;(lguplus.downloadFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      return new Promise((resolve) => {
        resolvers.push(resolve)
      })
    })

    const engine = new SyncEngine({
      detector, lguplus, uploader, state, retry, eventBus, logger, config, notification,
    })

    await engine.start()

    // 3개 파일 동시 감지
    detector._emit([
      makeDetectedFile({ fileName: 'a.dxf', historyNo: 1 }),
      makeDetectedFile({ fileName: 'b.dxf', historyNo: 2 }),
      makeDetectedFile({ fileName: 'c.dxf', historyNo: 3 }),
    ])

    await vi.advanceTimersByTimeAsync(10)

    // maxConcurrent=2이므로 downloadFile은 2번만 호출됨
    expect(resolvers.length).toBe(2)

    // 첫 번째 다운로드 완료
    resolvers[0]({ success: true, size: 1024, filename: 'a.dxf' })
    await vi.advanceTimersByTimeAsync(10)

    // 큐에서 3번째 파일이 시작되어 총 3번 호출
    expect(resolvers.length).toBe(3)

    // 나머지 완료
    resolvers[1]({ success: true, size: 1024, filename: 'b.dxf' })
    resolvers[2]({ success: true, size: 1024, filename: 'c.dxf' })
    await vi.advanceTimersByTimeAsync(100)

    await engine.stop()
  })
})

describe('Graceful Shutdown 통합', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('stop() 호출 시 진행 중인 동기화가 완료될 때까지 대기한다', async () => {
    const eventBus = new EventBus()
    const logger = new Logger({ minLevel: 'error' })
    const detector = createMockDetector()
    const lguplus = createMockLGUplus()
    const uploader = createMockUploader()
    const state = createMockState()
    const retry = createRetryPassthrough()
    const config = createMockConfig()
    const notification = createMockNotification()

    let downloadResolver: ((value: any) => void) | null = null
    ;(lguplus.downloadFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      return new Promise((resolve) => {
        downloadResolver = resolve
      })
    })

    const engine = new SyncEngine({
      detector, lguplus, uploader, state, retry, eventBus, logger, config, notification,
    })

    await engine.start()
    detector._emit([makeDetectedFile()])
    await vi.advanceTimersByTimeAsync(10)

    // 다운로드 진행 중에 stop 호출
    const stopPromise = engine.stop()

    // stop이 아직 완료되지 않음 (다운로드 대기중)
    expect(engine.status).toBe('stopping')

    // 다운로드 완료
    downloadResolver!({ success: true, size: 1024, filename: 'test.dxf' })
    await vi.advanceTimersByTimeAsync(100)

    await stopPromise
    expect(engine.status).toBe('stopped')
  })
})

// ── Helper: RetryManager passthrough (실행만 위임) ──

function createRetryPassthrough() {
  return {
    execute: vi.fn().mockImplementation((fn: () => Promise<any>) => fn()),
    getCircuitState: vi.fn().mockReturnValue('CLOSED' as const),
    resetCircuit: vi.fn(),
    getDlqItems: vi.fn().mockReturnValue([]),
    retryDlqItem: vi.fn(),
    retryAllDlq: vi.fn().mockResolvedValue({ total: 0, succeeded: 0, failed: 0 }),
  }
}
