// src/core/types/lguplus-client.types.ts — [SPEC] LGU+ client contract
// SDD Level 2: ILGUplusClient interface

import type { LGUplusSessionEventMap } from './events.types'

export type LoginResult =
  | { success: true }
  | { success: false; message: string }

export interface LGUplusFolderItem {
  folderId: number
  folderName: string
  parentFolderId: number
  subFolderCount?: number
}

export interface LGUplusFileItem {
  itemId: number
  itemName: string
  itemSize: number
  itemExtension: string
  parentFolderId: number
  updatedAt: string
  isFolder: boolean
  relativePath?: string
}

export interface UploadHistoryItem {
  historyNo: number
  itemSrcNo: number
  itemFolderId: number
  itemSrcName: string
  itemSrcExtension: string
  itemSrcType: string
  itemFolderFullpath: string
  itemOperCode: string
  itemUseDate: string
}

export interface UploadHistoryResponse {
  total: number
  pageSize: number
  items: UploadHistoryItem[]
}

export interface DownloadUrlInfo {
  url: string
  session: string
  nonce: string
  userId: string
  fileOwnerEncId: string
  fileName: string
  fileSize: number
}

export interface DownloadResult {
  success: boolean
  size: number
  filename: string
}

export type ProgressCallback = (downloadedBytes: number, totalBytes: number) => void

export interface CreateFolderResult {
  success: boolean
  resultCode: string
  resultMsg: string
}

export interface ILGUplusClient {
  // Auth
  login(userId: string, password: string): Promise<LoginResult>
  logout(): Promise<void>
  isAuthenticated(): boolean
  validateSession(): Promise<boolean>
  refreshSession(): Promise<boolean>

  // Folders (read)
  getGuestFolderRootId(): Promise<number | null>
  getSubFolders(folderId: number): Promise<LGUplusFolderItem[]>
  findFolderByName(parentId: number, name: string): Promise<number | null>

  // Folders (write) — guest folders only support creation
  createFolder(parentId: number, name: string): Promise<CreateFolderResult>

  // Files
  getFileList(
    folderId: number,
    options?: { page?: number },
  ): Promise<{ items: LGUplusFileItem[]; total: number }>
  getAllFiles(
    folderId: number,
    onProgress?: (page: number, fetched: number, total: number) => void,
  ): Promise<LGUplusFileItem[]>
  getAllFilesDeep(
    folderId: number,
    options?: {
      maxDepth?: number
      concurrency?: number
    },
  ): Promise<LGUplusFileItem[]>

  // Download
  getDownloadUrlInfo(fileId: number): Promise<DownloadUrlInfo | null>
  downloadFile(
    fileId: number,
    destPath: string,
    onProgress?: ProgressCallback,
  ): Promise<DownloadResult>
  batchDownload(
    files: LGUplusFileItem[],
    destDir: string,
    options?: {
      concurrency?: number
      onProgress?: (done: number, total: number, current: string) => void
    },
  ): Promise<{
    success: number
    failed: number
    totalSize: number
    failedFiles: LGUplusFileItem[]
  }>

  // History
  getUploadHistory(options?: {
    startDate?: string
    endDate?: string
    operCode?: string
    page?: number
  }): Promise<UploadHistoryResponse>

  // Session events
  on<K extends keyof LGUplusSessionEventMap>(
    event: K,
    handler: (data: LGUplusSessionEventMap[K]) => void,
  ): void
}
