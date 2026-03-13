import type { ILGUplusClient, LGUplusFolderItem } from './types/lguplus-client.types'
import type { IWebhardUploader } from './types/webhard-uploader.types'
import type { IStateManager } from './types/state-manager.types'
import type { ILogger } from './types/logger.types'
import { cleanFolderPath, filterPathSegments } from './path-utils'

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

export class FolderDiscovery {
  private lguplus: ILGUplusClient
  private uploader: IWebhardUploader
  private state: IStateManager
  private logger: ILogger

  constructor(
    lguplus: ILGUplusClient,
    uploader: IWebhardUploader,
    state: IStateManager,
    logger: ILogger,
  ) {
    this.lguplus = lguplus
    this.uploader = uploader
    this.state = state
    this.logger = logger.child({ module: 'folder-discovery' })
  }

  async discoverFolders(): Promise<DiscoveryResult> {
    const result: DiscoveryResult = {
      total: 0,
      newFolders: 0,
      existingFolders: 0,
      folders: [],
    }

    // Step 1: Get guest folder root ID (HOME)
    const rootId = await this.lguplus.getGuestFolderRootId()
    if (rootId === null) {
      this.logger.warn('Guest folder root not found, skipping discovery')
      return result
    }

    // Step 2: API 히스토리에서 상위 경로 접두사 탐색 (예: '올리기전용')
    //   FolderDiscovery는 GUEST 루트부터 탐색하므로 상위 경로를 모름.
    //   API의 ITEM_FOLDER_FULLPATH ('올리기전용 > GUEST > 업체A')에서
    //   자식 폴더 앞의 접두사를 추출하여 경로 일관성 확보.
    const ancestorPrefix = await this.discoverAncestorPrefix(rootId)

    // Step 3: 게스트 폴더 전체 재귀 탐색 (접두사 포함)
    await this.discoverRecursive(rootId, ancestorPrefix, result)

    this.logger.info('Folder discovery completed', {
      total: result.total,
      newFolders: result.newFolders,
      existingFolders: result.existingFolders,
    })

    return result
  }

  /** API 히스토리에서 GUEST 루트의 상위 경로 접두사를 추출
   *  예: API path '올리기전용 > GUEST > 업체A' + 자식 폴더 '업체A'
   *      → 접두사 '/올리기전용'
   */
  private async discoverAncestorPrefix(rootId: number): Promise<string> {
    try {
      const rootFolders = await this.lguplus.getSubFolders(rootId)
      if (rootFolders.length === 0) return ''

      const childNames = new Set(rootFolders.map((f) => f.folderName))

      const history = await this.lguplus.getUploadHistory({ page: 1 })
      for (const item of history.items) {
        const fullpath = item.itemFolderFullpath?.trim()
        if (!fullpath || fullpath === '/') continue

        const cleaned = cleanFolderPath(fullpath)
        const segments = cleaned.split('/').filter(Boolean)

        // 자식 폴더명이 경로에 나타나는 위치를 찾아 그 앞부분이 접두사
        const matchIdx = segments.findIndex((seg) => childNames.has(seg))
        if (matchIdx > 0) {
          const prefix = `/${segments.slice(0, matchIdx).join('/')}`
          this.logger.info('Discovered ancestor prefix from upload history', { prefix })
          return prefix
        }
      }
    } catch (error) {
      this.logger.debug('Could not discover ancestor prefix from history', {
        error: (error as Error).message,
      })
    }
    return ''
  }

  /** 폴더를 재귀적으로 탐색하며 모든 하위 폴더를 DB에 등록 */
  private async discoverRecursive(
    parentId: number,
    parentPath: string,
    result: DiscoveryResult,
  ): Promise<void> {
    let subFolders: LGUplusFolderItem[]
    try {
      subFolders = await this.lguplus.getSubFolders(parentId)
    } catch (error) {
      this.logger.error(`Failed to get sub-folders of ${parentId}`, error as Error)
      return
    }

    // 현재 레벨 폴더 등록/업데이트
    const newEntries: Array<{ folder: LGUplusFolderItem; path: string }> = []

    for (const folder of subFolders) {
      const lguplusFolderId = String(folder.folderId)
      const rawSegments = parentPath
        ? [...parentPath.split('/').filter(Boolean), folder.folderName]
        : [folder.folderName]
      const cleanSegments = filterPathSegments(rawSegments)
      const folderPath = cleanSegments.length > 0 ? `/${cleanSegments.join('/')}` : ''
      const existing = this.state.getFolderByLguplusId(lguplusFolderId)

      if (existing) {
        const needsUpdate = existing.lguplus_folder_name !== folder.folderName
          || !existing.lguplus_folder_path
          || existing.lguplus_folder_path !== folderPath
        if (needsUpdate) {
          this.state.updateFolder(existing.id, {
            lguplus_folder_name: folder.folderName,
            lguplus_folder_path: folderPath,
            company_name: folder.folderName,
          })
        }
        result.existingFolders++
        result.total++
        result.folders.push({
          id: existing.id,
          lguplusFolderId,
          folderName: folder.folderName,
          isNew: false,
        })
      } else {
        newEntries.push({ folder, path: folderPath })
      }
    }

    // 신규 폴더 병렬 등록 (concurrency=3)
    const CONCURRENCY = 3
    for (let i = 0; i < newEntries.length; i += CONCURRENCY) {
      const batch = newEntries.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.allSettled(
        batch.map(({ folder, path }) => this.processNewFolder(folder, path)),
      )
      for (const batchResult of batchResults) {
        if (batchResult.status === 'fulfilled' && batchResult.value) {
          result.newFolders++
          result.total++
          result.folders.push(batchResult.value)
        }
      }
    }

    // 하위 폴더 재귀 탐색
    for (const folder of subFolders) {
      const rawSegs = parentPath
        ? [...parentPath.split('/').filter(Boolean), folder.folderName]
        : [folder.folderName]
      const cleanSegs = filterPathSegments(rawSegs)
      const folderPath = cleanSegs.length > 0 ? `/${cleanSegs.join('/')}` : ''
      await this.discoverRecursive(folder.folderId, folderPath, result)
    }
  }

  private async processNewFolder(
    folder: LGUplusFolderItem,
    folderPath: string,
  ): Promise<{ id: string; lguplusFolderId: string; folderName: string; isNew: boolean }> {
    const lguplusFolderId = String(folder.folderId)

    // 자체웹하드 폴더 생성: 경로 세그먼트로 분할
    let selfWebhardPath: string | null = null
    try {
      const segments = filterPathSegments(folderPath.split('/').filter(Boolean))
      const ensureResult = await this.uploader.ensureFolderPath(segments)
      if (ensureResult.success && ensureResult.data) {
        selfWebhardPath = ensureResult.data
      }
    } catch (error) {
      this.logger.warn(
        `Failed to create self-webhard folder for ${folder.folderName}`,
        { error: (error as Error).message },
      )
    }

    const id = this.state.saveFolder({
      lguplus_folder_id: lguplusFolderId,
      lguplus_folder_name: folder.folderName,
      lguplus_folder_path: folderPath,
      self_webhard_path: selfWebhardPath,
      company_name: folder.folderName,
      enabled: true,
      auto_detected: true,
    })

    this.logger.info(`Discovered new folder: ${folder.folderName}`, {
      lguplusFolderId,
      folderPath,
      selfWebhardPath,
    })

    return { id, lguplusFolderId, folderName: folder.folderName, isNew: true }
  }
}
