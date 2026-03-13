import { useEffect, useCallback } from 'react'
import { Layout } from './components/Layout'
import { useUiStore, type PageId } from './stores/ui-store'
import { useSyncStore } from './stores/sync-store'
import { useDetectionStore } from './stores/detection-store'
import { useNotificationStore } from './stores/notification-store'
import { useIpcEvent } from './hooks/useIpcEvent'
import { useNotificationManager } from './lib/notification-manager'

// Lazy page components
import { DashboardPage } from './pages/DashboardPage'
import { SettingsPage } from './pages/SettingsPage'
import { RealtimeDetectionPage } from './pages/RealtimeDetectionPage'

function PageRouter() {
  const currentPage = useUiStore((s) => s.currentPage)

  switch (currentPage) {
    case 'dashboard':
      return <DashboardPage />
    case 'realtime-detection':
      return <RealtimeDetectionPage />
    case 'settings':
      return <SettingsPage />
    default:
      return <DashboardPage />
  }
}

function App() {
  const { setPage } = useUiStore()
  const {
    fetchStatus,
    handleProgress,
    handleFileCompleted,
    handleFileFailed,
    handleStatusChanged,
    handleScanProgress,
    handleNewFiles,
  } = useSyncStore()
  const {
    fetchStatus: detectionFetchStatus,
    handleDetectionEvent,
    handleStatusChanged: handleDetectionStatusChanged,
    handleStartProgress,
  } = useDetectionStore()
  const { fetchNotifications } = useNotificationStore()

  // Notification orchestrator
  useNotificationManager()

  // Fetch initial data
  useEffect(() => {
    fetchStatus()
    detectionFetchStatus()
    fetchNotifications()
    // Periodic status refresh
    const interval = setInterval(fetchStatus, 10000)
    return () => clearInterval(interval)
  }, [fetchStatus, detectionFetchStatus, fetchNotifications])

  // IPC event listeners — sync events
  const onProgress = useCallback(handleProgress, [handleProgress])
  const onFileCompleted = useCallback(handleFileCompleted, [handleFileCompleted])
  const onFileFailed = useCallback(handleFileFailed, [handleFileFailed])
  const onStatusChanged = useCallback(handleStatusChanged, [handleStatusChanged])
  const onScanProgress = useCallback(handleScanProgress, [handleScanProgress])
  const onNewFiles = useCallback(handleNewFiles, [handleNewFiles])

  useIpcEvent('sync:progress', onProgress)
  useIpcEvent('sync:file-completed', onFileCompleted)
  useIpcEvent('sync:file-failed', onFileFailed)
  useIpcEvent('sync:status-changed', onStatusChanged)
  useIpcEvent('detection:scan-progress', onScanProgress)
  useIpcEvent('detection:new-files', onNewFiles)

  // IPC event listeners — detection events (global, survives page navigation)
  const onDetectionEvent = useCallback(handleDetectionEvent, [handleDetectionEvent])
  const onDetectionStatusChanged = useCallback(handleDetectionStatusChanged, [handleDetectionStatusChanged])
  const onStartProgress = useCallback(handleStartProgress, [handleStartProgress])

  useIpcEvent('detection:event', onDetectionEvent)
  useIpcEvent('detection:status-changed', onDetectionStatusChanged)
  useIpcEvent('detection:start-progress', onStartProgress)

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      const shortcuts: Record<string, PageId> = {
        '1': 'dashboard',
        '2': 'realtime-detection',
        '3': 'settings',
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
