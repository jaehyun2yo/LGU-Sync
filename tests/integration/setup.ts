/**
 * 통합 테스트 공통 셋업
 *
 * LGU+ 웹하드 API 직접 호출 + FileDetector 감지 검증을 위한 공유 컨텍스트.
 *
 * 제약사항 (게스트 폴더 API):
 * - 폴더 생성(MAKE)만 가능
 * - 삭제/이름변경/이동은 게스트 폴더에서 지원하지 않음
 * - 파일 업로드/삭제/이름변경/이동도 불가
 * - 테스트에서 생성한 폴더는 수동 정리 필요
 */
import { Logger } from '../../src/core/logger'
import { RetryManager } from '../../src/core/retry-manager'
import { ConfigManager } from '../../src/core/config-manager'
import { EventBus } from '../../src/core/event-bus'
import { FileDetector, type FileDetectorOptions } from '../../src/core/file-detector'
import { LGUplusClient } from '../../src/core/lguplus-client'
import type { IStateManager } from '../../src/core/types/state-manager.types'
import type { DetectedFile } from '../../src/core/types/events.types'

const LGUPLUS_BASE_URL = 'https://only.webhard.co.kr'
const TEST_FOLDER_NAME = '테스트동기화'
const TEST_FOLDER_PREFIX = '__inttest_'

export interface IntegrationContext {
  config: ConfigManager
  logger: Logger
  retry: RetryManager
  client: LGUplusClient
  state: IStateManager
  eventBus: EventBus
  testFolderId: number
}

/**
 * Minimal in-memory StateManager stub for integration tests.
 * Only checkpoint read/write is used by FileDetector polling strategy.
 * Avoids better-sqlite3 native module dependency.
 */
class InMemoryStateManager implements IStateManager {
  private checkpoints = new Map<string, string>()

  getCheckpoint(key: string): string | null {
    return this.checkpoints.get(key) ?? null
  }
  saveCheckpoint(key: string, value: string): void {
    this.checkpoints.set(key, value)
  }

  // Stubs - not used by polling strategy integration tests
  initialize(): void { /* no-op */ }
  close(): void { /* no-op */ }
  saveFile(): string { return '' }
  updateFileStatus(): void { /* no-op */ }
  getFile(): null { return null }
  getFilesByFolder(): [] { return [] }
  getFileByHistoryNo(): null { return null }
  saveFolder(): string { return '' }
  updateFolder(): void { /* no-op */ }
  getFolders(): [] { return [] }
  getFolder(): null { return null }
  getFolderByLguplusId(): null { return null }
  logEvent(): void { /* no-op */ }
  getEvents(): [] { return [] }
  addToDlq(): void { /* no-op */ }
  getDlqItems(): [] { return [] }
  removeDlqItem(): void { /* no-op */ }
  getDailyStats(): [] { return [] }
  incrementDailyStats(): void { /* no-op */ }
  getLogs(): [] { return [] }
  getLogCount(): number { return 0 }
  addLog(): void { /* no-op */ }
  saveFolderChange(): number { return 0 }
  getFolderChanges(): [] { return [] }
  updateFolderChange(): void { /* no-op */ }
}

/**
 * 통합 테스트 초기화
 * - LGU+ 로그인
 * - 게스트폴더 > 테스트동기화 folderId 탐색
 * - in-memory StateManager 생성
 */
export async function setupIntegration(): Promise<IntegrationContext> {
  const config = new ConfigManager()
  const logger = new Logger({ minLevel: 'warn' })
  const retry = new RetryManager(logger, { failureThreshold: 3, resetTimeoutMs: 5000 })
  const client = new LGUplusClient(LGUPLUS_BASE_URL, logger, retry)

  // Login
  const lguplusConfig = config.get('lguplus')
  const loginResult = await client.login(lguplusConfig.username, lguplusConfig.password)
  if (!loginResult.success) {
    throw new Error(`LGU+ login failed: ${(loginResult as { message: string }).message}`)
  }

  // Find test folder: 게스트폴더 > 테스트동기화
  const rootId = await client.getGuestFolderRootId()
  if (!rootId) throw new Error('Guest root folder not found')

  const rootFolders = await client.getSubFolders(rootId)
  const testFolder = rootFolders.find(f => f.folderName === TEST_FOLDER_NAME)

  if (!testFolder) {
    throw new Error(
      `'${TEST_FOLDER_NAME}' folder not found in guest folders. ` +
      `Available: ${rootFolders.map(f => f.folderName).join(', ')}`,
    )
  }

  const state = new InMemoryStateManager()
  const eventBus = new EventBus()

  return {
    config,
    logger,
    retry,
    client,
    state,
    eventBus,
    testFolderId: testFolder.folderId,
  }
}

/**
 * FileDetector 생성 (polling strategy 기본)
 */
export function createDetector(
  ctx: IntegrationContext,
  options?: FileDetectorOptions,
): FileDetector {
  return new FileDetector(ctx.client, ctx.state, ctx.eventBus, ctx.logger, {
    pollingIntervalMs: 3000,
    strategy: 'polling',
    ...options,
  })
}

/**
 * 감지 대기 — predicate를 만족하는 DetectedFile이 나올 때까지 대기
 */
export function waitForDetection(
  detector: FileDetector,
  predicate: (file: DetectedFile) => boolean,
  timeoutMs = 30_000,
): Promise<{ file: DetectedFile; detectedAt: number }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Detection timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    const unsubscribe = detector.onFilesDetected((files: DetectedFile[]) => {
      for (const file of files) {
        if (predicate(file)) {
          clearTimeout(timeout)
          unsubscribe()
          resolve({ file, detectedAt: Date.now() })
          return
        }
      }
    })
  })
}

/**
 * 고유한 테스트 폴더명 생성
 */
export function testFolderName(label: string): string {
  return `${TEST_FOLDER_PREFIX}${label}_${Date.now()}`
}

/**
 * 일정 시간 대기 (API 반영 지연용)
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
