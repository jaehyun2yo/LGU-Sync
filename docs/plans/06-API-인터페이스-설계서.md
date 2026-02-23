# 외부웹하드동기화프로그램 v2 - API 인터페이스 설계서

> **문서 버전**: 1.0 | **작성일**: 2026-02-23 | **상태**: 초안
> **작성 근거**: v1 코드베이스 분석 (`LGUPlusApiClient`, `SelfWebhardUploader`), PRD 기능 요구사항
> **선행 문서**: [10-SDD-개발방법론](./10-SDD-개발방법론.md)

---

## 1. API 인터페이스 개요

### 1.1 3계층 API 구조

```
┌─ Renderer (React UI) ─────────────────────────────────┐
└──────┬─────────── IPC (invoke/on) ─────────┬──────────┘
┌──────▼─ Main Process (Electron) ───────────▼──────────┐
└──────┬─── HTTP/Cookie ────────┬─── HTTP/API Key ──────┘
┌──────▼─ LGU+ 웹하드 ─┐ ┌─────▼── 자체웹하드 ──────────┐
│  비공식 API           │ │  yjlaser_website (추후 제공)  │
└───────────────────────┘ └─────────────────────────────┘
```

| 계층 | 프로토콜 | 인증 | 특성 |
|------|----------|------|------|
| **IPC** | Electron IPC (invoke/handle, send/on) | 불필요 | Type-safe, 양방향, 이벤트 스트리밍 |
| **LGU+** | HTTPS + Cookie | 세션 쿠키 | 비공식/역공학, 변경 가능성 높음 |
| **자체웹하드** | HTTPS + API Key | `X-API-Key` 헤더 | 인터페이스만 선정의, Mock 사용 |

### 1.2 통신 패턴

- **Request/Response**: Renderer → Main `invoke` → 결과 반환
- **Event Streaming**: Main → Renderer `send` (진행률, 상태 변경, 알림)
- **Polling**: Main → LGU+ Upload History (5초 간격)
- **On-demand**: Main → LGU+/자체웹하드 (파일 다운로드/업로드)

### 1.3 SDD 기반 API 계약 원칙

본 문서의 모든 API 인터페이스는 SDD(Specification-Driven Development) 원칙에 따라 **계약 우선(Contract-First)**으로 정의된다:

- **타입 안전 계약**: 모든 API 요청/응답은 TypeScript 타입으로 명시적으로 정의한다
- **인터페이스 기반 추상화**: 외부 시스템(LGU+, 자체 웹하드) 접근은 인터페이스로 추상화하여 구현과 분리한다
- **Zod 런타임 검증**: 외부 API 응답은 Zod 스키마로 런타임 검증하여 타입 안전성을 보장한다
- **IPC 채널 타입 맵**: Renderer ↔ Main 통신은 타입 맵으로 채널별 요청/응답 타입을 강제한다

> 📌 SDD API 스펙 체계의 상세는 [10-SDD-개발방법론](./10-SDD-개발방법론.md) §4.2를 참조한다.

---

## 2. IPC API 설계

### 2.1 채널 네이밍: `{도메인}:{동작}`

### 2.2 동기화 제어 (Renderer → Main)

| 채널 | 요청 | 응답 | 설명 |
|------|------|------|------|
| `sync:start` | `void` | `ApiResponse<SyncStatus>` | 실시간 동기화 시작 |
| `sync:stop` | `void` | `ApiResponse<void>` | 동기화 중지 |
| `sync:pause` | `void` | `ApiResponse<void>` | 일시 중지 |
| `sync:resume` | `void` | `ApiResponse<void>` | 재개 |
| `sync:status` | `void` | `ApiResponse<SyncStatus>` | 상태 조회 |
| `sync:full-sync` | `FullSyncRequest` | `ApiResponse<FullSyncResult>` | 전체 동기화 |
| `sync:retry-failed` | `RetryRequest` | `ApiResponse<RetryResult>` | 실패 재시도 |

```typescript
interface FullSyncRequest { folderIds?: number[]; forceRescan?: boolean; }
interface FullSyncResult { scannedFiles: number; newFiles: number; syncedFiles: number; failedFiles: number; durationMs: number; }
interface RetryRequest { eventIds?: string[]; maxRetries?: number; }
interface RetryResult { retried: number; succeeded: number; failed: number; }
```

