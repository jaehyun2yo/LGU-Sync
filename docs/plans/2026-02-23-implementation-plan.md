# 외부웹하드동기화프로그램 v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** LGU+ 외부웹하드 → 자체웹하드 단방향 동기화를 수행하는 Electron 데스크톱 앱을 SDD 방법론으로 구축한다.

**Architecture:** 3-layer Clean Architecture (Renderer ↔ Main ↔ Core), IPC 기반 통신, Core는 Electron 무의존 순수 TypeScript. SDD에 따라 인터페이스/타입 스펙을 먼저 정의하고 구현을 도출한다.

**Tech Stack:** Electron 33+, React 18, TypeScript, electron-vite, Tailwind CSS v4, shadcn/ui, Zustand, better-sqlite3 (WAL), Vitest, React Testing Library, Playwright, Zod, Recharts, Lucide Icons

---

## Phase 0: 프로젝트 스캐폴딩

### Task 0-1: 프로젝트 초기화 (electron-vite)

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Create: `.gitignore`

**Step 1: electron-vite 프로젝트 생성**

```bash
cd "C:\Users\jaehy\OneDrive\Desktop\dev\projects\yjlaser\외부웹하드동기화프로그램2"
npm create @anthropic-ai/electron-vite@latest . -- --template react-ts
# 또는 수동 초기화:
npm init -y
npm install electron electron-vite @vitejs/plugin-react --save-dev
```

**Step 2: electron.vite.config.ts 생성**

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['better-sqlite3', 'playwright']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: './src/renderer/index.html'
      }
    }
  }
})
```

**Step 3: TypeScript 설정 파일 생성**

`tsconfig.json` (references), `tsconfig.node.json` (Main+Preload, target ES2022, module CommonJS), `tsconfig.web.json` (Renderer, target ES2022, module ESNext)

**Step 4: .gitignore 생성**

```
node_modules/
dist/
out/
.env
*.db
*.db-wal
*.db-shm
downloads/
```

**Step 5: git init + 커밋**

```bash
git init
git add .
git commit -m "chore: initialize electron-vite project scaffold"
```

---

### Task 0-2: 핵심 의존성 설치

**Step 1: 프로덕션 의존성**

```bash
npm install react react-dom zustand zod better-sqlite3 uuid recharts lucide-react
npm install @tanstack/react-virtual
```

**Step 2: 개발 의존성**

```bash
npm install -D typescript @types/react @types/react-dom @types/better-sqlite3 @types/uuid
npm install -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom jsdom
npm install -D eslint prettier eslint-config-prettier @typescript-eslint/eslint-plugin @typescript-eslint/parser
npm install -D tailwindcss @tailwindcss/vite postcss
npm install -D electron-builder electron-rebuild
npm install -D msw
```

**Step 3: better-sqlite3 리빌드**

```bash
npx electron-rebuild -f -w better-sqlite3
```

**Step 4: 커밋**

```bash
git add package.json package-lock.json
git commit -m "chore: install core dependencies"
```

---

### Task 0-3: 개발 도구 설정

**Files:**
- Create: `.eslintrc.cjs`
- Create: `.prettierrc`
- Create: `vitest.config.ts`
- Create: `.vscode/extensions.json`
- Create: `.vscode/settings.json`
- Create: `.env.example`

**Step 1: ESLint 설정**

```javascript
// .eslintrc.cjs
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier'
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
  }
}
```

**Step 2: Prettier 설정**

```json
{ "semi": false, "singleQuote": true, "trailingComma": "all", "printWidth": 100, "tabWidth": 2 }
```

**Step 3: Vitest 설정**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'html'] }
  }
})
```

**Step 4: .env.example**

```dotenv
LGUPLUS_URL=https://only.webhard.co.kr/
LGUPLUS_USERNAME=
LGUPLUS_PASSWORD=
SELF_WEBHARD_API_URL=https://www.yjlaser.net
SELF_WEBHARD_API_KEY=
DOWNLOAD_DIR=./downloads
NODE_ENV=development
```

**Step 5: npm scripts 추가 (package.json)**

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "format": "prettier --write src/",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "rebuild": "electron-rebuild -f -w better-sqlite3",
    "pack": "electron-builder --dir",
    "dist": "electron-builder"
  }
}
```

**Step 6: 커밋**

```bash
git add .
git commit -m "chore: configure eslint, prettier, vitest, vscode settings"
```

---

### Task 0-4: 디렉토리 구조 생성

**Step 1: 전체 폴더 구조 생성**

```bash
mkdir -p src/shared
mkdir -p src/core/types
mkdir -p src/core/errors
mkdir -p src/core/db
mkdir -p src/main
mkdir -p src/preload
mkdir -p src/renderer/pages
mkdir -p src/renderer/components
mkdir -p src/renderer/stores
mkdir -p src/renderer/hooks
mkdir -p src/renderer/assets
mkdir -p tests/core
mkdir -p tests/main
mkdir -p tests/renderer
```

**Step 2: 각 디렉토리에 빈 index.ts 생성 (barrel exports)**

- `src/shared/index.ts`
- `src/core/index.ts`
- `src/core/types/index.ts`
- `src/core/errors/index.ts`

**Step 3: Electron 진입점 스텁 생성**

- `src/main/index.ts` → `app.whenReady()` 스텁
- `src/preload/index.ts` → `contextBridge` 스텁
- `src/renderer/index.html` → React 마운트 HTML
- `src/renderer/main.tsx` → React 루트 렌더
- `src/renderer/App.tsx` → "Hello World" 스텁

**Step 4: `npm run dev`로 Electron 앱 실행 확인**

Expected: Electron 창이 뜨며 "Hello World" 표시

**Step 5: 커밋**

```bash
git add .
git commit -m "chore: create directory structure and entry point stubs"
```

---

## Phase 1: SDD 스펙 정의 (인터페이스/타입 우선)

> SDD 원칙: "코드를 쓰기 전에 계약을 먼저 쓴다"

### Task 1-1: 에러 체계 스펙 정의

**Files:**
- Create: `src/core/errors/index.ts`

**Step 1: 에러 분류 타입과 기본 에러 클래스 작성**

```typescript
// src/core/errors/index.ts — [SPEC]
export type ErrorCategory = 'NETWORK' | 'AUTH' | 'API' | 'FILE' | 'DB' | 'CONFIG' | 'INTERNAL'

