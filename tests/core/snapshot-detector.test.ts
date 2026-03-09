import { describe, it, expect } from 'vitest'

import type { LGUplusFileItem } from '../../src/core/types/lguplus-client.types'

// 테스트 대상 함수 (아직 미구현 → TDD)
import { diffSnapshot } from '../../src/core/snapshot-diff'

// 테스트 헬퍼: LGUplusFileItem 생성
function makeFileItem(overrides: Partial<LGUplusFileItem> = {}): LGUplusFileItem {
  return {
    itemId: 1001,
    itemName: 'drawing1.dxf',
    itemSize: 50000,
    itemExtension: 'dxf',
    parentFolderId: 100,
    updatedAt: '2026-03-09 10:00:00',
    isFolder: false,
    ...overrides,
  }
}

describe('diffSnapshot - 폴더 파일 목록 비교', () => {
  it('폴더에 새 파일이 있으면 newFiles로 반환한다', () => {
    const currentFiles: LGUplusFileItem[] = [
      makeFileItem({ itemId: 1001, itemName: 'drawing1.dxf', itemSize: 50000 }),
      makeFileItem({ itemId: 1002, itemName: 'drawing2.dxf', itemSize: 30000 }),
    ]
    const knownFileIds = new Set<number>() // DB에 아무것도 없음

    const diff = diffSnapshot(currentFiles, knownFileIds, '100')

    expect(diff.newFiles).toHaveLength(2)
    expect(diff.newFiles[0]).toEqual(
      expect.objectContaining({
        fileName: 'drawing1.dxf',
        fileSize: 50000,
        folderId: '100',
      }),
    )
    expect(diff.newFiles[1]).toEqual(
      expect.objectContaining({
        fileName: 'drawing2.dxf',
        fileSize: 30000,
        folderId: '100',
      }),
    )
  })

  it('DB에는 있지만 폴더에 없는 파일은 deletedFileIds로 반환한다', () => {
    const currentFiles: LGUplusFileItem[] = [] // 폴더 비어있음
    const knownFileIds = new Set<number>([1001, 1002]) // DB에 2개 있음

    const diff = diffSnapshot(currentFiles, knownFileIds, '100')

    expect(diff.newFiles).toHaveLength(0)
    expect(diff.deletedFileIds).toEqual(expect.arrayContaining([1001, 1002]))
    expect(diff.deletedFileIds).toHaveLength(2)
  })

  it('이미 알려진 파일은 신규로 감지하지 않는다', () => {
    const currentFiles: LGUplusFileItem[] = [
      makeFileItem({ itemId: 1001, itemName: 'drawing1.dxf' }),
    ]
    const knownFileIds = new Set<number>([1001]) // 이미 DB에 있음

    const diff = diffSnapshot(currentFiles, knownFileIds, '100')

    expect(diff.newFiles).toHaveLength(0)
    expect(diff.deletedFileIds).toHaveLength(0)
  })

  it('빈 폴더와 빈 DB는 빈 결과를 반환한다', () => {
    const diff = diffSnapshot([], new Set<number>(), '100')

    expect(diff.newFiles).toHaveLength(0)
    expect(diff.deletedFileIds).toHaveLength(0)
  })

  it('폴더(isFolder=true)는 감지 대상에서 제외한다', () => {
    const currentFiles: LGUplusFileItem[] = [
      makeFileItem({ itemId: 2001, itemName: '하위폴더', isFolder: true }),
      makeFileItem({ itemId: 1001, itemName: 'drawing1.dxf', isFolder: false }),
    ]
    const knownFileIds = new Set<number>()

    const diff = diffSnapshot(currentFiles, knownFileIds, '100')

    expect(diff.newFiles).toHaveLength(1)
    expect(diff.newFiles[0].fileName).toBe('drawing1.dxf')
  })

  it('relativePath가 있으면 filePath에 포함된다', () => {
    const currentFiles: LGUplusFileItem[] = [
      makeFileItem({
        itemId: 1001,
        itemName: 'drawing1.dxf',
        relativePath: '/올리기전용/원컴퍼니',
      }),
    ]
    const knownFileIds = new Set<number>()

    const diff = diffSnapshot(currentFiles, knownFileIds, '100')

    expect(diff.newFiles[0].filePath).toBe('/올리기전용/원컴퍼니/drawing1.dxf')
  })

  it('relativePath가 없으면 파일명만 filePath로 사용한다', () => {
    const currentFiles: LGUplusFileItem[] = [
      makeFileItem({
        itemId: 1001,
        itemName: 'drawing1.dxf',
        relativePath: undefined,
      }),
    ]
    const knownFileIds = new Set<number>()

    const diff = diffSnapshot(currentFiles, knownFileIds, '100')

    expect(diff.newFiles[0].filePath).toBe('drawing1.dxf')
  })

  it('일부는 신규, 일부는 기존, 일부는 삭제된 복합 시나리오', () => {
    const currentFiles: LGUplusFileItem[] = [
      makeFileItem({ itemId: 1001, itemName: 'existing.dxf' }), // 기존
      makeFileItem({ itemId: 1003, itemName: 'new-file.dxf' }), // 신규
    ]
    const knownFileIds = new Set<number>([1001, 1002]) // 1002는 삭제됨

    const diff = diffSnapshot(currentFiles, knownFileIds, '100')

    expect(diff.newFiles).toHaveLength(1)
    expect(diff.newFiles[0].fileName).toBe('new-file.dxf')
    expect(diff.deletedFileIds).toEqual([1002])
  })
})
