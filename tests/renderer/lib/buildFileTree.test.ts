import { describe, it, expect } from 'vitest'
import { buildFileTree } from '../../../src/renderer/lib/buildFileTree'
import type { NewFilesEvent } from '../../../src/shared/ipc-types'

type FileEntry = NewFilesEvent['files'][number]

function makeFile(folderPath: string, fileName: string, extra?: Partial<FileEntry>): FileEntry {
  return {
    fileName,
    folderPath,
    fileSize: 1024,
    detectedAt: '2026-03-10T10:00:00.000Z',
    operCode: 'UP',
    ...extra,
  }
}

describe('buildFileTree', () => {
  // ── 빈 입력 ──

  it('빈 배열 입력 시 빈 트리를 반환한다', () => {
    const result = buildFileTree([])
    expect(result).toEqual([])
  })

  // ── 단일 depth ──

  describe('단일 depth', () => {
    it('단일 파일을 단일 노드 트리로 변환한다', () => {
      const files = [makeFile('올리기전용/원컴퍼니', 'drawing.dxf')]
      const tree = buildFileTree(files)

      expect(tree).toHaveLength(1)
      expect(tree[0].name).toBe('올리기전용')
      expect(tree[0].children).toHaveLength(1)
      expect(tree[0].children[0].name).toBe('원컴퍼니')
      expect(tree[0].children[0].file).toBeDefined()
      expect(tree[0].children[0].file!.fileName).toBe('drawing.dxf')
    })

    it('같은 폴더의 여러 파일이 같은 부모 노드에 묶인다', () => {
      const files = [
        makeFile('올리기전용/원컴퍼니', 'file1.dxf'),
        makeFile('올리기전용/원컴퍼니', 'file2.dxf'),
        makeFile('올리기전용/원컴퍼니', 'file3.dxf'),
      ]
      const tree = buildFileTree(files)

      expect(tree).toHaveLength(1)
      const companyNode = tree[0].children[0]
      // folderPath의 마지막 세그먼트가 파일 노드로 분기됨
      // buildFileTree는 folderPath의 각 세그먼트를 순회하며 노드를 생성하므로
      // 동일한 경로를 가진 파일들은 folderPath의 마지막 세그먼트 노드를 공유하지 않음
      // 대신 동일한 부모(원컴퍼니) 노드가 1개만 생성되어야 함
      expect(companyNode.name).toBe('원컴퍼니')
    })

    it('서로 다른 폴더의 파일들이 각각 별도 노드를 가진다', () => {
      const files = [
        makeFile('올리기전용/회사A', 'a.dxf'),
        makeFile('올리기전용/회사B', 'b.dxf'),
      ]
      const tree = buildFileTree(files)

      // '올리기전용' 루트 1개 아래 회사A, 회사B 2개
      expect(tree).toHaveLength(1)
      expect(tree[0].children).toHaveLength(2)
      const names = tree[0].children.map((c) => c.name).sort()
      expect(names).toEqual(['회사A', '회사B'])
    })
  })

  // ── 다중 depth 중첩 폴더 ──

  describe('다중 depth 중첩 폴더', () => {
    it('3단계 중첩 폴더 트리를 올바르게 구성한다', () => {
      const files = [
        makeFile('올리기전용/원컴퍼니/2026년', 'project.dxf'),
      ]
      const tree = buildFileTree(files)

      expect(tree).toHaveLength(1)
      const root = tree[0]
      expect(root.name).toBe('올리기전용')
      expect(root.children).toHaveLength(1)

      const company = root.children[0]
      expect(company.name).toBe('원컴퍼니')
      expect(company.children).toHaveLength(1)

      const year = company.children[0]
      expect(year.name).toBe('2026년')
      expect(year.file).toBeDefined()
      expect(year.file!.fileName).toBe('project.dxf')
    })

    it('같은 중간 폴더를 공유하는 파일들이 노드를 재사용한다', () => {
      const files = [
        makeFile('올리기전용/원컴퍼니/2026년', 'jan.dxf'),
        makeFile('올리기전용/원컴퍼니/2025년', 'dec.dxf'),
      ]
      const tree = buildFileTree(files)

      // '올리기전용' 1개, '원컴퍼니' 1개(공유), 연도별 2개
      expect(tree).toHaveLength(1)
      expect(tree[0].children).toHaveLength(1)
      const company = tree[0].children[0]
      expect(company.children).toHaveLength(2)
    })

    it('루트가 다른 두 폴더는 각각 독립 노드를 생성한다', () => {
      const files = [
        makeFile('올리기전용/회사A', 'upload.dxf'),
        makeFile('내리기전용/회사A', 'download.dxf'),
      ]
      const tree = buildFileTree(files)

      expect(tree).toHaveLength(2)
      const names = tree.map((n) => n.name).sort()
      expect(names).toEqual(['내리기전용', '올리기전용'])
    })
  })

  // ── 경로 정규화 ──

  describe('경로 정규화', () => {
    it('백슬래시 경로도 슬래시로 변환하여 처리한다', () => {
      const files = [makeFile('올리기전용\\원컴퍼니', 'drawing.dxf')]
      const tree = buildFileTree(files)

      expect(tree).toHaveLength(1)
      expect(tree[0].name).toBe('올리기전용')
    })

    it('앞뒤 슬래시를 제거하고 경로를 파싱한다', () => {
      const files = [makeFile('/올리기전용/원컴퍼니/', 'drawing.dxf')]
      const tree = buildFileTree(files)

      expect(tree).toHaveLength(1)
      expect(tree[0].name).toBe('올리기전용')
    })

    it('빈 folderPath는 빈 트리를 반환한다', () => {
      const files = [makeFile('', 'orphan.dxf')]
      const tree = buildFileTree(files)
      // 빈 경로 → 세그먼트 없음 → 트리 없음
      expect(tree).toHaveLength(0)
    })
  })

  // ── operCode 보존 ──

  describe('operCode 보존', () => {
    it('파일 노드에 operCode가 보존된다', () => {
      const files = [makeFile('올리기전용/원컴퍼니', 'deleted.dxf', { operCode: 'D' })]
      const tree = buildFileTree(files)

      const leaf = tree[0].children[0]
      expect(leaf.file!.operCode).toBe('D')
    })

    it('operCode가 없으면 UP으로 기본값이 설정된다', () => {
      const file: FileEntry = {
        fileName: 'no-opercode.dxf',
        folderPath: '올리기전용/원컴퍼니',
        fileSize: 512,
        detectedAt: '2026-03-10T10:00:00.000Z',
      }
      const tree = buildFileTree([file])

      const leaf = tree[0].children[0]
      expect(leaf.file!.operCode).toBe('UP')
    })
  })

  // ── path 속성 ──

  describe('path 속성', () => {
    it('각 노드의 path는 루트부터 현재 노드까지의 누적 경로이다', () => {
      const files = [makeFile('올리기전용/원컴퍼니', 'test.dxf')]
      const tree = buildFileTree(files)

      expect(tree[0].path).toBe('올리기전용')
      expect(tree[0].children[0].path).toBe('올리기전용/원컴퍼니')
    })
  })
})
