import { create } from 'zustand'

export type PageId =
  | 'dashboard'
  | 'file-explorer'
  | 'folder-settings'
  | 'sync-log'
  | 'statistics'
  | 'migration'
  | 'test'
  | 'settings'

interface UiState {
  currentPage: PageId
  sidebarCollapsed: boolean
  theme: 'dark' | 'light'
  confirmDialog: {
    open: boolean
    title: string
    message: string
    onConfirm: (() => void) | null
  }
}

interface UiActions {
  setPage: (page: PageId) => void
  toggleSidebar: () => void
  setTheme: (theme: 'dark' | 'light') => void
  toggleTheme: () => void
  showConfirm: (title: string, message: string, onConfirm: () => void) => void
  hideConfirm: () => void
}

export type UiStore = UiState & UiActions

const getInitialTheme = (): 'dark' | 'light' => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('theme')
    const theme = stored === 'dark' || stored === 'light' ? stored : 'dark'
    document.documentElement.classList.toggle('dark', theme === 'dark')
    return theme
  }
  return 'dark'
}

export const useUiStore = create<UiStore>((set, get) => ({
  currentPage: 'dashboard',
  sidebarCollapsed: false,
  theme: getInitialTheme(),
  confirmDialog: { open: false, title: '', message: '', onConfirm: null },

  setPage: (page) => set({ currentPage: page }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setTheme: (theme) => {
    localStorage.setItem('theme', theme)
    document.documentElement.classList.toggle('dark', theme === 'dark')
    set({ theme })
  },

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    get().setTheme(next)
  },

  showConfirm: (title, message, onConfirm) =>
    set({ confirmDialog: { open: true, title, message, onConfirm } }),

  hideConfirm: () =>
    set({ confirmDialog: { open: false, title: '', message: '', onConfirm: null } }),
}))