### 2.3 데이터 조회

| 채널 | 요청 | 응답 | 설명 |
|------|------|------|------|
| `files:list` | `FileListRequest` | `ApiResponse<Paginated<SyncFileInfo>>` | 파일 목록 |
| `files:detail` | `{ fileId: string }` | `ApiResponse<SyncFileDetail>` | 파일 상세 |
| `files:search` | `FileSearchRequest` | `ApiResponse<Paginated<SyncFileInfo>>` | 파일 검색 |
| `folders:list` | `{ parentId?: number }` | `ApiResponse<FolderInfo[]>` | 폴더 목록 |
| `folders:tree` | `void` | `ApiResponse<FolderTreeNode[]>` | 폴더 트리 |
| `logs:list` | `LogListRequest` | `ApiResponse<Paginated<LogEntry>>` | 로그 조회 |
| `stats:summary` | `{ period?: 'today'\|'week'\|'month' }` | `ApiResponse<SyncSummary>` | 통계 요약 |
| `stats:chart` | `ChartRequest` | `ApiResponse<ChartData>` | 차트 데이터 |
| `failed:list` | `PaginationRequest` | `ApiResponse<Paginated<FailedEvent>>` | 실패 목록 |

```typescript
interface FileListRequest { folderId?: number; status?: SyncFileStatus; sortBy?: 'name'|'date'|'size'|'status'; sortOrder?: 'asc'|'desc'; page?: number; pageSize?: number; }
interface FileSearchRequest { query: string; folderId?: number; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number; }
interface LogListRequest { level?: LogLevel[]; search?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number; }
interface ChartRequest { type: 'daily'|'hourly'; dateFrom: string; dateTo: string; }
```

### 2.4 설정 및 인증

| 채널 | 요청 | 응답 | 설명 |
|------|------|------|------|
| `settings:get` | `void` | `ApiResponse<AppSettings>` | 전체 설정 조회 |
| `settings:update` | `Partial<AppSettings>` | `ApiResponse<AppSettings>` | 설정 변경 (즉시 적용) |
| `settings:test-connection` | `ConnectionTestReq` | `ApiResponse<ConnectionTestResult>` | 연결 테스트 |
| `auth:login` | `LoginRequest` | `ApiResponse<AuthStatus>` | LGU+ 로그인 |
| `auth:logout` | `void` | `ApiResponse<void>` | 로그아웃 |
| `auth:status` | `void` | `ApiResponse<AuthStatus>` | 인증 상태 |

```typescript
interface AppSettings {
  lguplus: { username: string; password: string; };
  webhard: { apiUrl: string; apiKey: string; };
  sync: { pollingIntervalSec: number; maxConcurrentDownloads: number; maxConcurrentUploads: number; snapshotIntervalMin: number; };
  notification: { inApp: boolean; toast: boolean; };
  system: { autoStart: boolean; tempDownloadPath: string; logRetentionDays: number; };
}
interface LoginRequest { username: string; password: string; saveCredentials?: boolean; }
interface ConnectionTestReq { target: 'lguplus'|'webhard'; username?: string; password?: string; apiUrl?: string; apiKey?: string; }
interface ConnectionTestResult { success: boolean; latencyMs: number; message: string; serverVersion?: string; }
```

### 2.5 이벤트 스트리밍 (Main → Renderer)

`webContents.send(channel, data)` 단방향 푸시.

| 채널 | 페이로드 | 발생 시점 |
|------|----------|-----------|
| `sync:progress` | `SyncProgressEvent` | 동기화 진행률 변경 |
| `sync:file-completed` | `FileCompletedEvent` | 파일 동기화 완료 |
| `sync:file-failed` | `FileFailedEvent` | 파일 동기화 실패 |
| `sync:status-changed` | `StatusChangedEvent` | 상태 전이 (idle→syncing 등) |
| `detection:new-files` | `NewFilesEvent` | 새 파일 감지 |
| `auth:expired` | `AuthExpiredEvent` | 세션 만료 |
| `error:critical` | `CriticalErrorEvent` | 복구 불가 오류 |

