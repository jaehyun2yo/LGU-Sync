import { useEffect } from 'react'
import {
  Activity,
  Pause,
  Play,
  Square,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  ArrowDown,
  ArrowUp,
  FileText,
} from 'lucide-react'
import { cn, formatBytes, formatTime } from '../lib/utils'
import { useSyncStore } from '../stores/sync-store'
import { useUiStore } from '../stores/ui-store'
import type { SyncStatusType } from '../../core/types/sync-status.types'
import type { SyncFileStatus } from '../../core/types/sync-status.types'

// ── Status config ──

const STATUS_CONFIG: Record<
  SyncStatusType,
  { label: string; colorClass: string; dotClass: string }
> = {
  idle: {
    label: '대기 중',
    colorClass: 'text-muted-foreground',
    dotClass: 'bg-muted-foreground',
  },
  syncing: {
    label: '동기화 중',
    colorClass: 'text-success',
    dotClass: 'bg-success',
  },
  paused: {
    label: '일시중지',
    colorClass: 'text-warning',
    dotClass: 'bg-warning',
  },
  error: {
    label: '오류 발생',
    colorClass: 'text-error',
    dotClass: 'bg-error',
  },
  disconnected: {
    label: '연결 끊김',
    colorClass: 'text-error',
    dotClass: 'bg-error',
  },
}

// ── File status icon helper ──

function FileStatusIcon({ status }: { status: SyncFileStatus }) {
  switch (status) {
    case 'downloaded':
      return <CheckCircle className="h-4 w-4 text-info shrink-0" />
    case 'completed':
      return <CheckCircle className="h-4 w-4 text-success shrink-0" />
    case 'downloading':
      return <ArrowDown className="h-4 w-4 text-info shrink-0 animate-pulse" />
    case 'uploading':
      return <ArrowUp className="h-4 w-4 text-info shrink-0 animate-pulse" />
    case 'dl_failed':
    case 'ul_failed':
    case 'dlq':
      return <XCircle className="h-4 w-4 text-error shrink-0" />
    case 'detected':
      return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
    case 'skipped':
      return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
    default:
      return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
  }
}

// ── SyncStatusCard ──

