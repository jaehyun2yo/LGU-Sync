import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Search,
  Download,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Info,
  AlertTriangle,
  Bug,
} from 'lucide-react'
import { cn, formatTime } from '../lib/utils'
import { useLogStore } from '../stores/log-store'
import type { LogEntry } from '../../shared/ipc-types'
import type { LogLevel } from '../../core/types/logger.types'

// ── Level config ──

const LEVEL_CONFIG: Record<LogLevel, { label: string; colorClass: string; icon: React.ComponentType<{ className?: string }> }> = {
  debug: { label: 'DEBUG', colorClass: 'text-muted-foreground', icon: Bug },
  info: { label: 'INFO', colorClass: 'text-info', icon: Info },
  warn: { label: 'WARN', colorClass: 'text-warning', icon: AlertTriangle },
  error: { label: 'ERROR', colorClass: 'text-error', icon: AlertCircle },
}

const ALL_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']

// ── LevelBadge ──

function LevelBadge({ level }: { level: LogLevel }) {
  const config = LEVEL_CONFIG[level]
  const Icon = config.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium',
        level === 'debug' && 'bg-muted text-muted-foreground',
        level === 'info' && 'bg-info/10 text-info',
        level === 'warn' && 'bg-warning/10 text-warning',
        level === 'error' && 'bg-error/10 text-error',
      )}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  )
}

// ── ExportDropdown ──

function ExportDropdown() {
  const [open, setOpen] = useState(false)
  const { exportLogs } = useLogStore()
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleExport = async (format: 'csv' | 'json') => {
    setOpen(false)
    await exportLogs(format)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-accent-foreground hover:bg-accent/80 transition-colors"
      >
        <Download className="h-3.5 w-3.5" />
        내보내기
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-32 bg-card border border-border rounded-md shadow-lg z-10">
          <button
            onClick={() => handleExport('csv')}
            className="w-full text-left px-3 py-2 text-xs text-card-foreground hover:bg-accent/50 transition-colors rounded-t-md"
          >
            CSV 내보내기
          </button>
          <button
            onClick={() => handleExport('json')}
            className="w-full text-left px-3 py-2 text-xs text-card-foreground hover:bg-accent/50 transition-colors rounded-b-md"
          >
            JSON 내보내기
          </button>
        </div>
      )}
    </div>
  )
}

// ── ExpandedLogRow ──

function ExpandedLogRow({ entry }: { entry: LogEntry }) {
  return (
    <tr>
      <td colSpan={4} className="px-4 py-3 bg-muted/30 border-b border-border">
        <div className="space-y-2 text-xs">
          <div>
            <span className="font-medium text-card-foreground">전체 메시지:</span>
            <p className="mt-0.5 text-muted-foreground whitespace-pre-wrap break-all">{entry.message}</p>
          </div>
          {entry.stackTrace && (
            <div>
              <span className="font-medium text-error">스택 트레이스:</span>
              <pre className="mt-0.5 p-2 bg-background rounded border border-border text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
                {entry.stackTrace}
              </pre>
            </div>
          )}
          {entry.details && Object.keys(entry.details).length > 0 && (
            <div>
              <span className="font-medium text-card-foreground">컨텍스트:</span>
              <pre className="mt-0.5 p-2 bg-background rounded border border-border text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(entry.details, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── LogRow ──

function LogRow({ entry, isExpanded, onToggle, onRetry }: {
  entry: LogEntry
  isExpanded: boolean
  onToggle: () => void
  onRetry?: () => void
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          'cursor-pointer hover:bg-accent/30 transition-colors border-b border-border/50',
          isExpanded && 'bg-accent/20',
          entry.level === 'error' && 'bg-error/5',
        )}
      >
        <td className="px-3 py-2 w-8">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap font-mono">
          {formatTime(entry.timestamp)}
        </td>
        <td className="px-3 py-2">
          <LevelBadge level={entry.level} />
        </td>
        <td className="px-3 py-2 text-xs text-card-foreground">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate max-w-[600px]">{entry.message}</span>
            {entry.level === 'error' && onRetry && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onRetry()
                }}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-error/10 text-error hover:bg-error/20 transition-colors shrink-0"
              >
                <RefreshCw className="h-3 w-3" />
                재시도
              </button>
            )}
          </div>
        </td>
      </tr>
      {isExpanded && <ExpandedLogRow entry={entry} />}
    </>
  )
}

// ── FilterBar ──

