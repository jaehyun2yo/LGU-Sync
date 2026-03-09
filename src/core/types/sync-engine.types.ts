// src/core/types/sync-engine.types.ts — [SPEC] Sync engine contract
// SDD Level 2: ISyncEngine interface

import type { EngineStatus } from './events.types'
import type { BatchRetryResult } from './retry-manager.types'

export interface FullSyncOptions {
  /** 내부 UUID 기반 폴더 ID 목록. 지정하지 않으면 모든 활성 폴더를 대상으로 함. */
  folderIds?: string[]
  forceRescan?: boolean
}

export interface FullSyncResult {
  scannedFiles: number
  newFiles: number
  syncedFiles: number
  failedFiles: number
  durationMs: number
}

export type SyncResult =
  | { success: true; fileId: string }
  | { success: false; fileId: string; error: string; skipped?: boolean }

export interface ISyncEngine {
  readonly status: EngineStatus
  start(): Promise<void>
  stop(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  fullSync(options?: FullSyncOptions): Promise<FullSyncResult>
  syncFile(fileId: string): Promise<SyncResult>
  downloadOnly(fileId: string): Promise<SyncResult>
  uploadOnly(fileId: string): Promise<SyncResult>
  retryAllDlq(): Promise<BatchRetryResult>
}
