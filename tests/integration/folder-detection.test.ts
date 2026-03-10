/**
 * 폴더 생성 감지 통합 테스트
 *
 * 실제 LGU+ 웹하드 API를 호출하여:
 * 1. 폴더 생성 (FOLDER/MAKE) 후 USE_HISTORY에 FC 이벤트 등록 확인
 * 2. FileDetector polling 전략으로 FC 감지 확인
 * 3. 감지 지연 시간 측정
 *
 * 주의: 게스트 폴더에서 DELETE가 불가하므로 생성된 테스트 폴더는 수동 정리 필요
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  setupIntegration,
  createDetector,
  waitForDetection,
  testFolderName,
  delay,
  type IntegrationContext,
} from './setup'
import type { FileDetector } from '../../src/core/file-detector'

// Single shared context for all tests in this file
let ctx: IntegrationContext
let detector: FileDetector

beforeAll(async () => {
  ctx = await setupIntegration()

  // Baseline 설정: 현재 history의 max historyNo를 checkpoint에 저장
  detector = createDetector(ctx, { pollingIntervalMs: 2000 })
  await detector.forceCheck() // baseline
  await delay(1000)
}, 60_000)

afterAll(async () => {
  detector?.stop()
  await ctx?.client.logout()
}, 15_000)

describe('폴더 생성 감지 통합 테스트', () => {
  it('createFolder API가 정상 동작해야 한다', async () => {
    const folderName = testFolderName('api-check')
    const result = await ctx.client.createFolder(ctx.testFolderId, folderName)

    expect(result.success).toBe(true)
    expect(result.resultCode).toBe('0000')

    // 생성 확인
    await delay(2000)
    const subFolders = await ctx.client.getSubFolders(ctx.testFolderId)
    const created = subFolders.find(f => f.folderName === folderName)
    expect(created).toBeDefined()
    expect(created!.folderId).toBeGreaterThan(0)

    console.log(`  [OK] 폴더 생성: [${created!.folderId}] "${folderName}"`)
  }, 30_000)

  it('폴더 생성이 USE_HISTORY에 FC 이벤트로 기록되어야 한다', async () => {
    const folderName = testFolderName('history-check')
    await ctx.client.createFolder(ctx.testFolderId, folderName)
    await delay(3000) // API 반영 대기

    // Upload history에서 FC 이벤트 확인
    const history = await ctx.client.getUploadHistory({ operCode: '', page: 1 })
    const fcEvents = history.items.filter(
      h => h.itemOperCode === 'FC' && h.itemSrcName === folderName,
    )

    expect(fcEvents.length).toBeGreaterThanOrEqual(1)
    const fcEvent = fcEvents[0]
    expect(fcEvent.itemOperCode).toBe('FC')
    expect(fcEvent.itemSrcName).toBe(folderName)

    console.log(`  [OK] FC 이벤트: historyNo=${fcEvent.historyNo}, folder="${fcEvent.itemSrcName}"`)
  }, 30_000)

  it('FileDetector가 폴더 생성을 감지해야 한다 (polling)', async () => {
    // 이전 테스트에서 생성된 이벤트를 소비하여 checkpoint 갱신
    await detector.forceCheck()
    await delay(1000)

    const folderName = testFolderName('detect')

    // 폴더 생성
    const t0 = Date.now()
    await ctx.client.createFolder(ctx.testFolderId, folderName)
    await delay(2000) // API 반영 대기

    // 폴링 시작 후 감지 대기
    detector.start()
    try {
      const { file, detectedAt } = await waitForDetection(
        detector,
        (f) => f.operCode === 'FC' && f.fileName === folderName,
        30_000,
      )

      expect(file.operCode).toBe('FC')
      expect(file.fileName).toBe(folderName)

      const latencyMs = detectedAt - t0
      console.log(`  [OK] 감지 지연: ${latencyMs}ms, operCode=${file.operCode}, fileName="${file.fileName}"`)
      expect(latencyMs).toBeLessThan(30_000)
    } finally {
      detector.stop()
    }
  }, 60_000)

  it('forceCheck로 즉시 감지할 수 있어야 한다', async () => {
    const folderName = testFolderName('force')

    await ctx.client.createFolder(ctx.testFolderId, folderName)
    await delay(3000) // API 반영 대기

    const detected = await detector.forceCheck()
    const fcDetected = detected.filter(
      f => f.operCode === 'FC' && f.fileName === folderName,
    )

    expect(fcDetected.length).toBeGreaterThanOrEqual(1)
    console.log(`  [OK] forceCheck: ${detected.length}개 감지, FC=${fcDetected.length}개`)
  }, 30_000)

  it('연속 생성이 모두 감지되어야 한다', async () => {
    const names = [
      testFolderName('batch-1'),
      testFolderName('batch-2'),
      testFolderName('batch-3'),
    ]

    // 연속 생성
    for (const name of names) {
      await ctx.client.createFolder(ctx.testFolderId, name)
      await delay(500)
    }

    await delay(3000) // API 반영 대기

    const detected = await detector.forceCheck()
    const fcNames = detected
      .filter(f => f.operCode === 'FC')
      .map(f => f.fileName)

    for (const name of names) {
      expect(fcNames).toContain(name)
    }

    console.log(`  [OK] 연속 생성 감지: ${names.length}개 생성, ${fcNames.length}개 FC 감지`)
  }, 60_000)
})

describe('감지 성능 측정', () => {
  it('폴더 생성 API 응답 시간을 측정한다', async () => {
    const times: number[] = []

    for (let i = 0; i < 3; i++) {
      const name = testFolderName(`perf-${i}`)
      const t0 = Date.now()
      await ctx.client.createFolder(ctx.testFolderId, name)
      times.push(Date.now() - t0)
      await delay(1000)
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length
    const max = Math.max(...times)

    console.log(`  [PERF] createFolder 응답 시간: avg=${avg.toFixed(0)}ms, max=${max}ms`)
    console.log(`    각 측정: ${times.map(t => `${t}ms`).join(', ')}`)
    expect(max).toBeLessThan(30_000)
  }, 60_000)

  it('history 조회 응답 시간을 측정한다', async () => {
    const times: number[] = []

    for (let i = 0; i < 5; i++) {
      const t0 = Date.now()
      await ctx.client.getUploadHistory({ operCode: '', page: 1 })
      times.push(Date.now() - t0)
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length
    const max = Math.max(...times)

    console.log(`  [PERF] getUploadHistory 응답 시간: avg=${avg.toFixed(0)}ms, max=${max}ms`)
    expect(max).toBeLessThan(10_000)
  }, 30_000)

  it('getSubFolders 응답 시간을 측정한다', async () => {
    const times: number[] = []

    for (let i = 0; i < 5; i++) {
      const t0 = Date.now()
      await ctx.client.getSubFolders(ctx.testFolderId)
      times.push(Date.now() - t0)
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length
    const max = Math.max(...times)

    console.log(`  [PERF] getSubFolders 응답 시간: avg=${avg.toFixed(0)}ms, max=${max}ms`)
    expect(max).toBeLessThan(10_000)
  }, 30_000)
})
