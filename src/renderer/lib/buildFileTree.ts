// src/renderer/lib/buildFileTree.ts — 감지된 파일 목록을 디렉토리 트리로 변환

import type { NewFilesEvent } from '../../shared/ipc-types'

export interface FileTreeNode {
  /** 디렉토리 또는 파일 이름 */
  name: string
  /** 루트 기준 전체 경로 */
  path: string
  /** 하위 노드 (디렉토리인 경우) */
  children: FileTreeNode[]
  /** 파일 메타 (파일 노드인 경우) */
  file?: {
    fileName: string
    operCode: string
    fileSize: number
    detectedAt: string
  }
}

/**
 * NewFilesEvent의 files 배열을 FileTreeNode 트리로 변환하는 순수 함수.
 * 경로 구분자는 `/`와 `\` 모두 지원.
 */
export function buildFileTree(files: NewFilesEvent['files']): FileTreeNode[] {
  const root: FileTreeNode = { name: '', path: '', children: [] }

  for (const f of files) {
    // 경로 정규화: 백슬래시 → 슬래시, 앞뒤 슬래시 제거
    const normalizedPath = f.folderPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const segments = normalizedPath.split('/').filter(Boolean)

    let current = root
    let accPath = ''

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      accPath = accPath ? `${accPath}/${seg}` : seg
      const isLast = i === segments.length - 1

      let node = current.children.find((c) => c.name === seg)
      if (!node) {
        node = {
          name: seg,
          path: accPath,
          children: [],
          ...(isLast
            ? {
                file: {
                  fileName: f.fileName,
                  operCode: f.operCode ?? 'UP',
                  fileSize: f.fileSize,
                  detectedAt: f.detectedAt,
                },
              }
            : {}),
        }
        current.children.push(node)
      } else if (isLast && !node.file) {
        // 이미 디렉토리 노드로 생성된 경우 파일 메타 보강
        node.file = {
          fileName: f.fileName,
          operCode: f.operCode ?? 'UP',
          fileSize: f.fileSize,
          detectedAt: f.detectedAt,
        }
      }

      current = node
    }
  }

  return root.children
}
