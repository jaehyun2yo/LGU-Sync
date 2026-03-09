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

    // Step 2: Get ALL sub-folders under HOME (게스트폴더)
    const homeFolders = await this.lguplus.getSubFolders(rootId)

    this.logger.info('Found folders under guest root', {
      count: homeFolders.length,
    })

    // Deduplicate by folderId (API may return duplicates)
    const seen = new Set<number>()
    const uniqueFolders = homeFolders.filter((f) => {
      if (seen.has(f.folderId)) return false
      seen.add(f.folderId)
      return true
    })

    result.total = uniqueFolders.length

    // Step 3: Process each folder
    for (const folder of uniqueFolders) {
      try {
        const lguplusFolderId = String(folder.folderId)
        const existing = this.state.getFolderByLguplusId(lguplusFolderId)

        if (existing) {
          // Update name if changed
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
          continue
        }

        // New folder: ensure self-webhard folder path
        let selfWebhardPath: string | null = null
        try {
          const ensureResult = await this.uploader.ensureFolderPath([
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

        // Save new folder to DB
        let id: string
        try {
          id = this.state.saveFolder({
            lguplus_folder_id: lguplusFolderId,
            lguplus_folder_name: folder.folderName,
            lguplus_folder_path: `/${folder.folderName}`,
            self_webhard_path: selfWebhardPath,
            company_name: folder.folderName,
            enabled: true,
            auto_detected: true,
          })
        } catch (saveError) {
          // Handle concurrent discovery race condition (UNIQUE constraint)
          const raceExisting = this.state.getFolderByLguplusId(lguplusFolderId)
          if (raceExisting) {
            result.existingFolders++
            result.folders.push({
              id: raceExisting.id,
              lguplusFolderId,
              folderName: folder.folderName,
              isNew: false,
            })
            continue
          }
          throw saveError
        }

        result.newFolders++
        result.folders.push({
          id,
          lguplusFolderId,
          folderName: folder.folderName,
          isNew: true,
        })

        this.logger.info(`Discovered new folder: ${folder.folderName}`, {
          lguplusFolderId,
          selfWebhardPath,
        })
      } catch (error) {
        this.logger.error(
          `Failed to process folder ${folder.folderName}`,
          error as Error,
        )
      }
    }

    this.logger.info('Folder discovery completed', {
      total: result.total,
      newFolders: result.newFolders,
      existingFolders: result.existingFolders,
    })

    return result
  }
}
