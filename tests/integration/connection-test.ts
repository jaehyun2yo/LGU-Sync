/**
 * 외부웹하드 동기화 프로그램 - 통합 테스트
 *
 * Usage:
 * 자체 웹하드는 기본적으로 로컬 dev 서버(localhost:3000)에 연결합니다.
 * Next.js dev 서버를 먼저 실행하세요: cd yjlaser_website && npm run dev
 *
 * Usage:
 *   npx tsx tests/integration/connection-test.ts              # 전체 실행 (dev 서버)
 *   npx tsx tests/integration/connection-test.ts --phase=1    # Phase 1만
 *   npx tsx tests/integration/connection-test.ts --phase=1,2  # Phase 1,2만
 *   npx tsx tests/integration/connection-test.ts --monitor=60 # Phase 5 감시 60초
 *   npx tsx tests/integration/connection-test.ts --verbose    # 상세 로그
 *   npx tsx tests/integration/connection-test.ts --prod       # 프로덕션 연결
 *   npx tsx tests/integration/connection-test.ts --webhard-url=http://localhost:3000
 */

import { Logger } from '../../src/core/logger'
import { RetryManager } from '../../src/core/retry-manager'
import { ConfigManager, DEFAULT_CONFIG } from '../../src/core/config-manager'
import { StateManager } from '../../src/core/state-manager'
import { EventBus } from '../../src/core/event-bus'
import { FileDetector } from '../../src/core/file-detector'
import { LGUplusClient } from '../../src/core/lguplus-client'
import { YjlaserUploader } from '../../src/core/webhard-uploader/yjlaser-uploader'
import type { LGUplusFileItem } from '../../src/core/types/lguplus-client.types'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ══════════════════════════════════════════════════════════════
// CLI Argument Parsing
// ══════════════════════════════════════════════════════════════

interface CliArgs {
  phases: number[] | null // null = all phases
  monitorSeconds: number
  verbose: boolean
  webhardUrl: string // self-webhard API URL
}

const DEFAULT_DEV_WEBHARD_URL = 'http://localhost:3000'

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  let phases: number[] | null = null
  let monitorSeconds = 30
  let verbose = false
  let webhardUrl = DEFAULT_DEV_WEBHARD_URL

  for (const arg of args) {
    if (arg.startsWith('--phase=')) {
      phases = arg
        .replace('--phase=', '')
        .split(',')
        .map((n) => parseInt(n.trim(), 10))
        .filter((n) => !isNaN(n))
    } else if (arg.startsWith('--monitor=')) {
      monitorSeconds = parseInt(arg.replace('--monitor=', ''), 10) || 30
    } else if (arg === '--verbose') {
      verbose = true
    } else if (arg === '--prod') {
      webhardUrl = 'https://www.yjlaser.net'
    } else if (arg.startsWith('--webhard-url=')) {
      webhardUrl = arg.replace('--webhard-url=', '')
    }
  }

  return { phases, monitorSeconds, verbose, webhardUrl }
}

// ══════════════════════════════════════════════════════════════
// Output Helpers
// ══════════════════════════════════════════════════════════════

type TestStatus = 'PASS' | 'FAIL' | 'WARN' | 'SKIP' | 'INFO'

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  white: '\x1b[37m',
}

function statusColor(status: TestStatus): string {
  switch (status) {
    case 'PASS':
      return COLORS.green
    case 'FAIL':
      return COLORS.red
    case 'WARN':
      return COLORS.yellow
    case 'SKIP':
      return COLORS.dim
    case 'INFO':
      return COLORS.cyan
  }
}

function printHeader(): void {
  const now = new Date().toISOString()
  console.log('')
  console.log('======================================================')
  console.log('  외부웹하드 동기화 프로그램 - 통합 테스트')
  console.log(`  ${now}`)
  console.log('======================================================')
  console.log('')
}

function printPhaseHeader(phase: number, title: string): void {
  console.log(`── Phase ${phase}: ${title} ${'─'.repeat(Math.max(0, 45 - title.length))}`)
  console.log('')
}

function printResult(step: string, status: TestStatus, detail: string, extra?: string): void {
  const color = statusColor(status)
  console.log(`  ${color}[${status}]${COLORS.reset} ${step}`)
  console.log(`         ${COLORS.dim}${detail}${COLORS.reset}`)
  if (extra) {
    console.log(`         ${COLORS.dim}${extra}${COLORS.reset}`)
  }
}

function printPhaseResult(phase: number, status: TestStatus, durationMs: number): void {
  const color = statusColor(status)
  console.log('')
  console.log(`  ${color}Phase ${phase}: ${status}${COLORS.reset} (${durationMs}ms)`)
  console.log('')
}