export abstract class SyncAppError extends Error {
  abstract readonly code: string
  abstract readonly category: ErrorCategory
  abstract readonly retryable: boolean
  readonly timestamp = Date.now()
  context?: Record<string, unknown>

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = this.constructor.name
  }
}

// 네트워크 에러
export class NetworkTimeoutError extends SyncAppError { ... }
export class NetworkConnectionError extends SyncAppError { ... }

// 인증 에러
export class AuthLoginFailedError extends SyncAppError { ... }
export class AuthSessionExpiredError extends SyncAppError { ... }
export class AuthCaptchaRequiredError extends SyncAppError { ... }

// API 에러
export class ApiResponseParseError extends SyncAppError { ... }
export class ApiUnexpectedResponseError extends SyncAppError { ... }

// 파일 에러
export class FileDownloadError extends SyncAppError { ... }
export class FileUploadError extends SyncAppError { ... }
export class FileChecksumMismatchError extends SyncAppError { ... }
export class DiskSpaceError extends SyncAppError { ... }

// DB 에러
export class DatabaseError extends SyncAppError { ... }

// 설정 에러
export class ConfigValidationError extends SyncAppError { ... }
```

**Step 2: 타입 체크**

```bash
npx tsc --noEmit
```
Expected: PASS

**Step 3: 커밋**

```bash
git add src/core/errors/
git commit -m "spec: define error hierarchy and classification"
```

---

### Task 1-2: 이벤트 버스 스펙 정의

**Files:**
- Create: `src/core/types/events.types.ts`

**Step 1: EventMap 인터페이스 정의**

```typescript
// src/core/types/events.types.ts — [SPEC]
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
  'sync:started':    { timestamp: number }
  'sync:completed':  { totalFiles: number; totalBytes: number; durationMs: number }
  'sync:failed':     { error: SyncAppError; fileId?: string }
  'sync:progress':   { fileId: string; fileName: string; progress: number; speedBps: number }
  'detection:found': { files: DetectedFile[]; strategy: DetectionStrategy }
  'session:expired': { reason: string }
  'session:renewed': { method: 'http' | 'playwright' }
  'engine:status':   { prev: EngineStatus; next: EngineStatus }
  'download:progress': { fileId: string; downloadedBytes: number; totalBytes: number }
  'upload:progress':   { fileId: string; uploadedBytes: number; totalBytes: number }
}

export interface IEventBus {
  on<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): void
  off<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): void
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void
  removeAllListeners(): void
}
```

**Step 2: 타입 체크**

```bash
npx tsc --noEmit
```

**Step 3: 커밋**

```bash
git add src/core/types/events.types.ts
git commit -m "spec: define EventMap and IEventBus interface"
```

---

### Task 1-3: Core 모듈 인터페이스 스펙 정의

**Files:**
- Create: `src/core/types/config.types.ts`
- Create: `src/core/types/logger.types.ts`
- Create: `src/core/types/state-manager.types.ts`
- Create: `src/core/types/lguplus-client.types.ts`
- Create: `src/core/types/webhard-uploader.types.ts`
- Create: `src/core/types/file-detector.types.ts`
- Create: `src/core/types/retry-manager.types.ts`
- Create: `src/core/types/sync-engine.types.ts`
- Create: `src/core/types/notification.types.ts`

**Step 1: IConfigManager 정의** (`config.types.ts`)

```typescript
export interface AppConfig {
  lguplus: { id: string; password: string }
  webhard: { apiUrl: string; apiKey: string }
  sync: { pollingIntervalSec: number; maxConcurrentDownloads: number; maxConcurrentUploads: number; snapshotIntervalMin: number }
  notification: { inApp: boolean; toast: boolean }
  system: { autoStart: boolean; startMinimized: boolean; tempDownloadPath: string; logRetentionDays: number }
}

export interface IConfigManager {
  get<K extends keyof AppConfig>(section: K): AppConfig[K]
  set<K extends keyof AppConfig>(section: K, value: Partial<AppConfig[K]>): void
  getAll(): AppConfig
  validate(): boolean
  reset(): void
  onChanged<K extends keyof AppConfig>(section: K, handler: (value: AppConfig[K]) => void): () => void
}
```

**Step 2: ILogger 정의** (`logger.types.ts`)

```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext { [key: string]: unknown }

export interface ILogger {
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, error?: Error, context?: LogContext): void
  child(context: LogContext): ILogger
}
```

**Step 3: IStateManager 정의** (`state-manager.types.ts`)

```typescript
export interface IStateManager {
  // 체크포인트
  getCheckpoint(key: string): string | null
  saveCheckpoint(key: string, value: string): void

  // 동기화 파일
  saveFile(file: SyncFileInsert): string
  updateFileStatus(fileId: string, status: SyncFileStatus, extra?: Partial<SyncFileRow>): void
  getFile(fileId: string): SyncFileRow | null
  getFilesByFolder(folderId: string, options?: QueryOptions): SyncFileRow[]
  getFileByHistoryNo(historyNo: number): SyncFileRow | null

  // 동기화 폴더
  saveFolder(folder: SyncFolderInsert): string
  updateFolder(id: string, data: Partial<SyncFolderRow>): void
  getFolders(enabledOnly?: boolean): SyncFolderRow[]
  getFolder(id: string): SyncFolderRow | null

  // 이벤트 로그
  logEvent(event: SyncEventInsert): void
  getEvents(query: EventQuery): SyncEventRow[]

  // DLQ
  addToDlq(item: DlqInsert): void
  getDlqItems(): DlqRow[]
  removeDlqItem(id: number): void

  // 통계
  getDailyStats(from: string, to: string): DailyStatsRow[]
  incrementDailyStats(date: string, success: number, failed: number, bytes: number): void

  // 로그 조회 (GUI)
  getLogs(query: LogQuery): LogRow[]
  addLog(entry: LogInsert): void

