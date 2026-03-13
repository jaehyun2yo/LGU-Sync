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
  FolderChangeRow,
  FolderChangeInsert,
  DetectionSessionRow,
} from '../db/types'
import type { SyncFileStatus } from './sync-status.types'

export interface IStateManager {
  // Checkpoints
  getCheckpoint(key: string): string | null
  saveCheckpoint(key: string, value: string): void

  // Sync files
  saveFile(file: SyncFileInsert): string
  updateFileStatus(fileId: string, status: SyncFileStatus, extra?: Partial<SyncFileRow>): void
  updateFileInfo(fileId: string, data: { file_name?: string; file_path?: string; download_path?: string; folder_id?: string }): void
  getFile(fileId: string): SyncFileRow | null
  getFilesByFolder(folderId: string, options?: QueryOptions): SyncFileRow[]
  getFileByHistoryNo(historyNo: number): SyncFileRow | null
  getFileByLguplusFileId(lguplusFileId: string): SyncFileRow | null

  // Sync folders
  saveFolder(folder: SyncFolderInsert): string
  updateFolder(id: string, data: Partial<SyncFolderRow>): void
  getFolders(enabledOnly?: boolean): SyncFolderRow[]
  getFolder(id: string): SyncFolderRow | null
  getFolderByLguplusId(lguplusFolderId: string): SyncFolderRow | null
  /** Folder rename/move 시 하위 파일의 file_path, download_path를 일괄 변경 */
  bulkUpdateFilePaths(folderId: string, oldPathPrefix: string, newPathPrefix: string): number
  /** Folder 삭제 시 소속 파일 전부 source_deleted 처리 */
  markFolderFilesDeleted(folderId: string): number

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

  // Folder changes
  saveFolderChange(change: FolderChangeInsert): number
  getFolderChanges(options?: { status?: string; limit?: number }): FolderChangeRow[]
  updateFolderChange(id: number, data: { status: string; processed_at?: string }): void

  // Detection Sessions
  createDetectionSession(data: {
    start_source: string
    start_history_no: number | null
  }): string
  endDetectionSession(id: string, data: {
    stop_reason: string
    files_detected: number
    files_downloaded: number
    files_failed: number
    last_history_no: number | null
  }): void
  updateDetectionSession(id: string, data: {
    files_detected?: number
    files_downloaded?: number
    files_failed?: number
    last_history_no?: number | null
  }): void
  getLastDetectionSession(): DetectionSessionRow | null
  getDetectionSessions(options?: {
    page?: number
    pageSize?: number
  }): { items: DetectionSessionRow[]; total: number }

  // Downloads reset
  /** 다운로드된 파일들의 download_path를 초기화하고 status를 detected로 리셋 */
  resetDownloadedFiles(): number

  // Lifecycle
  initialize(): void
  close(): void
}
