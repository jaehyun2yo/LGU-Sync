// src/shared/ipc-types.ts — [SPEC] Type-safe IPC channel definitions
// SDD Level 2: IPC channel map, event map, and ElectronAPI interface

import type { SyncFileStatus, SyncStatusType } from '../core/types/sync-status.types'
import type { LogLevel } from '../core/types/logger.types'
import type { NotificationConfig } from '../core/types/config.types'

// ── Common types ──

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: ErrorResponse
  timestamp: string
}

export interface ErrorResponse {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface PaginationRequest {
  page?: number
  pageSize?: number
}

export interface Paginated<T> {
  items: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

// ── Sync types ──

export interface SyncStatus {
  state: SyncStatusType
  lguplus: { connected: boolean; sessionValid: boolean; lastPollAt?: string }
  webhard: { connected: boolean; lastUploadAt?: string }
  today: {
    totalFiles: number
    successFiles: number
    failedFiles: number
    totalBytes: number
  }
  currentOperation?: {
    type: 'full-sync' | 'realtime' | 'retry'
    phase: 'scanning' | 'comparing' | 'downloading' | 'uploading'
    progress: number
    currentFile?: string
  }
  recentFiles: SyncFileInfo[]
  failedCount: number
  circuits: Record<string, 'CLOSED' | 'OPEN' | 'HALF_OPEN'>
  lastUpdatedAt: string
}

export interface FullSyncRequest {
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

export interface RetryRequest {
  eventIds?: string[]
  maxRetries?: number
}

export interface RetryResult {
  retried: number
  succeeded: number
  failed: number
}

// ── File/Folder types ──

export interface SyncFileInfo {
  id: string
  fileName: string
  folderPath: string
  fileSize: number
  status: SyncFileStatus
  syncedAt?: string
  error?: string
  downloadPath?: string
}

export interface FolderInfoIpc {
  folderId: string
  folderName: string
  parentFolderId: string | null
  fileCount: number
  syncEnabled: boolean
  lastSyncAt?: string
}

// ── Log types ──

export interface LogEntry {
  id: number
  level: LogLevel
  message: string
  category: string
  timestamp: string
  details?: Record<string, unknown>
  stackTrace?: string
}

export interface LogListRequest {
  level?: LogLevel[]
  search?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
}

export interface LogExportRequest {
  format: 'csv' | 'json'
  dateFrom?: string
  dateTo?: string
}

// ── Settings types ──

export type { NotificationConfig } from '../core/types/config.types'

export interface AppSettings {
  lguplus: { username: string; password: string }
  webhard: { apiUrl: string; apiKey: string }
  sync: {
    pollingIntervalSec: number
    maxConcurrentDownloads: number
    maxConcurrentUploads: number
    snapshotIntervalMin: number
  }
  notification: NotificationConfig
  system: {
    autoStart: boolean
    tempDownloadPath: string
    logRetentionDays: number
    autoDetection: boolean
    watchFolderIds: string[]
  }
}

export interface ConnectionTestReq {
  target: 'lguplus' | 'webhard'
  username?: string
  password?: string
  apiUrl?: string
  apiKey?: string
}

export interface ConnectionTestResult {
  success: boolean
  latencyMs: number
  message: string
  serverVersion?: string
}

// ── Notification types ──

export type NotificationType = 'info' | 'success' | 'warning' | 'error'

export interface NotificationItem {
  id: string
  type: NotificationType
  title: string
  message: string
  read: boolean
  createdAt: string
}

// ── IPC Channel Map (invoke/handle) ──

export interface IpcChannelMap {
  // Sync control
  'sync:start': { request: void; response: ApiResponse<SyncStatus> }
  'sync:stop': { request: void; response: ApiResponse<void> }
  'sync:pause': { request: void; response: ApiResponse<void> }
  'sync:resume': { request: void; response: ApiResponse<void> }
  'sync:status': { request: void; response: ApiResponse<SyncStatus> }
  'sync:full-sync': { request: FullSyncRequest; response: ApiResponse<FullSyncResult> }
  'sync:retry-failed': { request: RetryRequest; response: ApiResponse<RetryResult> }
  'sync:reset-circuit': { request: { circuitName: string }; response: ApiResponse<void> }

  // Data queries
  'files:show-in-folder': { request: { filePath: string }; response: ApiResponse<void> }

  // Folders
  'folders:list': {
    request: { parentId?: string }
    response: ApiResponse<FolderInfoIpc[]>
  }

  // Logs
  'logs:list': { request: LogListRequest; response: ApiResponse<Paginated<LogEntry>> }
  'logs:export': { request: LogExportRequest; response: ApiResponse<{ filePath: string }> }

  // Settings
  'settings:get': { request: void; response: ApiResponse<AppSettings> }
  'settings:update': { request: Partial<AppSettings>; response: ApiResponse<AppSettings> }
  'settings:test-connection': {
    request: ConnectionTestReq
    response: ApiResponse<ConnectionTestResult>
  }

  // Test (RealtimeDetectionPage에서 사용)
  'test:open-download-folder': { request: void; response: ApiResponse<void> }
  'test:clear-downloads': {
    request: void
    response: ApiResponse<{ deletedFiles: number; deletedFolders: number; resetRecords: number }>
  }

