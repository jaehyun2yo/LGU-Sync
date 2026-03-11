import { z } from 'zod'
import type { IConfigManager, AppConfig, NotificationConfig } from './types/config.types'

const DEFAULT_NOTIFICATION_RULES: NotificationConfig['rules'] = {
  'file-detected': { sound: true, inApp: true, toast: true },
  'file-completed': { sound: false, inApp: true, toast: false },
  'sync-failed': { sound: true, inApp: true, toast: true },
  'sync-completed': { sound: false, inApp: true, toast: false },
  'session-expired': { sound: true, inApp: true, toast: true },
}

export const DEFAULT_CONFIG: AppConfig = {
  lguplus: {
    username: 'aone8070',
    password: 'you22648070',
  },
  webhard: {
    apiUrl: 'https://www.yjlaser.net',
    apiKey: 'b9d3744492cb04d18636daa306754dd2e3cf98ddba84f8548111fde83ee44313',
    backendUrl: 'http://localhost:4000',
    backendApiKey: 'yjl_9b88722925a1c6f4e3216dc9305601608c54ece2207abdc3e84572075c3e174f',
  },
  sync: {
    pollingIntervalSec: 5,
    maxConcurrentDownloads: 5,
    maxConcurrentUploads: 3,
    snapshotIntervalMin: 10,
  },
  notification: {
    enabled: true,
    sound: { enabled: true, preset: 'default', volume: 70 },
    toast: { enabled: true, durationMs: 5000, maxVisible: 5 },
    inApp: { enabled: true },
    rules: DEFAULT_NOTIFICATION_RULES,
  },
  system: {
    autoStart: false,
    startMinimized: false,
    tempDownloadPath: './downloads',
    logRetentionDays: 30,
    autoDetection: true,
    watchFolderIds: [],
  },
}

const EventNotificationRuleSchema = z.object({
  sound: z.boolean(),
  inApp: z.boolean(),
  toast: z.boolean(),
})

const NotificationConfigSchema = z.object({
  enabled: z.boolean(),
  sound: z.object({
    enabled: z.boolean(),
    preset: z.enum(['default', 'chime', 'bell', 'pop', 'ding']),
    volume: z.number().int().min(0).max(100),
  }),
  toast: z.object({
    enabled: z.boolean(),
    durationMs: z.number().int().min(1000).max(30000),
    maxVisible: z.number().int().min(1).max(10),
  }),
  inApp: z.object({ enabled: z.boolean() }),
  rules: z.object({
    'file-detected': EventNotificationRuleSchema,
    'file-completed': EventNotificationRuleSchema,
    'sync-failed': EventNotificationRuleSchema,
    'sync-completed': EventNotificationRuleSchema,
    'session-expired': EventNotificationRuleSchema,
  }),
})

const AppConfigSchema = z.object({
  lguplus: z.object({
    username: z.string(),
    password: z.string(),
  }),
  webhard: z.object({
    apiUrl: z.string(),
    apiKey: z.string(),
    backendUrl: z.string(),
    backendApiKey: z.string(),
  }),
  sync: z.object({
    pollingIntervalSec: z.number().int().positive(),
    maxConcurrentDownloads: z.number().int().positive(),
    maxConcurrentUploads: z.number().int().positive(),
    snapshotIntervalMin: z.number().int().positive(),
  }),
  notification: NotificationConfigSchema,
  system: z.object({
    autoStart: z.boolean(),
    startMinimized: z.boolean(),
    tempDownloadPath: z.string().min(1),
    logRetentionDays: z.number().int().positive(),
    autoDetection: z.boolean(),
    watchFolderIds: z.array(z.string()),
  }),
})

type ChangeHandler<K extends keyof AppConfig> = (value: AppConfig[K]) => void

export class ConfigManager implements IConfigManager {
  private config: AppConfig
  private changeHandlers = new Map<keyof AppConfig, Set<ChangeHandler<any>>>()

  constructor(initialOverrides?: Partial<AppConfig>) {
    this.config = structuredClone(DEFAULT_CONFIG)
    if (initialOverrides) {
      for (const [key, value] of Object.entries(initialOverrides) as [
        keyof AppConfig,
        Partial<AppConfig[keyof AppConfig]>,
      ][]) {
        this.config[key] = { ...this.config[key], ...value } as any
      }
    }
  }

  get<K extends keyof AppConfig>(section: K): AppConfig[K] {
    return structuredClone(this.config[section])
  }

  set<K extends keyof AppConfig>(section: K, value: Partial<AppConfig[K]>): void {
    this.config[section] = { ...this.config[section], ...value } as AppConfig[K]
    this.notifyChange(section)
  }

  getAll(): AppConfig {
    return structuredClone(this.config)
  }

  validate(): boolean {
    const result = AppConfigSchema.safeParse(this.config)
    return result.success
  }

  reset(): void {
    this.config = structuredClone(DEFAULT_CONFIG)
  }

  onChanged<K extends keyof AppConfig>(
    section: K,
    handler: (value: AppConfig[K]) => void,
  ): () => void {
    if (!this.changeHandlers.has(section)) {
      this.changeHandlers.set(section, new Set())
    }
    this.changeHandlers.get(section)!.add(handler)
    return () => {
      this.changeHandlers.get(section)?.delete(handler)
    }
  }

  private notifyChange<K extends keyof AppConfig>(section: K): void {
    const handlers = this.changeHandlers.get(section)
    if (!handlers) return
    const value = this.get(section)
    for (const handler of handlers) {
      handler(value)
    }
  }
}
