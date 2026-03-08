import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, Folder, Check, Loader, Search } from 'lucide-react'
import { cn, formatBytes, formatRelativeTime } from '../lib/utils'
import { useSort } from '../hooks/useSort'
import { SortableHeader } from '../components/SortableHeader'
import type { FolderInfoIpc } from '../../shared/ipc-types'

type FolderSettingsSortField = 'folderName' | 'fileCount' | 'lastSyncAt' | 'syncEnabled'

const folderSettingsComparators: Record<FolderSettingsSortField, (a: FolderInfoIpc, b: FolderInfoIpc) => number> = {
  folderName: (a, b) => a.folderName.localeCompare(b.folderName, 'ko'),
  fileCount: (a, b) => a.fileCount - b.fileCount,
  lastSyncAt: (a, b) => (a.lastSyncAt ?? '').localeCompare(b.lastSyncAt ?? ''),
  syncEnabled: (a, b) => Number(a.syncEnabled) - Number(b.syncEnabled),
}

// ── Folder row component ──

function FolderRow({
  folder,
  onToggle,
  toggling,
}: {
  folder: FolderInfoIpc
  onToggle: (folderId: string, enabled: boolean) => void
  toggling: string | null
}) {
  const isToggling = toggling === folder.folderId

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 border-b border-border/50 transition-colors',
        'hover:bg-accent/50',
        !folder.syncEnabled && 'opacity-60',
      )}
    >
      {/* Checkbox */}
      <button
        type="button"
        className={cn(
          'shrink-0 h-5 w-5 rounded border-2 transition-colors flex items-center justify-center',
          folder.syncEnabled
            ? 'bg-primary border-primary'
            : 'border-border hover:border-muted-foreground',
          isToggling && 'opacity-50 pointer-events-none',
        )}
        onClick={() => onToggle(folder.folderId, !folder.syncEnabled)}
        disabled={isToggling}
        aria-label={
          folder.syncEnabled
            ? `${folder.folderName} 동기화 비활성화`
            : `${folder.folderName} 동기화 활성화`
        }
      >
        {isToggling ? (
          <Loader className="h-3 w-3 animate-spin text-primary-foreground" />
        ) : folder.syncEnabled ? (
          <Check className="h-3 w-3 text-primary-foreground" />
        ) : null}
      </button>

      {/* Folder icon + name */}
      <Folder
        className={cn(
          'h-4 w-4 shrink-0',
          folder.syncEnabled ? 'text-warning' : 'text-muted-foreground',
        )}
      />
      <span className="flex-1 min-w-0 truncate text-sm font-medium">
        {folder.folderName}
      </span>

      {/* File count */}
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {folder.fileCount} 파일
      </span>

      {/* Last sync time */}
      <span className="shrink-0 w-24 text-xs text-muted-foreground text-right">
        {folder.lastSyncAt ? formatRelativeTime(folder.lastSyncAt) : '-'}
      </span>

      {/* Sync status mini-bar */}
      <div className="shrink-0 w-16">
        {folder.syncEnabled ? (
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                folder.lastSyncAt ? 'bg-success' : 'bg-warning',
              )}
              style={{ width: folder.lastSyncAt ? '100%' : '30%' }}
            />
          </div>
        ) : (
          <div className="h-1.5 rounded-full bg-muted" />
        )}
      </div>
    </div>
  )
}

// ── Main page ──