  // 라이프사이클
  initialize(): void
  close(): void
}
```

**Step 4: ILGUplusClient 정의** (`lguplus-client.types.ts`)

```typescript
export interface ILGUplusClient {
  login(userId: string, password: string): Promise<LoginResult>
  logout(): Promise<void>
  isAuthenticated(): boolean
  validateSession(): Promise<boolean>
  refreshSession(): Promise<boolean>
  getUploadHistory(afterHistoryNo?: number): Promise<UploadHistoryItem[]>
  listFolder(folderId: string): Promise<FolderContentItem[]>
  getSubFolders(folderId: string): Promise<LGUplusFolderItem[]>
  getFolderTree(): Promise<LGUplusFolderItem[]>
  getDownloadInfo(fileId: string): Promise<DownloadInfo>
  downloadFile(fileId: string, destPath: string, onProgress?: ProgressCallback): Promise<DownloadResult>
}
```

**Step 5: IWebhardUploader 정의** (`webhard-uploader.types.ts`)

```typescript
export interface IWebhardUploader {
  checkConnection(): Promise<boolean>
  createFolder(path: string): Promise<FolderInfo>
  uploadFile(params: UploadParams): Promise<UploadResult>
  fileExists(path: string, checksum?: string): Promise<boolean>
  deleteFile(path: string): Promise<void>
}
```

**Step 6: IFileDetector 정의** (`file-detector.types.ts`)

```typescript
export interface IFileDetector {
  start(): void
  stop(): void
  setPollingInterval(intervalMs: number): void
  forceCheck(): Promise<DetectedFile[]>
  onFilesDetected(handler: (files: DetectedFile[], strategy: DetectionStrategy) => void): () => void
}
```

**Step 7: IRetryManager 정의** (`retry-manager.types.ts`)

```typescript
export interface IRetryManager {
  execute<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>
  getCircuitState(name: string): CircuitState
  getDlqItems(): DlqItem[]
  retryDlqItem(id: number): Promise<void>
  retryAllDlq(): Promise<BatchRetryResult>
}
```

**Step 8: ISyncEngine 정의** (`sync-engine.types.ts`)

```typescript
export interface ISyncEngine {
  readonly status: EngineStatus
  start(): Promise<void>
  stop(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  fullSync(options?: FullSyncOptions): Promise<FullSyncResult>
  syncFile(fileId: string): Promise<SyncResult>
}
```

**Step 9: INotificationService 정의** (`notification.types.ts`)

```typescript
export interface INotificationService {
  notify(notification: NotificationParams): string
  getNotifications(filter?: NotificationFilter): AppNotification[]
  getUnreadCount(): number
  markRead(id: string): void
  markAllRead(): void
  clearOld(beforeDays: number): void
}
```

**Step 10: 타입 체크**

```bash
npx tsc --noEmit
```
Expected: PASS

**Step 11: 커밋**

```bash
git add src/core/types/
git commit -m "spec: define all Core module interfaces (SDD Level 2)"
```

---

### Task 1-4: DB 스키마 스펙 정의

**Files:**
- Create: `src/core/db/schema.ts`
- Create: `src/core/db/types.ts`

**Step 1: SQL DDL과 Row 타입을 쌍으로 정의** (`schema.ts`)

03-데이터구조-기획서.md 기준으로 모든 테이블의 CREATE TABLE + TypeScript Row 타입을 정의한다:
- `sync_folders`
- `sync_files`
- `sync_events`
- `sync_sessions`
- `detection_checkpoints`
- `dead_letter_queue`
- `daily_stats`
- `app_logs`
- `app_settings`

**Step 2: Zod 검증 스키마 정의** (`types.ts`)

각 테이블의 Insert/Row Zod 스키마를 정의한다.

**Step 3: 타입 체크**

```bash
npx tsc --noEmit
```

**Step 4: 커밋**

```bash
git add src/core/db/
git commit -m "spec: define DB schema DDL and TypeScript Row types"
```

---

### Task 1-5: IPC 채널 타입 스펙 정의

**Files:**
- Create: `src/shared/ipc-types.ts`

**Step 1: IpcChannelMap 정의**

06-API-인터페이스-설계서.md 기준으로 모든 invoke/handle 채널의 request/response 타입을 정의한다:
- `sync:*` (start, stop, pause, resume, status, full-sync, retry-failed)
- `files:*` (list, detail, search)
- `folders:*` (list, tree, toggle)
- `logs:*` (list, export)
- `stats:*` (summary, chart)
- `settings:*` (get, update, test-connection)
- `auth:*` (login, logout, status)
- `failed:*` (list)
- `notification:*` (getAll, read, readAll)

**Step 2: IpcEventMap 정의**

Main → Renderer 단방향 이벤트 타입을 정의한다:
- `sync:progress`, `sync:file-completed`, `sync:file-failed`, `sync:status-changed`
- `detection:new-files`
- `auth:expired`
- `error:critical`

**Step 3: ElectronAPI 인터페이스 정의**

```typescript
export interface ElectronAPI {
  invoke<K extends keyof IpcChannelMap>(
    channel: K,
    ...args: IpcChannelMap[K]['request'] extends void ? [] : [IpcChannelMap[K]['request']]
  ): Promise<IpcChannelMap[K]['response']>

