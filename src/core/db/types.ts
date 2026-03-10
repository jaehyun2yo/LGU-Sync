// src/core/db/types.ts — [SPEC] DB Row types and Zod validation schemas
// SDD Level 1: TypeScript types paired with SQL DDL from schema.ts

import { z } from 'zod'
import type {
  SyncFileStatus,
  SyncSessionStatus,
  SyncEventStatus,
  SyncEventResult,
  DetectionSource,
  SessionType,
} from '../types/sync-status.types'

// ── Checkpoint Keys ──

export const CheckpointKeys = {
  LAST_HISTORY_NO: 'last_history_no',
  LAST_POLL_TIME: 'last_poll_time',
  LAST_SNAPSHOT_ID: 'last_snapshot_id',
  LAST_FULL_SYNC_SESSION: 'last_full_sync_session',
  FULL_SYNC_RESUME_POINT: 'full_sync_resume_point',
} as const
export type CheckpointKey = (typeof CheckpointKeys)[keyof typeof CheckpointKeys]

// ── sync_folders ──

export interface SyncFolderRow {
  id: string
  lguplus_folder_id: string
  lguplus_folder_name: string
  lguplus_folder_path: string | null
  self_webhard_path: string | null
  company_name: string | null
  enabled: boolean
  auto_detected: boolean
  files_synced: number
  bytes_synced: number
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface SyncFolderInsert {
  lguplus_folder_id: string
  lguplus_folder_name: string
  lguplus_folder_path?: string | null
  self_webhard_path?: string | null
  company_name?: string | null
  enabled?: boolean
  auto_detected?: boolean
}

export const SyncFolderInsertSchema = z.object({
  lguplus_folder_id: z.string().min(1),
  lguplus_folder_name: z.string().min(1),
  lguplus_folder_path: z.string().nullable().optional(),
  self_webhard_path: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
  auto_detected: z.boolean().default(false),
})

// ── sync_files ──

export interface SyncFileRow {
  id: string
  folder_id: string
  history_no: number | null
  file_name: string
  file_path: string
  file_size: number
  file_extension: string | null
  lguplus_file_id: string | null
  lguplus_updated_at: string | null
  oper_code: string | null
  status: SyncFileStatus
  download_path: string | null
  self_webhard_file_id: string | null
  md5_hash: string | null
  retry_count: number
  last_error: string | null
  detected_at: string
  download_started_at: string | null
  download_completed_at: string | null
  upload_started_at: string | null
  upload_completed_at: string | null
  created_at: string
  updated_at: string
}

export interface SyncFileInsert {
  folder_id: string
  history_no?: number | null
  file_name: string
  file_path: string
  file_size: number
  file_extension?: string | null
  lguplus_file_id?: string | null
  lguplus_updated_at?: string | null
  oper_code?: string | null
  detected_at: string
}

export const SyncFileInsertSchema = z.object({
  folder_id: z.string().min(1),
  history_no: z.number().int().nullable().optional(),
  file_name: z.string().min(1),
  file_path: z.string().min(1),
  file_size: z.number().int().nonnegative(),
  file_extension: z.string().nullable().optional(),
  lguplus_file_id: z.string().nullable().optional(),
  lguplus_updated_at: z.string().nullable().optional(),
  oper_code: z.string().nullable().optional(),
  detected_at: z.string(),
})

// ── sync_events ──

export interface SyncEventRow {
  sequence_id: number
  event_id: string
  event_type: string
  source: DetectionSource
  file_id: string | null
  folder_id: string | null
  history_no: number | null
  file_name: string | null
  file_path: string | null
  file_size: number | null
  oper_code: string | null
  status: SyncEventStatus
  result: SyncEventResult | null
  error_message: string | null
  duration_ms: number | null
  metadata: string | null
  detected_at: string
  processed_at: string | null
  created_at: string
}

export interface SyncEventInsert {
  event_id: string
  event_type: string
  source?: DetectionSource
  file_id?: string | null
  folder_id?: string | null
  history_no?: number | null
  file_name?: string | null
  file_path?: string | null
  file_size?: number | null
  oper_code?: string | null
  detected_at: string
  metadata?: string | null
}

export const SyncEventInsertSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  source: z.enum(['polling', 'snapshot', 'manual']).default('polling'),
  file_id: z.string().nullable().optional(),
  folder_id: z.string().nullable().optional(),
  history_no: z.number().int().nullable().optional(),
  file_name: z.string().nullable().optional(),
  file_path: z.string().nullable().optional(),
  file_size: z.number().int().nullable().optional(),
  detected_at: z.string(),
  metadata: z.string().nullable().optional(),
})

