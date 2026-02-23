// src/core/types/notification.types.ts — [SPEC] Notification service contract
// SDD Level 2: INotificationService interface

export type NotificationType = 'info' | 'success' | 'warning' | 'error'

export interface NotificationParams {
  type: NotificationType
  title: string
  message: string
  groupKey?: string
}

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  message: string
  groupKey?: string
  groupCount: number
  read: boolean
  createdAt: string
}

export interface NotificationFilter {
  type?: NotificationType
  read?: boolean
  limit?: number
}

export interface INotificationService {
  notify(notification: NotificationParams): string
  getNotifications(filter?: NotificationFilter): AppNotification[]
  getUnreadCount(): number
  markRead(id: string): void
  markAllRead(): void
  clearOld(beforeDays: number): void
}
