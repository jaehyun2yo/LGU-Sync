import { useState, useCallback } from 'react'
import {
  DatabaseBackup,
  Search,
  Loader,
  Folder,
  Check,
  CheckSquare,
  Square,
  PlayCircle,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { cn } from '../lib/utils'
import type { MigrationFolderInfo, MigrationResult } from '../../shared/ipc-types'

type MigrationState = 'idle' | 'scanning' | 'selecting' | 'migrating' | 'complete'

export function MigrationPage() {
  const [state, setState] = useState<MigrationState>('idle')
  const [folders, setFolders] = useState<MigrationFolderInfo[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<MigrationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentFile, setCurrentFile] = useState<string | null>(null)

  // Scan folders
  const handleScan = useCallback(async () => {
    setState('scanning')
    setError(null)
    setResult(null)
    try {
      const res = await window.electronAPI.invoke('migration:scan')
      if (res.success && res.data) {
        setFolders(res.data)
        setSelectedIds(new Set(res.data.map((f) => f.id)))
        setState('selecting')
      } else {
        setError(res.error?.message ?? '스캔 실패')
        setState('idle')
      }
    } catch {
      setError('폴더 스캔 중 오류가 발생했습니다')
      setState('idle')
    }
  }, [])

  // Toggle folder selection
  const toggleFolder = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  // Toggle all
  const toggleAll = useCallback(() => {
    if (selectedIds.size === folders.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(folders.map((f) => f.id)))
    }
  }, [selectedIds.size, folders])

  // Start migration
  const handleStart = useCallback(async () => {
    if (selectedIds.size === 0) return
    setState('migrating')
    setError(null)
    setCurrentFile(null)
    try {
      const res = await window.electronAPI.invoke('migration:start', {
        folderIds: Array.from(selectedIds),
      })
      if (res.success && res.data) {
        setResult(res.data)
        setState('complete')
      } else {
        setError(res.error?.message ?? '마이그레이션 실패')
        setState('selecting')
      }
    } catch {
      setError('마이그레이션 중 오류가 발생했습니다')
      setState('selecting')
    }
  }, [selectedIds])

  // Reset
  const handleReset = useCallback(() => {
    setState('idle')
    setFolders([])
    setSelectedIds(new Set())
    setResult(null)
    setError(null)
    setCurrentFile(null)
  }, [])

  const totalFiles = folders.reduce((sum, f) => sum + f.fileCount, 0)
  const totalSynced = folders.reduce((sum, f) => sum + f.syncedCount, 0)
  const selectedFolders = folders.filter((f) => selectedIds.has(f.id))
  const selectedFiles = selectedFolders.reduce((sum, f) => sum + f.fileCount, 0)

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <DatabaseBackup className="h-5 w-5 text-info" />
          <h2 className="text-lg font-semibold text-card-foreground">마이그레이션</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          외부 웹하드의 기존 파일을 자체 웹하드로 일괄 이전합니다.
          폴더를 스캔하여 선택한 후 마이그레이션을 시작하세요.
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div className="px-3 py-2 text-sm rounded-md bg-error/10 text-error border border-error/20 flex items-center gap-2">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Idle state */}
      {state === 'idle' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <DatabaseBackup className="h-16 w-16 text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">
            먼저 외부 웹하드 폴더를 스캔하세요
          </p>
          <button
            type="button"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            onClick={handleScan}
          >
            <Search className="h-4 w-4" />
            폴더 스캔 시작
          </button>
        </div>
      )}

      {/* Scanning state */}
      {state === 'scanning' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Loader className="h-10 w-10 animate-spin text-info" />
          <p className="text-muted-foreground text-sm">
            외부 웹하드 폴더를 스캔하는 중...
          </p>
        </div>
      )}

      {/* Selecting state - folder list */}
      {state === 'selecting' && (
        <>
          {/* Actions bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded border border-border hover:bg-accent transition-colors"
                onClick={toggleAll}
              >
                {selectedIds.size === folders.length ? (
                  <CheckSquare className="h-3.5 w-3.5" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                {selectedIds.size === folders.length ? '전체 해제' : '전체 선택'}
              </button>
              <span className="text-xs text-muted-foreground">
                {selectedIds.size}개 폴더 선택됨 ({selectedFiles.toLocaleString('ko-KR')}개 파일)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded border border-border hover:bg-accent transition-colors"
                onClick={handleScan}
              >
                <Search className="h-3.5 w-3.5" />
                다시 스캔
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
                마이그레이션 시작
              </button>
            </div>
          </div>

          {/* Folder list */}
          <div className="flex-1 min-h-0 rounded-lg border border-border bg-card overflow-hidden flex flex-col">
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground">
              <div className="w-5" />
              <div className="w-4" />
              <div className="flex-1">폴더명</div>
              <div className="w-20 text-right">전체 파일</div>
              <div className="w-20 text-right">동기화 완료</div>
              <div className="w-20 text-right">남은 파일</div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {folders.map((folder) => {
                const isSelected = selectedIds.has(folder.id)
                const remaining = folder.fileCount - folder.syncedCount
                return (
                  <div
                    key={folder.id}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 border-b border-border/50 transition-colors cursor-pointer',
                      'hover:bg-accent/50',
                      !isSelected && 'opacity-60',
                    )}
                    onClick={() => toggleFolder(folder.id)}
                  >
                    <button
                      type="button"
                      className={cn(
                        'shrink-0 h-5 w-5 rounded border-2 transition-colors flex items-center justify-center',
                        isSelected
                          ? 'bg-primary border-primary'
                          : 'border-border hover:border-muted-foreground',
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                    </button>
                    <Folder
                      className={cn(
                        'h-4 w-4 shrink-0',
                        isSelected ? 'text-warning' : 'text-muted-foreground',
                      )}
                    />
                    <span className="flex-1 min-w-0 truncate text-sm font-medium">
                      {folder.folderName}
                    </span>
                    <span className="shrink-0 w-20 text-xs text-muted-foreground text-right tabular-nums">
                      {folder.fileCount.toLocaleString('ko-KR')}
                    </span>
                    <span className="shrink-0 w-20 text-xs text-success text-right tabular-nums">
                      {folder.syncedCount.toLocaleString('ko-KR')}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 w-20 text-xs text-right tabular-nums',
                        remaining > 0 ? 'text-warning' : 'text-muted-foreground',
                      )}
                    >
                      {remaining.toLocaleString('ko-KR')}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* Migrating state */}
      {state === 'migrating' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <Loader className="h-12 w-12 animate-spin text-info" />
          <div className="text-center space-y-2">
            <p className="text-sm font-medium">마이그레이션 진행 중...</p>
            <p className="text-xs text-muted-foreground">
              {selectedIds.size}개 폴더, 약 {selectedFiles.toLocaleString('ko-KR')}개 파일
            </p>
            {currentFile && (
              <p className="text-xs text-muted-foreground truncate max-w-md">
                {currentFile}
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            파일 수에 따라 시간이 오래 걸릴 수 있습니다. 앱을 종료하지 마세요.
          </p>
        </div>
      )}

      {/* Complete state */}
      {state === 'complete' && result && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <CheckCircle2 className="h-16 w-16 text-success" />
          <div className="text-center space-y-1">
            <p className="text-lg font-semibold">마이그레이션 완료</p>
          </div>

          {/* Result summary */}
          <div className="grid grid-cols-2 gap-4 w-full max-w-sm">
            <div className="rounded-lg border border-border bg-card p-3 text-center">
              <p className="text-2xl font-bold tabular-nums">{result.scannedFolders}</p>
              <p className="text-xs text-muted-foreground">스캔된 폴더</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 text-center">
              <p className="text-2xl font-bold tabular-nums text-info">{result.newFolders}</p>
              <p className="text-xs text-muted-foreground">신규 폴더</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 text-center">
              <p className="text-2xl font-bold tabular-nums text-success">{result.syncedFiles}</p>
              <p className="text-xs text-muted-foreground">동기화 성공</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 text-center">
              <p
                className={cn(
                  'text-2xl font-bold tabular-nums',
                  result.failedFiles > 0 ? 'text-error' : 'text-muted-foreground',
                )}
              >
                {result.failedFiles}
              </p>
              <p className="text-xs text-muted-foreground">실패</p>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            총 {result.scannedFiles.toLocaleString('ko-KR')}개 파일 스캔, 소요 시간:{' '}
            {formatDuration(result.durationMs)}
          </div>

          <button
            type="button"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md border border-border hover:bg-accent transition-colors"
            onClick={handleReset}
          >
            처음으로 돌아가기
          </button>
        </div>
      )}

      {/* Bottom summary bar (only during selecting) */}
      {state === 'selecting' && (
        <div className="flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-card text-sm">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-muted-foreground">전체: </span>
              <span className="font-medium tabular-nums">
                {totalFiles.toLocaleString('ko-KR')} 파일
              </span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div>
              <span className="text-muted-foreground">동기화 완료: </span>
              <span className="font-medium tabular-nums text-success">
                {totalSynced.toLocaleString('ko-KR')}
              </span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div>
              <span className="text-muted-foreground">남은 파일: </span>
              <span className="font-medium tabular-nums text-warning">
                {(totalFiles - totalSynced).toLocaleString('ko-KR')}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
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
