import { describe, it, expect } from 'vitest'
import { cleanFolderPath, filterPathSegments, normalizeFolderPath, EXCLUDED_PATH_SEGMENTS } from '../../src/core/path-utils'

describe('cleanFolderPath', () => {
  it('GUEST 세그먼트 제거', () => {
    expect(cleanFolderPath('/올리기전용/GUEST/업체A/')).toBe('/올리기전용/업체A/')
  })
  it('GUEST만 있으면 루트 반환', () => {
    expect(cleanFolderPath('/GUEST')).toBe('/')
    expect(cleanFolderPath('/GUEST/')).toBe('/')
  })
  it('정상 경로는 변경 없음', () => {
    expect(cleanFolderPath('/올리기전용/업체A')).toBe('/올리기전용/업체A/')
  })
  it('빈 입력 → 루트', () => {
    expect(cleanFolderPath('')).toBe('/')
    expect(cleanFolderPath('/')).toBe('/')
  })
  it('소문자 guest는 유지 (업체명일 수 있음)', () => {
    expect(cleanFolderPath('/guest/test')).toBe('/guest/test/')
  })
  it('breadcrumb 형식( > 구분자) 경로 정규화 — GUEST와 게스트 폴더 모두 제거', () => {
    expect(cleanFolderPath('게스트 폴더 > GUEST > ㄱ 내리기전용 > (주)신영피앤피 > dxf방')).toBe(
      '/ㄱ 내리기전용/(주)신영피앤피/dxf방/',
    )
  })
  it('게스트 폴더(한글) 세그먼트 제거', () => {
    expect(cleanFolderPath('/게스트 폴더/업체A/')).toBe('/업체A/')
  })
  it('breadcrumb 형식 + GUEST 제거', () => {
    expect(cleanFolderPath('올리기전용 > GUEST > 업체A')).toBe('/올리기전용/업체A/')
  })
})

describe('filterPathSegments', () => {
  it('GUEST 제거', () => {
    expect(filterPathSegments(['GUEST', '올리기전용', '업체A'])).toEqual(['올리기전용', '업체A'])
  })
  it('GUEST 없으면 변경 없음', () => {
    expect(filterPathSegments(['올리기전용', '업체A'])).toEqual(['올리기전용', '업체A'])
  })
  it('GUEST만 있으면 빈 배열', () => {
    expect(filterPathSegments(['GUEST'])).toEqual([])
  })
  it('게스트 폴더(한글) 제거', () => {
    expect(filterPathSegments(['게스트 폴더', '올리기전용', '업체A'])).toEqual(['올리기전용', '업체A'])
  })
})

describe('normalizeFolderPath', () => {
  it('GUEST 제거 + trailing slash 없음', () => {
    expect(normalizeFolderPath('/올리기전용/GUEST/업체A/')).toBe('/올리기전용/업체A')
  })
  it('정상 경로 trailing slash 제거', () => {
    expect(normalizeFolderPath('/올리기전용/업체A')).toBe('/올리기전용/업체A')
  })
  it('GUEST만 있으면 빈 문자열', () => {
    expect(normalizeFolderPath('/GUEST')).toBe('')
    expect(normalizeFolderPath('/GUEST/')).toBe('')
  })
  it('빈 입력 → 빈 문자열', () => {
    expect(normalizeFolderPath('')).toBe('')
    expect(normalizeFolderPath('/')).toBe('')
  })
  it('breadcrumb 형식 정규화', () => {
    expect(normalizeFolderPath('올리기전용 > GUEST > 업체A')).toBe('/올리기전용/업체A')
  })
  it('cleanFolderPath와 동일하되 trailing slash만 다름', () => {
    const raw = '/올리기전용/GUEST/업체A/하위/'
    const clean = cleanFolderPath(raw)
    const normalized = normalizeFolderPath(raw)
    expect(clean).toBe('/올리기전용/업체A/하위/')
    expect(normalized).toBe('/올리기전용/업체A/하위')
  })
})

describe('EXCLUDED_PATH_SEGMENTS', () => {
  it('GUEST 포함', () => {
    expect(EXCLUDED_PATH_SEGMENTS.has('GUEST')).toBe(true)
  })
  it('게스트 폴더(한글) 포함', () => {
    expect(EXCLUDED_PATH_SEGMENTS.has('게스트 폴더')).toBe(true)
  })
  it('소문자 guest 미포함', () => {
    expect(EXCLUDED_PATH_SEGMENTS.has('guest')).toBe(false)
  })
})