```typescript
interface SyncProgressEvent { phase: 'scanning'|'comparing'|'downloading'|'uploading'; currentFile?: string; completedFiles: number; totalFiles: number; completedBytes: number; totalBytes: number; speedBps: number; estimatedRemainingMs: number; }
interface FileCompletedEvent { fileId: string; fileName: string; folderPath: string; fileSize: number; direction: 'download'|'upload'; durationMs: number; }
interface FileFailedEvent { fileId: string; fileName: string; error: string; errorCode: string; retryCount: number; willRetry: boolean; }
interface StatusChangedEvent { previousStatus: SyncStatusType; currentStatus: SyncStatusType; reason?: string; timestamp: string; }
type SyncStatusType = 'idle'|'syncing'|'paused'|'error'|'disconnected';
interface NewFilesEvent { files: Array<{ fileName: string; folderPath: string; fileSize: number; detectedAt: string; }>; source: 'polling'|'snapshot'; }
interface AuthExpiredEvent { service: 'lguplus'|'webhard'; reason: string; autoReloginAttempted: boolean; requiresManualAction: boolean; }
interface CriticalErrorEvent { code: string; message: string; details?: Record<string, unknown>; timestamp: string; }
```

### 2.6 Type-safe IPC 패턴

```typescript
// shared/ipc-types.ts - 채널 → 요청/응답 매핑
interface IpcChannelMap {
  'sync:start': { request: void; response: ApiResponse<SyncStatus> };
  'sync:stop': { request: void; response: ApiResponse<void> };
  'files:list': { request: FileListRequest; response: ApiResponse<Paginated<SyncFileInfo>> };
  'settings:get': { request: void; response: ApiResponse<AppSettings> };
  // ... 전체 채널 매핑
}
interface IpcEventMap {
  'sync:progress': SyncProgressEvent;
  'sync:file-completed': FileCompletedEvent;
  // ... 전체 이벤트 매핑
}

// preload.ts - Renderer에서 타입 안전하게 호출
interface ElectronAPI {
  invoke<K extends keyof IpcChannelMap>(
    channel: K, ...args: IpcChannelMap[K]['request'] extends void ? [] : [IpcChannelMap[K]['request']]
  ): Promise<IpcChannelMap[K]['response']>;
  on<K extends keyof IpcEventMap>(channel: K, callback: (data: IpcEventMap[K]) => void): () => void;
}
```

**SDD Level 2 — IPC 채널 타입 계약**

IPC 채널 타입 맵은 SDD Level 2 스펙으로, 모든 Renderer ↔ Main 통신의 계약을 정의한다.

**Zod 기반 IPC 요청 검증 예시:**

```typescript
import { z } from 'zod';

// IPC 요청 검증 스키마
export const IpcRequestSchemas = {
  'sync:syncFile': z.object({
    fileId: z.string().min(1),
  }),
  'config:set': z.object({
    key: z.string().min(1),
    value: z.unknown(),
  }),
  'logs:query': z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.number().int().positive().max(1000).default(100),
    offset: z.number().int().nonnegative().default(0),
  }),
} as const;
```

---

## 3. LGU+ API 인터페이스

### 3.1 개요

- **Base URL**: `https://only.webhard.co.kr`
- **인증**: 세션 쿠키 (`/login-process` 후 `Set-Cookie`로 획득)
- **특성**: 비공식/역공학 API, 공식 문서 없음

### 3.2 인증: POST /login-process

```
Content-Type: application/x-www-form-urlencoded
```

| 필드 | 값 | 설명 |
|------|-----|------|
| `userType` | `"Manage"` | 관리자 로그인 |
| `fakeLoginId` | 사용자 ID | |
| `loginId` | 사용자 ID | 실제 제출용 |
| `password` | 비밀번호 | |
| `id`, `pw`, `health` | `""` | 빈 문자열 (필수) |

**응답**: 302 리다이렉트 + `Set-Cookie`. 리다이렉트 후 홈 페이지에서 `"내 폴더"` 등을 포함하면 성공.

**세션 만료 감지**: 302→login 리다이렉트 / HTTP 401 / `RESULT_CODE: "9999"` / HTML 응답

### 3.3 범용 API: POST /wh

모든 조회/조작은 `MESSAGE_TYPE` + `PROCESS_TYPE` 조합으로 구분. `Content-Type: application/json`.