function printSummary(results: Map<number, { status: TestStatus; title: string }>, totalMs: number): void {
  console.log('======================================================')
  console.log('  최종 결과 요약')
  console.log('======================================================')

  for (const [phase, { status, title }] of results) {
    const color = statusColor(status)
    console.log(`  Phase ${phase}: ${color}${status}${COLORS.reset}  <- ${title}`)
  }

  const allPass = [...results.values()].every(
    (r) => r.status === 'PASS' || r.status === 'SKIP',
  )
  const overallStatus = allPass ? 'PASS' : 'FAIL'
  const overallColor = statusColor(overallStatus)

  console.log('')
  console.log(`  ${overallColor}${COLORS.bold}전체 결과: ${overallStatus}${COLORS.reset} (${totalMs}ms)`)
  console.log('======================================================')
  console.log('')
}

function truncate(str: string, maxLen: number = 200): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '...'
}

// ══════════════════════════════════════════════════════════════
// Shared State (passed between phases)
// ══════════════════════════════════════════════════════════════

interface SharedContext {
  config: ConfigManager
  logger: Logger
  retry: RetryManager
  lguplus: LGUplusClient
  uploader: YjlaserUploader
  verbose: boolean
  webhardUrl: string

  // Phase 1 results
  lguplusConnected: boolean
  lguplusLoggedIn: boolean

  // Phase 2 results
  webhardConnected: boolean

  // Phase 3 results
  guestRootId: number | null
  targetFolders: Map<string, number> // name -> folderId

  // Phase 4 results
  fileList: LGUplusFileItem[]
}

/**
 * Suppress console noise from Logger in non-verbose mode.
 * Logger always writes to console (can't be disabled), so we
 * intercept console methods during test execution.
 */
function suppressConsoleNoise(verbose: boolean): void {
  if (verbose) return
  const noop = () => {}
  const origLog = console.log
  const origWarn = console.warn
  const origError = console.error

  // Replace console methods to filter out Logger noise (lines starting with [LEVEL])
  const loggerPattern = /^\[(DEBUG|INFO|WARN|ERROR)\]/
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && loggerPattern.test(args[0])) return
    origLog(...args)
  }
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && loggerPattern.test(args[0])) return
    origWarn(...args)
  }
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && loggerPattern.test(args[0])) return
    origError(...args)
  }
}

function createContext(verbose: boolean, webhardUrl: string): SharedContext {
  const config = new ConfigManager()
  const logger = new Logger({
    minLevel: verbose ? 'debug' : 'error',
  })
  const retry = new RetryManager(logger, {
    failureThreshold: 3,
    resetTimeoutMs: 5000,
  })

  const webhardConfig = config.get('webhard')

  const lguplus = new LGUplusClient('https://only.webhard.co.kr', logger, retry)
  const uploader = new YjlaserUploader(
    webhardUrl,
    webhardConfig.apiKey,
    logger,
    retry,
  )

  return {
    config,
    logger,
    retry,
    lguplus,
    uploader,
    verbose,
    webhardUrl,
    lguplusConnected: false,
    lguplusLoggedIn: false,
    webhardConnected: false,
    guestRootId: null,
    targetFolders: new Map(),
    fileList: [],
  }
}

// ══════════════════════════════════════════════════════════════
// Phase 1: LGU+ 연결 테스트
// ══════════════════════════════════════════════════════════════

