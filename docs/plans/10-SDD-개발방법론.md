# 외부웹하드동기화프로그램 v2 - SDD 개발 방법론

> **문서 버전**: 1.0 | **작성일**: 2026-02-23 | **상태**: 초안
> **선행 문서**: [01-PRD](./01-PRD-제품요구사항정의서.md), [02-아키텍처](./02-아키텍처-설계서.md), [03-데이터구조](./03-데이터구조-기획서.md), [04-동기화엔진](./04-동기화엔진-설계서.md)

---

## 목차

1. [SDD 개요](#1-sdd-개요)
2. [스펙 체계](#2-스펙-체계)
3. [스펙 우선 개발 프로세스](#3-스펙-우선-개발-프로세스)
4. [레이어별 스펙 정의](#4-레이어별-스펙-정의)
5. [모듈별 스펙 카탈로그](#5-모듈별-스펙-카탈로그)
6. [스펙 → 구현 매핑 규칙](#6-스펙--구현-매핑-규칙)
7. [스펙 변경 관리](#7-스펙-변경-관리)
8. [검증 체크리스트](#8-검증-체크리스트)
9. [DDD + SDD 통합 전략](#9-ddd--sdd-통합-전략)

---

## 1. SDD 개요

### 1.1 Specification-Driven Development란

SDD(Specification-Driven Development)는 **구현 전에 스펙을 먼저 정의하고, 스펙을 단일 진실 공급원(Single Source of Truth)으로 삼아 구현·테스트·검증을 수행하는 개발 방법론**이다.

```
┌──────────────────────────────────────────────────────────────┐
│                    SDD 개발 사이클                             │
└──────────────────────────────────────────────────────────────┘

  ① 스펙 정의       ② 스펙 리뷰       ③ 스펙 기반 구현
  ┌──────────┐     ┌──────────┐     ┌──────────┐
  │ 인터페이스 │────▶│ 리뷰/승인 │────▶│ 구현 코드 │
  │ 타입 정의  │     │ 스펙 확정  │     │ 작성      │
  │ 계약 명세  │     │          │     │          │
  └──────────┘     └──────────┘     └──────────┘
       │                                  │
       │                                  ▼
       │                            ④ 스펙 적합성 검증
       │                            ┌──────────┐
       │                            │ 테스트    │
       │                            │ 타입 체크  │
       │                            │ 계약 검증  │
       │                            └─────┬────┘
       │                                  │
       │           ⑤ 스펙 변경 필요?       │
       │           ┌──────────┐           │
       └───────────│ 스펙 갱신 │◀──────────┘
                   │ (변경 이력) │
                   └──────────┘
```

### 1.2 왜 SDD인가

| 문제 (스펙 없이 구현할 때) | SDD 해결책 |
|--------------------------|-----------|
| 모듈 간 인터페이스 불일치로 통합 시 대량 수정 | 인터페이스 스펙을 먼저 합의하고 구현 |
| "동작은 하지만 계약이 다른" 코드 | 타입+계약 스펙이 컴파일 타임에 강제 |
| 테스트 케이스를 구현 후에 만들어 중요 경로 누락 | 스펙에서 테스트 케이스를 도출하므로 누락 방지 |
| 요구사항 변경 시 영향 범위 파악 어려움 | 스펙 변경 → 영향받는 모듈 자동 식별 |
| v1에서 77개의 패치 문서가 누적된 이유 | 스펙 없이 구현→패치→패치 반복 |

### 1.3 본 프로젝트에서의 SDD 범위

본 프로젝트의 DDD 아키텍처(Bounded Context, Aggregate, Entity, Repository 등)에 SDD를 결합하여, **도메인 모델의 스펙을 먼저 정의하고 구현을 도출**하는 방식을 채택한다.

| 스펙 대상 | 정의 위치 | 구현 도출 대상 |
|----------|----------|--------------|
| 도메인 인터페이스 | `src/core/types/` | Core 모듈 구현체 |
| IPC 계약 | `src/shared/ipc-types.ts` | Main 핸들러 + Renderer 호출부 |
| DB 스키마 | `src/core/db/schema.ts` | StateManager 쿼리 |
| API 계약 | `src/core/types/` | LGUplusClient, WebhardUploader |
| 이벤트 계약 | `src/core/types/events.types.ts` | EventBus 발행/구독 |
| 에러 계약 | `src/core/errors/` | 에러 처리 정책 |
| 설정 스키마 | Zod 스키마 | ConfigManager |

---

## 2. 스펙 체계

### 2.1 스펙 계층 구조

```
┌───────────────────────────────────────────────────────┐
│                    스펙 계층 구조                        │
└───────────────────────────────────────────────────────┘

  Level 0: 요구사항 스펙 (WHY)
  ┌──────────────────────────────────────────────────┐
  │ 01-PRD-제품요구사항정의서.md                         │
  │ "무엇을 만들고 왜 만드는가"                          │
  └────────────────────┬─────────────────────────────┘
                       │ 도출
                       ▼
  Level 1: 아키텍처 스펙 (WHAT)
  ┌──────────────────────────────────────────────────┐
  │ 02-아키텍처-설계서.md                                │
  │ "어떤 구조로 만드는가"                               │
  │ ─ 레이어 구조, 모듈 분리, 의존성 규칙                  │
  └────────────────────┬─────────────────────────────┘
                       │ 도출
                       ▼
  Level 2: 계약 스펙 (HOW - 인터페이스)
  ┌──────────────────────────────────────────────────┐
  │ TypeScript 인터페이스 + 타입 + Zod 스키마             │
  │ "모듈 간 약속은 무엇인가"                             │
  │ ─ 함수 시그니처, 입출력 타입, 에러 타입, 이벤트 타입      │
  └────────────────────┬─────────────────────────────┘
                       │ 도출
                       ▼
  Level 3: 행위 스펙 (HOW - 동작)
  ┌──────────────────────────────────────────────────┐
  │ 04-동기화엔진-설계서.md + 테스트 명세서                 │
  │ "어떻게 동작해야 하는가"                              │
  │ ─ 상태 머신, 시퀀스, 에러 정책, 재시도 규칙             │
  └────────────────────┬─────────────────────────────┘
                       │ 도출
                       ▼
  Level 4: 데이터 스펙 (WHERE)
  ┌──────────────────────────────────────────────────┐
  │ 03-데이터구조-기획서.md + DB 스키마                    │
  │ "데이터를 어디에 어떻게 저장하는가"                      │
  │ ─ 테이블, 인덱스, 마이그레이션, 제약조건                 │
  └──────────────────────────────────────────────────┘
```

### 2.2 스펙 파일 체계

```
src/
├── shared/
│   └── ipc-types.ts              # [SPEC] IPC 계약 (L2)
├── core/
│   ├── types/
│   │   ├── sync.types.ts         # [SPEC] 동기화 도메인 타입 (L2)
│   │   ├── lguplus.types.ts      # [SPEC] LGU+ API 계약 (L2)
│   │   ├── config.types.ts       # [SPEC] 설정 도메인 타입 (L2)
│   │   ├── events.types.ts       # [SPEC] 이벤트 계약 (L2)
│   │   ├── webhard.types.ts      # [SPEC] 웹하드 업로더 계약 (L2)
│   │   └── notification.types.ts # [SPEC] 알림 도메인 타입 (L2)
│   ├── errors/
│   │   └── index.ts              # [SPEC] 에러 분류 계약 (L2)
│   ├── db/
│   │   └── schema.ts             # [SPEC] DB 스키마 (L4)
│   └── ...구현체들...             # [IMPL] 스펙에서 도출
└── renderer/
    └── stores/                   # [IMPL] IPC 스펙에서 도출
```

**규칙**: `[SPEC]` 표시된 파일은 반드시 **구현 전에 작성**되어야 한다. `[IMPL]` 파일은 스펙에서 도출된다.

### 2.3 스펙 우선순위 매트릭스

| 스펙 종류 | 우선순위 | 근거 |
|----------|---------|------|
| 도메인 인터페이스 (ISyncEngine 등) | **P0 (필수)** | 모든 구현의 출발점 |
| IPC 채널 타입 (IpcHandlers, IpcEvents) | **P0 (필수)** | Main-Renderer 계약 |
| DB 스키마 (CREATE TABLE) | **P0 (필수)** | 데이터 구조 결정 |
| 에러 코드/분류 (SyncAppError) | **P1 (높음)** | 에러 처리 정책의 기반 |
| 이벤트 타입 (IpcEventMap) | **P1 (높음)** | 모듈 간 통신 계약 |
| Zod 검증 스키마 | **P2 (보통)** | 런타임 검증, 구현 중 정의 가능 |
| UI 컴포넌트 Props 타입 | **P2 (보통)** | 컴포넌트 경계 정의 |

---

## 3. 스펙 우선 개발 프로세스

### 3.1 전체 워크플로우

```
┌──────────────────────────────────────────────────────────────────┐
│                  SDD 기반 기능 개발 워크플로우                       │
└──────────────────────────────────────────────────────────────────┘

  Phase 1: 스펙 정의 (Specify)
  ─────────────────────────────────────────────
  1.1 요구사항에서 도메인 모델 도출
  1.2 인터페이스(I*)와 타입 정의 파일 작성
  1.3 IPC 채널 추가 (해당 시)
  1.4 DB 스키마 변경 (해당 시)
  1.5 에러 코드 추가 (해당 시)
  1.6 이벤트 타입 추가 (해당 시)

          │
          ▼ 스펙 파일 커밋 (feat/spec-xxx)

  Phase 2: 스펙 리뷰 (Review)
  ─────────────────────────────────────────────
  2.1 타입 정합성 검증 (tsc --noEmit)
  2.2 인터페이스 계약 리뷰
  2.3 DB 스키마 리뷰
  2.4 스펙 확정

          │
          ▼ 스펙 확정 커밋

  Phase 3: 테스트 작성 (Test First)
  ─────────────────────────────────────────────
  3.1 스펙에서 테스트 케이스 도출
  3.2 인터페이스 기반 Mock 작성
  3.3 단위 테스트 스켈레톤 작성 (실패하는 테스트)

          │
          ▼ 테스트 커밋

  Phase 4: 구현 (Implement)
  ─────────────────────────────────────────────
  4.1 인터페이스 구현체 작성
  4.2 테스트 통과 확인
  4.3 통합 테스트 작성 및 통과

          │
          ▼ 구현 커밋

  Phase 5: 적합성 검증 (Verify)
  ─────────────────────────────────────────────
  5.1 타입 체크 통과 (tsc --noEmit)
  5.2 모든 테스트 통과 (vitest run)
  5.3 스펙 적합성 체크리스트 확인
  5.4 린트 통과 (eslint)

          │
          ▼ 완료
```

### 3.2 Phase별 상세

#### Phase 1: 스펙 정의 — "코드를 쓰기 전에 계약을 먼저 쓴다"

**입력**: PRD 요구사항, 아키텍처 설계서
**출력**: 타입 정의 파일들 (`*.types.ts`, `ipc-types.ts`, `schema.ts`)

작성 순서:

```
1. 도메인 타입 정의 (Value Object, Entity 식별)
   └─ src/core/types/sync.types.ts 등

2. 인터페이스 정의 (모듈 간 계약)
   └─ ISyncEngine, ILGUplusClient, IWebhardUploader 등

3. IPC 계약 정의 (Renderer-Main 경계)
   └─ src/shared/ipc-types.ts

4. DB 스키마 정의 (데이터 영속화)
   └─ src/core/db/schema.ts

5. 이벤트 계약 정의 (모듈 간 비동기 통신)
   └─ src/core/types/events.types.ts

6. 에러 계약 정의 (에러 분류 체계)
   └─ src/core/errors/index.ts
```

#### Phase 2: 스펙 리뷰 — "구현 없이 tsc가 통과하는가"

```bash
# 스펙 파일만으로 타입 체크 통과 확인
npx tsc --noEmit

# 스펙 파일 간 순환 의존 없음 확인
npx madge --circular src/core/types/ src/shared/
```

리뷰 체크리스트:

| 항목 | 검증 내용 |
|------|----------|
| 타입 완전성 | 모든 public 메서드에 입출력 타입이 정의되었는가 |
| 계약 일관성 | IPC 타입과 Core 인터페이스의 타입이 일치하는가 |
| 에러 완전성 | 발생 가능한 모든 에러 코드가 정의되었는가 |
| 이벤트 완전성 | 모든 상태 변경에 대응하는 이벤트가 정의되었는가 |
| DB 정합성 | 스키마가 도메인 모델과 일치하는가 |
| 의존 방향 | Core 타입이 Main/Renderer 타입에 의존하지 않는가 |

#### Phase 3: 테스트 작성 — "스펙에서 테스트를 도출한다"

스펙의 각 인터페이스 메서드에서 테스트 케이스를 도출한다:

```typescript
// 스펙: ISyncEngine.start()
// └─ 정상: STOPPED → RUNNING 전이
// └─ 에러: 이미 RUNNING일 때 호출 → InvalidStateError
// └─ 에러: 인증 실패 → AuthError
// └─ 이벤트: engine:status 이벤트 발행

describe('SyncEngine.start()', () => {
  it('STOPPED 상태에서 호출하면 RUNNING으로 전이한다', async () => {
    // Arrange: Mock 의존성, STOPPED 상태
    // Act: engine.start()
    // Assert: engine.status === 'RUNNING'
  });

  it('이미 RUNNING이면 InvalidStateError를 던진다', async () => {
    // 스펙에서 도출된 에러 케이스
  });

  it('engine:status 이벤트를 발행한다', async () => {
    // 스펙에서 도출된 이벤트 케이스
  });
});
```

#### Phase 4: 구현 — "인터페이스를 implements 한다"

```typescript
// 스펙 (이미 작성됨)
interface ISyncEngine {
  readonly status: EngineStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  fullSync(options?: FullSyncOptions): Promise<FullSyncResult>;
}

// 구현 (스펙 이후 작성)
class SyncEngine implements ISyncEngine {
  // 인터페이스의 모든 메서드를 구현
  // 타입스크립트 컴파일러가 누락을 감지
}
```

#### Phase 5: 적합성 검증

```bash
# 1. 타입 체크 — 스펙 계약 준수 확인
npx tsc --noEmit

# 2. 단위 테스트 — 행위 스펙 준수 확인
npx vitest run --coverage

# 3. 린트 — 코드 품질
npx eslint src/
```

---

## 4. 레이어별 스펙 정의

### 4.1 Core Layer 스펙

Core의 모든 public 모듈은 **인터페이스(I*)를 먼저 정의**하고, 구현체는 인터페이스를 `implements` 한다.

```
스펙 파일                          구현 파일
──────────────                    ──────────────
types/sync.types.ts        ──▶    sync-engine.ts
  ISyncEngine                       class SyncEngine implements ISyncEngine
  EngineStatus
  FullSyncOptions
  FullSyncResult

types/lguplus.types.ts     ──▶    lguplus-client.ts
  ILGUplusClient                    class LGUplusClient implements ILGUplusClient
  LoginResult
  UploadHistoryItem

types/webhard.types.ts     ──▶    webhard-uploader/yjlaser-uploader.ts
  IWebhardUploader                  class YjlaserUploader implements IWebhardUploader
  UploadParams
  UploadResult
```

**스펙 정의 규칙:**

| 규칙 | 설명 | 예시 |
|------|------|------|
| 인터페이스 접두사 `I` | 모든 모듈 계약은 `I` 접두사 | `ISyncEngine`, `IStateManager` |
| 입출력 타입 분리 | 메서드별 Params/Result 타입 정의 | `FullSyncOptions`, `FullSyncResult` |
| 에러 타입 명시 | JSDoc `@throws`로 발생 가능 에러 명시 | `@throws {AuthSessionExpiredError}` |
| 읽기 전용 속성 | 외부에서 변경 불가한 상태는 `readonly` | `readonly status: EngineStatus` |
| 열거형은 union | `enum` 대신 string literal union | `type EngineStatus = 'idle' \| 'syncing'` |

### 4.2 IPC Layer 스펙

IPC 계약은 `src/shared/ipc-types.ts`에 **단일 파일**로 정의한다. Main과 Renderer 양쪽에서 이 타입을 import하여 컴파일 타임 계약을 보장한다.

```typescript
// src/shared/ipc-types.ts — [SPEC] 파일

// ── 요청/응답 (invoke/handle) ──
interface IpcHandlers {
  'sync:start':     { req: void;              res: void };
  'sync:getStatus': { req: void;              res: SyncEngineStatus };
  'config:set':     { req: { key: K; value: V }; res: void };
  // ...모든 채널 정의
}

// ── 이벤트 (send/on) ──
interface IpcEvents {
  'sync:progress':      SyncProgress;
  'sync:statusChanged': SyncEngineStatus;
  // ...모든 이벤트 정의
}
```

**IPC 스펙 추가 규칙:**

1. 새 IPC 채널 추가 시 반드시 `IpcHandlers` 또는 `IpcEvents`에 **타입을 먼저** 추가
2. 타입 추가 없이 `ipcMain.handle()` 직접 작성 금지
3. `req: void`인 경우에도 명시적으로 기재

### 4.3 Data Layer 스펙

DB 스키마는 `src/core/db/schema.ts`에 정의한다. SQL CREATE 문과 TypeScript 행(Row) 타입을 **쌍으로** 관리한다.

```typescript
// src/core/db/schema.ts — [SPEC] 파일

// SQL 스키마
export const SCHEMA_SQL = `
CREATE TABLE sync_files (
    id                TEXT PRIMARY KEY,
    folder_id         TEXT NOT NULL REFERENCES sync_folders(id),
    file_name         TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'detected',
    ...
);
`;

// TypeScript Row 타입 (SQL과 1:1 대응)
export interface SyncFileRow {
  id: string;
  folder_id: string;
  file_name: string;
  status: SyncFileStatus;
  // ...
}

// 상태 enum (DB status 컬럼의 허용값)
export type SyncFileStatus =
  | 'detected'
  | 'downloading'
  | 'download_failed'
  | 'uploading'
  | 'upload_failed'
  | 'completed'
  | 'dlq';
```

**DB 스펙 규칙:**

| 규칙 | 설명 |
|------|------|
| SQL과 TS 쌍 | 모든 테이블에 대응하는 Row 타입 정의 |
| status 타입 | DB의 TEXT status 컬럼은 TS union 타입으로 제한 |
| 마이그레이션 | 스키마 변경은 반드시 마이그레이션 파일로 작성 |
| 인덱스 | 쿼리 패턴에 맞는 인덱스를 스키마에 포함 |

### 4.4 Event Layer 스펙

이벤트 계약은 `src/core/types/events.types.ts`에 정의한다.

```typescript
// src/core/types/events.types.ts — [SPEC] 파일

export interface EventMap {
  // 동기화 이벤트
  'sync:started':    { timestamp: number };
  'sync:completed':  { totalFiles: number; totalBytes: number; duration: number };
  'sync:failed':     { error: SyncAppError; fileId?: string };
  'sync:progress':   { fileId: string; fileName: string; progress: number; speed: number };

  // 감지 이벤트
  'detection:found':  { files: DetectedFile[]; strategy: DetectionStrategy };

  // 세션 이벤트
  'session:expired':  { reason: string };
  'session:renewed':  { method: 'http' | 'playwright' };

  // 엔진 상태 이벤트
  'engine:status':    { prev: EngineStatus; next: EngineStatus };
}
```

**이벤트 스펙 규칙:**

1. 모든 이벤트의 payload 타입을 `EventMap`에 정의
2. 새 이벤트 추가 시 EventMap에 **타입을 먼저** 추가
3. EventBus의 `emit()`과 `on()`은 `EventMap` 키만 허용
4. 각 이벤트 payload에 식별에 필요한 최소 필드를 포함

### 4.5 Error Layer 스펙

에러 계약은 `src/core/errors/index.ts`에 정의한다.

```typescript
// src/core/errors/index.ts — [SPEC] 파일

export type ErrorCategory = 'NETWORK' | 'AUTH' | 'API' | 'FILE' | 'DB' | 'CONFIG' | 'INTERNAL';

export abstract class SyncAppError extends Error {
  abstract readonly code: string;
  abstract readonly category: ErrorCategory;
  abstract readonly retryable: boolean;
  readonly timestamp = Date.now();
  context?: Record<string, unknown>;
}

// 네트워크 에러
export class NetworkTimeoutError extends SyncAppError {
  readonly code = 'NETWORK_TIMEOUT';
  readonly category = 'NETWORK';
  readonly retryable = true;
}

// 인증 에러
export class AuthSessionExpiredError extends SyncAppError {
  readonly code = 'AUTH_SESSION_EXPIRED';
  readonly category = 'AUTH';
  readonly retryable = true;  // 자동 재로그인 시도
}

// ...모든 에러 클래스 사전 정의
```

**에러 스펙 규칙:**

| 규칙 | 설명 |
|------|------|
| code 고유성 | 모든 에러 code는 프로젝트 내 유일 |
| category 분류 | 7개 카테고리 중 하나 |
| retryable 명시 | 자동 재시도 가능 여부 |
| 에러 먼저 정의 | 구현에서 throw하기 전에 에러 클래스 정의 |

---

## 5. 모듈별 스펙 카탈로그

### 5.1 전체 스펙 목록

각 모듈의 인터페이스 스펙을 정리한다. 이 카탈로그가 구현의 **체크리스트** 역할을 한다.

#### SyncEngine (Aggregate Root)

| 스펙 항목 | 타입 | 상태 |
|----------|------|------|
| `ISyncEngine` | 인터페이스 | 정의 필요 |
| `EngineStatus` | union 타입 | `'idle' \| 'syncing' \| 'paused' \| 'error'` |
| `FullSyncOptions` | 입력 타입 | 정의 필요 |
| `FullSyncResult` | 출력 타입 | 정의 필요 |
| `SyncResult` | 출력 타입 | 정의 필요 |
| 상태 전이 규칙 | 행위 스펙 | 04-동기화엔진-설계서 참조 |
| 에러 정책 | 에러 스펙 | 02-아키텍처 9장 참조 |

```typescript
interface ISyncEngine {
  readonly status: EngineStatus;

  /** 엔진 시작. STOPPED→RUNNING 전이. @throws {AuthError} 인증 실패 시 */
  start(): Promise<void>;

  /** 엔진 중지. 진행 중 작업 완료 후 STOPPED 전이 (5초 타임아웃) */
  stop(): Promise<void>;

  /** 일시 정지. 새 감지 중단, 진행 중 작업은 완료 */
  pause(): Promise<void>;

  /** 재개. 놓친 이벤트 확인 후 RUNNING 전이 */
  resume(): Promise<void>;

  /** 전체 동기화. 모든 활성 폴더를 스캔하여 누락 파일 동기화 */
  fullSync(options?: FullSyncOptions): Promise<FullSyncResult>;

  /** 단일 파일 동기화 (DLQ 재시도 등) */
  syncFile(fileId: string): Promise<SyncResult>;
}
```

#### LGUplusClient

| 스펙 항목 | 타입 | 상태 |
|----------|------|------|
| `ILGUplusClient` | 인터페이스 | 정의 필요 |
| `LoginResult` | 출력 타입 | 정의 필요 |
| `UploadHistoryItem` | 데이터 타입 | 정의 필요 |
| `FolderItem` | 데이터 타입 | 정의 필요 |
| `DownloadInfo` | 데이터 타입 | 정의 필요 |
| 세션 생명주기 | 행위 스펙 | 04-동기화엔진 9장 참조 |

```typescript
interface ILGUplusClient {
  /** HTTP 로그인. 실패 시 Playwright 폴백. @throws {AuthError} */
  login(): Promise<LoginResult>;

  /** 세션 유효성 검증 */
  validateSession(): Promise<boolean>;

  /** 세션 갱신 (만료 시) */
  refreshSession(): Promise<void>;

  /** 업로드 히스토리 조회 (체크포인트 이후) */
  getUploadHistory(afterHistoryNo?: number): Promise<UploadHistoryItem[]>;

  /** 폴더 목록 조회 */
  listFolder(folderId: string): Promise<FolderItem[]>;

  /** 파일 다운로드 정보 (URL, 토큰) 획득 */
  getDownloadInfo(fileId: string): Promise<DownloadInfo>;

  /** 파일 다운로드 (스트리밍, 진행률 콜백) */
  downloadFile(info: DownloadInfo, destPath: string, onProgress?: ProgressCallback): Promise<void>;
}
```

#### WebhardUploader

| 스펙 항목 | 타입 | 상태 |
|----------|------|------|
| `IWebhardUploader` | 인터페이스 | 정의 필요 |
| `UploadParams` | 입력 타입 | 정의 필요 |
| `UploadResult` | 출력 타입 | 정의 필요 |
| `FolderInfo` | 데이터 타입 | 정의 필요 |

```typescript
interface IWebhardUploader {
  /** 연결 상태 확인 */
  checkConnection(): Promise<boolean>;

  /** 폴더 생성 (이미 존재하면 기존 반환) */
  createFolder(path: string): Promise<FolderInfo>;

  /** 파일 업로드 (100MB+ 시 멀티파트, MD5 검증) */
  uploadFile(params: UploadParams): Promise<UploadResult>;

  /** 파일 존재 여부 (체크섬 비교 옵션) */
  fileExists(path: string, checksum?: string): Promise<boolean>;

  /** 파일 삭제 */
  deleteFile(path: string): Promise<void>;
}
```

#### StateManager

| 스펙 항목 | 타입 | 상태 |
|----------|------|------|
| `IStateManager` | 인터페이스 | 정의 필요 |
| `SyncFileRow` | Row 타입 | 정의 필요 |
| `SyncFolderRow` | Row 타입 | 정의 필요 |
| `DlqItemRow` | Row 타입 | 정의 필요 |
| `DailyStat` | 데이터 타입 | 정의 필요 |

```typescript
interface IStateManager {
  // 체크포인트
  getCheckpoint(key: string): string | null;
  saveCheckpoint(key: string, value: string): void;

  // 동기화 파일
  saveFile(file: Omit<SyncFileRow, 'created_at' | 'updated_at'>): void;
  updateFileStatus(fileId: string, status: SyncFileStatus, error?: string): void;
  getFilesByStatus(status: SyncFileStatus): SyncFileRow[];
  getFileByKey(fileKey: string): SyncFileRow | null;

  // 폴더
  getFolders(enabledOnly?: boolean): SyncFolderRow[];
  upsertFolder(folder: Partial<SyncFolderRow> & { id: string }): void;
  toggleFolder(folderId: string, enabled: boolean): void;

  // DLQ
  moveToDlq(fileId: string, errorType: string): void;
  getDlqItems(): DlqItemRow[];
  retryDlqItem(id: number): void;

  // 통계
  getStats(from: string, to: string): DailyStat[];
  incrementDailyStats(date: string, success: number, failed: number, bytes: number): void;

  // 생명주기
  initialize(): void;
  close(): void;
  backup(): string;  // 백업 경로 반환
}
```

#### FileDetector

```typescript
interface IFileDetector {
  /** 감지 시작 (3중 전략 스케줄링) */
  start(): void;

  /** 감지 중지 */
  stop(): void;

  /** 즉시 감지 실행 (수동 트리거) */
  forceCheck(): Promise<DetectedFile[]>;

  /** 폴링 간격 변경 */
  setPollingInterval(seconds: number): void;
}
```

#### EventBus

```typescript
interface IEventBus {
  /** 타입 안전 이벤트 발행 */
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void;

  /** 타입 안전 이벤트 구독 */
  on<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): void;

  /** 구독 해제 */
  off<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): void;

  /** 일회성 구독 */
  once<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): void;

  /** 모든 구독 해제 */
  removeAllListeners(): void;
}
```

#### RetryManager

```typescript
interface IRetryManager {
  /** 재시도 가능한 함수 실행. 실패 시 정책에 따라 재시도/DLQ 이동 */
  execute<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>;

  /** 서킷 브레이커 상태 조회 */
  getCircuitState(): CircuitState;

  /** DLQ 아이템 조회 */
  getDlqItems(): DlqItem[];

  /** DLQ 단일 재시도 */
  retryDlqItem(id: number): Promise<void>;

  /** DLQ 전체 재시도 */
  retryAllDlq(): Promise<BatchResult>;
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface RetryOptions {
  maxRetries: number;      // 기본 3
  baseDelay: number;       // 기본 1000ms
  maxDelay: number;        // 기본 10000ms
  backoffMultiplier: number; // 기본 3
  context?: string;        // 로깅용 컨텍스트
}
```

#### ConfigManager

```typescript
interface IConfigManager {
  get<K extends keyof AppConfig>(key: K): AppConfig[K];
  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void;
  getAll(): AppConfig;
  validate(): ValidationResult;
  reset(): void;
  onChanged<K extends keyof AppConfig>(key: K, handler: (value: AppConfig[K]) => void): void;
}

interface AppConfig {
  lguplusId: string;
  lguplusPassword: string;           // 암호화 저장
  webhardApiUrl: string;
  webhardApiKey: string;             // 암호화 저장
  pollingIntervalSec: number;        // 기본 5
  maxConcurrentDownloads: number;    // 기본 5
  maxConcurrentUploads: number;      // 기본 3
  tempDownloadPath: string;
  enableInAppNotification: boolean;  // 기본 true
  enableToastNotification: boolean;  // 기본 true
  autoStart: boolean;                // 기본 true
  logRetentionDays: number;          // 기본 30
  startMinimized: boolean;           // 기본 false
}
```

#### NotificationService

```typescript
interface INotificationService {
  notify(notification: NotificationInput): Promise<string>;  // id 반환
  getNotifications(filter?: NotificationFilter): AppNotification[];
  getUnreadCount(): number;
  markRead(id: string): void;
  markAllRead(): void;
  clearOld(daysOld: number): number;  // 삭제 건수 반환
}

interface IOsNotifier {
  show(title: string, body: string, options?: OsNotifierOptions): void;
}
```

### 5.2 스펙 의존 관계도

```
┌─────────────────────────────────────────────────────────┐
│                  스펙 의존 관계도                          │
│                  (정의 순서 = 위 → 아래)                   │
└─────────────────────────────────────────────────────────┘

  Level 0: 독립 스펙 (의존 없음)
  ┌───────────┐  ┌───────────┐  ┌───────────┐
  │ EventMap  │  │ ErrorTypes│  │ AppConfig │
  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
        │              │              │
  Level 1: 기반 스펙
  ┌─────▼─────┐  ┌─────▼───────────▼─────┐
  │ IEventBus │  │     IStateManager      │
  └─────┬─────┘  └────────┬──────────────┘
        │                 │
  Level 2: 도메인 스펙
  ┌─────▼─────────────────▼─────┐
  │ IConfigManager              │
  └──────┬──────────────────────┘
         │
  ┌──────▼──────┐  ┌────────────────┐
  │IRetryManager│  │ IFileDetector  │
  └──────┬──────┘  └───────┬────────┘
         │                 │
  ┌──────▼──────┐  ┌───────▼────────┐
  │ILGUplusClient│ │IWebhardUploader│
  └──────┬──────┘  └───────┬────────┘
         │                 │
  Level 3: 오케스트레이터 스펙
  ┌──────▼─────────────────▼────┐
  │       ISyncEngine           │
  └─────────────────────────────┘
         │
  Level 4: IPC 스펙
  ┌──────▼─────────────────────┐
  │ IpcHandlers + IpcEvents    │
  └────────────────────────────┘
```

**정의 순서 규칙**: 상위 Level의 스펙을 먼저 정의한 후 하위 Level을 정의한다. 이를 통해 스펙 간 의존성이 항상 해결된 상태를 유지한다.

---

## 6. 스펙 → 구현 매핑 규칙

### 6.1 매핑 원칙

| 원칙 | 설명 | 위반 예시 |
|------|------|----------|
| **스펙 선행** | 인터페이스 정의 파일이 구현 파일보다 먼저 커밋 | 구현 먼저 작성 후 인터페이스 추출 |
| **1:1 대응** | 하나의 인터페이스에 하나의 구현체 | 인터페이스 없는 클래스 |
| **implements 강제** | 구현 클래스는 반드시 `implements I*` | `implements` 없이 암묵적 구조 일치 |
| **타입 재사용** | 스펙 타입을 구현에서 직접 import | 구현에서 동일 타입을 재정의 |
| **스펙 변경 우선** | 구현 변경이 필요하면 스펙을 먼저 변경 | 구현만 변경하고 스펙은 방치 |

### 6.2 파일 매핑 테이블

| 스펙 파일 | 구현 파일 | 관계 |
|----------|----------|------|
| `core/types/sync.types.ts` | `core/sync-engine.ts` | ISyncEngine → SyncEngine |
| `core/types/lguplus.types.ts` | `core/lguplus-client.ts` | ILGUplusClient → LGUplusClient |
| `core/types/webhard.types.ts` | `core/webhard-uploader/yjlaser-uploader.ts` | IWebhardUploader → YjlaserUploader |
| `core/types/events.types.ts` | `core/event-bus.ts` | EventMap → EventBus |
| `core/errors/index.ts` | 각 모듈 | SyncAppError 서브클래스 throw |
| `core/db/schema.ts` | `core/state-manager.ts` | Row 타입 → SQL 쿼리 |
| `shared/ipc-types.ts` | `main/ipc/*.handler.ts` | IpcHandlers → 핸들러 |
| `shared/ipc-types.ts` | `renderer/hooks/useIpc.ts` | IpcHandlers → invoke 래퍼 |
| `shared/ipc-types.ts` | `renderer/stores/*.store.ts` | IpcEvents → 이벤트 구독 |

### 6.3 Git 커밋 컨벤션

SDD 워크플로우를 Git 히스토리에 반영하기 위한 커밋 컨벤션:

```
# Phase 1: 스펙 정의
spec(core): ISyncEngine 인터페이스 및 관련 타입 정의
spec(ipc): sync 채널 IPC 계약 추가
spec(db): sync_files 테이블 스키마 추가
spec(error): 네트워크 에러 클래스 추가

# Phase 3: 테스트
test(core): SyncEngine 단위 테스트 스켈레톤 작성

# Phase 4: 구현
feat(core): SyncEngine 구현
feat(main): sync IPC 핸들러 구현

# Phase 5: 스펙 변경
spec!(core): ISyncEngine.fullSync 반환 타입 변경 (BREAKING)
```

| 접두사 | 용도 |
|-------|------|
| `spec()` | 스펙 파일 추가/변경 |
| `spec!()` | 스펙 Breaking Change |
| `test()` | 테스트 작성 |
| `feat()` | 구현 |
| `fix()` | 버그 수정 |
| `refactor()` | 스펙 변경 없는 내부 리팩토링 |

---

## 7. 스펙 변경 관리

### 7.1 변경 분류

| 분류 | 정의 | 영향 | 처리 |
|------|------|------|------|
| **호환 변경** | 기존 계약 유지하며 확장 | 기존 구현 수정 불필요 | 스펙 추가 → 구현 추가 |
| **비호환 변경** | 기존 계약 변경/삭제 | 기존 구현 수정 필요 | 스펙 변경 → 영향 분석 → 구현 수정 |

### 7.2 호환 변경 예시

```typescript
// Before
interface ISyncEngine {
  start(): Promise<void>;
  stop(): Promise<void>;
}

// After (호환 — 새 메서드 추가)
interface ISyncEngine {
  start(): Promise<void>;
  stop(): Promise<void>;
  getMetrics(): SyncMetrics;  // 추가 (기존 구현 영향 없음)
}
```

### 7.3 비호환 변경 예시

```typescript
// Before
interface ISyncEngine {
  fullSync(): Promise<FullSyncResult>;
}

// After (비호환 — 파라미터 필수 추가)
interface ISyncEngine {
  fullSync(options: FullSyncOptions): Promise<FullSyncResult>;  // 변경
}
```

### 7.4 비호환 변경 프로세스

```
1. 스펙 변경 사유 문서화 (커밋 메시지 또는 PR 본문)
2. 영향 분석:
   - tsc --noEmit 실행 → 컴파일 에러 목록 확인
   - 영향받는 구현체, 테스트, IPC 핸들러 목록화
3. 스펙 변경 커밋 (spec!)
4. 영향받는 구현체 일괄 수정
5. 테스트 수정 및 통과 확인
6. 구현 커밋 (feat/fix)
```

### 7.5 tsc를 활용한 영향 분석

비호환 스펙 변경 시, TypeScript 컴파일러가 **자동으로 영향 범위를 식별**한다:

```bash
# 스펙 변경 후 컴파일 에러 확인
npx tsc --noEmit 2>&1 | grep "error TS"

# 출력 예시:
# src/core/sync-engine.ts(45,5): error TS2416: ... not assignable to ...
# src/main/ipc/sync.handler.ts(12,3): error TS2345: ... not assignable ...
# src/core/sync-engine.test.ts(30,7): error TS2554: Expected 1 arguments, but got 0

# → sync-engine.ts, sync.handler.ts, sync-engine.test.ts 수정 필요
```

이것이 SDD의 핵심 장점이다: **스펙을 변경하면 컴파일러가 수정이 필요한 모든 위치를 알려준다.**

---

## 8. 검증 체크리스트

### 8.1 기능 개발 완료 시 검증

구현 완료 후, 다음 체크리스트로 스펙 적합성을 검증한다:

#### 타입 적합성

- [ ] `tsc --noEmit` 에러 0건
- [ ] 구현 클래스가 `implements I*` 선언
- [ ] 모든 인터페이스 메서드 구현 완료
- [ ] 반환 타입이 스펙과 일치
- [ ] `@throws` JSDoc에 명시된 에러만 throw

#### IPC 적합성

- [ ] 새 IPC 채널이 `IpcHandlers` 또는 `IpcEvents`에 타입 정의됨
- [ ] Main 핸들러의 반환 타입이 IPC 스펙과 일치
- [ ] Renderer의 invoke 호출이 IPC 스펙 타입 사용

#### DB 적합성

- [ ] 새 테이블/컬럼이 `schema.ts`에 정의됨
- [ ] Row 타입이 SQL 스키마와 1:1 대응
- [ ] 마이그레이션 파일 작성 완료
- [ ] status 컬럼 값이 TypeScript union 타입으로 제한

#### 이벤트 적합성

- [ ] 새 이벤트가 `EventMap`에 타입 정의됨
- [ ] emit 호출의 payload가 EventMap 타입과 일치
- [ ] 주요 상태 변경에 대응하는 이벤트가 emit됨

#### 에러 적합성

- [ ] 새 에러 코드가 에러 클래스로 정의됨
- [ ] retryable 속성이 정확
- [ ] 에러 처리 정책(02-아키텍처 9장)과 일치

#### 테스트 적합성

- [ ] 인터페이스의 각 메서드에 대한 테스트 존재
- [ ] 정상 경로 + 에러 경로 테스트 존재
- [ ] Mock이 인터페이스 기반으로 작성됨
- [ ] `vitest run` 전체 통과

### 8.2 자동화 검증 스크립트

```bash
#!/bin/bash
# scripts/verify-spec-compliance.sh

echo "=== SDD 스펙 적합성 검증 ==="

echo "[1/4] 타입 체크..."
npx tsc --noEmit
if [ $? -ne 0 ]; then echo "FAIL: 타입 에러 존재"; exit 1; fi

echo "[2/4] 린트..."
npx eslint src/ --max-warnings 0
if [ $? -ne 0 ]; then echo "FAIL: 린트 에러 존재"; exit 1; fi

echo "[3/4] 테스트..."
npx vitest run --reporter=verbose
if [ $? -ne 0 ]; then echo "FAIL: 테스트 실패"; exit 1; fi

echo "[4/4] 순환 의존 체크..."
npx madge --circular src/core/types/ src/shared/
if [ $? -ne 0 ]; then echo "WARN: 순환 의존 발견"; fi

echo "=== 모든 검증 통과 ==="
```

---

## 9. DDD + SDD 통합 전략

### 9.1 통합 모델

DDD와 SDD는 **상호 보완적**이다. DDD가 "무엇을 모델링할 것인가"를 결정하고, SDD가 "모델을 어떻게 명세하고 구현할 것인가"를 결정한다.

```
┌──────────────────────────────────────────────────────┐
│                DDD + SDD 통합 모델                     │
└──────────────────────────────────────────────────────┘

  DDD (도메인 설계)                 SDD (스펙 주도 구현)
  ─────────────────                ──────────────────────
  Bounded Context 식별      ──▶    모듈 경계 스펙 정의
  Aggregate/Entity 모델링   ──▶    인터페이스 + 타입 스펙
  Domain Event 설계         ──▶    EventMap 스펙
  Repository 패턴           ──▶    IStateManager 인터페이스 스펙
  Ubiquitous Language       ──▶    타입명/필드명 표준화
  Anti-Corruption Layer     ──▶    외부 API 인터페이스 스펙
```

### 9.2 Bounded Context → 스펙 그룹 매핑

| Bounded Context | 스펙 파일 그룹 | 핵심 인터페이스 |
|----------------|--------------|----------------|
| **Sync (동기화)** | `sync.types.ts` | `ISyncEngine`, `EngineStatus`, `SyncResult` |
| **Detection (감지)** | `sync.types.ts` | `IFileDetector`, `DetectedFile`, `DetectionStrategy` |
| **Auth (인증)** | `lguplus.types.ts` | `ILGUplusClient`, `LoginResult`, `SessionStatus` |
| **Storage (저장)** | `webhard.types.ts` | `IWebhardUploader`, `UploadParams`, `UploadResult` |
| **Persistence (영속)** | `db/schema.ts` | `IStateManager`, `SyncFileRow`, `SyncFolderRow` |
| **Queue (큐)** | `sync.types.ts` | `IRetryManager`, `RetryOptions`, `DlqItem` |
| **Notification (알림)** | `notification.types.ts` | `INotificationService`, `IOsNotifier` |
| **Config (설정)** | `config.types.ts` | `IConfigManager`, `AppConfig` |

### 9.3 DDD 전술 패턴과 SDD 스펙의 대응

| DDD 전술 패턴 | SDD에서의 표현 | 예시 |
|--------------|--------------|------|
| **Entity** | 인터페이스 + id 필드 | `SyncFileRow { id: string; ... }` |
| **Value Object** | 불변 타입 (readonly) | `type FileKey = string` (path+size+mtime 해시) |
| **Aggregate Root** | 최상위 인터페이스 | `ISyncEngine` (다른 모듈은 이것만 호출) |
| **Domain Service** | 인터페이스 메서드 | `ISyncEngine.fullSync()` |
| **Repository** | 데이터 접근 인터페이스 | `IStateManager.getFilesByStatus()` |
| **Domain Event** | EventMap 엔트리 | `EventMap['sync:completed']` |
| **Factory** | 팩토리 함수 타입 | `createCoreModules(): CoreModules` |
| **Anti-Corruption** | 외부 API 인터페이스 | `ILGUplusClient` (LGU+ API 추상화) |

### 9.4 실천 가이드: 새 기능 개발 시

**예시: "동기화 일시정지 중 수동 단일 파일 동기화" 기능 추가**

```
Step 1 (DDD): 도메인 분석
  - 어떤 Bounded Context에 속하는가? → Sync
  - 기존 Aggregate에 추가 가능한가? → ISyncEngine에 메서드 추가
  - 새 Entity/VO가 필요한가? → 아니오
  - 새 Domain Event가 필요한가? → sync:manualFileQueued

Step 2 (SDD): 스펙 정의
  2.1 ISyncEngine에 syncFile(fileId: string) 메서드 추가
  2.2 SyncResult 타입 정의
  2.3 EventMap에 'sync:manualFileQueued' 추가
  2.4 IpcHandlers에 'sync:syncFile' 채널 추가
  2.5 에러 케이스 정의 (파일 미존재, 이미 진행 중)

Step 3 (SDD): 스펙 커밋
  git commit -m "spec(core): ISyncEngine.syncFile 인터페이스 추가"

Step 4 (TDD): 테스트 작성
  - syncFile 정상 호출 테스트
  - 존재하지 않는 fileId 에러 테스트
  - PAUSED 상태에서 호출 허용 테스트

Step 5 (SDD): 구현
  - SyncEngine.syncFile() 구현
  - sync.handler.ts에 IPC 핸들러 추가
  - Renderer에서 호출 UI 추가

Step 6 (SDD): 검증
  - tsc --noEmit 통과
  - vitest run 통과
  - 체크리스트 확인
```

### 9.5 요약: DDD + SDD 워크플로우

```
┌────────────────────────────────────────────────────────────────┐
│              DDD + SDD 통합 워크플로우                            │
│                                                                │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐     │
│  │  DDD    │    │  SDD    │    │  TDD    │    │  SDD    │     │
│  │ 도메인   │───▶│ 스펙    │───▶│ 테스트  │───▶│ 구현    │     │
│  │ 분석    │    │ 정의    │    │ 작성    │    │         │     │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘     │
│       │              │              │              │           │
│       │              ▼              │              ▼           │
│       │         tsc 검증            │         tsc + vitest    │
│       │              │              │              │           │
│       │              ▼              │              ▼           │
│       └──── 스펙 변경 필요 시 ◀──────┴──── 적합성 검증 ────────│
│                                                                │
│  "도메인을 이해하고 → 계약을 정의하고 → 테스트로 검증하고 →       │
│   구현을 도출한다. 변경이 필요하면 스펙부터 바꾼다."              │
└────────────────────────────────────────────────────────────────┘
```

---

## 부록: 용어 정리

| 용어 | 정의 |
|------|------|
| **스펙 (Specification)** | 모듈의 입출력, 행위, 제약을 TypeScript 인터페이스/타입으로 명세한 것 |
| **계약 (Contract)** | 두 모듈 간 합의된 인터페이스. 양쪽이 준수해야 하는 약속 |
| **호환 변경** | 기존 계약을 유지하면서 확장하는 스펙 변경 |
| **비호환 변경** | 기존 계약을 깨뜨리는 스펙 변경 (Breaking Change) |
| **스펙 선행** | 구현보다 스펙을 먼저 작성하는 원칙 |
| **적합성 검증** | 구현이 스펙에 부합하는지 확인하는 절차 (tsc, vitest) |
| **단일 진실 공급원** | 스펙 파일이 계약의 유일한 정의 위치라는 원칙 |
