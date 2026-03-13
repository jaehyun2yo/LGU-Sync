import {
  LayoutDashboard,
  FolderSync,
  Settings,
  ChevronLeft,
  ChevronRight,
  Radio,
  RefreshCw,
  ArrowDown,
  ArrowUp,
  Search,
} from 'lucide-react'
import { cn, formatBytes, formatDuration } from '../lib/utils'
import { useUiStore, type PageId } from '../stores/ui-store'
import { useSyncStore } from '../stores/sync-store'

interface NavItem {
  id: PageId
  label: string
  icon: React.ComponentType<{ className?: string }>
  shortcut: string
}

const mainNav: NavItem[] = [
  { id: 'dashboard', label: '대시보드', icon: LayoutDashboard, shortcut: 'Ctrl+1' },
  { id: 'realtime-detection', label: '실시간 감지', icon: Radio, shortcut: 'Ctrl+2' },
]

const bottomNav: NavItem[] = [
  { id: 'settings', label: '설정', icon: Settings, shortcut: 'Ctrl+,' },
]

function ConnectionDot({ connected, label }: { connected: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn('h-2 w-2 rounded-full', connected ? 'bg-success' : 'bg-error')}
      />
      <span className="text-xs text-muted-foreground truncate">{label}</span>
    </div>
  )
}

function CircularProgress({ percent, title }: { percent: number; title: string }) {
  const size = 20
  const strokeWidth = 2.5
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(100, percent) / 100) * circumference

  return (
    <svg width={size} height={size} className="shrink-0" title={title}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-muted)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-info)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-all duration-300"
      />
    </svg>
  )
}

const PHASE_CONFIG: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; iconClass: string }
> = {
  scanning: { label: '스캔 중', icon: Search, iconClass: 'text-muted-foreground' },
  comparing: { label: '비교 중', icon: Search, iconClass: 'text-muted-foreground' },
  downloading: { label: '다운로드 중', icon: ArrowDown, iconClass: 'text-info animate-pulse' },
  uploading: { label: '업로드 중', icon: ArrowUp, iconClass: 'text-success animate-pulse' },
}

function SyncProgressPanel({ collapsed }: { collapsed: boolean }) {
  const { fullSyncProgress } = useSyncStore()

  if (!fullSyncProgress) return null

  const { phase, progress, currentFile, speedBps, estimatedRemainingMs } = fullSyncProgress
  const percent = Math.round(progress)
  const phaseConf = PHASE_CONFIG[phase] ?? PHASE_CONFIG.scanning
  const PhaseIcon = phaseConf.icon

  const tooltipText = `전체동기화 ${percent}% · ${phaseConf.label}${estimatedRemainingMs > 0 ? ` · ${formatDuration(estimatedRemainingMs)} 남음` : ''}`

  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-3 border-t border-sidebar-border">
        <CircularProgress percent={percent} title={tooltipText} />
      </div>
    )
  }

  return (
    <div className="px-4 py-3 border-t border-sidebar-border space-y-1.5">
      <div className="flex items-center gap-1.5">
        <RefreshCw className="h-3.5 w-3.5 text-info animate-spin shrink-0" />
        <span className="text-xs text-info font-medium truncate">전체동기화 중..</span>
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <PhaseIcon className={cn('h-3 w-3 shrink-0', phaseConf.iconClass)} />
            <span className="text-[11px] text-muted-foreground">{phaseConf.label}</span>
          </div>
          <span className="text-[11px] font-medium text-sidebar-foreground">{percent}%</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-info rounded-full transition-all duration-300"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      </div>
      {currentFile && (
        <p className="text-[11px] text-muted-foreground truncate" title={currentFile}>
          {currentFile}
        </p>
      )}
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {speedBps > 0 && <span>{formatBytes(speedBps)}/s</span>}
        {speedBps > 0 && estimatedRemainingMs > 0 && <span>·</span>}
        {estimatedRemainingMs > 0 && <span>{formatDuration(estimatedRemainingMs)}</span>}
      </div>
    </div>
  )
}

export function Sidebar() {
  const { currentPage, setPage, sidebarCollapsed, toggleSidebar } = useUiStore()
  const { lguplusConnected, webhardConnected, todayFailed } = useSyncStore()

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-all duration-200',
        sidebarCollapsed ? 'w-16' : 'w-[220px]',
      )}
    >
      {/* Logo */}
      <div className="flex items-center h-14 px-4 border-b border-sidebar-border">
        <FolderSync className="h-5 w-5 text-info shrink-0" />
        {!sidebarCollapsed && (
          <span className="ml-2 text-sm font-semibold text-sidebar-foreground truncate">
            웹하드 동기화
          </span>
        )}
        <button
          onClick={toggleSidebar}
          className="ml-auto p-1 rounded hover:bg-accent text-muted-foreground"
          aria-label={sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Main Nav */}
      <nav className="flex-1 py-2 px-2 space-y-1">
        {mainNav.map((item) => {
          const Icon = item.icon
          const isActive = currentPage === item.id
          const hasBadge = item.id === 'realtime-detection' && todayFailed > 0
          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              title={sidebarCollapsed ? `${item.label} (${item.shortcut})` : item.shortcut}
              className={cn(
                'flex items-center w-full rounded-md px-3 py-2 text-sm transition-colors relative',
                isActive
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
              )}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-info rounded-r" />
              )}
              <Icon className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && <span className="ml-3 truncate">{item.label}</span>}
              {hasBadge && (
                <span
                  className={cn(
                    'bg-error text-white text-[10px] font-bold rounded-full',
                    sidebarCollapsed
                      ? 'absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center'
                      : 'ml-auto px-1.5 py-0.5 min-w-[18px] text-center',
                  )}
                >
                  {todayFailed > 99 ? '99+' : todayFailed}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Separator + Bottom Nav */}
      <div className="px-2">
        <div className="border-t border-sidebar-border mb-1" />
        {bottomNav.map((item) => {
          const Icon = item.icon
          const isActive = currentPage === item.id
          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              title={sidebarCollapsed ? `${item.label} (${item.shortcut})` : item.shortcut}
              className={cn(
                'flex items-center w-full rounded-md px-3 py-2 text-sm transition-colors relative',
                isActive
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
              )}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-info rounded-r" />
              )}
              <Icon className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && <span className="ml-3 truncate">{item.label}</span>}
            </button>
          )
        })}
      </div>

      {/* Sync Progress */}
      <SyncProgressPanel collapsed={sidebarCollapsed} />

      {/* Connection Status */}
      {!sidebarCollapsed && (
        <div className="px-4 py-3 border-t border-sidebar-border space-y-1.5">
          <ConnectionDot connected={lguplusConnected} label="외부웹하드" />
          <ConnectionDot connected={webhardConnected} label="자체웹하드" />
        </div>
      )}
      {sidebarCollapsed && (
        <div className="flex flex-col items-center py-3 border-t border-sidebar-border gap-2">
          <div
            className={cn('h-2 w-2 rounded-full', lguplusConnected ? 'bg-success' : 'bg-error')}
            title={`외부웹하드: ${lguplusConnected ? '연결됨' : '연결 끊김'}`}
          />
          <div
            className={cn('h-2 w-2 rounded-full', webhardConnected ? 'bg-success' : 'bg-error')}
            title={`자체웹하드: ${webhardConnected ? '연결됨' : '연결 끊김'}`}
          />
        </div>
      )}
    </aside>
  )
}
