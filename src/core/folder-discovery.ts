import type { ILGUplusClient, LGUplusFolderItem } from './types/lguplus-client.types'
import type { IWebhardUploader } from './types/webhard-uploader.types'
import type { IStateManager } from './types/state-manager.types'
import type { ILogger } from './types/logger.types'

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

    // Step 2: Find "올리기전용" folder under HOME
    const homeFolders = await this.lguplus.getSubFolders(rootId)
    const uploadRoot = homeFolders.find((f) => f.folderName.includes('올리기전용'))
    if (!uploadRoot) {
      this.logger.warn('올리기전용 folder not found under guest root, skipping discovery')
      return result
    }

    this.logger.info('Found 올리기전용 folder', {
      folderId: uploadRoot.folderId,
      folderName: uploadRoot.folderName,
    })

    // Step 3: Get company sub-folders under 올리기전용
    let subFolders: LGUplusFolderItem[]
    try {
      subFolders = await this.lguplus.getSubFolders(uploadRoot.folderId)
    } catch (error) {
      this.logger.error('Failed to get sub-folders of 올리기전용', error as Error)
      return result
    }

    result.total = subFolders.length

    // Step 3: 기존 폴더 / 새 폴더 분리
    const newEntries: LGUplusFolderItem[] = []

    for (const folder of subFolders) {
      const lguplusFolderId = String(folder.folderId)
      const existing = this.state.getFolderByLguplusId(lguplusFolderId)

      if (existing) {
        if (existing.lguplus_folder_name !== folder.folderName) {
          this.state.updateFolder(existing.id, {
            lguplus_folder_name: folder.folderName,
            company_name: folder.folderName,
          })
        }

        result.existingFolders++
        result.folders.push({
          id: existing.id,
          lguplusFolderId,
          folderName: folder.folderName,
          isNew: false,
        })
      } else {
        newEntries.push(folder)
      }
    }

    // Step 4: 새 폴더들은 병렬 처리 (concurrency=3)
    const CONCURRENCY = 3
    for (let i = 0; i < newEntries.length; i += CONCURRENCY) {
      const batch = newEntries.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.allSettled(
        batch.map((folder) => this.processNewFolder(folder)),
      )

      for (const batchResult of batchResults) {
        if (batchResult.status === 'fulfilled' && batchResult.value) {
          result.newFolders++
          result.folders.push(batchResult.value)
        }
      }
    }

    this.logger.info('Folder discovery completed', {
      total: result.total,
      newFolders: result.newFolders,
      existingFolders: result.existingFolders,
    })

    return result
  }

  private async processNewFolder(
    folder: LGUplusFolderItem,
  ): Promise<{ id: string; lguplusFolderId: string; folderName: string; isNew: boolean }> {
    const lguplusFolderId = String(folder.folderId)

    let selfWebhardPath: string | null = null
    try {
      const ensureResult = await this.uploader.ensureFolderPath([
        '올리기전용',
        folder.folderName,
      ])
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
      lguplus_folder_path: `/올리기전용/${folder.folderName}`,
      self_webhard_path: selfWebhardPath,
      company_name: folder.folderName,
      enabled: true,
      auto_detected: true,
    })

    this.logger.info(`Discovered new folder: ${folder.folderName}`, {
      lguplusFolderId,
      selfWebhardPath,
    })

    return { id, lguplusFolderId, folderName: folder.folderName, isNew: true }
  }
}
