import { useState, useCallback, useEffect } from 'react'
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
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useIpcEvent } from '../hooks/useIpcEvent'
import type {
  MigrationFolderInfo,
  TestDownloadResult,
  TestUploadResult,
  TestFullSyncResult,
  TestProgressEvent,
} from '../../shared/ipc-types'

type TestTab = 'download' | 'upload' | 'full-sync'
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

const TAB_CONFIG: Record<TestTab, { label: string; icon: React.ComponentType<{ className?: string }>; description: string }> = {
  download: { label: '다운로드', icon: Download, description: 'LGU+ 외부웹하드에서 로컬로 파일을 다운로드합니다.' },
  upload: { label: '업로드', icon: Upload, description: '다운로드 완료된 파일을 자체웹하드로 업로드합니다.' },
  'full-sync': { label: '전체 동기화', icon: RefreshCw, description: '다운로드 + 업로드를 순차적으로 실행합니다.' },
}

export function TestPage() {
  const [tab, setTab] = useState<TestTab>('download')
  const [state, setState] = useState<TestState>('idle')
  const [folders, setFolders] = useState<MigrationFolderInfo[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<FileResult[]>([])
  const [summary, setSummary] = useState<{ success: number; failed: number; durationMs: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<TestProgressEvent | null>(null)

  // Listen for test progress events
  useIpcEvent('test:progress', useCallback((data: TestProgressEvent) => {
    setProgress(data)
  }, []))

  // Reset state when tab changes
  useEffect(() => {
    setState('idle')
    setResults([])
    setSummary(null)
    setError(null)
    setProgress(null)
  }, [tab])

  // Scan folders
  const handleScan = useCallback(async () => {
    setState('scanning')
    setError(null)
    setResults([])
    setSummary(null)
    try {
      const res = await window.electronAPI.invoke('test:scan-folders')
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

  const toggleFolder = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (selectedIds.size === folders.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(folders.map((f) => f.id)))
    }
  }, [selectedIds.size, folders])

  // Run test
  const handleStart = useCallback(async () => {
    if (selectedIds.size === 0) return
    setState('testing')
    setError(null)
    setResults([])
    setSummary(null)
    setProgress(null)

    const folderIds = Array.from(selectedIds)

    try {
      if (tab === 'download') {
        const res = await window.electronAPI.invoke('test:download-only', { folderIds })
        if (res.success && res.data) {
          const data = res.data as TestDownloadResult
          setResults(data.results.map((r) => ({
            fileId: r.fileId,
            fileName: r.fileName,
            success: r.success,
            error: r.error,
            downloadPath: r.downloadPath,
            fileSize: r.fileSize,
          })))
          setSummary({ success: data.downloadedFiles, failed: data.failedFiles, durationMs: data.durationMs })
          setState('complete')
        } else {
          setError(res.error?.message ?? '다운로드 테스트 실패')
          setState('selecting')
        }
      } else if (tab === 'upload') {
        const res = await window.electronAPI.invoke('test:upload-only', { folderIds })
        if (res.success && res.data) {
          const data = res.data as TestUploadResult
          setResults(data.results.map((r) => ({
            fileId: r.fileId,
            fileName: r.fileName,
            success: r.success,
            error: r.error,
          })))
          setSummary({ success: data.uploadedFiles, failed: data.failedFiles, durationMs: data.durationMs })
          setState('complete')
        } else {
          setError(res.error?.message ?? '업로드 테스트 실패')
          setState('selecting')
        }
      } else {
        const res = await window.electronAPI.invoke('test:full-sync', { folderIds })
        if (res.success && res.data) {
          const data = res.data as TestFullSyncResult
          setResults(data.results.map((r) => ({
            fileId: r.fileId,
            fileName: r.fileName,
            success: r.downloadSuccess && r.uploadSuccess,
            downloadSuccess: r.downloadSuccess,
            uploadSuccess: r.uploadSuccess,
            error: r.error,
          })))
          setSummary({ success: data.syncedFiles, failed: data.failedFiles, durationMs: data.durationMs })
          setState('complete')
        } else {
          setError(res.error?.message ?? '전체 동기화 테스트 실패')
          setState('selecting')
        }
      }
    } catch {
      setError('테스트 실행 중 오류가 발생했습니다')
      setState('selecting')
    }
  }, [selectedIds, tab])

  const handleReset = useCallback(() => {
    setState('idle')
    setResults([])
    setSummary(null)
    setError(null)
    setProgress(null)
  }, [])

  const selectedFolders = folders.filter((f) => selectedIds.has(f.id))
  const selectedFiles = selectedFolders.reduce((sum, f) => sum + f.fileCount, 0)

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
      {state === 'idle' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <FlaskConical className="h-16 w-16 text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">{TAB_CONFIG[tab].description}</p>
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
          <p className="text-muted-foreground text-sm">외부 웹하드 폴더를 스캔하는 중...</p>
        </div>
      )}

      {/* Selecting state */}
      {state === 'selecting' && (
        <>
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
                {TAB_CONFIG[tab].label} 테스트 시작
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
                        isSelected ? 'bg-primary border-primary' : 'border-border hover:border-muted-foreground',
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                    </button>
                    <Folder className={cn('h-4 w-4 shrink-0', isSelected ? 'text-warning' : 'text-muted-foreground')} />
                    <span className="flex-1 min-w-0 truncate text-sm font-medium">{folder.folderName}</span>
                    <span className="shrink-0 w-20 text-xs text-muted-foreground text-right tabular-nums">
                      {folder.fileCount.toLocaleString('ko-KR')}
                    </span>
                    <span className="shrink-0 w-20 text-xs text-success text-right tabular-nums">
                      {folder.syncedCount.toLocaleString('ko-KR')}
                    </span>
                    <span className={cn('shrink-0 w-20 text-xs text-right tabular-nums', remaining > 0 ? 'text-warning' : 'text-muted-foreground')}>
                      {remaining.toLocaleString('ko-KR')}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* Testing state */}
      {state === 'testing' && (
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
      {state === 'complete' && summary && (
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
              <div className="w-5">결과</div>
              <div className="flex-1">파일명</div>
              {tab === 'full-sync' && (
                <>
                  <div className="w-16 text-center">다운로드</div>
                  <div className="w-16 text-center">업로드</div>
                </>
              )}
              {tab === 'download' && <div className="w-24 text-right">파일 크기</div>}
              <div className="flex-1 text-right">상세</div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {results.map((r, idx) => (
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
            {tab === 'download' && summary.success > 0 && (
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                onClick={() => {
                  setTab('upload')
                  // Keep folders loaded, go to selecting
                  setState('selecting')
                  setResults([])
                  setSummary(null)
                  setProgress(null)
                }}
              >
                <Upload className="h-4 w-4" />
                업로드 테스트로 이동
              </button>
            )}
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}
