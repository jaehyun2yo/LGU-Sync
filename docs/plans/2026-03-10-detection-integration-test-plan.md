# 폴링 기반 실시간 감지 통합 테스트 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** LGU+ 웹하드 쓰기 API를 역분석하여 LGUplusClient에 추가하고, 파일/폴더 CRUD 감지 통합 테스트를 Vitest로 자동화한다.

**Architecture:** LGUplusClient에 쓰기 메서드(업로드/삭제/이동/이름변경) 추가 → Vitest integration 프로젝트로 실제 API 호출 테스트 → FileDetector 폴링 감지 검증 → 로컬 디렉토리 동기화 검증

**Tech Stack:** TypeScript, Vitest 4, LGU+ 웹하드 API (`only.webhard.co.kr`), better-sqlite3 (in-memory)

---

### Task 1: Vitest integration 프로젝트 설정

**Files:**
- Modify: `vitest.config.ts`
- Create: `tests/integration/.gitkeep` (폴더 생성 확인)

**Step 1: vitest.config.ts에 integration 프로젝트 분리**

현재 `vitest.config.ts`는 단일 프로젝트. integration 테스트를 분리하여 기본 `npm run test`에서 제외하고 별도 명령으로 실행하도록 변경.

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'tests/integration/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
})
```

**Step 2: package.json에 integration 테스트 명령 추가**

```json
"test:integration": "vitest run tests/integration/ --pool=forks --poolOptions.forks.singleFork --reporter=verbose --testTimeout=120000"
```

**Step 3: 실행하여 기존 테스트가 깨지지 않는지 확인**

Run: `npm run test -- --run`
Expected: 기존 단위 테스트 모두 PASS (integration 폴더는 제외됨)

**Step 4: 커밋**

```bash
git add vitest.config.ts package.json
git commit -m "chore: add integration test config separated from unit tests"
```

---

### Task 2: LGU+ 쓰기 API 역분석 스크립트

**Files:**
- Create: `scripts/explore-lguplus-api.ts`

**목적:** LGU+ 웹하드 `/wh` 엔드포인트의 쓰기 API 조합을 탐색하여 파일 업로드/삭제/이동/이름변경, 폴더 생성/삭제/이동/이름변경에 필요한 파라미터를 발견한다.

**Step 1: 탐색 스크립트 작성**

```typescript
// scripts/explore-lguplus-api.ts
/**
 * LGU+ 웹하드 쓰기 API 역분석 스크립트
 *
 * Usage:
 *   npx tsx scripts/explore-lguplus-api.ts
 *   npx tsx scripts/explore-lguplus-api.ts --test=upload
 *   npx tsx scripts/explore-lguplus-api.ts --test=folder
 *   npx tsx scripts/explore-lguplus-api.ts --test=delete
 *   npx tsx scripts/explore-lguplus-api.ts --test=all
 */
import { Logger } from '../src/core/logger'
import { RetryManager } from '../src/core/retry-manager'
import { ConfigManager } from '../src/core/config-manager'
import { LGUplusClient } from '../src/core/lguplus-client'

const logger = new Logger({ minLevel: 'debug' })
const retry = new RetryManager(logger, { failureThreshold: 3, resetTimeoutMs: 5000 })
const config = new ConfigManager()
const client = new LGUplusClient('https://only.webhard.co.kr', logger, retry)

async function login(): Promise<void> {
  const lguplusConfig = config.get('lguplus')
  const result = await client.login(lguplusConfig.username, lguplusConfig.password)
  if (!result.success) throw new Error(`Login failed: ${(result as { message: string }).message}`)
  console.log('[OK] Logged in')
}

async function findTestFolder(): Promise<number> {
  const rootId = await client.getGuestFolderRootId()
  if (!rootId) throw new Error('Guest root folder not found')

  // 게스트폴더 > 테스트동기화 찾기
  const subFolders = await client.getSubFolders(rootId)
  console.log('Root sub-folders:', subFolders.map(f => `[${f.folderId}] ${f.folderName}`))

  const testFolder = subFolders.find(f => f.folderName === '테스트동기화')
  if (!testFolder) {
    // 없으면 모든 하위 폴더에서 찾기
    for (const folder of subFolders) {
      const children = await client.getSubFolders(folder.folderId)
      const found = children.find(f => f.folderName === '테스트동기화')
      if (found) {
        console.log(`Found 테스트동기화 under ${folder.folderName}: folderId=${found.folderId}`)
        return found.folderId
      }
    }
    throw new Error('테스트동기화 folder not found')
  }

  console.log(`Found 테스트동기화: folderId=${testFolder.folderId}`)
  return testFolder.folderId
}

// ══════════════════════════════════════════════════════════════
// API 탐색: /wh 엔드포인트 조합 테스트
// ══════════════════════════════════════════════════════════════

// LGU+ 웹하드의 write API는 아래 경로에서 발견될 수 있음:
// 1. POST /wh — MESSAGE_TYPE 'FILE' 또는 'FOLDER', PROCESS_TYPE 'DELETE'/'RENAME'/'MOVE'/'CREATE'
// 2. POST /uploads — 파일 업로드 (multipart/form-data)
// 3. POST /items/delete, /items/move, /items/rename 등 REST 스타일
// 4. 브라우저 네트워크 탭에서 확인 가능

