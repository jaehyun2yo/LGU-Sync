/**
 * 통합 테스트: 파일 다운로드 검증
 *
 * LGU+ 웹하드 API에서 실제 파일을 다운로드하여:
 * 1. 다운로드 URL 정보 조회 (getDownloadUrlInfo)
 * 2. 파일 다운로드 + 로컬 저장 (downloadFile)
 * 3. 파일 크기 일치 검증
 * 4. 한글 파일명 다운로드 검증
 * 5. 진행 콜백 호출 검증
 *
 * 실제 API 호출이 필요하므로 test:integration으로 실행.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupIntegration, type IntegrationContext } from './setup'
import { stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let ctx: IntegrationContext
let downloadDir: string

// Find a downloadable file from upload history
interface DownloadTarget {
  itemSrcNo: number
  itemSrcName: string
  itemSrcExtension: string
  isKorean: boolean
}

let targets: DownloadTarget[] = []

beforeAll(async () => {
  ctx = await setupIntegration()

  // Create temp download directory
  downloadDir = join(tmpdir(), `whsync-dl-test-${Date.now()}`)

  // Find downloadable files from history (UP events = file uploads)
  const history = await ctx.client.getUploadHistory({ operCode: 'UP', page: 1 })

  for (const item of history.items) {
    if (!item.itemSrcNo || item.itemSrcNo <= 0) continue
    if (item.itemSrcType !== 'F') continue // files only, not folders

    const isKorean = /[가-힣]/.test(item.itemSrcName)
    targets.push({
      itemSrcNo: item.itemSrcNo,
      itemSrcName: item.itemSrcName,
      itemSrcExtension: item.itemSrcExtension,
      isKorean,
    })

    // Collect up to 5 targets (at least 1 Korean if available)
    if (targets.length >= 5) break
  }

  if (targets.length === 0) {
    console.warn('  [WARN] No downloadable files found in upload history. Download tests will be skipped.')
  } else {
    const koreanCount = targets.filter(t => t.isKorean).length
    console.log(`  [INFO] Found ${targets.length} download targets (${koreanCount} Korean)`)
    for (const t of targets) {
      console.log(`    - [${t.itemSrcNo}] "${t.itemSrcName}.${t.itemSrcExtension}" ${t.isKorean ? '(한글)' : ''}`)
    }
  }
}, 60_000)

afterAll(async () => {
  // Cleanup download directory
  try {
    await rm(downloadDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
  await ctx?.client.logout()
}, 15_000)

describe('파일 다운로드 통합 테스트', () => {
  it('getDownloadUrlInfo가 다운로드 URL 정보를 반환해야 한다', async () => {
    if (targets.length === 0) return // skip if no targets

    const target = targets[0]
    const info = await ctx.client.getDownloadUrlInfo(target.itemSrcNo)

    expect(info).not.toBeNull()
    expect(info!.url).toBeTruthy()
    expect(info!.session).toBeTruthy()
    expect(info!.nonce).toBeTruthy()
    expect(info!.userId).toBeTruthy()
    expect(info!.fileSize).toBeGreaterThan(0)
    expect(info!.fileName).toBeTruthy()

    console.log(`  [OK] Download URL info: fileSize=${info!.fileSize}, fileName="${info!.fileName}"`)
  }, 30_000)

  it('downloadFile로 파일을 다운로드할 수 있어야 한다', async () => {
    if (targets.length === 0) return

    const target = targets[0]
    const destPath = join(downloadDir, `${target.itemSrcName}.${target.itemSrcExtension}`)

    const result = await ctx.client.downloadFile(target.itemSrcNo, destPath)

    expect(result.success).toBe(true)
    expect(result.size).toBeGreaterThan(0)
    expect(result.filename).toBeTruthy()

    // Verify file exists on disk
    const fileStat = await stat(destPath)
    expect(fileStat.size).toBe(result.size)

    console.log(`  [OK] Downloaded: "${result.filename}" (${result.size} bytes)`)
  }, 60_000)

  it('다운로드 시 진행 콜백이 호출되어야 한다', async () => {
    if (targets.length === 0) return

    const target = targets[0]
    const destPath = join(downloadDir, `progress-${target.itemSrcName}.${target.itemSrcExtension}`)

    const progressCalls: Array<{ downloaded: number; total: number }> = []

    const result = await ctx.client.downloadFile(
      target.itemSrcNo,
      destPath,
      (downloaded, total) => {
        progressCalls.push({ downloaded, total })
      },
    )

    expect(result.success).toBe(true)
    expect(progressCalls.length).toBeGreaterThan(0)

    // Last progress call should have downloaded === total
    const lastCall = progressCalls[progressCalls.length - 1]
    expect(lastCall.downloaded).toBe(lastCall.total)

    console.log(`  [OK] Progress callbacks: ${progressCalls.length} calls, final=${lastCall.downloaded}/${lastCall.total}`)
  }, 60_000)

  it('한글 파일명이 포함된 파일을 다운로드할 수 있어야 한다', async () => {
    const koreanTarget = targets.find(t => t.isKorean)
    if (!koreanTarget) {
      console.log('  [SKIP] No Korean filename targets available')
      return
    }

    const destPath = join(downloadDir, `${koreanTarget.itemSrcName}.${koreanTarget.itemSrcExtension}`)

    const result = await ctx.client.downloadFile(koreanTarget.itemSrcNo, destPath)

    expect(result.success).toBe(true)
    expect(result.size).toBeGreaterThan(0)

    // Verify filename is not garbled
    expect(result.filename).not.toMatch(/\uFFFD/)
    expect(result.filename).not.toMatch(/\?[뚯뒪럩]{1,}/)

    // Verify file exists
    const fileStat = await stat(destPath)
    expect(fileStat.size).toBe(result.size)

    console.log(`  [OK] Korean file downloaded: "${result.filename}" (${result.size} bytes)`)
  }, 60_000)

  it('존재하지 않는 파일 ID에 대해 적절히 처리해야 한다', async () => {
    const info = await ctx.client.getDownloadUrlInfo(999999999)

    // Should return null or throw - either is acceptable
    expect(info).toBeNull()

    console.log('  [OK] Non-existent file ID returned null')
  }, 30_000)
})

describe('배치 다운로드 테스트', () => {
  it('여러 파일을 배치 다운로드할 수 있어야 한다', async () => {
    if (targets.length < 2) {
      console.log('  [SKIP] Need at least 2 targets for batch download test')
      return
    }

    // Get file list from a folder that has files
    const subFolders = await ctx.client.getSubFolders(ctx.testFolderId)
    if (subFolders.length === 0) {
      console.log('  [SKIP] No sub-folders found for batch test')
      return
    }

    // Find a folder with files
    let filesForBatch: Awaited<ReturnType<typeof ctx.client.getFileList>> | null = null
    for (const folder of subFolders) {
      const fileList = await ctx.client.getFileList(folder.folderId)
      if (fileList.items.length >= 2) {
        filesForBatch = fileList
        break
      }
    }

    if (!filesForBatch || filesForBatch.items.length < 2) {
      console.log('  [SKIP] No folder with 2+ files found for batch test')
      return
    }

    const batchFiles = filesForBatch.items.slice(0, 3)
    const batchDir = join(downloadDir, 'batch')

    const progressLog: string[] = []
    const result = await ctx.client.batchDownload(batchFiles, batchDir, {
      concurrency: 2,
      onProgress: (done, total, current) => {
        progressLog.push(`${done}/${total}: ${current}`)
      },
    })

    expect(result.success + result.failed).toBe(batchFiles.length)
    console.log(`  [OK] Batch download: ${result.success} success, ${result.failed} failed, ${result.totalSize} bytes`)
    console.log(`    Progress: ${progressLog.join(' → ')}`)
  }, 120_000)
})