// ── sync_sessions ──

export interface SyncSessionRow {
  id: string
  session_type: SessionType
  status: SyncSessionStatus
  total_files: number
  completed_files: number
  failed_files: number
  skipped_files: number
  total_bytes: number
  transferred_bytes: number
  start_history_no: number | null
  end_history_no: number | null
  error_message: string | null
  started_at: string
  completed_at: string | null
  created_at: string
}

// ── detection_checkpoints ──

export interface CheckpointRow {
  key: string
  value: string
  updated_at: string
}

// ── failed_queue (DLQ) ──

export interface DlqRow {
  id: number
  event_id: string
  file_id: string | null
  file_name: string
  file_path: string
  folder_id: string | null
  failure_reason: string
  error_code: string | null
  retry_count: number
  max_retries: number
  can_retry: boolean
  last_retry_at: string | null
  next_retry_at: string | null
  created_at: string
  updated_at: string
}

export interface DlqInsert {
  event_id: string
  file_id?: string | null
  file_name: string
  file_path: string
  folder_id?: string | null
  failure_reason: string
  error_code?: string | null
  max_retries?: number
}

export const DlqInsertSchema = z.object({
  event_id: z.string().min(1),
  file_id: z.string().nullable().optional(),
  file_name: z.string().min(1),
  file_path: z.string().min(1),
  folder_id: z.string().nullable().optional(),
  failure_reason: z.string().min(1),
  error_code: z.string().nullable().optional(),
  max_retries: z.number().int().positive().default(10),
})

// ── app_settings ──

export type SettingValueType = 'string' | 'number' | 'boolean' | 'json'
export type SettingCategory =
  | 'general'
  | 'lguplus'
  | 'self_webhard'
  | 'sync'
  | 'notification'
  | 'system'

export interface AppSettingRow {
  key: string
  value: string
  value_type: SettingValueType
  category: SettingCategory
  description: string | null
  is_sensitive: boolean
  updated_at: string
}

// ── file_snapshots ──

export type SnapshotItemType = 'file' | 'folder'

export interface FileSnapshotRow {
  id: number
  snapshot_batch_id: string
  folder_id: string
  item_type: SnapshotItemType
  item_id: string | null
  item_name: string
  item_path: string
  item_size: number
  item_extension: string | null
  item_modified_at: string | null
  parent_item_id: string | null
  captured_at: string
  is_complete: boolean
}

// ── app_logs ──

export interface LogRow {
  id: number
  level: string
  message: string
  category: string
  context: string | null
  stack_trace: string | null
  created_at: string
}

export interface LogInsert {
  level: string
  message: string
  category?: string
  context?: string | null
  stack_trace?: string | null
}

export const LogInsertSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string().min(1),
  category: z.string().default('general'),
  context: z.string().nullable().optional(),
  stack_trace: z.string().nullable().optional(),
})

// ── daily_stats ──

export interface DailyStatsRow {
  date: string
  success_count: number
  failed_count: number
  total_bytes: number
  updated_at: string
}

// ── Query helpers ──

export interface QueryOptions {
  status?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface EventQuery {
  status?: SyncEventStatus
  event_type?: string
  file_id?: string
  folder_id?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export interface LogQuery {
  level?: string[]
  search?: string
  category?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

// ── folder_changes ──

export interface FolderChangeRow {
  id: number
  lguplus_folder_id: string
  oper_code: string
  old_path: string | null
  new_path: string | null
  affected_items: number
  status: string
  metadata: string | null
  created_at: string
  processed_at: string | null
}

export interface FolderChangeInsert {
  lguplus_folder_id: string
  oper_code: string
  old_path?: string | null
  new_path?: string | null
  affected_items?: number
  metadata?: string | null
}
