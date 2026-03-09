import type { LGUplusFolderItem } from './types/lguplus-client.types'
import type { MigrationFolderInfo } from '../shared/ipc-types'

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

export class FolderTreeCache {
  private subFoldersCache = new Map<number, CacheEntry<LGUplusFolderItem[]>>()
  private fileCountCache = new Map<number, CacheEntry<number>>()
  private scanResultCache: CacheEntry<MigrationFolderInfo[]> | null = null
  private ttlMs: number
  private scanResultTtlMs: number

  constructor(options?: { ttlMs?: number; scanResultTtlMs?: number }) {
    this.ttlMs = options?.ttlMs ?? 5 * 60 * 1000 // 기본 5분
    this.scanResultTtlMs = options?.scanResultTtlMs ?? 30 * 60 * 1000 // 30분
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

  getScanResult(): { data: MigrationFolderInfo[]; cachedAt: number } | null {
    if (!this.scanResultCache || Date.now() > this.scanResultCache.expiresAt) {
      this.scanResultCache = null
      return null
    }
    return {
      data: this.scanResultCache.data,
      cachedAt: this.scanResultCache.expiresAt - this.scanResultTtlMs,
    }
  }

  setScanResult(folders: MigrationFolderInfo[]): void {
    this.scanResultCache = {
      data: folders,
      expiresAt: Date.now() + this.scanResultTtlMs,
    }
  }

  invalidateScanResult(): void {
    this.scanResultCache = null
  }

  clear(): void {
    this.subFoldersCache.clear()
    this.fileCountCache.clear()
    this.scanResultCache = null
  }
}
