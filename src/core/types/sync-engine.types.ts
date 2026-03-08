// src/core/types/sync-engine.types.ts — [SPEC] Sync engine contract
// SDD Level 2: ISyncEngine interface

import type { EngineStatus } from './events.types'

export interface FullSyncOptions {
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

export interface SyncResult {
  success: boolean
  fileId: string
  error?: string
  skipped?: boolean
}

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
}
