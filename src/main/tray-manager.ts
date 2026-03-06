import { Tray, Menu, nativeImage, app } from 'electron'
import path from 'path'
import type { EngineStatus } from '../core/types/events.types'

export interface TrayCallbacks {
  onShow: () => void
  onPauseResume: () => void
  onFullSync: () => void
  onQuit: () => void
}

export class TrayManager {
  private tray: Tray | null = null
  private callbacks: TrayCallbacks
  private currentStatus: EngineStatus = 'idle'

  constructor(callbacks: TrayCallbacks) {
    this.callbacks = callbacks
  }

  create(): void {
    const icon = this.createIcon('idle')
    this.tray = new Tray(icon)
    this.tray.setToolTip('외부웹하드 동기화 - 대기중')

    this.updateContextMenu()

    this.tray.on('double-click', () => {
      this.callbacks.onShow()
    })
  }

  updateStatus(status: EngineStatus): void {
    if (!this.tray || this.tray.isDestroyed()) return

    this.currentStatus = status
    this.tray.setImage(this.createIcon(status))
    this.tray.setToolTip(this.getTooltip(status))
    this.updateContextMenu()
  }

  destroy(): void {
    if (this.tray && !this.tray.isDestroyed()) {
      this.tray.destroy()
      this.tray = null
    }
  }

  private updateContextMenu(): void {
    if (!this.tray || this.tray.isDestroyed()) return

    const isPaused = this.currentStatus === 'paused'
    const isSyncing = this.currentStatus === 'syncing'

    const menu = Menu.buildFromTemplate([
      {
        label: '열기',
        click: () => this.callbacks.onShow(),
      },
      { type: 'separator' },
      {
        label: isPaused ? '재개' : '일시중지',
        enabled: isSyncing || isPaused,
        click: () => this.callbacks.onPauseResume(),
      },
      {
        label: '전체 동기화',
        enabled: isSyncing,
        click: () => this.callbacks.onFullSync(),
      },
      { type: 'separator' },
      {
        label: '종료',
        click: () => this.callbacks.onQuit(),
      },
    ])

    this.tray.setContextMenu(menu)
  }

  private getTooltip(status: EngineStatus): string {
    const labels: Record<EngineStatus, string> = {
      idle: '외부웹하드 동기화 - 대기중',
      syncing: '외부웹하드 동기화 - 동기화중',
      paused: '외부웹하드 동기화 - 일시중지',
      error: '외부웹하드 동기화 - 오류',
      stopping: '외부웹하드 동기화 - 중지중',
      stopped: '외부웹하드 동기화 - 중지됨',
    }
    return labels[status] ?? '외부웹하드 동기화'
  }

  private createIcon(status: EngineStatus): Electron.NativeImage {
    // Generate a simple colored icon programmatically
    // Green = syncing, Red = error, Gray = idle/stopped, Yellow = paused
    const colors: Record<EngineStatus, string> = {
      idle: '#9ca3af',     // gray
      syncing: '#22c55e',  // green
      paused: '#eab308',   // yellow
      error: '#ef4444',    // red
      stopping: '#9ca3af', // gray
      stopped: '#9ca3af',  // gray
    }

    const color = colors[status] ?? '#9ca3af'

    // Create a 16x16 icon with the status color
    const size = 16
    const canvas = Buffer.alloc(size * size * 4)

    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)

    // Draw a filled circle
    const cx = size / 2
    const cy = size / 2
    const radius = size / 2 - 1

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx + 0.5
        const dy = y - cy + 0.5
        const dist = Math.sqrt(dx * dx + dy * dy)
        const idx = (y * size + x) * 4

        if (dist <= radius) {
          // Anti-aliased edge
          const alpha = dist > radius - 1 ? Math.round((radius - dist) * 255) : 255
          canvas[idx] = r
          canvas[idx + 1] = g
          canvas[idx + 2] = b
          canvas[idx + 3] = alpha
        } else {
          canvas[idx] = 0
          canvas[idx + 1] = 0
          canvas[idx + 2] = 0
          canvas[idx + 3] = 0
        }
      }
    }

    return nativeImage.createFromBuffer(canvas, {
      width: size,
      height: size,
    })
  }
}
