import { useEffect } from 'react'
import { useIpcEvent } from '../hooks/useIpcEvent'
import { useSettingsStore } from '../stores/settings-store'
import { useNotificationStore } from '../stores/notification-store'
import { useToastStore } from '../stores/toast-store'
import { soundPlayer } from './notification-sound'
import type { NotificationEventType } from '../../core/types/config.types'
import type { NotificationType } from '../../shared/ipc-types'

function dispatch(
  eventType: NotificationEventType,
  toastType: NotificationType,
  title: string,
  message: string,
): void {
  const settings = useSettingsStore.getState().settings
  if (!settings?.notification.enabled) return

  const rule = settings.notification.rules[eventType]
  if (!rule) return

  if (rule.sound && settings.notification.sound.enabled) {
    soundPlayer.setVolume(settings.notification.sound.volume)
    soundPlayer.play(settings.notification.sound.preset)
  }

  if (rule.toast && settings.notification.toast.enabled) {
    useToastStore.getState().addToast({
      type: toastType,
      title,
      message,
      durationMs: settings.notification.toast.durationMs,
    })
  }

  if (rule.inApp && settings.notification.inApp.enabled) {
    useNotificationStore.getState().addNotification(toastType, title, message)
  }
}

export function useNotificationManager(): void {
  // Sync volume on settings change
  useEffect(() => {
    const unsub = useSettingsStore.subscribe((state) => {
      if (state.settings?.notification.sound) {
        soundPlayer.setVolume(state.settings.notification.sound.volume)
      }
    })
    return unsub
  }, [])

  useIpcEvent('detection:new-files', (event) => {
    const count = event.files.length
    if (count === 0) return
    const firstFile = event.files[0].fileName
    const msg = count === 1 ? firstFile : `${firstFile} 외 ${count - 1}건`
    dispatch('file-detected', 'info', '새 파일 감지', msg)
  })

  useIpcEvent('sync:file-completed', (event) => {
    dispatch('file-completed', 'success', '동기화 완료', event.fileName)
  })

  useIpcEvent('sync:file-failed', (event) => {
    dispatch('sync-failed', 'error', '동기화 실패', `${event.fileName}: ${event.error}`)
  })

  useIpcEvent('auth:expired', (event) => {
    const service = event.service === 'lguplus' ? 'LGU+' : '웹하드'
    dispatch('session-expired', 'warning', '세션 만료', `${service} 세션이 만료되었습니다`)
  })

  useIpcEvent('sync:status-changed', (event) => {
    if (event.currentStatus === 'idle' && event.previousStatus === 'syncing') {
      dispatch('sync-completed', 'success', '동기화 완료', '모든 파일 동기화가 완료되었습니다')
    }
  })

  // Cleanup sound player on unmount
  useEffect(() => {
    return () => soundPlayer.dispose()
  }, [])
}
