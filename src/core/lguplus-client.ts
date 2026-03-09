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
import type { FolderTreeCache } from './folder-tree-cache'

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
    const setCookie = response.headers.get('set-cookie')
    if (!setCookie) return

    const existing = new Map<string, string>()
    if (this.cookies) {
      for (const pair of this.cookies.split('; ')) {
        const [key, ...rest] = pair.split('=')
        if (key) existing.set(key.trim(), rest.join('='))
      }
    }

    // Parse Set-Cookie header: take "key=value" before any ";" attributes
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
        // Check if redirect goes to /login (failed login)
        if (nextUrl.includes('/login') && !nextUrl.includes('/folders')) {
          this.logger.warn('Login failed: redirected to login page', { userId })
          return { success: false, message: 'Invalid credentials' }
        }
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

      // Redirect to /login means failed
      const homeLocation = homeRes.headers.get('location')
      if (homeLocation && homeLocation.includes('/login')) {
        this.logger.warn('Login failed: home redirected to login', { userId })
        return { success: false, message: 'Login verification failed' }
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
      itemSize: f.ITEM_SIZE,
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
    const BATCH_SIZE = 5
    for (let i = 0; i < remainingPages.length; i += BATCH_SIZE) {
      const batch = remainingPages.slice(i, i + BATCH_SIZE)
      const results = await Promise.all(
        batch.map((page) => this.getFileList(folderId, { page })),
      )
      for (const result of results) {
        allFiles.push(...result.items)
      }
      onProgress?.(batch[batch.length - 1], allFiles.length, total)
    }

    return allFiles
  }

  async getAllFilesDeep(
    folderId: number,
    options?: { maxDepth?: number; concurrency?: number },
  ): Promise<LGUplusFileItem[]> {
    const maxDepth = options?.maxDepth ?? 10
    const concurrency = options?.concurrency ?? 5
    const allFiles: LGUplusFileItem[] = []
    const visitedFolderIds = new Set<number>()

    // Worker pool: 폴더가 발견되면 즉시 큐에 추가
    const queue: Array<{ folderId: number; depth: number; relativePath: string }> = [
      { folderId, depth: 0, relativePath: '' },
    ]

    let activeWorkers = 0
    let resolveAll: (() => void) | undefined
    const allDone = new Promise<void>((r) => {
      resolveAll = r
    })

    const checkDone = (): void => {
      if (queue.length === 0 && activeWorkers === 0) {
        resolveAll?.()
      }
    }

    const processNext = async (): Promise<void> => {
      while (true) {
        const entry = queue.shift()
        if (!entry) {
          // 큐가 비었지만 다른 워커가 아직 동작 중이면 잠시 대기
          if (activeWorkers > 0) {
            await new Promise((r) => setTimeout(r, 5))
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

        // 서브폴더를 즉시 큐에 추가
        for (const sub of subFolders) {
          if (!visitedFolderIds.has(sub.folderId)) {
            const subPath = entry.relativePath
              ? `${entry.relativePath}/${sub.folderName}`
              : sub.folderName
            queue.push({
              folderId: sub.folderId,
              depth: entry.depth + 1,
              relativePath: subPath,
            })
          }
        }

        activeWorkers--
        checkDone()
      }
    }

    // concurrency 개수만큼 워커 시작
    const workers = Array.from({ length: concurrency }, () => processNext())
    await allDone

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
