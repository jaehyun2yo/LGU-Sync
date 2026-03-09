import { BrowserWindow, ipcMain, shell } from 'electron'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CoreServices } from '../core/container'
import type { ApiResponse, IpcEventMap, MigrationFolderInfo, RealtimeTestStartRequest, RealtimeTestEvent } from '../shared/ipc-types'
import type { ILGUplusClient, LGUplusFolderItem, LGUplusFileItem } from '../core/types/lguplus-client.types'
import type { LogRow, LogQuery, SyncFolderRow } from '../core/db/types'

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

/** Process items with a concurrency limit to avoid overwhelming the server */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let index = 0

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

async function buildSubFolderTree(
  lguplusFolderId: number,
  lguplusClient: ILGUplusClient,
  depth: number = 0,
  maxDepth: number = 5,
): Promise<MigrationFolderInfo[]> {
  if (depth >= maxDepth) return []
  let subFolders: LGUplusFolderItem[]
  try {
    subFolders = await lguplusClient.getSubFolders(lguplusFolderId)
  } catch {
    return []
  }
  const results = await mapWithConcurrency(subFolders, 3, async (sf) => {
    let fileCount = 0
    let totalSize = 0
    try {
      const files = await lguplusClient.getAllFiles(sf.folderId)
      const nonFolders = files.filter((f) => !f.isFolder)
      fileCount = nonFolders.length
      totalSize = nonFolders.reduce((sum, f) => sum + f.itemSize, 0)
    } catch {
      // fileCount and totalSize stay 0
    }
    const children = await buildSubFolderTree(sf.folderId, lguplusClient, depth + 1, maxDepth)
    return {
      id: String(sf.folderId),
      lguplusFolderId: String(sf.folderId),
      folderName: sf.folderName,
      fileCount,
      syncedCount: 0,
      totalSize,
      children,
    }
  })
  return results
    .filter((r): r is PromiseFulfilledResult<MigrationFolderInfo> => r.status === 'fulfilled')
    .map((r) => r.value)
}

async function collectAllFolderPaths(
  rootFolderId: number,
  lguplusClient: ILGUplusClient,
  basePath: string = '',
  maxDepth: number = 10,
): Promise<string[]> {
  const paths: string[] = []
  async function recurse(folderId: number, currentPath: string, depth: number): Promise<void> {
    if (depth >= maxDepth) return
    let subFolders: LGUplusFolderItem[]
    try {
      subFolders = await lguplusClient.getSubFolders(folderId)
    } catch {
      return
    }
    for (const sf of subFolders) {
      const folderPath = currentPath ? `${currentPath}/${sf.folderName}` : sf.folderName
      paths.push(folderPath)
      await recurse(sf.folderId, folderPath, depth + 1)
    }
  }
  await recurse(rootFolderId, basePath, 0)
  return paths
}

