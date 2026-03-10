import { create } from 'zustand'
import type { NotificationItem, NotificationType } from '../../shared/ipc-types'

interface NotificationState {
  notifications: NotificationItem[]
  isOpen: boolean
  isLoading: boolean
}

interface NotificationActions {
  fetchNotifications: () => Promise<void>
  addNotification: (type: NotificationType, title: string, message: string) => void
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  toggle: () => void
  close: () => void
  unreadCount: () => number
}

export type NotificationStore = NotificationState & NotificationActions

let notifCounter = 0

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

  addNotification: (type, title, message) => {
    const item: NotificationItem = {
      id: `local-${++notifCounter}-${Date.now()}`,
      type,
      title,
      message,
      read: false,
      createdAt: new Date().toISOString(),
    }
    set((s) => ({ notifications: [item, ...s.notifications] }))
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