#### 폴더 트리 조회

| 필드 | 값 |
|------|-----|
| `MESSAGE_TYPE` | `"FOLDER"` |
| `PROCESS_TYPE` | `"TREE"` |
| `REQUEST_SHARED` | `"G"` |
| `UPPER_ID` | 상위 폴더 ID (0=루트) |

응답: `{ RESULT_CODE, ITEM_FOLDER: [{ FOLDER_ID, FOLDER_NAME, UPPER_FOLDER_ID, SUB_FOLDER_CNT }] }`

#### 폴더 내용 조회 (파일 + 폴더)

| 필드 | 값 |
|------|-----|
| `MESSAGE_TYPE` | `"FOLDER"` |
| `PROCESS_TYPE` | `"LIST"` |
| `REQUEST_ID` | 폴더 ID |
| `REQUEST_SHARED` | `"G"` |
| `PAGE` | 페이지 번호 |
| `SEARCH_FOLDER_TYPE` | `"ALL"` |

응답: `{ RESULT_CODE, TOTAL, ITEMS: [{ ITEM_ID, ITEM_NAME, ITEM_SIZE, ITEM_EXTENSION, ITEM_PARENT_ID, ITEM_UPDT_DT, FOLDER_TY_CODE }] }`
- `FOLDER_TY_CODE === "1"` → 폴더, 그 외 → 파일

#### 업로드 이력 조회

| 필드 | 값 |
|------|-----|
| `MESSAGE_TYPE` | `"USE_HISTORY"` |
| `PROCESS_TYPE` | `"LIST"` |
| `REQUEST_START_DATE` | `"0"` (오늘) |
| `REQUEST_END_DATE` | `"0"` (오늘) |
| `REQUEST_OPER_CODE` | `"UP"` (업로드만) / `""` (전체) |
| `PAGE` | 페이지 번호 |

응답: `{ RESULT_CODE, ITEM_TOTAL, ITEM_VIEW, ITEM_HISTORY: [{ HISTORY_NO, ITEM_SRC_NO, ITEM_FOLDER_ID, ITEM_SRC_NAME, ITEM_SRC_EXTENSION, ITEM_SRC_TYPE, ITEM_FOLDER_FULLPATH, ITEM_OPER_CODE, ITEM_USE_DATE, ... }] }`

**operCode 값**: `UP`(업로드), `D`(삭제), `MV`(이동), `RN`(이름변경), `CP`(복사), `FC`(폴더생성), `FD`(폴더삭제), `FMV`(폴더이동), `FRN`(폴더이름변경), `DN`(다운로드)
- v2 핵심 처리 대상: `UP`, `CP`, `FC`

#### 폴더 생성

`MESSAGE_TYPE: "FOLDER"`, `PROCESS_TYPE: "CREATE"`, `UPPER_ID: 상위ID`, `FOLDER_NAME: 이름`
응답: `{ RESULT_CODE, FOLDER_ID? }` (FOLDER_ID 미반환 시 목록 재조회)

### 3.4 다운로드 API: GET /downloads/{fileId}/server

```
URL: /downloads/{fileId}/server?fileStatus=1
```

응답: `{ file: { fileManagementNumber, fileName, fileSize }, session, nonce, url, fileOwnerEncId, userId, certificationId?, certificationKey? }`

**다운로드 URL 구성**: `{url}?sessionId={session}&nonce={nonce}&certificationId=webhard3.0&certificationKey=Hw9mJtbPPX57yV661Qlx&userId={userId}&fileOwnerId={fileOwnerEncId}&fileManagementNumber={fileId}&iosYn=N&callType=W&devInfo=PC&nwInfo=ETC&carrierType=E&svcCallerType=W&fileStatusCode=1`

**파일 크기별 타임아웃**: <10MB→2분, <100MB→5분, <1GB→15분, >=1GB→30분

### 3.5 ILGUplusClient 인터페이스

