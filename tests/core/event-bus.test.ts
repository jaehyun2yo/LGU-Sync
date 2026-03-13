import { describe, it, expect, vi } from 'vitest'
import { EventBus } from '../../src/core/event-bus'
import type { EventMap } from '../../src/core/types'

describe('EventBus', () => {
  it('on/emit: 이벤트를 구독하고 발행하면 핸들러가 호출된다', () => {
    const bus = new EventBus()
    const handler = vi.fn()

    bus.on('sync:started', handler)
    bus.emit('sync:started', { timestamp: Date.now() })

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ timestamp: expect.any(Number) }))
  })

  it('off: 구독 해제한 핸들러는 호출되지 않는다', () => {
    const bus = new EventBus()
    const handler = vi.fn()

    bus.on('sync:started', handler)
    bus.off('sync:started', handler)
    bus.emit('sync:started', { timestamp: Date.now() })

    expect(handler).not.toHaveBeenCalled()
  })

  it('removeAllListeners: 모든 핸들러가 해제된다', () => {
    const bus = new EventBus()
    const h1 = vi.fn()
    const h2 = vi.fn()

    bus.on('sync:started', h1)
    bus.on('sync:completed', h2)
    bus.removeAllListeners()

    bus.emit('sync:started', { timestamp: Date.now() })
    bus.emit('sync:completed', { totalFiles: 1, totalBytes: 100, durationMs: 500 })

    expect(h1).not.toHaveBeenCalled()
    expect(h2).not.toHaveBeenCalled()
  })

  it('같은 이벤트에 여러 핸들러를 등록할 수 있다', () => {
    const bus = new EventBus()
    const h1 = vi.fn()
    const h2 = vi.fn()
    const h3 = vi.fn()

    bus.on('engine:status', h1)
    bus.on('engine:status', h2)
    bus.on('engine:status', h3)

    bus.emit('engine:status', { prev: 'idle', next: 'syncing' })

    expect(h1).toHaveBeenCalledOnce()
    expect(h2).toHaveBeenCalledOnce()
    expect(h3).toHaveBeenCalledOnce()
  })

  it('등록되지 않은 이벤트를 emit해도 에러가 발생하지 않는다', () => {
    const bus = new EventBus()

    expect(() => {
      bus.emit('sync:started', { timestamp: Date.now() })
    }).not.toThrow()
  })

  it('off: 등록되지 않은 핸들러를 해제해도 에러가 발생하지 않는다', () => {
    const bus = new EventBus()
    const handler = vi.fn()

    expect(() => {
      bus.off('sync:started', handler)
    }).not.toThrow()
  })

  it('emit: 핸들러에 정확한 데이터가 전달된다', () => {
    const bus = new EventBus()
    const handler = vi.fn()

    bus.on('sync:completed', handler)
    bus.emit('sync:completed', { totalFiles: 10, totalBytes: 1024, durationMs: 3000 })

    expect(handler).toHaveBeenCalledWith({
      totalFiles: 10,
      totalBytes: 1024,
      durationMs: 3000,
    })
  })

  it('하나의 핸들러를 off해도 다른 핸들러에는 영향이 없다', () => {
    const bus = new EventBus()
    const h1 = vi.fn()
    const h2 = vi.fn()

    bus.on('sync:started', h1)
    bus.on('sync:started', h2)
    bus.off('sync:started', h1)

    bus.emit('sync:started', { timestamp: 1 })

    expect(h1).not.toHaveBeenCalled()
    expect(h2).toHaveBeenCalledOnce()
  })

  it('동일 핸들러를 중복 등록하면 각각 호출된다', () => {
    const bus = new EventBus()
    const handler = vi.fn()

    bus.on('sync:started', handler)
    bus.on('sync:started', handler)

    bus.emit('sync:started', { timestamp: 1 })

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('핸들러 에러 발생해도 나머지 핸들러 정상 실행', () => {
    const bus = new EventBus()
    const h1 = vi.fn()
    const h2 = vi.fn(() => { throw new Error('handler error') })
    const h3 = vi.fn()

    bus.on('sync:started', h1)
    bus.on('sync:started', h2)
    bus.on('sync:started', h3)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    bus.emit('sync:started', { timestamp: Date.now() })

    expect(h1).toHaveBeenCalledOnce()
    expect(h2).toHaveBeenCalledOnce()
    expect(h3).toHaveBeenCalledOnce()
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[EventBus] Handler error'),
      expect.any(Error),
    )

    consoleSpy.mockRestore()
  })

  it('여러 이벤트 타입의 타입 안전성이 보장된다', () => {
    const bus = new EventBus()
    const downloadHandler = vi.fn()
    const uploadHandler = vi.fn()

    bus.on('download:progress', downloadHandler)
    bus.on('upload:progress', uploadHandler)

    bus.emit('download:progress', { fileId: 'f1', downloadedBytes: 500, totalBytes: 1000 })
    bus.emit('upload:progress', { fileId: 'f2', uploadedBytes: 300, totalBytes: 600 })

    expect(downloadHandler).toHaveBeenCalledWith({
      fileId: 'f1',
      downloadedBytes: 500,
      totalBytes: 1000,
    })
    expect(uploadHandler).toHaveBeenCalledWith({
      fileId: 'f2',
      uploadedBytes: 300,
      totalBytes: 600,
    })
  })
})
