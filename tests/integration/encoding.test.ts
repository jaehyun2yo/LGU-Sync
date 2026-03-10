/**
 * 통합 테스트: 한글 파일명 인코딩 검증
 *
 * LGU+ 웹하드 API 응답에서 한글 파일명이 올바르게 디코딩되는지 확인.
 * 실제 API 호출이 필요하므로 test:integration으로 실행.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { setupIntegration, type IntegrationContext } from './setup'

describe('한글 파일명 인코딩', () => {
  let ctx: IntegrationContext

  beforeAll(async () => {
    ctx = await setupIntegration()
  }, 30_000)

  it('getUploadHistory 응답에서 한글 파일명이 깨지지 않는다', async () => {
    const history = await ctx.client.getUploadHistory({
      operCode: '',  // 전체 조회
      page: 1,
    })

    expect(history.items.length).toBeGreaterThan(0)

    // 깨진 인코딩 패턴 검사: replacement character(�) 또는 ?뚯뒪 같은 패턴
    const brokenItems = history.items.filter(item => {
      const name = item.itemSrcName
      if (!name) return false
      return name.includes('\uFFFD') || /\?[뚯뒪럩]{1,}/.test(name)
    })

    if (brokenItems.length > 0) {
      console.log('깨진 파일명 발견:')
      for (const item of brokenItems) {
        console.log(`  - historyNo=${item.historyNo}: "${item.itemSrcName}"`)
      }
    }

    expect(brokenItems).toHaveLength(0)

    // 한글 파일이 존재하면 정상 디코딩 확인
    const koreanItems = history.items.filter(item =>
      item.itemSrcName && /[가-힣]/.test(item.itemSrcName),
    )

    if (koreanItems.length > 0) {
      console.log(`한글 파일명 ${koreanItems.length}개 정상 디코딩:`)
      for (const item of koreanItems.slice(0, 5)) {
        console.log(`  - "${item.itemSrcName}.${item.itemSrcExtension}" (${item.itemOperCode})`)
      }
    }
  }, 15_000)

  it('getUploadHistory 응답의 폴더 경로에서 한글이 깨지지 않는다', async () => {
    const history = await ctx.client.getUploadHistory({
      operCode: '',
      page: 1,
    })

    const brokenPaths = history.items.filter(item => {
      const path = item.itemFolderFullpath
      if (!path) return false
      return path.includes('\uFFFD') || /\?[뚯뒪럩]{1,}/.test(path)
    })

    expect(brokenPaths).toHaveLength(0)

    const koreanPaths = history.items.filter(item =>
      item.itemFolderFullpath && /[가-힣]/.test(item.itemFolderFullpath),
    )

    if (koreanPaths.length > 0) {
      console.log(`한글 폴더경로 ${koreanPaths.length}개 정상 디코딩:`)
      for (const item of koreanPaths.slice(0, 3)) {
        console.log(`  - "${item.itemFolderFullpath}"`)
      }
    }
  }, 15_000)
})
