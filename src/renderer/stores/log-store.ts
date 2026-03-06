import { create } from 'zustand'
import type { LogEntry, LogListRequest, Paginated } from '../../shared/ipc-types'
import type { LogLevel } from '../../core/types/logger.types'

interface LogFilters {
  levels: LogLevel[]
  search: string
  dateFrom: string
  dateTo: string
}

interface LogState {
  logs: LogEntry[]
  filters: LogFilters
  page: number
  pageSize: number
  total: number
  totalPages: number
  isLoading: boolean
  isRealtime: boolean
}

interface LogActions {
  fetchLogs: () => Promise<void>
  setFilter: (partial: Partial<LogFilters>) => void
  setPage: (page: number) => void
  toggleRealtime: () => void
  appendLog: (entry: LogEntry) => void
  exportLogs: (format: 'csv' | 'json') => Promise<string | null>
}

export type LogStore = LogState & LogActions

const today = () => new Date().toISOString().slice(0, 10)

export const useLogStore = create<LogStore>((set, get) => ({
  logs: [],
  filters: {
    levels: [],
    search: '',
    dateFrom: today(),
    dateTo: today(),
  },
  page: 1,
  pageSize: 100,
  total: 0,
  totalPages: 0,
  isLoading: false,
  isRealtime: true,

  fetchLogs: async () => {
    set({ isLoading: true })
    try {
      const { filters, page, pageSize } = get()
      const req: LogListRequest = {
        level: filters.levels.length > 0 ? filters.levels : undefined,
        search: filters.search || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        page,
        pageSize,
      }
      const res = await window.electronAPI.invoke('logs:list', req)
      if (res.success && res.data) {
        const data = res.data as Paginated<LogEntry>
        set({
          logs: data.items,
          total: data.pagination.total,
          totalPages: data.pagination.totalPages,
        })
      }
    } finally {
      set({ isLoading: false })
    }
  },

  setFilter: (partial) => {
    set((s) => ({ filters: { ...s.filters, ...partial }, page: 1 }))
    get().fetchLogs()
  },

  setPage: (page) => {
    set({ page })
    get().fetchLogs()
  },

  toggleRealtime: () => set((s) => ({ isRealtime: !s.isRealtime })),

  appendLog: (entry) => {
    if (!get().isRealtime) return
    set((s) => ({ logs: [entry, ...s.logs].slice(0, 500) }))
  },

  exportLogs: async (format) => {
    const { filters } = get()
    const res = await window.electronAPI.invoke('logs:export', {
      format,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
    })
    if (res.success && res.data) {
      return res.data.filePath
    }
    return null
  },
}))
