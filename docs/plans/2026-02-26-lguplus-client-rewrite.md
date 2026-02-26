# LGUplusClient Rewrite — Real LGU+ Webhard API Implementation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite `LGUplusClient` to use the real LGU+ webhard API (`POST /wh` with `MESSAGE_TYPE`/`PROCESS_TYPE`) instead of the fictional REST endpoints that don't exist.

**Architecture:** The `ILGUplusClient` interface contract stays unchanged. Only the internal implementation and MSW mock handlers change. The real LGU+ webhard uses a single `POST /wh` endpoint for all API calls, form-based login with specific fields (`fakeLoginId`, `loginId`, `password`, `userType`), and browser-like headers (`User-Agent`, `Origin`, `Referer`). Downloads go through `GET /downloads/{fileId}/server` then actual file fetch.

**Tech Stack:** Node.js fetch, MSW (mock service worker), Vitest

---

## Background: Real LGU+ Webhard API

### Login Flow (3-step)
1. `GET /login` — acquire initial session cookies
2. `POST /login-process` — form fields: `{ id:'', pw:'', health:'', userType:'Manage', fakeLoginId, loginId, password }` with `Origin`/`Referer` headers
3. `GET /folders/home` — verify login success (response contains "로그아웃" keyword)

### All API Calls — Single Endpoint `POST /wh`
```json
{
  "MESSAGE_TYPE": "FOLDER|FILE|USE_HISTORY",
  "PROCESS_TYPE": "TREE|LIST|CREATE|DELETE|MOVE|RENAME",
  "REQUEST_SHARED": "G",
  ...params
}
```
Response: `{ "RESULT_CODE": "0000", "RESULT_MSG": "...", ...data }`

Session expiry signals: `RESULT_CODE === '9999'`, redirect to `/login`, HTML response, HTTP 401

### Download Flow (2-step)
1. `GET /downloads/{fileId}/server?fileStatus=1` — get download URL info (session, nonce, userId, etc.)
2. `GET https://whfile1.webhard.co.kr/file/download?{params}` — actual file download with auth params

### Required Headers (all requests)
```
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...
Cookie: {session cookies}
```
API requests add: `Content-Type: application/json`, `Origin: https://only.webhard.co.kr`, `Referer: https://only.webhard.co.kr/folders/home`

---

## Files Overview

| Action | File |
|--------|------|
| **Rewrite** | `src/core/lguplus-client.ts` |
| **Rewrite** | `tests/mocks/lguplus-handlers.ts` |
| **Update** | `tests/core/lguplus-client.test.ts` |
| **No change** | `src/core/types/lguplus-client.types.ts` (interface preserved) |
| **No change** | `src/core/container.ts`, `src/core/sync-engine.ts`, `src/core/file-detector.ts` |

---

## Task 1: Rewrite MSW Mock Handlers

**Files:**
- Rewrite: `tests/mocks/lguplus-handlers.ts`

**Why first:** Mocks define the "contract" of the real server. Tests run against mocks. Updating mocks first means existing tests will fail (confirming they test the old API), then we fix the implementation.

**Step 1: Rewrite `tests/mocks/lguplus-handlers.ts`**

Replace the entire file with handlers that simulate the real LGU+ webhard API:

