import { create } from 'zustand'
import type { AppSettings, ConnectionTestResult } from '../../shared/ipc-types'

interface SettingsState {
  settings: AppSettings | null
  isDirty: boolean
  isLoading: boolean
  isSaving: boolean
  activeTab: string
  connectionTestResults: {
    lguplus: ConnectionTestResult | null
    webhard: ConnectionTestResult | null
  }
}

interface SettingsActions {
  fetchSettings: () => Promise<void>
  updateSettings: (partial: Partial<AppSettings>) => void
  saveSettings: () => Promise<boolean>
  testConnection: (target: 'lguplus' | 'webhard') => Promise<ConnectionTestResult | null>
  setActiveTab: (tab: string) => void
  resetDirty: () => void
}

export type SettingsStore = SettingsState & SettingsActions

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,
  isDirty: false,
  isLoading: false,
  isSaving: false,
  activeTab: 'account',
  connectionTestResults: { lguplus: null, webhard: null },

  fetchSettings: async () => {
    set({ isLoading: true })
    try {
      const res = await window.electronAPI.invoke('settings:get')
      if (res.success && res.data) {
        set({ settings: res.data, isDirty: false })
      }
    } finally {
      set({ isLoading: false })
    }
  },

  updateSettings: (partial) => {
    const current = get().settings
    if (!current) return
    const merged: AppSettings = {
      lguplus: { ...current.lguplus, ...(partial.lguplus ?? {}) },
      webhard: { ...current.webhard, ...(partial.webhard ?? {}) },
      sync: { ...current.sync, ...(partial.sync ?? {}) },
      notification: partial.notification
        ? {
            ...current.notification,
            ...partial.notification,
            sound: { ...current.notification.sound, ...(partial.notification.sound ?? {}) },
            toast: { ...current.notification.toast, ...(partial.notification.toast ?? {}) },
            inApp: { ...current.notification.inApp, ...(partial.notification.inApp ?? {}) },
            rules: { ...current.notification.rules, ...(partial.notification.rules ?? {}) },
          }
        : current.notification,
      system: { ...current.system, ...(partial.system ?? {}) },
    }
    set({ settings: merged, isDirty: true })
  },

  saveSettings: async () => {
    const { settings } = get()
    if (!settings) return false
    set({ isSaving: true })
    try {
      const res = await window.electronAPI.invoke('settings:update', settings)
      if (res.success && res.data) {
        set({ settings: res.data, isDirty: false })
        return true
      }
      return false
    } finally {
      set({ isSaving: false })
    }
  },

  testConnection: async (target) => {
    const { settings } = get()
    if (!settings) return null
    const req =
      target === 'lguplus'
        ? {
            target: 'lguplus' as const,
            username: settings.lguplus.username,
            password: settings.lguplus.password,
          }
        : {
            target: 'webhard' as const,
            apiUrl: settings.webhard.apiUrl,
            apiKey: settings.webhard.apiKey,
          }
    const res = await window.electronAPI.invoke('settings:test-connection', req)
    if (res.success && res.data) {
      set((s) => ({
        connectionTestResults: { ...s.connectionTestResults, [target]: res.data },
      }))
      return res.data!
    }
    return null
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
  resetDirty: () => set({ isDirty: false }),
}))