async function phase1(ctx: SharedContext): Promise<TestStatus> {
  printPhaseHeader(1, 'LGU+ 연결 테스트')
  const start = Date.now()
  let overallStatus: TestStatus = 'PASS'

  // 1.1 서버 응답 확인
  try {
    const res = await fetch('https://only.webhard.co.kr', {
      signal: AbortSignal.timeout(10000),
    })
    ctx.lguplusConnected = true
    printResult(
      '1.1 서버 응답 확인',
      'PASS',
      `HTTP ${res.status} ${res.statusText}`,
      `Content-Type: ${res.headers.get('content-type') ?? 'N/A'}`,
    )
  } catch (err) {
    printResult('1.1 서버 응답 확인', 'FAIL', (err as Error).message)
    overallStatus = 'FAIL'
    printPhaseResult(1, overallStatus, Date.now() - start)
    return overallStatus
  }

  // 1.2 /login-process 엔드포인트 탐색 (빈 자격증명)
  try {
    const res = await fetch('https://only.webhard.co.kr/login-process', {
      method: 'POST',
      body: new URLSearchParams({ user_id: '', user_pw: '' }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10000),
    })

    const contentType = res.headers.get('content-type') ?? ''
    const bodyText = await res.text()
    const isJson = contentType.includes('application/json')

    if (isJson) {
      printResult(
        '1.2 /login-process 엔드포인트 탐색',
        'PASS',
        'JSON 응답 확인',
        `Content-Type: ${contentType}`,
      )
      if (ctx.verbose) {
        printResult('', 'INFO', `응답 본문: ${truncate(bodyText, 500)}`)
      }
    } else {
      printResult(
        '1.2 /login-process 엔드포인트 탐색',
        'WARN',
        `비-JSON 응답 (Content-Type: ${contentType})`,
        `HTTP ${res.status} | 본문 (처음 300자): ${truncate(bodyText, 300)}`,
      )
      // Try to parse as JSON anyway (some servers don't set content-type correctly)
      try {
        JSON.parse(bodyText)
        printResult('', 'INFO', 'JSON 파싱은 성공 (Content-Type 헤더만 잘못됨)')
      } catch {
        printResult(
          '',
          'WARN',
          'JSON 파싱 실패 - Playwright 기반 인증이 필요할 수 있음',
        )
      }
    }
  } catch (err) {
    printResult('1.2 /login-process 엔드포인트 탐색', 'FAIL', (err as Error).message)
    overallStatus = 'FAIL'
  }

  // 1.3 LGUplusClient.login() 실제 로그인 시도
  const lguplusConfig = ctx.config.get('lguplus')
  try {
    const result = await ctx.lguplus.login(lguplusConfig.username, lguplusConfig.password)
    if (result.success) {
      ctx.lguplusLoggedIn = true
      printResult('1.3 LGUplusClient.login() 테스트', 'PASS', '로그인 성공')
    } else {
      printResult(
        '1.3 LGUplusClient.login() 테스트',
        'FAIL',
        `로그인 실패: ${result.message ?? '알 수 없는 오류'}`,
      )
      overallStatus = 'FAIL'
    }
  } catch (err) {
    const errMsg = (err as Error).message
    printResult('1.3 LGUplusClient.login() 테스트', 'FAIL', `예외 발생: ${errMsg}`)
    if (ctx.verbose) {
      printResult('', 'INFO', `Stack: ${(err as Error).stack ?? 'N/A'}`)
    }
    overallStatus = 'FAIL'
  }

  // 1.4 validateSession() 세션 검증
  if (ctx.lguplusLoggedIn) {
    try {
      const valid = await ctx.lguplus.validateSession()
      if (valid) {
        printResult('1.4 validateSession() 세션 검증', 'PASS', '세션 유효')
      } else {
        printResult('1.4 validateSession() 세션 검증', 'WARN', '세션 무효 (로그인 직후인데 무효)')
      }
    } catch (err) {
      printResult('1.4 validateSession() 세션 검증', 'WARN', `예외: ${(err as Error).message}`)
    }
  } else {
    printResult('1.4 validateSession() 세션 검증', 'SKIP', '로그인 실패로 스킵')
  }

  // 1.5 /wh/guest-folder 엔드포인트 탐색
  try {
    const res = await fetch('https://only.webhard.co.kr/wh/guest-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10000),
    })

    const contentType = res.headers.get('content-type') ?? ''
    const bodyText = await res.text()
    const isJson = contentType.includes('application/json')

    if (isJson) {
      printResult(
        '1.5 /wh/guest-folder 엔드포인트 탐색',
        'PASS',
        `JSON 응답 (HTTP ${res.status})`,
        ctx.verbose ? `본문: ${truncate(bodyText, 300)}` : undefined,
      )
    } else {
      printResult(
        '1.5 /wh/guest-folder 엔드포인트 탐색',
        'WARN',
        `비-JSON 응답 (Content-Type: ${contentType}, HTTP ${res.status})`,
        `본문: ${truncate(bodyText, 300)}`,
      )
      try {
        JSON.parse(bodyText)
        printResult('', 'INFO', 'JSON 파싱은 성공')
      } catch {
        printResult('', 'WARN', 'JSON 파싱 실패')
      }
    }
  } catch (err) {
    printResult('1.5 /wh/guest-folder 엔드포인트 탐색', 'FAIL', (err as Error).message)
  }

  printPhaseResult(1, overallStatus, Date.now() - start)
  return overallStatus
}

// ══════════════════════════════════════════════════════════════
// Phase 2: 자체 웹하드 연결 테스트
// ══════════════════════════════════════════════════════════════

