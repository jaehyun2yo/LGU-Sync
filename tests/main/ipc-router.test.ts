import { describe, it, expect, vi, beforeEach } from 'vitest'
import { exportLogs } from '../../src/main/ipc-router'
import type { LogRow } from '../../src/core/db/types'

vi.mock('node:fs/promises')

describe('exportLogs', () => {
  const mockLogs: LogRow[] = [
    {
      id: 1,
      level: 'info',
      message: 'Sync started',
      category: 'sync',
      context: '{"files":5}',
      stack_trace: null,
      created_at: '2026-02-24T10:00:00.000Z',
    },
    {
      id: 2,
      level: 'error',
      message: 'Download failed',
      category: 'download',
      context: null,
      stack_trace: 'Error: timeout\n  at download',
      created_at: '2026-02-24T10:01:00.000Z',
    },
  ]

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('JSON 내보내기 → .json 파일, 파싱 가능한 배열', async () => {
    const { writeFile } = await import('node:fs/promises')
    vi.mocked(writeFile).mockResolvedValue(undefined)

    const getLogs = vi.fn().mockReturnValue(mockLogs)
    const result = await exportLogs(getLogs, { format: 'json' })

    expect(result.filePath).toMatch(/\.json$/)
    expect(getLogs).toHaveBeenCalled()

    const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
    const parsed = JSON.parse(writtenContent)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].message).toBe('Sync started')
  })

  it('CSV 내보내기 → .csv 파일, 헤더 + 데이터행', async () => {
    const { writeFile } = await import('node:fs/promises')
    vi.mocked(writeFile).mockResolvedValue(undefined)

    const getLogs = vi.fn().mockReturnValue(mockLogs)
    const result = await exportLogs(getLogs, { format: 'csv' })

    expect(result.filePath).toMatch(/\.csv$/)

    const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
    const lines = writtenContent.split('\n')
    expect(lines[0]).toContain('id')
    expect(lines[0]).toContain('level')
    expect(lines[0]).toContain('message')
    expect(lines.length).toBeGreaterThanOrEqual(3)
  })

  it('날짜 필터가 getLogs에 전달된다', async () => {
    const { writeFile } = await import('node:fs/promises')
    vi.mocked(writeFile).mockResolvedValue(undefined)

    const getLogs = vi.fn().mockReturnValue([])
    await exportLogs(getLogs, {
      format: 'json',
      dateFrom: '2026-02-24',
      dateTo: '2026-02-25',
    })

    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '2026-02-24',
        to: '2026-02-25',
      }),
    )
  })

  it('빈 로그 → 빈 배열', async () => {
    const { writeFile } = await import('node:fs/promises')
    vi.mocked(writeFile).mockResolvedValue(undefined)

    const getLogs = vi.fn().mockReturnValue([])
    await exportLogs(getLogs, { format: 'json' })

    const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string
    const parsed = JSON.parse(writtenContent)
    expect(parsed).toEqual([])
  })
})