```typescript
interface ILGUplusClient {
  // 인증
  login(userId: string, password: string): Promise<boolean>;
  logout(): Promise<void>;
  isAuthenticated(): boolean;
  validateSession(): Promise<boolean>;
  refreshSession(): Promise<boolean>;
  // 폴더
  getGuestFolderRootId(): Promise<number | null>;
  getSubFolders(folderId: number): Promise<LGUplusFolderItem[]>;
  findFolderByName(parentId: number, name: string): Promise<number | null>;
  // 파일
  getFileList(folderId: number, options?: { page?: number }): Promise<{ items: LGUplusFileItem[]; total: number }>;
  getAllFiles(folderId: number, onProgress?: (page: number, fetched: number, total: number) => void): Promise<LGUplusFileItem[]>;
  // 다운로드
  getDownloadUrlInfo(fileId: number): Promise<DownloadUrlInfo | null>;
  downloadFile(fileId: number, destPath: string): Promise<{ success: boolean; size: number; filename: string }>;
  batchDownload(files: LGUplusFileItem[], destDir: string, options?: { concurrency?: number; onProgress?: (done: number, total: number, current: string) => void }): Promise<{ success: number; failed: number; totalSize: number; failedFiles: LGUplusFileItem[] }>;
  // 이력
  getUploadHistory(options?: { startDate?: string; endDate?: string; operCode?: string; page?: number }): Promise<UploadHistoryResponse>;
  // 세션 이벤트
  on(event: 'session-expired' | 'session-refreshed' | 'login-required', handler: (...args: unknown[]) => void): void;
}

interface LGUplusFolderItem { folderId: number; folderName: string; parentFolderId: number; subFolderCount?: number; }
interface LGUplusFileItem { itemId: number; itemName: string; itemSize: number; itemExtension: string; parentFolderId: number; updatedAt: string; isFolder: boolean; }
```

> **SDD Level 2** — 스펙 파일: `src/core/types/lguplus-client.types.ts`. 이 인터페이스는 LGU+ 웹하드 API와의 계약을 정의하며, 구현체(`LGUplusClient`)는 이 스펙을 준수해야 한다.

### 3.6 세션 관리 전략

- 15분 간격 `validateSession()` → 만료 시 `refreshSession()` (저장된 자격증명으로 자동 재로그인)
- API 호출 중 세션 만료 감지 시 즉시 재로그인 후 API 재시도 (최대 1회)
- 3회 연속 재로그인 실패 → 사용자 알림 + 수동 재입력 요청
- CAPTCHA 감지 시 → Playwright 브라우저 폴백 안내

---

## 4. 자체웹하드 API 인터페이스

### 4.1 설계 원칙

API 추후 제공 → **인터페이스만 선정의** + `MockWebhardUploader`로 개발. 어댑터 패턴으로 구현체 교체 가능.

### 4.2 IWebhardUploader 인터페이스

```typescript
interface IWebhardUploader {
  testConnection(): Promise<ConnectionTestResult>;
  isConnected(): boolean;
  // 폴더
  createFolder(params: { name: string; parentId: string | null }): Promise<WResult<FolderInfo>>;
  findFolder(name: string, parentId: string | null): Promise<WResult<FolderInfo | null>>;
  ensureFolderPath(segments: string[]): Promise<WResult<string>>; // 최종 폴더 ID
  // 파일
  uploadFile(params: { folderId: string; filePath: string; originalName: string; checksum?: string }): Promise<WResult<UploadedFileInfo>>;
  uploadFileBatch(files: UploadFileParams[], onProgress?: (done: number, total: number) => void): Promise<BatchUploadResult>;
  fileExists(folderId: string, fileName: string): Promise<boolean>;
  listFiles(folderId: string): Promise<WResult<WebhardFileInfo[]>>;
  // 이벤트
  on(event: 'upload-completed' | 'upload-failed' | 'connection-lost', handler: (...args: unknown[]) => void): void;
}

type WResult<T> = { success: boolean; data?: T; error?: string };
interface FolderInfo { id: string; name: string; parentId: string | null; createdAt: string; }
interface UploadedFileInfo { id: string; name: string; size: number; folderId: string; uploadedAt: string; }
interface WebhardFileInfo { id: string; name: string; size: number; createdAt: string; }
interface BatchUploadResult { total: number; success: number; failed: number; skipped: number; durationMs: number; }
```

> **SDD Level 2** — 스펙 파일: `src/core/types/webhard-uploader.types.ts`. 이 인터페이스는 자체 웹하드 API와의 계약을 정의하며, 구현체(`WebhardUploader`)는 이 스펙을 준수해야 한다.

