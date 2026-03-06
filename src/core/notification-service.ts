import { v4 as uuid } from 'uuid'
import type {
  INotificationService,
  NotificationParams,
  AppNotification,
  NotificationFilter,
} from './types/notification.types'
import type { IEventBus } from './types/events.types'
import type { ILogger } from './types/logger.types'

export class NotificationService implements INotificationService {
  private notifications: AppNotification[] = []
  private eventBus: IEventBus
  private logger: ILogger

  constructor(eventBus: IEventBus, logger: ILogger) {
    this.eventBus = eventBus
    this.logger = logger.child({ module: 'notification-service' })
  }

  notify(params: NotificationParams): string {
    // Check for existing group
    if (params.groupKey) {
      const existing = this.notifications.find(
        (n) => n.groupKey === params.groupKey,
      )
      if (existing) {
        existing.groupCount++
        existing.message = params.message
        existing.read = false
        existing.createdAt = new Date().toISOString()
        return existing.id
      }
    }

    const notification: AppNotification = {
      id: uuid(),
      type: params.type,
      title: params.title,
      message: params.message,
      groupKey: params.groupKey,
      groupCount: 1,
      read: false,
      createdAt: new Date().toISOString(),
    }

    this.notifications.unshift(notification)
    return notification.id
  }

  getNotifications(filter?: NotificationFilter): AppNotification[] {
    let result = [...this.notifications]

    if (filter?.type) {
      result = result.filter((n) => n.type === filter.type)
    }

    if (filter?.read !== undefined) {
      result = result.filter((n) => n.read === filter.read)
    }

    if (filter?.limit) {
      result = result.slice(0, filter.limit)
    }

    return result
  }

  getUnreadCount(): number {
    return this.notifications.filter((n) => !n.read).length
  }

  markRead(id: string): void {
    const notification = this.notifications.find((n) => n.id === id)
    if (notification) {
      notification.read = true
    }
  }

  markAllRead(): void {
    for (const n of this.notifications) {
      n.read = true
    }
  }

  clearOld(beforeDays: number): void {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - beforeDays)
    const cutoffStr = cutoff.toISOString()

    this.notifications = this.notifications.filter(
      (n) => n.createdAt > cutoffStr,
    )
  }
}