```typescript
import { http, HttpResponse } from 'msw'

const BASE_URL = 'https://only.webhard.co.kr'
const DOWNLOAD_SERVER = 'https://whfile1.webhard.co.kr'

// Simulated session store
let validSession = false
let sessionCookie = 'JSESSIONID=mock-session-123; WMONID=mock-wmon-456'

export function resetMockSession(): void {
  validSession = false
}

// ── Mock data ──

const MOCK_FOLDERS = [
  { FOLDER_ID: 1001, FOLDER_NAME: '올리기전용', UPPER_ID: 1000, SUB_CNT: 5 },
  { FOLDER_ID: 1002, FOLDER_NAME: '내리기전용', UPPER_ID: 1000, SUB_CNT: 3 },
]

const MOCK_FILE_LIST = [
  {
    ITEM_ID: 5001,
    ITEM_NAME: 'test.dxf',
    ITEM_SIZE: 10240,
    ITEM_EXTENSION: 'dxf',
    ITEM_PARENT_ID: 1001,
    ITEM_UPDT_DT: '2026-02-23 10:00:00',
    FOLDER_TY_CODE: undefined, // file, not folder
  },
]

const MOCK_HISTORY = [
  {
    HISTORY_NO: 101,
    ITEM_SRC_NO: 5001,
    ITEM_FOLDER_ID: 1001,
    ITEM_SRC_NAME: 'drawing1',
    ITEM_SRC_EXTENSION: 'dxf',
    ITEM_SRC_TYPE: 'file',
    ITEM_FOLDER_FULLPATH: '/올리기전용/원컴퍼니/',
    ITEM_OPER_CODE: 'U',
    ITEM_USE_DATE: '2026-02-23 10:00:00',
  },
  {
    HISTORY_NO: 100,
    ITEM_SRC_NO: 5002,
    ITEM_FOLDER_ID: 1001,
    ITEM_SRC_NAME: 'drawing2',
    ITEM_SRC_EXTENSION: 'dxf',
    ITEM_SRC_TYPE: 'file',
    ITEM_FOLDER_FULLPATH: '/올리기전용/대성목형/',
    ITEM_OPER_CODE: 'U',
    ITEM_USE_DATE: '2026-02-23 09:30:00',
  },
]

// ── Helper ──

function requireSession(): HttpResponse | null {
  if (!validSession) {
    return HttpResponse.json(
      { RESULT_CODE: '9999', RESULT_MSG: '로그인이 필요합니다' },
      { status: 200 },
    )
  }
  return null
}

// ── Handlers ──

export const lguplusHandlers = [
  // Step 1: GET /login — return login page HTML + initial cookies
  http.get(`${BASE_URL}/login`, () => {
    return new HttpResponse('<html><title>Login</title></html>', {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Set-Cookie': 'WMONID=init-cookie-123; Path=/',
      },
    })
  }),

  // Step 2: POST /login-process — form-based login
  http.post(`${BASE_URL}/login-process`, async ({ request }) => {
    const body = await request.text()
    const params = new URLSearchParams(body)
    const loginId = params.get('loginId')
    const password = params.get('password')
    const userType = params.get('userType')

    if (loginId === 'testuser' && password === 'testpass' && userType === 'Manage') {
      validSession = true
      // Real server returns 302 redirect to /folders/home
      return new HttpResponse(null, {
        status: 302,
        headers: {
          Location: '/folders/home',
          'Set-Cookie': sessionCookie,
        },
      })
    }

    // Failed login — redirect back to login page
    return new HttpResponse(null, {
      status: 302,
      headers: { Location: '/login?error=1' },
    })
  }),

  // Step 3: GET /folders/home — login verification page
  http.get(`${BASE_URL}/folders/home`, () => {
    if (validSession) {
      return new HttpResponse(
        '<html><body>내 폴더<a href="/logout">로그아웃</a>myFolderCnt</body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      )
    }
    // Not logged in — redirect to login
    return new HttpResponse(null, {
      status: 302,
      headers: { Location: '/login' },
    })
  }),

  // Logout
  http.post(`${BASE_URL}/logout`, () => {
    validSession = false
    return HttpResponse.json({ result: 'success' })
  }),

  // ── Main API: POST /wh ──
  http.post(`${BASE_URL}/wh`, async ({ request }) => {
    const authErr = requireSession()
    if (authErr) return authErr

    const body = (await request.json()) as Record<string, unknown>
    const msgType = body.MESSAGE_TYPE as string
    const procType = body.PROCESS_TYPE as string

    // FOLDER / TREE — folder tree listing
    if (msgType === 'FOLDER' && procType === 'TREE') {
      const upperId = body.UPPER_ID as number
      if (upperId === 0) {
        // Root level — return home folder
        return HttpResponse.json({
          RESULT_CODE: '0000',
          RESULT_MSG: 'OK',
          FOLDER_LIST: [
            { FOLDER_ID: 1000, FOLDER_NAME: 'HOME', UPPER_ID: 0, SUB_CNT: 2 },
          ],
        })
      }
      if (upperId === 1000) {
        return HttpResponse.json({
          RESULT_CODE: '0000',
          RESULT_MSG: 'OK',
          FOLDER_LIST: MOCK_FOLDERS,
        })
      }
      return HttpResponse.json({
        RESULT_CODE: '0000',
        RESULT_MSG: 'OK',
        FOLDER_LIST: [],
      })
    }

    // FOLDER / LIST — folder contents (files + folders)
    if (msgType === 'FOLDER' && procType === 'LIST') {
      const requestId = body.REQUEST_ID as number
      if (requestId === 1001) {
        return HttpResponse.json({
          RESULT_CODE: '0000',
          RESULT_MSG: 'OK',
          ITEM_TOTAL: 1,
          ITEM_VIEW: 100,
          FILE_LIST: MOCK_FILE_LIST,
        })
      }
      return HttpResponse.json({
        RESULT_CODE: '0000',
        RESULT_MSG: 'OK',
        ITEM_TOTAL: 0,
        ITEM_VIEW: 100,
        FILE_LIST: [],
      })
    }

    // USE_HISTORY / LIST — upload history
    if (msgType === 'USE_HISTORY' && procType === 'LIST') {
      return HttpResponse.json({
        RESULT_CODE: '0000',
        RESULT_MSG: 'OK',
        ITEM_TOTAL: 2,
        ITEM_VIEW: 20,
        HISTORY_LIST: MOCK_HISTORY,
      })
    }

    return HttpResponse.json({ RESULT_CODE: '9999', RESULT_MSG: 'Unknown request' })
  }),

  // ── Download URL info: GET /downloads/:fileId/server ──
  http.get(`${BASE_URL}/downloads/:fileId/server`, ({ params }) => {
    if (!validSession) {
      return new HttpResponse(null, { status: 302, headers: { Location: '/login' } })
    }

    const fileId = Number(params.fileId)
    if (fileId === 9999) {
      return HttpResponse.json({ error: 'not found' }, { status: 404 })
    }

    return HttpResponse.json({
      file: {
        fileManagementNumber: fileId,
        fileName: 'test.dxf',
        fileSize: 10240,
        fileOwnerId: 1,
        path: '/guest/올리기전용/',
      },
      session: 'dl-session-123',
      nonce: 'nonce-abc',
      certificationId: 'webhard3.0',
      certificationKey: 'Hw9mJtbPPX57yV661Qlx',
      userId: 'testuser',
      url: `${DOWNLOAD_SERVER}/file/download`,
      fileOwnerEncId: 'enc-owner-1',
    })
  }),

  // ── Actual file download ──
  http.get(`${DOWNLOAD_SERVER}/file/download`, ({ request }) => {
    const url = new URL(request.url)
    const fileId = url.searchParams.get('fileManagementNumber')

    if (fileId === '9999') {
      return new HttpResponse(null, { status: 404 })
    }

    const content = Buffer.alloc(10240, 0x41)
    return new HttpResponse(content, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': '10240',
      },
    })
  }),
]
```

