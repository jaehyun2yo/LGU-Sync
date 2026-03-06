import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotificationService } from '../../src/core/notification-service'
import { EventBus } from '../../src/core/event-bus'
import { Logger } from '../../src/core/logger'

describe('NotificationService', () => {
  let service: NotificationService
  let eventBus: EventBus

  beforeEach(() => {
    eventBus = new EventBus()
    const logger = new Logger({ minLevel: 'error' })
    service = new NotificationService(eventBus, logger)
  })

  // ── Basic CRUD ──

  it('notify()로 알림을 생성하고 ID를 반환한다', () => {
    const id = service.notify({ type: 'info', title: 'Test', message: 'Hello' })
    expect(id).toBeTruthy()
    expect(typeof id).toBe('string')
  })

  it('getNotifications()로 알림 목록을 조회한다', () => {
    service.notify({ type: 'info', title: 'A', message: 'msg A' })
    service.notify({ type: 'success', title: 'B', message: 'msg B' })

    const all = service.getNotifications()
    expect(all).toHaveLength(2)
  })

  it('getNotifications()은 최신 순으로 반환한다', () => {
    service.notify({ type: 'info', title: 'First', message: 'first' })
    service.notify({ type: 'info', title: 'Second', message: 'second' })

    const all = service.getNotifications()
    expect(all[0].title).toBe('Second')
    expect(all[1].title).toBe('First')
  })

  // ── Unread Count ──

  it('getUnreadCount()로 미읽음 수를 조회한다', () => {
    service.notify({ type: 'info', title: 'A', message: 'a' })
    service.notify({ type: 'info', title: 'B', message: 'b' })
    expect(service.getUnreadCount()).toBe(2)
  })

  // ── Read ──

  it('markRead()로 알림을 읽음 처리한다', () => {
    const id = service.notify({ type: 'info', title: 'A', message: 'a' })
    service.markRead(id)

    expect(service.getUnreadCount()).toBe(0)
    const all = service.getNotifications()
    expect(all[0].read).toBe(true)
  })

  it('markAllRead()로 모든 알림을 읽음 처리한다', () => {
    service.notify({ type: 'info', title: 'A', message: 'a' })
    service.notify({ type: 'info', title: 'B', message: 'b' })
    service.markAllRead()

    expect(service.getUnreadCount()).toBe(0)
  })

  // ── Filters ──

  it('type 필터로 특정 타입 알림만 조회', () => {
    service.notify({ type: 'info', title: 'A', message: 'a' })
    service.notify({ type: 'error', title: 'B', message: 'b' })
    service.notify({ type: 'info', title: 'C', message: 'c' })

    const errors = service.getNotifications({ type: 'error' })
    expect(errors).toHaveLength(1)
    expect(errors[0].title).toBe('B')
  })

  it('read 필터로 미읽음만 조회', () => {
    const id = service.notify({ type: 'info', title: 'A', message: 'a' })
    service.notify({ type: 'info', title: 'B', message: 'b' })
    service.markRead(id)

    const unread = service.getNotifications({ read: false })
    expect(unread).toHaveLength(1)
    expect(unread[0].title).toBe('B')
  })

  it('limit 필터로 개수 제한', () => {
    for (let i = 0; i < 10; i++) {
      service.notify({ type: 'info', title: `N${i}`, message: `m${i}` })
    }
    const limited = service.getNotifications({ limit: 3 })
    expect(limited).toHaveLength(3)
  })

  // ── Grouping ──

  it('같은 groupKey로 알림을 그룹핑한다', () => {
    service.notify({ type: 'info', title: 'Sync', message: 'file1', groupKey: 'sync-batch-1' })
    service.notify({ type: 'info', title: 'Sync', message: 'file2', groupKey: 'sync-batch-1' })
    service.notify({ type: 'info', title: 'Sync', message: 'file3', groupKey: 'sync-batch-1' })

    const all = service.getNotifications()
    // Should be grouped into one notification with count
    const grouped = all.filter((n) => n.groupKey === 'sync-batch-1')
    expect(grouped).toHaveLength(1)
    expect(grouped[0].groupCount).toBe(3)
  })

  // ── Clear Old ──

  it('clearOld()로 오래된 알림을 삭제한다', () => {
    // Create notifications with manipulated timestamps
    service.notify({ type: 'info', title: 'Old', message: 'old' })
    service.notify({ type: 'info', title: 'New', message: 'new' })

    // Clear notifications older than 0 days (all)
    service.clearOld(0)

    const all = service.getNotifications()
    expect(all).toHaveLength(0)
  })
})
