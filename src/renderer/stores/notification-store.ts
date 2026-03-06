import { create } from 'zustand'
import type { NotificationItem } from '../../shared/ipc-types'

interface NotificationState {
  notifications: NotificationItem[]
  isOpen: boolean
  isLoading: boolean
}

interface NotificationActions {
  fetchNotifications: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  toggle: () => void
  close: () => void
  unreadCount: () => number
}

export type NotificationStore = NotificationState & NotificationActions

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  isOpen: false,
  isLoading: false,

  fetchNotifications: async () => {
    set({ isLoading: true })
    try {
      const res = await window.electronAPI.invoke('notification:getAll')
      if (res.success && res.data) {
        set({ notifications: res.data })
      }
    } finally {
      set({ isLoading: false })
    }
  },

  markRead: async (id) => {
    await window.electronAPI.invoke('notification:read', { id })
    set((s) => ({
      notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    }))
  },

  markAllRead: async () => {
    await window.electronAPI.invoke('notification:readAll')
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
    }))
  },

  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  close: () => set({ isOpen: false }),
  unreadCount: () => get().notifications.filter((n) => !n.read).length,
}))
