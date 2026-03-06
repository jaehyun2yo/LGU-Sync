import { BrowserWindow, screen } from 'electron'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

const BOUNDS_FILE = 'window-bounds.json'

export class WindowManager {
  private mainWindow: BrowserWindow | null = null
  private boundsPath: string
  private closeToTray: boolean

  constructor(options?: { closeToTray?: boolean }) {
    this.boundsPath = path.join(app.getPath('userData'), BOUNDS_FILE)
    this.closeToTray = options?.closeToTray ?? true
  }

  getWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  createWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.focus()
      return this.mainWindow
    }

    const bounds = this.loadBounds()
    const display = screen.getPrimaryDisplay()
    const { width: screenWidth, height: screenHeight } = display.workAreaSize

    this.mainWindow = new BrowserWindow({
      width: bounds?.width ?? 1200,
      height: bounds?.height ?? 800,
      x: bounds?.x ?? Math.round((screenWidth - 1200) / 2),
      y: bounds?.y ?? Math.round((screenHeight - 800) / 2),
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: '외부웹하드 동기화',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    if (bounds?.isMaximized) {
      this.mainWindow.maximize()
    }

    // Load renderer
    if (process.env.ELECTRON_RENDERER_URL) {
      this.mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }

    // Show when ready to avoid white flash
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show()
    })

    // Close to tray instead of quitting
    this.mainWindow.on('close', (event) => {
      if (this.closeToTray && this.mainWindow && !this.mainWindow.isDestroyed()) {
        // Check if the app is actually quitting (before-quit sets this)
        if (!(app as any)._isQuitting) {
          event.preventDefault()
          this.mainWindow.hide()
        }
      }
    })

    // Save bounds on move/resize
    this.mainWindow.on('moved', () => this.saveBounds())
    this.mainWindow.on('resized', () => this.saveBounds())
    this.mainWindow.on('maximize', () => this.saveBounds())
    this.mainWindow.on('unmaximize', () => this.saveBounds())

    this.mainWindow.on('closed', () => {
      this.mainWindow = null
    })

    return this.mainWindow
  }

  show(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore()
      this.mainWindow.show()
      this.mainWindow.focus()
    } else {
      this.createWindow()
    }
  }

  hide(): void {
    this.mainWindow?.hide()
  }

  isVisible(): boolean {
    return this.mainWindow?.isVisible() ?? false
  }

  destroy(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.saveBounds()
      this.mainWindow.destroy()
      this.mainWindow = null
    }
  }

  private saveBounds(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return

    try {
      const bounds: WindowBounds = {
        ...this.mainWindow.getBounds(),
        isMaximized: this.mainWindow.isMaximized(),
      }
      fs.writeFileSync(this.boundsPath, JSON.stringify(bounds), 'utf-8')
    } catch {
      // ignore write errors
    }
  }

  private loadBounds(): WindowBounds | null {
    try {
      if (!fs.existsSync(this.boundsPath)) return null
      const data = fs.readFileSync(this.boundsPath, 'utf-8')
      const bounds = JSON.parse(data) as WindowBounds

      // Validate bounds are within a visible display
      const displays = screen.getAllDisplays()
      const isVisible = displays.some((display) => {
        const { x, y, width, height } = display.bounds
        return (
          bounds.x >= x - 100 &&
          bounds.y >= y - 100 &&
          bounds.x < x + width &&
          bounds.y < y + height
        )
      })

      return isVisible ? bounds : null
    } catch {
      return null
    }
  }
}
