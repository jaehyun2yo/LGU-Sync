import { useCallback } from 'react'
import type { IpcChannelMap } from '../../shared/ipc-types'

export function useIpc() {
  const invoke = useCallback(
    async <K extends keyof IpcChannelMap>(
      channel: K,
      ...args: IpcChannelMap[K]['request'] extends void ? [] : [IpcChannelMap[K]['request']]
    ): Promise<IpcChannelMap[K]['response']> => {
      return window.electronAPI.invoke(channel, ...args)
    },
    [],
  )

  return { invoke }
}