**Step 2: Run existing tests to confirm they fail**

Run: `npx vitest run tests/core/lguplus-client.test.ts`
Expected: Most tests FAIL (they rely on old endpoint structure)

**Step 3: Commit mock handlers**

```bash
git add tests/mocks/lguplus-handlers.ts
git commit -m "test: rewrite MSW handlers to match real LGU+ webhard API

Replace fictional REST endpoints (/wh/guest-folder, /wh/sub-folders, etc.)
with real API structure: POST /wh with MESSAGE_TYPE/PROCESS_TYPE,
3-step login flow, GET /downloads/:id/server for download info."
```

---

## Task 2: Rewrite LGUplusClient — Private Infrastructure

**Files:**
- Rewrite: `src/core/lguplus-client.ts`

**Step 1: Replace the entire `src/core/lguplus-client.ts` with new implementation**

The new implementation keeps the same class signature (`constructor(baseUrl, logger, retry)`) and all public methods, but changes the internals:

```typescript
import type {
  ILGUplusClient,
  LoginResult,
  LGUplusFolderItem,
  LGUplusFileItem,
  UploadHistoryResponse,
  DownloadUrlInfo,
  DownloadResult,
  ProgressCallback,
} from './types/lguplus-client.types'
import type { ILogger } from './types/logger.types'
import type { IRetryManager } from './types/retry-manager.types'
import {
  AuthLoginFailedError,
  AuthSessionExpiredError,
  FileDownloadNotFoundError,
  FileDownloadTransferError,
  FileDownloadSizeMismatchError,
} from './errors'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

type SessionEventHandler = (...args: unknown[]) => void

/** Raw /wh API response shape */
interface WhApiResponse {
  RESULT_CODE: string
  RESULT_MSG: string
  [key: string]: unknown
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export class LGUplusClient implements ILGUplusClient {
  private baseUrl: string
  private logger: ILogger
  private retry: IRetryManager
  private authenticated = false
  private cookies = ''
  private storedUserId = ''
  private storedPassword = ''
  private eventHandlers = new Map<string, SessionEventHandler[]>()

  constructor(baseUrl: string, logger: ILogger, retry: IRetryManager) {
    this.baseUrl = baseUrl
    this.logger = logger.child({ module: 'lguplus-client' })
    this.retry = retry
  }

  // ══════════════════════════════════════════════════
  // Cookie Management
  // ══════════════════════════════════════════════════

  private updateCookies(response: Response): void {
    const setCookie = response.headers.get('set-cookie')
    if (!setCookie) return

    const existing = new Map<string, string>()
    if (this.cookies) {
      for (const pair of this.cookies.split('; ')) {
        const [key, ...rest] = pair.split('=')
        if (key) existing.set(key.trim(), rest.join('='))
      }
    }

    // set-cookie can have multiple cookies separated by comma (or multiple headers)
    // Parse each cookie: take "key=value" before any ";" attributes
    for (const raw of setCookie.split(/,(?=\s*\w+=)/)) {
      const cookiePart = raw.split(';')[0].trim()
      const [key, ...rest] = cookiePart.split('=')
      if (key) existing.set(key.trim(), rest.join('='))
    }

    this.cookies = [...existing.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  private getCommonHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
    }
    if (this.cookies) {
      headers['Cookie'] = this.cookies
    }
    return headers
  }

  private getApiHeaders(): Record<string, string> {
    return {
      ...this.getCommonHeaders(),
      'Content-Type': 'application/json',
      Origin: this.baseUrl,
      Referer: `${this.baseUrl}/folders/home`,
    }
  }

  // ══════════════════════════════════════════════════
  // Auth
  // ══════════════════════════════════════════════════

  async login(userId: string, password: string): Promise<LoginResult> {
    this.storedUserId = userId
    this.storedPassword = password

    try {
      // Step 1: GET /login — acquire initial cookies
      const loginPage = await fetch(`${this.baseUrl}/login`, {
        headers: this.getCommonHeaders(),
        redirect: 'manual',
      })
      this.updateCookies(loginPage)
      this.logger.debug('Login step 1: got initial cookies')

      // Step 2: POST /login-process — submit credentials
      const formBody = new URLSearchParams({
        id: '',
        pw: '',
        health: '',
        userType: 'Manage',
        fakeLoginId: userId,
        loginId: userId,
        password: password,
      })

      const loginRes = await fetch(`${this.baseUrl}/login-process`, {
        method: 'POST',
        body: formBody.toString(),
        headers: {
          ...this.getCommonHeaders(),
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: this.baseUrl,
          Referer: `${this.baseUrl}/login`,
        },
        redirect: 'manual',
      })
      this.updateCookies(loginRes)
      this.logger.debug('Login step 2: submitted credentials', {
        status: loginRes.status,
      })

      // Follow redirects manually (up to 5)
      let nextUrl = loginRes.headers.get('location')
      let redirectCount = 0
      while (nextUrl && redirectCount < 5) {
        const url = nextUrl.startsWith('http') ? nextUrl : `${this.baseUrl}${nextUrl}`
        const redirectRes = await fetch(url, {
          headers: this.getCommonHeaders(),
          redirect: 'manual',
        })
        this.updateCookies(redirectRes)
        nextUrl = redirectRes.headers.get('location')
        redirectCount++
      }

      // Step 3: GET /folders/home — verify login success
      const homeRes = await fetch(`${this.baseUrl}/folders/home`, {
        headers: this.getCommonHeaders(),
        redirect: 'manual',
      })
      this.updateCookies(homeRes)

      // Check for redirect to /login (means login failed)
      const homeLocation = homeRes.headers.get('location')
      if (homeLocation && homeLocation.includes('/login')) {
        this.logger.warn('Login failed: redirected to login page', { userId })
        return { success: false, message: 'Login redirect detected' }
      }

      const homeBody = await homeRes.text()
      const isLoggedIn =
        homeBody.includes('로그아웃') ||
        homeBody.includes('내 폴더') ||
        homeBody.includes('myFolderCnt')

      if (isLoggedIn) {
        this.authenticated = true
        this.logger.info('Login successful', { userId })
        return { success: true }
      }

      this.logger.warn('Login verification failed: keywords not found', { userId })
      return { success: false, message: 'Login verification failed' }
    } catch (err) {
      this.logger.error('Login exception', { error: (err as Error).message })
      throw new AuthLoginFailedError(`Login failed: ${(err as Error).message}`)
    }
  }

  async logout(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/logout`, {
        method: 'POST',
        headers: this.getCommonHeaders(),
      })
    } catch {
      // Ignore logout errors
    }
    this.authenticated = false
    this.cookies = ''
    this.logger.info('Logged out')
  }

  isAuthenticated(): boolean {
    return this.authenticated
  }

  async validateSession(): Promise<boolean> {
    if (!this.authenticated) return false

    try {
      // Test with a real API call (FOLDER/TREE on root)
      const result = await this.callWhApi({
        MESSAGE_TYPE: 'FOLDER',
        PROCESS_TYPE: 'TREE',
        REQUEST_SHARED: 'G',
        UPPER_ID: 0,
      })
      return result.RESULT_CODE === '0000'
    } catch {
      return false
    }
  }

  async refreshSession(): Promise<boolean> {
    if (!this.storedUserId || !this.storedPassword) return false

    this.authenticated = false
    this.cookies = ''

    const result = await this.login(this.storedUserId, this.storedPassword)
    if (result.success) {
      this.emitEvent('session-refreshed')
      return true
    }
    this.emitEvent('login-required')
    return false
  }

  // ══════════════════════════════════════════════════
  // Core API: POST /wh
  // ══════════════════════════════════════════════════

  private async callWhApi(
    body: Record<string, unknown>,
    retryCount = 0,
  ): Promise<WhApiResponse> {
    const res = await fetch(`${this.baseUrl}/wh`, {
      method: 'POST',
      headers: this.getApiHeaders(),
      body: JSON.stringify(body),
    })

    this.updateCookies(res)

    // Detect session expiry: redirect to /login
    if (res.status === 301 || res.status === 302) {
      const location = res.headers.get('location') ?? ''
      if (location.includes('/login')) {
        return this.handleSessionExpiry(body, retryCount)
      }
    }

    if (res.status === 401) {
      return this.handleSessionExpiry(body, retryCount)
    }

    const text = await res.text()

    // Empty response
    if (!text.trim()) {
      return { RESULT_CODE: '0000', RESULT_MSG: 'OK (empty response)' }
    }

    // HTML response = session expired
    if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
      return this.handleSessionExpiry(body, retryCount)
    }

    const data = JSON.parse(text) as WhApiResponse

    // RESULT_CODE 9999 or message contains '로그인' = session expired
    if (
      data.RESULT_CODE === '9999' ||
      (data.RESULT_MSG && data.RESULT_MSG.includes('로그인'))
    ) {
      return this.handleSessionExpiry(body, retryCount)
    }

    return data
  }

  private async handleSessionExpiry(
    originalBody: Record<string, unknown>,
    retryCount: number,
  ): Promise<WhApiResponse> {
    this.authenticated = false
    this.emitEvent('session-expired')

    if (retryCount >= 1) {
      throw new AuthSessionExpiredError('Session expired: re-login failed')
    }

    this.logger.warn('Session expired, attempting re-login')
    const refreshed = await this.refreshSession()
    if (!refreshed) {
      throw new AuthSessionExpiredError('Session expired: re-login failed')
    }

    return this.callWhApi(originalBody, retryCount + 1)
  }

  // ══════════════════════════════════════════════════
  // Folders
  // ══════════════════════════════════════════════════

  async getGuestFolderRootId(): Promise<number | null> {
    const data = await this.callWhApi({
      MESSAGE_TYPE: 'FOLDER',
      PROCESS_TYPE: 'TREE',
      REQUEST_SHARED: 'G',
      UPPER_ID: 0,
    })

    const folders = (data.FOLDER_LIST ?? []) as Array<{
      FOLDER_ID: number
      FOLDER_NAME: string
    }>

    // Find HOME folder, fall back to first
    const home = folders.find((f) => f.FOLDER_NAME === 'HOME') ?? folders[0]
    return home?.FOLDER_ID ?? null
  }

  async getSubFolders(folderId: number): Promise<LGUplusFolderItem[]> {
    const data = await this.callWhApi({
      MESSAGE_TYPE: 'FOLDER',
      PROCESS_TYPE: 'TREE',
      REQUEST_SHARED: 'G',
      UPPER_ID: folderId,
    })

    const raw = (data.FOLDER_LIST ?? []) as Array<{
      FOLDER_ID: number
      FOLDER_NAME: string
      UPPER_ID: number
      SUB_CNT?: number
    }>

    return raw.map((f) => ({
      folderId: f.FOLDER_ID,
      folderName: f.FOLDER_NAME,
      parentFolderId: f.UPPER_ID,
      subFolderCount: f.SUB_CNT,
    }))
  }

  async findFolderByName(parentId: number, name: string): Promise<number | null> {
    const folders = await this.getSubFolders(parentId)
    const found = folders.find((f) => f.folderName === name)
    return found?.folderId ?? null
  }

  // ══════════════════════════════════════════════════
  // Files
  // ══════════════════════════════════════════════════

  async getFileList(
    folderId: number,
    options?: { page?: number },
  ): Promise<{ items: LGUplusFileItem[]; total: number }> {
    const page = options?.page ?? 1

    const data = await this.callWhApi({
      MESSAGE_TYPE: 'FOLDER',
      PROCESS_TYPE: 'LIST',
      REQUEST_ID: folderId,
      REQUEST_SHARED: 'G',
      SORT: 1,
      PAGE: page,
      SEARCH_NAME1: '',
      SEARCH_NAME2: '',
      SEARCH_TAG_NAME: '',
      SEARCH_TYPE: '',
      SEARCH_FOLDER_TYPE: 'ALL',
      SEARCH_FOLDER_SIZE: '',
      SEARCH_START_DATE: '',
      SEARCH_END_DATE: '',
    })

    const rawFiles = (data.FILE_LIST ?? []) as Array<{
      ITEM_ID: number
      ITEM_NAME: string
      ITEM_SIZE: number
      ITEM_EXTENSION: string
      ITEM_PARENT_ID: number
      ITEM_UPDT_DT: string
      FOLDER_TY_CODE?: string
    }>
    const total = (data.ITEM_TOTAL as number) ?? 0

    const items: LGUplusFileItem[] = rawFiles.map((f) => ({
      itemId: f.ITEM_ID,
      itemName: f.ITEM_NAME,
      itemSize: f.ITEM_SIZE,
      itemExtension: f.ITEM_EXTENSION,
      parentFolderId: f.ITEM_PARENT_ID,
      updatedAt: f.ITEM_UPDT_DT,
      isFolder: f.FOLDER_TY_CODE === '1',
    }))

    return { items, total }
  }

  async getAllFiles(
    folderId: number,
    onProgress?: (page: number, fetched: number, total: number) => void,
  ): Promise<LGUplusFileItem[]> {
    const allFiles: LGUplusFileItem[] = []
    let page = 1
    let total = 0

    do {
      const result = await this.getFileList(folderId, { page })
      allFiles.push(...result.items)
      total = result.total
      onProgress?.(page, allFiles.length, total)
      page++
    } while (allFiles.length < total)

    return allFiles
  }

  // ══════════════════════════════════════════════════
  // Download
  // ══════════════════════════════════════════════════

  async getDownloadUrlInfo(fileId: number): Promise<DownloadUrlInfo | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/downloads/${fileId}/server?fileStatus=1`,
        {
          headers: {
            ...this.getCommonHeaders(),
            Accept: '*/*',
            'X-Requested-With': 'XMLHttpRequest',
            Origin: this.baseUrl,
            Referer: `${this.baseUrl}/folders/home`,
          },
        },
      )

      if (res.status === 404) return null
      if (res.status === 302 || res.status === 401) {
        this.emitEvent('session-expired')
        return null
      }

      const data = (await res.json()) as {
        file: {
          fileManagementNumber: number
          fileName: string
          fileSize: number
        }
        session: string
        nonce: string
        url: string
        fileOwnerEncId: string
        userId: string
        certificationId?: string
        certificationKey?: string
      }

      return {
        url: data.url || 'https://whfile1.webhard.co.kr/file/download',
        session: data.session,
        nonce: data.nonce,
        userId: data.userId,
        fileOwnerEncId: data.fileOwnerEncId || data.userId,
        fileName: data.file.fileName,
        fileSize: data.file.fileSize,
      }
    } catch {
      return null
    }
  }

  async downloadFile(
    fileId: number,
    destPath: string,
    onProgress?: ProgressCallback,
  ): Promise<DownloadResult> {
    const info = await this.getDownloadUrlInfo(fileId)
    if (!info) {
      return { success: false, size: 0, filename: '' }
    }

    // Build download URL with auth params
    const dlParams = new URLSearchParams({
      sessionId: info.session,
      nonce: info.nonce,
      certificationId: 'webhard3.0',
      certificationKey: 'Hw9mJtbPPX57yV661Qlx',
      userId: info.userId,
      fileOwnerId: info.fileOwnerEncId,
      fileManagementNumber: String(fileId),
      iosYn: 'N',
      callType: 'W',
      devInfo: 'PC',
      nwInfo: 'ETC',
      carrierType: 'E',
      svcCallerType: 'W',
      fileStatusCode: '1',
    })

    const downloadUrl = `${info.url}?${dlParams.toString()}`
    const res = await fetch(downloadUrl, {
      headers: {
        ...this.getCommonHeaders(),
        Referer: `${this.baseUrl}/`,
      },
    })

    if (res.status === 404) {
      throw new FileDownloadNotFoundError(`File ${fileId} not found on server`)
    }
    if (!res.ok) {
      throw new FileDownloadTransferError(`Download failed with status ${res.status}`)
    }

    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.byteLength !== info.fileSize) {
      throw new FileDownloadSizeMismatchError(
        `Size mismatch: expected ${info.fileSize}, got ${buffer.byteLength}`,
      )
    }

    await mkdir(dirname(destPath), { recursive: true })
    await writeFile(destPath, buffer)
    onProgress?.(buffer.byteLength, info.fileSize)

    return { success: true, size: buffer.byteLength, filename: info.fileName }
  }

  async batchDownload(
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
  }> {
    let success = 0
    let failed = 0
    let totalSize = 0
    const failedFiles: LGUplusFileItem[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        const result = await this.downloadFile(
          file.itemId,
          `${destDir}/${file.itemName}`,
        )
        if (result.success) {
          success++
          totalSize += result.size
        } else {
          failed++
          failedFiles.push(file)
        }
      } catch {
        failed++
        failedFiles.push(file)
      }
      options?.onProgress?.(i + 1, files.length, file.itemName)
    }

    return { success, failed, totalSize, failedFiles }
  }

  // ══════════════════════════════════════════════════
  // History
  // ══════════════════════════════════════════════════

  async getUploadHistory(options?: {
    startDate?: string
    endDate?: string
    operCode?: string
    page?: number
  }): Promise<UploadHistoryResponse> {
    const data = await this.callWhApi({
      MESSAGE_TYPE: 'USE_HISTORY',
      PROCESS_TYPE: 'LIST',
      REQUEST_START_DATE: options?.startDate ?? '0',
      REQUEST_END_DATE: options?.endDate ?? '0',
      REQUEST_OPER_CODE: options?.operCode ?? 'UP',
      PAGE: options?.page ?? 1,
    })

    const rawHistory = (data.HISTORY_LIST ?? []) as Array<{
      HISTORY_NO: number
      ITEM_SRC_NO: number
      ITEM_FOLDER_ID: number
      ITEM_SRC_NAME: string
      ITEM_SRC_EXTENSION: string
      ITEM_SRC_TYPE: string
      ITEM_FOLDER_FULLPATH: string
      ITEM_OPER_CODE: string
      ITEM_USE_DATE: string
    }>

    return {
      total: (data.ITEM_TOTAL as number) ?? 0,
      pageSize: (data.ITEM_VIEW as number) ?? 20,
      items: rawHistory.map((h) => ({
        historyNo: h.HISTORY_NO,
        itemSrcNo: h.ITEM_SRC_NO,
        itemFolderId: h.ITEM_FOLDER_ID,
        itemSrcName: h.ITEM_SRC_NAME,
        itemSrcExtension: h.ITEM_SRC_EXTENSION,
        itemSrcType: h.ITEM_SRC_TYPE,
        itemFolderFullpath: h.ITEM_FOLDER_FULLPATH,
        itemOperCode: h.ITEM_OPER_CODE,
        itemUseDate: h.ITEM_USE_DATE,
      })),
    }
  }

  // ══════════════════════════════════════════════════
  // Events
  // ══════════════════════════════════════════════════

  on(
    event: 'session-expired' | 'session-refreshed' | 'login-required',
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
```

