import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Logger } from '../../src/core/logger'
import { EventBus } from '../../src/core/event-bus'
import type { ILogger } from '../../src/core/types'

describe('Logger', () => {
  let logger: Logger

  beforeEach(() => {
    logger = new Logger()
  })

  it('debug/info/warn/error 레벨별 로깅이 동작한다', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    logger.debug('debug message')
    logger.info('info message')
    logger.warn('warn message')
    logger.error('error message')

    expect(spy).toHaveBeenCalledTimes(2) // debug + info
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledOnce()

    spy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('context와 함께 로깅할 수 있다', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    logger.info('sync started', { fileCount: 5 })

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[INFO]'),
      expect.stringContaining('sync started'),
      expect.objectContaining({ fileCount: 5 }),
    )

    spy.mockRestore()
  })

  it('error 레벨에서 Error 객체를 전달할 수 있다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('test error')

    logger.error('operation failed', err, { op: 'download' })

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[ERROR]'),
      expect.stringContaining('operation failed'),
      expect.objectContaining({ op: 'download', error: 'test error' }),
    )

    spy.mockRestore()
  })

  it('child()로 컨텍스트를 상속하는 자식 로거를 생성한다', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const child = logger.child({ module: 'sync-engine' })
    child.info('pipeline started')

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[INFO]'),
      expect.stringContaining('pipeline started'),
      expect.objectContaining({ module: 'sync-engine' }),
    )

    spy.mockRestore()
  })

  it('child()의 컨텍스트가 추가 컨텍스트와 병합된다', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const child = logger.child({ module: 'detector' })
    child.info('file found', { fileName: 'test.dxf' })

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[INFO]'),
      expect.stringContaining('file found'),
      expect.objectContaining({ module: 'detector', fileName: 'test.dxf' }),
    )

    spy.mockRestore()
  })

  it('child()를 중첩해서 컨텍스트를 누적할 수 있다', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const child1 = logger.child({ module: 'sync' })
    const child2 = child1.child({ step: 'download' })
    child2.info('started')

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[INFO]'),
      expect.stringContaining('started'),
      expect.objectContaining({ module: 'sync', step: 'download' }),
    )

    spy.mockRestore()
  })

  it('onLog 콜백이 설정되면 모든 로그에 대해 호출된다', () => {
    const callback = vi.fn()
    const loggerWithCb = new Logger({ onLog: callback })

    loggerWithCb.info('test message', { key: 'val' })

    expect(callback).toHaveBeenCalledWith({
      level: 'info',
      message: 'test message',
      context: expect.objectContaining({ key: 'val' }),
      timestamp: expect.any(String),
    })
  })

  it('minLevel 설정 시 해당 레벨 미만의 로그는 무시된다', () => {
    const callback = vi.fn()
    const loggerWithMin = new Logger({ minLevel: 'warn', onLog: callback })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    loggerWithMin.debug('should be ignored')
    loggerWithMin.info('should be ignored')

    expect(callback).not.toHaveBeenCalled()
    expect(spy).not.toHaveBeenCalled()

    spy.mockRestore()
  })
})
