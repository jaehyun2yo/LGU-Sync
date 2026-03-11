import { create } from 'zustand'
import type {
  DetectionEventPush,
  DetectionStatusPush,
  DetectionStatusResponse,
  DetectionSessionInfo,
} from '../../shared/ipc-types'

// 감지 이벤트에 고유 ID 부여
export interface DetectionEvent extends DetectionEventPush {
  id: number
}

export type DetectionStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'recovering'

interface DetectionState {
  status: DetectionStatus
  events: DetectionEvent[]
  sessions: DetectionSessionInfo[]
  sessionsPagination: { page: number; totalPages: number; total: number }
  currentSessionId: string | null
  currentSessionStats: {
    filesDetected: number
    filesDownloaded: number
    filesFailed: number
    startedAt: string
  } | null
  lastPollAt: string | null
  lastDetectedAt: string | null
  autoStartEnabled: boolean
  isLoading: boolean
  startingStep: { message: string; current: number; total: number } | null
  watchFolderIds: string[]
}

interface DetectionActions {
  // IPC invoke 액션
  start: () => Promise<boolean>
  stop: () => Promise<void>
  fetchStatus: () => Promise<void>
  fetchSessions: (page?: number) => Promise<void>
  recover: () => Promise<void>

  // 로컬 상태 조작
  clearEvents: () => void

  // 알림 폴더 설정
  setWatchFolders: (ids: string[]) => Promise<void>
  fetchWatchFolders: () => Promise<void>

  // IPC 이벤트 핸들러
  handleDetectionEvent: (event: DetectionEventPush) => void
  handleStatusChanged: (event: DetectionStatusPush) => void
  handleStartProgress: (event: { step: string; message: string; current: number; total: number }) => void
}

export type DetectionStore = DetectionState & DetectionActions

const MAX_EVENTS = 500
let nextEventId = 1

export const useDetectionStore = create<DetectionStore>((set, get) => ({
  status: 'stopped',
  events: [],
  sessions: [],
  sessionsPagination: { page: 1, totalPages: 1, total: 0 },
  currentSessionId: null,
  currentSessionStats: null,
  lastPollAt: null,
  lastDetectedAt: null,
  autoStartEnabled: true,
  isLoading: false,
  startingStep: null,
  watchFolderIds: [],

  start: async () => {
    const { status } = get()
    if (status !== 'stopped') return false

    set({ status: 'starting', startingStep: null })

    const res = await window.electronAPI.invoke('detection:start', {
      source: 'manual',
    })

    if (res.success) {
      // 상태는 detection:status-changed 이벤트로 업데이트됨
      return true
    } else {
      set({ status: 'stopped' })
      return false
    }
  },

  stop: async () => {
    const { status } = get()
    if (status !== 'running') return

    set({ status: 'stopping' })
    await window.electronAPI.invoke('detection:stop')
    // 상태는 detection:status-changed 이벤트로 업데이트됨
  },

  fetchStatus: async () => {
    const res = await window.electronAPI.invoke('detection:status')
    if (res.success && res.data) {
      const d: DetectionStatusResponse = res.data
      set({
        status: d.status,
        currentSessionId: d.currentSessionId,
        currentSessionStats: d.currentSession
          ? {
              filesDetected: d.currentSession.filesDetected,
              filesDownloaded: d.currentSession.filesDownloaded,
              filesFailed: d.currentSession.filesFailed,
              startedAt: d.currentSession.startedAt,
            }
          : null,
        lastPollAt: d.lastPollAt,
        autoStartEnabled: d.autoStartEnabled,
      })
    }
  },

  fetchSessions: async (page = 1) => {
    set({ isLoading: true })
    try {
      const res = await window.electronAPI.invoke('detection:sessions', {
        page,
        pageSize: 20,
      })
      if (res.success && res.data) {
        set({
          sessions: res.data.items,
          sessionsPagination: {
            page: res.data.pagination.page,
            totalPages: res.data.pagination.totalPages,
            total: res.data.pagination.total,
          },
        })
      }
    } finally {
      set({ isLoading: false })
    }
  },

  recover: async () => {
    set({ status: 'recovering' })
    await window.electronAPI.invoke('detection:recover')
    // 결과는 detection:status-changed 및 detection:event로 수신
  },

  setWatchFolders: async (ids: string[]) => {
    const res = await window.electronAPI.invoke('detection:set-watch-folders', { folderIds: ids })
    if (res.success) {
      set({ watchFolderIds: ids })
    }
  },

  fetchWatchFolders: async () => {
    const res = await window.electronAPI.invoke('detection:get-watch-folders')
    if (res.success && res.data) {
      set({ watchFolderIds: res.data.folderIds })
    }
  },

  clearEvents: () => {
    set({ events: [] })
  },

  handleDetectionEvent: (event) => {
    const detectionEvent: DetectionEvent = {
      ...event,
      id: nextEventId++,
    }

    set((state) => {
      const events = [detectionEvent, ...state.events].slice(0, MAX_EVENTS)
      let { lastDetectedAt, currentSessionStats } = state

      if (event.type === 'detected') {
        lastDetectedAt = event.timestamp
      }

      // stats가 제공되면 세션 통계 업데이트 (currentSessionStats가 null이어도 초기화)
      if (event.stats) {
        currentSessionStats = {
          ...(currentSessionStats ?? { startedAt: new Date().toISOString() }),
          filesDetected: event.stats.filesDetected,
          filesDownloaded: event.stats.filesDownloaded,
          filesFailed: event.stats.filesFailed,
        }
      }

      return { events, lastDetectedAt, currentSessionStats }
    })
  },

  handleStatusChanged: (event) => {
    set((state) => {
      const updates: Partial<DetectionState> = {
        status: event.status,
        currentSessionId: event.sessionId,
      }

      // 시작 완료 시 startingStep 리셋 + stats 항상 초기화 (클린 스타트 보장)
      if (event.status === 'running') {
        updates.startingStep = null
        updates.currentSessionStats = {
          filesDetected: 0,
          filesDownloaded: 0,
          filesFailed: 0,
          startedAt: new Date().toISOString(),
        }
      }

      // 감지가 종료되면 세션 목록 새로고침
      if (event.status === 'stopped') {
        updates.currentSessionStats = null
        updates.startingStep = null
        // 비동기로 세션 목록 갱신
        get().fetchSessions()
      }

      return updates
    })
  },

  handleStartProgress: (event) => {
    set({ startingStep: { message: event.message, current: event.current, total: event.total } })
  },
}))
