import { useEffect, useState } from 'react'
import { CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { useToastStore, type Toast } from '../stores/toast-store'

const ICON_MAP = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
} as const

const COLOR_MAP = {
  info: 'border-info/50 bg-info/10',
  success: 'border-success/50 bg-success/10',
  warning: 'border-warning/50 bg-warning/10',
  error: 'border-error/50 bg-error/10',
} as const

const ICON_COLOR_MAP = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
} as const

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = ICON_MAP[toast.type]
  const [progress, setProgress] = useState(100)

  useEffect(() => {
    if (toast.phase === 'exiting') return
    const start = toast.createdAt
    const duration = toast.durationMs
    let raf: number

    const tick = () => {
      const elapsed = Date.now() - start
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(remaining)
      if (remaining > 0) {
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [toast.createdAt, toast.durationMs, toast.phase])

  return (
    <div
      className={cn(
        'relative w-80 border rounded-lg shadow-lg overflow-hidden transition-all duration-300',
        COLOR_MAP[toast.type],
        toast.phase === 'entering' && 'translate-x-full opacity-0',
        toast.phase === 'visible' && 'translate-x-0 opacity-100',
        toast.phase === 'exiting' && 'translate-x-full opacity-0',
      )}
    >
      <div className="flex items-start gap-2.5 p-3">
        <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', ICON_COLOR_MAP[toast.type])} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-card-foreground">{toast.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{toast.message}</p>
        </div>
        <button
          onClick={onDismiss}
          className="p-0.5 text-muted-foreground hover:text-card-foreground transition-colors shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {/* Progress bar */}
      <div className="h-0.5 bg-border/30">
        <div
          className={cn('h-full transition-none', ICON_COLOR_MAP[toast.type].replace('text-', 'bg-'))}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const dismissToast = useToastStore((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </div>
  )
}