async function exploreWhApiCombinations(testFolderId: number): Promise<void> {
  console.log('\n=== /wh API 조합 탐색 ===\n')

  // callWhApi는 private이므로, 직접 fetch로 호출
  // client에서 쿠키와 헤더를 가져오려면 public 메서드가 필요
  // 대안: 직접 fetch 호출

  const baseUrl = 'https://only.webhard.co.kr'

  // 파일 관련 PROCESS_TYPE 후보
  const fileProcessTypes = [
    'DELETE', 'REMOVE', 'DEL',
    'RENAME', 'RN', 'MODIFY',
    'MOVE', 'MV', 'TRANSFER',
    'COPY', 'CP',
    'UPLOAD', 'UP', 'CREATE',
  ]

  // 폴더 관련 PROCESS_TYPE 후보
  const folderProcessTypes = [
    'CREATE', 'MAKE', 'MKDIR', 'ADD',
    'DELETE', 'REMOVE', 'DEL', 'RMDIR',
    'RENAME', 'RN', 'MODIFY',
    'MOVE', 'MV', 'TRANSFER',
  ]

  const messageTypes = ['FILE', 'FOLDER', 'ITEM', 'MANAGE']

  // 조합 테스트 (안전하게 읽기 전용 파라미터만 사용)
  for (const msgType of messageTypes) {
    const processTypes = msgType === 'FOLDER' ? folderProcessTypes : fileProcessTypes
    for (const procType of processTypes) {
      try {
        // 빈 요청으로 API 응답 구조만 확인 (실제 변경 없음)
        const response = await client.getUploadHistory({ page: 1 }) // placeholder
        // 실제로는 callWhApi를 직접 호출해야 함

        // NOTE: 이 부분은 실제로 브라우저 DevTools에서 확인하거나
        // LGUplusClient에 임시 public 메서드를 추가하여 탐색해야 함
        console.log(`  ${msgType}/${procType}: (탐색 필요)`)
      } catch {
        // 무시
      }
    }
  }

  console.log('\n[INFO] callWhApi가 private이므로 직접 탐색이 제한됩니다.')
  console.log('[INFO] 아래 방법 중 하나를 선택하세요:')
  console.log('  1. LGUplusClient에 임시 public exploreApi() 메서드 추가')
  console.log('  2. 브라우저 DevTools (Network 탭)에서 파일 삭제/이동 시 요청 캡처')
  console.log('  3. 아래의 알려진 API 패턴으로 먼저 시도')
}

// 알려진 LGU+ 웹하드 API 패턴 (웹 인터페이스 분석 기반)
async function exploreKnownPatterns(testFolderId: number): Promise<void> {
  console.log('\n=== 알려진 API 패턴 탐색 ===\n')

  // 패턴 1: REST 스타일 엔드포인트
  const endpoints = [
    { method: 'GET', path: '/folders/guest' },
    { method: 'GET', path: `/folders/${testFolderId}` },
    { method: 'GET', path: `/items?folderId=${testFolderId}` },
    { method: 'POST', path: '/items/delete' },
    { method: 'POST', path: '/items/move' },
    { method: 'POST', path: '/items/rename' },
    { method: 'POST', path: '/folders/create' },
    { method: 'POST', path: '/folders/delete' },
    { method: 'POST', path: '/folders/rename' },
    { method: 'POST', path: '/folders/move' },
    { method: 'GET', path: '/uploads/server' },
    { method: 'POST', path: '/uploads' },
  ]

  for (const ep of endpoints) {
    console.log(`  [${ep.method}] ${ep.path}: (LGUplusClient 확장 후 탐색)`)
  }
}

async function main(): Promise<void> {
  const test = process.argv.find(a => a.startsWith('--test='))?.replace('--test=', '') ?? 'all'

  await login()
  const testFolderId = await findTestFolder()

  console.log(`\nTest folder ID: ${testFolderId}`)
  console.log(`Test type: ${test}\n`)

  // 현재 파일 목록 확인
  const files = await client.getFileList(testFolderId)
  console.log(`Current files in test folder: ${files.total}`)
  for (const f of files.items) {
    console.log(`  [${f.itemId}] ${f.itemName} (${f.itemSize} bytes)`)
  }

  // API 탐색
  await exploreWhApiCombinations(testFolderId)
  await exploreKnownPatterns(testFolderId)

  // History 확인
  const history = await client.getUploadHistory({ operCode: '' })
  console.log(`\nRecent history (all operCodes): ${history.total} total`)
  for (const h of history.items.slice(0, 10)) {
    console.log(`  [${h.historyNo}] ${h.itemOperCode} ${h.itemSrcName}.${h.itemSrcExtension} (${h.itemFolderFullpath})`)
  }

  await client.logout()
  console.log('\n[DONE] API exploration complete')
}

main().catch(console.error)
```

**Step 2: LGUplusClient에 `callWhApiPublic` 탐색용 메서드 추가**

`src/core/lguplus-client.ts`에 임시 public 메서드 추가 (역분석 완료 후 제거):

```typescript
/** [임시] API 탐색용 public wrapper — 역분석 완료 후 제거 */
async callWhApiPublic(body: Record<string, unknown>): Promise<unknown> {
  return this.callWhApi(body)
}