### 4.3 MockWebhardUploader

인메모리 Map 기반 Mock. 테스트 헬퍼 포함.

```typescript
class MockWebhardUploader implements IWebhardUploader {
  private folders = new Map<string, FolderInfo>();
  private files = new Map<string, WebhardFileInfo[]>();
  private nextId = 1;
  // 시뮬레이션 제어
  private simulateLatencyMs = 50;
  private simulateFailureRate = 0;
  private connected = true;

  // 테스트 헬퍼
  setSimulateFailureRate(rate: number): void;  // 0~1
  setSimulateLatency(ms: number): void;
  setConnected(connected: boolean): void;
  reset(): void;
  // ... 모든 IWebhardUploader 메서드를 인메모리로 구현
}
```

### 4.4 어댑터 패턴

```typescript
function createWebhardUploader(config: AppSettings['webhard']): IWebhardUploader {
  if (!config.apiUrl || config.apiUrl === 'mock') return new MockWebhardUploader();
  return new YJLaserWebhardUploader(config); // 운영 구현체 (추후)
}
```

---

## 5. 공통 타입 정의

### 5.1 API 응답 / 페이지네이션

```typescript
interface ApiResponse<T> { success: boolean; data?: T; error?: ErrorResponse; timestamp: string; }
interface ErrorResponse { code: string; message: string; details?: Record<string, unknown>; }

interface PaginationRequest { page?: number; pageSize?: number; }
interface Paginated<T> { items: T[]; pagination: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean; }; }
```

### 5.2 동기화 상태

```typescript
interface SyncStatus {
  state: SyncStatusType;
  lguplus: { connected: boolean; sessionValid: boolean; lastPollAt?: string; };
  webhard: { connected: boolean; lastUploadAt?: string; };
  today: { totalFiles: number; successFiles: number; failedFiles: number; totalBytes: number; };
  currentOperation?: { type: 'full-sync'|'realtime'|'retry'; phase: 'scanning'|'comparing'|'downloading'|'uploading'; progress: number; currentFile?: string; };
  recentFiles: SyncFileInfo[];
  failedCount: number;
  lastUpdatedAt: string;
}

type SyncFileStatus = 'synced'|'pending'|'downloading'|'uploading'|'failed';
interface SyncFileInfo { id: string; fileName: string; folderPath: string; fileSize: number; status: SyncFileStatus; syncedAt?: string; error?: string; }
interface SyncFileDetail extends SyncFileInfo { lguplusFileId: number; lguplusFolderId: number; detectedAt: string; detectionSource: 'polling'|'snapshot'; webhardFileId?: string; retryCount: number; lastError?: string; history: Array<{ action: string; timestamp: string; details?: string }>; }
```

### 5.3 폴더 / 로그 / 통계 / 실패 이벤트

```typescript
interface FolderInfo { folderId: number; folderName: string; parentFolderId: number; fileCount: number; syncEnabled: boolean; lastSyncAt?: string; }
interface FolderTreeNode extends FolderInfo { children: FolderTreeNode[]; depth: number; }

type LogLevel = 'debug'|'info'|'warn'|'error';
interface LogEntry { id: number; level: LogLevel; message: string; category: string; timestamp: string; details?: Record<string, unknown>; stackTrace?: string; }

interface SyncSummary { period: string; totalFiles: number; successFiles: number; failedFiles: number; totalBytes: number; averageSpeedBps: number; byFolder: Array<{ folderName: string; fileCount: number; totalBytes: number }>; }
interface ChartData { labels: string[]; datasets: Array<{ label: string; data: number[]; color?: string }>; }

interface FailedEvent { id: string; fileName: string; folderPath: string; fileSize: number; errorCode: string; errorMessage: string; failedAt: string; retryCount: number; canRetry: boolean; }
```

---

## 6. 에러 코드 체계

### 6.1 코드 구조: `{카테고리}_{세부코드}`

카테고리: `AUTH_`(인증), `NET_`(네트워크), `DL_`(다운로드), `UL_`(업로드), `SYNC_`(동기화), `DB_`(DB), `FS_`(파일시스템), `IPC_`(IPC), `SYS_`(시스템)

