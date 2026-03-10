import type {
  ILGUplusClient,
  LoginResult,
  LGUplusFolderItem,
  LGUplusFileItem,
  UploadHistoryResponse,
  DownloadUrlInfo,
  DownloadResult,
  ProgressCallback,
  CreateFolderResult,
} from './types/lguplus-client.types'
import type { ILogger } from './types/logger.types'
import type { IRetryManager } from './types/retry-manager.types'
import type { LGUplusSessionEventMap } from './types/events.types'
import {
  AuthLoginFailedError,
  AuthSessionExpiredError,
  NetworkConnectionError,
  NetworkTimeoutError,
  ApiResponseParseError,
  FileDownloadUrlFetchError,
  FileDownloadNotFoundError,
  FileDownloadTransferError,
  FileDownloadSizeMismatchError,
} from './errors'
import { mkdir, unlink } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { dirname } from 'node:path'
import type { FolderTreeCache } from './folder-tree-cache'

type SessionEventHandler = (data: LGUplusSessionEventMap[keyof LGUplusSessionEventMap]) => void

/** Raw /wh API response shape */
interface WhApiResponse {
  RESULT_CODE: string
  RESULT_MSG: string
  [key: string]: unknown
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const API_TIMEOUT_MS = 30_000
const NETWORK_MAX_RETRIES = 2
const NETWORK_BASE_DELAY_MS = 1_000

export class LGUplusClient implements ILGUplusClient {
  private baseUrl: string
  private logger: ILogger
  private retry: IRetryManager
  private folderCache?: FolderTreeCache
  private authenticated = false
  private cookies = ''
  private storedUserId = ''
  private storedPassword = ''
  private eventHandlers = new Map<string, SessionEventHandler[]>()

  constructor(baseUrl: string, logger: ILogger, retry: IRetryManager, folderCache?: FolderTreeCache) {
    this.baseUrl = baseUrl
    this.logger = logger.child({ module: 'lguplus-client' })
    this.retry = retry
    this.folderCache = folderCache
  }

  // ══════════════════════════════════════════════════
  // Cookie Management
  // ══════════════════════════════════════════════════

