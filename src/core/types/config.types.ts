// src/core/types/config.types.ts — [SPEC] Configuration manager contract
// SDD Level 2: IConfigManager interface

// ── Notification config types ──

export type NotificationEventType =
  | 'file-detected'
  | 'file-completed'
  | 'sync-failed'
  | 'sync-completed'
  | 'session-expired'

export interface EventNotificationRule {
  sound: boolean
  inApp: boolean
  toast: boolean
}

export type SoundPresetId = 'default' | 'chime' | 'bell' | 'pop' | 'ding'

export interface NotificationConfig {
  enabled: boolean
  sound: { enabled: boolean; preset: SoundPresetId; volume: number }
  toast: { enabled: boolean; durationMs: number; maxVisible: number }
  inApp: { enabled: boolean }
  rules: Record<NotificationEventType, EventNotificationRule>
}

// ── App config ──

export interface AppConfig {
  lguplus: {
    username: string
    password: string
  }
  webhard: {
    apiUrl: string
    apiKey: string
    backendUrl: string
    backendApiKey: string
  }
  sync: {
    pollingIntervalSec: number
    maxConcurrentDownloads: number
    maxConcurrentUploads: number
    snapshotIntervalMin: number
  }
  notification: NotificationConfig
  system: {
    autoStart: boolean
    startMinimized: boolean
    tempDownloadPath: string
    logRetentionDays: number
    /** 앱 시작 시 자동으로 실시간 감지를 시작할지 여부 */
    autoDetection: boolean
    /** OS 알림을 받을 폴더 ID 목록 */
    watchFolderIds: string[]
  }
}

export interface IConfigManager {
  get<K extends keyof AppConfig>(section: K): AppConfig[K]
  set<K extends keyof AppConfig>(section: K, value: Partial<AppConfig[K]>): void
  getAll(): AppConfig
  validate(): boolean
  reset(): void
  onChanged<K extends keyof AppConfig>(
    section: K,
    handler: (value: AppConfig[K]) => void,
  ): () => void
}
