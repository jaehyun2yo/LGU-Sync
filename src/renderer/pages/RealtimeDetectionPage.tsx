import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import {
  Radio,
  PlayCircle,
  StopCircle,
  Trash2,
  Clock,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Bell,
  BellOff,
  Check,
  X,
  FolderOpen,
} from 'lucide-react'
import { cn } from '../lib/utils'
import {
  useDetectionStore,
  type DetectionEvent,
  type DetectionStatus,
} from '../stores/detection-store'
import type {
  DetectionEventPush,
  DetectionSessionInfo,
  FolderInfoIpc,
} from '../../shared/ipc-types'

// operCode별 색상
function getOperCodeColor(code: string): string {
  switch (code) {
    case 'UP': case 'CP': return 'text-success'
    case 'D': case 'FD': return 'text-error'
    case 'MV': case 'FMV': return 'text-warning'
    case 'RN': case 'FRN': case 'FC': return 'text-info'
    default: return 'text-muted-foreground'
  }
}

// operCode 한글 라벨
function getOperCodeLabel(code: string): string {
  switch (code) {
    case 'UP': return '업로드'
    case 'D': return '삭제'
    case 'MV': return '이동'
    case 'RN': return '이름변경'
    case 'CP': return '복사'
    case 'FC': return '폴더생성'
    case 'FD': return '폴더삭제'
    case 'FMV': return '폴더이동'
    case 'FRN': return '폴더이름변경'
    default: return code
  }
}

// 이벤트 타입 한글 라벨
function getEventLabel(type: DetectionEventPush['type']): string {
  switch (type) {
    case 'started': return '시작'
    case 'detected': return '감지됨'
    case 'downloaded': return '완료'
    case 'failed': return '실패'
    case 'error': return '오류'
    case 'stopped': return '중지'
    case 'recovery': return '복구'
    default: return type
  }
}

// 상태 배지 색상
function getStatusBadgeColor(type: DetectionEventPush['type']): string {
  switch (type) {
    case 'started': return 'bg-info/10 text-info border-info/20'
    case 'detected': return 'bg-warning/10 text-warning border-warning/20'
    case 'downloaded': return 'bg-success/10 text-success border-success/20'
    case 'failed': case 'error': return 'bg-error/10 text-error border-error/20'
    case 'stopped': return 'bg-muted text-muted-foreground border-border'
    case 'recovery': return 'bg-info/10 text-info border-info/20'
    default: return 'bg-muted text-muted-foreground border-border'
  }
}

// 감지 상태 라벨
function getStatusLabel(status: DetectionStatus): string {
  switch (status) {
    case 'running': return '감지 중'
    case 'starting': return '시작 중...'
    case 'stopping': return '중지 중...'
    case 'recovering': return '복구 중...'
    case 'stopped': return '대기'
    default: return status
  }
}

// 종료 사유 라벨
function getStopReasonLabel(reason: DetectionSessionInfo['stopReason']): string {
  switch (reason) {
    case 'manual': return '수동 중지'
    case 'crash': return '비정상 종료'
    case 'app-quit': return '앱 종료'
    case 'error': return '오류'
    default: return '-'
  }
}

