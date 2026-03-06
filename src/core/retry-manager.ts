import type { IRetryManager, CircuitState, RetryOptions, DlqItem, BatchRetryResult } from './types/retry-manager.types'
import type { ILogger } from './types/logger.types'
import { SyncAppError } from './errors'

interface CircuitBreakerState {
  state: CircuitState
  failureCount: number
  lastFailureTime: number
}

export interface CircuitBreakerConfig {
  failureThreshold: number
  resetTimeoutMs: number
}

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 10000,
}

export interface DlqDeps {
  getDlqItems: () => { id: number; file_id: string | null; file_name: string; can_retry: boolean }[]
  retrySyncFile: (fileId: string) => Promise<{ success: boolean }>
  removeDlqItem: (id: number) => void
}

export class RetryManager implements IRetryManager {
  private logger: ILogger
  private circuits = new Map<string, CircuitBreakerState>()
  private circuitConfig: CircuitBreakerConfig
  private dlqDeps?: DlqDeps

  constructor(logger: ILogger, circuitConfig?: Partial<CircuitBreakerConfig>) {
    this.logger = logger.child({ module: 'retry-manager' })
    this.circuitConfig = { ...DEFAULT_CIRCUIT_CONFIG, ...circuitConfig }
  }

  setDlqDeps(deps: DlqDeps): void {
    this.dlqDeps = deps
  }

  async execute<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
    const maxRetries = options?.maxRetries ?? 3
    const baseDelay = options?.baseDelayMs ?? 1000
    const maxDelay = options?.maxDelayMs ?? 10000
    const circuitName = options?.circuitName

    // Circuit breaker check
    if (circuitName) {
      const circuitState = this.getCircuitState(circuitName)
      if (circuitState === 'OPEN') {
        throw new Error(`Circuit breaker is OPEN for '${circuitName}'`)
      }
    }

    let lastError: Error | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn()

        // On success, close the circuit
        if (circuitName) {
          this.recordSuccess(circuitName)
        }

        return result
      } catch (error) {
        lastError = error as Error

        // Check if error is non-retryable
        if (error instanceof SyncAppError && !error.retryable) {
          if (circuitName) {
            this.recordFailure(circuitName)
          }
          throw error
        }

        // Record circuit failure
        if (circuitName) {
          this.recordFailure(circuitName)
        }

        // If we've exhausted retries, throw
        if (attempt >= maxRetries) {
          break
        }

        // Wait before retry with exponential backoff
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
        await this.sleep(delay)

        this.logger.warn(`Retry attempt ${attempt + 1}/${maxRetries}`, {
          error: lastError.message,
          circuitName,
        })
      }
    }

    throw lastError!
  }

  getCircuitState(name: string): CircuitState {
    const circuit = this.circuits.get(name)
    if (!circuit) return 'CLOSED'

    if (circuit.state === 'OPEN') {
      const elapsed = Date.now() - circuit.lastFailureTime
      if (elapsed >= this.circuitConfig.resetTimeoutMs) {
        circuit.state = 'HALF_OPEN'
        return 'HALF_OPEN'
      }
    }

    return circuit.state
  }

  getDlqItems(): DlqItem[] {
    // DLQ is managed by StateManager, not RetryManager directly
    return []
  }

  async retryDlqItem(_id: number): Promise<void> {
    // Delegated to higher-level orchestration
  }

  async retryAllDlq(): Promise<BatchRetryResult> {
    if (!this.dlqDeps) return { total: 0, succeeded: 0, failed: 0 }

    const items = this.dlqDeps.getDlqItems()
    const retryable = items.filter((i) => i.can_retry)

    let succeeded = 0
    let failed = 0

    for (const item of retryable) {
      try {
        const fileId = item.file_id ?? item.file_name
        await this.dlqDeps.retrySyncFile(fileId)
        this.dlqDeps.removeDlqItem(item.id)
        succeeded++
      } catch (error) {
        this.logger.warn('DLQ retry failed', {
          id: item.id,
          fileName: item.file_name,
          error: (error as Error).message,
        })
        failed++
      }
    }

    return { total: retryable.length, succeeded, failed }
  }

  private recordSuccess(circuitName: string): void {
    const circuit = this.circuits.get(circuitName)
    if (circuit) {
      circuit.state = 'CLOSED'
      circuit.failureCount = 0
    }
  }

  private recordFailure(circuitName: string): void {
    let circuit = this.circuits.get(circuitName)
    if (!circuit) {
      circuit = { state: 'CLOSED', failureCount: 0, lastFailureTime: 0 }
      this.circuits.set(circuitName, circuit)
    }

    circuit.failureCount++
    circuit.lastFailureTime = Date.now()

    if (circuit.failureCount >= this.circuitConfig.failureThreshold) {
      circuit.state = 'OPEN'
      this.logger.warn(`Circuit breaker OPEN for '${circuitName}'`, {
        failures: circuit.failureCount,
      })
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