export function FolderSettingsPage() {
  const [folders, setFolders] = useState<FolderInfoIpc[]>([])
  const [loading, setLoading] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState<string | null>(null)

  const {
    sorted: sortedFolders,
    sortField,
    sortOrder,
    handleSortChange,
  } = useSort(folders, 'folderName' as FolderSettingsSortField, 'asc', folderSettingsComparators)

  // Load folders
  const loadFolders = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.electronAPI.invoke('folders:list', {})
      if (res.success && res.data) {
        setFolders(res.data)
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  // Load on mount
  useEffect(() => {
    loadFolders()
  }, [loadFolders])

  // Toggle sync for a folder
  const handleToggle = useCallback(
    async (folderId: string, enabled: boolean) => {
      setToggling(folderId)
      try {
        const res = await window.electronAPI.invoke('folders:toggle', {
          folderId,
          enabled,
        })
        if (res.success) {
          setFolders((prev) =>
            prev.map((f) =>
              f.folderId === folderId ? { ...f, syncEnabled: enabled } : f,
            ),
          )
        }
      } catch {
        // silently fail
      } finally {
        setToggling(null)
      }
    },
    [],
  )

  // Scan LGU+ folders
  const handleScanFolders = useCallback(async () => {
    setScanning(true)
    setScanMessage(null)
    try {
      const res = await window.electronAPI.invoke('folders:discover')
      if (res.success && res.data) {
        setScanMessage(
          `${res.data.total}개 폴더 발견, ${res.data.newFolders}개 신규 등록`,
        )
        // Refresh folder list
        await loadFolders()
      } else {
        setScanMessage('스캔 실패: ' + (res.error?.message ?? '알 수 없는 오류'))
      }
    } catch {
      setScanMessage('스캔 중 오류가 발생했습니다')
    } finally {
      setScanning(false)
      // Auto-hide message after 5s
      setTimeout(() => setScanMessage(null), 5000)
    }
  }, [loadFolders])

  // Summary calculations
  const summary = useMemo(() => {
    const enabled = folders.filter((f) => f.syncEnabled)
    const totalFileCount = enabled.reduce((sum, f) => sum + f.fileCount, 0)
    return {
      selectedCount: enabled.length,
      totalCount: folders.length,
      totalFiles: totalFileCount,
    }
  }, [folders])

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Top: description + actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-card-foreground">폴더 설정</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            동기화할 폴더를 선택하세요
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md',
              'bg-primary text-primary-foreground hover:bg-primary/90 transition-colors',
              scanning && 'opacity-50 pointer-events-none',
            )}
            onClick={handleScanFolders}
            disabled={scanning}
          >
            {scanning ? (
              <Loader className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            LGU+ 폴더 스캔
          </button>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-border',
              'hover:bg-accent hover:text-accent-foreground transition-colors',
              loading && 'opacity-50 pointer-events-none',
            )}
            onClick={loadFolders}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            새로고침
          </button>
        </div>
      </div>

      {/* Scan result message */}
      {scanMessage && (
        <div className="px-3 py-2 text-sm rounded-md bg-info/10 text-info border border-info/20">
          {scanMessage}
        </div>
      )}

      {/* Folder list */}
      <div className="flex-1 min-h-0 rounded-lg border border-border bg-card overflow-hidden flex flex-col">
        {/* List header */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground">
          <div className="w-5" /> {/* checkbox spacer */}
          <div className="w-4" /> {/* icon spacer */}
          <div className="flex-1">
            <SortableHeader field="folderName" label="폴더명" currentField={sortField} currentOrder={sortOrder} onSort={handleSortChange} />
          </div>
          <div className="w-16 text-right">
            <SortableHeader field="fileCount" label="파일 수" currentField={sortField} currentOrder={sortOrder} onSort={handleSortChange} className="justify-end" />
          </div>
          <div className="w-24 text-right">
            <SortableHeader field="lastSyncAt" label="마지막 동기화" currentField={sortField} currentOrder={sortOrder} onSort={handleSortChange} className="justify-end" />
          </div>
          <div className="w-16 text-center">
            <SortableHeader field="syncEnabled" label="상태" currentField={sortField} currentOrder={sortOrder} onSort={handleSortChange} className="justify-center" />
          </div>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto">
          {loading && folders.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : folders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Folder className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">등록된 폴더가 없습니다</p>
              <p className="text-xs mt-1">외부 웹하드에서 폴더를 동기화하면 표시됩니다</p>
            </div>
          ) : (
            sortedFolders.map((folder) => (
              <FolderRow
                key={folder.folderId}
                folder={folder}
                onToggle={handleToggle}
                toggling={toggling}
              />
            ))
          )}
        </div>
      </div>

      {/* Bottom: Summary bar */}
      <div className="flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-card text-sm">
        <div className="flex items-center gap-6">
          <div>
            <span className="text-muted-foreground">선택됨: </span>
            <span className="font-medium">
              {summary.selectedCount}
              <span className="text-muted-foreground font-normal">
                {' '}
                / {summary.totalCount}
              </span>
            </span>
          </div>
          <div className="h-4 w-px bg-border" />
          <div>
            <span className="text-muted-foreground">총 파일: </span>
            <span className="font-medium tabular-nums">
              {summary.totalFiles.toLocaleString('ko-KR')}
            </span>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {summary.selectedCount > 0
            ? `${summary.selectedCount}개 폴더가 동기화 대상입니다`
            : '동기화할 폴더를 선택하세요'}
        </div>
      </div>
    </div>
  )
}
