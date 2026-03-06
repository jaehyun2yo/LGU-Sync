import { z } from 'zod'
import type { IConfigManager, AppConfig } from './types/config.types'

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
    inApp: true,
    toast: true,
  },
  system: {
    autoStart: false,
    startMinimized: false,
    tempDownloadPath: './downloads',
    logRetentionDays: 30,
  },
}

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
  notification: z.object({
    inApp: z.boolean(),
    toast: z.boolean(),
  }),
  system: z.object({
    autoStart: z.boolean(),
    startMinimized: z.boolean(),
    tempDownloadPath: z.string().min(1),
    logRetentionDays: z.number().int().positive(),
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
