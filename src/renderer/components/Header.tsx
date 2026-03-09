import { Bell, Moon, Sun } from 'lucide-react'
import { cn } from '../lib/utils'
import { useUiStore, type PageId } from '../stores/ui-store'
import { useNotificationStore } from '../stores/notification-store'

const pageTitles: Record<PageId, string> = {
  dashboard: '대시보드',
  'file-explorer': '파일 탐색기',
  'folder-settings': '폴더 설정',
  'sync-log': '동기화 로그',
  statistics: '통계',
  migration: '마이그레이션',
  test: '테스트',
  settings: '설정',
}

export function Header() {
  const { currentPage, theme, toggleTheme } = useUiStore()
  const { toggle: toggleNotifications, unreadCount } = useNotificationStore()
  const count = unreadCount()

  return (
    <header className="flex items-center h-14 px-6 border-b border-border bg-background shrink-0">
      <h1 className="text-lg font-semibold text-foreground">{pageTitles[currentPage]}</h1>
      <div className="ml-auto flex items-center gap-2">
        {/* Notification Bell */}
        <button
          onClick={toggleNotifications}
          className="relative p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="알림"
        >
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-error text-white text-[10px] font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className={cn(
            'p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors',
          )}
          title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  )
}
