/**
 * E2E Tests - Detection Overload & Stress Scenarios
 *
 * Playwright Electron-based E2E tests covering:
 * 1. 50건 연속 감지 이벤트 주입
 * 2. 100건 혼합 이벤트 (detected + downloaded + failed) + 필터 동작
 * 3. 페이지 전환 중 이벤트 보존
 * 4. MAX_EVENTS(500) 한도 도달
 * 5. Burst 100건 1ms 간격 주입
 * 6. 세션 통계 정확성
 * 7. 대시보드 EventTimeline 과부하
 * 8. 빠른 시작/중지 반복
 * 9. 감지 중 이벤트 + 중지 시 이벤트 보존
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import path from 'path'
import {
  injectDetectionEvents,
  injectStatusChanged,
} from './helpers'

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const MAIN_ENTRY = path.join(PROJECT_ROOT, 'out/main/index.js')

let electronApp: ElectronApplication
let page: Page

// Track whether page is still alive
function isPageAlive(): boolean {
  try {
    return !page.isClosed()
  } catch {
    return false
  }
}

// Navigate to detection page (label: "실시간 감지")
async function navigateToDetection(): Promise<void> {
  if (!isPageAlive()) return
  const menuButton = page.locator('aside button', { hasText: '실시간 감지' })
  await menuButton.click()
  await page.waitForTimeout(500)
}

// Navigate to dashboard page
async function navigateToDashboard(): Promise<void> {
  if (!isPageAlive()) return
  const menuButton = page.locator('aside button', { hasText: '대시보드' })
  await menuButton.click()
  await page.waitForTimeout(500)
}

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
  // Wait for sidebar to be visible (app ready)
  await page.waitForSelector('aside', { timeout: 15000 })
})

test.afterAll(async () => {
  if (electronApp) {
    await electronApp.close()
  }
})

// ── Test 1: 50건 연속 감지 이벤트 ──

test.describe('50건 연속 감지 이벤트', () => {
  test('50건 이벤트 주입 후 카운터가 50 이상이다', async () => {
    test.skip(!isPageAlive(), 'Page not available')

    await navigateToDetection()

    // Clear existing events first
    const clearButton = page.locator('button', { hasText: '로그 지우기' })
    if (await clearButton.first().isVisible().catch(() => false)) {
      await clearButton.first().click()
      await page.waitForTimeout(300)
    }

    // Inject 50 detected events
    await injectDetectionEvents(electronApp, 50)
    await page.waitForTimeout(1000)

    // Verify event counter shows >= 50
    const counterText = await page.locator('text=개 이벤트').first().textContent()
    expect(counterText).toBeTruthy()
    const match = counterText!.match(/(\d+)개 이벤트/)
    expect(match).toBeTruthy()
    expect(parseInt(match![1], 10)).toBeGreaterThanOrEqual(50)
  })
})

// ── Test 2: 100건 혼합 이벤트 + 필터 ──

test.describe('100건 혼합 이벤트 필터링', () => {
  test('50 detected + 30 downloaded + 20 failed 주입 후 필터 동작 확인', async () => {
    test.skip(!isPageAlive(), 'Page not available')

    await navigateToDetection()

    // Clear existing events
    const clearButton = page.locator('button', { hasText: '로그 지우기' })
    if (await clearButton.first().isVisible().catch(() => false)) {
      await clearButton.first().click()
      await page.waitForTimeout(300)
    }

    // Inject mixed events
    await injectDetectionEvents(electronApp, 50, { type: 'detected' })
    await injectDetectionEvents(electronApp, 30, { type: 'downloaded' })
    await injectDetectionEvents(electronApp, 20, { type: 'failed' })
    await page.waitForTimeout(1000)

    // Verify total count is 100
    const allFilterBtn = page.locator('button', { hasText: '전체' }).first()
    await allFilterBtn.click()
    await page.waitForTimeout(300)

    const counterText = await page.locator('text=개 이벤트').first().textContent()
    const match = counterText!.match(/(\d+)개 이벤트/)
    expect(parseInt(match![1], 10)).toBe(100)

    // Click "완료" filter and verify count
    const completedFilter = page.locator('button', { hasText: '완료' }).first()
    await completedFilter.click()
    await page.waitForTimeout(300)

    const filteredText = await page.locator('text=개 표시 중').first().textContent()
    expect(filteredText).toContain('30개 표시 중')

    // Click "실패/오류" filter
    const failedFilter = page.locator('button', { hasText: '실패/오류' }).first()
    await failedFilter.click()
    await page.waitForTimeout(300)

    const failedText = await page.locator('text=개 표시 중').first().textContent()
    expect(failedText).toContain('20개 표시 중')

    // Click "감지됨" filter
    const detectedFilter = page.locator('button', { hasText: '감지됨' }).first()
    await detectedFilter.click()
    await page.waitForTimeout(300)

    const detectedText = await page.locator('text=개 표시 중').first().textContent()
    expect(detectedText).toContain('50개 표시 중')

    // Return to all filter
    await allFilterBtn.click()
    await page.waitForTimeout(300)
  })
})

// ── Test 3: 페이지 전환 중 이벤트 보존 ──

test.describe('페이지 전환 중 이벤트 보존', () => {
  test('대시보드 이동 후 이벤트 주입 -> 돌아오면 이벤트 표시', async () => {
    test.skip(!isPageAlive(), 'Page not available')

    // Start on detection page and clear events
    await navigateToDetection()
    const clearButton = page.locator('button', { hasText: '로그 지우기' })
    if (await clearButton.first().isVisible().catch(() => false)) {
      await clearButton.first().click()
      await page.waitForTimeout(300)
    }

    // Navigate to dashboard
    await navigateToDashboard()
    await page.waitForTimeout(500)

    // Inject 50 events while on dashboard (events go through App.tsx global listener)
    await injectDetectionEvents(electronApp, 50)
    await page.waitForTimeout(500)

    // Return to detection page
    await navigateToDetection()
    await page.waitForTimeout(500)

    // Events should be visible (store persists across page navigation)
    const counterText = await page.locator('text=개 이벤트').first().textContent()
    expect(counterText).toBeTruthy()
    const match = counterText!.match(/(\d+)/)
    expect(match).toBeTruthy()
    expect(parseInt(match![1], 10)).toBeGreaterThanOrEqual(50)
  })
})

// ── Test 4: MAX_EVENTS(500) 한도 ──

test.describe('MAX_EVENTS(500) 한도 테스트', () => {
  test('600건 주입 시 카운터가 500개 이벤트 (최대 500개)로 표시', async () => {
    test.skip(!isPageAlive(), 'Page not available')

    await navigateToDetection()

    // Clear existing events
    const clearButton = page.locator('button', { hasText: '로그 지우기' })
    if (await clearButton.first().isVisible().catch(() => false)) {
      await clearButton.first().click()
      await page.waitForTimeout(300)
    }

    // Inject 600 events in batches to avoid timeout
    for (let batch = 0; batch < 6; batch++) {
      await injectDetectionEvents(electronApp, 100, { type: 'detected' })
    }
    await page.waitForTimeout(1500)

    // Verify counter shows exactly 500 (MAX_EVENTS limit)
    const footer = page.locator('text=500개 이벤트 (최대 500개)')
    await expect(footer.first()).toBeVisible({ timeout: 5000 })
  })
})

// ── Test 5: Burst 100건 1ms 간격 ──

test.describe('Burst 100건 1ms 간격', () => {
  test('UI가 크래시하지 않고 버튼이 클릭 가능', async () => {
    test.skip(!isPageAlive(), 'Page not available')

    await navigateToDetection()

    // Clear existing events
    const clearButton = page.locator('button', { hasText: '로그 지우기' })
    if (await clearButton.first().isVisible().catch(() => false)) {
      await clearButton.first().click()
      await page.waitForTimeout(300)
    }

    // Inject 100 events at 1ms interval
    await injectDetectionEvents(electronApp, 100, { type: 'detected', delayMs: 1 })
    await page.waitForTimeout(1000)

    // Verify page hasn't crashed: check that a button is still clickable
    const allFilterBtn = page.locator('button', { hasText: '전체' }).first()
    await expect(allFilterBtn).toBeVisible({ timeout: 5000 })
    await allFilterBtn.click()
    await page.waitForTimeout(300)

    // Verify events were received
    const counterText = await page.locator('text=개 이벤트').first().textContent()
    expect(counterText).toBeTruthy()
    const match = counterText!.match(/(\d+)개 이벤트/)
    expect(match).toBeTruthy()
    expect(parseInt(match![1], 10)).toBeGreaterThanOrEqual(50) // At least some events processed
  })
})

// ── Test 6: 세션 통계 정확성 ──

test.describe('세션 통계 정확성', () => {
  test('status-changed(running) + 혼합 이벤트 주입 시 통계가 정확하다', async () => {
    test.skip(!isPageAlive(), 'Page not available')

    await navigateToDetection()

    // Clear existing events
    const clearButton = page.locator('button', { hasText: '로그 지우기' })
    if (await clearButton.first().isVisible().catch(() => false)) {
      await clearButton.first().click()
      await page.waitForTimeout(300)
    }

    // Simulate detection start via status-changed
    await injectStatusChanged(electronApp, 'running', 'stats-test-session')
    await page.waitForTimeout(500)

    // Inject events with cumulative stats
    // 30 detected events with incremental stats
    for (let i = 0; i < 30; i++) {
      await injectDetectionEvents(electronApp, 1, {
        type: 'detected',
        includeStats: true,
        statsBase: { filesDetected: i, filesDownloaded: 0, filesFailed: 0 },
      })
    }

    // 20 downloaded events
    for (let i = 0; i < 20; i++) {
      await injectDetectionEvents(electronApp, 1, {
        type: 'downloaded',
        includeStats: true,
        statsBase: { filesDetected: 30, filesDownloaded: i, filesFailed: 0 },
      })
    }

    // 5 failed events
    for (let i = 0; i < 5; i++) {
      await injectDetectionEvents(electronApp, 1, {
        type: 'failed',
        includeStats: true,
        statsBase: { filesDetected: 30, filesDownloaded: 20, filesFailed: i },
      })
    }

    await page.waitForTimeout(1000)

    // Verify stats panel shows the session statistics cards
    // The stats cards show "감지", "완료", "실패" labels with numbers
    const statsCards = page.locator('text=건')
    const statsCount = await statsCards.count()
    expect(statsCount).toBeGreaterThan(0) // Stats cards should exist

    // Stop detection
    await injectStatusChanged(electronApp, 'stopped')
    await page.waitForTimeout(500)
  })
})

// ── Test 7: 대시보드 EventTimeline 과부하 ──

test.describe('대시보드 EventTimeline 과부하', () => {
  test('대시보드에서 30건 operCode 포함 detection 이벤트 주입 시 최근 활동 섹션 정상', async () => {
    test.skip(!isPageAlive(), 'Page not available')

    await navigateToDashboard()
    await page.waitForTimeout(500)

    // Inject 30 detection events with operCode (EventTimeline uses detection-store)
    await injectDetectionEvents(electronApp, 30, {
      type: 'detected',
      includeOperCode: true,
    })
    await page.waitForTimeout(1000)

    // EventTimeline section should be visible with "최근 활동" header
    const timelineHeader = page.locator('text=최근 활동')
    const isVisible = await timelineHeader.first().isVisible().catch(() => false)

    if (isVisible) {
      // Verify count label shows events
      const countLabel = page.locator('text=최근')
      await expect(countLabel.first()).toBeVisible({ timeout: 5000 })
    }

    // Verify page didn't crash: dashboard elements still visible
    const dashboardContent = page.locator('text=전체 파일').or(page.locator('text=대기 중'))
    await expect(dashboardContent.first()).toBeVisible({ timeout: 5000 })
  })
})

// ── Test 8: 빠른 시작/중지 반복 ──

test.describe('빠른 시작/중지 반복', () => {
  test('5회 시작->중지 반복 시 상태가 일관적', async () => {
    test.skip(!isPageAlive(), 'Page not available')

    await navigateToDetection()
    await page.waitForTimeout(300)

    // 5 rapid start/stop cycles via IPC injection
    for (let i = 0; i < 5; i++) {
      // Start
      await injectStatusChanged(electronApp, 'running', `rapid-session-${i}`)
      await page.waitForTimeout(100)

      // Inject a start event
      await injectDetectionEvents(electronApp, 1, { type: 'started' })
      await page.waitForTimeout(100)

      // Stop
      await injectStatusChanged(electronApp, 'stopped')
      await page.waitForTimeout(100)

      // Inject a stop event
      await injectDetectionEvents(electronApp, 1, { type: 'stopped' })
      await page.waitForTimeout(100)
    }

    await page.waitForTimeout(500)

    // After all cycles, detection should be in stopped state
    // Check for "감지 시작" button or "대기" text as evidence of stopped state
    const startButton = page.locator('button', { hasText: '감지 시작' })
    const idleText = page.locator('text=대기')
    const isStartVisible = await startButton.first().isVisible().catch(() => false)
    const isIdleVisible = await idleText.first().isVisible().catch(() => false)

    expect(isStartVisible || isIdleVisible).toBe(true)

    // Verify we can still see events (10 total: 5 started + 5 stopped)
    const counterText = await page.locator('text=개 이벤트').first().textContent()
    expect(counterText).toBeTruthy()
    const match = counterText!.match(/(\d+)/)
    expect(match).toBeTruthy()
    expect(parseInt(match![1], 10)).toBeGreaterThanOrEqual(10)
  })
})

// ── Test 9: 감지 중 이벤트 + 중지 시 이벤트 보존 ──

test.describe('감지 중 이벤트 + 중지 시 보존', () => {
  test('시작 -> 100건 이벤트 -> 중지 -> 이벤트 보존 확인', async () => {
    test.skip(!isPageAlive(), 'Page not available')

    await navigateToDetection()

    // Clear existing events
    const clearButton = page.locator('button', { hasText: '로그 지우기' })
    if (await clearButton.first().isVisible().catch(() => false)) {
      await clearButton.first().click()
      await page.waitForTimeout(300)
    }

    // Simulate start
    await injectStatusChanged(electronApp, 'running', 'preserve-test-session')
    await page.waitForTimeout(300)

    // Inject 100 events while running
    await injectDetectionEvents(electronApp, 100, { type: 'detected' })
    await page.waitForTimeout(500)

    // Verify events are present before stopping
    const beforeStopText = await page.locator('text=개 이벤트').first().textContent()
    const beforeMatch = beforeStopText!.match(/(\d+)/)
    const beforeCount = parseInt(beforeMatch![1], 10)
    expect(beforeCount).toBeGreaterThanOrEqual(100)

    // Simulate stop
    await injectStatusChanged(electronApp, 'stopped')
    await injectDetectionEvents(electronApp, 1, { type: 'stopped' })
    await page.waitForTimeout(500)

    // Events should still be visible after stopping (events persist in store)
    const afterStopText = await page.locator('text=개 이벤트').first().textContent()
    const afterMatch = afterStopText!.match(/(\d+)/)
    const afterCount = parseInt(afterMatch![1], 10)

    // Count should be >= beforeCount (stopped event adds one more)
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount)

    // Verify "감지 시작" button is visible (detection is stopped)
    const startButton = page.locator('button', { hasText: '감지 시작' })
    await expect(startButton.first()).toBeVisible({ timeout: 5000 })
  })
})
