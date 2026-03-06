import { useState, useEffect, useCallback } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { cn, formatBytes } from '../lib/utils'
import type { SyncSummary, ChartData } from '../../shared/ipc-types'

// ── Period config ──

type Period = 'today' | 'week' | 'month'

interface PeriodOption {
  id: Period
  label: string
  daysBack: number
}

const PERIOD_OPTIONS: PeriodOption[] = [
  { id: 'today', label: '오늘', daysBack: 0 },
  { id: 'week', label: '7일', daysBack: 7 },
  { id: 'month', label: '30일', daysBack: 30 },
]

function getDateRange(period: Period): { dateFrom: string; dateTo: string } {
  const now = new Date()
  const dateTo = now.toISOString().split('T')[0]

  const from = new Date(now)
  switch (period) {
    case 'today':
      break
    case 'week':
      from.setDate(from.getDate() - 7)
      break
    case 'month':
      from.setDate(from.getDate() - 30)
      break
  }
  const dateFrom = from.toISOString().split('T')[0]

  return { dateFrom, dateTo }
}

// ── Custom Recharts tooltip ──

interface TooltipPayloadItem {
  name: string
  value: number
  color: string
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="bg-card border border-border rounded-lg p-2.5 shadow-lg">
      <p className="text-xs font-medium text-card-foreground mb-1.5">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs">
          <span
            className="h-2.5 w-2.5 rounded-sm shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium text-card-foreground">{entry.value}건</span>
        </div>
      ))}
    </div>
  )
}

// ── Summary Cards ──

function SummaryCards({ summary }: { summary: SyncSummary | null }) {
  const totalFiles = summary?.totalFiles ?? 0
  const successFiles = summary?.successFiles ?? 0
  const totalBytes = summary?.totalBytes ?? 0
  const successRate = totalFiles > 0 ? ((successFiles / totalFiles) * 100).toFixed(1) : '0.0'

  const cards = [
    { label: '전체 파일', value: totalFiles.toLocaleString(), unit: '건' },
    { label: '성공률', value: successRate, unit: '%' },
    { label: '전송량', value: formatBytes(totalBytes), unit: '' },
  ]

  return (
    <div className="grid grid-cols-3 gap-3">
      {cards.map((card) => (
        <div key={card.label} className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
          <p className="text-2xl font-bold text-card-foreground">
            {card.value}
            {card.unit && <span className="text-sm font-normal text-muted-foreground ml-0.5">{card.unit}</span>}
          </p>
        </div>
      ))}
    </div>
  )
}

// ── Daily Chart ──

interface ChartDataPoint {
  label: string
  success: number
  failed: number
}

function DailyChart({ chartData }: { chartData: ChartData | null }) {
  if (!chartData || chartData.labels.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-card-foreground mb-4">일별 동기화 추이</h3>
        <div className="flex items-center justify-center h-[250px] text-sm text-muted-foreground">
          데이터가 없습니다
        </div>
      </div>
    )
  }

  const successDataset = chartData.datasets.find(
    (d) => d.label === '성공' || d.label === 'success',
  )
  const failedDataset = chartData.datasets.find(
    (d) => d.label === '실패' || d.label === 'failed',
  )

  const data: ChartDataPoint[] = chartData.labels.map((label, i) => ({
    label,
    success: successDataset?.data[i] ?? 0,
    failed: failedDataset?.data[i] ?? 0,
  }))

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-card-foreground mb-4">일별 동기화 추이</h3>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--accent) / 0.3)' }} />
          <Bar
            dataKey="success"
            name="성공"
            stackId="sync"
            fill="hsl(210, 80%, 55%)"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="failed"
            name="실패"
            stackId="sync"
            fill="hsl(0, 70%, 55%)"
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Folder Breakdown ──

function FolderBreakdown({ summary }: { summary: SyncSummary | null }) {
  const folders = summary?.byFolder ?? []

  if (folders.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-card-foreground mb-4">폴더별 현황</h3>
        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
          데이터가 없습니다
        </div>
      </div>
    )
  }

  const maxCount = Math.max(...folders.map((f) => f.fileCount), 1)

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-card-foreground mb-4">폴더별 현황</h3>
      <div className="space-y-3">
        {folders.map((folder) => {
          const percentage = (folder.fileCount / maxCount) * 100
          return (
            <div key={folder.folderName}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-card-foreground truncate max-w-[60%]">
                  {folder.folderName}
                </span>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(folder.totalBytes)}
                  </span>
                  <span className="text-xs font-medium text-card-foreground w-12 text-right">
                    {folder.fileCount}건
                  </span>
                </div>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-info rounded-full transition-all duration-500"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── StatisticsPage (main export) ──

export function StatisticsPage() {
  const [period, setPeriod] = useState<Period>('today')
  const [summary, setSummary] = useState<SyncSummary | null>(null)
  const [chartData, setChartData] = useState<ChartData | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const fetchData = useCallback(async (selectedPeriod: Period) => {
    setIsLoading(true)
    try {
      const [summaryRes, chartRes] = await Promise.all([
        window.electronAPI.invoke('stats:summary', { period: selectedPeriod }),
        (() => {
          const { dateFrom, dateTo } = getDateRange(selectedPeriod)
          return window.electronAPI.invoke('stats:chart', {
            type: 'daily' as const,
            dateFrom,
            dateTo,
          })
        })(),
      ])

      if (summaryRes.success && summaryRes.data) {
        setSummary(summaryRes.data)
      }
      if (chartRes.success && chartRes.data) {
        setChartData(chartRes.data)
      }
    } catch {
      // IPC errors handled silently; UI shows empty state
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData(period)
  }, [period, fetchData])

  const handlePeriodChange = (newPeriod: Period) => {
    setPeriod(newPeriod)
  }

  return (
    <div className="space-y-4 p-1">
      {/* Period tabs */}
      <div className="flex items-center gap-1 bg-muted rounded-lg p-1 w-fit">
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => handlePeriodChange(option.id)}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              period === option.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-3 w-3 border-2 border-info border-t-transparent rounded-full animate-spin" />
          데이터 불러오는 중...
        </div>
      )}

      {/* Summary cards */}
      <SummaryCards summary={summary} />

      {/* Charts grid */}
      <div className="grid grid-cols-2 gap-4">
        <DailyChart chartData={chartData} />
        <FolderBreakdown summary={summary} />
      </div>
    </div>
  )
}
