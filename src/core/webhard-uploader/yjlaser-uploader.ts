import { readFile, stat } from 'node:fs/promises'
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
import type { ILogger } from '../types/logger.types'
import type { IRetryManager } from '../types/retry-manager.types'
import { AuthWebhardKeyInvalidError } from '../errors'

type EventHandler = (...args: unknown[]) => void

export class YjlaserUploader implements IWebhardUploader {
  private apiUrl: string
  private apiKey: string
  private logger: ILogger
  private retry: IRetryManager
  private _connected = false
  private eventHandlers = new Map<string, EventHandler[]>()

  constructor(apiUrl: string, apiKey: string, logger: ILogger, retry: IRetryManager) {
    this.apiUrl = apiUrl
    this.apiKey = apiKey
    this.logger = logger.child({ module: 'yjlaser-uploader' })
    this.retry = retry
  }

  // ── Private helpers ──

  private get baseApiUrl(): string {
    return `${this.apiUrl}/api/webhard/migration/sync`
  }

  private get authHeaders(): Record<string, string> {
    return { 'X-API-Key': this.apiKey, 'Content-Type': 'application/json' }
  }

  private async apiGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseApiUrl}${path}`)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value)
      }
    }

    const res = await fetch(url.toString(), { headers: this.authHeaders })

    if (res.status === 401) {
      this.emitEvent('connection-lost')
      throw new AuthWebhardKeyInvalidError('API key is invalid or expired')
    }

    if (!res.ok) {
      throw new Error(`API GET ${path} failed: HTTP ${res.status}`)
    }

    return res.json() as Promise<T>
  }

  private async apiPost<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseApiUrl}${path}`, {
      method: 'POST',
      headers: this.authHeaders,
      body: JSON.stringify(body),
    })

    if (res.status === 401) {
      this.emitEvent('connection-lost')
      throw new AuthWebhardKeyInvalidError('API key is invalid or expired')
    }

    if (!res.ok) {
      throw new Error(`API POST ${path} failed: HTTP ${res.status}`)
    }

    return res.json() as Promise<T>
  }

  private emitEvent(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      for (const handler of handlers) {
        handler(...args)
      }
    }
  }

  // ── Public API ──

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const res = await fetch(`${this.apiUrl}/api/health`, {
        headers: { 'X-API-Key': this.apiKey },
      })
      const latencyMs = Date.now() - start
      if (res.ok) {
        this._connected = true
        return { success: true, latencyMs, message: 'Connected' }
      }
      this._connected = false
      return { success: false, latencyMs, message: `HTTP ${res.status}` }
    } catch (err) {
      this._connected = false
      return {
        success: false,
        latencyMs: Date.now() - start,
        message: (err as Error).message,
      }
    }
  }

  isConnected(): boolean {
    return this._connected
  }

  async findFolder(
    name: string,
    parentId: string | null,
  ): Promise<WResult<FolderInfo | null>> {
    try {
      const res = await this.apiGet<{ data: any }>('/folders', {
        name,
        parent_id: parentId ?? 'null',
      })

      if (!res.data) {
        return { success: true, data: null }
      }

      return {
        success: true,
        data: {
          id: res.data.id,
          name: res.data.name,
          parentId: res.data.parent_id ?? null,
          createdAt: res.data.created_at,
        },
      }
    } catch (err) {
      this.logger.error('findFolder failed', err as Error)
      return { success: false, error: (err as Error).message }
    }
  }

  async createFolder(params: {
    name: string
    parentId: string | null
  }): Promise<WResult<FolderInfo>> {
    try {
      const res = await this.apiPost<{ data: any; existed: boolean }>('/folders', {
        name: params.name,
        parent_id: params.parentId,
      })

      return {
        success: true,
        data: {
          id: res.data.id,
          name: res.data.name,
          parentId: res.data.parent_id ?? null,
          createdAt: res.data.created_at,
        },
      }
    } catch (err) {
      this.logger.error('createFolder failed', err as Error)
      return { success: false, error: (err as Error).message }
    }
  }

  async ensureFolderPath(segments: string[]): Promise<WResult<string>> {
    if (segments.length === 0) {
      return { success: false, error: 'Folder path segments cannot be empty' }
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
    try {
      // 1. Read file
      const buffer = await readFile(params.filePath)
      const fileStat = await stat(params.filePath)
      const size = fileStat.size

      // 2. Get presigned URL
      const presignRes = await this.apiPost<{
        data: { objectKey: string; presignedUrl: string; publicUrl: string }
        existed: boolean
      }>('/presign', {
        fileName: params.originalName,
        folderId: params.folderId,
        size,
      })

      // Already uploaded — skip
      if (presignRes.existed) {
        const skippedFile: UploadedFileInfo = {
          id: presignRes.data.objectKey,
          name: params.originalName,
          size,
          folderId: params.folderId,
          uploadedAt: new Date().toISOString(),
        }
        this.emitEvent('upload-completed', skippedFile)
        return { success: true, data: skippedFile }
      }

      // 3. PUT to R2
      const putRes = await fetch(presignRes.data.presignedUrl, {
        method: 'PUT',
        body: buffer,
        headers: { 'Content-Type': 'application/octet-stream' },
      })

      if (!putRes.ok) {
        throw new Error(`R2 PUT failed: HTTP ${putRes.status}`)
      }

      // 4. Record metadata via batch-record
      const recordRes = await this.apiPost<{
        success: boolean
        data: {
          inserted: number
          files: Array<{ id: number; name: string; folder_id: string }>
        }
      }>('/batch-record', {
        files: [
          {
            objectKey: presignRes.data.objectKey,
            publicUrl: presignRes.data.publicUrl,
            folderId: params.folderId,
            fileName: params.originalName,
            size,
          },
        ],
      })

      const recorded = recordRes.data?.files?.[0]
      if (!recorded) {
        throw new Error(
          `batch-record returned no file data (inserted: ${recordRes.data?.inserted ?? 'unknown'})`,
        )
      }
      const uploadedFile: UploadedFileInfo = {
        id: String(recorded.id),
        name: recorded.name,
        size,
        folderId: recorded.folder_id,
        uploadedAt: new Date().toISOString(),
      }

      this.emitEvent('upload-completed', uploadedFile)
      return { success: true, data: uploadedFile }
    } catch (err) {
      this.logger.error('uploadFile failed', err as Error, {
        fileName: params.originalName,
        folderId: params.folderId,
      })
      this.emitEvent('upload-failed', {
        fileName: params.originalName,
        error: (err as Error).message,
      })
      return { success: false, error: (err as Error).message }
    }
  }

  async uploadFileBatch(
    files: UploadFileParams[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<BatchUploadResult> {
    const start = Date.now()
    let success = 0
    let failed = 0
    const skipped = 0

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
    try {
      const res = await this.apiGet<{ data: boolean }>('/files/exists', {
        folder_id: folderId,
        name: fileName,
      })
      return res.data === true
    } catch {
      return false
    }
  }

  async listFiles(_folderId: string): Promise<WResult<WebhardFileInfo[]>> {
    return {
      success: false,
      error: 'Not supported: sync API does not provide file listing',
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
}
