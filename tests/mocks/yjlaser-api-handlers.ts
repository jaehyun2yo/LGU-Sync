import { http, HttpResponse } from 'msw'

const SYNC_BASE = 'https://test-api.yjlaser.com/api/webhard/migration/sync'
const API_KEY = 'test-api-key-123'
const R2_BASE = 'https://mock-r2.storage.com'

// In-memory state
interface MockFolder {
  id: string
  name: string
  parent_id: string | null
  created_at: string
}

interface MockFile {
  id: string
  object_key: string
  public_url: string
  folder_id: string
  file_name: string
  size: number
  created_at: string
}

let folders = new Map<string, MockFolder>()
let files = new Map<string, MockFile>()
let folderCounter = 0
let fileCounter = 0

export function resetYjlaserMockState(): void {
  folders = new Map()
  files = new Map()
  folderCounter = 0
  fileCounter = 0
}

function checkAuth(request: Request): HttpResponse | null {
  const apiKey = request.headers.get('X-API-Key')
  if (apiKey !== API_KEY) {
    return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export const yjlaserApiHandlers = [
  // Health check
  http.get('https://test-api.yjlaser.com/api/health', ({ request }) => {
    const authError = checkAuth(request)
    if (authError) return authError
    return HttpResponse.json({ status: 'ok', version: '1.0.0' })
  }),

  // GET /folders — search by name + parent_id
  http.get(`${SYNC_BASE}/folders`, ({ request }) => {
    const authError = checkAuth(request)
    if (authError) return authError

    const url = new URL(request.url)
    const name = url.searchParams.get('name')
    const parentIdParam = url.searchParams.get('parent_id')
    const parentId = parentIdParam === 'null' ? null : parentIdParam

    for (const folder of folders.values()) {
      if (folder.name === name && folder.parent_id === parentId) {
        return HttpResponse.json({ data: folder })
      }
    }

    return HttpResponse.json({ data: null })
  }),

  // POST /folders — create (upsert)
  http.post(`${SYNC_BASE}/folders`, async ({ request }) => {
    const authError = checkAuth(request)
    if (authError) return authError

    const body = (await request.json()) as { name: string; parent_id: string | null }

    // Check if already exists (upsert)
    for (const folder of folders.values()) {
      if (folder.name === body.name && folder.parent_id === body.parent_id) {
        return HttpResponse.json({ data: folder, existed: true })
      }
    }

    folderCounter++
    const folder: MockFolder = {
      id: `folder-${folderCounter}`,
      name: body.name,
      parent_id: body.parent_id,
      created_at: new Date().toISOString(),
    }
    folders.set(folder.id, folder)

    return HttpResponse.json({ data: folder, existed: false }, { status: 201 })
  }),

  // GET /files/exists — check if file exists in folder
  http.get(`${SYNC_BASE}/files/exists`, ({ request }) => {
    const authError = checkAuth(request)
    if (authError) return authError

    const url = new URL(request.url)
    const folderId = url.searchParams.get('folder_id')
    const name = url.searchParams.get('name')

    for (const file of files.values()) {
      if (file.folder_id === folderId && file.file_name === name) {
        return HttpResponse.json({ data: true })
      }
    }

    return HttpResponse.json({ data: false })
  }),

  // POST /presign — generate presigned URL
  http.post(`${SYNC_BASE}/presign`, async ({ request }) => {
    const authError = checkAuth(request)
    if (authError) return authError

    const body = (await request.json()) as {
      fileName: string
      folderId: string
      size: number
    }

    // Check if already uploaded
    for (const file of files.values()) {
      if (file.folder_id === body.folderId && file.file_name === body.fileName) {
        return HttpResponse.json({
          data: {
            objectKey: file.object_key,
            presignedUrl: `${R2_BASE}/${file.object_key}`,
            publicUrl: file.public_url,
          },
          existed: true,
        })
      }
    }

    fileCounter++
    const objectKey = `sync/${body.folderId}/${fileCounter}-${body.fileName}`
    const presignedUrl = `${R2_BASE}/${objectKey}`
    const publicUrl = `https://cdn.yjlaser.com/${objectKey}`

    return HttpResponse.json({
      data: {
        objectKey,
        presignedUrl,
        publicUrl,
      },
      existed: false,
    })
  }),

  // PUT R2 — mock R2 upload
  http.put(`${R2_BASE}/*`, () => {
    return new HttpResponse(null, { status: 200 })
  }),

  // POST /batch-record — record file metadata
  http.post(`${SYNC_BASE}/batch-record`, async ({ request }) => {
    const authError = checkAuth(request)
    if (authError) return authError

    const body = (await request.json()) as {
      files: Array<{
        objectKey: string
        publicUrl: string
        folderId: string
        fileName: string
        size: number
      }>
    }

    const recorded: MockFile[] = []
    for (const f of body.files) {
      fileCounter++
      const file: MockFile = {
        id: `file-${fileCounter}`,
        object_key: f.objectKey,
        public_url: f.publicUrl,
        folder_id: f.folderId,
        file_name: f.fileName,
        size: f.size,
        created_at: new Date().toISOString(),
      }
      files.set(file.id, file)
      recorded.push(file)
    }

    return HttpResponse.json({
      success: true,
      data: {
        inserted: recorded.length,
        files: recorded.map((f) => ({
          id: fileCounter,
          name: f.file_name,
          folder_id: f.folder_id,
        })),
      },
    })
  }),
]
