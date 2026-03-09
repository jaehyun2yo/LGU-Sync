// src/core/types/retry-manager.types.ts — [SPEC] Retry manager contract
// SDD Level 2: IRetryManager interface

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  circuitName?: string
}

export interface DlqItem {
  id: number
  eventId: string
  fileId: string | null
  fileName: string
  filePath: string
  folderId: string | null
  failureReason: string
  errorCode: string | null
  retryCount: number
  maxRetries: number
  canRetry: boolean
  lastRetryAt: string | null
  nextRetryAt: string | null
  createdAt: string
  updatedAt: string
}

export interface BatchRetryResult {
  total: number
  succeeded: number
  failed: number
}

export interface IRetryManager {
  execute<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>
  getCircuitState(name: string): CircuitState
  resetCircuit(name: string): void
  getDlqItems(): DlqItem[]
  retryDlqItem(id: number): Promise<void>
  retryAllDlq(): Promise<BatchRetryResult>
}
