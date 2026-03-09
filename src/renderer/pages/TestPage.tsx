import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  FlaskConical,
  Search,
  Loader,
  Folder,
  Check,
  CheckSquare,
  Square,
  PlayCircle,
  CheckCircle2,
  XCircle,
  Download,
  Upload,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Radio,
  StopCircle,
  Bell,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useSort } from '../hooks/useSort'
import { SortableHeader } from '../components/SortableHeader'
import { useIpcEvent } from '../hooks/useIpcEvent'
import type {
  MigrationFolderInfo,
  TestDownloadResult,
  TestUploadResult,
  TestFullSyncResult,
  TestProgressEvent,
  RealtimeTestEvent,
} from '../../shared/ipc-types'

type TestTab = 'download' | 'upload' | 'full-sync' | 'realtime'
type TestState = 'idle' | 'scanning' | 'selecting' | 'testing' | 'complete'

interface FileResult {
  fileId: string
  fileName: string
  success: boolean
  error?: string
  downloadPath?: string
  fileSize?: number
  downloadSuccess?: boolean
  uploadSuccess?: boolean
}

interface TabState {
  state: TestState
  results: FileResult[]
  summary: { success: number; failed: number; durationMs: number } | null
  error: string | null
  progress: TestProgressEvent | null
}

const INITIAL_TAB_STATE: TabState = {
  state: 'idle',
  results: [],
  summary: null,
  error: null,
  progress: null,
}

const ALL_TABS: TestTab[] = ['download', 'upload', 'full-sync', 'realtime']

type FolderSortField = 'folderName' | 'fileCount' | 'syncedCount' | 'remaining' | 'totalSize'

const folderComparators: Record<FolderSortField, (a: MigrationFolderInfo, b: MigrationFolderInfo) => number> = {
  folderName: (a, b) => a.folderName.localeCompare(b.folderName, 'ko'),
  fileCount: (a, b) => a.fileCount - b.fileCount,
  syncedCount: (a, b) => a.syncedCount - b.syncedCount,
  remaining: (a, b) => (a.fileCount - a.syncedCount) - (b.fileCount - b.syncedCount),
  totalSize: (a, b) => a.totalSize - b.totalSize,
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

function formatTimeAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '방금 전'
  if (diffMin < 60) return `${diffMin}분 전`
  const diffHr = Math.floor(diffMin / 60)
  return `${diffHr}시간 ${diffMin % 60}분 전`
}

type ResultSortField = 'success' | 'fileName' | 'fileSize'

const resultComparators: Record<ResultSortField, (a: FileResult, b: FileResult) => number> = {
  success: (a, b) => Number(a.success) - Number(b.success),
  fileName: (a, b) => a.fileName.localeCompare(b.fileName, 'ko'),
  fileSize: (a, b) => (a.fileSize ?? 0) - (b.fileSize ?? 0),
}

const TAB_CONFIG: Record<TestTab, { label: string; icon: React.ComponentType<{ className?: string }>; description: string }> = {
  download: { label: '다운로드', icon: Download, description: 'LGU+ 외부웹하드에서 로컬로 파일을 다운로드합니다.' },
  upload: { label: '업로드', icon: Upload, description: '다운로드 완료된 파일을 자체웹하드로 업로드합니다.' },
  'full-sync': { label: '전체 동기화', icon: RefreshCw, description: '다운로드 + 업로드를 순차적으로 실행합니다.' },
  realtime: { label: '실시간 감지', icon: Radio, description: '새 파일 감지 시 자동으로 다운로드/업로드를 실행합니다.' },
}

// Collect all IDs from a folder tree (including descendants)
function collectAllIds(folders: MigrationFolderInfo[]): string[] {
  const ids: string[] = []
  for (const f of folders) {
    ids.push(f.id)
    if (f.children) ids.push(...collectAllIds(f.children))
  }
  return ids
}

// Collect descendant IDs (not including the folder itself)
function collectDescendantIds(folder: MigrationFolderInfo): string[] {
  const ids: string[] = []
  if (folder.children) {
    for (const child of folder.children) {
      ids.push(child.id)
      ids.push(...collectDescendantIds(child))
    }
  }
  return ids
}

