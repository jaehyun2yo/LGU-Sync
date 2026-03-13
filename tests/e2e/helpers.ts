/**
 * E2E test helpers for Electron app testing with Playwright
 */
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import path from 'path'

const PROJECT_ROOT = path.resolve(__dirname, '../..')

/**
 * Launch the Electron app for E2E testing.
 * Uses the built output in out/main/index.js.
 */
export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const electronApp = await electron.launch({
    args: [path.join(PROJECT_ROOT, 'out/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      // Use in-memory or temp DB to avoid polluting real data
      ELECTRON_IS_E2E_TEST: '1',
    },
  })

  // Wait for the first BrowserWindow to open
  const page = await electronApp.firstWindow()

  // Wait for the renderer to be fully loaded
  await page.waitForLoadState('domcontentloaded')

  return { app: electronApp, page }
}

/**
 * Close the Electron app gracefully.
 */
export async function closeApp(app: ElectronApplication): Promise<void> {
  await app.close()
}

/**
 * Navigate to a specific page via sidebar click.
 */
export async function navigateToPage(
  page: Page,
  pageLabel: string,
): Promise<void> {
  // Click the sidebar button with matching text
  const navButton = page.locator('aside button', { hasText: pageLabel })
  await navButton.click()
  // Brief wait for page transition
  await page.waitForTimeout(300)
}

/**
 * Get the currently active page title from the header.
 */
export async function getActivePageTitle(page: Page): Promise<string | null> {
  const header = page.locator('header h1, header h2, header span').first()
  return header.textContent()
}

/**
 * Wait for the app to be fully initialized (sidebar and main content visible).
 */
export async function waitForAppReady(page: Page): Promise<void> {
  // Wait for sidebar to be visible
  await page.waitForSelector('aside', { timeout: 10000 })
  // Wait for main content area
  await page.waitForSelector('main, [class*="flex-1"]', { timeout: 10000 })
}

/**
 * Inject detection:event IPC messages directly to the renderer process.
 * Uses electronApp.evaluate() to send events via BrowserWindow.webContents.send().
 */
export async function injectDetectionEvents(
  app: ElectronApplication,
  count: number,
  options?: {
    type?: 'started' | 'detected' | 'downloaded' | 'failed' | 'error' | 'stopped' | 'recovery'
    includeOperCode?: boolean
    delayMs?: number
    includeStats?: boolean
    statsBase?: { filesDetected: number; filesDownloaded: number; filesFailed: number }
  },
): Promise<void> {
  const eventType = options?.type ?? 'detected'
  const includeOperCode = options?.includeOperCode ?? false
  const delayMs = options?.delayMs ?? 0
  const includeStats = options?.includeStats ?? false
  const statsBase = options?.statsBase ?? { filesDetected: 0, filesDownloaded: 0, filesFailed: 0 }

  const operCodes = ['UP', 'CP', 'D', 'MV', 'RN', 'FC', 'FD', 'FMV', 'FRN']

  for (let i = 0; i < count; i++) {
    const stats = includeStats
      ? {
          filesDetected: statsBase.filesDetected + (eventType === 'detected' ? i + 1 : 0),
          filesDownloaded: statsBase.filesDownloaded + (eventType === 'downloaded' ? i + 1 : 0),
          filesFailed: statsBase.filesFailed + (eventType === 'failed' ? i + 1 : 0),
        }
      : undefined

    await app.evaluate(
      ({ BrowserWindow }, args) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
          win.webContents.send('detection:event', args.event)
        }
      },
      {
        event: {
          type: eventType,
          message: `Test event ${i + 1}/${count}`,
          timestamp: new Date(Date.now() + i).toISOString(),
          fileName: `test-file-${i + 1}.dxf`,
          filePath: `/올리기전용/테스트업체/test-file-${i + 1}.dxf`,
          operCode: includeOperCode ? operCodes[i % operCodes.length] : undefined,
          sessionId: 'test-session-001',
          stats,
        },
      },
    )

    if (delayMs > 0 && i < count - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

/**
 * Inject detection:status-changed IPC message to the renderer process.
 */
export async function injectStatusChanged(
  app: ElectronApplication,
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'recovering',
  sessionId?: string,
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, args) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        win.webContents.send('detection:status-changed', args.event)
      }
    },
    {
      event: {
        status,
        sessionId: sessionId ?? (status === 'stopped' ? null : 'test-session-001'),
      },
    },
  )
}

/**
 * Inject opercode:event IPC message to the renderer process (for dashboard EventTimeline).
 */
export async function injectOperCodeEvents(
  app: ElectronApplication,
  count: number,
  options?: { delayMs?: number },
): Promise<void> {
  const operCodes = ['UP', 'CP', 'D', 'MV', 'RN', 'FC', 'FD', 'FMV', 'FRN']
  const delayMs = options?.delayMs ?? 0

  for (let i = 0; i < count; i++) {
    await app.evaluate(
      ({ BrowserWindow }, args) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
          win.webContents.send('opercode:event', args.event)
        }
      },
      {
        event: {
          operCode: operCodes[i % operCodes.length],
          fileName: `oper-test-${i + 1}.dxf`,
          filePath: `/올리기전용/테스트업체/oper-test-${i + 1}.dxf`,
          folderId: 'folder-001',
          historyNo: 1000 + i,
          timestamp: new Date(Date.now() + i).toISOString(),
        },
      },
    )

    if (delayMs > 0 && i < count - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}
