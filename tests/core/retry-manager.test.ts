import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RetryManager } from '../../src/core/retry-manager'
import { Logger } from '../../src/core/logger'
import {
  NetworkTimeoutError,
  AuthInvalidCredentialsError,
} from '../../src/core/errors'

describe('RetryManager', () => {
  let retry: RetryManager
  let logger: Logger

  beforeEach(() => {
    logger = new Logger({ minLevel: 'error' })
    retry = new RetryManager(logger)
  })

  // ── Basic Retry ──

  it('정상 실행 시 재시도 없이 결과를 반환한다', async () => {
    const fn = vi.fn().mockResolvedValue('success')
    const result = await retry.execute(fn)
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('1회 실패 후 재시도 성공', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new NetworkTimeoutError('timeout'))
      .mockResolvedValue('ok')

    const result = await retry.execute(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('모든 재시도 실패 시 마지막 에러를 throw한다', async () => {
    const fn = vi.fn().mockRejectedValue(new NetworkTimeoutError('timeout'))

    await expect(
      retry.execute(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 }),
    ).rejects.toThrow('timeout')
    expect(fn).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it('retryable=false 에러는 즉시 실패한다 (재시도 안함)', async () => {
    const fn = vi.fn().mockRejectedValue(new AuthInvalidCredentialsError('bad creds'))

    await expect(
      retry.execute(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 }),
    ).rejects.toThrow('bad creds')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('일반 Error는 retryable로 취급한다', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('random'))
      .mockResolvedValue('ok')

    const result = await retry.execute(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  // ── Circuit Breaker ──

  describe('Circuit Breaker', () => {
    it('초기 상태는 CLOSED', () => {
      expect(retry.getCircuitState('test-circuit')).toBe('CLOSED')
    })

    it('연속 실패 시 OPEN 상태로 전환된다', async () => {
      const circuitRetry = new RetryManager(logger, {
        failureThreshold: 3,
        resetTimeoutMs: 100,
      })

      const fn = vi.fn().mockRejectedValue(new NetworkTimeoutError('fail'))

      // 3번 실패 시키기
      for (let i = 0; i < 3; i++) {
        try {
          await circuitRetry.execute(fn, {
            maxRetries: 0,
            baseDelayMs: 1,
            circuitName: 'test',
          })
        } catch {
          // expected
        }
      }

      expect(circuitRetry.getCircuitState('test')).toBe('OPEN')
    })

    it('OPEN 상태에서는 즉시 실패한다', async () => {
      const circuitRetry = new RetryManager(logger, {
        failureThreshold: 2,
        resetTimeoutMs: 10000,
      })

      const fn = vi.fn().mockRejectedValue(new NetworkTimeoutError('fail'))

      // 서킷 열기
      for (let i = 0; i < 2; i++) {
        try {
          await circuitRetry.execute(fn, {
            maxRetries: 0,
            baseDelayMs: 1,
            circuitName: 'api',
          })
        } catch {
          // expected
        }
      }

      fn.mockClear()

      await expect(
        circuitRetry.execute(fn, { maxRetries: 0, baseDelayMs: 1, circuitName: 'api' }),
      ).rejects.toThrow('Circuit breaker is OPEN')

      expect(fn).not.toHaveBeenCalled()
    })

    it('resetTimeout 후 HALF_OPEN으로 전환되며 성공 시 CLOSED', async () => {
      const circuitRetry = new RetryManager(logger, {
        failureThreshold: 2,
        resetTimeoutMs: 50,
      })

      const fn = vi.fn().mockRejectedValue(new NetworkTimeoutError('fail'))

      // 서킷 열기
      for (let i = 0; i < 2; i++) {
        try {
          await circuitRetry.execute(fn, {
            maxRetries: 0,
            baseDelayMs: 1,
            circuitName: 'svc',
          })
        } catch {
          // expected
        }
      }

      expect(circuitRetry.getCircuitState('svc')).toBe('OPEN')

      // resetTimeout 대기
      await new Promise((r) => setTimeout(r, 60))

      expect(circuitRetry.getCircuitState('svc')).toBe('HALF_OPEN')

      // 성공하면 CLOSED로
      fn.mockResolvedValue('recovered')
      await circuitRetry.execute(fn, { maxRetries: 0, baseDelayMs: 1, circuitName: 'svc' })

      expect(circuitRetry.getCircuitState('svc')).toBe('CLOSED')
    })

    it('HALF_OPEN에서 다시 실패하면 OPEN으로', async () => {
      const circuitRetry = new RetryManager(logger, {
        failureThreshold: 2,
        resetTimeoutMs: 50,
      })

      const fn = vi.fn().mockRejectedValue(new NetworkTimeoutError('fail'))

      // 서킷 열기
      for (let i = 0; i < 2; i++) {
        try {
          await circuitRetry.execute(fn, {
            maxRetries: 0,
            baseDelayMs: 1,
            circuitName: 'half',
          })
        } catch {
          // expected
        }
      }

      // resetTimeout 대기
      await new Promise((r) => setTimeout(r, 60))

      // HALF_OPEN에서 다시 실패
      try {
        await circuitRetry.execute(fn, { maxRetries: 0, baseDelayMs: 1, circuitName: 'half' })
      } catch {
        // expected
      }

      expect(circuitRetry.getCircuitState('half')).toBe('OPEN')
    })
  })

  // ── DLQ Batch Retry ──

  describe('retryAllDlq', () => {
    it('DLQ 비어있음 → total: 0', async () => {
      retry.setDlqDeps({
        getDlqItems: () => [],
        retrySyncFile: vi.fn(),
        removeDlqItem: vi.fn(),
      })
      const result = await retry.retryAllDlq()
      expect(result).toEqual({ total: 0, succeeded: 0, failed: 0 })
    })

    it('can_retry=true 항목 재시도 성공 → removeDlqItem 호출', async () => {
      const removeDlqItem = vi.fn()
      const retrySyncFile = vi.fn().mockResolvedValue({ success: true })
      retry.setDlqDeps({
        getDlqItems: () => [
          { id: 1, file_id: 'f1', file_name: 'a.dxf', can_retry: true },
          { id: 2, file_id: 'f2', file_name: 'b.dxf', can_retry: true },
        ] as any[],
        retrySyncFile,
        removeDlqItem,
      })

      const result = await retry.retryAllDlq()
      expect(result).toEqual({ total: 2, succeeded: 2, failed: 0 })
      expect(removeDlqItem).toHaveBeenCalledTimes(2)
      expect(removeDlqItem).toHaveBeenCalledWith(1)
      expect(removeDlqItem).toHaveBeenCalledWith(2)
    })

    it('can_retry=false 항목은 건너뛴다', async () => {
      const retrySyncFile = vi.fn()
      retry.setDlqDeps({
        getDlqItems: () => [
          { id: 1, file_id: 'f1', file_name: 'a.dxf', can_retry: false },
          { id: 2, file_id: 'f2', file_name: 'b.dxf', can_retry: false },
        ] as any[],
        retrySyncFile,
        removeDlqItem: vi.fn(),
      })

      const result = await retry.retryAllDlq()
      expect(result).toEqual({ total: 0, succeeded: 0, failed: 0 })
      expect(retrySyncFile).not.toHaveBeenCalled()
    })

    it('재시도 실패 → failed 카운트 증가, removeDlqItem 미호출', async () => {
      const removeDlqItem = vi.fn()
      const retrySyncFile = vi.fn().mockRejectedValue(new Error('sync failed'))
      retry.setDlqDeps({
        getDlqItems: () => [
          { id: 1, file_id: 'f1', file_name: 'a.dxf', can_retry: true },
        ] as any[],
        retrySyncFile,
        removeDlqItem,
      })

      const result = await retry.retryAllDlq()
      expect(result).toEqual({ total: 1, succeeded: 0, failed: 1 })
      expect(removeDlqItem).not.toHaveBeenCalled()
    })

    it('deps 미설정 → 빈 결과', async () => {
      const result = await retry.retryAllDlq()
      expect(result).toEqual({ total: 0, succeeded: 0, failed: 0 })
    })
  })
})
