import { app, BrowserWindow } from 'electron'
import { execSync } from 'child_process'
import path from 'path'
import { createCoreServices, type CoreServices } from '../core/container'

// Ensure UTF-8 console output on Windows (fixes Korean character garbling)
if (process.platform === 'win32') {
  try {
    execSync('chcp 65001', { stdio: 'ignore' })
  } catch {
    // ignore — no console attached (e.g. packaged app)
  }
}
import { registerIpcHandlers, bridgeEventsToRenderer, removeAllIpcHandlers } from './ipc-router'
import { WindowManager } from './window-manager'
import { TrayManager } from './tray-manager'
import { setAutoStart } from './auto-start'
import { setupAutoUpdater, checkForUpdates } from './auto-updater'
import type { EngineStatus } from '../core/types/events.types'

// ── State ──

let coreServices: CoreServices | null = null
let windowManager: WindowManager | null = null
let trayManager: TrayManager | null = null
let eventBridgeCleanup: (() => void) | null = null

// ── App Lifecycle ──

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Focus the main window if a second instance is launched
    windowManager?.show()
  })

  app.whenReady().then(async () => {
    try {
      await initialize()
    } catch (error) {
      console.error('Failed to initialize app:', error)
      app.quit()
    }
  })
}

async function initialize(): Promise<void> {
  const startMinimized = process.argv.includes('--minimized')

  // Step 1: Initialize Core services
  const dbPath = path.join(app.getPath('userData'), 'sync.db')
  coreServices = createCoreServices({ dbPath })
  coreServices.logger.info('App starting', { version: app.getVersion() })

  // Step 2: Register IPC handlers
  registerIpcHandlers(coreServices)

  // Step 3: Create Tray
  trayManager = new TrayManager({
    onShow: () => windowManager?.show(),
    onPauseResume: async () => {
      if (!coreServices) return
      const { engine } = coreServices
      if (engine.status === 'syncing') {
        await engine.pause()
      } else if (engine.status === 'paused') {
        await engine.resume()
      }
    },
    onFullSync: async () => {
      if (!coreServices) return
      await coreServices.engine.fullSync()
    },
    onQuit: () => {
      (app as any)._isQuitting = true
      app.quit()
    },
  })
  trayManager.create()

  // Step 4: Create Window
  windowManager = new WindowManager({ closeToTray: true })
  if (!startMinimized) {
    windowManager.createWindow()
  }

  // Step 5: Bridge Core events → Renderer
  eventBridgeCleanup = bridgeEventsToRenderer(coreServices, () => windowManager?.getWindow() ?? null)

  // Step 6: Listen for engine status changes to update tray
  coreServices.eventBus.on('engine:status', (data) => {
    trayManager?.updateStatus(data.next as EngineStatus)
  })

  // Step 7: Apply auto-start setting
  try {
    const systemConfig = coreServices.config.get('system')
    setAutoStart(systemConfig.autoStart)
  } catch {
    // ignore config errors
  }

  // Step 8: Auto-start sync if credentials are configured
  try {
    const lguplusConfig = coreServices.config.get('lguplus')
    if (lguplusConfig.username && lguplusConfig.password) {
      const loginResult = await coreServices.lguplus.login(
        lguplusConfig.username,
        lguplusConfig.password,
      )
      if (loginResult.success) {
        // Discover LGU+ folders before starting sync
        try {
          const discovery = await coreServices.folderDiscovery.discoverFolders()
          coreServices.logger.info('Folder discovery completed on startup', {
            total: discovery.total,
            newFolders: discovery.newFolders,
          })
        } catch (discoverError) {
          coreServices.logger.warn('Folder discovery failed on startup, continuing with existing folders', {
            error: (discoverError as Error).message,
          })
        }

        await coreServices.engine.start()
        coreServices.logger.info('Auto-started sync engine')
      }
    }
  } catch (error) {
    coreServices.logger.warn('Auto-start sync failed', { error: (error as Error).message })
  }

  // Step 9: Setup auto-updater and check for updates
  setupAutoUpdater(coreServices.logger)
  checkForUpdates(coreServices.logger)

  coreServices.logger.info('App initialized')
}

// ── Graceful Shutdown ──

app.on('before-quit', async (event) => {
  (app as any)._isQuitting = true

  if (coreServices && coreServices.engine.status === 'syncing') {
    event.preventDefault()

    coreServices.logger.info('Graceful shutdown: stopping sync engine...')

    // Stop with 5s timeout
    const stopPromise = coreServices.engine.stop()
    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000))
    await Promise.race([stopPromise, timeoutPromise])

    cleanup()
    app.quit()
  } else {
    cleanup()
  }
})

function cleanup(): void {
  // Clean up event bridge
  eventBridgeCleanup?.()
  eventBridgeCleanup = null

  // Remove IPC handlers
  removeAllIpcHandlers()

  // Close DB
  try {
    coreServices?.state.close()
  } catch {
    // ignore
  }

  // Destroy tray
  trayManager?.destroy()
  trayManager = null

  // Destroy window
  windowManager?.destroy()
  windowManager = null

  coreServices = null
}

// ── Window events ──

app.on('window-all-closed', () => {
  // Do NOT quit on window close — app lives in tray
})

app.on('activate', () => {
  // macOS: re-create window on dock click
  windowManager?.show()
})