**Step 2: Run tests to see current state**

Run: `npx vitest run tests/core/lguplus-client.test.ts`
Expected: Tests should now pass (or fail only on minor mock alignment issues we'll fix in Task 3)

**Step 3: Commit**

```bash
git add src/core/lguplus-client.ts
git commit -m "feat: rewrite LGUplusClient to use real LGU+ webhard API

- 3-step login: GET /login → POST /login-process → GET /folders/home
- Single POST /wh endpoint with MESSAGE_TYPE/PROCESS_TYPE
- Proper cookie management (extract/merge Set-Cookie)
- Browser-like headers (User-Agent, Origin, Referer)
- Download via GET /downloads/:id/server + parameterized download URL
- Auto session refresh on RESULT_CODE 9999 or redirect to /login
- Upload history via USE_HISTORY/LIST message type"
```

---

## Task 3: Fix Unit Tests and MSW Handler Alignment

**Files:**
- Update: `tests/core/lguplus-client.test.ts`

The test expectations (behavior) should NOT change. The tests may need minor adjustments for the new login flow (3-step login makes multiple requests).

**Step 1: Run tests and inspect failures**

Run: `npx vitest run tests/core/lguplus-client.test.ts 2>&1`
Inspect which tests pass and which fail. Note the exact error messages.

**Step 2: Fix any failing tests**

Likely issues:
- MSW `onUnhandledRequest: 'error'` may catch requests we haven't mocked (e.g., `GET /login`, `GET /folders/home`, `GET /downloads/*/server`, `GET whfile1.webhard.co.kr/*`)
- Login test may need the 3-step flow to complete correctly
- Download test URLs changed from `${BASE_URL}/download/:fileId` to `whfile1.webhard.co.kr/file/download?params`

For each failure: adjust the MSW handler or test expectation minimally.

**Step 3: Verify all tests pass**

Run: `npx vitest run tests/core/lguplus-client.test.ts`
Expected: ALL tests PASS

**Step 4: Run full test suite**

Run: `npx vitest run`
Expected: No regressions in other test files (sync-engine, file-detector) since they mock `ILGUplusClient` interface

**Step 5: Commit**

```bash
git add tests/core/lguplus-client.test.ts tests/mocks/lguplus-handlers.ts
git commit -m "test: align unit tests with real LGU+ API mock handlers"
```

---

## Task 4: Run Integration Test Against Real Server

**Files:**
- No code changes (integration test already tests real server)

**Step 1: Run Phase 1 only (LGU+ connection)**

Run: `npx tsx tests/integration/connection-test.ts --phase=1 --verbose`
Expected: Phase 1 should PASS (login, session validation, folder probing)

**Step 2: If Phase 1 passes, run all phases**

Run: `npx tsx tests/integration/connection-test.ts --verbose`

**Step 3: Diagnose any remaining failures**

If Phase 1 still fails, the issue may be:
- Cookie handling edge cases (real server sends multiple Set-Cookie headers)
- Redirect behavior differences
- Additional required form fields

In that case: compare with v1's `api-client.ts` more closely and adjust.

**Step 4: Commit any fixes**

```bash
git add src/core/lguplus-client.ts
git commit -m "fix: adjust LGUplusClient for real server response handling"
```

---

## Task 5: Update Integration Test Endpoint Probes

**Files:**
- Update: `tests/integration/connection-test.ts`

The integration test's Phase 1 probes (steps 1.2 and 1.5) test fictional endpoints. Update them to probe real endpoints.

**Step 1: Update Phase 1 endpoint probes**

Change step 1.2 from probing `/login-process` with empty credentials to:
- Probe `POST /wh` with a test request (unauthenticated — expect session error `RESULT_CODE: '9999'`)

Change step 1.5 from probing `/wh/guest-folder` to:
- Probe `GET /downloads/0/server?fileStatus=1` (unauthenticated — expect redirect or 401)

**Step 2: Run integration test**

Run: `npx tsx tests/integration/connection-test.ts --phase=1 --verbose`
Expected: Phase 1 PASS with meaningful probe results

**Step 3: Commit**

```bash
git add tests/integration/connection-test.ts
git commit -m "test: update integration test probes to use real LGU+ endpoints"
```

---

## Verification Checklist

After all tasks:

- [ ] `npx vitest run` — all unit tests pass
- [ ] `npx tsx tests/integration/connection-test.ts --phase=1 --verbose` — Phase 1 PASS
- [ ] `npx tsx tests/integration/connection-test.ts --phase=1,2 --verbose` — Phase 1+2 PASS
- [ ] `ILGUplusClient` interface unchanged (no breaking changes for consumers)
- [ ] `container.ts`, `sync-engine.ts`, `file-detector.ts` unchanged
- [ ] No TypeScript errors: `npx tsc --noEmit`
