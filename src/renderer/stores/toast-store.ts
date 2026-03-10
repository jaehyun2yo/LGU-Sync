import { create } from 'zustand'
import type { NotificationType } from '../../shared/ipc-types'

export type ToastPhase = 'entering' | 'visible' | 'exiting'

export interface Toast {
  id: string
  type: NotificationType
  title: string
  message: string
  phase: ToastPhase
  createdAt: number
  durationMs: number
}

interface ToastState {
  toasts: Toast[]
}

interface ToastActions {
  addToast: (toast: Omit<Toast, 'id' | 'phase' | 'createdAt'>) => void
  dismissToast: (id: string) => void
  removeToast: (id: string) => void
}

export type ToastStore = ToastState & ToastActions

let toastCounter = 0

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  addToast: (input) => {
    const id = `toast-${++toastCounter}-${Date.now()}`
    const toast: Toast = {
      ...input,
      id,
      phase: 'entering',
      createdAt: Date.now(),
    }

    set((s) => ({ toasts: [...s.toasts, toast] }))

    // entering → visible after animation
    setTimeout(() => {
      set((s) => ({
        toasts: s.toasts.map((t) => (t.id === id ? { ...t, phase: 'visible' as const } : t)),
      }))
    }, 50)

    // auto-dismiss after duration
    setTimeout(() => {
      get().dismissToast(id)
    }, input.durationMs)

    // evict oldest if exceeding max (read from current toasts)
    const maxVisible = 5
    const { toasts } = get()
    if (toasts.length > maxVisible) {
      const oldest = toasts.find((t) => t.phase !== 'exiting')
      if (oldest) get().dismissToast(oldest.id)
    }
  },

  dismissToast: (id) => {
    set((s) => ({
      toasts: s.toasts.map((t) => (t.id === id ? { ...t, phase: 'exiting' as const } : t)),
    }))
    // remove after exit animation
    setTimeout(() => {
      get().removeToast(id)
    }, 300)
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))
