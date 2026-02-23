// src/shared/ipc-types.ts — [SPEC] Type-safe IPC channel definitions
// SDD Level 2: IPC channel map, event map, and ElectronAPI interface

import type { SyncFileStatus, SyncStatusType } from '../core/types/sync-status.types'
import type { LogLevel } from '../core/types/logger.types'

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
}

export interface SyncFileDetail extends SyncFileInfo {
  lguplusFileId: string | null
  lguplusFolderId: string
  detectedAt: string
  detectionSource: 'polling' | 'snapshot'
  webhardFileId?: string
  retryCount: number
  lastError?: string
  history: Array<{ action: string; timestamp: string; details?: string }>
}

export interface FileListRequest {
  folderId?: string
  status?: SyncFileStatus
  sortBy?: 'name' | 'date' | 'size' | 'status'
  sortOrder?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface FileSearchRequest {
  query: string
  folderId?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
}

export interface FolderInfoIpc {
  folderId: string
  folderName: string
  parentFolderId: string | null
  fileCount: number
  syncEnabled: boolean
  lastSyncAt?: string
}

export interface FolderTreeNode extends FolderInfoIpc {
  children: FolderTreeNode[]
  depth: number
}

export interface FolderToggleRequest {
  folderId: string
  enabled: boolean
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

// ── Stats types ──

export interface SyncSummary {
  period: string
  totalFiles: number
  successFiles: number
  failedFiles: number
  totalBytes: number
  averageSpeedBps: number
  byFolder: Array<{ folderName: string; fileCount: number; totalBytes: number }>
}

export interface ChartRequest {
  type: 'daily' | 'hourly'
  dateFrom: string
  dateTo: string
}

export interface ChartData {
  labels: string[]
  datasets: Array<{ label: string; data: number[]; color?: string }>
}

// ── Settings types ──

export interface AppSettings {
  lguplus: { username: string; password: string }
  webhard: { apiUrl: string; apiKey: string }
  sync: {
    pollingIntervalSec: number
    maxConcurrentDownloads: number
    maxConcurrentUploads: number
    snapshotIntervalMin: number
  }
  notification: { inApp: boolean; toast: boolean }
  system: {
    autoStart: boolean
    tempDownloadPath: string
    logRetentionDays: number
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

// ── Auth types ──

export interface LoginRequest {
  username: string
  password: string
  saveCredentials?: boolean
}

export interface AuthStatus {
  authenticated: boolean
  username?: string
  sessionValid: boolean
  lastLoginAt?: string
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

// ── Failed event ──

export interface FailedEvent {
  id: string
  fileName: string
  folderPath: string
  fileSize: number
  errorCode: string
  errorMessage: string
  failedAt: string
  retryCount: number
  canRetry: boolean
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

  // Data queries
  'files:list': { request: FileListRequest; response: ApiResponse<Paginated<SyncFileInfo>> }
  'files:detail': { request: { fileId: string }; response: ApiResponse<SyncFileDetail> }
  'files:search': { request: FileSearchRequest; response: ApiResponse<Paginated<SyncFileInfo>> }

  // Folders
  'folders:list': {
    request: { parentId?: string }
    response: ApiResponse<FolderInfoIpc[]>
  }
  'folders:tree': { request: void; response: ApiResponse<FolderTreeNode[]> }
  'folders:toggle': { request: FolderToggleRequest; response: ApiResponse<void> }

  // Logs
  'logs:list': { request: LogListRequest; response: ApiResponse<Paginated<LogEntry>> }
  'logs:export': { request: LogExportRequest; response: ApiResponse<{ filePath: string }> }

  // Stats
  'stats:summary': {
    request: { period?: 'today' | 'week' | 'month' }
    response: ApiResponse<SyncSummary>
  }
  'stats:chart': { request: ChartRequest; response: ApiResponse<ChartData> }

  // Settings
  'settings:get': { request: void; response: ApiResponse<AppSettings> }
  'settings:update': { request: Partial<AppSettings>; response: ApiResponse<AppSettings> }
  'settings:test-connection': {
    request: ConnectionTestReq
    response: ApiResponse<ConnectionTestResult>
  }

  // Auth
  'auth:login': { request: LoginRequest; response: ApiResponse<AuthStatus> }
  'auth:logout': { request: void; response: ApiResponse<void> }
  'auth:status': { request: void; response: ApiResponse<AuthStatus> }

  // Failed / DLQ
  'failed:list': { request: PaginationRequest; response: ApiResponse<Paginated<FailedEvent>> }

  // Notifications
  'notification:getAll': { request: void; response: ApiResponse<NotificationItem[]> }
  'notification:read': { request: { id: string }; response: ApiResponse<void> }
  'notification:readAll': { request: void; response: ApiResponse<void> }
}

// ── IPC Event Map (Main → Renderer, one-way push) ──

export interface SyncProgressEvent {
  phase: 'scanning' | 'comparing' | 'downloading' | 'uploading'
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

export interface IpcEventMap {
  'sync:progress': SyncProgressEvent
  'sync:file-completed': FileCompletedEvent
  'sync:file-failed': FileFailedEvent
  'sync:status-changed': StatusChangedEvent
  'detection:new-files': NewFilesEvent
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
