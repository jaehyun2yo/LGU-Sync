import { BrowserWindow, ipcMain, shell, Notification } from 'electron'
import { writeFile, mkdir, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CoreServices } from '../core/container'
import type { ApiResponse, IpcEventMap, DetectionEventPush } from '../shared/ipc-types'
import type { LogRow, LogQuery } from '../core/db/types'
import type { EventMap } from '../core/types/events.types'
import type { SyncStatusType } from '../core/types/sync-status.types'

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

/** operCode를 한글 라벨로 변환 */
function getOperCodeLabel(code: string): string {
  switch (code) {
    case 'UP': return '파일 업로드'
    case 'D': return '파일 삭제'
    case 'MV': return '파일 이동'
    case 'RN': return '파일 이름변경'
    case 'CP': return '파일 복사'
    case 'FC': return '폴더 생성'
    case 'FD': return '폴더 삭제'
    case 'FMV': return '폴더 이동'
    case 'FRN': return '폴더 이름변경'
    case 'DN': return '파일 다운로드'
    default: return `알 수 없음(${code})`
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
  const { engine, state, config, lguplus, retry, notification } = services

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

  ipcMain.handle('sync:retry-failed', async (_event, _request) => {
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

  ipcMain.handle('sync:reset-circuit', async (_event, request) => {
    try {
      const { circuitName } = request
      retry.resetCircuit(circuitName)
      return ok(undefined)
    } catch (e) {
      return fail('RESET_CIRCUIT_FAILED', (e as Error).message)
    }
  })

  // ── Files ──

  ipcMain.handle('files:show-in-folder', async (_e, req: { filePath: string }) => {
    try {
      shell.showItemInFolder(req.filePath)
      return ok(undefined)
    } catch (e) {
      return fail('SHOW_IN_FOLDER_FAILED', (e as Error).message)
    }
  })

  // ── Folders ──

  ipcMain.handle('folders:list', async (_event, _request) => {
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
          message: result.success ? 'Connected' : (result.message || 'Login failed'),
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

  // ── Test ──

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

  ipcMain.handle('test:clear-downloads', async () => {
    try {
      // 동기화 중이면 거부
      if (engine.status === 'syncing') {
        return fail('ENGINE_RUNNING', '동기화가 진행 중입니다. 중지 후 다시 시도해주세요.')
      }

      const downloadPath = config.get('system').tempDownloadPath

      if (!existsSync(downloadPath)) {
        return ok({ deletedFiles: 0, deletedFolders: 0, resetRecords: 0 })
      }

      const entries = await readdir(downloadPath, { withFileTypes: true })
      let deletedFiles = 0
      let deletedFolders = 0

      for (const entry of entries) {
        const entryPath = join(downloadPath, entry.name)
        await rm(entryPath, { recursive: true, force: true })
        if (entry.isDirectory()) deletedFolders++
        else deletedFiles++
      }

      const resetRecords = state.resetDownloadedFiles()

      return ok({ deletedFiles, deletedFolders, resetRecords })
    } catch (e) {
      return fail('TEST_CLEAR_DOWNLOADS_FAILED', (e as Error).message)
    }
  })

  // ── Detection (실시간 감지 서비스) ──

  ipcMain.handle('detection:start', async (_event, request) => {
    try {
      const { source } = request
      await services.detectionService.start(source)
      return ok(undefined)
    } catch (e) {
      return fail('DETECTION_START_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('detection:stop', async () => {
    try {
      await services.detectionService.stop('manual')
      return ok(undefined)
    } catch (e) {
      return fail('DETECTION_STOP_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('detection:status', async () => {
    try {
      const detSvc = services.detectionService
      const stats = detSvc.getSessionStats()
      const sessionId = detSvc.currentSessionId

      // 현재 세션 정보 조회
      let currentSession: {
        filesDetected: number
        filesDownloaded: number
        filesFailed: number
        startedAt: string
        lastHistoryNo: number | null
      } | null = null

      if (sessionId) {
        const lastSession = state.getLastDetectionSession()
        currentSession = {
          filesDetected: stats.filesDetected,
          filesDownloaded: stats.filesDownloaded,
          filesFailed: stats.filesFailed,
          startedAt: lastSession?.started_at ?? new Date().toISOString(),
          lastHistoryNo: lastSession?.last_history_no ?? null,
        }
      }

      const autoStartEnabled = config.get('system').autoDetection

      return ok({
        status: detSvc.status,
        currentSessionId: sessionId,
        currentSession,
        lastPollAt: null, // TODO: expose from FileDetector if needed
        autoStartEnabled,
      })
    } catch (e) {
      return fail('DETECTION_STATUS_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('detection:sessions', async (_event, request) => {
    try {
      const { page = 1, pageSize = 20 } = request ?? {}
      const { items, total } = state.getDetectionSessions({ page, pageSize })
      return ok({
        items: items.map((s) => ({
          id: s.id,
          startedAt: s.started_at,
          stoppedAt: s.stopped_at,
          stopReason: s.stop_reason as 'manual' | 'crash' | 'app-quit' | 'error' | null,
          filesDetected: s.files_detected,
          filesDownloaded: s.files_downloaded,
          filesFailed: s.files_failed,
          lastHistoryNo: s.last_history_no,
        })),
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
      return fail('DETECTION_SESSIONS_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('detection:recover', async () => {
    try {
      const lastHistoryNoBefore = state.getCheckpoint('last_history_no')
      const fromHistoryNo = lastHistoryNoBefore ? parseInt(lastHistoryNoBefore, 10) : 0

      const result = await services.detectionService.recover()

      const lastHistoryNoAfter = state.getCheckpoint('last_history_no')
      const toHistoryNo = lastHistoryNoAfter ? parseInt(lastHistoryNoAfter, 10) : fromHistoryNo

      return ok({
        recoveredFiles: result.recoveredFiles,
        failedFiles: result.failedFiles,
        fromHistoryNo,
        toHistoryNo,
      })
    } catch (e) {
      return fail('DETECTION_RECOVER_FAILED', (e as Error).message)
    }
  })

  // ── Watch folders ──

  ipcMain.handle('detection:set-watch-folders', async (_event, request) => {
    try {
      const { folderIds } = request
      config.set('system', { watchFolderIds: folderIds })
      return ok(undefined)
    } catch (e) {
      return fail('SET_WATCH_FOLDERS_FAILED', (e as Error).message)
    }
  })

  ipcMain.handle('detection:get-watch-folders', async () => {
    try {
      const { watchFolderIds } = config.get('system')
      return ok({ folderIds: watchFolderIds })
    } catch (e) {
      return fail('GET_WATCH_FOLDERS_FAILED', (e as Error).message)
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

  /** DetectionService 통계를 가져오는 헬퍼 */
  function getDetectionStats(): DetectionEventPush['stats'] | undefined {
    const detSvc = services.detectionService
    if (detSvc.status === 'running' || detSvc.status === 'stopping') {
      const stats = detSvc.getSessionStats()
      return {
        filesDetected: stats.filesDetected,
        filesDownloaded: stats.filesDownloaded,
        filesFailed: stats.filesFailed,
      }
    }
    return undefined
  }

  const handlers = {
    'engine:status': (data: EventMap['engine:status']) => {
      send('sync:status-changed', {
        previousStatus: data.prev as unknown as SyncStatusType,
        currentStatus: data.next as unknown as SyncStatusType,
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
        direction: 'download',
        durationMs: data.durationMs,
      })

      // detection:event — 다운로드+업로드 완료
      send('detection:event', {
        type: 'downloaded',
        message: `다운로드 완료 (${(data.fileSize / 1024).toFixed(1)}KB, ${(data.durationMs / 1000).toFixed(1)}초)`,
        timestamp: new Date().toISOString(),
        fileName: data.fileName,
        filePath: data.folderPath,
        sessionId: services.detectionService.currentSessionId ?? undefined,
        stats: getDetectionStats(),
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
    'sync:failed': (data: EventMap['sync:failed']) => {
      // DB에서 실제 파일 정보 조회 (UUID 폴백 방지)
      const fileInfo = data.fileId ? services.state.getFile(data.fileId) : null
      const fileName = fileInfo?.file_name ?? data.error?.context?.fileName ?? ''
      const filePath = fileInfo?.file_path ?? data.error?.context?.filePath

      send('sync:file-failed', {
        fileId: data.fileId ?? '',
        fileName: fileName,
        error: data.error?.message ?? 'Unknown error',
        errorCode: data.error?.code ?? 'UNKNOWN',
        retryCount: 0,
        willRetry: data.error?.retryable ?? false,
      })

      // detection:event — 동기화 실패 (last_error에 이미 분류된 메시지가 있으면 우선 사용)
      const classifiedMsg = fileInfo?.last_error ?? data.error?.message ?? 'Unknown error'
      send('detection:event', {
        type: 'failed',
        message: classifiedMsg,
        timestamp: new Date().toISOString(),
        fileName: fileName,
        filePath: filePath,
        sessionId: services.detectionService.currentSessionId ?? undefined,
        stats: getDetectionStats(),
      })
    },
    'detection:found': (data: EventMap['detection:found']) => {
      send('detection:new-files', {
        files: data.files.map((f) => ({
          fileName: f.fileName,
          folderPath: f.filePath,
          fileSize: f.fileSize,
          detectedAt: new Date().toISOString(),
          operCode: f.operCode,
        })),
        source: data.strategy as 'polling' | 'snapshot',
      })

      // detection:event — 감지된 파일마다 개별 이벤트 전송
      const now = new Date().toISOString()
      for (const f of data.files) {
        send('detection:event', {
          type: 'detected',
          message: `${getOperCodeLabel(f.operCode)} 감지됨`,
          timestamp: now,
          fileName: f.fileName,
          filePath: f.filePath,
          operCode: f.operCode,
          sessionId: services.detectionService.currentSessionId ?? undefined,
          stats: getDetectionStats(),
        })
      }

      // OS 네이티브 알림: watchFolderIds에 해당하는 폴더의 파일만
      try {
        const watchFolderIds = services.config.get('system').watchFolderIds
        if (watchFolderIds.length > 0 && Notification.isSupported()) {
          // folderId별로 파일 그룹화
          const watchedFiles = data.files.filter((f) => watchFolderIds.includes(f.folderId))
          if (watchedFiles.length > 0) {
            const byFolder = new Map<string, { count: number; operCounts: Map<string, number> }>()
            for (const f of watchedFiles) {
              if (!byFolder.has(f.folderId)) {
                byFolder.set(f.folderId, { count: 0, operCounts: new Map() })
              }
              const group = byFolder.get(f.folderId)!
              group.count++
              group.operCounts.set(f.operCode, (group.operCounts.get(f.operCode) ?? 0) + 1)
            }

            for (const [folderId, group] of byFolder) {
              // 폴더명 조회
              const folder = services.state.getFolder(folderId)
                ?? services.state.getFolderByLguplusId(folderId)
              const folderName = folder?.lguplus_folder_name ?? folderId

              // operCode별 요약
              const operSummary = Array.from(group.operCounts.entries())
                .map(([code, cnt]) => `${getOperCodeLabel(code)} ${cnt}`)
                .join(', ')

              const notification = new Notification({
                title: `${folderName}: 파일 ${group.count}건 변동 감지`,
                body: operSummary,
                silent: false,
              })
              notification.show()
            }
          }
        }
      } catch {
        // OS 알림 실패 시 무시
      }
    },
    'detection:scan-progress': (data: { phase: 'polling' | 'paginating'; currentPage: number; totalPages: number; discoveredCount: number }) => {
      send('detection:scan-progress', {
        phase: data.phase,
        currentPage: data.currentPage,
        totalPages: data.totalPages,
        discoveredCount: data.discoveredCount,
      })
    },
    'detection:start-progress': (data: { step: string; message: string; current: number; total: number }) => {
      send('detection:start-progress', {
        step: data.step,
        message: data.message,
        current: data.current,
        total: data.total,
      })
    },
    'opercode:event': (data: { operCode: string; fileName: string; filePath: string; folderId: string; historyNo?: number; timestamp: string }) => {
      send('opercode:event', {
        operCode: data.operCode,
        fileName: data.fileName,
        filePath: data.filePath,
        folderId: data.folderId,
        historyNo: data.historyNo,
        timestamp: data.timestamp,
      })
    },
    'detection:status-change': (data: EventMap['detection:status-change']) => {
      send('detection:status-changed', {
        status: data.status,
        sessionId: data.sessionId,
      })

      // detection:event — 감지 서비스 상태 변경 로그
      const typeMap: Record<string, DetectionEventPush['type']> = {
        running: 'started',
        stopped: 'stopped',
        recovering: 'recovery',
      }
      const eventType = typeMap[data.status]
      if (eventType) {
        const messageMap: Record<string, string> = {
          started: '실시간 감지 시작',
          stopped: '실시간 감지 중지',
          recovery: '다운타임 복구 시작',
        }
        send('detection:event', {
          type: eventType,
          message: messageMap[eventType],
          timestamp: new Date().toISOString(),
          sessionId: data.sessionId ?? undefined,
          stats: getDetectionStats(),
        })
      }
    },
    'session:expired': (data: { reason: string }) => {
      send('auth:expired', {
        service: 'lguplus',
        reason: data.reason,
        autoReloginAttempted: false,
        requiresManualAction: true,
      })

      // detection:event — 세션 만료 에러
      send('detection:event', {
        type: 'error',
        message: `세션 만료: ${data.reason}`,
        timestamp: new Date().toISOString(),
        sessionId: services.detectionService.currentSessionId ?? undefined,
      })
    },
  }

  // Register handlers
  for (const [event, handler] of Object.entries(handlers)) {
    eventBus.on(event as keyof EventMap, handler as (data: EventMap[keyof EventMap]) => void)
  }

  // Return cleanup function
  return () => {
    for (const [event, handler] of Object.entries(handlers)) {
      eventBus.off(event as keyof EventMap, handler as (data: EventMap[keyof EventMap]) => void)
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
    circuits: services.retry.getAllCircuitStates(),
    lastUpdatedAt: new Date().toISOString(),
  }
}

export function removeAllIpcHandlers(): void {
  const channels = [
    'sync:start', 'sync:stop', 'sync:pause', 'sync:resume', 'sync:status',
    'sync:full-sync', 'sync:retry-failed', 'sync:reset-circuit',
    'files:show-in-folder',
    'folders:list',
    'test:open-download-folder', 'test:clear-downloads',
    'detection:start', 'detection:stop', 'detection:status', 'detection:sessions', 'detection:recover',
    'detection:set-watch-folders', 'detection:get-watch-folders',
    'logs:list', 'logs:export',
    'settings:get', 'settings:update', 'settings:test-connection',
    'notification:getAll', 'notification:read', 'notification:readAll',
  ]
  for (const ch of channels) {
    ipcMain.removeHandler(ch)
  }
}
