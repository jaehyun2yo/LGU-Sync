// src/core/types/folder.types.ts — [SPEC] Folder cache and discovery contracts
// SDD Level 2: IFolderTreeCache, IFolderDiscovery interfaces

import type { LGUplusFolderItem } from './lguplus-client.types'

export interface IFolderTreeCache {
  getSubFolders(folderId: number): LGUplusFolderItem[] | null
  setSubFolders(folderId: number, folders: LGUplusFolderItem[]): void
  getFileCount(folderId: number): number | null
  setFileCount(folderId: number, count: number): void
  invalidate(folderId: number): void
  clear(): void
}

export interface DiscoveryResult {
  total: number
  newFolders: number
  existingFolders: number
  folders: Array<{
    id: string
    lguplusFolderId: string
    folderName: string
    isNew: boolean
  }>
}

export interface IFolderDiscovery {
  discoverFolders(): Promise<DiscoveryResult>
}
