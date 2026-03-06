import { useEffect } from 'react'
import type { IpcEventMap } from '../../shared/ipc-types'

export function useIpcEvent<K extends keyof IpcEventMap>(
  channel: K,
  handler: (data: IpcEventMap[K]) => void,
) {
  useEffect(() => {
    const unsubscribe = window.electronAPI.on(channel, handler)
    return unsubscribe
  }, [channel, handler])
}