  on<K extends keyof IpcEventMap>(
    channel: K,
    callback: (data: IpcEventMap[K]) => void
  ): () => void
}
```

**Step 4: 타입 체크**

```bash
npx tsc --noEmit
```

**Step 5: 커밋**

```bash
git add src/shared/
git commit -m "spec: define type-safe IPC channel map and event map"
```

---

### Task 1-6: 스펙 리뷰 및 검증

**Step 1: 전체 타입 체크**

```bash
npx tsc --noEmit
```
Expected: PASS — 모든 스펙 파일이 타입 정합성 확인

**Step 2: 순환 의존 없음 확인**

```bash
npx madge --circular src/core/types/ src/shared/
```
Expected: No circular dependencies

**Step 3: 커밋 (필요 시 수정 후)**

```bash
git commit -m "spec: pass spec review - all types consistent"
```

---

## Phase 2: Core Layer 구현 (테스트 → 구현)

> 각 모듈은 "테스트 먼저 → 구현 → 검증" 순서를 따른다.
> Core 모듈 의존성 순서: EventBus → Logger → ConfigManager → StateManager → RetryManager → LGUplusClient → WebhardUploader → FileDetector → NotificationService → SyncEngine

### Task 2-1: EventBus 구현

**Files:**
- Create: `tests/core/event-bus.test.ts`
- Create: `src/core/event-bus.ts`

**Step 1: 테스트 작성**

```typescript
// tests/core/event-bus.test.ts
import { describe, it, expect, vi } from 'vitest'
import { EventBus } from '../../src/core/event-bus'

describe('EventBus', () => {
  it('이벤트를 구독하고 발행하면 핸들러가 호출된다', () => { ... })
  it('off로 구독 해제한 핸들러는 호출되지 않는다', () => { ... })
  it('removeAllListeners로 모든 핸들러가 해제된다', () => { ... })
  it('같은 이벤트에 여러 핸들러를 등록할 수 있다', () => { ... })
  it('등록되지 않은 이벤트를 emit해도 에러가 발생하지 않는다', () => { ... })
})
```

**Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run tests/core/event-bus.test.ts
```
Expected: FAIL (event-bus.ts 미존재)

**Step 3: 구현**

```typescript
// src/core/event-bus.ts
import type { IEventBus, EventMap } from './types/events.types'

export class EventBus implements IEventBus {
  private listeners = new Map<string, Set<Function>>()
  // on, off, emit, removeAllListeners 구현
}
```

**Step 4: 테스트 통과 확인**

```bash
npx vitest run tests/core/event-bus.test.ts
```
Expected: PASS

**Step 5: 커밋**

```bash
git add tests/core/event-bus.test.ts src/core/event-bus.ts
git commit -m "feat: implement EventBus with type-safe events"
```

---

### Task 2-2: Logger 구현

**Files:**
- Create: `tests/core/logger.test.ts`
- Create: `src/core/logger.ts`

**Step 1: 테스트 작성**

- debug/info/warn/error 레벨별 로깅 테스트
- child() 로 컨텍스트 상속 테스트
- EventBus 연동 (로그 이벤트 발행) 테스트

**Step 2: 테스트 실행 → 실패 확인**

**Step 3: 구현** — 콘솔 + EventBus 스트리밍, 파일/SQLite 출력은 StateManager 연동 시 추가

**Step 4: 테스트 통과 확인**

**Step 5: 커밋**

```bash
git add tests/core/logger.test.ts src/core/logger.ts
git commit -m "feat: implement Logger with structured logging and EventBus integration"
```

---

### Task 2-3: ConfigManager 구현

**Files:**
- Create: `tests/core/config-manager.test.ts`
- Create: `src/core/config-manager.ts`

**Step 1: 테스트 작성**

- 기본 설정값 로드 테스트
- get/set/getAll 동작 테스트
- validate() 유효성 검사 테스트
- onChanged() 변경 이벤트 구독 테스트
- reset() 기본값 복원 테스트
- Zod 스키마 검증 테스트

**Step 2: 테스트 실행 → 실패 확인**

**Step 3: 구현** — Zod 기반 설정 검증, 메모리 저장 (SQLite 연동은 StateManager 후 추가)

**Step 4: 테스트 통과 확인**

**Step 5: 커밋**

```bash
git add tests/core/config-manager.test.ts src/core/config-manager.ts
git commit -m "feat: implement ConfigManager with Zod validation"
```

---

### Task 2-4: StateManager (SQLite) 구현

**Files:**
- Create: `tests/core/state-manager.test.ts`
- Create: `src/core/state-manager.ts`
- Create: `src/core/db/migrations.ts`

**Step 1: 테스트 작성**

- initialize() — 테이블 생성 확인 (:memory: 모드)
- 체크포인트 CRUD 테스트
- sync_files CRUD + 상태 전이 테스트
- sync_folders CRUD 테스트
- sync_events 로그 추가/조회 테스트
- DLQ 추가/조회/제거 테스트
- daily_stats 집계 테스트
- close() — DB 종료 테스트

**Step 2: 테스트 실행 → 실패 확인**

**Step 3: 구현** — better-sqlite3 WAL 모드, PRAGMA 설정, 마이그레이션

**Step 4: 테스트 통과 확인**

**Step 5: 커밋**

```bash
git add tests/core/state-manager.test.ts src/core/state-manager.ts src/core/db/migrations.ts
git commit -m "feat: implement StateManager with SQLite WAL and migrations"
```

---

### Task 2-5: RetryManager 구현

**Files:**
- Create: `tests/core/retry-manager.test.ts`
- Create: `src/core/retry-manager.ts`

**Step 1: 테스트 작성**

- 정상 실행 (재시도 없이 성공) 테스트
- 1회 실패 후 재시도 성공 테스트
- 3회 모두 실패 → DLQ 이동 테스트
- 지수 백오프 간격 (1s→3s→10s) 테스트
- 서킷 브레이커: CLOSED → OPEN (실패율 40%) 테스트
- 서킷 브레이커: OPEN → HALF_OPEN (10초 후) 테스트
- 서킷 브레이커: HALF_OPEN → CLOSED (성공 시) 테스트
- retryable=false 에러는 즉시 실패 테스트

**Step 2: 테스트 실행 → 실패 확인**

**Step 3: 구현**

**Step 4: 테스트 통과 확인**

**Step 5: 커밋**

```bash
git add tests/core/retry-manager.test.ts src/core/retry-manager.ts
git commit -m "feat: implement RetryManager with circuit breaker and DLQ"
```

---

### Task 2-6: LGUplusClient 구현

**Files:**
- Create: `tests/core/lguplus-client.test.ts`
- Create: `src/core/lguplus-client.ts`
- Create: `tests/mocks/lguplus-handlers.ts` (MSW mock handlers)

**Step 1: MSW 목 핸들러 작성**

LGU+ API 응답을 시뮬레이션하는 MSW 핸들러 작성:
- `POST /login-process` → 로그인 성공/실패
- `POST /wh` (FOLDER/TREE) → 폴더 트리
- `POST /wh` (FOLDER/LIST) → 폴더 내용
- `POST /wh` (USE_HISTORY/LIST) → 업로드 이력
- `GET /downloads/:fileId/server` → 다운로드 정보

**Step 2: 테스트 작성**

- login() 성공 → 쿠키 획득 테스트
- login() 실패 → AuthLoginFailedError 테스트
- validateSession() 유효/만료 테스트
- getUploadHistory() 이력 조회 + historyNo 필터링 테스트
- listFolder() 폴더 내용 조회 테스트
- getDownloadInfo() 다운로드 URL 획득 테스트
- 세션 만료 시 자동 재로그인 테스트

**Step 3: 테스트 실행 → 실패 확인**

**Step 4: 구현** — HTTP fetch 기반, 세션 쿠키 관리, Zod 응답 검증

**Step 5: 테스트 통과 확인**

**Step 6: 커밋**

```bash
git add tests/core/lguplus-client.test.ts tests/mocks/ src/core/lguplus-client.ts
git commit -m "feat: implement LGUplusClient with MSW-tested HTTP API calls"
```

---

### Task 2-7: WebhardUploader 인터페이스 + Mock 구현

**Files:**
- Create: `tests/core/webhard-uploader.test.ts`
- Create: `src/core/webhard-uploader/mock-uploader.ts`
- Create: `src/core/webhard-uploader/yjlaser-uploader.ts`

**Step 1: MockUploader 구현** (테스트/개발용)

IWebhardUploader 인터페이스를 구현하는 인메모리 Mock.

**Step 2: YjlaserUploader 스텁 작성**

실제 API 호출 구현체. 자체웹하드 API 스펙(06-API 설계서 §4)에 따라 구현.
- checkConnection → `GET /api/health`
- createFolder → `POST /api/webhard/folders`
- uploadFile → `POST /api/webhard/presigned-url` → `PUT {presignedUrl}` → `POST /api/webhard/files/confirm`
- fileExists → `GET /api/webhard/files/exists`

**Step 3: 테스트 작성 및 실행**

MockUploader 기반으로 인터페이스 계약 준수를 테스트.

**Step 4: 테스트 통과 확인**

**Step 5: 커밋**

```bash
git add tests/core/webhard-uploader.test.ts src/core/webhard-uploader/
git commit -m "feat: implement WebhardUploader interface with Mock and Yjlaser adapters"
```

---

### Task 2-8: FileDetector 구현

**Files:**
- Create: `tests/core/file-detector.test.ts`
- Create: `src/core/file-detector.ts`

**Step 1: 테스트 작성**

- start() → 폴링 시작 테스트
- stop() → 폴링 중지 테스트
- 폴링으로 새 파일 감지 시 핸들러 호출 테스트
- historyNo 기반 중복 필터링 테스트
- 이벤트 발견 시 500ms 이내 즉시 재폴링 (최대 3회) 테스트
- 스냅샷 비교로 누락 파일 감지 테스트
- 비활성 폴더의 파일은 무시 테스트
- 폴링 실패 시 지수 백오프 재시도 테스트

**Step 2: 테스트 실행 → 실패 확인**

**Step 3: 구현** — Primary(폴링 5초) + Secondary(스냅샷 10분) 이중 감지

**Step 4: 테스트 통과 확인**

**Step 5: 커밋**

```bash
git add tests/core/file-detector.test.ts src/core/file-detector.ts
git commit -m "feat: implement FileDetector with dual detection strategy"
```

---

### Task 2-9: NotificationService 구현

**Files:**
- Create: `tests/core/notification-service.test.ts`
- Create: `src/core/notification-service.ts`

**Step 1: 테스트 작성**

- notify() → 인앱 알림 저장 테스트
- getNotifications() → 필터 조회 테스트
- getUnreadCount() → 미읽음 카운트 테스트
- markRead/markAllRead 테스트
- clearOld() → 오래된 알림 삭제 테스트
- 동일 유형 알림 그룹핑 테스트

**Step 2~5: 표준 TDD 사이클**

**Step 5: 커밋**

```bash
git add tests/core/notification-service.test.ts src/core/notification-service.ts
git commit -m "feat: implement NotificationService with grouping and filtering"
```

---

### Task 2-10: SyncEngine 구현

**Files:**
- Create: `tests/core/sync-engine.test.ts`
- Create: `src/core/sync-engine.ts`

**Step 1: 테스트 작성**

- start() → STOPPED→RUNNING 상태 전이 테스트
- stop() → 진행 중 작업 완료 후 STOPPED 전이 (5초 타임아웃) 테스트
- pause()/resume() 상태 전이 테스트
- 이미 RUNNING인 상태에서 start() → 에러 테스트
- fullSync() → 스캔→비교→다운로드→업로드 파이프라인 테스트
- syncFile() → 단일 파일 동기화 테스트
- 감지→다운로드→업로드 파이프라인 통합 테스트 (Mock 의존성)
- 에러 발생 시 자동 복구 → ERROR→RUNNING 전이 테스트

**Step 2: 테스트 실행 → 실패 확인**

**Step 3: 구현** — 오케스트레이터. 모든 Core 모듈을 DI로 주입받아 파이프라인 조율

**Step 4: 테스트 통과 확인**

**Step 5: 커밋**

```bash
git add tests/core/sync-engine.test.ts src/core/sync-engine.ts
git commit -m "feat: implement SyncEngine orchestrator with state machine"
```

---

### Task 2-11: Core DI 팩토리

**Files:**
- Create: `src/core/container.ts`

**Step 1: DI 팩토리 함수 작성**

```typescript
export function createCoreServices(options: CoreOptions): CoreServices {
  const eventBus = new EventBus()
  const logger = new Logger(eventBus)
  const config = new ConfigManager(options.configPath)
  const state = new StateManager(options.dbPath, logger)
  const retry = new RetryManager(logger, eventBus, state)
  const lguplus = new LGUplusClient(config, logger, retry)
  const uploader = new YjlaserUploader(config, logger, retry)
  const detector = new FileDetector(lguplus, state, config, eventBus, logger)
  const notification = new NotificationService(state, eventBus, logger)
  const engine = new SyncEngine({ detector, lguplus, uploader, state, retry, eventBus, logger, notification, config })
  return { engine, eventBus, logger, config, state, retry, lguplus, uploader, detector, notification }
}
```

**Step 2: 타입 체크**

```bash
npx tsc --noEmit
```

**Step 3: 커밋**

```bash
git add src/core/container.ts
git commit -m "feat: add Core DI container factory"
```

---

## Phase 3: Main Process (Electron)

### Task 3-1: Preload 스크립트

**Files:**
- Modify: `src/preload/index.ts`

**Step 1: contextBridge 구현**

```typescript
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannelMap, IpcEventMap, ElectronAPI } from '../shared/ipc-types'

const electronAPI: ElectronAPI = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => {
    const listener = (_: any, data: any) => callback(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
```

**Step 2: 커밋**

```bash
git add src/preload/index.ts
git commit -m "feat: implement type-safe preload contextBridge"
```

---

### Task 3-2: IPC Router

**Files:**
- Create: `src/main/ipc-router.ts`

**Step 1: IPC 핸들러 등록**

Core 서비스 메서드를 IPC 채널에 위임하는 라우터:
- `sync:*` → SyncEngine 메서드
- `files:*` → StateManager 쿼리
- `folders:*` → StateManager 쿼리
- `settings:*` → ConfigManager 메서드
- `auth:*` → LGUplusClient 메서드
- `logs:*` → StateManager 로그 쿼리
- `stats:*` → StateManager 통계 쿼리
- `failed:*` → RetryManager DLQ 조회

**Step 2: EventBus → IPC 이벤트 브릿지**

Core EventBus 이벤트를 `webContents.send()`로 Renderer에 전달.

**Step 3: 커밋**

```bash
git add src/main/ipc-router.ts
git commit -m "feat: implement IPC router bridging Core services to Renderer"
```

---

### Task 3-3: Window Manager

**Files:**
- Create: `src/main/window-manager.ts`

**Step 1: BrowserWindow 생성/관리 구현**

- 창 크기/위치 저장/복원 (electron-store)
- 닫기 버튼 → 트레이 최소화 (앱 종료 대신)
- preload 스크립트 로드

**Step 2: 커밋**

```bash
git add src/main/window-manager.ts
git commit -m "feat: implement WindowManager with position persistence"
```

---

### Task 3-4: Tray Manager

**Files:**
- Create: `src/main/tray-manager.ts`
- Create: `src/main/assets/` (트레이 아이콘 이미지)

**Step 1: 시스템 트레이 구현**

- 트레이 아이콘 (상태별 색상: 초록/빨강/회색)
- 컨텍스트 메뉴: 열기, 일시중지/재개, 전체 동기화, 종료
- 더블클릭 → 창 열기
- 툴팁 → 간략 상태

**Step 2: 커밋**

```bash
git add src/main/tray-manager.ts src/main/assets/
git commit -m "feat: implement TrayManager with status-colored icons and context menu"
```

---

### Task 3-5: App Lifecycle + AutoStart

**Files:**
- Modify: `src/main/index.ts`
- Create: `src/main/auto-start.ts`

**Step 1: 앱 생명주기 구현**

```
app.whenReady() → initCore → registerIpcHandlers → createTray → createWindow → startSync
before-quit → stopSync(5초 타임아웃) → saveState → closeDb
```

**Step 2: AutoStart 구현**

`app.setLoginItemSettings()` 우선, 실패 시 레지스트리 폴백.

**Step 3: `npm run dev` 로 전체 앱 동작 확인**

Expected: Electron 앱 실행, 트레이 아이콘 표시, IPC 통신 가능

**Step 4: 커밋**

```bash
git add src/main/
git commit -m "feat: implement app lifecycle, autostart, and main process entry"
```

---

## Phase 4: Renderer (React UI)

### Task 4-1: Tailwind CSS + shadcn/ui 설정

**Files:**
- Create: `src/renderer/index.css` (Tailwind 진입점)
- Create: `src/renderer/lib/utils.ts` (cn 유틸)
- Create: `components.json` (shadcn/ui 설정)

**Step 1: Tailwind CSS v4 설정**

```css
/* src/renderer/index.css */
@import "tailwindcss";
```

**Step 2: shadcn/ui 초기화**

```bash
npx shadcn@latest init
```

기본 컴포넌트 추가: button, card, input, badge, separator, tooltip, dialog, progress, table, tabs, scroll-area, dropdown-menu, toast

**Step 3: Pretendard 폰트 설정**

**Step 4: 다크/라이트 테마 설정** (CSS variables)

**Step 5: 커밋**

```bash
git add src/renderer/ components.json
git commit -m "feat: setup Tailwind CSS v4 and shadcn/ui components"
```

---

### Task 4-2: Zustand Stores 구현

**Files:**
- Create: `src/renderer/stores/sync-store.ts`
- Create: `src/renderer/stores/settings-store.ts`
- Create: `src/renderer/stores/log-store.ts`
- Create: `src/renderer/stores/notification-store.ts`
- Create: `src/renderer/stores/ui-store.ts`

**Step 1: syncStore** — 동기화 상태, 진행률, 최근 파일 목록
**Step 2: settingsStore** — 설정 캐시 + IPC set/get
**Step 3: logStore** — 로그 필터/검색 상태 + IPC 쿼리
**Step 4: notificationStore** — 알림 목록, 미읽음 카운트
**Step 5: uiStore** — 현재 페이지, 사이드바 상태, 테마

**Step 6: IPC 구독 hooks 작성**

```typescript
// src/renderer/hooks/useIpc.ts
// src/renderer/hooks/useIpcEvent.ts
```

**Step 7: 커밋**

```bash
git add src/renderer/stores/ src/renderer/hooks/
git commit -m "feat: implement Zustand stores and IPC hooks"
```

---

### Task 4-3: Layout 컴포넌트

**Files:**
- Create: `src/renderer/components/Layout.tsx`
- Create: `src/renderer/components/Sidebar.tsx`
- Create: `src/renderer/components/Header.tsx`
- Modify: `src/renderer/App.tsx`

**Step 1: Layout 구현** — 사이드바(220px) + 헤더(56px) + 메인 콘텐츠 영역

**Step 2: Sidebar 구현** — 6개 네비게이션 메뉴 + 연결 상태 표시기

**Step 3: Header 구현** — 페이지 제목 + 알림 벨 + 테마 토글

**Step 4: App.tsx에 라우팅** — 페이지 전환 (Zustand uiStore 기반, React Router 불필요)

**Step 5: 커밋**

```bash
git add src/renderer/components/ src/renderer/App.tsx
git commit -m "feat: implement Layout, Sidebar, Header components"
```

---

### Task 4-4: 대시보드 페이지

**Files:**
- Create: `src/renderer/pages/DashboardPage.tsx`
- Create: `src/renderer/components/SyncStatusCard.tsx`
- Create: `src/renderer/components/QuickStats.tsx`
- Create: `src/renderer/components/ActiveTransfers.tsx`
- Create: `src/renderer/components/RecentFilesList.tsx`

**Step 1: SyncStatusCard** — 상태 표시기 (색상+아이콘), 연속 가동 시간, 빠른 액션 버튼

**Step 2: QuickStats** — 4개 요약 카드 (총 파일, 성공, 실패, 전송 용량)

**Step 3: ActiveTransfers** — 현재 진행 중인 다운로드/업로드 목록 + 진행률 바

**Step 4: RecentFilesList** — 최근 동기화 파일 20건 (시간, 폴더/파일명, 크기/상태)

**Step 5: DashboardPage 조립** — 4개 컴포넌트 배치

**Step 6: 커밋**

```bash
git add src/renderer/pages/DashboardPage.tsx src/renderer/components/
git commit -m "feat: implement Dashboard page with status, stats, transfers, and recent files"
```

---

### Task 4-5: 파일 탐색기 페이지

**Files:**
- Create: `src/renderer/pages/FileExplorerPage.tsx`
- Create: `src/renderer/components/FolderTree.tsx`
- Create: `src/renderer/components/FileTable.tsx`
- Create: `src/renderer/components/FileDetailPanel.tsx`

**Step 1: FolderTree** — 좌측 폴더 트리 (접기/펼치기, 파일 수 배지, 비활성 폴더 흐리게)

**Step 2: FileTable** — 파일 목록 테이블 (가상 스크롤, 정렬, 상태 아이콘)

**Step 3: FileDetailPanel** — 하단 상세 패널 (메타 정보, 동기화 상태, 액션 버튼)

**Step 4: FileExplorerPage 조립** — 검색 바 + 폴더 트리 + 파일 테이블 + 상세 패널

**Step 5: 커밋**

```bash
git add src/renderer/pages/FileExplorerPage.tsx src/renderer/components/
git commit -m "feat: implement File Explorer with folder tree, file table, and detail panel"
```

---

### Task 4-6: 폴더 설정 페이지

**Files:**
- Create: `src/renderer/pages/FolderSettingsPage.tsx`
- Create: `src/renderer/components/FolderCheckboxTree.tsx`

**Step 1: FolderCheckboxTree** — 체크박스 트리 (전체 선택/해제, 자동 감지 폴더 표시)

**Step 2: FolderSettingsPage** — 동기화 대상 폴더 선택/해제 + 폴더별 통계

**Step 3: 커밋**

```bash
git add src/renderer/pages/FolderSettingsPage.tsx src/renderer/components/FolderCheckboxTree.tsx
git commit -m "feat: implement Folder Settings page with checkbox tree"
```

---

### Task 4-7: 동기화 로그 페이지

**Files:**
- Create: `src/renderer/pages/LogViewerPage.tsx`
- Create: `src/renderer/components/LogTable.tsx`
- Create: `src/renderer/components/LogFilters.tsx`

**Step 1: LogFilters** — 레벨 필터 (debug/info/warn/error), 날짜 범위, 검색 입력

**Step 2: LogTable** — 로그 테이블 (가상 스크롤, 레벨 색상, 타임스탬프, 메시지, 컨텍스트 펼치기)

**Step 3: LogViewerPage 조립** — 필터 바 + 로그 테이블 + 내보내기 버튼

**Step 4: 커밋**

```bash
git add src/renderer/pages/LogViewerPage.tsx src/renderer/components/
git commit -m "feat: implement Log Viewer page with filtering and virtual scroll"
```

---

### Task 4-8: 통계 페이지

**Files:**
- Create: `src/renderer/pages/StatisticsPage.tsx`
- Create: `src/renderer/components/SyncChart.tsx`

**Step 1: SyncChart** — Recharts 기반 일별/시간별 동기화 차트 (성공/실패 막대, 전송량 라인)

**Step 2: StatisticsPage** — 기간 선택 (오늘/주간/월간) + 요약 카드 + 차트

**Step 3: 커밋**

```bash
git add src/renderer/pages/StatisticsPage.tsx src/renderer/components/SyncChart.tsx
git commit -m "feat: implement Statistics page with Recharts daily/hourly charts"
```

---

### Task 4-9: 설정 페이지

**Files:**
- Create: `src/renderer/pages/SettingsPage.tsx`
- Create: `src/renderer/components/ConnectionTestButton.tsx`

**Step 1: SettingsPage 섹션 구현**

- LGU+ 계정 (ID/PW 입력 + 연결 테스트 버튼)
- 자체웹하드 (API URL + API Key + 연결 테스트)
- 동기화 설정 (폴링 간격, 동시 다운로드/업로드 수, 스냅샷 간격)
- 알림 설정 (인앱/토스트 토글)
- 시스템 설정 (자동 시작, 시작 시 최소화, 임시 다운로드 경로, 로그 보관 기간)

**Step 2: ConnectionTestButton** — 연결 테스트 실행 + 결과 표시 (성공/실패/latency)

**Step 3: 커밋**

```bash
git add src/renderer/pages/SettingsPage.tsx src/renderer/components/ConnectionTestButton.tsx
git commit -m "feat: implement Settings page with connection testing"
```

---

### Task 4-10: 알림 센터 + 토스트

**Files:**
- Create: `src/renderer/components/NotificationCenter.tsx`
- Create: `src/renderer/components/NotificationBell.tsx`

**Step 1: NotificationBell** — 헤더 알림 벨 아이콘 + 미읽음 배지

**Step 2: NotificationCenter** — 드롭다운 알림 목록 (읽기/전체읽기/삭제)

**Step 3: 커밋**

```bash
git add src/renderer/components/NotificationCenter.tsx src/renderer/components/NotificationBell.tsx
git commit -m "feat: implement notification center and bell with unread badge"
```

---

## Phase 5: 통합, 빌드, 배포

### Task 5-1: End-to-End 통합 테스트

**Files:**
- Create: `tests/e2e/sync-flow.test.ts`

**Step 1: E2E 테스트 작성**

Playwright Electron 기반:
- 앱 실행 → 설정 입력 → 로그인 성공 → 대시보드 표시
- 파일 감지 → 다운로드 → 업로드 → 대시보드 반영
- 전체 동기화 → 진행률 표시 → 완료

**Step 2: 테스트 실행**

```bash
npx playwright test tests/e2e/
```

**Step 3: 커밋**

```bash
git add tests/e2e/
git commit -m "test: add E2E sync flow tests with Playwright Electron"
```

---

### Task 5-2: electron-builder 패키징

**Files:**
- Create: `electron-builder.yml`

**Step 1: electron-builder 설정**

```yaml
appId: com.yjlaser.webhard-sync
productName: 외부웹하드동기화프로그램
directories:
  output: release
win:
  target: nsis
  icon: build/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  installerLanguages: ko
```

**Step 2: 빌드 + 패키징**

```bash
npm run build
npm run dist
```
Expected: `release/` 에 `.exe` 인스톨러 생성

**Step 3: 커밋**

```bash
git add electron-builder.yml
git commit -m "chore: configure electron-builder for Windows NSIS installer"
```

---

### Task 5-3: 자동 업데이트 (P2, 선택)

**Files:**
- Create: `src/main/auto-updater.ts`

**Step 1: electron-updater 설정** — GitHub Releases 기반 자동 업데이트

**Step 2: 커밋**

```bash
git add src/main/auto-updater.ts
git commit -m "feat: add auto-updater via electron-updater (GitHub Releases)"
```

---

## 실행 순서 요약

| Phase | Task | 설명 | 예상 복잡도 |
|-------|------|------|------------|
| 0 | 0-1 | electron-vite 프로젝트 초기화 | 낮음 |
| 0 | 0-2 | 의존성 설치 | 낮음 |
| 0 | 0-3 | 개발 도구 설정 | 낮음 |
| 0 | 0-4 | 디렉토리 구조 + 진입점 스텁 | 낮음 |
| 1 | 1-1 | 에러 체계 스펙 | 중간 |
| 1 | 1-2 | 이벤트 버스 스펙 | 중간 |
| 1 | 1-3 | Core 모듈 인터페이스 스펙 (9개 모듈) | 높음 |
| 1 | 1-4 | DB 스키마 스펙 | 높음 |
| 1 | 1-5 | IPC 채널 타입 스펙 | 높음 |
| 1 | 1-6 | 스펙 리뷰/검증 | 낮음 |
| 2 | 2-1 | EventBus 구현 | 낮음 |
| 2 | 2-2 | Logger 구현 | 낮음 |
| 2 | 2-3 | ConfigManager 구현 | 중간 |
| 2 | 2-4 | StateManager 구현 | 높음 |
| 2 | 2-5 | RetryManager 구현 | 중간 |
| 2 | 2-6 | LGUplusClient 구현 | 높음 |
| 2 | 2-7 | WebhardUploader 구현 | 중간 |
| 2 | 2-8 | FileDetector 구현 | 높음 |
| 2 | 2-9 | NotificationService 구현 | 중간 |
| 2 | 2-10 | SyncEngine 구현 | 높음 |
| 2 | 2-11 | Core DI 팩토리 | 낮음 |
| 3 | 3-1 | Preload 스크립트 | 낮음 |
| 3 | 3-2 | IPC Router | 중간 |
| 3 | 3-3 | Window Manager | 중간 |
| 3 | 3-4 | Tray Manager | 중간 |
| 3 | 3-5 | App Lifecycle + AutoStart | 중간 |
| 4 | 4-1 | Tailwind + shadcn/ui 설정 | 낮음 |
| 4 | 4-2 | Zustand Stores | 중간 |
| 4 | 4-3 | Layout 컴포넌트 | 중간 |
| 4 | 4-4 | 대시보드 페이지 | 높음 |
| 4 | 4-5 | 파일 탐색기 페이지 | 높음 |
| 4 | 4-6 | 폴더 설정 페이지 | 중간 |
| 4 | 4-7 | 동기화 로그 페이지 | 중간 |
| 4 | 4-8 | 통계 페이지 | 중간 |
| 4 | 4-9 | 설정 페이지 | 중간 |
| 4 | 4-10 | 알림 센터 | 낮음 |
| 5 | 5-1 | E2E 통합 테스트 | 높음 |
| 5 | 5-2 | 패키징 | 중간 |
| 5 | 5-3 | 자동 업데이트 (선택) | 낮음 |

**총 37개 Task**, Phase 0~5로 분류.

---

## 의존성 그래프

```
Phase 0 (스캐폴딩)
  ├── Task 0-1 → Task 0-2 → Task 0-3 → Task 0-4
  │
Phase 1 (스펙)
  │   ├── Task 1-1 (에러)     ─┐
  │   ├── Task 1-2 (이벤트)    ├─ Task 1-3 (Core 인터페이스) ─┐
  │   └── Task 1-4 (DB)       ─┘                              ├─ Task 1-5 (IPC) → Task 1-6 (리뷰)
  │                                                            │
Phase 2 (Core 구현)                                            │
  │   Task 2-1 (EventBus) ──────────────────────────────────────┘
  │     └─ Task 2-2 (Logger)
  │         └─ Task 2-3 (ConfigManager)
  │             └─ Task 2-4 (StateManager)
  │                 └─ Task 2-5 (RetryManager)
  │                     ├─ Task 2-6 (LGUplusClient)
  │                     ├─ Task 2-7 (WebhardUploader)
  │                     └─ Task 2-8 (FileDetector)
  │                         └─ Task 2-9 (NotificationService)
  │                             └─ Task 2-10 (SyncEngine) → Task 2-11 (DI)
  │
Phase 3 (Main)
  │   Task 3-1 (Preload) ── Task 3-2 (IPC Router) ── Task 3-3~3-5 (Window/Tray/Lifecycle)
  │
Phase 4 (Renderer)
  │   Task 4-1 (Tailwind) → Task 4-2 (Stores) → Task 4-3 (Layout) → Task 4-4~4-10 (Pages, 병렬 가능)
  │
Phase 5 (통합)
      Task 5-1 (E2E) → Task 5-2 (패키징) → Task 5-3 (업데이트)
```