function formatSessionDuration(startedAt: string, stoppedAt: string | null): string {
  const start = new Date(startedAt).getTime()
  const end = stoppedAt ? new Date(stoppedAt).getTime() : Date.now()
  const diffMs = end - start
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `${sec}초`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}분 ${sec % 60}초`
  const hr = Math.floor(min / 60)
  return `${hr}시간 ${min % 60}분`
}

// 다운로드 폴더 삭제 버튼
function ClearDownloadsButton() {
  const [clearing, setClearing] = useState(false)

  const handleClear = async () => {
    if (!confirm('다운로드 폴더의 모든 파일과 하위 폴더를 삭제하시겠습니까?')) return
    setClearing(true)
    try {
      const res = await window.electronAPI.invoke('test:clear-downloads')
      if (res.success && res.data) {
        const { deletedFiles, deletedFolders, resetRecords } = res.data
        alert(`삭제 완료: 폴더 ${deletedFolders}개, 파일 ${deletedFiles}개, DB 레코드 ${resetRecords}건 초기화`)
      } else {
        alert(`삭제 실패: ${res.error?.message ?? '알 수 없는 오류'}`)
      }
    } catch (e) {
      alert(`삭제 실패: ${(e as Error).message}`)
    } finally {
      setClearing(false)
    }
  }

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-error/30 bg-error/10 text-error hover:bg-error/20 transition-colors disabled:opacity-50"
      onClick={handleClear}
      disabled={clearing}
      title="다운로드 폴더 전체 삭제"
    >
      <Trash2 className="h-3.5 w-3.5" />
      {clearing ? '삭제 중...' : '폴더 삭제'}
    </button>
  )
}

// 감지 상태 패널
function StatusPanel() {
  const { status, currentSessionStats, lastDetectedAt, lastPollAt, startingStep, start, stop } = useDetectionStore()
  const isRunning = status === 'running'
  const isActive = status === 'running' || status === 'starting' || status === 'stopping' || status === 'recovering'

  // 실시간 경과 시간 카운터 (1초마다 갱신)
  const [uptime, setUptime] = useState<string>('')
  useEffect(() => {
    if (!isRunning || !currentSessionStats) {
      setUptime('')
      return
    }
    const update = () => setUptime(formatSessionDuration(currentSessionStats.startedAt, null))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [isRunning, currentSessionStats])

  const hasFailed = (currentSessionStats?.filesFailed ?? 0) > 0

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* 상단: 상태 + 시간 + 버튼 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* 상태 표시 */}
          <div className="flex items-center gap-2">
            {isRunning && (
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
              </span>
            )}
            {(status === 'starting') && (
              <RefreshCw className="h-3.5 w-3.5 text-info animate-spin" />
            )}
            {status === 'recovering' && (
              <RefreshCw className="h-3.5 w-3.5 text-info animate-spin" />
            )}
            <span className={cn('text-sm font-medium', isRunning ? 'text-success' : status === 'starting' ? 'text-info' : status === 'recovering' ? 'text-info' : 'text-muted-foreground')}>
              {status === 'starting' && startingStep
                ? `${startingStep.message} (${startingStep.current}/${startingStep.total})`
                : getStatusLabel(status)}
            </span>
            {uptime && (
              <span className="text-xs text-muted-foreground">({uptime})</span>
            )}
          </div>

          {/* 마지막 감지 시간 */}
          {lastDetectedAt && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>마지막 감지: {new Date(lastDetectedAt).toLocaleTimeString('ko-KR')}</span>
            </div>
          )}

          {/* 마지막 폴링 시간 */}
          {lastPollAt && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>폴링: {new Date(lastPollAt).toLocaleTimeString('ko-KR')}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* 다운로드 폴더 열기 */}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-muted text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            onClick={() => window.electronAPI.invoke('test:open-download-folder')}
            title="다운로드 폴더 열기"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            다운로드 폴더
          </button>

          {/* 다운로드 폴더 삭제 */}
          <ClearDownloadsButton />

          {/* 알림 설정 */}
          <WatchFolderSettings />

          {/* 시작/중지 버튼 */}
          {isActive ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-error text-error-foreground hover:bg-error/90 transition-colors disabled:opacity-50"
              onClick={stop}
              disabled={status !== 'running'}
            >
              <StopCircle className="h-4 w-4" />
              {status === 'stopping' ? '중지 중...' : status === 'recovering' ? '복구 중...' : '감지 중지'}
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              onClick={start}
            >
              <PlayCircle className="h-4 w-4" />
              감지 시작
            </button>
          )}
        </div>
      </div>

      {/* 시작 진행률 바 */}
      {status === 'starting' && startingStep && (
        <div className="h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-info rounded-full transition-all duration-300"
            style={{ width: `${(startingStep.current / startingStep.total) * 100}%` }}
          />
        </div>
      )}

      {/* 하단: 통계 카드 (세션 진행 중일 때만 표시) */}
      {currentSessionStats && (
        <div className="grid grid-cols-3 gap-3">
          {/* 감지 카드 */}
          <div className="rounded-md border border-warning/20 bg-warning/5 px-3 py-2">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">감지</p>
            <p className="text-2xl font-bold text-warning mt-0.5">{currentSessionStats.filesDetected}</p>
            <p className="text-[10px] text-muted-foreground">건</p>
          </div>

          {/* 완료 카드 */}
          <div className="rounded-md border border-success/20 bg-success/5 px-3 py-2">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">완료</p>
            <p className="text-2xl font-bold text-success mt-0.5">{currentSessionStats.filesDownloaded}</p>
            <p className="text-[10px] text-muted-foreground">건</p>
          </div>

          {/* 실패 카드 */}
          <div className={cn(
            'rounded-md border px-3 py-2',
            hasFailed
              ? 'border-error/30 bg-error/10'
              : 'border-border bg-muted/30',
          )}>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">실패</p>
            <p className={cn('text-2xl font-bold mt-0.5', hasFailed ? 'text-error' : 'text-muted-foreground')}>
              {currentSessionStats.filesFailed}
            </p>
            <p className="text-[10px] text-muted-foreground">건</p>
          </div>
        </div>
      )}
    </div>
  )
}

type FilterType = 'all' | 'downloaded' | 'failed' | 'detected'

// 이벤트 로그 테이블
function EventLogTable() {
  const { events, clearEvents } = useDetectionStore()
  const logRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<FilterType>('all')

  const filteredEvents = useMemo(() => {
    if (filter === 'all') return events
    if (filter === 'failed') return events.filter((e) => e.type === 'failed' || e.type === 'error')
    return events.filter((e) => e.type === filter)
  }, [events, filter])

  // 새 이벤트 추가 시 맨 위로 스크롤
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = 0
    }
  }, [events.length])

  const filterButtons: { key: FilterType; label: string; count?: number }[] = [
    { key: 'all', label: '전체', count: events.length },
    { key: 'downloaded', label: '완료', count: events.filter((e) => e.type === 'downloaded').length },
    { key: 'failed', label: '실패/오류', count: events.filter((e) => e.type === 'failed' || e.type === 'error').length },
    { key: 'detected', label: '감지됨', count: events.filter((e) => e.type === 'detected').length },
  ]

  return (
    <div className="flex-1 min-h-0 rounded-lg border border-border bg-card overflow-hidden flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/50">
        {/* 필터 버튼 */}
        <div className="flex items-center gap-1">
          {filterButtons.map((btn) => (
            <button
              key={btn.key}
              type="button"
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-colors',
                filter === btn.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              onClick={() => setFilter(btn.key)}
            >
              {btn.label}
              {btn.count !== undefined && btn.count > 0 && (
                <span className={cn(
                  'inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-[10px] font-bold',
                  filter === btn.key
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : btn.key === 'failed' && btn.count > 0
                      ? 'bg-error/20 text-error'
                      : 'bg-muted-foreground/20 text-muted-foreground',
                )}>
                  {btn.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {events.length > 0 && (
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={clearEvents}
          >
            <Trash2 className="h-3 w-3" />
            로그 지우기
          </button>
        )}
      </div>

      {/* 컬럼 헤더 */}
      <div className="flex items-center px-4 py-1.5 border-b border-border bg-muted/30 text-[10px] font-medium text-muted-foreground">
        <span className="w-20 shrink-0">시간</span>
        <span className="w-20 shrink-0">상태</span>
        <span className="w-16 shrink-0">유형</span>
        <span className="flex-1 min-w-0">경로 / 파일명</span>
        <span className="w-56 shrink-0">메시지</span>
      </div>

      {/* 이벤트 목록 */}
      <div ref={logRef} className="flex-1 overflow-y-auto font-mono text-xs">
        {filteredEvents.length === 0 ? (
          <EmptyEventState status={useDetectionStore.getState().status} isFiltered={filter !== 'all'} />
        ) : (
          filteredEvents.map((evt) => (
            <EventRow key={evt.id} event={evt} />
          ))
        )}
      </div>

      {/* 푸터 - 이벤트 수 */}
      <div className="px-4 py-1.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
        {filter === 'all'
          ? `${events.length}개 이벤트 (최대 500개)`
          : `${filteredEvents.length}개 표시 중 (전체 ${events.length}개)`}
      </div>
    </div>
  )
}

function EmptyEventState({ status, isFiltered }: { status: DetectionStatus; isFiltered: boolean }) {
  if (isFiltered) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
        <p className="text-sm">해당 유형의 이벤트가 없습니다</p>
      </div>
    )
  }

  if (status === 'running') {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-success" />
        </span>
        <p className="text-sm text-muted-foreground">새 파일 감지 대기 중...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-32 gap-2">
      <Radio className="h-8 w-8 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">감지를 시작하면 이벤트 로그가 표시됩니다</p>
    </div>
  )
}

/** filePath에서 디렉토리 부분만 추출 (파일명 제외) */
function extractDirPath(filePath?: string): string {
  if (!filePath) return '-'
  const lastSlash = filePath.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return filePath.substring(0, lastSlash)
}

/** 에러 메시지에서 [카테고리] 부분을 추출 */
function extractErrorCategory(message: string): { category: string; detail: string } | null {
  const match = message.match(/^\[(.+?)\]\s*(.+)$/)
  if (!match) return null
  return { category: match[1], detail: match[2] }
}

function EventRow({ event }: { event: DetectionEvent }) {
  const isError = event.type === 'failed' || event.type === 'error'
  const dirPath = extractDirPath(event.filePath)
  const errorInfo = isError ? extractErrorCategory(event.message) : null

  return (
    <div className={cn(
      'flex items-start px-4 py-1.5 border-b border-border/30 hover:bg-accent/30 transition-colors',
      isError && 'bg-error/5 hover:bg-error/10',
    )}>
      <span className="w-20 shrink-0 text-muted-foreground pt-0.5">
        {new Date(event.timestamp).toLocaleTimeString('ko-KR')}
      </span>
      <span className="w-20 shrink-0 pt-0.5">
        <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border', getStatusBadgeColor(event.type))}>
          {getEventLabel(event.type)}
        </span>
      </span>
      <span className={cn('w-16 shrink-0 pt-0.5', event.operCode ? getOperCodeColor(event.operCode) : 'text-muted-foreground')} title={event.operCode ?? undefined}>
        {event.operCode ? getOperCodeLabel(event.operCode) : '-'}
      </span>
      <span className="flex-1 min-w-0 flex flex-col justify-center">
        {dirPath !== '-' && (
          <span className="truncate text-muted-foreground text-[10px]" title={event.filePath}>
            {dirPath}
          </span>
        )}
        <span className="truncate" title={event.fileName ?? undefined}>
          {event.fileName ?? '-'}
        </span>
      </span>
      <span className="w-56 shrink-0 flex flex-col justify-center" title={event.message}>
        {errorInfo ? (
          <>
            <span className="text-error font-medium text-[10px]">{errorInfo.category}</span>
            <span className="truncate text-muted-foreground text-[10px]">{errorInfo.detail}</span>
          </>
        ) : (
          <span className="truncate text-muted-foreground">{event.message}</span>
        )}
      </span>
    </div>
  )
}

// 알림 설정 패널
function WatchFolderSettings() {
  const { watchFolderIds, setWatchFolders, fetchWatchFolders } = useDetectionStore()
  const [open, setOpen] = useState(false)
  const [folders, setFolders] = useState<FolderInfoIpc[]>([])
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set())
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [saving, setSaving] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // 초기 로드
  useEffect(() => {
    fetchWatchFolders()
  }, [fetchWatchFolders])

  // 패널 열기 시 폴더 목록 조회 및 선택 상태 동기화
  const handleOpen = useCallback(async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setLoadingFolders(true)
    try {
      const res = await window.electronAPI.invoke('folders:list', {})
      if (res.success && res.data) {
        setFolders(res.data)
      }
    } catch {
      // 조회 실패 무시
    } finally {
      setLoadingFolders(false)
    }
    setLocalSelected(new Set(watchFolderIds))
  }, [open, watchFolderIds])

  // 패널 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const toggleFolder = useCallback((folderId: string) => {
    setLocalSelected((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      return next
    })
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await setWatchFolders(Array.from(localSelected))
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }, [localSelected, setWatchFolders])

  const activeCount = watchFolderIds.length

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border transition-colors',
          activeCount > 0
            ? 'border-info/30 bg-info/10 text-info hover:bg-info/20'
            : 'border-border bg-muted text-muted-foreground hover:bg-accent',
        )}
        onClick={handleOpen}
      >
        {activeCount > 0 ? (
          <Bell className="h-3.5 w-3.5" />
        ) : (
          <BellOff className="h-3.5 w-3.5" />
        )}
        알림 설정
        {activeCount > 0 && (
          <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-info text-info-foreground text-[10px] font-bold">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 rounded-lg border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-medium">폴더별 알림 설정</span>
            <button
              type="button"
              className="p-1 rounded hover:bg-accent"
              onClick={() => setOpen(false)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto px-2 py-2">
            {loadingFolders ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                폴더 목록 불러오는 중...
              </div>
            ) : folders.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                등록된 폴더가 없습니다.
              </div>
            ) : (
              folders.map((folder) => {
                const isSelected = localSelected.has(folder.folderId)
                return (
                  <button
                    key={folder.folderId}
                    type="button"
                    className={cn(
                      'flex items-center gap-3 w-full px-3 py-2 rounded-md text-left transition-colors',
                      isSelected ? 'bg-info/10' : 'hover:bg-accent',
                    )}
                    onClick={() => toggleFolder(folder.folderId)}
                  >
                    <div
                      className={cn(
                        'flex items-center justify-center h-4 w-4 rounded border transition-colors shrink-0',
                        isSelected
                          ? 'bg-info border-info text-info-foreground'
                          : 'border-muted-foreground/40',
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm truncate block">{folder.folderName}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {folder.fileCount}개 파일
                      </span>
                    </div>
                  </button>
                )
              })
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30">
            <span className="text-xs text-muted-foreground">
              {localSelected.size}개 선택됨
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-accent transition-colors"
                onClick={() => setOpen(false)}
              >
                취소
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// 세션 기록 (서버 데이터 기반)
function SessionHistory() {
  const { sessions, sessionsPagination, fetchSessions, isLoading } = useDetectionStore()
  const [collapsed, setCollapsed] = useState(true)

  // 페이지 초기 로드
  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  if (sessions.length === 0 && !isLoading) return null

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* 접기/펼치기 헤더 */}
      <button
        type="button"
        className="flex items-center justify-between w-full px-4 py-2 border-b border-border bg-muted/50 hover:bg-muted/80 transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          {isLoading && <RefreshCw className="h-3 w-3 animate-spin" />}
          감지 세션 기록 ({sessionsPagination.total}건)
        </span>
        {collapsed
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        }
      </button>

      {!collapsed && (
        <>
          <div className="max-h-64 overflow-y-auto">
            {/* 테이블 헤더 */}
            <div className="flex items-center gap-4 px-4 py-1.5 border-b border-border bg-muted/30 text-[10px] font-medium text-muted-foreground sticky top-0">
              <span className="w-36">시작 - 종료</span>
              <span className="w-20">소요 시간</span>
              <span className="w-20">종료 사유</span>
              <span className="w-16 text-right">감지</span>
              <span className="w-16 text-right">다운로드</span>
              <span className="w-16 text-right">실패</span>
            </div>
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </div>
          {/* 페이지네이션 */}
          {sessionsPagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 px-4 py-2 border-t border-border">
              <button
                type="button"
                className="p-1 rounded hover:bg-accent disabled:opacity-30"
                disabled={sessionsPagination.page <= 1}
                onClick={() => fetchSessions(sessionsPagination.page - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs text-muted-foreground">
                {sessionsPagination.page} / {sessionsPagination.totalPages}
              </span>
              <button
                type="button"
                className="p-1 rounded hover:bg-accent disabled:opacity-30"
                disabled={sessionsPagination.page >= sessionsPagination.totalPages}
                onClick={() => fetchSessions(sessionsPagination.page + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SessionRow({ session }: { session: DetectionSessionInfo }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-border/30 text-xs">
      <span className="w-36 text-muted-foreground">
        {new Date(session.startedAt).toLocaleString('ko-KR', {
          month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        })}
        {' - '}
        {session.stoppedAt
          ? new Date(session.stoppedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
          : '진행 중'}
      </span>
      <span className="w-20 text-muted-foreground">
        {formatSessionDuration(session.startedAt, session.stoppedAt)}
      </span>
      <span className={cn('w-20', session.stopReason === 'crash' || session.stopReason === 'error' ? 'text-error' : 'text-muted-foreground')}>
        {getStopReasonLabel(session.stopReason)}
      </span>
      <span className="w-16 text-right">
        <span className="font-medium text-warning">{session.filesDetected}</span>
      </span>
      <span className="w-16 text-right">
        <span className="font-medium text-success">{session.filesDownloaded}</span>
      </span>
      <span className="w-16 text-right">
        <span className={cn('font-medium', session.filesFailed > 0 ? 'text-error' : 'text-muted-foreground')}>{session.filesFailed}</span>
      </span>
    </div>
  )
}

export function RealtimeDetectionPage() {
  return (
    <div className="flex flex-col h-full gap-4">
      {/* 헤더 */}
      <div>
        <div className="flex items-center gap-3">
          <Radio className="h-5 w-5 text-info" />
          <h2 className="text-lg font-semibold text-card-foreground">실시간 감지</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          파일 감지, 다운로드, 업로드 등 모든 동기화 활동을 실시간으로 표시합니다.
        </p>
      </div>

      {/* 상태 패널 */}
      <StatusPanel />

      {/* 이벤트 로그 테이블 */}
      <EventLogTable />

      {/* 세션 기록 */}
      <SessionHistory />
    </div>
  )
}
