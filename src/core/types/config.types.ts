// src/core/types/config.types.ts — [SPEC] Configuration manager contract
// SDD Level 2: IConfigManager interface

export interface AppConfig {
  lguplus: {
    username: string
    password: string
  }
  webhard: {
    apiUrl: string
    apiKey: string
  }
  sync: {
    pollingIntervalSec: number
    maxConcurrentDownloads: number
    maxConcurrentUploads: number
    snapshotIntervalMin: number
  }
  notification: {
    inApp: boolean
    toast: boolean
  }
  system: {
    autoStart: boolean
    startMinimized: boolean
    tempDownloadPath: string
    logRetentionDays: number
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
