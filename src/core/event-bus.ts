import type { IEventBus, EventMap } from './types/events.types'

type Handler = (...args: unknown[]) => void

export class EventBus implements IEventBus {
  private listeners = new Map<keyof EventMap, Handler[]>()

  on<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event)!.push(handler as Handler)
  }

  off<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): void {
    const handlers = this.listeners.get(event)
    if (!handlers) return
    const idx = handlers.indexOf(handler as Handler)
    if (idx !== -1) {
      handlers.splice(idx, 1)
    }
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const handlers = this.listeners.get(event)
    if (!handlers) return
    for (const handler of [...handlers]) {
      try {
        handler(data)
      } catch (error) {
        console.error(`[EventBus] Handler error on "${String(event)}":`, error)
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear()
  }
}
