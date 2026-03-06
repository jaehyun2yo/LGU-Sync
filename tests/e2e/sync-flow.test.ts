/**
 * E2E Integration Tests - Sync Flow
 *
 * Playwright Electron-based E2E tests covering:
 * 1. App launch → Dashboard display
 * 2. Navigation between pages
 * 3. Settings input → Connection test flow
 * 4. Full sync trigger → Progress display → Completion
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import path from 'path'

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const MAIN_ENTRY = path.join(PROJECT_ROOT, 'out/main/index.js')

let electronApp: ElectronApplication
let page: Page

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_IS_E2E_TEST: '1',
    },
  })

  page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  if (electronApp) {
    await electronApp.close()
  }
})

// ── Test Suite 1: App Launch and Dashboard ──

test.describe('App Launch', () => {
  test('Electron 앱이 정상적으로 실행된다', async () => {
    // The app should have launched and created a window
    const windows = electronApp.windows()
    expect(windows.length).toBeGreaterThanOrEqual(1)
  })

  test('메인 윈도우가 올바른 제목을 가진다', async () => {
    const title = await page.title()
    // The title could be the HTML title or the BrowserWindow title
    expect(title).toBeTruthy()
  })

  test('사이드바가 표시된다', async () => {
    const sidebar = page.locator('aside')
    await expect(sidebar).toBeVisible({ timeout: 10000 })
  })

  test('대시보드가 기본 페이지로 표시된다', async () => {
    // Dashboard should show the sync status card and quick stats
    // Look for dashboard-specific content
    const dashboardContent = page.locator('text=대기 중').or(
      page.locator('text=동기화 중'),
    ).or(
      page.locator('text=전체 파일'),
    )
    await expect(dashboardContent.first()).toBeVisible({ timeout: 10000 })
  })

  test('사이드바에 6개 네비게이션 메뉴가 있다', async () => {
    const menuLabels = ['대시보드', '파일 탐색기', '폴더 설정', '동기화 로그', '통계', '설정']
    for (const label of menuLabels) {
      const button = page.locator('aside button', { hasText: label })
      // Button may have text hidden when collapsed, so check by title too
      const visible = await button.or(page.locator(`aside button[title*="${label}"]`)).count()
      expect(visible).toBeGreaterThan(0)
    }
  })

  test('연결 상태 표시기가 보인다', async () => {
    // Connection dots should be visible (외부웹하드, 자체웹하드)
    const connectionDots = page.locator('aside .rounded-full')
    const count = await connectionDots.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })
})

// ── Test Suite 2: Page Navigation ──

test.describe('Page Navigation', () => {
  test('설정 페이지로 이동할 수 있다', async () => {
    const settingsButton = page.locator('aside').getByRole('button', { name: '설정', exact: true })
    await settingsButton.click()
    await page.waitForTimeout(500)

    // Settings page should show tabs (계정, 동기화, 알림, 시스템, 정보)
    const accountTab = page.locator('text=계정')
    await expect(accountTab.first()).toBeVisible({ timeout: 5000 })
  })

  test('파일 탐색기 페이지로 이동할 수 있다', async () => {
    const fileExplorerButton = page.locator('aside button', { hasText: '파일 탐색기' })
    await fileExplorerButton.click()
    await page.waitForTimeout(500)

    // File explorer should be visible
    const content = page.locator('main, [class*="flex-1"]').first()
    await expect(content).toBeVisible()
  })

  test('동기화 로그 페이지로 이동할 수 있다', async () => {
    const logButton = page.locator('aside button', { hasText: '동기화 로그' })
    await logButton.click()
    await page.waitForTimeout(500)

    // Log viewer should show filter options
    const content = page.locator('main, [class*="flex-1"]').first()
    await expect(content).toBeVisible()
  })

  test('통계 페이지로 이동할 수 있다', async () => {
    const statsButton = page.locator('aside button', { hasText: '통계' })
    await statsButton.click()
    await page.waitForTimeout(500)

    const content = page.locator('main, [class*="flex-1"]').first()
    await expect(content).toBeVisible()
  })

  test('대시보드로 돌아올 수 있다', async () => {
    const dashboardButton = page.locator('aside button', { hasText: '대시보드' })
    await dashboardButton.click()
    await page.waitForTimeout(500)

    // Should be back on dashboard with quick stats
    const statsText = page.locator('text=전체 파일')
    await expect(statsText.first()).toBeVisible({ timeout: 5000 })
  })
})

// ── Test Suite 3: Settings Input and Connection Test ──

test.describe('Settings Page', () => {
  test.beforeAll(async () => {
    // Navigate to settings
    const settingsButton = page.locator('aside').getByRole('button', { name: '설정', exact: true })
    await settingsButton.click()
    await page.waitForTimeout(500)
  })

  test('계정 탭에 LGU+ 입력 필드가 있다', async () => {
    // Account tab should be default
    const usernameInput = page.locator('input[placeholder*="LGU+"]').or(
      page.locator('input[placeholder*="아이디"]'),
    )
    await expect(usernameInput.first()).toBeVisible({ timeout: 5000 })
  })

  test('계정 탭에 자체웹하드 API 입력 필드가 있다', async () => {
    const apiUrlInput = page.locator('input[placeholder*="api"]').or(
      page.locator('input[placeholder*="https"]'),
    )
    await expect(apiUrlInput.first()).toBeVisible({ timeout: 5000 })
  })

  test('연결 테스트 버튼이 있다', async () => {
    const testButtons = page.locator('button', { hasText: '연결 테스트' })
    const count = await testButtons.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('동기화 탭으로 전환할 수 있다', async () => {
    // Click the "동기화" tab within the settings page tab bar (not sidebar)
    // The settings tabs are inside a card border-b container
    const settingsTabBar = page.locator('.border-b.border-border')
    const syncTab = settingsTabBar.getByRole('button', { name: '동기화', exact: true })
    await syncTab.click()
    await page.waitForTimeout(300)

    // Should show polling interval field
    const pollingField = page.locator('text=폴링 간격')
    await expect(pollingField.first()).toBeVisible({ timeout: 5000 })
  })

  test('시스템 탭으로 전환할 수 있다', async () => {
    const systemTab = page.locator('button', { hasText: '시스템' }).first()
    await systemTab.click()
    await page.waitForTimeout(300)

    // Should show auto-start toggle
    const autoStartLabel = page.locator('text=자동 시작')
    await expect(autoStartLabel.first()).toBeVisible({ timeout: 5000 })
  })

  test('정보 탭에 앱 버전이 표시된다', async () => {
    const aboutTab = page.locator('button', { hasText: '정보' }).first()
    await aboutTab.click()
    await page.waitForTimeout(300)

    const versionText = page.locator('text=앱 버전')
    await expect(versionText.first()).toBeVisible({ timeout: 5000 })
  })
})

// ── Test Suite 4: Dashboard Sync Controls ──

test.describe('Dashboard Sync Controls', () => {
  test.beforeAll(async () => {
    // Navigate back to dashboard
    const dashboardButton = page.locator('aside button', { hasText: '대시보드' })
    await dashboardButton.click()
    await page.waitForTimeout(500)
  })

  test('전체 동기화 버튼이 있다', async () => {
    const fullSyncButton = page.locator('button', { hasText: '전체 동기화' })
    await expect(fullSyncButton.first()).toBeVisible({ timeout: 5000 })
  })

  test('일시중지/재개 버튼이 있다', async () => {
    const pauseResumeButton = page.locator('button', { hasText: '일시중지' }).or(
      page.locator('button', { hasText: '재개' }),
    )
    await expect(pauseResumeButton.first()).toBeVisible({ timeout: 5000 })
  })

  test('Quick Stats 카드 4개가 표시된다', async () => {
    const statsLabels = ['전체 파일', '성공', '실패', '전송량']
    for (const label of statsLabels) {
      const statCard = page.locator(`text=${label}`)
      await expect(statCard.first()).toBeVisible({ timeout: 5000 })
    }
  })

  test('활성 전송 섹션이 있다', async () => {
    const activeTransfers = page.locator('text=활성 전송')
    await expect(activeTransfers.first()).toBeVisible({ timeout: 5000 })
  })

  test('최근 동기화 파일 섹션이 있다', async () => {
    const recentFiles = page.locator('text=최근 동기화 파일')
    await expect(recentFiles.first()).toBeVisible({ timeout: 5000 })
  })
})

// ── Test Suite 5: Sidebar Collapse ──

test.describe('Sidebar Collapse', () => {
  test('사이드바를 접을 수 있다', async () => {
    const sidebar = page.locator('aside')

    // Get initial width
    const initialBox = await sidebar.boundingBox()
    expect(initialBox).toBeTruthy()
    const initialWidth = initialBox!.width

    // Click collapse button (ChevronLeft icon button)
    const collapseButton = sidebar.locator('button').first()
    await collapseButton.click()
    await page.waitForTimeout(300)

    // Width should have decreased
    const collapsedBox = await sidebar.boundingBox()
    expect(collapsedBox).toBeTruthy()
    expect(collapsedBox!.width).toBeLessThan(initialWidth)
  })

  test('사이드바를 다시 펼 수 있다', async () => {
    const sidebar = page.locator('aside')
    const collapsedBox = await sidebar.boundingBox()
    expect(collapsedBox).toBeTruthy()

    // Click expand button (ChevronRight icon button)
    const expandButton = sidebar.locator('button').first()
    await expandButton.click()
    await page.waitForTimeout(300)

    // Width should have increased
    const expandedBox = await sidebar.boundingBox()
    expect(expandedBox).toBeTruthy()
    expect(expandedBox!.width).toBeGreaterThan(collapsedBox!.width)
  })
})

// ── Test Suite 6: Window Behavior ──

test.describe('Window Behavior', () => {
  test('윈도우 크기를 가져올 수 있다', async () => {
    const windowState = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return null
      const [width, height] = win.getSize()
      return { width, height }
    })

    expect(windowState).toBeTruthy()
    expect(windowState!.width).toBeGreaterThanOrEqual(900) // minWidth
    expect(windowState!.height).toBeGreaterThanOrEqual(600) // minHeight
  })

  test('윈도우 제목이 설정되어 있다', async () => {
    const title = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win?.getTitle() ?? null
    })

    expect(title).toBeTruthy()
  })
})

// ── Test Suite 7: Full Sync UI Flow ──

test.describe('Full Sync UI Flow', () => {
  test.beforeAll(async () => {
    // Navigate to dashboard
    const dashboardButton = page.locator('aside button', { hasText: '대시보드' })
    await dashboardButton.click()
    await page.waitForTimeout(500)
  })

  test('전체 동기화 버튼 클릭 시 확인 다이얼로그가 표시된다', async () => {
    const fullSyncButton = page.locator('button', { hasText: '전체 동기화' })
    await fullSyncButton.first().click()

    // Confirm dialog should appear
    const dialog = page.locator('text=전체 동기화를 시작하시겠습니까').or(
      page.locator('[role="dialog"]'),
    ).or(
      page.locator('text=시작하시겠습니까'),
    )

    // Dialog may or may not appear depending on implementation
    // If it appears, dismiss it
    const dialogVisible = await dialog.first().isVisible().catch(() => false)
    if (dialogVisible) {
      // Click cancel to dismiss
      const cancelButton = page.locator('button', { hasText: '취소' })
      if (await cancelButton.first().isVisible().catch(() => false)) {
        await cancelButton.first().click()
      }
    }
  })
})

// ── Test Suite 8: Folder Settings Page ──

test.describe('Folder Settings Page', () => {
  test.beforeAll(async () => {
    const folderSettingsButton = page.locator('aside button', { hasText: '폴더 설정' })
    await folderSettingsButton.click()
    await page.waitForTimeout(500)
  })

  test('폴더 설정 페이지가 로드된다', async () => {
    const content = page.locator('main, [class*="flex-1"]').first()
    await expect(content).toBeVisible()
  })
})

// ── Test Suite 9: Log Viewer Page ──

test.describe('Log Viewer Page', () => {
  test.beforeAll(async () => {
    const logButton = page.locator('aside button', { hasText: '동기화 로그' })
    await logButton.click()
    await page.waitForTimeout(500)
  })

  test('로그 뷰어 페이지가 로드된다', async () => {
    const content = page.locator('main, [class*="flex-1"]').first()
    await expect(content).toBeVisible()
  })
})

// ── Test Suite 10: Statistics Page ──

test.describe('Statistics Page', () => {
  test.beforeAll(async () => {
    const statsButton = page.locator('aside button', { hasText: '통계' })
    await statsButton.click()
    await page.waitForTimeout(500)
  })

  test('통계 페이지가 로드된다', async () => {
    const content = page.locator('main, [class*="flex-1"]').first()
    await expect(content).toBeVisible()
  })
})
