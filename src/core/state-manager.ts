import Database from 'better-sqlite3'
import { v4 as uuid } from 'uuid'
import type { IStateManager } from './types/state-manager.types'
import type { ILogger } from './types/logger.types'
import type { SyncFileStatus } from './types/sync-status.types'
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
} from './db/types'
import { PRAGMA_INIT, ALL_CREATE_STATEMENTS, MIGRATIONS } from './db/schema'

export class StateManager implements IStateManager {
  private db!: Database.Database
  private dbPath: string
  private logger: ILogger

  constructor(dbPath: string, logger: ILogger) {
    this.dbPath = dbPath
    this.logger = logger.child({ module: 'state-manager' })
  }

  // ── Lifecycle ──

  initialize(): void {
    this.db = new Database(this.dbPath)

    // Apply PRAGMAs
    const pragmas = PRAGMA_INIT.split('\n').filter((l) => l.trim().startsWith('PRAGMA'))
    for (const pragma of pragmas) {
      this.db.pragma(pragma.replace('PRAGMA ', '').replace(';', ''))
    }

    // Create tables
    for (const sql of ALL_CREATE_STATEMENTS) {
      this.db.exec(sql)
    }

    // Run migrations (idempotent — ignore already-applied)
    for (const migration of MIGRATIONS) {
      try {
        this.db.exec(migration)
      } catch {
        // Already applied (e.g. duplicate column)
      }
    }

    this.logger.info('Database initialized', { path: this.dbPath })
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.logger.info('Database closed')
    }
  }

  // ── Checkpoints ──

  getCheckpoint(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM detection_checkpoints WHERE key = ?')
      .get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  saveCheckpoint(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO detection_checkpoints (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      )
      .run(key, value)
  }

  // ── Sync Files ──

  saveFile(file: SyncFileInsert): string {
    const id = uuid()
    this.db
      .prepare(
        `INSERT INTO sync_files (id, folder_id, history_no, file_name, file_path, file_size, file_extension, lguplus_file_id, lguplus_updated_at, oper_code, detected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        file.folder_id,
        file.history_no ?? null,
        file.file_name,
        file.file_path,
        file.file_size ?? 0,
        file.file_extension ?? null,
        file.lguplus_file_id ?? null,
        file.lguplus_updated_at ?? null,
        file.oper_code ?? null,
        file.detected_at,
      )
    return id
  }

  updateFileStatus(fileId: string, status: SyncFileStatus, extra?: Partial<SyncFileRow>): void {
    let sql = `UPDATE sync_files SET status = ?, updated_at = datetime('now')`
    const params: unknown[] = [status]

    if (extra) {
      const allowedFields = [
        'download_path',
        'self_webhard_file_id',
        'md5_hash',
        'retry_count',
        'last_error',
        'download_started_at',
        'download_completed_at',
        'upload_started_at',
        'upload_completed_at',
        'lguplus_updated_at',
      ]
      for (const [key, val] of Object.entries(extra)) {
        if (allowedFields.includes(key)) {
          sql += `, ${key} = ?`
          params.push(val)
        }
      }
    }

    sql += ' WHERE id = ?'
    params.push(fileId)
    this.db.prepare(sql).run(...params)
  }

  getFile(fileId: string): SyncFileRow | null {
    const row = this.db.prepare('SELECT * FROM sync_files WHERE id = ?').get(fileId) as
      | (Record<string, unknown> & { enabled?: number })
      | undefined
    return row ? this.mapFileRow(row) : null
  }

  getFilesByFolder(folderId: string, options?: QueryOptions): SyncFileRow[] {
    let sql = 'SELECT * FROM sync_files WHERE folder_id = ?'
    const params: unknown[] = [folderId]

    if (options?.status) {
      sql += ' AND status = ?'
      params.push(options.status)
    }

    sql += ` ORDER BY ${options?.sortBy ?? 'created_at'} ${options?.sortOrder ?? 'desc'}`

    if (options?.limit) {
      sql += ' LIMIT ?'
      params.push(options.limit)
    }
    if (options?.offset) {
      sql += ' OFFSET ?'
      params.push(options.offset)
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[]
    return rows.map((r) => this.mapFileRow(r))
  }

  getFileByHistoryNo(historyNo: number): SyncFileRow | null {
    const row = this.db
      .prepare('SELECT * FROM sync_files WHERE history_no = ?')
      .get(historyNo) as Record<string, unknown> | undefined
    return row ? this.mapFileRow(row) : null
  }

  getFileByLguplusFileId(lguplusFileId: string): SyncFileRow | null {
    const row = this.db
      .prepare('SELECT * FROM sync_files WHERE lguplus_file_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(lguplusFileId) as Record<string, unknown> | undefined
    return row ? this.mapFileRow(row) : null
  }

  // ── Sync Folders ──

  saveFolder(folder: SyncFolderInsert): string {
    const id = uuid()
    this.db
      .prepare(
        `INSERT INTO sync_folders (id, lguplus_folder_id, lguplus_folder_name, lguplus_folder_path, self_webhard_path, company_name, enabled, auto_detected)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        folder.lguplus_folder_id,
        folder.lguplus_folder_name,
        folder.lguplus_folder_path ?? null,
        folder.self_webhard_path ?? null,
        folder.company_name ?? null,
        folder.enabled !== false ? 1 : 0,
        folder.auto_detected ? 1 : 0,
      )
    return id
  }

  updateFolder(id: string, data: Partial<SyncFolderRow>): void {
    const updates: string[] = []
    const params: unknown[] = []

    for (const [key, val] of Object.entries(data)) {
      if (key === 'id' || key === 'created_at') continue
      if (key === 'enabled' || key === 'auto_detected') {
        updates.push(`${key} = ?`)
        params.push(val ? 1 : 0)
      } else {
        updates.push(`${key} = ?`)
        params.push(val)
      }
    }

    if (updates.length === 0) return
    updates.push(`updated_at = datetime('now')`)
    params.push(id)

    this.db.prepare(`UPDATE sync_folders SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  }

  getFolders(enabledOnly?: boolean): SyncFolderRow[] {
    let sql = 'SELECT * FROM sync_folders'
    if (enabledOnly) {
      sql += ' WHERE enabled = 1'
    }
    sql += ' ORDER BY created_at ASC'
    const rows = this.db.prepare(sql).all() as Record<string, unknown>[]
    return rows.map((r) => this.mapFolderRow(r))
  }

  getFolder(id: string): SyncFolderRow | null {
    const row = this.db.prepare('SELECT * FROM sync_folders WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    return row ? this.mapFolderRow(row) : null
  }

  getFolderByLguplusId(lguplusFolderId: string): SyncFolderRow | null {
    const row = this.db
      .prepare('SELECT * FROM sync_folders WHERE lguplus_folder_id = ?')
      .get(lguplusFolderId) as Record<string, unknown> | undefined
    return row ? this.mapFolderRow(row) : null
  }

  // ── Event Log ──

  logEvent(event: SyncEventInsert): void {
    this.db
      .prepare(
        `INSERT INTO sync_events (event_id, event_type, source, file_id, folder_id, history_no, file_name, file_path, file_size, detected_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.event_id,
        event.event_type,
        event.source ?? 'polling',
        event.file_id ?? null,
        event.folder_id ?? null,
        event.history_no ?? null,
        event.file_name ?? null,
        event.file_path ?? null,
        event.file_size ?? null,
        event.detected_at,
        event.metadata ?? null,
      )
  }

  getEvents(query: EventQuery): SyncEventRow[] {
    let sql = 'SELECT * FROM sync_events WHERE 1=1'
    const params: unknown[] = []

    if (query.status) {
      sql += ' AND status = ?'
      params.push(query.status)
    }
    if (query.event_type) {
      sql += ' AND event_type = ?'
      params.push(query.event_type)
    }
    if (query.file_id) {
      sql += ' AND file_id = ?'
      params.push(query.file_id)
    }
    if (query.folder_id) {
      sql += ' AND folder_id = ?'
      params.push(query.folder_id)
    }
    if (query.from) {
      sql += ' AND detected_at >= ?'
      params.push(query.from)
    }
    if (query.to) {
      sql += ' AND detected_at <= ?'
      params.push(query.to)
    }

    sql += ' ORDER BY sequence_id DESC'

    if (query.limit) {
      sql += ' LIMIT ?'
      params.push(query.limit)
    }
    if (query.offset) {
      sql += ' OFFSET ?'
      params.push(query.offset)
    }

    return this.db.prepare(sql).all(...params) as SyncEventRow[]
  }

  // ── DLQ ──

  addToDlq(item: DlqInsert): void {
    this.db
      .prepare(
        `INSERT INTO failed_queue (event_id, file_id, file_name, file_path, folder_id, failure_reason, error_code, max_retries)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.event_id,
        item.file_id ?? null,
        item.file_name,
        item.file_path,
        item.folder_id ?? null,
        item.failure_reason,
        item.error_code ?? null,
        item.max_retries ?? 10,
      )
  }

  getDlqItems(): DlqRow[] {
    const rows = this.db
      .prepare('SELECT * FROM failed_queue ORDER BY created_at DESC')
      .all() as Record<string, unknown>[]
    return rows.map((r) => ({
      ...r,
      can_retry: r.can_retry === 1,
    })) as unknown as DlqRow[]
  }

  removeDlqItem(id: number): void {
    this.db.prepare('DELETE FROM failed_queue WHERE id = ?').run(id)
  }

  // ── Stats ──

  getDailyStats(from: string, to: string): DailyStatsRow[] {
    return this.db
      .prepare('SELECT * FROM daily_stats WHERE date >= ? AND date <= ? ORDER BY date ASC')
      .all(from, to) as DailyStatsRow[]
  }

  incrementDailyStats(date: string, success: number, failed: number, bytes: number): void {
    this.db
      .prepare(
        `INSERT INTO daily_stats (date, success_count, failed_count, total_bytes, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(date) DO UPDATE SET
           success_count = success_count + excluded.success_count,
           failed_count = failed_count + excluded.failed_count,
           total_bytes = total_bytes + excluded.total_bytes,
           updated_at = datetime('now')`,
      )
      .run(date, success, failed, bytes)
  }

  // ── Logs ──

  getLogs(query: LogQuery): LogRow[] {
    let sql = 'SELECT * FROM app_logs WHERE 1=1'
    const params: unknown[] = []

    if (query.level && query.level.length > 0) {
      sql += ` AND level IN (${query.level.map(() => '?').join(', ')})`
      params.push(...query.level)
    }
    if (query.search) {
      sql += ' AND message LIKE ?'
      params.push(`%${query.search}%`)
    }
    if (query.category) {
      sql += ' AND category = ?'
      params.push(query.category)
    }
    if (query.from) {
      const fromVal = query.from.length === 10 ? query.from + ' 00:00:00' : query.from
      sql += ' AND created_at >= ?'
      params.push(fromVal)
    }
    if (query.to) {
      const toVal = query.to.length === 10 ? query.to + ' 23:59:59' : query.to
      sql += ' AND created_at <= ?'
      params.push(toVal)
    }

    sql += ' ORDER BY id DESC'

    if (query.limit) {
      sql += ' LIMIT ?'
      params.push(query.limit)
    }
    if (query.offset) {
      sql += ' OFFSET ?'
      params.push(query.offset)
    }

    return this.db.prepare(sql).all(...params) as LogRow[]
  }

  getLogCount(query: Omit<LogQuery, 'limit' | 'offset'>): number {
    let sql = 'SELECT COUNT(*) as cnt FROM app_logs WHERE 1=1'
    const params: unknown[] = []

    if (query.level && query.level.length > 0) {
      sql += ` AND level IN (${query.level.map(() => '?').join(', ')})`
      params.push(...query.level)
    }
    if (query.search) {
      sql += ' AND message LIKE ?'
      params.push(`%${query.search}%`)
    }
    if (query.category) {
      sql += ' AND category = ?'
      params.push(query.category)
    }
    if (query.from) {
      const fromVal = query.from.length === 10 ? query.from + ' 00:00:00' : query.from
      sql += ' AND created_at >= ?'
      params.push(fromVal)
    }
    if (query.to) {
      const toVal = query.to.length === 10 ? query.to + ' 23:59:59' : query.to
      sql += ' AND created_at <= ?'
      params.push(toVal)
    }

    const row = this.db.prepare(sql).get(...params) as { cnt: number }
    return row.cnt
  }

  addLog(entry: LogInsert): void {
    this.db
      .prepare(
        `INSERT INTO app_logs (level, message, category, context, stack_trace)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        entry.level,
        entry.message,
        entry.category ?? 'general',
        entry.context ?? null,
        entry.stack_trace ?? null,
      )
  }

  // ── Folder Changes ──

  saveFolderChange(change: FolderChangeInsert): number {
    const result = this.db
      .prepare(
        `INSERT INTO folder_changes (lguplus_folder_id, oper_code, old_path, new_path, affected_items, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        change.lguplus_folder_id,
        change.oper_code,
        change.old_path ?? null,
        change.new_path ?? null,
        change.affected_items ?? 0,
        change.metadata ?? null,
      )
    return result.lastInsertRowid as number
  }

  getFolderChanges(options?: { status?: string; limit?: number }): FolderChangeRow[] {
    let sql = 'SELECT * FROM folder_changes WHERE 1=1'
    const params: unknown[] = []
    if (options?.status) {
      sql += ' AND status = ?'
      params.push(options.status)
    }
    sql += ' ORDER BY created_at DESC'
    if (options?.limit) {
      sql += ' LIMIT ?'
      params.push(options.limit)
    }
    return this.db.prepare(sql).all(...params) as FolderChangeRow[]
  }

  updateFolderChange(id: number, data: { status: string; processed_at?: string }): void {
    this.db
      .prepare(`UPDATE folder_changes SET status = ?, processed_at = ? WHERE id = ?`)
      .run(data.status, data.processed_at ?? new Date().toISOString(), id)
  }

  // ── Private Helpers ──

  private mapFolderRow(row: Record<string, unknown>): SyncFolderRow {
    return {
      ...row,
      enabled: row.enabled === 1,
      auto_detected: row.auto_detected === 1,
    } as unknown as SyncFolderRow
  }

  private mapFileRow(row: Record<string, unknown>): SyncFileRow {
    return row as unknown as SyncFileRow
  }
}