function FilterBar() {
  const { filters, setFilter } = useLogStore()
  const [searchInput, setSearchInput] = useState(filters.search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        setFilter({ search: value })
      }, 300)
    },
    [setFilter],
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const toggleLevel = (level: LogLevel) => {
    const current = filters.levels
    if (current.includes(level)) {
      setFilter({ levels: current.filter((l) => l !== level) })
    } else {
      setFilter({ levels: [...current, level] })
    }
  }

  const isAllSelected = filters.levels.length === 0

  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Level filters */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFilter({ levels: [] })}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
              isAllSelected
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            ALL
          </button>
          {ALL_LEVELS.map((level) => {
            const config = LEVEL_CONFIG[level]
            const isActive = filters.levels.includes(level)
            return (
              <button
                key={level}
                onClick={() => toggleLevel(level)}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                  isActive
                    ? cn(
                        config.colorClass,
                        level === 'debug' && 'bg-muted',
                        level === 'info' && 'bg-info/10',
                        level === 'warn' && 'bg-warning/10',
                        level === 'error' && 'bg-error/10',
                      )
                    : 'text-muted-foreground hover:bg-accent/50',
                )}
              >
                {config.label}
              </button>
            )
          })}
        </div>

        {/* Separator */}
        <div className="h-5 w-px bg-border" />

        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilter({ dateFrom: e.target.value })}
            className="px-2 py-1 text-xs bg-background border border-border rounded-md text-card-foreground focus:outline-none focus:ring-1 focus:ring-info"
          />
          <span className="text-xs text-muted-foreground">~</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilter({ dateTo: e.target.value })}
            className="px-2 py-1 text-xs bg-background border border-border rounded-md text-card-foreground focus:outline-none focus:ring-1 focus:ring-info"
          />
        </div>

        {/* Separator */}
        <div className="h-5 w-px bg-border" />

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="로그 검색..."
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-background border border-border rounded-md text-card-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-info"
          />
        </div>

        {/* Export */}
        <ExportDropdown />
      </div>
    </div>
  )
}

// ── Pagination ──

function Pagination() {
  const { page, totalPages, setPage } = useLogStore()

  if (totalPages <= 1) return null

  const getVisiblePages = (): (number | 'ellipsis')[] => {
    const pages: (number | 'ellipsis')[] = []
    const maxVisible = 7

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
      return pages
    }

    pages.push(1)

    if (page > 3) {
      pages.push('ellipsis')
    }

    const start = Math.max(2, page - 1)
    const end = Math.min(totalPages - 1, page + 1)

    for (let i = start; i <= end; i++) {
      pages.push(i)
    }

    if (page < totalPages - 2) {
      pages.push('ellipsis')
    }

    pages.push(totalPages)
    return pages
  }

  return (
    <div className="flex items-center justify-center gap-1">
      <button
        onClick={() => setPage(page - 1)}
        disabled={page <= 1}
        className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:bg-accent/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        이전
      </button>
      {getVisiblePages().map((p, idx) =>
        p === 'ellipsis' ? (
          <span key={`ellipsis-${idx}`} className="px-1.5 text-xs text-muted-foreground">
            ...
          </span>
        ) : (
          <button
            key={p}
            onClick={() => setPage(p)}
            className={cn(
              'px-2.5 py-1 text-xs rounded-md transition-colors',
              p === page
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            {p}
          </button>
        ),
      )}
      <button
        onClick={() => setPage(page + 1)}
        disabled={page >= totalPages}
        className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:bg-accent/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        다음
      </button>
    </div>
  )
}

// ── SummaryBar ──

function SummaryBar() {
  const { logs, total } = useLogStore()

  const counts = {
    info: logs.filter((l) => l.level === 'info').length,
    warn: logs.filter((l) => l.level === 'warn').length,
    error: logs.filter((l) => l.level === 'error').length,
  }

  return (
    <div className="bg-card border border-border rounded-lg px-4 py-2 flex items-center gap-4">
      <span className="text-xs text-muted-foreground">
        전체: <span className="font-medium text-card-foreground">{total.toLocaleString()}</span>건
      </span>
      <div className="h-3 w-px bg-border" />
      <span className="text-xs text-info">
        INFO: <span className="font-medium">{counts.info}</span>
      </span>
      <span className="text-xs text-warning">
        WARN: <span className="font-medium">{counts.warn}</span>
      </span>
      <span className="text-xs text-error">
        ERROR: <span className="font-medium">{counts.error}</span>
      </span>
    </div>
  )
}

// ── LogViewerPage (main export) ──

export function LogViewerPage() {
  const { logs, isLoading, fetchLogs } = useLogStore()
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleRetry = async (entry: LogEntry) => {
    // Retry failed event via IPC if details contain an eventId
    const eventId = entry.details?.eventId as string | undefined
    if (eventId) {
      await window.electronAPI.invoke('sync:retry-failed', { eventIds: [eventId] })
      fetchLogs()
    }
  }

  return (
    <div className="flex flex-col gap-3 p-1 h-full">
      {/* Filter bar */}
      <FilterBar />

      {/* Log table */}
      <div className="flex-1 bg-card border border-border rounded-lg overflow-hidden flex flex-col min-h-0">
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="h-5 w-5 text-muted-foreground animate-spin" />
              <span className="ml-2 text-sm text-muted-foreground">로그 불러오는 중...</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Info className="h-8 w-8 mb-2 opacity-30" />
              <span className="text-sm">로그가 없습니다</span>
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground w-8" />
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                    시간
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                    레벨
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">
                    메시지
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs.map((entry) => (
                  <LogRow
                    key={entry.id}
                    entry={entry}
                    isExpanded={expandedIds.has(entry.id)}
                    onToggle={() => toggleExpand(entry.id)}
                    onRetry={entry.level === 'error' ? () => handleRetry(entry) : undefined}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Bottom: Summary + Pagination */}
      <div className="flex items-center justify-between gap-4">
        <SummaryBar />
        <Pagination />
      </div>
    </div>
  )
}