async function phase2(ctx: SharedContext): Promise<TestStatus> {
  printPhaseHeader(2, '자체 웹하드 연결 테스트')
  const start = Date.now()
  let overallStatus: TestStatus = 'PASS'

  const webhardConfig = ctx.config.get('webhard')

  // 2.1 서버 도달 확인
  try {
    const res = await fetch(`${ctx.webhardUrl}/api/health`, {
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) {
      const body = await res.text()
      printResult(
        '2.1 서버 도달 가능성 확인',
        'PASS',
        `HTTP ${res.status} from ${ctx.webhardUrl}`,
        ctx.verbose ? `본문: ${truncate(body, 200)}` : undefined,
      )
    } else {
      printResult(
        '2.1 서버 도달 가능성 확인',
        'FAIL',
        `HTTP ${res.status} ${res.statusText}`,
      )
      overallStatus = 'FAIL'
    }
  } catch (err) {
    printResult('2.1 서버 도달 가능성 확인', 'FAIL', (err as Error).message)
    overallStatus = 'FAIL'
    printPhaseResult(2, overallStatus, Date.now() - start)
    return overallStatus
  }

  // 2.2 testConnection()
  try {
    const result = await ctx.uploader.testConnection()
    if (result.success) {
      ctx.webhardConnected = true
      printResult(
        '2.2 YjlaserUploader.testConnection()',
        'PASS',
        `연결 성공 (${result.latencyMs}ms)`,
      )
    } else {
      printResult(
        '2.2 YjlaserUploader.testConnection()',
        'FAIL',
        `연결 실패: ${result.message}`,
      )
      overallStatus = 'FAIL'
    }
  } catch (err) {
    printResult('2.2 YjlaserUploader.testConnection()', 'FAIL', (err as Error).message)
    overallStatus = 'FAIL'
  }

  // 2.3 findFolder() API 키 인증 확인
  if (ctx.webhardConnected) {
    try {
      const result = await ctx.uploader.findFolder('__test_nonexistent__', null)
      if (result.success) {
        printResult(
          '2.3 findFolder() API 키 인증 확인',
          'PASS',
          `인증 성공 (폴더 존재: ${result.data !== null})`,
        )
      } else {
        printResult(
          '2.3 findFolder() API 키 인증 확인',
          'FAIL',
          `API 호출 실패: ${result.error}`,
        )
        overallStatus = 'FAIL'
      }
    } catch (err) {
      printResult('2.3 findFolder() API 키 인증 확인', 'FAIL', (err as Error).message)
      overallStatus = 'FAIL'
    }
  } else {
    printResult('2.3 findFolder() API 키 인증 확인', 'SKIP', '연결 실패로 스킵')
  }

  // 2.4 잘못된 API 키로 거부 확인
  try {
    const badUploader = new YjlaserUploader(
      ctx.webhardUrl,
      'invalid-api-key-12345',
      ctx.logger,
      ctx.retry,
    )
    const result = await badUploader.testConnection()
    if (!result.success) {
      printResult(
        '2.4 잘못된 API 키 거부 확인',
        'PASS',
        `거부됨: ${result.message}`,
      )
    } else {
      printResult(
        '2.4 잘못된 API 키 거부 확인',
        'WARN',
        'health 엔드포인트가 인증 없이 접근 가능 (정상일 수 있음)',
      )
      // Additional check: try an authenticated endpoint
      const folderResult = await badUploader.findFolder('test', null)
      if (!folderResult.success) {
        printResult(
          '',
          'PASS',
          `인증된 엔드포인트에서 거부 확인: ${folderResult.error}`,
        )
      } else {
        printResult('', 'FAIL', '잘못된 API 키로도 인증된 엔드포인트 접근 가능')
        overallStatus = 'FAIL'
      }
    }
  } catch (err) {
    // AuthWebhardKeyInvalidError is expected
    printResult(
      '2.4 잘못된 API 키 거부 확인',
      'PASS',
      `예외로 거부됨: ${(err as Error).message}`,
    )
  }

  printPhaseResult(2, overallStatus, Date.now() - start)
  return overallStatus
}

// ══════════════════════════════════════════════════════════════
// Phase 3: LGU+ 폴더 탐색
// ══════════════════════════════════════════════════════════════

async function phase3(ctx: SharedContext): Promise<TestStatus> {
  printPhaseHeader(3, 'LGU+ 폴더 탐색')
  const start = Date.now()

  if (!ctx.lguplusLoggedIn) {
    printResult('Phase 3', 'SKIP', 'Phase 1 로그인 실패로 전체 스킵')
    printPhaseResult(3, 'SKIP', Date.now() - start)
    return 'SKIP'
  }

  let overallStatus: TestStatus = 'PASS'

  // 3.1 getGuestFolderRootId()
  try {
    const rootId = await ctx.lguplus.getGuestFolderRootId()
    if (rootId !== null) {
      ctx.guestRootId = rootId
      printResult(
        '3.1 getGuestFolderRootId() 게스트 루트 ID',
        'PASS',
        `루트 폴더 ID: ${rootId}`,
      )
    } else {
      printResult(
        '3.1 getGuestFolderRootId() 게스트 루트 ID',
        'FAIL',
        '루트 폴더 ID가 null',
      )
      overallStatus = 'FAIL'
      printPhaseResult(3, overallStatus, Date.now() - start)
      return overallStatus
    }
  } catch (err) {
    printResult('3.1 getGuestFolderRootId()', 'FAIL', (err as Error).message)
    overallStatus = 'FAIL'
    printPhaseResult(3, overallStatus, Date.now() - start)
    return overallStatus
  }

  // 3.2 getSubFolders(rootId) 최상위 목록
  try {
    const folders = await ctx.lguplus.getSubFolders(ctx.guestRootId!)
    printResult(
      '3.2 getSubFolders() 최상위 목록',
      'PASS',
      `${folders.length}개 폴더 발견`,
    )
    if (ctx.verbose || folders.length <= 20) {
      for (const f of folders) {
        console.log(`         ${COLORS.dim}  - [${f.folderId}] ${f.folderName}${COLORS.reset}`)
      }
    }
  } catch (err) {
    printResult('3.2 getSubFolders() 최상위 목록', 'FAIL', (err as Error).message)
    overallStatus = 'FAIL'
  }

  // 3.3 findFolderByName(rootId, 'ㄱ 올리기전용')
  try {
    const uploadFolderId = await ctx.lguplus.findFolderByName(ctx.guestRootId!, 'ㄱ 올리기전용')
    if (uploadFolderId !== null) {
      ctx.targetFolders.set('ㄱ 올리기전용', uploadFolderId)
      printResult(
        '3.3 findFolderByName("ㄱ 올리기전용")',
        'PASS',
        `폴더 ID: ${uploadFolderId}`,
      )

      // 3.3a findFolderByName(올리기전용Id, '(주)신영피앤피')
      try {
        const sinyoungId = await ctx.lguplus.findFolderByName(uploadFolderId, '(주)신영피앤피')
        if (sinyoungId !== null) {
          ctx.targetFolders.set('(주)신영피앤피', sinyoungId)
          printResult(
            '3.3a findFolderByName("(주)신영피앤피")',
            'PASS',
            `폴더 ID: ${sinyoungId}`,
          )
        } else {
          printResult(
            '3.3a findFolderByName("(주)신영피앤피")',
            'WARN',
            '폴더를 찾을 수 없음',
          )
        }
      } catch (err) {
        printResult('3.3a findFolderByName("(주)신영피앤피")', 'FAIL', (err as Error).message)
      }
    } else {
      printResult(
        '3.3 findFolderByName("ㄱ 올리기전용")',
        'WARN',
        '폴더를 찾을 수 없음 - 폴더명이 다를 수 있음',
      )
    }
  } catch (err) {
    printResult('3.3 findFolderByName("ㄱ 올리기전용")', 'FAIL', (err as Error).message)
    overallStatus = 'FAIL'
  }

  // 3.4 findFolderByName(rootId, '대성목형(2265-1295)')
  try {
    const daeseongId = await ctx.lguplus.findFolderByName(ctx.guestRootId!, '대성목형(2265-1295)')
    if (daeseongId !== null) {
      ctx.targetFolders.set('대성목형(2265-1295)', daeseongId)
      printResult(
        '3.4 findFolderByName("대성목형(2265-1295)")',
        'PASS',
        `폴더 ID: ${daeseongId}`,
      )
    } else {
      printResult(
        '3.4 findFolderByName("대성목형(2265-1295)")',
        'WARN',
        '폴더를 찾을 수 없음',
      )
    }
  } catch (err) {
    printResult('3.4 findFolderByName("대성목형(2265-1295)")', 'FAIL', (err as Error).message)
    overallStatus = 'FAIL'
  }

  if (ctx.targetFolders.size === 0) {
    overallStatus = 'WARN'
  }

  printPhaseResult(3, overallStatus, Date.now() - start)
  return overallStatus
}

// ══════════════════════════════════════════════════════════════
// Phase 4: 파일 목록 조회
// ══════════════════════════════════════════════════════════════

async function phase4(ctx: SharedContext): Promise<TestStatus> {
  printPhaseHeader(4, '파일 목록 조회')
  const start = Date.now()

  if (!ctx.lguplusLoggedIn) {
    printResult('Phase 4', 'SKIP', 'Phase 1 로그인 실패로 전체 스킵')
    printPhaseResult(4, 'SKIP', Date.now() - start)
    return 'SKIP'
  }

  if (ctx.targetFolders.size === 0) {
    printResult('Phase 4', 'SKIP', 'Phase 3에서 대상 폴더를 찾지 못해 스킵')
    printPhaseResult(4, 'SKIP', Date.now() - start)
    return 'SKIP'
  }

  let overallStatus: TestStatus = 'PASS'

  // 4.1 각 대상 폴더의 getFileList() (1페이지)
  for (const [name, folderId] of ctx.targetFolders) {
    try {
      const result = await ctx.lguplus.getFileList(folderId, { page: 1 })
      printResult(
        `4.1 getFileList("${name}")`,
        'PASS',
        `전체 ${result.total}개 파일 (1페이지: ${result.items.length}개)`,
      )

      // Store files for Phase 6
      ctx.fileList.push(...result.items)

      if (result.items.length > 0) {
        const showCount = Math.min(result.items.length, ctx.verbose ? 20 : 5)
        for (let i = 0; i < showCount; i++) {
          const f = result.items[i]
          const size = f.itemSize > 1024 * 1024
            ? `${(f.itemSize / (1024 * 1024)).toFixed(1)}MB`
            : f.itemSize > 1024
              ? `${(f.itemSize / 1024).toFixed(1)}KB`
              : `${f.itemSize}B`
          console.log(
            `         ${COLORS.dim}  - [${f.itemId}] ${f.itemName} (${size})${COLORS.reset}`,
          )
        }
        if (result.items.length > showCount) {
          console.log(
            `         ${COLORS.dim}  ... 외 ${result.items.length - showCount}개${COLORS.reset}`,
          )
        }
      }
    } catch (err) {
      printResult(`4.1 getFileList("${name}")`, 'FAIL', (err as Error).message)
      overallStatus = 'FAIL'
    }
  }

  // 4.2 getUploadHistory()
  try {
    const history = await ctx.lguplus.getUploadHistory()
    printResult(
      '4.2 getUploadHistory() 업로드 이력',
      'PASS',
      `전체 ${history.total}개 (이번 페이지: ${history.items.length}개)`,
    )

    if (history.items.length > 0) {
      const showCount = Math.min(history.items.length, ctx.verbose ? 10 : 3)
      for (let i = 0; i < showCount; i++) {
        const item = history.items[i]
        console.log(
          `         ${COLORS.dim}  - [${item.historyNo}] ${item.itemSrcName}.${item.itemSrcExtension} (${item.itemFolderFullpath}) ${item.itemUseDate}${COLORS.reset}`,
        )
      }
      if (history.items.length > showCount) {
        console.log(
          `         ${COLORS.dim}  ... 외 ${history.items.length - showCount}개${COLORS.reset}`,
        )
      }
    }
  } catch (err) {
    printResult('4.2 getUploadHistory()', 'FAIL', (err as Error).message)
    overallStatus = 'FAIL'
  }

  printPhaseResult(4, overallStatus, Date.now() - start)
  return overallStatus
}

// ══════════════════════════════════════════════════════════════
// Phase 5: 파일 감지 모니터링
// ══════════════════════════════════════════════════════════════

async function phase5(ctx: SharedContext, monitorSeconds: number): Promise<TestStatus> {
  printPhaseHeader(5, '파일 감지 모니터링')
  const start = Date.now()

  if (!ctx.lguplusLoggedIn) {
    printResult('Phase 5', 'SKIP', 'Phase 1 로그인 실패로 전체 스킵')
    printPhaseResult(5, 'SKIP', Date.now() - start)
    return 'SKIP'
  }

  let overallStatus: TestStatus = 'PASS'

  // Create in-memory StateManager
  const state = new StateManager(':memory:', ctx.logger)
  state.initialize()

  const eventBus = new EventBus()
  const detector = new FileDetector(ctx.lguplus, state, eventBus, ctx.logger, {
    pollingIntervalMs: 5000,
  })

  // 5.1 forceCheck() 초기 감지
  try {
    const initialFiles = await detector.forceCheck()
    printResult(
      '5.1 forceCheck() 초기 감지',
      'PASS',
      `기준점 설정 완료 (${initialFiles.length}개 파일 감지)`,
    )
    if (initialFiles.length > 0 && (ctx.verbose || initialFiles.length <= 5)) {
      for (const f of initialFiles.slice(0, 5)) {
        console.log(
          `         ${COLORS.dim}  - ${f.fileName} (history: ${f.historyNo})${COLORS.reset}`,
        )
      }
    }
  } catch (err) {
    printResult('5.1 forceCheck() 초기 감지', 'FAIL', (err as Error).message)
    overallStatus = 'FAIL'
    state.close()
    printPhaseResult(5, overallStatus, Date.now() - start)
    return overallStatus
  }

  // 5.2 감시 모드
  printResult(
    '5.2 감시 모드 시작',
    'INFO',
    `${monitorSeconds}초간 폴링 감시 (새 파일 업로드 시 감지됨)`,
  )

  let detectedCount = 0
  const unsubscribe = detector.onFilesDetected((files, strategy) => {
    detectedCount += files.length
    for (const f of files) {
      printResult(
        '',
        'INFO',
        `[감지됨] ${f.fileName} (전략: ${strategy}, history: ${f.historyNo})`,
      )
    }
  })

  detector.start()

  // Wait for monitor duration
  await new Promise<void>((resolve) => setTimeout(resolve, monitorSeconds * 1000))

  detector.stop()
  unsubscribe()

  printResult(
    '5.2 감시 결과',
    detectedCount > 0 ? 'PASS' : 'INFO',
    `${monitorSeconds}초간 ${detectedCount}개 새 파일 감지`,
    detectedCount === 0 ? '감시 중 새 파일 없음 (정상)' : undefined,
  )

  state.close()
  printPhaseResult(5, overallStatus, Date.now() - start)
  return overallStatus
}

// ══════════════════════════════════════════════════════════════
// Phase 6: E2E 동기화 테스트
// ══════════════════════════════════════════════════════════════

async function phase6(ctx: SharedContext): Promise<TestStatus> {
  printPhaseHeader(6, 'E2E 동기화 테스트')
  const start = Date.now()

  if (!ctx.lguplusLoggedIn) {
    printResult('Phase 6', 'SKIP', 'Phase 1 로그인 실패로 스킵')
    printPhaseResult(6, 'SKIP', Date.now() - start)
    return 'SKIP'
  }

  if (!ctx.webhardConnected) {
    printResult('Phase 6', 'SKIP', 'Phase 2 자체 웹하드 연결 실패로 스킵')
    printPhaseResult(6, 'SKIP', Date.now() - start)
    return 'SKIP'
  }

  if (ctx.fileList.length === 0) {
    printResult('Phase 6', 'SKIP', 'Phase 4에서 파일 목록이 비어있어 스킵')
    printPhaseResult(6, 'SKIP', Date.now() - start)
    return 'SKIP'
  }

  let overallStatus: TestStatus = 'PASS'
  const tempDir = join(tmpdir(), `webhard-integration-test-${Date.now()}`)

  try {
    await mkdir(tempDir, { recursive: true })

    // 6.1 가장 작은 파일 선택
    const sortedFiles = [...ctx.fileList]
      .filter((f) => !f.isFolder && f.itemSize > 0)
      .sort((a, b) => a.itemSize - b.itemSize)

    if (sortedFiles.length === 0) {
      printResult('6.1 파일 선택', 'SKIP', '다운로드 가능한 파일 없음')
      printPhaseResult(6, 'SKIP', Date.now() - start)
      return 'SKIP'
    }

    const targetFile = sortedFiles[0]
    const sizeStr =
      targetFile.itemSize > 1024
        ? `${(targetFile.itemSize / 1024).toFixed(1)}KB`
        : `${targetFile.itemSize}B`
    printResult(
      '6.1 가장 작은 파일 선택',
      'PASS',
      `${targetFile.itemName} (${sizeStr}, ID: ${targetFile.itemId})`,
    )

    // 6.2 downloadFile() 로컬 다운로드
    const destPath = join(tempDir, targetFile.itemName)
    try {
      const downloadResult = await ctx.lguplus.downloadFile(targetFile.itemId, destPath)
      if (downloadResult.success) {
        printResult(
          '6.2 downloadFile() 로컬 다운로드',
          'PASS',
          `다운로드 성공 (${downloadResult.size} bytes -> ${destPath})`,
        )
      } else {
        printResult('6.2 downloadFile() 로컬 다운로드', 'FAIL', '다운로드 실패')
        overallStatus = 'FAIL'
        return overallStatus
      }
    } catch (err) {
      printResult('6.2 downloadFile() 로컬 다운로드', 'FAIL', (err as Error).message)
      overallStatus = 'FAIL'
      return overallStatus
    }

    // 6.3 ensureFolderPath(['__integration_test__', ...])
    const testFolderSegments = ['__integration_test__', `test-${Date.now()}`]
    let targetFolderId: string | null = null

    try {
      const folderResult = await ctx.uploader.ensureFolderPath(testFolderSegments)
      if (folderResult.success && folderResult.data) {
        targetFolderId = folderResult.data
        printResult(
          '6.3 ensureFolderPath() 폴더 생성',
          'PASS',
          `폴더 생성 성공 (경로: ${testFolderSegments.join('/')}, ID: ${targetFolderId})`,
        )
      } else {
        printResult(
          '6.3 ensureFolderPath() 폴더 생성',
          'FAIL',
          `폴더 생성 실패: ${folderResult.error}`,
        )
        overallStatus = 'FAIL'
        return overallStatus
      }
    } catch (err) {
      printResult('6.3 ensureFolderPath() 폴더 생성', 'FAIL', (err as Error).message)
      overallStatus = 'FAIL'
      return overallStatus
    }

    // 6.4 uploadFile() 자체 웹하드 업로드
    try {
      const uploadResult = await ctx.uploader.uploadFile({
        folderId: targetFolderId!,
        filePath: destPath,
        originalName: targetFile.itemName,
      })
      if (uploadResult.success) {
        printResult(
          '6.4 uploadFile() 자체 웹하드 업로드',
          'PASS',
          `업로드 성공 (ID: ${uploadResult.data?.id})`,
        )
      } else {
        printResult(
          '6.4 uploadFile() 자체 웹하드 업로드',
          'FAIL',
          `업로드 실패: ${uploadResult.error}`,
        )
        overallStatus = 'FAIL'
        return overallStatus
      }
    } catch (err) {
      printResult('6.4 uploadFile() 자체 웹하드 업로드', 'FAIL', (err as Error).message)
      overallStatus = 'FAIL'
      return overallStatus
    }

    // 6.5 fileExists() 업로드 확인
    try {
      const exists = await ctx.uploader.fileExists(targetFolderId!, targetFile.itemName)
      if (exists) {
        printResult(
          '6.5 fileExists() 업로드 확인',
          'PASS',
          '파일 존재 확인됨',
        )
      } else {
        printResult(
          '6.5 fileExists() 업로드 확인',
          'WARN',
          '파일이 존재하지 않음 (업로드 후 즉시 조회 실패 가능)',
        )
      }
    } catch (err) {
      printResult('6.5 fileExists() 업로드 확인', 'WARN', (err as Error).message)
    }
  } finally {
    // Cleanup temp directory
    try {
      await rm(tempDir, { recursive: true, force: true })
      printResult('', 'INFO', `임시 디렉토리 정리 완료: ${tempDir}`)
    } catch {
      printResult('', 'WARN', `임시 디렉토리 정리 실패: ${tempDir}`)
    }
  }

  printPhaseResult(6, overallStatus, Date.now() - start)
  return overallStatus
}

// ══════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = parseArgs()
  suppressConsoleNoise(args.verbose)
  const ctx = createContext(args.verbose, args.webhardUrl)

  printHeader()
  console.log(`  자체 웹하드: ${args.webhardUrl}`)
  if (args.webhardUrl === DEFAULT_DEV_WEBHARD_URL) {
    console.log(`  ${COLORS.dim}(로컬 dev 서버 — 프로덕션 연결: --prod)${COLORS.reset}`)
  }
  console.log('')

  const phaseMap: Record<number, { fn: (ctx: SharedContext) => Promise<TestStatus>; title: string }> = {
    1: { fn: phase1, title: 'LGU+ 연결 테스트' },
    2: { fn: phase2, title: '자체 웹하드 연결 테스트' },
    3: { fn: phase3, title: 'LGU+ 폴더 탐색' },
    4: { fn: phase4, title: '파일 목록 조회' },
    5: { fn: (c) => phase5(c, args.monitorSeconds), title: '파일 감지 모니터링' },
    6: { fn: phase6, title: 'E2E 동기화 테스트' },
  }

  const phasesToRun = args.phases ?? [1, 2, 3, 4, 5, 6]
  const results = new Map<number, { status: TestStatus; title: string }>()

  const totalStart = Date.now()

  for (const phaseNum of phasesToRun) {
    const phase = phaseMap[phaseNum]
    if (!phase) {
      console.log(`  ${COLORS.yellow}[WARN]${COLORS.reset} 알 수 없는 Phase: ${phaseNum}`)
      continue
    }

    try {
      const status = await phase.fn(ctx)
      results.set(phaseNum, { status, title: phase.title })
    } catch (err) {
      console.error(`  ${COLORS.red}[FATAL]${COLORS.reset} Phase ${phaseNum} 비정상 종료:`, err)
      results.set(phaseNum, { status: 'FAIL', title: phase.title })
    }
  }

  printSummary(results, Date.now() - totalStart)

  // Set exit code if any phase failed
  const hasFailed = [...results.values()].some((r) => r.status === 'FAIL')
  process.exitCode = hasFailed ? 1 : 0
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exitCode = 1
})
