import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Search,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  CheckCircle,
  XCircle,
  Clock,
  Loader,
  FileText,
  ArrowUpDown,
} from 'lucide-react'
import { cn, formatBytes, formatTime } from '../lib/utils'
import { useUiStore } from '../stores/ui-store'
import type {
  FolderTreeNode,
  SyncFileInfo,
  Paginated,
} from '../../shared/ipc-types'
import type { SyncFileStatus } from '../../core/types/sync-status.types'

// ── Status helpers ──

type SortField = 'name' | 'date' | 'size' | 'status'
type SortOrder = 'asc' | 'desc'

function statusIcon(status: SyncFileStatus) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="h-4 w-4 text-success" />
    case 'detected':
      return <Clock className="h-4 w-4 text-warning" />
    case 'downloading':
    case 'uploading':
      return <Loader className="h-4 w-4 text-info animate-spin" />
    case 'dl_failed':
    case 'ul_failed':
    case 'dlq':
      return <XCircle className="h-4 w-4 text-error" />
    case 'skipped':
      return <Clock className="h-4 w-4 text-muted-foreground" />
    default:
      return <FileText className="h-4 w-4 text-muted-foreground" />
  }
}

function statusText(status: SyncFileStatus): string {
  const map: Record<SyncFileStatus, string> = {
    detected: '감지됨',
    downloading: '다운로드 중',
    dl_failed: '다운로드 실패',
    uploading: '업로드 중',
    ul_failed: '업로드 실패',
    completed: '완료',
    skipped: '건너뜀',
    dlq: '대기열',
  }
  return map[status] ?? status
}

// ── FolderTree component ──

