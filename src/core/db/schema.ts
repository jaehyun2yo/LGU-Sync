// src/core/db/schema.ts — [SPEC] SQL DDL definitions
// SDD Level 1: Table creation SQL paired with TypeScript Row types

export const SCHEMA_VERSION = 1

export const PRAGMA_INIT = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -8000;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;
`

export const CREATE_SYNC_FOLDERS = `
CREATE TABLE IF NOT EXISTS sync_folders (
    id                  TEXT PRIMARY KEY,
    lguplus_folder_id   TEXT NOT NULL UNIQUE,
    lguplus_folder_name TEXT NOT NULL,
    lguplus_folder_path TEXT,
    self_webhard_path   TEXT,
    company_name        TEXT,
    enabled             INTEGER NOT NULL DEFAULT 1,
    auto_detected       INTEGER NOT NULL DEFAULT 0,
    files_synced        INTEGER NOT NULL DEFAULT 0,
    bytes_synced        INTEGER NOT NULL DEFAULT 0,
    last_synced_at      TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sf_enabled ON sync_folders(enabled);
CREATE INDEX IF NOT EXISTS idx_sf_path ON sync_folders(lguplus_folder_path);
`

export const CREATE_SYNC_FILES = `
CREATE TABLE IF NOT EXISTS sync_files (
    id                    TEXT PRIMARY KEY,
    folder_id             TEXT NOT NULL REFERENCES sync_folders(id) ON DELETE CASCADE,
    history_no            INTEGER,
    file_name             TEXT NOT NULL,
    file_path             TEXT NOT NULL,
    file_size             INTEGER NOT NULL DEFAULT 0,
    file_extension        TEXT,
    lguplus_file_id       TEXT,
    lguplus_updated_at    TEXT,
    status                TEXT NOT NULL DEFAULT 'detected',
    download_path         TEXT,
    self_webhard_file_id  TEXT,
    md5_hash              TEXT,
    retry_count           INTEGER NOT NULL DEFAULT 0,
    last_error            TEXT,
    detected_at           TEXT NOT NULL,
    download_started_at   TEXT,
    download_completed_at TEXT,
    upload_started_at     TEXT,
    upload_completed_at   TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sfi_history ON sync_files(history_no) WHERE history_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sfi_folder ON sync_files(folder_id);
CREATE INDEX IF NOT EXISTS idx_sfi_status ON sync_files(status);
CREATE INDEX IF NOT EXISTS idx_sfi_detected ON sync_files(detected_at);
CREATE INDEX IF NOT EXISTS idx_sfi_folder_status ON sync_files(folder_id, status);
CREATE INDEX IF NOT EXISTS idx_sfi_lguplus_id ON sync_files(lguplus_file_id);
`

export const CREATE_SYNC_EVENTS = `
CREATE TABLE IF NOT EXISTS sync_events (
    sequence_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id      TEXT NOT NULL UNIQUE,
    event_type    TEXT NOT NULL,
    source        TEXT NOT NULL DEFAULT 'polling',
    file_id       TEXT,
    folder_id     TEXT,
    history_no    INTEGER,
    file_name     TEXT,
    file_path     TEXT,
    file_size     INTEGER,
    status        TEXT NOT NULL DEFAULT 'logged',
    result        TEXT,
    error_message TEXT,
    duration_ms   INTEGER,
    metadata      TEXT,
    detected_at   TEXT NOT NULL,
    processed_at  TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_se_status ON sync_events(status);
CREATE INDEX IF NOT EXISTS idx_se_type ON sync_events(event_type);
CREATE INDEX IF NOT EXISTS idx_se_detected ON sync_events(detected_at);
CREATE INDEX IF NOT EXISTS idx_se_file ON sync_events(file_id);
CREATE INDEX IF NOT EXISTS idx_se_history ON sync_events(history_no);
CREATE INDEX IF NOT EXISTS idx_se_date ON sync_events(date(created_at));
`

export const CREATE_SYNC_SESSIONS = `
CREATE TABLE IF NOT EXISTS sync_sessions (
    id                TEXT PRIMARY KEY,
    session_type      TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'started',
    total_files       INTEGER NOT NULL DEFAULT 0,
    completed_files   INTEGER NOT NULL DEFAULT 0,
    failed_files      INTEGER NOT NULL DEFAULT 0,
    skipped_files     INTEGER NOT NULL DEFAULT 0,
    total_bytes       INTEGER NOT NULL DEFAULT 0,
    transferred_bytes INTEGER NOT NULL DEFAULT 0,
    start_history_no  INTEGER,
    end_history_no    INTEGER,
    error_message     TEXT,
    started_at        TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at      TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ss_status ON sync_sessions(status);
CREATE INDEX IF NOT EXISTS idx_ss_type ON sync_sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_ss_started ON sync_sessions(started_at);
`

export const CREATE_DETECTION_CHECKPOINTS = `
CREATE TABLE IF NOT EXISTS detection_checkpoints (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`

export const CREATE_FAILED_QUEUE = `
CREATE TABLE IF NOT EXISTS failed_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id        TEXT NOT NULL UNIQUE,
    file_id         TEXT,
    file_name       TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    folder_id       TEXT,
    failure_reason  TEXT NOT NULL,
    error_code      TEXT,
    retry_count     INTEGER NOT NULL DEFAULT 0,
    max_retries     INTEGER NOT NULL DEFAULT 10,
    can_retry       INTEGER NOT NULL DEFAULT 1,
    last_retry_at   TEXT,
    next_retry_at   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fq_retry ON failed_queue(can_retry, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_fq_created ON failed_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_fq_folder ON failed_queue(folder_id);
`

export const CREATE_APP_SETTINGS = `
CREATE TABLE IF NOT EXISTS app_settings (
    key          TEXT PRIMARY KEY,
    value        TEXT NOT NULL,
    value_type   TEXT NOT NULL DEFAULT 'string',
    category     TEXT NOT NULL DEFAULT 'general',
    description  TEXT,
    is_sensitive INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_as_category ON app_settings(category);
`

export const CREATE_FILE_SNAPSHOTS = `
CREATE TABLE IF NOT EXISTS file_snapshots (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_batch_id TEXT NOT NULL,
    folder_id         TEXT NOT NULL,
    item_type         TEXT NOT NULL DEFAULT 'file',
    item_id           TEXT,
    item_name         TEXT NOT NULL,
    item_path         TEXT NOT NULL,
    item_size         INTEGER NOT NULL DEFAULT 0,
    item_extension    TEXT,
    item_modified_at  TEXT,
    parent_item_id    TEXT,
    captured_at       TEXT NOT NULL DEFAULT (datetime('now')),
    is_complete       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_fs_batch ON file_snapshots(snapshot_batch_id);
CREATE INDEX IF NOT EXISTS idx_fs_folder ON file_snapshots(folder_id);
CREATE INDEX IF NOT EXISTS idx_fs_captured ON file_snapshots(captured_at);
CREATE INDEX IF NOT EXISTS idx_fs_path ON file_snapshots(item_path, snapshot_batch_id);
`

export const CREATE_APP_LOGS = `
CREATE TABLE IF NOT EXISTS app_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    level       TEXT NOT NULL,
    message     TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'general',
    context     TEXT,
    stack_trace TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_al_level ON app_logs(level);
CREATE INDEX IF NOT EXISTS idx_al_created ON app_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_al_category ON app_logs(category);
`

export const CREATE_DAILY_STATS = `
CREATE TABLE IF NOT EXISTS daily_stats (
    date           TEXT PRIMARY KEY,
    success_count  INTEGER NOT NULL DEFAULT 0,
    failed_count   INTEGER NOT NULL DEFAULT 0,
    total_bytes    INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
`

export const CREATE_FOLDER_CHANGES = `
CREATE TABLE IF NOT EXISTS folder_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lguplus_folder_id TEXT NOT NULL,
    oper_code TEXT NOT NULL,
    old_path TEXT,
    new_path TEXT,
    affected_items INTEGER DEFAULT 0,
    status TEXT DEFAULT 'detected',
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_fc_folder ON folder_changes(lguplus_folder_id);
CREATE INDEX IF NOT EXISTS idx_fc_status ON folder_changes(status);
CREATE INDEX IF NOT EXISTS idx_fc_created ON folder_changes(created_at);
`

export const MIGRATIONS = [
  `ALTER TABLE sync_files ADD COLUMN lguplus_updated_at TEXT;`,
  // Add oper_code column to sync_files
  `ALTER TABLE sync_files ADD COLUMN oper_code TEXT DEFAULT 'UP';`,
  // Add oper_code column to sync_events
  `ALTER TABLE sync_events ADD COLUMN oper_code TEXT;`,
]

/** All table creation statements in dependency order */
export const ALL_CREATE_STATEMENTS = [
  CREATE_SYNC_FOLDERS,
  CREATE_SYNC_FILES,
  CREATE_SYNC_EVENTS,
  CREATE_SYNC_SESSIONS,
  CREATE_DETECTION_CHECKPOINTS,
  CREATE_FAILED_QUEUE,
  CREATE_APP_SETTINGS,
  CREATE_FILE_SNAPSHOTS,
  CREATE_APP_LOGS,
  CREATE_DAILY_STATS,
  CREATE_FOLDER_CHANGES,
]
