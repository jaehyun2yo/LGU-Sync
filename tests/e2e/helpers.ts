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