/** [임시] 임의 URL로 fetch — 역분석용 */
async fetchPublic(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${this.baseUrl}${path}`, {
    ...options,
    headers: {
      ...this.getApiHeaders(),
      ...(options?.headers ?? {}),
    },
  })
}
```

**Step 3: 스크립트 실행 및 API 구조 파악**

Run: `npx tsx scripts/explore-lguplus-api.ts`
Expected: 테스트동기화 폴더 ID 확인, 현재 파일 목록 출력, API 엔드포인트 후보 목록

**Step 4: 브라우저 DevTools로 쓰기 API 캡처**

수동 작업:
1. 브라우저에서 `only.webhard.co.kr` 로그인
2. DevTools > Network 탭 열기
3. 게스트폴더 > 테스트동기화에서 아래 작업 수행하며 네트워크 요청 캡처:
   - 파일 업로드 → 업로드 엔드포인트/파라미터 기록
   - 파일 삭제 → 삭제 API 기록
   - 파일 이름변경 → 이름변경 API 기록
   - 파일 이동 → 이동 API 기록
   - 폴더 생성 → 생성 API 기록
   - 폴더 삭제 → 삭제 API 기록
   - 폴더 이름변경 → 이름변경 API 기록
   - 폴더 이동 → 이동 API 기록
4. 각 요청의 URL, method, body, headers 기록

**Step 5: 발견된 API를 스크립트에 반영하여 프로그래밍 방식으로 재검증**

스크립트에서 발견된 엔드포인트로 실제 요청을 보내 응답 확인.

**Step 6: 커밋**

```bash
git add scripts/explore-lguplus-api.ts src/core/lguplus-client.ts
git commit -m "chore: add LGU+ write API exploration script"
```

---

### Task 3: LGUplusClient 쓰기 API 구현

**Files:**
- Modify: `src/core/lguplus-client.ts`
- Modify: `src/core/types/lguplus-client.types.ts`

**의존성:** Task 2의 역분석 결과에 따라 정확한 엔드포인트/파라미터가 결정됨.

아래는 예상되는 API 패턴 기반의 구현. Task 2에서 확인된 실제 API 구조에 맞게 수정 필요.

**Step 1: 인터페이스에 쓰기 메서드 시그니처 추가**

`src/core/types/lguplus-client.types.ts`:

```typescript
// ILGUplusClient 인터페이스에 추가:

  // Write operations (파일)
  uploadFile(folderId: number, filePath: string): Promise<{ itemId: number }>
  deleteFile(itemId: number): Promise<void>
  moveFile(itemId: number, targetFolderId: number): Promise<void>
  renameFile(itemId: number, newName: string): Promise<void>

  // Write operations (폴더)
  createFolder(parentFolderId: number, folderName: string): Promise<{ folderId: number }>
  deleteFolder(folderId: number): Promise<void>
  moveFolder(folderId: number, targetParentFolderId: number): Promise<void>
  renameFolder(folderId: number, newName: string): Promise<void>
```

**Step 2: LGUplusClient에 쓰기 메서드 구현**

`src/core/lguplus-client.ts`에 아래 메서드들 추가. 정확한 API 파라미터는 Task 2 결과에 따라 달라짐.

```typescript
// ══════════════════════════════════════════════════════════════
// Write Operations — File
// ══════════════════════════════════════════════════════════════

async uploadFile(folderId: number, filePath: string): Promise<{ itemId: number }> {
  // Task 2에서 발견된 업로드 엔드포인트 사용
  // 일반적으로 multipart/form-data POST
  // 예상 패턴:
  //   1. GET /uploads/{folderId}/server → 업로드 서버 URL 획득
  //   2. POST {uploadServerUrl} → multipart/form-data로 파일 전송
  throw new Error('TODO: implement after API discovery')
}

async deleteFile(itemId: number): Promise<void> {
  // 예상: POST /wh, MESSAGE_TYPE: 'FILE', PROCESS_TYPE: 'DELETE'
  await this.callWhApi({
    MESSAGE_TYPE: 'FILE',
    PROCESS_TYPE: 'DELETE',
    REQUEST_SHARED: 'G',
    ITEM_ID: itemId,
  })
}

async moveFile(itemId: number, targetFolderId: number): Promise<void> {
  await this.callWhApi({
    MESSAGE_TYPE: 'FILE',
    PROCESS_TYPE: 'MOVE',
    REQUEST_SHARED: 'G',
    ITEM_ID: itemId,
    TARGET_FOLDER_ID: targetFolderId,
  })
}

async renameFile(itemId: number, newName: string): Promise<void> {
  await this.callWhApi({
    MESSAGE_TYPE: 'FILE',
    PROCESS_TYPE: 'RENAME',
    REQUEST_SHARED: 'G',
    ITEM_ID: itemId,
    ITEM_NAME: newName,
  })
}

// ══════════════════════════════════════════════════════════════
// Write Operations — Folder
// ══════════════════════════════════════════════════════════════

async createFolder(parentFolderId: number, folderName: string): Promise<{ folderId: number }> {
  const data = await this.callWhApi({
    MESSAGE_TYPE: 'FOLDER',
    PROCESS_TYPE: 'CREATE',
    REQUEST_SHARED: 'G',
    UPPER_ID: parentFolderId,
    FOLDER_NAME: folderName,
  })
  // 응답에서 새 폴더 ID 추출 (실제 필드명은 Task 2에서 확인)
  const folderId = (data.FOLDER_ID ?? data.ITEM_ID) as number
  return { folderId }
}

async deleteFolder(folderId: number): Promise<void> {
  await this.callWhApi({
    MESSAGE_TYPE: 'FOLDER',
    PROCESS_TYPE: 'DELETE',
    REQUEST_SHARED: 'G',
    FOLDER_ID: folderId,
  })
}

async moveFolder(folderId: number, targetParentFolderId: number): Promise<void> {
  await this.callWhApi({
    MESSAGE_TYPE: 'FOLDER',
    PROCESS_TYPE: 'MOVE',
    REQUEST_SHARED: 'G',
    FOLDER_ID: folderId,
    TARGET_FOLDER_ID: targetParentFolderId,
  })
}

async renameFolder(folderId: number, newName: string): Promise<void> {
  await this.callWhApi({
    MESSAGE_TYPE: 'FOLDER',
    PROCESS_TYPE: 'RENAME',
    REQUEST_SHARED: 'G',
    FOLDER_ID: folderId,
    FOLDER_NAME: newName,
  })
}
```

**Step 3: 탐색 스크립트로 각 메서드 검증**

```bash
npx tsx scripts/explore-lguplus-api.ts --test=folder   # createFolder 테스트
npx tsx scripts/explore-lguplus-api.ts --test=delete    # deleteFile 테스트
npx tsx scripts/explore-lguplus-api.ts --test=upload    # uploadFile 테스트
```

**Step 4: 탐색용 임시 메서드 제거**

`callWhApiPublic`, `fetchPublic` 제거.

**Step 5: typecheck 확인**

Run: `npm run typecheck`
Expected: PASS

**Step 6: 커밋**

```bash
git add src/core/lguplus-client.ts src/core/types/lguplus-client.types.ts
git commit -m "feat: add write operations to LGUplusClient (upload, delete, move, rename)"
```

---

### Task 4: 통합 테스트 공통 셋업

**Files:**
- Create: `tests/integration/setup.ts`

**Step 1: 공통 셋업 모듈 작성**

```typescript
// tests/integration/setup.ts
import { Logger } from '../../src/core/logger'
import { RetryManager } from '../../src/core/retry-manager'
import { ConfigManager } from '../../src/core/config-manager'
import { StateManager } from '../../src/core/state-manager'
import { EventBus } from '../../src/core/event-bus'
import { FileDetector } from '../../src/core/file-detector'
import { LGUplusClient } from '../../src/core/lguplus-client'
import type { DetectedFile, DetectionStrategy } from '../../src/core/types/events.types'

export interface IntegrationContext {
  config: ConfigManager
  logger: Logger
  retry: RetryManager
  client: LGUplusClient
  state: StateManager
  eventBus: EventBus
  testFolderId: number
}

const LGUPLUS_BASE_URL = 'https://only.webhard.co.kr'

/**
 * 통합 테스트 공통 초기화
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

  let testFolderId: number | null = null

  // 1차: 루트 직하위에서 찾기
  const rootFolders = await client.getSubFolders(rootId)
  const direct = rootFolders.find(f => f.folderName === '테스트동기화')
  if (direct) {
    testFolderId = direct.folderId
  } else {
    // 2차: 각 하위 폴더에서 찾기
    for (const folder of rootFolders) {
      const children = await client.getSubFolders(folder.folderId)
      const found = children.find(f => f.folderName === '테스트동기화')
      if (found) {
        testFolderId = found.folderId
        break
      }
    }
  }

  if (!testFolderId) throw new Error('테스트동기화 folder not found in guest folders')

  // In-memory state
  const state = new StateManager(':memory:', logger)
  state.initialize()

  const eventBus = new EventBus()

  return { config, logger, retry, client, state, eventBus, testFolderId }
}

/**
 * 테스트 폴더 정리 — 테스트에서 생성한 파일/폴더 삭제
 */
export async function cleanupTestFolder(
  client: LGUplusClient,
  folderId: number,
  createdItemIds: number[],
  createdFolderIds: number[],
): Promise<void> {
  // 파일 삭제 (역순)
  for (const itemId of createdItemIds.reverse()) {
    try {
      await client.deleteFile(itemId)
    } catch {
      // 이미 삭제된 경우 무시
    }
  }

  // 폴더 삭제 (역순 — 하위 폴더 먼저)
  for (const fid of createdFolderIds.reverse()) {
    try {
      await client.deleteFolder(fid)
    } catch {
      // 이미 삭제된 경우 무시
    }
  }
}

/**
 * FileDetector 생성 (폴링 전략, 지정 간격)
 */
export function createDetector(
  ctx: IntegrationContext,
  pollingIntervalMs: number = 3000,
): FileDetector {
  return new FileDetector(ctx.client, ctx.state, ctx.eventBus, ctx.logger, {
    pollingIntervalMs,
    strategy: 'polling',
  })
}

/**
 * 감지 대기 — 특정 조건을 만족하는 DetectedFile이 나올 때까지 폴링
 */
export function waitForDetection(
  detector: FileDetector,
  predicate: (file: DetectedFile) => boolean,
  timeoutMs: number = 30_000,
): Promise<{ file: DetectedFile; detectedAt: number }> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()

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
 * 일정 시간 대기 (API 반영 지연용)
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
```

**Step 2: 커밋**

```bash
git add tests/integration/setup.ts
git commit -m "feat: add integration test setup with shared context and helpers"
```

---

### Task 5: 파일 조작 감지 통합 테스트

**Files:**
- Create: `tests/integration/file-operations.test.ts`

**Step 1: 테스트 파일 작성**

```typescript
// tests/integration/file-operations.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  setupIntegration,
  cleanupTestFolder,
  createDetector,
  waitForDetection,
  delay,
  type IntegrationContext,
} from './setup'
import { FileDetector } from '../../src/core/file-detector'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('파일 조작 감지 통합 테스트', () => {
  let ctx: IntegrationContext
  let detector: FileDetector
  const createdItemIds: number[] = []
  const createdFolderIds: number[] = []

  beforeAll(async () => {
    ctx = await setupIntegration()

    // FileDetector baseline 설정 (현재 이력을 기준점으로)
    detector = createDetector(ctx, 3000)
    await detector.forceCheck() // baseline 설정
  }, 60_000)

  afterAll(async () => {
    detector.stop()
    await cleanupTestFolder(ctx.client, ctx.testFolderId, createdItemIds, createdFolderIds)
    await ctx.client.logout()
    ctx.state.close()
  }, 30_000)

  it('파일 업로드 감지 (UP)', async () => {
    // 1. 테스트 파일 생성
    const tempDir = join(tmpdir(), `integration-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
    const testFilePath = join(tempDir, `test-upload-${Date.now()}.txt`)
    await writeFile(testFilePath, `Integration test file created at ${new Date().toISOString()}`)

    // 2. 업로드
    const t0 = Date.now()
    const uploadResult = await ctx.client.uploadFile(ctx.testFolderId, testFilePath)
    createdItemIds.push(uploadResult.itemId)

    // 3. 감지 대기
    detector.start()
    const { file, detectedAt } = await waitForDetection(
      detector,
      (f) => f.operCode === 'UP' && f.fileName.includes('test-upload'),
      30_000,
    )
    detector.stop()

    // 4. 검증
    expect(file.operCode).toBe('UP')
    expect(file.fileName).toContain('test-upload')
    console.log(`[UP] 감지 지연: ${detectedAt - t0}ms`)
  }, 60_000)

  it('파일 삭제 감지 (D)', async () => {
    // 1. 파일 업로드 (삭제 대상)
    const tempDir = join(tmpdir(), `integration-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
    const testFilePath = join(tempDir, `test-delete-${Date.now()}.txt`)
    await writeFile(testFilePath, 'File to be deleted')

    const uploadResult = await ctx.client.uploadFile(ctx.testFolderId, testFilePath)
    await delay(3000) // API 반영 대기

    // 2. baseline 재설정 (업로드 이벤트 소비)
    await detector.forceCheck()

    // 3. 파일 삭제
    const t0 = Date.now()
    await ctx.client.deleteFile(uploadResult.itemId)
    // createdItemIds에서 제거 (이미 삭제됨)
    const idx = createdItemIds.indexOf(uploadResult.itemId)
    if (idx !== -1) createdItemIds.splice(idx, 1)

    // 4. 감지 대기
    detector.start()
    const { file, detectedAt } = await waitForDetection(
      detector,
      (f) => f.operCode === 'D',
      30_000,
    )
    detector.stop()

    // 5. 검증
    expect(file.operCode).toBe('D')
    console.log(`[D] 감지 지연: ${detectedAt - t0}ms`)
  }, 90_000)

  it('파일 이동 감지 (MV)', async () => {
    // 1. 이동 대상 폴더 생성
    const subFolder = await ctx.client.createFolder(ctx.testFolderId, `mv-target-${Date.now()}`)
    createdFolderIds.push(subFolder.folderId)

    // 2. 파일 업로드
    const tempDir = join(tmpdir(), `integration-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
    const testFilePath = join(tempDir, `test-move-${Date.now()}.txt`)
    await writeFile(testFilePath, 'File to be moved')

    const uploadResult = await ctx.client.uploadFile(ctx.testFolderId, testFilePath)
    createdItemIds.push(uploadResult.itemId)
    await delay(3000)

    // 3. baseline 재설정
    await detector.forceCheck()

    // 4. 파일 이동
    const t0 = Date.now()
    await ctx.client.moveFile(uploadResult.itemId, subFolder.folderId)

    // 5. 감지 대기
    detector.start()
    const { file, detectedAt } = await waitForDetection(
      detector,
      (f) => f.operCode === 'MV',
      30_000,
    )
    detector.stop()

    // 6. 검증
    expect(file.operCode).toBe('MV')
    console.log(`[MV] 감지 지연: ${detectedAt - t0}ms`)
  }, 90_000)

  it('파일 이름변경 감지 (RN)', async () => {
    // 1. 파일 업로드
    const tempDir = join(tmpdir(), `integration-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
    const testFilePath = join(tempDir, `test-rename-${Date.now()}.txt`)
    await writeFile(testFilePath, 'File to be renamed')

    const uploadResult = await ctx.client.uploadFile(ctx.testFolderId, testFilePath)
    createdItemIds.push(uploadResult.itemId)
    await delay(3000)

    // 2. baseline 재설정
    await detector.forceCheck()

    // 3. 이름변경
    const newName = `renamed-${Date.now()}`
    const t0 = Date.now()
    await ctx.client.renameFile(uploadResult.itemId, newName)

    // 4. 감지 대기
    detector.start()
    const { file, detectedAt } = await waitForDetection(
      detector,
      (f) => f.operCode === 'RN',
      30_000,
    )
    detector.stop()

    // 5. 검증
    expect(file.operCode).toBe('RN')
    console.log(`[RN] 감지 지연: ${detectedAt - t0}ms`)
  }, 90_000)
})
```

**Step 2: 실행 확인**

Run: `npm run test:integration -- tests/integration/file-operations.test.ts`
Expected: 4개 테스트 모두 PASS (API 역분석 완료 후)

**Step 3: 커밋**

```bash
git add tests/integration/file-operations.test.ts
git commit -m "test: add file operations detection integration tests"
```

---

### Task 6: 폴더 조작 감지 통합 테스트

**Files:**
- Create: `tests/integration/folder-operations.test.ts`

**Step 1: 테스트 파일 작성**

```typescript
// tests/integration/folder-operations.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  setupIntegration,
  cleanupTestFolder,
  createDetector,
  waitForDetection,
  delay,
  type IntegrationContext,
} from './setup'
import { FileDetector } from '../../src/core/file-detector'

describe('폴더 조작 감지 통합 테스트', () => {
  let ctx: IntegrationContext
  let detector: FileDetector
  const createdFolderIds: number[] = []

  beforeAll(async () => {
    ctx = await setupIntegration()
    detector = createDetector(ctx, 3000)
    await detector.forceCheck() // baseline
  }, 60_000)

  afterAll(async () => {
    detector.stop()
    await cleanupTestFolder(ctx.client, ctx.testFolderId, [], createdFolderIds)
    await ctx.client.logout()
    ctx.state.close()
  }, 30_000)

  it('폴더 생성 감지 (FC)', async () => {
    const folderName = `test-folder-${Date.now()}`

    const t0 = Date.now()
    const result = await ctx.client.createFolder(ctx.testFolderId, folderName)
    createdFolderIds.push(result.folderId)

    detector.start()
    const { file, detectedAt } = await waitForDetection(
      detector,
      (f) => f.operCode === 'FC' && f.fileName.includes('test-folder'),
      30_000,
    )
    detector.stop()

    expect(file.operCode).toBe('FC')
    console.log(`[FC] 감지 지연: ${detectedAt - t0}ms`)
  }, 60_000)

  it('폴더 삭제 감지 (FD)', async () => {
    const folderName = `test-folder-del-${Date.now()}`
    const result = await ctx.client.createFolder(ctx.testFolderId, folderName)
    await delay(3000)
    await detector.forceCheck()

    const t0 = Date.now()
    await ctx.client.deleteFolder(result.folderId)

    detector.start()
    const { file, detectedAt } = await waitForDetection(
      detector,
      (f) => f.operCode === 'FD',
      30_000,
    )
    detector.stop()

    expect(file.operCode).toBe('FD')
    console.log(`[FD] 감지 지연: ${detectedAt - t0}ms`)
  }, 90_000)

  it('폴더 이동 감지 (FMV)', async () => {
    // 이동 대상 부모 폴더 생성
    const parentFolder = await ctx.client.createFolder(ctx.testFolderId, `fmv-parent-${Date.now()}`)
    createdFolderIds.push(parentFolder.folderId)

    // 이동할 폴더 생성
    const targetFolder = await ctx.client.createFolder(ctx.testFolderId, `fmv-child-${Date.now()}`)
    createdFolderIds.push(targetFolder.folderId)
    await delay(3000)
    await detector.forceCheck()

    const t0 = Date.now()
    await ctx.client.moveFolder(targetFolder.folderId, parentFolder.folderId)

    detector.start()
    const { file, detectedAt } = await waitForDetection(
      detector,
      (f) => f.operCode === 'FMV',
      30_000,
    )
    detector.stop()

    expect(file.operCode).toBe('FMV')
    console.log(`[FMV] 감지 지연: ${detectedAt - t0}ms`)
  }, 90_000)

  it('폴더 이름변경 감지 (FRN)', async () => {
    const folderName = `test-folder-rn-${Date.now()}`
    const result = await ctx.client.createFolder(ctx.testFolderId, folderName)
    createdFolderIds.push(result.folderId)
    await delay(3000)
    await detector.forceCheck()

    const newName = `renamed-folder-${Date.now()}`
    const t0 = Date.now()
    await ctx.client.renameFolder(result.folderId, newName)

    detector.start()
    const { file, detectedAt } = await waitForDetection(
      detector,
      (f) => f.operCode === 'FRN',
      30_000,
    )
    detector.stop()

    expect(file.operCode).toBe('FRN')
    console.log(`[FRN] 감지 지연: ${detectedAt - t0}ms`)
  }, 90_000)
})
```

**Step 2: 실행 확인**

Run: `npm run test:integration -- tests/integration/folder-operations.test.ts`
Expected: 4개 테스트 모두 PASS

**Step 3: 커밋**

```bash
git add tests/integration/folder-operations.test.ts
git commit -m "test: add folder operations detection integration tests"
```

---

### Task 7: 감지 속도 측정 테스트

**Files:**
- Create: `tests/integration/detection-speed.test.ts`

**Step 1: 테스트 파일 작성**

```typescript
// tests/integration/detection-speed.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  setupIntegration,
  cleanupTestFolder,
  createDetector,
  waitForDetection,
  delay,
  type IntegrationContext,
} from './setup'
import { FileDetector } from '../../src/core/file-detector'
import { StateManager } from '../../src/core/state-manager'
import { EventBus } from '../../src/core/event-bus'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

interface SpeedResult {
  intervalMs: number
  measurements: number[]
  avgMs: number
  minMs: number
  maxMs: number
  apiErrors: number
}

describe('감지 속도 측정', () => {
  let ctx: IntegrationContext
  const createdItemIds: number[] = []
  const results: SpeedResult[] = []

  beforeAll(async () => {
    ctx = await setupIntegration()
  }, 60_000)

  afterAll(async () => {
    await cleanupTestFolder(ctx.client, ctx.testFolderId, createdItemIds, [])
    await ctx.client.logout()
    ctx.state.close()

    // 결과 테이블 출력
    console.log('\n┌──────────┬──────────┬──────────┬──────────┬────────────┐')
    console.log('│ 간격(ms) │ 최소(ms) │ 평균(ms) │ 최대(ms) │ API 에러   │')
    console.log('├──────────┼──────────┼──────────┼──────────┼────────────┤')
    for (const r of results) {
      console.log(
        `│ ${String(r.intervalMs).padStart(8)} │ ${String(r.minMs).padStart(8)} │ ${String(r.avgMs).padStart(8)} │ ${String(r.maxMs).padStart(8)} │ ${String(r.apiErrors).padStart(10)} │`,
      )
    }
    console.log('└──────────┴──────────┴──────────┴──────────┴────────────┘')

    // 최적 간격 판정
    const stable = results.filter(r => r.apiErrors === 0)
    if (stable.length > 0) {
      const best = stable.reduce((a, b) => a.intervalMs < b.intervalMs ? a : b)
      console.log(`\n최적 폴링 간격: ${best.intervalMs}ms (평균 감지 지연: ${best.avgMs}ms)`)
    }
  }, 30_000)

  async function measureDetectionSpeed(
    intervalMs: number,
    iterations: number,
  ): Promise<SpeedResult> {
    const measurements: number[] = []
    let apiErrors = 0

    for (let i = 0; i < iterations; i++) {
      // 새로운 StateManager + EventBus (각 측정마다 초기화)
      const state = new StateManager(':memory:', ctx.logger)
      state.initialize()
      const eventBus = new EventBus()

      const detector = new FileDetector(ctx.client, state, eventBus, ctx.logger, {
        pollingIntervalMs: intervalMs,
        strategy: 'polling',
      })

      try {
        // Baseline 설정
        await detector.forceCheck()

        // 테스트 파일 생성 및 업로드
        const tempDir = join(tmpdir(), `speed-test-${Date.now()}`)
        await mkdir(tempDir, { recursive: true })
        const testFilePath = join(tempDir, `speed-${intervalMs}-${i}-${Date.now()}.txt`)
        await writeFile(testFilePath, `Speed test: interval=${intervalMs}ms, iteration=${i}`)

        const t0 = Date.now()
        const uploadResult = await ctx.client.uploadFile(ctx.testFolderId, testFilePath)
        createdItemIds.push(uploadResult.itemId)

        // 감지 대기
        detector.start()
        const { detectedAt } = await waitForDetection(
          detector,
          (f) => f.operCode === 'UP' && f.fileName.includes(`speed-${intervalMs}-${i}`),
          30_000,
        )
        detector.stop()

        const latency = detectedAt - t0
        measurements.push(latency)
        console.log(`  [${intervalMs}ms] iteration ${i + 1}: ${latency}ms`)
      } catch (error) {
        apiErrors++
        console.log(`  [${intervalMs}ms] iteration ${i + 1}: ERROR - ${(error as Error).message}`)
      } finally {
        detector.stop()
        state.close()
      }

      // 각 반복 사이 대기 (API 부하 방지)
      if (i < iterations - 1) {
        await delay(3000)
      }
    }

    const result: SpeedResult = {
      intervalMs,
      measurements,
      avgMs: measurements.length > 0 ? Math.round(measurements.reduce((a, b) => a + b, 0) / measurements.length) : 0,
      minMs: measurements.length > 0 ? Math.min(...measurements) : 0,
      maxMs: measurements.length > 0 ? Math.max(...measurements) : 0,
      apiErrors,
    }

    return result
  }

  it('폴링 간격 5초 — 감지 속도 측정', async () => {
    const result = await measureDetectionSpeed(5000, 3)
    results.push(result)
    expect(result.apiErrors).toBe(0)
  }, 300_000)

  it('폴링 간격 3초 — 감지 속도 측정', async () => {
    await delay(10_000) // 쿨다운
    const result = await measureDetectionSpeed(3000, 3)
    results.push(result)
    expect(result.apiErrors).toBe(0)
  }, 300_000)

  it('폴링 간격 2초 — 감지 속도 측정', async () => {
    await delay(10_000) // 쿨다운
    const result = await measureDetectionSpeed(2000, 3)
    results.push(result)
    expect(result.apiErrors).toBe(0)
  }, 300_000)

  it('폴링 간격 1초 — 감지 속도 측정 (API 제한 확인)', async () => {
    await delay(10_000) // 쿨다운
    const result = await measureDetectionSpeed(1000, 3)
    results.push(result)
    // 1초 간격은 에러가 발생할 수 있음 — 에러 유무만 기록
    console.log(`  1초 간격 API 에러: ${result.apiErrors}/${3}`)
  }, 300_000)
}, { timeout: 600_000 })
```

**Step 2: 실행 확인**

Run: `npm run test:integration -- tests/integration/detection-speed.test.ts`
Expected: 결과 테이블 출력, 최적 간격 판정

**Step 3: 커밋**

```bash
git add tests/integration/detection-speed.test.ts
git commit -m "test: add detection speed measurement integration tests"
```

---

### Task 8: 로컬 디렉토리 동기화 검증 테스트

**Files:**
- Create: `tests/integration/local-sync.test.ts`

**Step 1: 테스트 파일 작성**

```typescript
// tests/integration/local-sync.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  setupIntegration,
  cleanupTestFolder,
  delay,
  type IntegrationContext,
} from './setup'
import { existsSync, statSync } from 'node:fs'
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

const LOCAL_SYNC_BASE = 'C:\\Users\\jaehy\\AppData\\Roaming\\webhard-sync\\downloads'

describe('로컬 디렉토리 동기화 검증', () => {
  let ctx: IntegrationContext
  const createdItemIds: number[] = []
  const createdFolderIds: number[] = []
  const localCleanupPaths: string[] = []

  beforeAll(async () => {
    ctx = await setupIntegration()
    await mkdir(LOCAL_SYNC_BASE, { recursive: true })
  }, 60_000)

  afterAll(async () => {
    // 웹하드 정리
    await cleanupTestFolder(ctx.client, ctx.testFolderId, createdItemIds, createdFolderIds)
    await ctx.client.logout()
    ctx.state.close()

    // 로컬 정리
    for (const p of localCleanupPaths.reverse()) {
      try {
        await rm(p, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  }, 30_000)

  it('단일 파일 동기화 — 다운로드 및 경로 검증', async () => {
    // 1. 테스트 파일 생성 및 업로드
    const content = `Single file sync test: ${new Date().toISOString()}`
    const tempDir = join(tmpdir(), `sync-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
    const fileName = `sync-single-${Date.now()}.txt`
    const testFilePath = join(tempDir, fileName)
    await writeFile(testFilePath, content)

    const originalHash = createHash('md5').update(content).digest('hex')

    const uploadResult = await ctx.client.uploadFile(ctx.testFolderId, testFilePath)
    createdItemIds.push(uploadResult.itemId)

    // 2. 다운로드
    const localPath = join(LOCAL_SYNC_BASE, '테스트동기화', fileName)
    localCleanupPaths.push(join(LOCAL_SYNC_BASE, '테스트동기화'))

    await ctx.client.downloadFile(uploadResult.itemId, localPath)

    // 3. 검증
    expect(existsSync(localPath)).toBe(true)

    const stat = statSync(localPath)
    expect(stat.size).toBe(Buffer.byteLength(content))

    const downloadedContent = await readFile(localPath, 'utf-8')
    const downloadedHash = createHash('md5').update(downloadedContent).digest('hex')
    expect(downloadedHash).toBe(originalHash)
  }, 60_000)

  it('하위 폴더 구조 동기화 — 중첩 경로 검증', async () => {
    // 1. 하위 폴더 생성
    const subFolderName = `sub-${Date.now()}`
    const subFolder = await ctx.client.createFolder(ctx.testFolderId, subFolderName)
    createdFolderIds.push(subFolder.folderId)
    await delay(2000)

    // 2. 하위 폴더에 파일 업로드
    const content = `Nested file sync test: ${new Date().toISOString()}`
    const tempDir = join(tmpdir(), `sync-nested-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
    const fileName = `nested-file-${Date.now()}.txt`
    const testFilePath = join(tempDir, fileName)
    await writeFile(testFilePath, content)

    const uploadResult = await ctx.client.uploadFile(subFolder.folderId, testFilePath)
    createdItemIds.push(uploadResult.itemId)

    // 3. 다운로드 (중첩 경로)
    const localPath = join(LOCAL_SYNC_BASE, '테스트동기화', subFolderName, fileName)
    localCleanupPaths.push(join(LOCAL_SYNC_BASE, '테스트동기화', subFolderName))

    await ctx.client.downloadFile(uploadResult.itemId, localPath)

    // 4. 검증
    expect(existsSync(localPath)).toBe(true)

    const stat = statSync(localPath)
    expect(stat.size).toBe(Buffer.byteLength(content))
  }, 60_000)

  it('다중 파일 동시 동기화 — 누락 없이 전체 검증', async () => {
    const fileCount = 3
    const files: Array<{ name: string; content: string; itemId: number }> = []

    // 1. 3개 파일 업로드
    for (let i = 0; i < fileCount; i++) {
      const content = `Multi sync test ${i}: ${new Date().toISOString()}`
      const tempDir = join(tmpdir(), `sync-multi-${Date.now()}-${i}`)
      await mkdir(tempDir, { recursive: true })
      const fileName = `multi-${i}-${Date.now()}.txt`
      const testFilePath = join(tempDir, fileName)
      await writeFile(testFilePath, content)

      const uploadResult = await ctx.client.uploadFile(ctx.testFolderId, testFilePath)
      createdItemIds.push(uploadResult.itemId)
      files.push({ name: fileName, content, itemId: uploadResult.itemId })
    }

    // 2. 모두 다운로드
    const downloadPromises = files.map((f) => {
      const localPath = join(LOCAL_SYNC_BASE, '테스트동기화', f.name)
      return ctx.client.downloadFile(f.itemId, localPath)
    })

    await Promise.all(downloadPromises)

    // 3. 검증 — 3개 모두 존재
    for (const f of files) {
      const localPath = join(LOCAL_SYNC_BASE, '테스트동기화', f.name)
      expect(existsSync(localPath)).toBe(true)

      const stat = statSync(localPath)
      expect(stat.size).toBe(Buffer.byteLength(f.content))
    }
  }, 90_000)

  it('한글/특수문자 파일명 — 인코딩 검증', async () => {
    const content = `한글 파일 테스트: ${new Date().toISOString()}`
    const tempDir = join(tmpdir(), `sync-korean-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
    const fileName = `도면_수정본(최종)-${Date.now()}.txt`
    const testFilePath = join(tempDir, fileName)
    await writeFile(testFilePath, content)

    const uploadResult = await ctx.client.uploadFile(ctx.testFolderId, testFilePath)
    createdItemIds.push(uploadResult.itemId)

    // 다운로드
    const localPath = join(LOCAL_SYNC_BASE, '테스트동기화', fileName)
    await ctx.client.downloadFile(uploadResult.itemId, localPath)

    // 검증
    expect(existsSync(localPath)).toBe(true)

    const downloadedContent = await readFile(localPath, 'utf-8')
    const originalHash = createHash('md5').update(content).digest('hex')
    const downloadedHash = createHash('md5').update(downloadedContent).digest('hex')
    expect(downloadedHash).toBe(originalHash)
  }, 60_000)
})
```

**Step 2: 실행 확인**

Run: `npm run test:integration -- tests/integration/local-sync.test.ts`
Expected: 4개 테스트 모두 PASS

**Step 3: 커밋**

```bash
git add tests/integration/local-sync.test.ts
git commit -m "test: add local directory sync verification integration tests"
```

---

### Task 9: 탐색 스크립트 정리 및 최종 검증

**Files:**
- Remove or archive: `scripts/explore-lguplus-api.ts` (역분석 완료 후)
- Modify: `src/core/lguplus-client.ts` (임시 메서드 제거)

**Step 1: 임시 탐색 메서드 제거**

`callWhApiPublic`, `fetchPublic` 메서드를 `src/core/lguplus-client.ts`에서 제거.

**Step 2: typecheck + lint 확인**

Run: `npm run typecheck && npm run lint`
Expected: PASS

**Step 3: 전체 단위 테스트 확인**

Run: `npm run test -- --run`
Expected: 기존 단위 테스트 모두 PASS (integration 폴더는 제외)

**Step 4: 전체 통합 테스트 실행**

Run: `npm run test:integration`
Expected: 모든 통합 테스트 PASS, 감지 속도 테이블 출력

**Step 5: 커밋**

```bash
git add -A
git commit -m "chore: clean up exploration scripts, finalize integration tests"
```

---

### Task 10: 작업 문서 작성

**Files:**
- Create: `docs/work-logs/016-detection-통합테스트.md`

**Step 1: 작업 문서 작성**

위 설계/구현 내용과 감지 속도 측정 결과를 포함한 작업 문서 작성.

**Step 2: 커밋**

```bash
git add docs/work-logs/016-detection-통합테스트.md
git commit -m "docs: add detection integration test work log"
```

---

## 주의사항

### API 역분석 (Task 2-3)은 수동 개입 필요

- LGU+ 웹하드는 비공개 API이므로 브라우저 DevTools에서 실제 요청을 캡처해야 정확한 파라미터를 알 수 있음
- Task 3의 `callWhApi` 파라미터(MESSAGE_TYPE, PROCESS_TYPE 등)는 **예상 패턴**이며, 실제와 다를 수 있음
- 파일 업로드는 `/wh` 가 아닌 별도 엔드포인트(예: multipart upload)를 사용할 가능성 높음

### 테스트 실행 환경

- 실제 LGU+ 웹하드에 연결되므로 **인터넷 연결** 필수
- `ConfigManager`에서 LGU+ 자격증명이 설정되어 있어야 함
- 테스트 폴더 `게스트폴더 > 테스트동기화`가 존재해야 함
- 테스트 실행 시간: 파일/폴더 테스트 약 5분, 속도 측정 약 7분, 동기화 약 3분

### 테스트 격리

- 각 테스트는 고유한 타임스탬프를 파일명에 포함하여 충돌 방지
- `afterAll`에서 생성한 파일/폴더 정리
- in-memory SQLite로 DB 격리
