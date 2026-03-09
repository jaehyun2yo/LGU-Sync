import { useEffect } from 'react'
import { X, CheckCheck, Bell, AlertCircle, CheckCircle, AlertTriangle, Info } from 'lucide-react'
import { cn, formatRelativeTime } from '../lib/utils'
import { useNotificationStore } from '../stores/notification-store'
import type { NotificationType } from '../../shared/ipc-types'

const typeIcons: Record<NotificationType, React.ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
}

const typeColors: Record<NotificationType, string> = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
}

export function NotificationCenter() {
  const { notifications, isOpen, close, markRead, markAllRead } = useNotificationStore()

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, close])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={close} />

      {/* Panel */}
      <div role="dialog" aria-label="알림 센터" className="fixed top-14 right-4 z-50 w-[380px] max-h-[500px] bg-popover border border-border rounded-lg shadow-lg flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">알림</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={markAllRead}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent transition-colors"
              title="모두 읽음"
            >
              <CheckCheck className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={close}
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <span className="text-sm">알림이 없습니다</span>
            </div>
          ) : (
            notifications.map((n) => {
              const Icon = typeIcons[n.type]
              return (
                <div
                  key={n.id}
                  onClick={() => markRead(n.id)}
                  className={cn(
                    'flex gap-3 px-4 py-3 border-b border-border/50 cursor-pointer hover:bg-accent/50 transition-colors',
                    !n.read && 'bg-accent/20',
                  )}
                >
                  <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', typeColors[n.type])} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={cn('text-sm', !n.read ? 'font-medium' : 'text-muted-foreground')}
                      >
                        {n.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatRelativeTime(n.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{n.message}</p>
                  </div>
                  {!n.read && <div className="h-2 w-2 rounded-full bg-info shrink-0 mt-1.5" />}
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
