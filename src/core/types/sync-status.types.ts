// src/core/types/sync-status.types.ts — [SPEC] Sync status type definitions
// SDD Level 1: Status union types for state machines

export type SyncFileStatus =
  | 'detected'
  | 'downloading'
  | 'downloaded'
  | 'dl_failed'
  | 'uploading'
  | 'ul_failed'
  | 'completed'
  | 'skipped'
  | 'source_deleted'
  | 'dlq'

export type SyncSessionStatus = 'started' | 'running' | 'completed' | 'failed' | 'cancelled'

export type SyncEventStatus = 'logged' | 'processing' | 'completed' | 'failed'

export type SyncEventResult = 'success' | 'skipped' | 'failed'

export type DetectionSource = 'polling' | 'snapshot' | 'manual'

export type SessionType = 'full_sync' | 'realtime' | 'manual_retry'

export type SyncStatusType = 'idle' | 'syncing' | 'paused' | 'error' | 'disconnected'