export function registerIpcHandlers(services: CoreServices): void {
  const { engine, state, config, lguplus, retry, notification, folderDiscovery, folderCache, detector } = services

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
            totalSize: 0,
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
      const queryParams = { level, search, from: dateFrom, to: dateTo }
      const logs = state.getLogs({
        ...queryParams,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      const total = state.getLogCount(queryParams)
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
          total,
          totalPages: Math.ceil(total / pageSize) || 1,
          hasNext: page * pageSize < total,
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

  // ── Test ──

  ipcMain.handle('test:scan-folders', async (_event, request) => {
    try {
      const forceRefresh = request?.forceRefresh ?? false

      // Check cache (unless forceRefresh)
      if (!forceRefresh) {
        const cached = folderCache.getScanResult()
        if (cached) {
          return ok({ folders: cached.data, cachedAt: cached.cachedAt })
        }
      }

      // Keep DB up-to-date
      await folderDiscovery.discoverFolders()

      // Build full tree from HOME root
      const homeId = await lguplus.getGuestFolderRootId()
      if (!homeId) return fail('TEST_SCAN_FAILED', 'HOME folder not found')

      const rootFolders = await lguplus.getSubFolders(homeId)
      const settled = await mapWithConcurrency(rootFolders, 3, async (rf) => {
        let fileCount = 0
        let totalSize = 0
        let children: MigrationFolderInfo[] = []
        try {
          const files = await lguplus.getAllFiles(rf.folderId)
          const nonFolders = files.filter((file) => !file.isFolder)
          fileCount = nonFolders.length
          totalSize = nonFolders.reduce((sum, f) => sum + f.itemSize, 0)
          children = await buildSubFolderTree(rf.folderId, lguplus)
        } catch {
          // silently fail
        }

        // Try to match with DB folder for syncedCount
        const dbFolder = state.getFolderByLguplusId(String(rf.folderId))
        const syncedCount = dbFolder
          ? state.getFilesByFolder(dbFolder.id, { status: 'completed' }).length
          : 0

        return {
          id: dbFolder?.id ?? `lguplus:${rf.folderId}`,
          lguplusFolderId: String(rf.folderId),
          folderName: rf.folderName,
          fileCount,
          syncedCount,
          totalSize,
          children,
        }
      })
      const result = settled
        .filter((r): r is PromiseFulfilledResult<MigrationFolderInfo> => r.status === 'fulfilled')
        .map((r) => r.value)

      // Save to cache
      folderCache.setScanResult(result)

      return ok({ folders: result, cachedAt: null })
    } catch (e) {
      return fail('TEST_SCAN_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('test:download-only', async (_event, request) => {
    try {
      const start = Date.now()
      const results: Array<{
        fileId: string; fileName: string; success: boolean
        error?: string; downloadPath?: string; fileSize: number
      }> = []
      let downloadedFiles = 0
      let failedFiles = 0
      let scannedFiles = 0

      const sendProgress = (data: {
        currentFile: string; completedFiles: number; totalFiles: number; phase: string; error?: string
      }): void => {
        _event.sender.send('test:progress', {
          testType: 'download' as const,
          ...data,
        })
      }

      // Resolve target folders: support both DB UUIDs and lguplus: prefix IDs
      interface TargetFolder {
        id: string
        lguplusFolderId: number
        folderName: string
        isDbFolder: boolean
        dbFolderId?: string // DB UUID for engine.downloadOnly
      }
      const targetFolders: TargetFolder[] = []

      if (request.folderIds) {
        for (const fid of request.folderIds) {
          if (fid.startsWith('lguplus:')) {
            const lguplusId = Number(fid.slice('lguplus:'.length))
            // Try to find matching DB folder
            const dbFolder = state.getFolderByLguplusId(String(lguplusId))
            // Need folder name - get from parent subfolders
            const homeId = await lguplus.getGuestFolderRootId()
            let folderName = `folder_${lguplusId}`
            if (homeId) {
              const rootFolders = await lguplus.getSubFolders(homeId)
              const match = rootFolders.find((rf) => rf.folderId === lguplusId)
              if (match) folderName = match.folderName
            }
            targetFolders.push({
              id: fid,
              lguplusFolderId: lguplusId,
              folderName,
              isDbFolder: !!dbFolder,
              dbFolderId: dbFolder?.id,
            })
          } else {
            const folder = state.getFolder(fid)
            if (folder) {
              targetFolders.push({
                id: fid,
                lguplusFolderId: Number(folder.lguplus_folder_id),
                folderName: folder.lguplus_folder_name,
                isDbFolder: true,
                dbFolderId: fid,
              })
            }
          }
        }
      } else {
        const folders = state.getFolders(true)
        for (const f of folders) {
          targetFolders.push({
            id: f.id,
            lguplusFolderId: Number(f.lguplus_folder_id),
            folderName: f.lguplus_folder_name,
            isDbFolder: true,
            dbFolderId: f.id,
          })
        }
      }

      for (const folder of targetFolders) {
        // Auto-register non-DB folder before processing files
        if (!folder.isDbFolder) {
          const existingFolder = state.getFolderByLguplusId(String(folder.lguplusFolderId))
          if (existingFolder) {
            folder.isDbFolder = true
            folder.dbFolderId = existingFolder.id
          } else {
            const dbFolderId = state.saveFolder({
              lguplus_folder_id: String(folder.lguplusFolderId),
              lguplus_folder_name: folder.folderName,
              auto_detected: true,
            })
            folder.isDbFolder = true
            folder.dbFolderId = dbFolderId
          }
        }

        sendProgress({
          currentFile: folder.folderName,
          completedFiles: downloadedFiles,
          totalFiles: scannedFiles,
          phase: 'scanning',
        })

        // Create empty folder structure locally (use configured download path)
        const tempPath = config.get('system').tempDownloadPath
        const folderBasePath = join(tempPath, folder.folderName)
        await mkdir(folderBasePath, { recursive: true })

        const subPaths = await collectAllFolderPaths(
          folder.lguplusFolderId,
          lguplus,
          folder.folderName,
        )
        for (const subPath of subPaths) {
          await mkdir(join(tempPath, subPath), { recursive: true })
        }

        // Scan and download files
        let files: LGUplusFileItem[]
        try {
          files = await lguplus.getAllFilesDeep(folder.lguplusFolderId)
        } catch {
          sendProgress({
            currentFile: folder.folderName,
            completedFiles: downloadedFiles + failedFiles,
            totalFiles: scannedFiles,
            phase: 'scanning',
            error: `Failed to scan folder: ${folder.folderName}`,
          })
          continue
        }
        scannedFiles += files.length

        for (const file of files) {
          sendProgress({
            currentFile: file.itemName,
            completedFiles: downloadedFiles + failedFiles,
            totalFiles: scannedFiles,
            phase: 'downloading',
          })

          // All folders are now DB-registered (auto-registered above if needed)
          const existing = state.getFileByHistoryNo(file.itemId)
          if (existing && existing.status === 'completed' && !request.forceRescan) {
            continue
          }

          const fileId = state.saveFile({
            folder_id: folder.dbFolderId!,
            file_name: file.itemName,
            file_path: `/${folder.folderName}/${file.relativePath ? `${file.relativePath}/` : ''}${file.itemName}`,
            file_size: file.itemSize,
            file_extension: file.itemExtension,
            lguplus_file_id: String(file.itemId),
            detected_at: new Date().toISOString(),
          })

          const dlResult = await engine.downloadOnly(fileId)
          const savedFile = state.getFile(fileId)
          results.push({
            fileId,
            fileName: file.itemName,
            success: dlResult.success,
            error: dlResult.error,
            downloadPath: savedFile?.download_path ?? undefined,
            fileSize: file.itemSize,
          })

          if (dlResult.success) downloadedFiles++
          else failedFiles++
        }
      }

      sendProgress({
        currentFile: '',
        completedFiles: downloadedFiles + failedFiles,
        totalFiles: scannedFiles,
        phase: 'downloading',
      })

      return ok({
        scannedFiles,
        downloadedFiles,
        failedFiles,
        durationMs: Date.now() - start,
        results,
      })
    } catch (e) {
      return fail('TEST_DOWNLOAD_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('test:upload-only', async (_event, request) => {
    try {
      const start = Date.now()
      const results: Array<{
        fileId: string; fileName: string; success: boolean; error?: string
      }> = []
      let uploadedFiles = 0
      let failedFiles = 0

      const sendProgress = (data: {
        currentFile: string; completedFiles: number; totalFiles: number; phase: string; error?: string
      }): void => {
        _event.sender.send('test:progress', {
          testType: 'upload' as const,
          ...data,
        })
      }

      // Resolve target folders: support both DB UUIDs and lguplus: prefix IDs
      const dbFolderIds: string[] = []

      if (request.folderIds) {
        for (const fid of request.folderIds) {
          if (fid.startsWith('lguplus:')) {
            const lguplusId = fid.slice('lguplus:'.length)
            const dbFolder = state.getFolderByLguplusId(lguplusId)
            if (dbFolder) dbFolderIds.push(dbFolder.id)
          } else {
            if (state.getFolder(fid)) dbFolderIds.push(fid)
          }
        }
      } else {
        const folders = state.getFolders(true)
        for (const f of folders) dbFolderIds.push(f.id)
      }

      // Collect all downloaded files across target folders
      const filesToUpload: Array<{ id: string; file_name: string }> = []
      for (const folderId of dbFolderIds) {
        const downloadedFilesList = state.getFilesByFolder(folderId, { status: 'downloaded' as any })
        for (const file of downloadedFilesList) {
          filesToUpload.push({ id: file.id, file_name: file.file_name })
        }
      }

      if (filesToUpload.length === 0) {
        if (dbFolderIds.length === 0) {
          return fail('NO_UPLOAD_TARGET', '업로드 가능한 폴더가 없습니다. 선택한 폴더가 DB에 등록되지 않았습니다.')
        }
        return fail('NO_DOWNLOADED_FILES', '업로드할 파일이 없습니다. 다운로드 테스트를 먼저 실행해주세요.')
      }

      const totalFiles = filesToUpload.length

      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i]

        sendProgress({
          currentFile: file.file_name,
          completedFiles: i,
          totalFiles,
          phase: 'uploading',
        })

        const ulResult = await engine.uploadOnly(file.id)
        results.push({
          fileId: file.id,
          fileName: file.file_name,
          success: ulResult.success,
          error: ulResult.error,
        })

        if (ulResult.success) uploadedFiles++
        else failedFiles++
      }

      sendProgress({
        currentFile: '',
        completedFiles: uploadedFiles + failedFiles,
        totalFiles,
        phase: 'uploading',
      })

      return ok({
        uploadedFiles,
        failedFiles,
        durationMs: Date.now() - start,
        results,
      })
    } catch (e) {
      return fail('TEST_UPLOAD_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('test:full-sync', async (_event, request) => {
    try {
      const start = Date.now()
      const results: Array<{
        fileId: string; fileName: string
        downloadSuccess: boolean; uploadSuccess: boolean; error?: string
      }> = []
      let scannedFiles = 0
      let newFiles = 0
      let syncedFiles = 0
      let failedFiles = 0

      let targetFolders: SyncFolderRow[]

      if (request.folderIds) {
        targetFolders = []
        for (const fid of request.folderIds) {
          if (fid.startsWith('lguplus:')) {
            const lguplusId = fid.slice('lguplus:'.length)
            let dbFolder = state.getFolderByLguplusId(lguplusId)
            if (!dbFolder) {
              // Auto-register non-DB folder
              const homeId = await lguplus.getGuestFolderRootId()
              let folderName = `folder_${lguplusId}`
              if (homeId) {
                const rootFolders = await lguplus.getSubFolders(homeId)
                const match = rootFolders.find((rf) => rf.folderId === Number(lguplusId))
                if (match) folderName = match.folderName
              }
              const newId = state.saveFolder({
                lguplus_folder_id: lguplusId,
                lguplus_folder_name: folderName,
                auto_detected: true,
              })
              dbFolder = state.getFolder(newId)
            }
            if (dbFolder) targetFolders.push(dbFolder)
          } else {
            const folder = state.getFolder(fid)
            if (folder) targetFolders.push(folder)
          }
        }
      } else {
        targetFolders = state.getFolders(true)
      }

      for (const folder of targetFolders) {
        let files: LGUplusFileItem[]
        try {
          files = await lguplus.getAllFilesDeep(Number(folder.lguplus_folder_id))
        } catch {
          failedFiles++
          continue
        }
        scannedFiles += files.length

        for (const file of files) {
          const existing = state.getFileByHistoryNo(file.itemId)
          if (existing && existing.status === 'completed' && !request.forceRescan) {
            continue
          }

          newFiles++

          const fileId = state.saveFile({
            folder_id: folder.id,
            file_name: file.itemName,
            file_path: `/${folder.lguplus_folder_name}/${file.relativePath ? `${file.relativePath}/` : ''}${file.itemName}`,
            file_size: file.itemSize,
            file_extension: file.itemExtension,
            lguplus_file_id: String(file.itemId),
            detected_at: new Date().toISOString(),
          })

          const dlResult = await engine.downloadOnly(fileId)
          if (!dlResult.success) {
            failedFiles++
            results.push({
              fileId, fileName: file.itemName,
              downloadSuccess: false, uploadSuccess: false, error: dlResult.error,
            })
            continue
          }

          const ulResult = await engine.uploadOnly(fileId)
          if (ulResult.success) {
            syncedFiles++
          } else {
            failedFiles++
          }
          results.push({
            fileId, fileName: file.itemName,
            downloadSuccess: true, uploadSuccess: ulResult.success,
            error: ulResult.error,
          })
        }
      }

      return ok({
        scannedFiles,
        newFiles,
        syncedFiles,
        failedFiles,
        durationMs: Date.now() - start,
        results,
      })
    } catch (e) {
      return fail('TEST_FULL_SYNC_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('test:open-download-folder', async () => {
    try {
      const downloadPath = config.get('system').tempDownloadPath
      await mkdir(downloadPath, { recursive: true })
      await shell.openPath(downloadPath)
      return ok(undefined)
    } catch (e) {
      return fail('TEST_OPEN_FOLDER_FAILED', (e as Error).message)
    }
  })

  // ── Realtime detection test ──

  let realtimeTestTimer: ReturnType<typeof setInterval> | null = null
  let realtimeTestRunning = false

  ipcMain.handle('test:realtime-start', async (_event, request: RealtimeTestStartRequest) => {
    try {
      if (realtimeTestRunning) {
        return fail('REALTIME_ALREADY_RUNNING', '실시간 감지가 이미 실행 중입니다.')
      }
      realtimeTestRunning = true
      const intervalMs = request.pollingIntervalMs ?? 30000

      const sendEvent = (evt: RealtimeTestEvent): void => {
        _event.sender.send('test:realtime-event', evt)
      }

      sendEvent({
        type: 'started',
        message: `실시간 감지 시작 (주기: ${intervalMs / 1000}초)`,
        timestamp: new Date().toISOString(),
      })

      const poll = async (): Promise<void> => {
        if (!realtimeTestRunning) return

        sendEvent({
          type: 'detecting',
          message: '새 파일 감지 중...',
          timestamp: new Date().toISOString(),
        })

        try {
          const detected = await detector.forceCheck()
          if (detected.length === 0) return

          if (request.enableNotification) {
            const { Notification: ElectronNotification } = await import('electron')
            new ElectronNotification({
              title: '새 파일 감지됨',
              body: `${detected.length}개 파일이 감지되었습니다.`,
            }).show()

            notification.notify({
              type: 'info',
              title: '새 파일 감지',
              message: `${detected.length}개 파일이 감지되었습니다.`,
              groupKey: 'realtime-detection',
            })
          }

          for (const file of detected) {
            sendEvent({
              type: 'detected',
              message: `파일 감지: ${file.fileName}`,
              timestamp: new Date().toISOString(),
              fileName: file.fileName,
            })

            if (!request.enableDownload && !request.enableUpload) continue

            const dbFolder = state.getFolderByLguplusId(file.folderId)
            if (!dbFolder) continue

            const fileId = state.saveFile({
              folder_id: dbFolder.id,
              file_name: file.fileName,
              file_path: file.filePath,
              file_size: file.fileSize,
              file_extension: file.fileName.split('.').pop() ?? '',
              lguplus_file_id: String(file.historyNo),
              detected_at: new Date().toISOString(),
            })

            if (request.enableDownload) {
              sendEvent({
                type: 'downloading',
                message: `다운로드 중: ${file.fileName}`,
                timestamp: new Date().toISOString(),
                fileName: file.fileName,
              })

              const dlResult = await engine.downloadOnly(fileId)
              sendEvent({
                type: 'downloaded',
                message: dlResult.success
                  ? `다운로드 완료: ${file.fileName}`
                  : `다운로드 실패: ${file.fileName}`,
                timestamp: new Date().toISOString(),
                fileName: file.fileName,
                success: dlResult.success,
                error: dlResult.error,
              })

              if (!dlResult.success) continue
            }

            if (request.enableUpload) {
              sendEvent({
                type: 'uploading',
                message: `업로드 중: ${file.fileName}`,
                timestamp: new Date().toISOString(),
                fileName: file.fileName,
              })

              const ulResult = await engine.uploadOnly(fileId)
              sendEvent({
                type: 'uploaded',
                message: ulResult.success
                  ? `업로드 완료: ${file.fileName}`
                  : `업로드 실패: ${file.fileName}`,
                timestamp: new Date().toISOString(),
                fileName: file.fileName,
                success: ulResult.success,
                error: ulResult.error,
              })
            }
          }
        } catch (e) {
          sendEvent({
            type: 'error',
            message: `감지 오류: ${(e as Error).message}`,
            timestamp: new Date().toISOString(),
            error: (e as Error).message,
          })
        }
      }

      poll()
      realtimeTestTimer = setInterval(poll, intervalMs)

      return ok(undefined)
    } catch (e) {
      realtimeTestRunning = false
      return fail('REALTIME_START_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('test:realtime-stop', async () => {
    try {
      if (realtimeTestTimer) {
        clearInterval(realtimeTestTimer)
        realtimeTestTimer = null
      }
      realtimeTestRunning = false

      const [win] = BrowserWindow.getAllWindows()
      if (win && !win.isDestroyed()) {
        win.webContents.send('test:realtime-event', {
          type: 'stopped',
          message: '실시간 감지가 중지되었습니다.',
          timestamp: new Date().toISOString(),
        } satisfies RealtimeTestEvent)
      }

      return ok(undefined)
    } catch (e) {
      return fail('REALTIME_STOP_FAILED', (e as Error).message)
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
    'sync:progress': (data: { fileId: string; fileName: string; progress: number; speedBps: number; phase: string; fileSize: number }) => {
      send('sync:progress', {
        phase: (data.phase as 'downloading' | 'uploading') ?? 'downloading',
        fileId: data.fileId,
        currentFile: data.fileName,
        completedFiles: data.progress >= 100 ? 1 : 0,
        totalFiles: 1,
        completedBytes: Math.round((data.progress / 100) * data.fileSize),
        totalBytes: data.fileSize,
        speedBps: data.speedBps,
        estimatedRemainingMs: 0,
      })
    },
    'file:completed': (data: { fileId: string; fileName: string; fileSize: number; folderPath: string; durationMs: number }) => {
      send('sync:file-completed', {
        fileId: data.fileId,
        fileName: data.fileName,
        folderPath: data.folderPath,
        fileSize: data.fileSize,
        direction: 'upload',
        durationMs: data.durationMs,
      })
    },
    'sync:completed': (data: { totalFiles: number; totalBytes: number; durationMs: number }) => {
      send('sync:progress', {
        phase: 'uploading',
        completedFiles: data.totalFiles,
        totalFiles: data.totalFiles,
        completedBytes: data.totalBytes,
        totalBytes: data.totalBytes,
        speedBps: data.durationMs > 0 ? data.totalBytes / (data.durationMs / 1000) : 0,
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

  // Get recent completed files across all folders
  const folders = state.getFolders()
  const recentFiles: Array<{ id: string; fileName: string; folderPath: string; fileSize: number; status: string; syncedAt?: string }> = []
  for (const folder of folders) {
    const files = state.getFilesByFolder(folder.id, {
      status: 'completed',
      sortBy: 'updated_at',
      sortOrder: 'desc',
      limit: 5,
    })
    for (const f of files) {
      recentFiles.push({
        id: f.id,
        fileName: f.file_name,
        folderPath: f.file_path,
        fileSize: f.file_size,
        status: f.status,
        syncedAt: f.upload_completed_at ?? undefined,
      })
    }
    if (recentFiles.length >= 10) break
  }
  // Sort by syncedAt descending and take top 10
  recentFiles.sort((a, b) => (b.syncedAt ?? '').localeCompare(a.syncedAt ?? ''))
  const topRecentFiles = recentFiles.slice(0, 10)

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
    recentFiles: topRecentFiles,
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
    'test:scan-folders', 'test:download-only', 'test:upload-only', 'test:full-sync', 'test:open-download-folder', 'test:realtime-start', 'test:realtime-stop',
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