### 6.2 에러 코드 목록

| 코드 | 메시지 | 심각도 | 자동 복구 |
|------|--------|--------|-----------|
| `AUTH_LOGIN_FAILED` | LGU+ 로그인 실패 | error | 3회 재시도 → 사용자 알림 |
| `AUTH_SESSION_EXPIRED` | 세션 만료 | warn | 자동 재로그인 |
| `AUTH_CAPTCHA_REQUIRED` | CAPTCHA 필요 | error | 수동 개입 |
| `AUTH_INVALID_CREDENTIALS` | 잘못된 계정 정보 | error | 설정 확인 필요 |
| `AUTH_WEBHARD_KEY_INVALID` | 자체웹하드 API Key 오류 | error | 설정 확인 필요 |
| `NET_TIMEOUT` | 요청 시간 초과 | warn | 지수 백오프 재시도 |
| `NET_CONNECTION_REFUSED` | 서버 연결 거부 | error | 30초 간격 재시도 |
| `NET_LGUPLUS_DOWN` | LGU+ 서버 다운 | error | 5분 간격 재시도 |
| `NET_WEBHARD_DOWN` | 자체웹하드 서버 다운 | error | 30초 간격 재시도 |
| `DL_URL_FETCH_FAILED` | 다운로드 URL 획득 실패 | warn | 3회 재시도 |
| `DL_FILE_NOT_FOUND` | 원본 파일 삭제됨 | info | 건너뛰기 |
| `DL_TRANSFER_FAILED` | 전송 중 오류 | warn | 부분 파일 삭제 후 재시도 |
| `DL_SIZE_MISMATCH` | 크기 불일치 | warn | 재다운로드 |
| `DL_CIRCUIT_OPEN` | 서킷 브레이커 작동 | warn | 10초 대기 후 재시도 |
| `UL_TRANSFER_FAILED` | 업로드 실패 | warn | 지수 백오프 3회 재시도 |
| `UL_FOLDER_CREATE_FAILED` | 폴더 생성 실패 | error | 상위 폴더부터 재생성 |
| `UL_CHECKSUM_MISMATCH` | 체크섬 불일치 | warn | 재다운로드 후 재업로드 |
| `SYNC_POLLING_FAILED` | 폴링 조회 실패 | warn | 백오프 후 재시도 |
| `SYNC_CHECKPOINT_LOST` | 체크포인트 유실 | error | 전체 동기화 권장 |
| `SYNC_QUEUE_OVERFLOW` | 큐 과부하 | warn | 일시 중지 후 순차 처리 |
| `SYNC_HISTORY_GAP` | 이력 번호 갭 | warn | 스냅샷 비교로 보완 |
| `FS_DISK_FULL` | 디스크 공간 부족 | error | 사용자 알림 |
| `FS_PERMISSION_DENIED` | 접근 권한 없음 | error | 사용자 확인 필요 |
| `FS_WRITE_FAILED` | 파일 쓰기 실패 | error | 임시 경로로 재시도 |
| `DB_CORRUPTED` | DB 파일 손상 | error | 백업 후 재생성 |
| `DB_LOCKED` | DB 잠금 | warn | 대기 후 재시도 |
| `IPC_HANDLER_NOT_FOUND` | 핸들러 미등록 | error | 불가 (버그) |
| `IPC_TIMEOUT` | IPC 응답 시간 초과 | warn | 재시도 |

### 6.3 심각도 정의

| 심각도 | UI 표현 | 알림 |
|--------|---------|------|
| `info` | 없음 | 없음 |
| `warn` | 노란색 | 인앱만 |
| `error` | 빨간색 | 인앱 + Windows 토스트 |

---

## 7. API 테스트 전략

### 7.1 Mock 구현체

| 컴포넌트 | Mock | 용도 |
|----------|------|------|
| LGU+ API | `MockLGUplusClient` | IPC 핸들러 테스트, UI 개발 |
| 자체웹하드 | `MockWebhardUploader` | 업로드 로직 테스트 |
| SQLite | `InMemoryDatabase` | 리포지토리 테스트 |
| Electron IPC | `MockIpcMain/Renderer` | IPC 핸들러/컴포넌트 테스트 |

