import { useEffect, useCallback } from 'react'
import { Layout } from './components/Layout'
import { useUiStore, type PageId } from './stores/ui-store'
import { useSyncStore } from './stores/sync-store'
import { useNotificationStore } from './stores/notification-store'
import { useIpcEvent } from './hooks/useIpcEvent'

// Lazy page components
import { DashboardPage } from './pages/DashboardPage'
import { FileExplorerPage } from './pages/FileExplorerPage'
import { FolderSettingsPage } from './pages/FolderSettingsPage'
import { LogViewerPage } from './pages/LogViewerPage'
import { StatisticsPage } from './pages/StatisticsPage'
import { SettingsPage } from './pages/SettingsPage'
import { MigrationPage } from './pages/MigrationPage'
import { TestPage } from './pages/TestPage'

function PageRouter() {
  const currentPage = useUiStore((s) => s.currentPage)

  const activePage = (() => {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardPage />
      case 'file-explorer':
        return <FileExplorerPage />
      case 'folder-settings':
        return <FolderSettingsPage />
      case 'sync-log':
        return <LogViewerPage />
      case 'statistics':
        return <StatisticsPage />
      case 'migration':
        return <MigrationPage />
      case 'settings':
        return <SettingsPage />
      default:
        return <DashboardPage />
    }
  })()

  return (
    <>
      {currentPage !== 'test' && activePage}
      <div className={currentPage === 'test' ? 'flex flex-col h-full' : 'hidden'}>
        <TestPage />
      </div>
    </>
  )
}

function App() {
  const { theme, setPage } = useUiStore()
  const { fetchStatus, handleProgress, handleFileCompleted, handleFileFailed, handleStatusChanged } =
    useSyncStore()
  const { fetchNotifications } = useNotificationStore()

  // Initialize theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // Fetch initial data
  useEffect(() => {
    fetchStatus()
    fetchNotifications()
    // Periodic status refresh
    const interval = setInterval(fetchStatus, 10000)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchNotifications])

  // IPC event listeners
  const onProgress = useCallback(handleProgress, [handleProgress])
  const onFileCompleted = useCallback(handleFileCompleted, [handleFileCompleted])
  const onFileFailed = useCallback(handleFileFailed, [handleFileFailed])
  const onStatusChanged = useCallback(handleStatusChanged, [handleStatusChanged])

  useIpcEvent('sync:progress', onProgress)
  useIpcEvent('sync:file-completed', onFileCompleted)
  useIpcEvent('sync:file-failed', onFileFailed)
  useIpcEvent('sync:status-changed', onStatusChanged)

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      const shortcuts: Record<string, PageId> = {
        '1': 'dashboard',
        '2': 'file-explorer',
        '3': 'folder-settings',
        '4': 'sync-log',
        '5': 'statistics',
        '6': 'migration',
        '7': 'test',
        ',': 'settings',
      }
      const page = shortcuts[e.key]
      if (page) {
        e.preventDefault()
        setPage(page)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setPage])

  return (
    <Layout>
      <PageRouter />
    </Layout>
  )
}

export default App
