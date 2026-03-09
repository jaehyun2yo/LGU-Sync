import type { LGUplusFileItem } from './types/lguplus-client.types'
import type { DetectedFile } from './types/events.types'

export interface SnapshotDiff {
  newFiles: DetectedFile[]
  deletedFileIds: number[]
}

/**
 * 현재 폴더 파일 목록과 이미 알려진 파일 ID 집합을 비교하여
 * 신규 파일과 삭제된 파일을 반환한다.
 */
export function diffSnapshot(
  currentFiles: LGUplusFileItem[],
  knownFileIds: Set<number>,
  folderId: string,
): SnapshotDiff {
  const currentFileIds = new Set(currentFiles.map((f) => f.itemId))

  // 신규 파일: 현재 폴더에 있지만 DB에 없는 파일 (폴더 제외)
  // snapshot 전략으로 감지된 파일은 operCode를 'UP'으로 추론
  const newFiles: DetectedFile[] = currentFiles
    .filter((f) => !f.isFolder && !knownFileIds.has(f.itemId))
    .map((f) => ({
      fileName: f.itemName,
      filePath: f.relativePath ? `${f.relativePath}/${f.itemName}` : f.itemName,
      fileSize: f.itemSize,
      folderId,
      operCode: 'UP' as const,
    }))

  // 삭제된 파일: DB에 있지만 현재 폴더에 없는 파일
  const deletedFileIds = [...knownFileIds].filter((id) => !currentFileIds.has(id))

  return { newFiles, deletedFileIds }
}
