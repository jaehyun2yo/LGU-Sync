import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConfigManager, DEFAULT_CONFIG } from '../../src/core/config-manager'
import type { AppConfig } from '../../src/core/types'

describe('ConfigManager', () => {
  let config: ConfigManager

  beforeEach(() => {
    config = new ConfigManager()
  })

  it('getAll()은 기본 설정값을 반환한다', () => {
    const all = config.getAll()
    expect(all).toEqual(DEFAULT_CONFIG)
  })

  it('get()으로 특정 섹션을 조회할 수 있다', () => {
    const sync = config.get('sync')
    expect(sync.pollingIntervalSec).toBe(5)
    expect(sync.maxConcurrentDownloads).toBe(5)
    expect(sync.maxConcurrentUploads).toBe(3)
    expect(sync.snapshotIntervalMin).toBe(10)
  })

  it('set()으로 특정 섹션의 값을 변경할 수 있다', () => {
    config.set('sync', { pollingIntervalSec: 10 })
    const sync = config.get('sync')
    expect(sync.pollingIntervalSec).toBe(10)
    // 다른 값들은 유지
    expect(sync.maxConcurrentDownloads).toBe(5)
  })

  it('set()은 Partial 업데이트를 지원한다 (병합)', () => {
    config.set('lguplus', { username: 'testuser' })
    const lguplus = config.get('lguplus')
    expect(lguplus.username).toBe('testuser')
    expect(lguplus.password).toBe(DEFAULT_CONFIG.lguplus.password) // default unchanged
  })

  it('validate()는 유효한 설정에 대해 true를 반환한다', () => {
    expect(config.validate()).toBe(true)
  })

  it('validate()는 유효하지 않은 값에 대해 false를 반환한다', () => {
    config.set('sync', { pollingIntervalSec: -1 })
    expect(config.validate()).toBe(false)
  })

  it('reset()은 기본값으로 복원한다', () => {
    config.set('sync', { pollingIntervalSec: 30 })
    config.set('lguplus', { username: 'user1' })
    config.reset()
    expect(config.getAll()).toEqual(DEFAULT_CONFIG)
  })

  it('onChanged()는 값 변경 시 핸들러를 호출한다', () => {
    const handler = vi.fn()
    config.onChanged('sync', handler)

    config.set('sync', { pollingIntervalSec: 15 })

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ pollingIntervalSec: 15 }),
    )
  })

  it('onChanged()가 반환한 함수로 구독을 해제할 수 있다', () => {
    const handler = vi.fn()
    const unsubscribe = config.onChanged('sync', handler)

    unsubscribe()
    config.set('sync', { pollingIntervalSec: 20 })

    expect(handler).not.toHaveBeenCalled()
  })

  it('다른 섹션 변경 시 해당 섹션의 핸들러만 호출된다', () => {
    const syncHandler = vi.fn()
    const lguplusHandler = vi.fn()
    config.onChanged('sync', syncHandler)
    config.onChanged('lguplus', lguplusHandler)

    config.set('sync', { pollingIntervalSec: 7 })

    expect(syncHandler).toHaveBeenCalledOnce()
    expect(lguplusHandler).not.toHaveBeenCalled()
  })

  it('초기 설정을 생성자에서 전달할 수 있다', () => {
    const custom = new ConfigManager({
      lguplus: { username: 'admin', password: 'secret' },
    })
    expect(custom.get('lguplus')).toEqual({ username: 'admin', password: 'secret' })
    // 다른 섹션은 기본값
    expect(custom.get('sync')).toEqual(DEFAULT_CONFIG.sync)
  })
})
