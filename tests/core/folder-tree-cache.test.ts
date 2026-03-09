import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FolderTreeCache } from '../../src/core/folder-tree-cache'

describe('FolderTreeCache', () => {
  let cache: FolderTreeCache

  beforeEach(() => {
    cache = new FolderTreeCache({ ttlMs: 5000 })
  })

  it('캐시 미스 시 null 반환', () => {
    expect(cache.getSubFolders(100)).toBeNull()
  })

  it('캐시 히트 시 저장된 데이터 반환', () => {
    const folders = [{ folderId: 10, folderName: 'A', parentFolderId: 100 }]
    cache.setSubFolders(100, folders)
    expect(cache.getSubFolders(100)).toEqual(folders)
  })

  it('TTL 만료 후 null 반환', () => {
    vi.useFakeTimers()
    const folders = [{ folderId: 10, folderName: 'A', parentFolderId: 100 }]
    cache.setSubFolders(100, folders)

    vi.advanceTimersByTime(6000) // TTL 초과
    expect(cache.getSubFolders(100)).toBeNull()

    vi.useRealTimers()
  })

  it('invalidate()로 특정 폴더 캐시 삭제', () => {
    const folders = [{ folderId: 10, folderName: 'A', parentFolderId: 100 }]
    cache.setSubFolders(100, folders)
    cache.invalidate(100)
    expect(cache.getSubFolders(100)).toBeNull()
  })

  it('clear()로 전체 캐시 삭제', () => {
    cache.setSubFolders(100, [])
    cache.setSubFolders(200, [])
    cache.clear()
    expect(cache.getSubFolders(100)).toBeNull()
    expect(cache.getSubFolders(200)).toBeNull()
  })

  it('fileCount 캐시도 동작한다', () => {
    expect(cache.getFileCount(100)).toBeNull()
    cache.setFileCount(100, 42)
    expect(cache.getFileCount(100)).toBe(42)
  })

  it('fileCount TTL 만료 후 null 반환', () => {
    vi.useFakeTimers()
    cache.setFileCount(100, 42)
    vi.advanceTimersByTime(6000)
    expect(cache.getFileCount(100)).toBeNull()
    vi.useRealTimers()
  })
})