function FolderTreeItem({
  node,
  selectedId,
  expandedIds,
  onSelect,
  onToggleExpand,
}: {
  node: FolderTreeNode
  selectedId: string | null
  expandedIds: Set<string>
  onSelect: (id: string) => void
  onToggleExpand: (id: string) => void
}) {
  const isExpanded = expandedIds.has(node.folderId)
  const isSelected = selectedId === node.folderId
  const hasChildren = node.children.length > 0

  return (
    <div>
      <button
        type="button"
        className={cn(
          'flex items-center gap-1.5 w-full px-2 py-1.5 text-sm rounded-md text-left transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          isSelected && 'bg-accent text-accent-foreground',
          !node.syncEnabled && 'opacity-50',
        )}
        style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
        onClick={() => onSelect(node.folderId)}
      >
        {/* Expand/collapse chevron */}
        {hasChildren ? (
          <span
            className="shrink-0 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand(node.folderId)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                onToggleExpand(node.folderId)
              }
            }}
            role="button"
            tabIndex={0}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </span>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Folder icon */}
        {isExpanded && hasChildren ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-warning" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-warning" />
        )}

        {/* Folder name */}
        <span className="truncate flex-1">{node.folderName}</span>

        {/* File count badge */}
        {node.fileCount > 0 && (
          <span className="shrink-0 ml-1 px-1.5 py-0.5 text-xs rounded-full bg-muted text-muted-foreground">
            {node.fileCount}
          </span>
        )}
      </button>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <FolderTreeItem
              key={child.folderId}
              node={child}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FolderTree({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: FolderTreeNode[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Auto-expand top-level on first load
  useEffect(() => {
    if (nodes.length > 0 && expandedIds.size === 0) {
      setExpandedIds(new Set(nodes.map((n) => n.folderId)))
    }
  }, [nodes]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  return (
    <div className="overflow-y-auto h-full py-1">
      {nodes.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          폴더가 없습니다
        </div>
      ) : (
        nodes.map((node) => (
          <FolderTreeItem
            key={node.folderId}
            node={node}
            selectedId={selectedId}
            expandedIds={expandedIds}
            onSelect={onSelect}
            onToggleExpand={toggleExpand}
          />
        ))
      )}
    </div>
  )
}

// ── FileTable component ──

function FileTable({
  files,
  sortBy,
  sortOrder,
  onSortChange,
  selectedFileId,
  onSelectFile,
}: {
  files: SyncFileInfo[]
  sortBy: SortField
  sortOrder: SortOrder
  onSortChange: (field: SortField) => void
  selectedFileId: string | null
  onSelectFile: (file: SyncFileInfo) => void
}) {
  const columns: { key: SortField; label: string; className: string }[] = [
    { key: 'status', label: '상태', className: 'w-16 text-center' },
    { key: 'name', label: '파일명', className: 'flex-1 min-w-0' },
    { key: 'size', label: '크기', className: 'w-24 text-right' },
    { key: 'date', label: '동기화 시간', className: 'w-40' },
    { key: 'status', label: '상태 텍스트', className: 'w-28' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Column headers */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground">
        <div className="w-16 text-center">상태</div>
        <button
          type="button"
          className="flex items-center gap-1 flex-1 min-w-0 hover:text-foreground transition-colors"
          onClick={() => onSortChange('name')}
        >
          파일명
          <ArrowUpDown className={cn('h-3 w-3', sortBy === 'name' && 'text-foreground')} />
        </button>
        <button
          type="button"
          className="flex items-center gap-1 w-24 text-right justify-end hover:text-foreground transition-colors"
          onClick={() => onSortChange('size')}
        >
          크기
          <ArrowUpDown className={cn('h-3 w-3', sortBy === 'size' && 'text-foreground')} />
        </button>
        <button
          type="button"
          className="flex items-center gap-1 w-40 hover:text-foreground transition-colors"
          onClick={() => onSortChange('date')}
        >
          동기화 시간
          <ArrowUpDown className={cn('h-3 w-3', sortBy === 'date' && 'text-foreground')} />
        </button>
        <div className="w-28">상태</div>
      </div>

      {/* File rows */}
      <div className="flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
            <FileText className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm">파일이 없습니다</p>
            <p className="text-xs mt-1">폴더를 선택하거나 검색어를 입력하세요</p>
          </div>
        ) : (
          files.map((file) => (
            <button
              key={file.id}
              type="button"
              className={cn(
                'flex items-center gap-2 w-full px-3 py-2 text-sm border-b border-border/50 text-left transition-colors',
                'hover:bg-accent/50',
                selectedFileId === file.id && 'bg-accent text-accent-foreground',
              )}
              onClick={() => onSelectFile(file)}
            >
              <div className="w-16 flex justify-center">{statusIcon(file.status)}</div>
              <div className="flex-1 min-w-0 truncate">{file.fileName}</div>
              <div className="w-24 text-right text-muted-foreground">
                {formatBytes(file.fileSize)}
              </div>
              <div className="w-40 text-muted-foreground">
                {file.syncedAt ? formatTime(file.syncedAt) : '-'}
              </div>
              <div className="w-28">
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    file.status === 'completed' && 'bg-success/10 text-success',
                    file.status === 'detected' && 'bg-warning/10 text-warning',
                    (file.status === 'downloading' || file.status === 'uploading') &&
                      'bg-info/10 text-info',
                    (file.status === 'dl_failed' ||
                      file.status === 'ul_failed' ||
                      file.status === 'dlq') &&
                      'bg-error/10 text-error',
                    file.status === 'skipped' && 'bg-muted text-muted-foreground',
                  )}
                >
                  {statusText(file.status)}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ── FileDetailPanel component ──

function FileDetailPanel({
  file,
  onRetry,
  onViewLog,
}: {
  file: SyncFileInfo
  onRetry: () => void
  onViewLog: () => void
}) {
  const isFailed =
    file.status === 'dl_failed' || file.status === 'ul_failed' || file.status === 'dlq'

  return (
    <div className="border-t border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">파일명:</span>{' '}
            <span className="font-medium">{file.fileName}</span>
          </div>
          <div>
            <span className="text-muted-foreground">경로:</span>{' '}
            <span className="text-muted-foreground">{file.folderPath}</span>
          </div>
          <div>
            <span className="text-muted-foreground">크기:</span>{' '}
            <span>{formatBytes(file.fileSize)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">상태:</span>{' '}
            <span className="inline-flex items-center gap-1.5">
              {statusIcon(file.status)} {statusText(file.status)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">동기화 시간:</span>{' '}
            <span>{file.syncedAt ? formatTime(file.syncedAt) : '-'}</span>
          </div>
          {file.error && (
            <div className="col-span-2">
              <span className="text-muted-foreground">오류:</span>{' '}
              <span className="text-error">{file.error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isFailed && (
            <button
              type="button"
              className={cn(
                'px-3 py-1.5 text-sm rounded-md font-medium transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
              onClick={onRetry}
            >
              지금 동기화
            </button>
          )}
          <button
            type="button"
            className={cn(
              'px-3 py-1.5 text-sm rounded-md font-medium transition-colors',
              'border border-border hover:bg-accent hover:text-accent-foreground',
            )}
            onClick={onViewLog}
          >
            로그 보기
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Pagination component ──

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number
  totalPages: number
  onPageChange: (p: number) => void
}) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-center gap-2 px-3 py-2 border-t border-border text-sm">
      <button
        type="button"
        disabled={page <= 1}
        className="px-2 py-1 rounded-md border border-border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={() => onPageChange(page - 1)}
      >
        이전
      </button>
      <span className="text-muted-foreground">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        className="px-2 py-1 rounded-md border border-border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={() => onPageChange(page + 1)}
      >
        다음
      </button>
    </div>
  )
}

// ── Main page ──

export function FileExplorerPage() {
  const setPage = useUiStore((s) => s.setPage)

  // Folder tree state
  const [folders, setFolders] = useState<FolderTreeNode[]>([])
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)

  // Files state
  const [files, setFiles] = useState<SyncFileInfo[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<SyncFileInfo | null>(null)
  const [sortBy, setSortBy] = useState<SortField>('date')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [page, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const pageSize = 50

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery)
      setCurrentPage(1)
    }, 300)
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [searchQuery])

  // Load folder tree
  const loadFolders = useCallback(async () => {
    setFoldersLoading(true)
    try {
      const res = await window.electronAPI.invoke('folders:tree')
      if (res.success && res.data) {
        setFolders(res.data)
      }
    } catch {
      // silently fail
    } finally {
      setFoldersLoading(false)
    }
  }, [])

  // Load folder tree on mount
  useEffect(() => {
    loadFolders()
  }, [loadFolders])

  // Load files when folder, sort, page, or search changes
  useEffect(() => {
    let cancelled = false

    async function loadFiles() {
      setFilesLoading(true)
      try {
        if (debouncedQuery.trim()) {
          // Search mode
          const res = await window.electronAPI.invoke('files:search', {
            query: debouncedQuery.trim(),
            folderId: selectedFolderId ?? undefined,
            page,
            pageSize,
          })
          if (!cancelled && res.success && res.data) {
            setFiles(res.data.items)
            setTotalPages(res.data.pagination.totalPages)
          }
        } else if (selectedFolderId) {
          // Browse mode
          const res = await window.electronAPI.invoke('files:list', {
            folderId: selectedFolderId,
            sortBy,
            sortOrder,
            page,
            pageSize,
          })
          if (!cancelled && res.success && res.data) {
            setFiles(res.data.items)
            setTotalPages(res.data.pagination.totalPages)
          }
        } else {
          // No folder selected, load all
          const res = await window.electronAPI.invoke('files:list', {
            sortBy,
            sortOrder,
            page,
            pageSize,
          })
          if (!cancelled && res.success && res.data) {
            setFiles(res.data.items)
            setTotalPages(res.data.pagination.totalPages)
          }
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) {
          setFilesLoading(false)
        }
      }
    }

    loadFiles()
    return () => {
      cancelled = true
    }
  }, [selectedFolderId, sortBy, sortOrder, page, debouncedQuery])

  // Sort toggle handler
  const handleSortChange = useCallback(
    (field: SortField) => {
      if (sortBy === field) {
        setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortBy(field)
        setSortOrder('asc')
      }
      setCurrentPage(1)
    },
    [sortBy],
  )

  // Folder selection
  const handleFolderSelect = useCallback((folderId: string) => {
    setSelectedFolderId(folderId)
    setSelectedFile(null)
    setCurrentPage(1)
  }, [])

  // File selection
  const handleFileSelect = useCallback((file: SyncFileInfo) => {
    setSelectedFile((prev) => (prev?.id === file.id ? null : file))
  }, [])

  // Retry sync for failed file
  const handleRetry = useCallback(async () => {
    if (!selectedFile) return
    try {
      await window.electronAPI.invoke('sync:retry-failed', {
        eventIds: [selectedFile.id],
      })
    } catch {
      // silently fail
    }
  }, [selectedFile])

  // Navigate to log page
  const handleViewLog = useCallback(() => {
    setPage('sync-log')
  }, [setPage])

  // Refresh all
  const handleRefresh = useCallback(() => {
    loadFolders()
    setCurrentPage(1)
  }, [loadFolders])

  return (
    <div className="flex flex-col h-full gap-0">
      {/* Top bar: Search + Refresh */}
      <div className="flex items-center gap-3 pb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="파일 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              'w-full pl-9 pr-3 py-2 text-sm rounded-md border border-border bg-background',
              'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
            )}
          />
        </div>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-border',
            'hover:bg-accent hover:text-accent-foreground transition-colors',
            foldersLoading && 'opacity-50 pointer-events-none',
          )}
          onClick={handleRefresh}
          disabled={foldersLoading}
        >
          <RefreshCw className={cn('h-4 w-4', foldersLoading && 'animate-spin')} />
          새로고침
        </button>
      </div>

      {/* Main content: folder tree + file table */}
      <div className="flex flex-1 min-h-0 rounded-lg border border-border bg-card overflow-hidden">
        {/* Left: Folder tree */}
        <div className="w-60 shrink-0 border-r border-border bg-card overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-border">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
              폴더
            </h3>
          </div>
          {foldersLoading && folders.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <FolderTree
              nodes={folders}
              selectedId={selectedFolderId}
              onSelect={handleFolderSelect}
            />
          )}
        </div>

        {/* Right: File table + pagination */}
        <div className="flex-1 flex flex-col min-w-0">
          {filesLoading && files.length === 0 ? (
            <div className="flex items-center justify-center flex-1">
              <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <FileTable
                files={files}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSortChange={handleSortChange}
                selectedFileId={selectedFile?.id ?? null}
                onSelectFile={handleFileSelect}
              />
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            </>
          )}
        </div>
      </div>

      {/* Bottom: File detail panel */}
      {selectedFile && (
        <FileDetailPanel
          file={selectedFile}
          onRetry={handleRetry}
          onViewLog={handleViewLog}
        />
      )}
    </div>
  )
}
