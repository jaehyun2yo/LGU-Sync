import type { IEventBus } from './types/events.types'
import type { ILogger } from './types/logger.types'
import type { IConfigManager } from './types/config.types'
import type { IStateManager } from './types/state-manager.types'
import type { IRetryManager } from './types/retry-manager.types'
import type { ILGUplusClient } from './types/lguplus-client.types'
import type { IWebhardUploader } from './types/webhard-uploader.types'
import type { IFileDetector } from './types/file-detector.types'
import type { INotificationService } from './types/notification.types'
import type { ISyncEngine } from './types/sync-engine.types'

import { EventBus } from './event-bus'
import { Logger } from './logger'
import { ConfigManager } from './config-manager'
import { StateManager } from './state-manager'
import { RetryManager } from './retry-manager'
import { LGUplusClient } from './lguplus-client'
import { MockUploader } from './webhard-uploader/mock-uploader'
import { YjlaserUploader } from './webhard-uploader/yjlaser-uploader'
import { FileDetector } from './file-detector'
import { NotificationService } from './notification-service'
import { SyncEngine } from './sync-engine'
import { FolderDiscovery } from './folder-discovery'
import { FolderTreeCache } from './folder-tree-cache'

export interface CoreOptions {
  dbPath: string
  useMockUploader?: boolean
}

export interface CoreServices {
  eventBus: IEventBus
  logger: ILogger
  config: IConfigManager
  state: IStateManager
  retry: IRetryManager
  lguplus: ILGUplusClient
  uploader: IWebhardUploader
  detector: IFileDetector
  notification: INotificationService
  engine: ISyncEngine
  folderDiscovery: FolderDiscovery
  folderCache: FolderTreeCache
}

export function createCoreServices(options: CoreOptions): CoreServices {
  const eventBus = new EventBus()
  const logger = new Logger({
    onLog: (entry) => {
      // Persist logs to StateManager after initialization
      try {
        const category = entry.context?.module as string | undefined
        state.addLog({
          level: entry.level,
          message: entry.message,
          category: category ?? 'general',
          context: JSON.stringify(entry.context),
        })
      } catch {
        // StateManager may not be initialized yet
      }
    },
  })
  const config = new ConfigManager()

  const state = new StateManager(options.dbPath, logger)
  state.initialize()

  const retry = new RetryManager(logger)

  const lguplusConfig = config.get('lguplus')
  const webhardConfig = config.get('webhard')

  const folderCache = new FolderTreeCache({ scanResultTtlMs: 30 * 60 * 1000 })
  const lguplus = new LGUplusClient(
    'https://only.webhard.co.kr',
    logger,
    retry,
    folderCache,
  )

  const uploader: IWebhardUploader = options.useMockUploader
    ? new MockUploader()
    : new YjlaserUploader(webhardConfig.apiUrl, webhardConfig.apiKey, logger, retry)

  const syncConfig = config.get('sync')
  const detector = new FileDetector(lguplus, state, eventBus, logger, {
    pollingIntervalMs: syncConfig.pollingIntervalSec * 1000,
  })

  const notification = new NotificationService(eventBus, logger)

  const engine = new SyncEngine({
    detector,
    lguplus,
    uploader,
    state,
    retry,
    eventBus,
    logger,
    config,
    notification,
  })

  const folderDiscovery = new FolderDiscovery(lguplus, uploader, state, logger)

  // Inject DLQ dependencies for batch retry
  retry.setDlqDeps({
    getDlqItems: () => state.getDlqItems(),
    retrySyncFile: (fileId) => engine.syncFile(fileId),
    removeDlqItem: (id) => state.removeDlqItem(id),
  })

  return {
    eventBus,
    logger,
    config,
    state,
    retry,
    lguplus,
    uploader,
    detector,
    notification,
    engine,
    folderDiscovery,
    folderCache,
  }
}
