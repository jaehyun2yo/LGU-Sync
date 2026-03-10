// src/core/types/events.types.ts — [SPEC] Event bus contract
// SDD Level 2: EventMap and IEventBus interface

import type { SyncAppError } from '../errors'

export type EngineStatus = 'idle' | 'syncing' | 'paused' | 'error' | 'stopping' | 'stopped'
export type DetectionStrategy = 'polling' | 'snapshot' | 'integrity'

/** LGU+ 웹하드 operCode — 파일/폴더 변동 유형 */
export type OperCode =
  | 'UP'  // 업로드
  | 'D'   // 삭제
  | 'MV'  // 이동
  | 'RN'  // 이름변경
  | 'CP'  // 복사
  | 'FC'  // 폴더생성
  | 'FD'  // 폴더삭제
  | 'FMV' // 폴더이동
  | 'FRN' // 폴더이름변경
  | 'DN'  // 다운로드

export interface DetectedFile {
  fileName: string
  filePath: string
  fileSize: number
  historyNo?: number
  folderId: string
  /** 변동 유형 */
  operCode: OperCode
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
    phase: 'downloading' | 'uploading'
    fileSize: number
  }
  'file:completed': {
    fileId: string
    fileName: string
    fileSize: number
    folderPath: string
    durationMs: number
  }
  'detection:found': { files: DetectedFile[]; strategy: DetectionStrategy }
  'opercode:event': {
    operCode: OperCode
    fileName: string
    filePath: string
    folderId: string
    historyNo?: number
    timestamp: string
  }
  'session:expired': { reason: string }
  'session:renewed': { method: 'http' | 'playwright' }
  'engine:status': { prev: EngineStatus; next: EngineStatus }
  /** @deprecated sync:progress의 phase='downloading'으로 대체. 향후 제거 예정. */
  'download:progress': {
    fileId: string
    downloadedBytes: number
    totalBytes: number
  }
  /** @deprecated sync:progress의 phase='uploading'으로 대체. 향후 제거 예정. */
  'upload:progress': {
    fileId: string
    uploadedBytes: number
    totalBytes: number
  }
}

/** LGU+ 클라이언트 세션 이벤트 타입 맵 */
export interface LGUplusSessionEventMap {
  'session-expired': { reason: string }
  'session-refreshed': void
  'login-required': void
}

export interface IEventBus {
  on<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): void
  off<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): void
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void
  removeAllListeners(): void
}