  private updateCookies(response: Response): void {
    // Prefer getSetCookie() (returns array) over get('set-cookie') (may merge with commas)
    let setCookieHeaders: string[]
    if (typeof response.headers.getSetCookie === 'function') {
      setCookieHeaders = response.headers.getSetCookie()
    } else {
      const raw = response.headers.get('set-cookie')
      if (!raw) return
      // Fallback: split on comma boundaries (heuristic for merged headers)
      setCookieHeaders = raw.split(/,(?=\s*\w+=)/)
    }

    if (setCookieHeaders.length === 0) return

    const existing = new Map<string, string>()
    if (this.cookies) {
      for (const pair of this.cookies.split('; ')) {
        const [key, ...rest] = pair.split('=')
        if (key) existing.set(key.trim(), rest.join('='))
      }
    }

    for (const header of setCookieHeaders) {
      const cookiePart = header.split(';')[0].trim()
      const [key, ...rest] = cookiePart.split('=')
      if (key) existing.set(key.trim(), rest.join('='))
    }

    this.cookies = [...existing.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
    this.logger.debug('Cookies updated', {
      cookieKeys: [...existing.keys()],
      count: existing.size,
    })
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
      // Step 1: GET /login — acquire initial cookies + parse login page form
      const loginPage = await fetch(`${this.baseUrl}/login`, {
        headers: {
          ...this.getCommonHeaders(),
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        redirect: 'follow',
      })
      this.updateCookies(loginPage)

      const loginPageBody = await loginPage.text()
      this.logger.debug('Login step 1: GET /login', {
        status: loginPage.status,
        url: loginPage.url,
        bodyLength: loginPageBody.length,
        cookieSnapshot: this.cookies.slice(0, 200),
      })

      // Parse ALL form fields from the login page (hidden + visible inputs)
      const formFields: Record<string, string> = {}
      const inputRegex = /<input[^>]*>/gi
      let match: RegExpExecArray | null
      while ((match = inputRegex.exec(loginPageBody)) !== null) {
        const tag = match[0]
        const nameMatch = /name=["']([^"']+)["']/.exec(tag)
        if (!nameMatch) continue
        const name = nameMatch[1]
        const valueMatch = /value=["']([^"']*)["']/.exec(tag)
        const value = valueMatch?.[1] ?? ''
        formFields[name] = value
      }

      // Also check meta tags for CSRF tokens (Spring Security pattern)
      const csrfMetaMatch = /<meta\s+name=["']_csrf["'][^>]*content=["']([^"']*)["']/i.exec(loginPageBody)
      const csrfHeaderMatch = /<meta\s+name=["']_csrf_header["'][^>]*content=["']([^"']*)["']/i.exec(loginPageBody)
      if (csrfMetaMatch) {
        formFields['_csrf'] = csrfMetaMatch[1]
      }

      // Extract form action URL
      const formActionMatch = /<form[^>]*action=["']([^"']*)["'][^>]*>/i.exec(loginPageBody)
      const formAction = formActionMatch?.[1] ?? '/login-process'

      this.logger.debug('Login page form analysis', {
        allInputNames: Object.keys(formFields),
        formAction,
        hasCsrfMeta: !!csrfMetaMatch,
        csrfHeader: csrfHeaderMatch?.[1],
        csrfToken: csrfMetaMatch ? csrfMetaMatch[1].slice(0, 20) + '...' : 'none',
      })

      // Step 2: POST login — submit credentials using parsed form structure
      // Override credential fields with user values
      // Note: 'id' and 'pw' are honeypot fields — must stay empty
      // Note: 'lgin1' is a submit button — exclude from POST data
      delete formFields['lgin1']

      // userType is a radio button (Manage=Admin, General=Guest)
      // The regex loop picks up the LAST radio value, which may not be 'Manage'.
      // Force 'Manage' to match the working login flow.
      formFields['userType'] = 'Manage'

      // Set credential fields
      formFields['loginId'] = userId
      formFields['fakeLoginId'] = userId
      formFields['password'] = password

      this.logger.debug('Login step 2: form data to submit', {
        fields: Object.keys(formFields),
        formAction,
        userId,
      })

      const postUrl = formAction.startsWith('http')
        ? formAction
        : `${this.baseUrl}${formAction.startsWith('/') ? '' : '/'}${formAction}`

      const loginRes = await fetch(postUrl, {
        method: 'POST',
        body: new URLSearchParams(formFields).toString(),
        headers: {
          ...this.getCommonHeaders(),
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: this.baseUrl,
          Referer: `${this.baseUrl}/login`,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          ...(csrfHeaderMatch && csrfMetaMatch
            ? { [csrfHeaderMatch[1]]: csrfMetaMatch[1] }
            : {}),
        },
        redirect: 'manual',
      })
      this.updateCookies(loginRes)
      this.logger.debug('Login step 2: POST response', {
        status: loginRes.status,
        location: loginRes.headers.get('location'),
        cookieSnapshot: this.cookies.slice(0, 200),
      })

      // Follow redirects manually (up to 5)
      let nextUrl = loginRes.headers.get('location')
      let redirectCount = 0
      while (nextUrl && redirectCount < 5) {
        this.logger.debug(`Login redirect ${redirectCount + 1}`, { url: nextUrl })

        // Check if redirect goes to /login (failed login)
        if (nextUrl.includes('/login') && !nextUrl.includes('/login-process') && !nextUrl.includes('/folders')) {
          this.logger.warn('Login failed: redirected to login page', {
            userId,
            redirectUrl: nextUrl,
            redirectCount,
          })
          return { success: false, message: `Invalid credentials (redirect to ${nextUrl})` }
        }
        const url = nextUrl.startsWith('http') ? nextUrl : `${this.baseUrl}${nextUrl}`
        const redirectRes = await fetch(url, {
          headers: this.getCommonHeaders(),
          redirect: 'manual',
        })
        this.updateCookies(redirectRes)
        this.logger.debug(`Login redirect ${redirectCount + 1} response`, {
          status: redirectRes.status,
          location: redirectRes.headers.get('location'),
        })
        nextUrl = redirectRes.headers.get('location')
        redirectCount++
      }

      // Step 3: GET /folders/home — verify login success
      const homeRes = await fetch(`${this.baseUrl}/folders/home`, {
        headers: {
          ...this.getCommonHeaders(),
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'manual',
      })
      this.updateCookies(homeRes)

      this.logger.debug('Login step 3: GET /folders/home', {
        status: homeRes.status,
        location: homeRes.headers.get('location'),
      })

      // Redirect to /login means failed
      const homeLocation = homeRes.headers.get('location')
      if (homeLocation && homeLocation.includes('/login')) {
        this.logger.warn('Login failed: home redirected to login', {
          userId,
          location: homeLocation,
          cookieSnapshot: this.cookies.slice(0, 120),
        })
        return { success: false, message: `Login verification failed (home→${homeLocation})` }
      }

      const homeBody = await homeRes.text()
      const isLoggedIn =
        homeBody.includes('로그아웃') ||
        homeBody.includes('내 폴더') ||
        homeBody.includes('myFolderCnt')

      this.logger.debug('Login step 3: home page verification', {
        bodyLength: homeBody.length,
        hasLogout: homeBody.includes('로그아웃'),
        hasMyFolder: homeBody.includes('내 폴더'),
        hasMyFolderCnt: homeBody.includes('myFolderCnt'),
        bodyPreview: homeBody.slice(0, 300),
      })

      if (isLoggedIn) {
        this.authenticated = true
        this.logger.info('Login successful', { userId })
        return { success: true }
      }

      this.logger.warn('Login verification failed: keywords not found', {
        userId,
        bodyLength: homeBody.length,
        bodyPreview: homeBody.slice(0, 500),
      })
      return { success: false, message: 'Login verification failed: expected keywords not found in home page' }
    } catch (err) {
      this.logger.error('Login exception', { error: (err as Error).message, stack: (err as Error).stack })
      throw new AuthLoginFailedError(`Login failed: ${(err as Error).message}`, { userId })
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

  private async callWhApi(body: Record<string, unknown>): Promise<WhApiResponse> {
    const MAX_SESSION_RETRIES = 1

    for (let sessionAttempt = 0; sessionAttempt <= MAX_SESSION_RETRIES; sessionAttempt++) {
      // 네트워크 재시도 루프
      let lastNetworkError: Error | undefined
      let res: Response | undefined

      for (let networkAttempt = 0; networkAttempt <= NETWORK_MAX_RETRIES; networkAttempt++) {
        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
          try {
            res = await fetch(`${this.baseUrl}/wh`, {
              method: 'POST',
              headers: this.getApiHeaders(),
              body: JSON.stringify(body),
              signal: controller.signal,
            })
          } finally {
            clearTimeout(timeoutId)
          }
          lastNetworkError = undefined
          break
        } catch (error) {
          const msg = (error as Error).message ?? 'fetch failed'
          const isTimeout =
            (error as Error).name === 'AbortError' ||
            msg.includes('timeout') ||
            msg.includes('ETIMEDOUT')

          lastNetworkError = isTimeout
            ? new NetworkTimeoutError(`LGU+ API timeout: ${msg}`, { url: this.baseUrl })
            : new NetworkConnectionError(`LGU+ API connection failed: ${msg}`, { url: this.baseUrl })

          if (networkAttempt < NETWORK_MAX_RETRIES) {
            const delay = NETWORK_BASE_DELAY_MS * Math.pow(2, networkAttempt)
            this.logger.warn(`Network error, retrying (${networkAttempt + 1}/${NETWORK_MAX_RETRIES})`, {
              error: msg,
              delayMs: delay,
            })
            await new Promise((r) => setTimeout(r, delay))
          }
        }
      }

      if (lastNetworkError || !res) {
        throw lastNetworkError ?? new NetworkConnectionError('LGU+ API connection failed', { url: this.baseUrl })
      }

      this.updateCookies(res)

      // 세션 만료 감지: redirect to /login 또는 401
      const needsSessionRefresh = this.detectSessionExpiry(res)
      if (needsSessionRefresh === 'redirect') {
        if (sessionAttempt < MAX_SESSION_RETRIES && await this.handleSessionExpiry('HTTP redirect to /login')) {
          continue
        }
        throw new AuthSessionExpiredError('Session expired: re-login failed', { url: this.baseUrl })
      }

      if (needsSessionRefresh === '401') {
        if (sessionAttempt < MAX_SESSION_RETRIES && await this.handleSessionExpiry('HTTP 401')) {
          continue
        }
        throw new AuthSessionExpiredError('Session expired: re-login failed', { url: this.baseUrl })
      }

      const text = await this.decodeResponse(res)

      // 빈 응답
      if (!text.trim()) {
        return { RESULT_CODE: '0000', RESULT_MSG: 'OK (empty response)' }
      }

      // HTML 응답 = 세션 만료
      if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
        if (sessionAttempt < MAX_SESSION_RETRIES && await this.handleSessionExpiry('HTML response instead of JSON')) {
          continue
        }
        throw new AuthSessionExpiredError('Session expired: re-login failed', { url: this.baseUrl })
      }

      let data: WhApiResponse
      try {
        data = JSON.parse(text) as WhApiResponse
      } catch {
        throw new ApiResponseParseError(
          `Failed to parse LGU+ API response: ${text.slice(0, 200)}`,
          { responsePreview: text.slice(0, 200) },
        )
      }

      // RESULT_CODE 9999 또는 '로그인' 메시지 = 세션 만료
      if (
        data.RESULT_CODE === '9999' ||
        (data.RESULT_MSG && data.RESULT_MSG.includes('로그인'))
      ) {
        if (sessionAttempt < MAX_SESSION_RETRIES && await this.handleSessionExpiry(`RESULT_CODE=${data.RESULT_CODE}`)) {
          continue
        }
        throw new AuthSessionExpiredError('Session expired: re-login failed', {
          resultCode: data.RESULT_CODE,
          resultMsg: data.RESULT_MSG,
        })
      }

      return data
    }

    throw new AuthSessionExpiredError('Session expired: max retries exceeded', { url: this.baseUrl })
  }

  /**
   * Response body를 텍스트로 디코딩.
   * LGU+ 웹하드 API는 EUC-KR 인코딩으로 응답할 수 있으므로,
   * Content-Type charset을 확인하거나 charset이 없으면 EUC-KR을 시도한다.
   */
  private async decodeResponse(res: Response): Promise<string> {
    const contentType = res.headers.get('content-type') ?? ''
    const charsetMatch = contentType.match(/charset=([^\s;]+)/i)
    const charset = charsetMatch?.[1]?.toLowerCase()

    // charset이 명시적으로 UTF-8이면 그대로 사용
    if (charset === 'utf-8' || charset === 'utf8') {
      return res.text()
    }

    // EUC-KR 명시 또는 charset 미지정 시 → arrayBuffer로 읽어서 디코딩
    const buffer = await res.arrayBuffer()

    if (charset && charset !== 'utf-8' && charset !== 'utf8') {
      // 명시된 charset으로 디코딩 (euc-kr, euc_kr, cp949 등)
      try {
        return new TextDecoder(charset).decode(buffer)
      } catch {
        // 지원되지 않는 charset이면 UTF-8 fallback
        return new TextDecoder('utf-8').decode(buffer)
      }
    }

    // charset 미지정: UTF-8로 먼저 시도, replacement character(�)가 있으면 EUC-KR 재시도
    const utf8Text = new TextDecoder('utf-8').decode(buffer)
    if (!utf8Text.includes('\uFFFD')) {
      return utf8Text
    }

    // UTF-8 디코딩에 replacement character가 있으면 EUC-KR로 재시도
    try {
      return new TextDecoder('euc-kr').decode(buffer)
    } catch {
      return utf8Text
    }
  }

  /** Response에서 세션 만료 여부를 판별 */
  private detectSessionExpiry(res: Response): 'redirect' | '401' | null {
    if (res.status === 301 || res.status === 302) {
      const location = res.headers.get('location') ?? ''
      if (location.includes('/login')) return 'redirect'
    }
    if (res.status === 401) return '401'
    return null
  }

  /** 세션 만료 시 재로그인 시도. 성공하면 true, 실패하면 false */
  private async handleSessionExpiry(reason: string): Promise<boolean> {
    this.authenticated = false
    this.emitEvent('session-expired', { reason })

    this.logger.warn('Session expired, attempting re-login', { reason })
    return this.refreshSession()
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

    const folders = (data.ITEM_FOLDER ?? data.FOLDER_LIST ?? []) as Array<{
      FOLDER_ID: number
      FOLDER_NAME: string
    }>

    // Find HOME folder, fall back to first
    const home = folders.find((f) => f.FOLDER_NAME === 'HOME') ?? folders[0]
    return home?.FOLDER_ID ?? null
  }

  async getSubFolders(folderId: number): Promise<LGUplusFolderItem[]> {
    // 캐시 히트 확인
    if (this.folderCache) {
      const cached = this.folderCache.getSubFolders(folderId)
      if (cached) return cached
    }

    const data = await this.callWhApi({
      MESSAGE_TYPE: 'FOLDER',
      PROCESS_TYPE: 'TREE',
      REQUEST_SHARED: 'G',
      UPPER_ID: folderId,
    })

    const raw = (data.ITEM_FOLDER ?? data.FOLDER_LIST ?? []) as Array<{
      FOLDER_ID: number
      FOLDER_NAME: string
      UPPER_ID?: number
      UPPER_FOLDER_ID?: number
      SUB_CNT?: number
    }>

    const folders = raw.map((f) => ({
      folderId: f.FOLDER_ID,
      folderName: f.FOLDER_NAME,
      parentFolderId: f.UPPER_FOLDER_ID ?? f.UPPER_ID ?? 0,
      subFolderCount: f.SUB_CNT,
    }))

    // 캐시 저장
    if (this.folderCache) {
      this.folderCache.setSubFolders(folderId, folders)
    }

    return folders
  }

  async findFolderByName(parentId: number, name: string): Promise<number | null> {
    const folders = await this.getSubFolders(parentId)
    const found = folders.find((f) => f.folderName === name)
    return found?.folderId ?? null
  }

  async createFolder(parentId: number, name: string): Promise<CreateFolderResult> {
    const data = await this.callWhApi({
      MESSAGE_TYPE: 'FOLDER',
      PROCESS_TYPE: 'MAKE',
      REQUEST_SHARED: 'G',
      UPPER_ID: parentId,
      NAME: name,
    })

    return {
      success: data.RESULT_CODE === '0000',
      resultCode: data.RESULT_CODE,
      resultMsg: data.RESULT_MSG,
    }
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

    const rawFiles = (data.ITEMS ?? data.FILE_LIST ?? []) as Array<{
      ITEM_ID: number
      ITEM_NAME: string
      ITEM_SIZE: number
      ITEM_EXTENSION: string
      ITEM_PARENT_ID: number
      ITEM_UPDT_DT: string
      FOLDER_TY_CODE?: string
      ITEM_TYPE?: string
    }>
    const total = ((data.TOTAL ?? data.ITEM_TOTAL) as number) ?? 0

    const items: LGUplusFileItem[] = rawFiles.map((f) => ({
      itemId: f.ITEM_ID,
      itemName: f.ITEM_NAME,
      itemSize: f.ITEM_SIZE ?? 0,
      itemExtension: f.ITEM_EXTENSION,
      parentFolderId: f.ITEM_PARENT_ID,
      updatedAt: f.ITEM_UPDT_DT,
      isFolder: f.FOLDER_TY_CODE === '1' || f.ITEM_TYPE === 'A',
    }))

    // Filter out "상위 폴더 이동" navigation items
    const filtered = items.filter((f) => f.itemName !== 'ㄴ상위 폴더 이동')

    return { items: filtered, total }
  }

  async getAllFiles(
    folderId: number,
    onProgress?: (page: number, fetched: number, total: number) => void,
  ): Promise<LGUplusFileItem[]> {
    // 첫 페이지로 total 파악
    const firstPage = await this.getFileList(folderId, { page: 1 })
    const allFiles = [...firstPage.items]
    const total = firstPage.total
    const pageSize = firstPage.items.length || 20

    onProgress?.(1, allFiles.length, total)

    if (allFiles.length >= total) return allFiles

    // 남은 페이지 수 계산 → 병렬 fetch
    const totalPages = Math.ceil(total / pageSize)
    const remainingPages = Array.from(
      { length: totalPages - 1 },
      (_, i) => i + 2,
    )

    // 병렬 batch (한 번에 5페이지씩)
    const BATCH_SIZE = 3
    for (let i = 0; i < remainingPages.length; i += BATCH_SIZE) {
      const batch = remainingPages.slice(i, i + BATCH_SIZE)
      try {
        const results = await Promise.all(
          batch.map((page) => this.getFileList(folderId, { page })),
        )
        for (const result of results) {
          allFiles.push(...result.items)
        }
        onProgress?.(batch[batch.length - 1], allFiles.length, total)
      } catch (error) {
        this.logger.warn(`Failed to fetch page batch for folder ${folderId}, continuing with remaining pages`, {
          batch,
          error: (error as Error).message,
        })
        // 실패한 배치의 개별 페이지를 하나씩 재시도
        for (const page of batch) {
          try {
            const result = await this.getFileList(folderId, { page })
            allFiles.push(...result.items)
          } catch {
            this.logger.warn(`Failed to fetch page ${page} for folder ${folderId}, skipping`)
          }
        }
      }
    }

    return allFiles
  }

  async getAllFilesDeep(
    folderId: number,
    options?: { maxDepth?: number; concurrency?: number },
  ): Promise<LGUplusFileItem[]> {
    const maxDepth = options?.maxDepth ?? 10
    const concurrency = options?.concurrency ?? 3
    const allFiles: LGUplusFileItem[] = []
    const visitedFolderIds = new Set<number>()
    const failedEntries: Array<{ folderId: number; depth: number; relativePath: string }> = []
    let isRetryPhase = false

    // Worker pool: 폴더가 발견되면 즉시 큐에 추가
    const queue: Array<{ folderId: number; depth: number; relativePath: string }> = [
      { folderId, depth: 0, relativePath: '' },
    ]

    let activeWorkers = 0
    let resolveAll: (() => void) | undefined
    const allDone = new Promise<void>((r) => {
      resolveAll = r
    })

    // 이벤트 기반 큐 알림: busy-wait 대신 대기 워커를 깨움
    const waiters: (() => void)[] = []
    const notifyWaiters = (): void => {
      while (waiters.length > 0 && queue.length > 0) {
        waiters.shift()?.()
      }
    }
    const wakeAllWaiters = (): void => {
      for (const wake of waiters.splice(0)) {
        wake()
      }
    }

    const enqueue = (entry: { folderId: number; depth: number; relativePath: string }): void => {
      queue.push(entry)
      notifyWaiters()
    }

    const checkDone = (): void => {
      if (queue.length === 0 && activeWorkers === 0) {
        wakeAllWaiters()
        resolveAll?.()
      }
    }

    const processNext = async (): Promise<void> => {
      while (true) {
        const entry = queue.shift()
        if (!entry) {
          // 큐가 비었지만 다른 워커가 아직 동작 중이면 이벤트 대기
          if (activeWorkers > 0) {
            await new Promise<void>((resolve) => waiters.push(resolve))
            // 깨어난 후 다시 큐 확인
            if (queue.length === 0 && activeWorkers === 0) break
            continue
          }
          break
        }

        if (visitedFolderIds.has(entry.folderId)) {
          checkDone()
          continue
        }
        visitedFolderIds.add(entry.folderId)

        activeWorkers++

        try {
          // 파일 목록 + 서브폴더를 동시에 가져옴
          const [files, subFolders] = await Promise.all([
            this.getAllFiles(entry.folderId),
            entry.depth < maxDepth
              ? this.getSubFolders(entry.folderId)
              : Promise.resolve([]),
          ])

          // 파일 수집
          for (const file of files) {
            if (!file.isFolder) {
              allFiles.push({
                ...file,
                relativePath: entry.relativePath || undefined,
              })
            }
          }

          // 서브폴더를 즉시 큐에 추가 (이벤트 기반 알림)
          for (const sub of subFolders) {
            if (!visitedFolderIds.has(sub.folderId)) {
              const subPath = entry.relativePath
                ? `${entry.relativePath}/${sub.folderName}`
                : sub.folderName
              enqueue({
                folderId: sub.folderId,
                depth: entry.depth + 1,
                relativePath: subPath,
              })
            }
          }
        } catch (error) {
          if (!isRetryPhase) {
            this.logger.warn(`Failed to scan folder ${entry.folderId}, will retry later`, {
              folderId: entry.folderId,
              relativePath: entry.relativePath,
              error: (error as Error).message,
            })
            failedEntries.push(entry)
          } else {
            this.logger.warn(`Retry failed for folder ${entry.folderId}, permanently skipping`, {
              folderId: entry.folderId,
              relativePath: entry.relativePath,
              error: (error as Error).message,
            })
          }
        } finally {
          activeWorkers--
          checkDone()
        }
      }
    }

    // concurrency 개수만큼 워커 시작
    Array.from({ length: concurrency }, () => processNext())
    await allDone

    // 실패한 폴더 재시도
    if (failedEntries.length > 0) {
      this.logger.info(`Retrying ${failedEntries.length} failed folder(s)`, { folderId })
      isRetryPhase = true

      for (const entry of failedEntries) {
        visitedFolderIds.delete(entry.folderId)
        enqueue(entry)
      }
      failedEntries.length = 0

      const retryDone = new Promise<void>((r) => {
        resolveAll = r
      })
      Array.from({ length: concurrency }, () => processNext())
      await retryDone
    }

    this.logger.info(`Deep scan complete: ${allFiles.length} files found`, {
      folderId,
      visitedFolders: visitedFolderIds.size,
    })

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
        this.emitEvent('session-expired', { reason: `Download URL fetch returned ${res.status}` })
        return null
      }

      const text = await this.decodeResponse(res)
      const data = JSON.parse(text) as {
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
      throw new FileDownloadUrlFetchError(
        `Failed to get download URL for file ${fileId}`,
        { fileId },
      )
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
      throw new FileDownloadNotFoundError(`File ${fileId} not found on server`, { fileId })
    }
    if (!res.ok) {
      throw new FileDownloadTransferError(`Download failed with status ${res.status}`, { fileId, status: res.status })
    }

    const totalSize = info.fileSize
    await mkdir(dirname(destPath), { recursive: true })

    const body = res.body
    if (!body) {
      // ReadableStream 미지원 시 fallback — 이미 메모리에 있으므로 writeFile 사용
      const arrayBuf = await res.arrayBuffer()
      const size = arrayBuf.byteLength
      if (size !== totalSize) {
        throw new FileDownloadSizeMismatchError(
          `Size mismatch: expected ${totalSize}, got ${size}`,
          { fileId, expected: totalSize, actual: size },
        )
      }
      const ws = createWriteStream(destPath)
      ws.end(Buffer.from(arrayBuf))
      await new Promise<void>((resolve, reject) => {
        ws.on('finish', resolve)
        ws.on('error', reject)
      })
      onProgress?.(size, totalSize)
      return { success: true, size, filename: info.fileName }
    }

    // 스트리밍 다운로드 — 청크를 즉시 디스크에 기록하여 메모리 사용 최소화
    let downloadedBytes = 0
    const reader = body.getReader()
    const ws = createWriteStream(destPath)

    // 진행 이벤트 스로틀: 200ms 간격
    let lastProgressAt = 0
    const PROGRESS_INTERVAL_MS = 200

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        downloadedBytes += value.byteLength

        // 백프레셔 처리: write가 false를 반환하면 drain 대기
        const canContinue = ws.write(value)
        if (!canContinue) {
          await new Promise<void>((resolve) => ws.once('drain', resolve))
        }

        const now = Date.now()
        if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
          onProgress?.(downloadedBytes, totalSize)
          lastProgressAt = now
        }
      }

      // 스트림 종료 대기
      await new Promise<void>((resolve, reject) => {
        ws.on('finish', resolve)
        ws.on('error', reject)
        ws.end()
      })

      if (downloadedBytes !== totalSize) {
        // 사이즈 불일치 시 불완전 파일 삭제
        await unlink(destPath).catch(() => {})
        throw new FileDownloadSizeMismatchError(
          `Size mismatch: expected ${totalSize}, got ${downloadedBytes}`,
          { fileId, expected: totalSize, actual: downloadedBytes },
        )
      }

      // 최종 100% 진행 이벤트
      onProgress?.(downloadedBytes, totalSize)
      return { success: true, size: downloadedBytes, filename: info.fileName }
    } catch (error) {
      // 에러 시 writeStream 정리 및 불완전 파일 삭제
      ws.destroy()
      await unlink(destPath).catch(() => {})
      throw error
    }
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
    const concurrency = options?.concurrency ?? 3
    let success = 0
    let failed = 0
    let totalSize = 0
    let done = 0
    const failedFiles: LGUplusFileItem[] = []

    // Worker pool: 공유 인덱스에서 다음 파일을 꺼내 처리
    let nextIndex = 0
    const processWorker = async (): Promise<void> => {
      while (true) {
        const idx = nextIndex++
        if (idx >= files.length) break
        const file = files[idx]
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
        done++
        options?.onProgress?.(done, files.length, file.itemName)
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => processWorker())
    await Promise.all(workers)

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

    const rawHistory = (data.ITEM_HISTORY ?? data.HISTORY_LIST ?? []) as Array<{
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
      total: ((data.ITEM_TOTAL ?? data.TOTAL) as number) ?? 0,
      pageSize: ((data.ITEM_VIEW ?? data.VIEW) as number) ?? 20,
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

  on<K extends keyof LGUplusSessionEventMap>(
    event: K,
    handler: (data: LGUplusSessionEventMap[K]) => void,
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, [])
    }
    this.eventHandlers.get(event)!.push(handler as SessionEventHandler)
  }

  private emitEvent<K extends keyof LGUplusSessionEventMap>(
    event: K,
    ...args: LGUplusSessionEventMap[K] extends void ? [] : [LGUplusSessionEventMap[K]]
  ): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      for (const handler of handlers) {
        handler(args[0] as LGUplusSessionEventMap[keyof LGUplusSessionEventMap])
      }
    }
  }
}