  // Detection (실시간 감지 서비스)
  'detection:start': { request: DetectionStartRequest; response: ApiResponse<void> }
  'detection:stop': { request: void; response: ApiResponse<void> }
  'detection:status': { request: void; response: ApiResponse<DetectionStatusResponse> }
  'detection:sessions': {
    request: DetectionSessionsRequest
    response: ApiResponse<Paginated<DetectionSessionInfo>>
  }
  'detection:recover': { request: void; response: ApiResponse<DetectionRecoverResult> }
  'detection:set-watch-folders': {
    request: { folderIds: string[] }
    response: ApiResponse<void>
  }
  'detection:get-watch-folders': {
    request: void
    response: ApiResponse<{ folderIds: string[] }>
  }

  // Notifications
  'notification:getAll': { request: void; response: ApiResponse<NotificationItem[]> }
  'notification:read': { request: { id: string }; response: ApiResponse<void> }
  'notification:readAll': { request: void; response: ApiResponse<void> }
}

// ── Detection service types ──

export interface DetectionStartRequest {
  /** 감지 시작 소스 */
  source: 'manual' | 'auto-start' | 'recovery'
}

export interface DetectionStatusResponse {
  /** 현재 감지 상태 */
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'recovering'
  /** 현재 세션 ID (없으면 null) */
  currentSessionId: string | null
  /** 현재 세션 통계 */
  currentSession: {
    filesDetected: number
    filesDownloaded: number
    filesFailed: number
    startedAt: string
    lastHistoryNo: number | null
  } | null
  /** 마지막 폴링 시각 */
  lastPollAt: string | null
  /** 자동 시작 설정 여부 */
  autoStartEnabled: boolean
}

export interface DetectionSessionInfo {
  id: string
  startedAt: string
  stoppedAt: string | null
  stopReason: 'manual' | 'crash' | 'app-quit' | 'error' | null
  filesDetected: number
  filesDownloaded: number
  filesFailed: number
  lastHistoryNo: number | null
}

export interface DetectionSessionsRequest {
  page?: number
  pageSize?: number
}

export interface DetectionRecoverResult {
  recoveredFiles: number
  failedFiles: number
  fromHistoryNo: number
  toHistoryNo: number
}

export interface DetectionEventPush {
  type: 'started' | 'detected' | 'downloaded' | 'failed' | 'error' | 'stopped' | 'recovery'
  message: string
  timestamp: string
  fileName?: string
  filePath?: string
  operCode?: string
  sessionId?: string
  stats?: {
    filesDetected: number
    filesDownloaded: number
    filesFailed: number
  }
}

export interface DetectionStatusPush {
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'recovering'
  sessionId: string | null
}

// ── Realtime detection test types ──

export interface RealtimeTestStartRequest {
  /** 감지 시 알림 (OS + 앱 내) */
  enableNotification: boolean
}

export interface RealtimeTestEvent {
  type: 'started' | 'detected' | 'error' | 'stopped'
  message: string
  timestamp: string
  fileName?: string
  error?: string
  /** 감지된 변동 유형 (detected 이벤트에서 사용) */
  operCode?: string
}

// ── IPC Event Map (Main → Renderer, one-way push) ──

export interface SyncProgressEvent {
  phase: 'scanning' | 'comparing' | 'downloading' | 'uploading'
  fileId?: string
  currentFile?: string
  completedFiles: number
  totalFiles: number
  completedBytes: number
  totalBytes: number
  speedBps: number
  estimatedRemainingMs: number
}

export interface FileCompletedEvent {
  fileId: string
  fileName: string
  folderPath: string
  fileSize: number
  direction: 'download' | 'upload'
  durationMs: number
}

export interface FileFailedEvent {
  fileId: string
  fileName: string
  error: string
  errorCode: string
  retryCount: number
  willRetry: boolean
}

export interface StatusChangedEvent {
  previousStatus: SyncStatusType
  currentStatus: SyncStatusType
  reason?: string
  timestamp: string
}

export interface NewFilesEvent {
  files: Array<{
    fileName: string
    folderPath: string
    fileSize: number
    detectedAt: string
    operCode?: string
  }>
  source: 'polling' | 'snapshot'
}

export interface AuthExpiredEvent {
  service: 'lguplus' | 'webhard'
  reason: string
  autoReloginAttempted: boolean
  requiresManualAction: boolean
}

export interface CriticalErrorEvent {
  code: string
  message: string
  details?: Record<string, unknown>
  timestamp: string
}

export interface OperCodeEvent {
  operCode: string
  fileName: string
  filePath: string
  folderId: string
  historyNo?: number
  timestamp: string
}

export interface ScanProgressEvent {
  phase: 'polling' | 'paginating'
  currentPage: number
  totalPages: number
  discoveredCount: number
}

export interface StartProgressEvent {
  step: string
  message: string
  current: number
  total: number
}

export interface IpcEventMap {
  'sync:progress': SyncProgressEvent
  'sync:file-completed': FileCompletedEvent
  'sync:file-failed': FileFailedEvent
  'sync:status-changed': StatusChangedEvent
  'detection:new-files': NewFilesEvent
  'detection:scan-progress': ScanProgressEvent
  'detection:start-progress': StartProgressEvent
  'detection:event': DetectionEventPush
  'detection:status-changed': DetectionStatusPush
  'opercode:event': OperCodeEvent
  'auth:expired': AuthExpiredEvent
  'error:critical': CriticalErrorEvent
}

// ── ElectronAPI (exposed via contextBridge) ──

export interface ElectronAPI {
  invoke<K extends keyof IpcChannelMap>(
    channel: K,
    ...args: IpcChannelMap[K]['request'] extends void ? [] : [IpcChannelMap[K]['request']]
  ): Promise<IpcChannelMap[K]['response']>

  on<K extends keyof IpcEventMap>(
    channel: K,
    callback: (data: IpcEventMap[K]) => void,
  ): () => void
}

// ── Global augmentation ──

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