// FolderTreeRow: recursive tree row component
function FolderTreeRow({
  folder,
  depth,
  selectedIds,
  expandedIds,
  onToggleSelect,
  onToggleExpand,
}: {
  folder: MigrationFolderInfo
  depth: number
  selectedIds: Set<string>
  expandedIds: Set<string>
  onToggleSelect: (id: string, descendantIds: string[]) => void
  onToggleExpand: (id: string) => void
}) {
  const isSelected = selectedIds.has(folder.id)
  const isExpanded = expandedIds.has(folder.id)
  const hasChildren = folder.children && folder.children.length > 0
  const remaining = folder.fileCount - folder.syncedCount

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-2.5 border-b border-border/50 transition-colors cursor-pointer',
          'hover:bg-accent/50',
          !isSelected && 'opacity-60',
        )}
        style={{ paddingLeft: `${depth * 16 + 16}px` }}
        onClick={() => onToggleSelect(folder.id, collectDescendantIds(folder))}
      >
        {/* Expand/collapse toggle */}
        <button
          type="button"
          className="shrink-0 w-4 h-4 flex items-center justify-center"
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) onToggleExpand(folder.id)
          }}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )
          ) : null}
        </button>

        {/* Checkbox */}
        <button
          type="button"
          className={cn(
            'shrink-0 h-5 w-5 rounded border-2 transition-colors flex items-center justify-center',
            isSelected ? 'bg-primary border-primary' : 'border-border hover:border-muted-foreground',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
        </button>

        <Folder className={cn('h-4 w-4 shrink-0', isSelected ? 'text-warning' : 'text-muted-foreground')} />
        <span className="flex-1 min-w-0 truncate text-sm font-medium">{folder.folderName}</span>
        <span className="shrink-0 w-20 text-xs text-muted-foreground text-right tabular-nums">
          {folder.fileCount.toLocaleString('ko-KR')}
        </span>
        <span className="shrink-0 w-20 text-xs text-muted-foreground text-right tabular-nums">
          {formatSize(folder.totalSize)}
        </span>
        <span className="shrink-0 w-20 text-xs text-success text-right tabular-nums">
          {folder.syncedCount.toLocaleString('ko-KR')}
        </span>
        <span className={cn('shrink-0 w-20 text-xs text-right tabular-nums', remaining > 0 ? 'text-warning' : 'text-muted-foreground')}>
          {remaining.toLocaleString('ko-KR')}
        </span>
      </div>
      {isExpanded && folder.children?.map((child) => (
        <FolderTreeRow
          key={child.id}
          folder={child}
          depth={depth + 1}
          selectedIds={selectedIds}
          expandedIds={expandedIds}
          onToggleSelect={onToggleSelect}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </>
  )
}

export function TestPage() {
  const [tab, setTab] = useState<TestTab>('download')
  const [folders, setFolders] = useState<MigrationFolderInfo[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [cachedAt, setCachedAt] = useState<number | null>(null)
  const [tabStates, setTabStates] = useState<Record<TestTab, TabState>>(
    () => Object.fromEntries(ALL_TABS.map((t) => [t, { ...INITIAL_TAB_STATE }])) as Record<TestTab, TabState>,
  )

  // Per-tab state accessors
  const currentTabState = tabStates[tab]
  const { state, results, summary, error, progress } = currentTabState

  const updateTabState = useCallback((targetTab: TestTab, patch: Partial<TabState>) => {
    setTabStates((prev) => ({ ...prev, [targetTab]: { ...prev[targetTab], ...patch } }))
  }, [])

  const {
    sorted: sortedFolders,
    sortField: folderSortField,
    sortOrder: folderSortOrder,
    handleSortChange: handleFolderSortChange,
  } = useSort(folders, 'folderName' as FolderSortField, 'asc', folderComparators)

  const {
    sorted: sortedResults,
    sortField: resultSortField,
    sortOrder: resultSortOrder,
    handleSortChange: handleResultSortChange,
  } = useSort(results, 'fileName' as ResultSortField, 'asc', resultComparators)

  // Realtime detection state
  const [realtimeRunning, setRealtimeRunning] = useState(false)
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeTestEvent[]>([])
  const [realtimeOptions, setRealtimeOptions] = useState({
    enableDownload: true,
    enableUpload: true,
    enableNotification: true,
  })

  // Listen for test progress events — route to the correct tab
  useIpcEvent('test:progress', useCallback((data: TestProgressEvent) => {
    const targetTab = data.testType === 'full-sync' ? 'full-sync' : data.testType as TestTab
    setTabStates((prev) => ({ ...prev, [targetTab]: { ...prev[targetTab], progress: data } }))
  }, []))

  // Listen for realtime detection events
  useIpcEvent('test:realtime-event', useCallback((data: RealtimeTestEvent) => {
    setRealtimeEvents((prev) => [data, ...prev].slice(0, 200))
    if (data.type === 'stopped') setRealtimeRunning(false)
  }, []))

  // Scan folders (with cache support)
  const handleScan = useCallback(async (forceRefresh = false) => {
    updateTabState(tab, { state: 'scanning', error: null, results: [], summary: null })
    try {
      const res = await window.electronAPI.invoke('test:scan-folders', { forceRefresh })
      if (res.success && res.data) {
        setFolders(res.data.folders)
        setCachedAt(res.data.cachedAt)
        const allIds = collectAllIds(res.data.folders)
        setSelectedIds(new Set(allIds))
        setExpandedIds(new Set())
        updateTabState(tab, { state: 'selecting' })
      } else {
        updateTabState(tab, { error: res.error?.message ?? '스캔 실패', state: 'idle' })
      }
    } catch {
      updateTabState(tab, { error: '폴더 스캔 중 오류가 발생했습니다', state: 'idle' })
    }
  }, [tab, updateTabState])

  // When switching tabs, if folders already loaded and tab is idle, jump to selecting
  useEffect(() => {
    if (folders.length > 0 && currentTabState.state === 'idle') {
      updateTabState(tab, { state: 'selecting' })
    }
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFolder = useCallback((id: string, descendantIds: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allIds = [id, ...descendantIds]
      if (next.has(id)) {
        for (const i of allIds) next.delete(i)
      } else {
        for (const i of allIds) next.add(i)
      }
      return next
    })
  }, [])

  const allFolderIds = useMemo(() => collectAllIds(folders), [folders])

  const toggleAll = useCallback(() => {
    if (selectedIds.size === allFolderIds.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allFolderIds))
    }
  }, [selectedIds.size, allFolderIds])

  // Run test
  const handleStart = useCallback(async () => {
    if (selectedIds.size === 0) return
    const runTab = tab
    updateTabState(runTab, { state: 'testing', error: null, results: [], summary: null, progress: null })

    const folderIds = Array.from(selectedIds)

    try {
      if (runTab === 'download') {
        const res = await window.electronAPI.invoke('test:download-only', { folderIds })
        if (res.success && res.data) {
          const data = res.data as TestDownloadResult
          updateTabState(runTab, {
            results: data.results.map((r) => ({
              fileId: r.fileId, fileName: r.fileName, success: r.success,
              error: r.error, downloadPath: r.downloadPath, fileSize: r.fileSize,
            })),
            summary: { success: data.downloadedFiles, failed: data.failedFiles, durationMs: data.durationMs },
            state: 'complete',
          })
        } else {
          updateTabState(runTab, { error: res.error?.message ?? '다운로드 테스트 실패', state: 'selecting' })
        }
      } else if (runTab === 'upload') {
        const res = await window.electronAPI.invoke('test:upload-only', { folderIds })
        if (res.success && res.data) {
          const data = res.data as TestUploadResult
          updateTabState(runTab, {
            results: data.results.map((r) => ({
              fileId: r.fileId, fileName: r.fileName, success: r.success, error: r.error,
            })),
            summary: { success: data.uploadedFiles, failed: data.failedFiles, durationMs: data.durationMs },
            state: 'complete',
          })
        } else {
          updateTabState(runTab, { error: res.error?.message ?? '업로드 테스트 실패', state: 'selecting' })
        }
      } else {
        const res = await window.electronAPI.invoke('test:full-sync', { folderIds })
        if (res.success && res.data) {
          const data = res.data as TestFullSyncResult
          updateTabState(runTab, {
            results: data.results.map((r) => ({
              fileId: r.fileId, fileName: r.fileName,
              success: r.downloadSuccess && r.uploadSuccess,
              downloadSuccess: r.downloadSuccess, uploadSuccess: r.uploadSuccess, error: r.error,
            })),
            summary: { success: data.syncedFiles, failed: data.failedFiles, durationMs: data.durationMs },
            state: 'complete',
          })
        } else {
          updateTabState(runTab, { error: res.error?.message ?? '전체 동기화 테스트 실패', state: 'selecting' })
        }
      }
    } catch {
      updateTabState(runTab, { error: '테스트 실행 중 오류가 발생했습니다', state: 'selecting' })
    }
  }, [selectedIds, tab, updateTabState])

  const handleReset = useCallback(() => {
    updateTabState(tab, { ...INITIAL_TAB_STATE })
  }, [tab, updateTabState])

  const handleRealtimeStart = useCallback(async () => {
    setRealtimeEvents([])
    const res = await window.electronAPI.invoke('test:realtime-start', {
      ...realtimeOptions,
      pollingIntervalMs: 30000,
    })
    if (res.success) {
      setRealtimeRunning(true)
    }
  }, [realtimeOptions])

  const handleRealtimeStop = useCallback(async () => {
    await window.electronAPI.invoke('test:realtime-stop')
    setRealtimeRunning(false)
  }, [])

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const { selectedFiles, selectedSize } = useMemo(() => {
    let count = 0
    let size = 0
    function aggregate(list: MigrationFolderInfo[]) {
      for (const f of list) {
        if (selectedIds.has(f.id)) {
          count += f.fileCount
          size += f.totalSize
        }
        if (f.children) aggregate(f.children)
      }
    }
    aggregate(folders)
    return { selectedFiles: count, selectedSize: size }
  }, [folders, selectedIds])

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <FlaskConical className="h-5 w-5 text-info" />
          <h2 className="text-lg font-semibold text-card-foreground">기능 테스트</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          각 단계를 분리하여 개별 검증합니다.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/50 border border-border w-fit">
        {(Object.entries(TAB_CONFIG) as [TestTab, typeof TAB_CONFIG[TestTab]][]).map(([key, conf]) => {
          const Icon = conf.icon
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors',
                tab === key
                  ? 'bg-background text-foreground shadow-sm font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {conf.label}
              {tabStates[key].state === 'scanning' || tabStates[key].state === 'testing' ? (
                <Loader className="h-3 w-3 animate-spin text-info" />
              ) : tabStates[key].state === 'complete' ? (
                <CheckCircle2 className="h-3 w-3 text-success" />
              ) : null}
            </button>
          )
        })}
      </div>

      {/* Error message */}
      {error && (
        <div className="px-3 py-2 text-sm rounded-md bg-error/10 text-error border border-error/20 flex items-center gap-2">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Idle state */}
      {tab !== 'realtime' && state === 'idle' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <FlaskConical className="h-16 w-16 text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">{TAB_CONFIG[tab].description}</p>
          <button
            type="button"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            onClick={() => handleScan()}
          >
            <Search className="h-4 w-4" />
            폴더 스캔 시작
          </button>
        </div>
      )}

      {/* Scanning state */}
      {tab !== 'realtime' && state === 'scanning' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Loader className="h-10 w-10 animate-spin text-info" />
          <p className="text-muted-foreground text-sm">외부 웹하드 폴더를 스캔하는 중...</p>
        </div>
      )}

      {/* Selecting state */}
      {tab !== 'realtime' && state === 'selecting' && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded border border-border hover:bg-accent transition-colors"
                onClick={toggleAll}
              >
                {selectedIds.size === allFolderIds.length ? (
                  <CheckSquare className="h-3.5 w-3.5" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                {selectedIds.size === allFolderIds.length ? '전체 해제' : '전체 선택'}
              </button>
              <span className="text-xs text-muted-foreground">
                {selectedIds.size}개 폴더 선택됨 ({selectedFiles.toLocaleString('ko-KR')}개 파일, {formatSize(selectedSize)})
              </span>
            </div>
            <div className="flex items-center gap-2">
              {cachedAt && (
                <span className="text-xs text-muted-foreground">
                  마지막 스캔: {formatTimeAgo(cachedAt)}
                </span>
              )}
              <button
                type="button"
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded border border-border hover:bg-accent transition-colors"
                onClick={() => handleScan(true)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                새로고침
              </button>
              <button
                type="button"
                className={cn(
                  'inline-flex items-center gap-2 px-4 py-1.5 text-sm rounded-md',
                  'bg-primary text-primary-foreground hover:bg-primary/90 transition-colors',
                  selectedIds.size === 0 && 'opacity-50 pointer-events-none',
                )}
                onClick={handleStart}
                disabled={selectedIds.size === 0}
              >
                <PlayCircle className="h-4 w-4" />
                {TAB_CONFIG[tab].label} 테스트 시작
              </button>
            </div>
          </div>

          {/* Folder list */}
          <div className="flex-1 min-h-0 rounded-lg border border-border bg-card overflow-hidden flex flex-col">
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground">
              <div className="w-5" />
              <div className="w-4" />
              <div className="flex-1">
                <SortableHeader field="folderName" label="폴더명" currentField={folderSortField} currentOrder={folderSortOrder} onSort={handleFolderSortChange} />
              </div>
              <div className="w-20 text-right">
                <SortableHeader field="fileCount" label="전체 파일" currentField={folderSortField} currentOrder={folderSortOrder} onSort={handleFolderSortChange} className="justify-end" />
              </div>
              <div className="w-20 text-right">
                <SortableHeader field="totalSize" label="용량" currentField={folderSortField} currentOrder={folderSortOrder} onSort={handleFolderSortChange} className="justify-end" />
              </div>
              <div className="w-20 text-right">
                <SortableHeader field="syncedCount" label="동기화 완료" currentField={folderSortField} currentOrder={folderSortOrder} onSort={handleFolderSortChange} className="justify-end" />
              </div>
              <div className="w-20 text-right">
                <SortableHeader field="remaining" label="남은 파일" currentField={folderSortField} currentOrder={folderSortOrder} onSort={handleFolderSortChange} className="justify-end" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sortedFolders.map((folder) => (
                <FolderTreeRow
                  key={folder.id}
                  folder={folder}
                  depth={0}
                  selectedIds={selectedIds}
                  expandedIds={expandedIds}
                  onToggleSelect={toggleFolder}
                  onToggleExpand={toggleExpand}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {/* Testing state */}
      {tab !== 'realtime' && state === 'testing' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <Loader className="h-12 w-12 animate-spin text-info" />
          <div className="text-center space-y-2">
            <p className="text-sm font-medium">{TAB_CONFIG[tab].label} 테스트 진행 중...</p>
            <p className="text-xs text-muted-foreground">
              {selectedIds.size}개 폴더, 약 {selectedFiles.toLocaleString('ko-KR')}개 파일
            </p>
            {progress && (
              <>
                <p className="text-xs text-info">
                  {progress.completedFiles} / {progress.totalFiles} 파일 처리됨
                </p>
                {progress.currentFile && (
                  <p className="text-xs text-muted-foreground truncate max-w-md">{progress.currentFile}</p>
                )}
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            파일 수에 따라 시간이 오래 걸릴 수 있습니다.
          </p>
        </div>
      )}

      {/* Complete state */}
      {tab !== 'realtime' && state === 'complete' && summary && (
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          {/* Summary cards */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <span className="text-sm font-medium">테스트 완료</span>
            </div>
            <div className="flex items-center gap-4 ml-auto">
              <div className="rounded-lg border border-border bg-card px-4 py-2 text-center">
                <p className="text-xl font-bold tabular-nums text-success">{summary.success}</p>
                <p className="text-xs text-muted-foreground">성공</p>
              </div>
              <div className="rounded-lg border border-border bg-card px-4 py-2 text-center">
                <p className={cn('text-xl font-bold tabular-nums', summary.failed > 0 ? 'text-error' : 'text-muted-foreground')}>
                  {summary.failed}
                </p>
                <p className="text-xs text-muted-foreground">실패</p>
              </div>
              <div className="rounded-lg border border-border bg-card px-4 py-2 text-center">
                <p className="text-xl font-bold tabular-nums text-muted-foreground">{formatDuration(summary.durationMs)}</p>
                <p className="text-xs text-muted-foreground">소요시간</p>
              </div>
            </div>
          </div>

          {/* Result log */}
          <div className="flex-1 min-h-0 rounded-lg border border-border bg-card overflow-hidden flex flex-col">
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground">
              <div className="w-5">
                <SortableHeader field="success" label="결과" currentField={resultSortField} currentOrder={resultSortOrder} onSort={handleResultSortChange} />
              </div>
              <div className="flex-1">
                <SortableHeader field="fileName" label="파일명" currentField={resultSortField} currentOrder={resultSortOrder} onSort={handleResultSortChange} />
              </div>
              {tab === 'full-sync' && (
                <>
                  <div className="w-16 text-center">다운로드</div>
                  <div className="w-16 text-center">업로드</div>
                </>
              )}
              {tab === 'download' && (
                <div className="w-24 text-right">
                  <SortableHeader field="fileSize" label="파일 크기" currentField={resultSortField} currentOrder={resultSortOrder} onSort={handleResultSortChange} className="justify-end" />
                </div>
              )}
              <div className="flex-1 text-right">상세</div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sortedResults.map((r, idx) => (
                <div
                  key={r.fileId || idx}
                  className="flex items-center gap-3 px-4 py-2 border-b border-border/50 text-sm"
                >
                  <div className="w-5 shrink-0">
                    {r.success ? (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    ) : (
                      <XCircle className="h-4 w-4 text-error" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 truncate font-medium">{r.fileName}</div>
                  {tab === 'full-sync' && (
                    <>
                      <div className="w-16 text-center">
                        {r.downloadSuccess ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success inline" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-error inline" />
                        )}
                      </div>
                      <div className="w-16 text-center">
                        {r.uploadSuccess ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success inline" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-error inline" />
                        )}
                      </div>
                    </>
                  )}
                  {tab === 'download' && (
                    <div className="w-24 text-right text-xs text-muted-foreground tabular-nums">
                      {r.fileSize ? formatBytes(r.fileSize) : '-'}
                    </div>
                  )}
                  <div className="flex-1 text-right text-xs text-muted-foreground truncate">
                    {r.error ? (
                      <span className="text-error">{r.error}</span>
                    ) : r.downloadPath ? (
                      <span className="text-success" title={r.downloadPath}>완료</span>
                    ) : (
                      <span className="text-success">완료</span>
                    )}
                  </div>
                </div>
              ))}
              {results.length === 0 && (
                <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
                  처리된 파일이 없습니다
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md border border-border hover:bg-accent transition-colors"
              onClick={handleReset}
            >
              처음으로 돌아가기
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md border border-border hover:bg-accent transition-colors"
              onClick={() => window.electronAPI.invoke('test:open-download-folder')}
            >
              <FolderOpen className="h-4 w-4" />
              다운로드 폴더 열기
            </button>
            {tab === 'download' && summary.success > 0 && (
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                onClick={() => {
                  // If upload tab is idle, set it to selecting so folder list shows
                  if (tabStates['upload'].state === 'idle') {
                    updateTabState('upload', { state: 'selecting' })
                  }
                  setTab('upload')
                }}
              >
                <Upload className="h-4 w-4" />
                업로드 테스트로 이동
              </button>
            )}
          </div>
        </div>
      )}

      {/* Realtime tab */}
      {tab === 'realtime' && (
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          {/* Options */}
          <div className="flex items-center gap-6 p-4 rounded-lg border border-border bg-card">
            <span className="text-sm font-medium">감지 시 동작:</span>
            {([
              { key: 'enableDownload' as const, label: '다운로드', icon: Download },
              { key: 'enableUpload' as const, label: '업로드', icon: Upload },
              { key: 'enableNotification' as const, label: '알림', icon: Bell },
            ]).map(({ key, label, icon: Icon }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={realtimeOptions[key]}
                  onChange={(e) =>
                    setRealtimeOptions((prev) => ({ ...prev, [key]: e.target.checked }))
                  }
                  disabled={realtimeRunning}
                  className="rounded border-border"
                />
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>

          {/* Start/Stop button */}
          <div className="flex items-center gap-3">
            {realtimeRunning ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-error text-error-foreground hover:bg-error/90 transition-colors"
                onClick={handleRealtimeStop}
              >
                <StopCircle className="h-4 w-4" />
                감지 중지
              </button>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                onClick={handleRealtimeStart}
              >
                <PlayCircle className="h-4 w-4" />
                감지 시작
              </button>
            )}
            {realtimeRunning && (
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
                </span>
                <span className="text-sm text-success">감지 중...</span>
              </div>
            )}
            {realtimeEvents.length > 0 && (
              <button
                type="button"
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setRealtimeEvents([])}
              >
                로그 지우기
              </button>
            )}
          </div>

          {/* Event log */}
          <div className="flex-1 min-h-0 rounded-lg border border-border bg-card overflow-hidden flex flex-col">
            <div className="flex items-center px-4 py-2 border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground">
              <span className="w-20">시간</span>
              <span className="w-20">상태</span>
              <span className="flex-1">메시지</span>
            </div>
            <div className="flex-1 overflow-y-auto font-mono text-xs">
              {realtimeEvents.length === 0 ? (
                <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
                  {realtimeRunning ? '새 파일 감지 대기 중...' : '감지를 시작하면 로그가 여기에 표시됩니다'}
                </div>
              ) : (
                realtimeEvents.map((evt, idx) => (
                  <div
                    key={idx}
                    className="flex items-center px-4 py-1.5 border-b border-border/30 hover:bg-accent/30"
                  >
                    <span className="w-20 shrink-0 text-muted-foreground">
                      {new Date(evt.timestamp).toLocaleTimeString('ko-KR')}
                    </span>
                    <span className={cn('w-20 shrink-0', getEventColor(evt.type))}>
                      {getEventLabel(evt.type)}
                    </span>
                    <span className="flex-1 truncate">{evt.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function getEventColor(type: RealtimeTestEvent['type']): string {
  switch (type) {
    case 'started': return 'text-info'
    case 'detecting': return 'text-muted-foreground'
    case 'detected': return 'text-warning'
    case 'downloading': case 'uploading': return 'text-info'
    case 'downloaded': case 'uploaded': return 'text-success'
    case 'error': return 'text-error'
    case 'stopped': return 'text-muted-foreground'
    default: return 'text-foreground'
  }
}

function getEventLabel(type: RealtimeTestEvent['type']): string {
  switch (type) {
    case 'started': return '시작'
    case 'detecting': return '감지중'
    case 'detected': return '감지됨'
    case 'downloading': return '다운로드'
    case 'downloaded': return '완료'
    case 'uploading': return '업로드'
    case 'uploaded': return '완료'
    case 'error': return '오류'
    case 'stopped': return '중지'
    default: return type
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}초`
  const min = Math.floor(sec / 60)
  const remainSec = sec % 60
  if (min < 60) return `${min}분 ${remainSec}초`
  const hr = Math.floor(min / 60)
  const remainMin = min % 60
  return `${hr}시간 ${remainMin}분`
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}
