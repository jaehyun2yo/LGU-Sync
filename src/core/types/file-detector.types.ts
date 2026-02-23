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
}
