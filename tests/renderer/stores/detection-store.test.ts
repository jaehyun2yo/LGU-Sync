import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDetectionStore } from '../../../src/renderer/stores/detection-store'

// window.electronAPI mock
vi.stubGlobal('window', {
  electronAPI: {
    invoke: vi.fn().mockResolvedValue({ success: true, data: null }),
    on: vi.fn().mockReturnValue(() => {}),
    off: vi.fn(),
  },
})

describe('detection-store stats', () => {
  beforeEach(() => {
    // 스토어 초기화
    useDetectionStore.setState({
      status: 'stopped',
      currentSessionStats: null,
      currentSessionId: null,
      events: [],
      startingStep: null,
    })
  })

  it('should initialize currentSessionStats when status changes to running', () => {
    const store = useDetectionStore.getState()
    store.handleStatusChanged({ status: 'running', sessionId: 'sess-1' })

    const state = useDetectionStore.getState()
    expect(state.currentSessionStats).not.toBeNull()
    expect(state.currentSessionStats?.filesDetected).toBe(0)
    expect(state.currentSessionStats?.filesDownloaded).toBe(0)
    expect(state.currentSessionStats?.filesFailed).toBe(0)
    expect(state.currentSessionStats?.startedAt).toBeTruthy()
  })

  it('should clear currentSessionStats when status changes to stopped', () => {
    // 먼저 running 상태로 설정
    useDetectionStore.setState({
      status: 'running',
      currentSessionStats: {
        filesDetected: 5,
        filesDownloaded: 3,
        filesFailed: 2,
        startedAt: new Date().toISOString(),
      },
    })

    const store = useDetectionStore.getState()
    store.handleStatusChanged({ status: 'stopped', sessionId: null })

    const state = useDetectionStore.getState()
    expect(state.currentSessionStats).toBeNull()
  })

  it('should update stats from event even when currentSessionStats was null', () => {
    // currentSessionStats가 null인 상태에서 stats가 포함된 이벤트 수신
    const store = useDetectionStore.getState()
    store.handleDetectionEvent({
      type: 'detected',
      message: '업로드 감지됨',
      timestamp: new Date().toISOString(),
      fileName: 'test.dxf',
      stats: { filesDetected: 1, filesDownloaded: 0, filesFailed: 0 },
    })

    const state = useDetectionStore.getState()
    expect(state.currentSessionStats).not.toBeNull()
    expect(state.currentSessionStats?.filesDetected).toBe(1)
  })

  it('should update existing stats from event', () => {
    useDetectionStore.setState({
      currentSessionStats: {
        filesDetected: 3,
        filesDownloaded: 1,
        filesFailed: 0,
        startedAt: new Date().toISOString(),
      },
    })

    const store = useDetectionStore.getState()
    store.handleDetectionEvent({
      type: 'downloaded',
      message: '동기화 완료',
      timestamp: new Date().toISOString(),
      fileName: 'test.dxf',
      stats: { filesDetected: 3, filesDownloaded: 2, filesFailed: 0 },
    })

    const state = useDetectionStore.getState()
    expect(state.currentSessionStats?.filesDownloaded).toBe(2)
  })
})
