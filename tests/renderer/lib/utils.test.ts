import { describe, it, expect } from 'vitest'
import { formatDuration } from '../../../src/renderer/lib/utils'

describe('formatDuration', () => {
  it('returns empty string for zero or negative', () => {
    expect(formatDuration(0)).toBe('')
    expect(formatDuration(-1000)).toBe('')
  })

  it('formats seconds', () => {
    expect(formatDuration(5000)).toBe('~5초')
    expect(formatDuration(45000)).toBe('~45초')
  })

  it('formats minutes', () => {
    expect(formatDuration(60000)).toBe('~1분')
    expect(formatDuration(150000)).toBe('~2분')
    expect(formatDuration(3540000)).toBe('~59분')
  })

  it('formats hours and minutes', () => {
    expect(formatDuration(3600000)).toBe('~1시간 0분')
    expect(formatDuration(5400000)).toBe('~1시간 30분')
  })
})