function SyncStatusCard() {
  const { status, start, stop, pause, resume, startFullSync, retryFailed, failedCount, fullSyncProgress } =
    useSyncStore()
  const { showConfirm } = useUiStore()
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle

  const isIdle = status === 'idle'
  const isPaused = status === 'paused'
  const isSyncing = status === 'syncing'
  const isRunning = isSyncing || isPaused

  const handleStartStop = () => {
    if (isRunning) {
      stop()
    } else {
      start()
    }
  }

  const handlePauseResume = () => {
    if (isPaused) {
      resume()
    } else {
      pause()
    }
  }

  const handleFullSync = () => {
    showConfirm('전체 동기화', '전체 동기화를 시작하시겠습니까? 시간이 다소 소요될 수 있습니다.', () => {
      startFullSync()
    })
  }

  const handleRetryFailed = () => {
    showConfirm('실패 재시도', `실패한 ${failedCount}개 파일을 다시 시도하시겠습니까?`, () => {
      retryFailed()
    })
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between">
        {/* Left: Status */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Activity className={cn('h-5 w-5', config.colorClass)} />
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card',
                config.dotClass,
              )}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={cn('text-sm font-semibold', config.colorClass)}>{config.label}</span>
              {isSyncing && (
                <RefreshCw className="h-3.5 w-3.5 text-success animate-spin" />
              )}
            </div>
            {fullSyncProgress && (
              <div className="mt-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{fullSyncProgress.phase}</span>
                  <span>{Math.round(fullSyncProgress.progress)}%</span>
                </div>
                <div className="w-48 h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                  <div
                    className="h-full bg-info rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, fullSyncProgress.progress)}%` }}
                  />
                </div>
                {fullSyncProgress.currentFile && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[250px]">
                    {fullSyncProgress.currentFile}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Action buttons */}
        <div className="flex items-center gap-2">
          {failedCount > 0 && (
            <button
              onClick={handleRetryFailed}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-error/10 text-error hover:bg-error/20 transition-colors"
            >
              <XCircle className="h-3.5 w-3.5" />
              실패 {failedCount}건 재시도
            </button>
          )}
          <button
            onClick={handleFullSync}
            disabled={isSyncing && !!fullSyncProgress}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              'bg-accent text-accent-foreground hover:bg-accent/80',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            전체 동기화
          </button>
          {isRunning && (
            <button
              onClick={handlePauseResume}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                isPaused
                  ? 'bg-success/10 text-success hover:bg-success/20'
                  : 'bg-warning/10 text-warning hover:bg-warning/20',
              )}
            >
              {isPaused ? (
                <>
                  <Play className="h-3.5 w-3.5" />
                  재개
                </>
              ) : (
                <>
                  <Pause className="h-3.5 w-3.5" />
                  일시중지
                </>
              )}
            </button>
          )}
          <button
            onClick={handleStartStop}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              isRunning
                ? 'bg-error/10 text-error hover:bg-error/20'
                : 'bg-success/10 text-success hover:bg-success/20',
            )}
          >
            {isRunning ? (
              <>
                <Square className="h-3.5 w-3.5" />
                정지
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                시작
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── QuickStats ──

function QuickStats() {
  const { todayTotal, todaySuccess, todayFailed, todayBytes } = useSyncStore()

  const stats = [
    {
      label: '전체 파일',
      value: todayTotal.toLocaleString(),
      icon: FileText,
      iconClass: 'text-info',
      bgClass: 'bg-info/10',
    },
    {
      label: '성공',
      value: todaySuccess.toLocaleString(),
      icon: CheckCircle,
      iconClass: 'text-success',
      bgClass: 'bg-success/10',
    },
    {
      label: '실패',
      value: todayFailed.toLocaleString(),
      icon: XCircle,
      iconClass: 'text-error',
      bgClass: 'bg-error/10',
    },
    {
      label: '전송량',
      value: formatBytes(todayBytes),
      icon: ArrowDown,
      iconClass: 'text-info',
      bgClass: 'bg-info/10',
    },
  ]

  return (
    <div className="grid grid-cols-4 gap-3">
      {stats.map((stat) => {
        const Icon = stat.icon
        return (
          <div
            key={stat.label}
            className="bg-card border border-border rounded-lg p-4 flex items-center gap-3"
          >
            <div className={cn('p-2 rounded-md', stat.bgClass)}>
              <Icon className={cn('h-4 w-4', stat.iconClass)} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="text-lg font-semibold text-card-foreground">{stat.value}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── OperCode config ──

const OPERCODE_CONFIG: Record<string, { label: string; colorClass: string; bgClass: string; icon: string }> = {
  UP: { label: '업로드', colorClass: 'text-success', bgClass: 'bg-success/10', icon: '↑' },
  CP: { label: '복사', colorClass: 'text-success', bgClass: 'bg-success/10', icon: '⊕' },
  D: { label: '삭제', colorClass: 'text-error', bgClass: 'bg-error/10', icon: '✕' },
  MV: { label: '이동', colorClass: 'text-info', bgClass: 'bg-info/10', icon: '→' },
  RN: { label: '이름변경', colorClass: 'text-warning', bgClass: 'bg-warning/10', icon: '✎' },
  FC: { label: '폴더생성', colorClass: 'text-purple-500', bgClass: 'bg-purple-500/10', icon: '📁' },
  FD: { label: '폴더삭제', colorClass: 'text-error', bgClass: 'bg-error/10', icon: '🗑' },
  FMV: { label: '폴더이동', colorClass: 'text-info', bgClass: 'bg-info/10', icon: '📂→' },
  FRN: { label: '폴더이름변경', colorClass: 'text-warning', bgClass: 'bg-warning/10', icon: '📝' },
}

function EventTimeline() {
  const { recentEvents } = useSyncStore()

  if (recentEvents.length === 0) {
    return null
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-card-foreground mb-3">
        실시간 이벤트
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          (최근 {recentEvents.length}건)
        </span>
      </h3>
      <div className="space-y-1 max-h-[200px] overflow-y-auto">
        {recentEvents.slice(0, 20).map((event, idx) => {
          const config = OPERCODE_CONFIG[event.operCode] ?? {
            label: event.operCode,
            colorClass: 'text-muted-foreground',
            bgClass: 'bg-muted',
            icon: '?',
          }
          return (
            <div
              key={`${event.timestamp}-${idx}`}
              className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-accent/50 transition-colors"
            >
              <span className={cn('text-xs font-mono px-1.5 py-0.5 rounded', config.bgClass, config.colorClass)}>
                {config.icon}
              </span>
              <span className={cn('text-xs font-medium shrink-0', config.colorClass)}>
                {config.label}
              </span>
              <span className="text-xs text-card-foreground truncate flex-1">
                {event.fileName}
              </span>
              <span className="text-[11px] text-muted-foreground shrink-0">
                {new Date(event.timestamp).toLocaleTimeString('ko-KR')}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── ActiveTransfers ──

function ActiveTransfers() {
  const { activeTransfers } = useSyncStore()

  if (activeTransfers.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-card-foreground mb-3">활성 전송</h3>
        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
          현재 진행 중인 전송이 없습니다
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-card-foreground mb-3">
        활성 전송
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          ({activeTransfers.length}건)
        </span>
      </h3>
      <div className="space-y-3">
        {activeTransfers.slice(0, 5).map((transfer) => (
          <div key={transfer.fileId}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 min-w-0">
                {transfer.phase === 'downloading' ? (
                  <ArrowDown className="h-3.5 w-3.5 text-info shrink-0" />
                ) : (
                  <ArrowUp className="h-3.5 w-3.5 text-success shrink-0" />
                )}
                <span className="text-xs text-card-foreground truncate">{transfer.fileName}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className="text-xs text-muted-foreground">
                  {formatBytes(transfer.speedBps)}/s
                </span>
                <span className="text-xs font-medium text-card-foreground w-10 text-right">
                  {Math.round(transfer.progress)}%
                </span>
              </div>
            </div>
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  transfer.phase === 'downloading' ? 'bg-info' : 'bg-success',
                )}
                style={{ width: `${Math.min(100, transfer.progress)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── RecentFilesList ──

function RecentFilesList() {
  const { recentFiles } = useSyncStore()

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-card-foreground mb-3">
        최근 동기화 파일
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          (최근 20건)
        </span>
      </h3>
      {recentFiles.length === 0 ? (
        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
          아직 동기화된 파일이 없습니다
        </div>
      ) : (
        <div className="space-y-0.5 max-h-[400px] overflow-y-auto">
          {recentFiles.slice(0, 20).map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-accent/50 transition-colors"
            >
              <FileStatusIcon status={file.status} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-card-foreground truncate">{file.fileName}</p>
                <p className="text-[11px] text-muted-foreground truncate">{file.folderPath}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-muted-foreground">{formatBytes(file.fileSize)}</p>
                {file.syncedAt && (
                  <p className="text-[11px] text-muted-foreground">{formatTime(file.syncedAt)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── DashboardPage (main export) ──

export function DashboardPage() {
  const { fetchStatus } = useSyncStore()

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  return (
    <div className="space-y-4 p-1">
      <SyncStatusCard />
      <QuickStats />
      <EventTimeline />
      <div className="grid grid-cols-2 gap-4">
        <ActiveTransfers />
        <RecentFilesList />
      </div>
    </div>
  )
}
