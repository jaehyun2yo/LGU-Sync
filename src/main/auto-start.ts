import { app } from 'electron'

export function setAutoStart(enabled: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: ['--minimized'],
    })
  } catch {
    // Fallback: ignore if setLoginItemSettings is not supported
  }
}

export function getAutoStartEnabled(): boolean {
  try {
    const settings = app.getLoginItemSettings()
    return settings.openAtLogin
  } catch {
    return false
  }
}
