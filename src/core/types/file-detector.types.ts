// src/core/types/file-detector.types.ts — [SPEC] File detector contract
// SDD Level 2: IFileDetector interface

import type { DetectedFile, DetectionStrategy } from './events.types'

export interface IFileDetector {
  start(): void
  stop(): void
  setPollingInterval(intervalMs: number): void
  forceCheck(): Promise<DetectedFile[]>
  onFilesDetected(
    handler: (files: DetectedFile[], strategy: DetectionStrategy) => void,
  ): () => void
  readonly isRunning: boolean
  /** 다음 첫 폴링에서 기존 파일도 감지하도록 설정 (1회성) */
  setIncludeExistingOnFirstPoll(): void
}
