import { v4 as uuid } from 'uuid'
import type {
  IWebhardUploader,
  ConnectionTestResult,
  WResult,
  FolderInfo,
  UploadedFileInfo,
  WebhardFileInfo,
  UploadFileParams,
  BatchUploadResult,
} from '../types/webhard-uploader.types'

type EventHandler = (...args: unknown[]) => void

interface MockFile {
  id: string
  name: string
  size: number
  folderId: string
  createdAt: string
}

interface MockFolder {
  id: string
  name: string
  parentId: string | null
  createdAt: string
}

export class MockUploader implements IWebhardUploader {
  private connected = true
  private folders = new Map<string, MockFolder>()
  private files = new Map<string, MockFile[]>() // folderId -> files
  private eventHandlers = new Map<string, EventHandler[]>()

  async testConnection(): Promise<ConnectionTestResult> {
    return {
      success: this.connected,
      latencyMs: 15,
      message: this.connected ? 'Connected' : 'Disconnected',
      serverVersion: '1.0.0-mock',
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  setConnected(value: boolean): void {
    this.connected = value
    if (!value) {
      this.emitEvent('connection-lost')
    }
  }

  async createFolder(params: {
    name: string
    parentId: string | null
  }): Promise<WResult<FolderInfo>> {
    if (!this.connected) {
      return { success: false, error: 'Not connected' }
    }

    const folder: MockFolder = {
      id: uuid(),
      name: params.name,
      parentId: params.parentId,
      createdAt: new Date().toISOString(),
    }
    this.folders.set(folder.id, folder)
    this.files.set(folder.id, [])

    return { success: true, data: folder }
  }

  async findFolder(
    name: string,
    parentId: string | null,
  ): Promise<WResult<FolderInfo | null>> {
    if (!this.connected) {
      return { success: false, error: 'Not connected' }
    }

    for (const folder of this.folders.values()) {
      if (folder.name === name && folder.parentId === parentId) {
        return { success: true, data: folder }
      }
    }
    return { success: true, data: null }
  }

  async ensureFolderPath(segments: string[]): Promise<WResult<string>> {
    if (!this.connected) {
      return { success: false, error: 'Not connected' }
    }

    let parentId: string | null = null

    for (const segment of segments) {
      const found = await this.findFolder(segment, parentId)
      if (found.success && found.data) {
        parentId = found.data.id
      } else {
        const created = await this.createFolder({ name: segment, parentId })
        if (!created.success || !created.data) {
          return { success: false, error: `Failed to create folder '${segment}'` }
        }
        parentId = created.data.id
      }
    }

    return { success: true, data: parentId! }
  }

  async uploadFile(params: UploadFileParams): Promise<WResult<UploadedFileInfo>> {
    if (!this.connected) {
      return { success: false, error: 'Not connected' }
    }

    const file: MockFile = {
      id: uuid(),
      name: params.originalName,
      size: 1024, // mock size
      folderId: params.folderId,
      createdAt: new Date().toISOString(),
    }

    if (!this.files.has(params.folderId)) {
      this.files.set(params.folderId, [])
    }
    this.files.get(params.folderId)!.push(file)

    this.emitEvent('upload-completed', file)

    return {
      success: true,
      data: {
        id: file.id,
        name: file.name,
        size: file.size,
        folderId: file.folderId,
        uploadedAt: file.createdAt,
      },
    }
  }

  async uploadFileBatch(
    files: UploadFileParams[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<BatchUploadResult> {
    const start = Date.now()
    let success = 0
    let failed = 0
    let skipped = 0

    for (let i = 0; i < files.length; i++) {
      const result = await this.uploadFile(files[i])
      if (result.success) {
        success++
      } else {
        failed++
      }
      onProgress?.(i + 1, files.length)
    }

    return {
      total: files.length,
      success,
      failed,
      skipped,
      durationMs: Date.now() - start,
    }
  }

  async fileExists(folderId: string, fileName: string): Promise<boolean> {
    const folderFiles = this.files.get(folderId)
    if (!folderFiles) return false
    return folderFiles.some((f) => f.name === fileName)
  }

  async listFiles(folderId: string): Promise<WResult<WebhardFileInfo[]>> {
    if (!this.connected) {
      return { success: false, error: 'Not connected' }
    }

    const folderFiles = this.files.get(folderId) ?? []
    return {
      success: true,
      data: folderFiles.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        createdAt: f.createdAt,
      })),
    }
  }

  on(
    event: 'upload-completed' | 'upload-failed' | 'connection-lost',
    handler: (...args: unknown[]) => void,
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, [])
    }
    this.eventHandlers.get(event)!.push(handler)
  }

  private emitEvent(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      for (const handler of handlers) {
        handler(...args)
      }
    }
  }
}