`MockLGUplusClient`는 시뮬레이션 제어 기능 포함: `setFailureScenario('network'|'captcha'|'server-down')`, `setSessionExpireAfter(N)`, 테스트 데이터 주입(`addMockFolder/File/History`).

### 7.2 통합 테스트 시나리오

| 시나리오 | 테스트 내용 | Mock 설정 |
|----------|------------|-----------|
| 정상 동기화 | 감지 → 다운로드 → 업로드 → 완료 | 정상 응답 |
| 세션 만료 복구 | 동기화 중 만료 → 자동 재로그인 → 계속 | `sessionExpireAfter: 3` |
| 네트워크 단절 | 다운로드 중 오류 → 재시도 → 성공 | `failure: 'network'` (2회) |
| 대량 파일 | 100개 배치 다운로드, 동시성 제어 | 100개 Mock 파일 |
| 전체 동기화 | 스캔 → 비교 → 델타 처리 | 기존 50개 + 신규 10개 |
| 체크포인트 복구 | 중단 → 재시작 → 이어받기 | historyNo 기반 |
| 서킷 브레이커 | 연속 실패 → 차단 → 복구 | 40% 실패율 |
| CAPTCHA | 로그인 시 CAPTCHA → 알림 | `failure: 'captcha'` |
| Mock 교체 | MockUploader → 실제 API 전환 | 인터페이스 호환성 |

### 7.3 테스트 구조

```
tests/
├── unit/
│   ├── ipc-handlers/        # sync, files, settings 핸들러
│   ├── lguplus/             # auth, folder, download, history
│   └── webhard/             # mock-uploader, interface 호환성
├── integration/
│   ├── sync-flow.test.ts    # 전체 플로우
│   ├── session-recovery.test.ts
│   └── batch-download.test.ts
└── mocks/
    ├── MockLGUplusClient.ts
    ├── MockWebhardUploader.ts
    ├── MockIpc.ts
    └── test-data/           # fixtures (folders.json, files.json, history.json)
```

### 7.4 E2E 테스트

실제 LGU+ 환경 테스트는 CI/CD 제외, **수동/로컬 전용** (`.env` 자격증명 필요).
대상: API 헬스체크, 로그인/로그아웃, 폴더 스캔 벤치마크, 다운로드 스루풋, 이력 폴링.

### 7.5 스펙 기반 계약 테스트

SDD 원칙에 따라 API 인터페이스의 계약 준수를 검증하는 테스트 전략:

**계약 테스트 원칙:**
1. 모든 인터페이스 메서드에 대해 최소 1개의 성공/실패 테스트 케이스를 작성한다
2. Mock 객체는 인터페이스 타입을 `implements`하여 생성한다
3. 외부 API 응답은 Zod 스키마로 검증하는 테스트를 포함한다

**계약 테스트 구조:**

```typescript
describe('ILGUplusClient 계약 테스트', () => {
  // 각 인터페이스 메서드별 테스트
  describe('login()', () => {
    it('유효한 자격증명으로 로그인 성공', async () => { /* ... */ });
    it('잘못된 자격증명으로 로그인 실패', async () => { /* ... */ });
  });

  describe('getUploadHistory()', () => {
    it('응답이 UploadHistoryResponse 스키마를 만족', async () => {
      const response = await client.getUploadHistory();
      expect(() => UploadHistoryResponseSchema.parse(response)).not.toThrow();
    });
  });
});
```

> 📌 테스트 전략의 상세는 [07-테스트케이스-명세서](./07-테스트케이스-명세서.md)를, SDD 검증 체계는 [10-SDD-개발방법론](./10-SDD-개발방법론.md) §8을 참조한다.

---

## 부록: LGU+ API 참조

**RESULT_CODE**: `"0000"` = 성공, `"9999"` = 세션 만료

**operCode 전체**:

| 코드 | 의미 | 코드 | 의미 |
|------|------|------|------|
| `UP` | 파일 업로드 | `FC` | 폴더 생성 |
| `DN` | 파일 다운로드 | `FD` | 폴더 삭제 |
| `D` | 파일 삭제 | `FMV` | 폴더 이동 |
| `MV` | 파일 이동 | `FRN` | 폴더 이름변경 |
| `RN` | 파일 이름변경 | `CP` | 파일 복사 |
