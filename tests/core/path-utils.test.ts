import { describe, it, expect } from 'vitest'
import { cleanFolderPath, filterPathSegments, EXCLUDED_PATH_SEGMENTS } from '../../src/core/path-utils'

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
})

describe('EXCLUDED_PATH_SEGMENTS', () => {
  it('GUEST 포함', () => {
    expect(EXCLUDED_PATH_SEGMENTS.has('GUEST')).toBe(true)
  })
  it('소문자 guest 미포함', () => {
    expect(EXCLUDED_PATH_SEGMENTS.has('guest')).toBe(false)
  })
})
