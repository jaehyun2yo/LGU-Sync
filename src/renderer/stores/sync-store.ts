import { create } from 'zustand'
import type {
  SyncStatus,
  SyncFileInfo,
  FullSyncResult,
  SyncProgressEvent,
  FileCompletedEvent,
  FileFailedEvent,
  StatusChangedEvent,
} from '../../shared/ipc-types'
import type { SyncStatusType } from '../../core/types/sync-status.types'

interface ActiveTransfer {
  fileId: string
  fileName: string
  phase: 'downloading' | 'uploading'
  progress: number
  speedBps: number
}

interface SyncState {
  status: SyncStatusType
  lguplusConnected: boolean
  lguplusSessionValid: boolean
  webhardConnected: boolean
  todayTotal: number
  todaySuccess: number
  todayFailed: number
  todayBytes: number
  activeTransfers: ActiveTransfer[]
  recentFiles: SyncFileInfo[]
  recentEvents: Array<{
    operCode: string
    fileName: string
    filePath: string
    folderId: string
    timestamp: string
  }>
  circuits: Record<string, 'CLOSED' | 'OPEN' | 'HALF_OPEN'>
  failedCount: number
  fullSyncProgress: {
    phase: string
    progress: number
    currentFile?: string
    speedBps: number
    estimatedRemainingMs: number
  } | null
  lastUpdatedAt: string | null
  isLoading: boolean
}

interface SyncActions {
  fetchStatus: () => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  startFullSync: (folderIds?: string[]) => Promise<FullSyncResult | null>
  resetCircuit: (circuitName: string) => Promise<void>
  retryFailed: (eventIds?: string[]) => Promise<void>
  handleProgress: (event: SyncProgressEvent) => void
  handleFileCompleted: (event: FileCompletedEvent) => void
  handleFileFailed: (event: FileFailedEvent) => void
  handleStatusChanged: (event: StatusChangedEvent) => void
  handleOperCodeEvent: (event: { operCode: string; fileName: string; filePath: string; folderId: string; timestamp: string }) => void
}

export type SyncStore = SyncState & SyncActions

export const useSyncStore = create<SyncStore>((set, get) => ({
  status: 'idle',
  lguplusConnected: false,
  lguplusSessionValid: false,
  webhardConnected: false,
  todayTotal: 0,
  todaySuccess: 0,
  todayFailed: 0,
  todayBytes: 0,
  activeTransfers: [],
  recentFiles: [],
  recentEvents: [],
  circuits: {},
  failedCount: 0,
  fullSyncProgress: null,
  lastUpdatedAt: null,
  isLoading: false,

  fetchStatus: async () => {
    set({ isLoading: true })
    try {
      const res = await window.electronAPI.invoke('sync:status')
      if (res.success && res.data) {
        const d = res.data
        set({
          status: d.state,
          lguplusConnected: d.lguplus.connected,
          lguplusSessionValid: d.lguplus.sessionValid,
          webhardConnected: d.webhard.connected,
          todayTotal: d.today.totalFiles,
          todaySuccess: d.today.successFiles,
          todayFailed: d.today.failedFiles,
          todayBytes: d.today.totalBytes,
          recentFiles: d.recentFiles,
          circuits: d.circuits ?? {},
          failedCount: d.failedCount,
          fullSyncProgress: d.currentOperation
            ? {
                phase: d.currentOperation.phase,
                progress: d.currentOperation.progress,
                currentFile: d.currentOperation.currentFile,
                speedBps: 0,
                estimatedRemainingMs: 0,
              }
            : null,
          lastUpdatedAt: d.lastUpdatedAt,
        })
      }
    } finally {
      set({ isLoading: false })
    }
  },

  start: async () => {
    const res = await window.electronAPI.invoke('sync:start')
    if (res.success && res.data) {
      set({ status: res.data.state })
    }
  },

  stop: async () => {
    await window.electronAPI.invoke('sync:stop')
    set({ status: 'idle', activeTransfers: [], fullSyncProgress: null })
  },

  pause: async () => {
    await window.electronAPI.invoke('sync:pause')
    set({ status: 'paused' })
  },

  resume: async () => {
    await window.electronAPI.invoke('sync:resume')
    set({ status: 'syncing' })
  },

  startFullSync: async (folderIds) => {
    const res = await window.electronAPI.invoke('sync:full-sync', {
      folderIds,
      forceRescan: false,
    })
    if (res.success && res.data) {
      set({ fullSyncProgress: null })
      await get().fetchStatus()
      return res.data
    }
    return null
  },

  resetCircuit: async (circuitName) => {
    await window.electronAPI.invoke('sync:reset-circuit', { circuitName })
    await get().fetchStatus()
  },

  retryFailed: async (eventIds) => {
    await window.electronAPI.invoke('sync:retry-failed', { eventIds })
    await get().fetchStatus()
  },

  handleProgress: (event) => {
    const transfers = [...get().activeTransfers]
    const fileId = event.fileId ?? event.currentFile ?? ''
    const fileName = event.currentFile ?? ''
    if (fileName) {
      const idx = transfers.findIndex((t) => t.fileId === fileId)
      const progress = event.totalBytes > 0
        ? (event.completedBytes / event.totalBytes) * 100
        : (event.totalFiles > 0 ? (event.completedFiles / event.totalFiles) * 100 : 0)
      const transfer: ActiveTransfer = {
        fileId,
        fileName,
        phase: event.phase === 'downloading' ? 'downloading' : 'uploading',
        progress,
        speedBps: event.speedBps,
      }
      if (idx >= 0) {
        transfers[idx] = transfer
      } else {
        transfers.push(transfer)
      }
    }
    set({
      activeTransfers: transfers.slice(0, 5),
      fullSyncProgress: {
        phase: event.phase,
        progress: event.totalBytes > 0
          ? (event.completedBytes / event.totalBytes) * 100
          : (event.totalFiles > 0 ? (event.completedFiles / event.totalFiles) * 100 : 0),
        currentFile: event.currentFile,
        speedBps: event.speedBps,
        estimatedRemainingMs: event.estimatedRemainingMs,
      },
    })
  },

  handleFileCompleted: (event) => {
    set((state) => ({
      activeTransfers: state.activeTransfers.filter((t) => t.fileId !== event.fileId),
      todaySuccess: state.todaySuccess + 1,
      todayTotal: state.todayTotal + 1,
      todayBytes: state.todayBytes + event.fileSize,
      recentFiles: [
        {
          id: event.fileId,
          fileName: event.fileName,
          folderPath: event.folderPath,
          fileSize: event.fileSize,
          status: 'completed',
          syncedAt: new Date().toISOString(),
        },
        ...state.recentFiles.slice(0, 19),
      ],
    }))
  },

  handleFileFailed: (event) => {
    set((state) => ({
      activeTransfers: state.activeTransfers.filter((t) => t.fileId !== event.fileId),
      todayFailed: state.todayFailed + 1,
      todayTotal: state.todayTotal + 1,
      failedCount: state.failedCount + 1,
    }))
  },

  handleStatusChanged: (event) => {
    set({ status: event.currentStatus })
  },

  handleOperCodeEvent: (event) => {
    set((state) => ({
      recentEvents: [event, ...state.recentEvents.slice(0, 49)],
    }))
  },
}))
