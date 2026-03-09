// src/core/types/state-manager.types.ts — [SPEC] State manager contract
// SDD Level 2: IStateManager interface

import type {
  SyncFileRow,
  SyncFileInsert,
  SyncFolderRow,
  SyncFolderInsert,
  SyncEventRow,
  SyncEventInsert,
  DlqRow,
  DlqInsert,
  DailyStatsRow,
  LogRow,
  LogInsert,
  EventQuery,
  LogQuery,
  QueryOptions,
} from '../db/types'
import type { SyncFileStatus } from './sync-status.types'

export interface IStateManager {
  // Checkpoints
  getCheckpoint(key: string): string | null
  saveCheckpoint(key: string, value: string): void

  // Sync files
  saveFile(file: SyncFileInsert): string
  updateFileStatus(fileId: string, status: SyncFileStatus, extra?: Partial<SyncFileRow>): void
  getFile(fileId: string): SyncFileRow | null
  getFilesByFolder(folderId: string, options?: QueryOptions): SyncFileRow[]
  getFileByHistoryNo(historyNo: number): SyncFileRow | null

  // Sync folders
  saveFolder(folder: SyncFolderInsert): string
  updateFolder(id: string, data: Partial<SyncFolderRow>): void
  getFolders(enabledOnly?: boolean): SyncFolderRow[]
  getFolder(id: string): SyncFolderRow | null
  getFolderByLguplusId(lguplusFolderId: string): SyncFolderRow | null

  // Event log
  logEvent(event: SyncEventInsert): void
  getEvents(query: EventQuery): SyncEventRow[]

  // DLQ
  addToDlq(item: DlqInsert): void
  getDlqItems(): DlqRow[]
  removeDlqItem(id: number): void

  // Stats
  getDailyStats(from: string, to: string): DailyStatsRow[]
  incrementDailyStats(date: string, success: number, failed: number, bytes: number): void

  // Logs (GUI)
  getLogs(query: LogQuery): LogRow[]
  getLogCount(query: Omit<LogQuery, 'limit' | 'offset'>): number
  addLog(entry: LogInsert): void

  // Lifecycle
  initialize(): void
  close(): void
}
