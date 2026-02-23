// src/core/types/events.types.ts — [SPEC] Event bus contract
// SDD Level 2: EventMap and IEventBus interface

import type { SyncAppError } from '../errors'

export type EngineStatus = 'idle' | 'syncing' | 'paused' | 'error' | 'stopping' | 'stopped'
export type DetectionStrategy = 'polling' | 'snapshot' | 'integrity'

export interface DetectedFile {
  fileName: string
  filePath: string
  fileSize: number
  historyNo?: number
  folderId: string
}

export interface EventMap {
  'sync:started': { timestamp: number }
  'sync:completed': { totalFiles: number; totalBytes: number; durationMs: number }
  'sync:failed': { error: SyncAppError; fileId?: string }
  'sync:progress': {
    fileId: string
    fileName: string
    progress: number
    speedBps: number
  }
  'detection:found': { files: DetectedFile[]; strategy: DetectionStrategy }
  'session:expired': { reason: string }
  'session:renewed': { method: 'http' | 'playwright' }
  'engine:status': { prev: EngineStatus; next: EngineStatus }
  'download:progress': {
    fileId: string
    downloadedBytes: number
    totalBytes: number
  }
  'upload:progress': {
    fileId: string
    uploadedBytes: number
    totalBytes: number
  }
}

export interface IEventBus {
  on<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): void
  off<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): void
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void
  removeAllListeners(): void
}
