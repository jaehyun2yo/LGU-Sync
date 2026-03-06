import { autoUpdater } from 'electron-updater'
import { app, dialog } from 'electron'
import type { ILogger } from '../core/types/logger.types'

export function setupAutoUpdater(logger: ILogger): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    logger.info('Checking for updates...')
  })

  autoUpdater.on('update-available', (info) => {
    logger.info('Update available', { version: info.version })

    dialog
      .showMessageBox({
        type: 'info',
        title: '업데이트 알림',
        message: `새 버전 ${info.version}이 있습니다. 다운로드하시겠습니까?`,
        buttons: ['다운로드', '나중에'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.downloadUpdate()
        }
      })
  })

  autoUpdater.on('update-not-available', () => {
    logger.debug('No update available')
  })

  autoUpdater.on('download-progress', (progress) => {
    logger.debug('Download progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    logger.info('Update downloaded', { version: info.version })

    dialog
      .showMessageBox({
        type: 'info',
        title: '업데이트 준비 완료',
        message: `버전 ${info.version} 다운로드가 완료되었습니다. 지금 설치하시겠습니까?`,
        buttons: ['지금 설치', '나중에'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
  })

  autoUpdater.on('error', (error) => {
    logger.warn('Auto-updater error', { error: error.message })
  })
}

/**
 * Check for updates (call after app is ready).
 * Safe to call even without publish configuration — will silently fail.
 */
export function checkForUpdates(logger: ILogger): void {
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch((err) => {
      logger.debug('Update check skipped or failed', { error: (err as Error).message })
    })
  }
}
