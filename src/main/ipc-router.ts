import { ipcMain, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CoreServices } from '../core/container'
import type { ApiResponse, IpcEventMap } from '../shared/ipc-types'
import type { LogRow, LogQuery } from '../core/db/types'

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, timestamp: new Date().toISOString() }
}

function fail(code: string, message: string): ApiResponse<never> {
  return {
    success: false,
    error: { code, message },
    timestamp: new Date().toISOString(),
  }
}

export async function exportLogs(
  getLogs: (query: LogQuery) => LogRow[],
  request: { format: 'csv' | 'json'; dateFrom?: string; dateTo?: string },
): Promise<{ filePath: string }> {
  const logs = getLogs({ from: request.dateFrom, to: request.dateTo })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const ext = request.format
  const filePath = join(tmpdir(), `webhard-sync-logs-${timestamp}.${ext}`)

  let content: string

  if (request.format === 'json') {
    const mapped = logs.map((l) => ({
      id: l.id,
      level: l.level,
      message: l.message,
      category: l.category,
      context: l.context ? JSON.parse(l.context) : null,
      stackTrace: l.stack_trace ?? null,
      timestamp: l.created_at,
    }))
    content = JSON.stringify(mapped, null, 2)
  } else {
    const headers = ['id', 'level', 'message', 'category', 'context', 'stackTrace', 'timestamp']
    const rows = logs.map((l) => [
      String(l.id),
      l.level,
      escapeCsvField(l.message),
      l.category,
      escapeCsvField(l.context ?? ''),
      escapeCsvField(l.stack_trace ?? ''),
      l.created_at,
    ])
    content = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
  }

  await writeFile(filePath, content, 'utf-8')
  return { filePath }
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function registerIpcHandlers(services: CoreServices): void {
  const { engine, state, config, lguplus, retry, notification, folderDiscovery } = services

  // ── Sync control ──

  ipcMain.handle('sync:start', async () => {
    try {
      await engine.start()
      return ok(buildSyncStatus(services))
    } catch (e) {
      return fail('SYNC_START_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('sync:stop', async () => {
    try {
      await engine.stop()
      return ok(undefined)
    } catch (e) {
      return fail('SYNC_STOP_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('sync:pause', async () => {
    try {
      await engine.pause()
      return ok(undefined)
    } catch (e) {
      return fail('SYNC_PAUSE_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('sync:resume', async () => {
    try {
      await engine.resume()
      return ok(undefined)
    } catch (e) {
      return fail('SYNC_RESUME_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('sync:status', async () => {
    try {
      return ok(buildSyncStatus(services))
    } catch (e) {
      return fail('SYNC_STATUS_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('sync:full-sync', async (_event, request) => {
    try {
      const result = await engine.fullSync(request)
      return ok(result)
    } catch (e) {
      return fail('FULL_SYNC_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('sync:retry-failed', async (_event, request) => {
    try {
      const result = await retry.retryAllDlq()
      return ok({
        retried: result.total,
        succeeded: result.succeeded,
        failed: result.failed,
      })
    } catch (e) {
      return fail('RETRY_FAILED', (e as Error).message)
    }
  })

  // ── Files ──

  ipcMain.handle('files:list', async (_event, request) => {
    try {
      const { folderId, status, sortBy, sortOrder, page = 1, pageSize = 50 } = request ?? {}
      const files = state.getFilesByFolder(folderId ?? '', {
        status,
        sortBy: sortBy ?? 'detected_at',
        sortOrder: sortOrder ?? 'desc',
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      const items = files.map(mapFileRow)
      return ok({
        items,
        pagination: {
          page,
          pageSize,
          total: items.length,
          totalPages: Math.ceil(items.length / pageSize) || 1,
          hasNext: items.length === pageSize,
          hasPrev: page > 1,
        },
      })
    } catch (e) {
      return fail('FILES_LIST_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('files:detail', async (_event, request) => {
    try {
      const file = state.getFile(request.fileId)
      if (!file) return fail('FILE_NOT_FOUND', 'File not found')
      return ok({
        ...mapFileRow(file),
        lguplusFileId: file.lguplus_file_id,
        lguplusFolderId: file.folder_id,
        detectedAt: file.detected_at,
        detectionSource: 'polling' as const,
        webhardFileId: file.self_webhard_file_id ?? undefined,
        retryCount: file.retry_count,
        lastError: file.last_error ?? undefined,
        history: [],
      })
    } catch (e) {
      return fail('FILE_DETAIL_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('files:search', async (_event, request) => {
    try {
      const { query, page = 1, pageSize = 50 } = request ?? {}
      // Simple search: get all files from all folders and filter by name
      const folders = state.getFolders()
      const allFiles = folders.flatMap((f) => state.getFilesByFolder(f.id))
      const filtered = allFiles.filter((f) =>
        f.file_name.toLowerCase().includes((query ?? '').toLowerCase()),
      )
      const paged = filtered.slice((page - 1) * pageSize, page * pageSize)
      return ok({
        items: paged.map(mapFileRow),
        pagination: {
          page,
          pageSize,
          total: filtered.length,
          totalPages: Math.ceil(filtered.length / pageSize) || 1,
          hasNext: page * pageSize < filtered.length,
          hasPrev: page > 1,
        },
      })
    } catch (e) {
      return fail('FILES_SEARCH_FAILED', (e as Error).message)
    }
  })

  // ── Folders ──

  ipcMain.handle('folders:list', async (_event, request) => {
    try {
      const folders = state.getFolders()
      return ok(
        folders.map((f) => ({
          folderId: f.id,
          folderName: f.lguplus_folder_name,
          parentFolderId: null,
          fileCount: f.files_synced,
          syncEnabled: f.enabled,
          lastSyncAt: f.last_synced_at ?? undefined,
        })),
      )
    } catch (e) {
      return fail('FOLDERS_LIST_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('folders:tree', async () => {
    try {
      const folders = state.getFolders()
      const tree = folders.map((f) => ({
        folderId: f.id,
        folderName: f.lguplus_folder_name,
        parentFolderId: null,
        fileCount: f.files_synced,
        syncEnabled: f.enabled,
        lastSyncAt: f.last_synced_at ?? undefined,
        children: [],
        depth: 0,
      }))
      return ok(tree)
    } catch (e) {
      return fail('FOLDERS_TREE_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('folders:toggle', async (_event, request) => {
    try {
      state.updateFolder(request.folderId, { enabled: request.enabled })
      return ok(undefined)
    } catch (e) {
      return fail('FOLDERS_TOGGLE_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('folders:discover', async () => {
    try {
      const result = await folderDiscovery.discoverFolders()
      return ok(result)
    } catch (e) {
      return fail('FOLDERS_DISCOVER_FAILED', (e as Error).message)
    }
  })

  // ── Migration ──

  ipcMain.handle('migration:scan', async () => {
    try {
      // First discover folders
      await folderDiscovery.discoverFolders()

      // Then get file counts for each folder
      const folders = state.getFolders()
      const result = await Promise.all(
        folders.map(async (f) => {
          let fileCount = 0
          try {
            const files = await lguplus.getFileList(Number(f.lguplus_folder_id))
            fileCount = files.total
          } catch {
            // silently fail
          }
          const syncedFiles = state.getFilesByFolder(f.id, { status: 'completed' })
          return {
            id: f.id,
            lguplusFolderId: f.lguplus_folder_id,
            folderName: f.lguplus_folder_name,
            fileCount,
            syncedCount: syncedFiles.length,
          }
        }),
      )
      return ok(result)
    } catch (e) {
      return fail('MIGRATION_SCAN_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('migration:start', async (_event, request) => {
    try {
      const start = Date.now()

      // Discover folders first
      const discovery = await folderDiscovery.discoverFolders()

      // Run full sync on selected folders
      const syncResult = await engine.fullSync({
        folderIds: request.folderIds,
        forceRescan: request.forceRescan,
      })

      return ok({
        scannedFolders: discovery.total,
        newFolders: discovery.newFolders,
        scannedFiles: syncResult.scannedFiles,
        syncedFiles: syncResult.syncedFiles,
        failedFiles: syncResult.failedFiles,
        durationMs: Date.now() - start,
      })
    } catch (e) {
      return fail('MIGRATION_START_FAILED', (e as Error).message)
    }
  })

  // ── Logs ──

  ipcMain.handle('logs:list', async (_event, request) => {
    try {
      const { level, search, dateFrom, dateTo, page = 1, pageSize = 100 } = request ?? {}
      const logs = state.getLogs({
        level,
        search,
        from: dateFrom,
        to: dateTo,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      const items = logs.map((l) => ({
        id: l.id,
        level: l.level as 'debug' | 'info' | 'warn' | 'error',
        message: l.message,
        category: l.category,
        timestamp: l.created_at,
        details: l.context ? JSON.parse(l.context) : undefined,
        stackTrace: l.stack_trace ?? undefined,
      }))
      return ok({
        items,
        pagination: {
          page,
          pageSize,
          total: items.length,
          totalPages: Math.ceil(items.length / pageSize) || 1,
          hasNext: items.length === pageSize,
          hasPrev: page > 1,
        },
      })
    } catch (e) {
      return fail('LOGS_LIST_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('logs:export', async (_event, request) => {
    try {
      const result = await exportLogs(
        (query) => state.getLogs(query),
        request,
      )
      return ok(result)
    } catch (e) {
      return fail('LOGS_EXPORT_FAILED', (e as Error).message)
    }
  })

  // ── Stats ──

  ipcMain.handle('stats:summary', async (_event, request) => {
    try {
      const period = request?.period ?? 'today'
      const now = new Date()
      let from: string
      const to = now.toISOString().slice(0, 10)

      if (period === 'week') {
        const weekAgo = new Date(now)
        weekAgo.setDate(weekAgo.getDate() - 7)
        from = weekAgo.toISOString().slice(0, 10)
      } else if (period === 'month') {
        const monthAgo = new Date(now)
        monthAgo.setMonth(monthAgo.getMonth() - 1)
        from = monthAgo.toISOString().slice(0, 10)
      } else {
        from = to
      }

      const stats = state.getDailyStats(from, to)
      const totalFiles = stats.reduce((a, s) => a + s.success_count + s.failed_count, 0)
      const successFiles = stats.reduce((a, s) => a + s.success_count, 0)
      const failedFiles = stats.reduce((a, s) => a + s.failed_count, 0)
      const totalBytes = stats.reduce((a, s) => a + s.total_bytes, 0)

      return ok({
        period: `${from} ~ ${to}`,
        totalFiles,
        successFiles,
        failedFiles,
        totalBytes,
        averageSpeedBps: 0,
        byFolder: [],
      })
    } catch (e) {
      return fail('STATS_SUMMARY_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('stats:chart', async (_event, request) => {
    try {
      const stats = state.getDailyStats(request.dateFrom, request.dateTo)
      return ok({
        labels: stats.map((s) => s.date),
        datasets: [
          { label: 'Success', data: stats.map((s) => s.success_count), color: '#22c55e' },
          { label: 'Failed', data: stats.map((s) => s.failed_count), color: '#ef4444' },
          { label: 'Bytes', data: stats.map((s) => s.total_bytes), color: '#3b82f6' },
        ],
      })
    } catch (e) {
      return fail('STATS_CHART_FAILED', (e as Error).message)
    }
  })

  // ── Settings ──

  ipcMain.handle('settings:get', async () => {
    try {
      const all = config.getAll()
      return ok(all)
    } catch (e) {
      return fail('SETTINGS_GET_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('settings:update', async (_event, request) => {
    try {
      const validSections = ['lguplus', 'webhard', 'sync', 'notification', 'system'] as const
      for (const section of validSections) {
        const value = request[section]
        if (value && typeof value === 'object') {
          config.set(section, value)
        }
      }
      return ok(config.getAll())
    } catch (e) {
      return fail('SETTINGS_UPDATE_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('settings:test-connection', async (_event, request) => {
    try {
      if (request.target === 'lguplus') {
        const start = Date.now()
        const result = await lguplus.login(request.username ?? '', request.password ?? '')
        return ok({
          success: result.success,
          latencyMs: Date.now() - start,
          message: result.success ? 'Connected' : 'Login failed',
        })
      } else {
        const start = Date.now()
        const result = await services.uploader.testConnection()
        return ok({
          success: result.success,
          latencyMs: Date.now() - start,
          message: result.message,
        })
      }
    } catch (e) {
      return fail('CONNECTION_TEST_FAILED', (e as Error).message)
    }
  })

  // ── Auth ──

  ipcMain.handle('auth:login', async (_event, request) => {
    try {
      const result = await lguplus.login(request.username, request.password)
      if (request.saveCredentials && result.success) {
        config.set('lguplus', { username: request.username, password: request.password })
      }
      return ok({
        authenticated: result.success,
        username: request.username,
        sessionValid: result.success,
        lastLoginAt: new Date().toISOString(),
      })
    } catch (e) {
      return fail('AUTH_LOGIN_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('auth:logout', async () => {
    try {
      await lguplus.logout()
      return ok(undefined)
    } catch (e) {
      return fail('AUTH_LOGOUT_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('auth:status', async () => {
    try {
      return ok({
        authenticated: lguplus.isAuthenticated(),
        sessionValid: lguplus.isAuthenticated(),
      })
    } catch (e) {
      return fail('AUTH_STATUS_FAILED', (e as Error).message)
    }
  })

  // ── Failed / DLQ ──

  ipcMain.handle('failed:list', async (_event, request) => {
    try {
      const { page = 1, pageSize = 50 } = request ?? {}
      const items = state.getDlqItems()
      const paged = items.slice((page - 1) * pageSize, page * pageSize)
      return ok({
        items: paged.map((d) => ({
          id: String(d.id),
          fileName: d.file_name,
          folderPath: d.file_path,
          fileSize: 0,
          errorCode: d.error_code ?? 'UNKNOWN',
          errorMessage: d.failure_reason,
          failedAt: d.created_at,
          retryCount: d.retry_count,
          canRetry: d.can_retry,
        })),
        pagination: {
          page,
          pageSize,
          total: items.length,
          totalPages: Math.ceil(items.length / pageSize) || 1,
          hasNext: page * pageSize < items.length,
          hasPrev: page > 1,
        },
      })
    } catch (e) {
      return fail('FAILED_LIST_FAILED', (e as Error).message)
    }
  })

  // ── Notifications ──

  ipcMain.handle('notification:getAll', async () => {
    try {
      const items = notification.getNotifications()
      return ok(
        items.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          read: n.read,
          createdAt: n.createdAt,
        })),
      )
    } catch (e) {
      return fail('NOTIFICATION_GET_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('notification:read', async (_event, request) => {
    try {
      notification.markRead(request.id)
      return ok(undefined)
    } catch (e) {
      return fail('NOTIFICATION_READ_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('notification:readAll', async () => {
    try {
      notification.markAllRead()
      return ok(undefined)
    } catch (e) {
      return fail('NOTIFICATION_READALL_FAILED', (e as Error).message)
    }
  })
}

// ── EventBus → Renderer bridge ──

export function bridgeEventsToRenderer(
  services: CoreServices,
  getWindow: () => BrowserWindow | null,
): () => void {
  const { eventBus } = services

  function send<K extends keyof IpcEventMap>(channel: K, data: IpcEventMap[K]): void {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }

  const handlers = {
    'engine:status': (data: { prev: string; next: string }) => {
      send('sync:status-changed', {
        previousStatus: data.prev as any,
        currentStatus: data.next as any,
        timestamp: new Date().toISOString(),
      })
    },
    'sync:progress': (data: { fileId: string; fileName: string; progress: number; speedBps: number }) => {
      send('sync:progress', {
        phase: 'downloading',
        currentFile: data.fileName,
        completedFiles: 0,
        totalFiles: 0,
        completedBytes: 0,
        totalBytes: 0,
        speedBps: data.speedBps,
        estimatedRemainingMs: 0,
      })
    },
    'sync:completed': (data: { totalFiles: number; totalBytes: number; durationMs: number }) => {
      send('sync:progress', {
        phase: 'uploading',
        completedFiles: data.totalFiles,
        totalFiles: data.totalFiles,
        completedBytes: data.totalBytes,
        totalBytes: data.totalBytes,
        speedBps: data.totalBytes / (data.durationMs / 1000),
        estimatedRemainingMs: 0,
      })
    },
    'sync:failed': (data: { error: any; fileId?: string }) => {
      send('sync:file-failed', {
        fileId: data.fileId ?? '',
        fileName: '',
        error: data.error?.message ?? 'Unknown error',
        errorCode: data.error?.code ?? 'UNKNOWN',
        retryCount: 0,
        willRetry: data.error?.retryable ?? false,
      })
    },
    'detection:found': (data: { files: any[]; strategy: string }) => {
      send('detection:new-files', {
        files: data.files.map((f) => ({
          fileName: f.fileName,
          folderPath: f.filePath,
          fileSize: f.fileSize,
          detectedAt: new Date().toISOString(),
        })),
        source: data.strategy as 'polling' | 'snapshot',
      })
    },
    'session:expired': (data: { reason: string }) => {
      send('auth:expired', {
        service: 'lguplus',
        reason: data.reason,
        autoReloginAttempted: false,
        requiresManualAction: true,
      })
    },
  } as const

  // Register handlers
  for (const [event, handler] of Object.entries(handlers)) {
    eventBus.on(event as any, handler as any)
  }

  // Return cleanup function
  return () => {
    for (const [event, handler] of Object.entries(handlers)) {
      eventBus.off(event as any, handler as any)
    }
  }
}

// ── Helpers ──

function buildSyncStatus(services: CoreServices) {
  const { engine, state, lguplus } = services
  const today = new Date().toISOString().slice(0, 10)
  const stats = state.getDailyStats(today, today)
  const todayStats = stats[0]

  return {
    state: engine.status,
    lguplus: {
      connected: lguplus.isAuthenticated(),
      sessionValid: lguplus.isAuthenticated(),
    },
    webhard: {
      connected: true,
    },
    today: {
      totalFiles: todayStats ? todayStats.success_count + todayStats.failed_count : 0,
      successFiles: todayStats?.success_count ?? 0,
      failedFiles: todayStats?.failed_count ?? 0,
      totalBytes: todayStats?.total_bytes ?? 0,
    },
    recentFiles: [],
    failedCount: state.getDlqItems().length,
    lastUpdatedAt: new Date().toISOString(),
  }
}

function mapFileRow(f: any) {
  return {
    id: f.id,
    fileName: f.file_name,
    folderPath: f.file_path,
    fileSize: f.file_size,
    status: f.status,
    syncedAt: f.upload_completed_at ?? undefined,
    error: f.last_error ?? undefined,
  }
}

export function removeAllIpcHandlers(): void {
  const channels = [
    'sync:start', 'sync:stop', 'sync:pause', 'sync:resume', 'sync:status',
    'sync:full-sync', 'sync:retry-failed',
    'files:list', 'files:detail', 'files:search',
    'folders:list', 'folders:tree', 'folders:toggle', 'folders:discover',
    'migration:scan', 'migration:start',
    'logs:list', 'logs:export',
    'stats:summary', 'stats:chart',
    'settings:get', 'settings:update', 'settings:test-connection',
    'auth:login', 'auth:logout', 'auth:status',
    'failed:list',
    'notification:getAll', 'notification:read', 'notification:readAll',
  ]
  for (const ch of channels) {
    ipcMain.removeHandler(ch)
  }
}
