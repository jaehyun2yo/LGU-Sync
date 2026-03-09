import type { LGUplusFolderItem } from './types/lguplus-client.types'

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

export class FolderTreeCache {
  private subFoldersCache = new Map<number, CacheEntry<LGUplusFolderItem[]>>()
  private fileCountCache = new Map<number, CacheEntry<number>>()
  private ttlMs: number

  constructor(options?: { ttlMs?: number }) {
    this.ttlMs = options?.ttlMs ?? 5 * 60 * 1000 // 기본 5분
  }

  getSubFolders(folderId: number): LGUplusFolderItem[] | null {
    const entry = this.subFoldersCache.get(folderId)
    if (!entry || Date.now() > entry.expiresAt) {
      this.subFoldersCache.delete(folderId)
      return null
    }
    return entry.data
  }

  setSubFolders(folderId: number, folders: LGUplusFolderItem[]): void {
    this.subFoldersCache.set(folderId, {
      data: folders,
      expiresAt: Date.now() + this.ttlMs,
    })
  }

  getFileCount(folderId: number): number | null {
    const entry = this.fileCountCache.get(folderId)
    if (!entry || Date.now() > entry.expiresAt) {
      this.fileCountCache.delete(folderId)
      return null
    }
    return entry.data
  }

  setFileCount(folderId: number, count: number): void {
    this.fileCountCache.set(folderId, {
      data: count,
      expiresAt: Date.now() + this.ttlMs,
    })
  }

  invalidate(folderId: number): void {
    this.subFoldersCache.delete(folderId)
    this.fileCountCache.delete(folderId)
  }

  clear(): void {
    this.subFoldersCache.clear()
    this.fileCountCache.clear()
  }
}
