// src/core/types/webhard-uploader.types.ts — [SPEC] Webhard uploader contract
// SDD Level 2: IWebhardUploader interface

export interface ConnectionTestResult {
  success: boolean
  latencyMs: number
  message: string
  serverVersion?: string
}

export type WResult<T> = { success: boolean; data?: T; error?: string }

export interface FolderInfo {
  id: string
  name: string
  parentId: string | null
  createdAt: string
}

export interface UploadedFileInfo {
  id: string
  name: string
  size: number
  folderId: string
  uploadedAt: string
}

export interface WebhardFileInfo {
  id: string
  name: string
  size: number
  createdAt: string
}

export interface UploadFileParams {
  folderId: string
  filePath: string
  originalName: string
  checksum?: string
}

export interface BatchUploadResult {
  total: number
  success: number
  failed: number
  skipped: number
  durationMs: number
}

export interface IWebhardUploader {
  testConnection(): Promise<ConnectionTestResult>
  isConnected(): boolean

  // Folders
  createFolder(params: {
    name: string
    parentId: string | null
  }): Promise<WResult<FolderInfo>>
  findFolder(name: string, parentId: string | null): Promise<WResult<FolderInfo | null>>
  ensureFolderPath(segments: string[]): Promise<WResult<string>>

  // Files
  uploadFile(params: UploadFileParams): Promise<WResult<UploadedFileInfo>>
  uploadFileBatch(
    files: UploadFileParams[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<BatchUploadResult>
  fileExists(folderId: string, fileName: string): Promise<boolean>
  listFiles(folderId: string): Promise<WResult<WebhardFileInfo[]>>

  // File operations
  deleteFile(fileId: string): Promise<WResult<void>>
  moveFile(fileId: string, targetFolderId: string): Promise<WResult<void>>
  renameFile(fileId: string, newName: string): Promise<WResult<void>>

  // Folder operations
  deleteFolder(folderId: string): Promise<WResult<void>>
  moveFolder(folderId: string, targetParentId: string): Promise<WResult<void>>
  renameFolder(folderId: string, newName: string): Promise<WResult<void>>

  // Events
  on(
    event: 'upload-completed' | 'upload-failed' | 'connection-lost',
    handler: (...args: unknown[]) => void,
  ): void
}
