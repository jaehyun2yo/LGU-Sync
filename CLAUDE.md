# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

LGU+ 외부웹하드(`only.webhard.co.kr`) → 유진레이저 자체웹하드(`yjlaser.net`) 단방향 파일 동기화 Electron 데스크톱 앱.

## 개발 명령어

```bash
npm run dev              # 개발 서버 (HMR)
npm run build            # 프로덕션 빌드
npm run lint             # ESLint 검사
npm run lint:fix         # ESLint 자동 수정
npm run format           # Prettier 포맷팅
npm run typecheck        # TypeScript 타입 검사
npm run test             # Vitest 단위 테스트 (1회)
npm run test:watch       # Vitest 워치 모드
npm run test:coverage    # 커버리지 측정
npx vitest run tests/core/some.test.ts  # 단일 테스트 파일 실행
npm run test:e2e         # Playwright E2E 테스트
npm run rebuild          # better-sqlite3 네이티브 모듈 재빌드
npm run dist             # NSIS 인스톨러 생성 (Windows x64)
```

## 아키텍처

### Electron 3-Process 구조

- **Main Process** (`src/main/`): 앱 라이프사이클, IPC 라우터, 트레이, 윈도우 관리
- **Preload** (`src/preload/`): `contextBridge`로 `window.electronAPI` 노출 (타입 안전)
- **Renderer** (`src/renderer/`): React 19 + Zustand + Tailwind CSS v4 UI

### Core 서비스 (`src/core/`)

DI 컨테이너(`container.ts`)가 팩토리 패턴으로 모든 서비스를 생성. 인터페이스 기반 설계(`src/core/types/`)로 테스트 목 교체 용이.

주요 서비스 흐름:
```
FileDetector(폴링) → EventBus → SyncEngine → LGUplusClient(다운로드) → YjlaserUploader(업로드) → StateManager(SQLite 기록)
```

### IPC 통신 패턴

- **타입 정의**: `src/shared/ipc-types.ts`에 `IpcChannelMap`(invoke/handle) + `IpcEventMap`(push) 정의
- **Renderer→Main**: `window.electronAPI.invoke(채널, 요청)` → `ApiResponse<T>`
- **Main→Renderer**: `EventBus` 이벤트 → `win.webContents.send()` 브릿지 (`ipc-router.ts`)
- **Renderer 훅**: `useIpc`(invoke 래퍼), `useIpcEvent`(push 이벤트 구독)

### UI 라우팅

React Router 미사용. Zustand `ui-store`의 `currentPage` 상태로 `App.tsx`에서 switch 기반 페이지 전환.

### 상태 관리

Zustand v5 스토어 5개: `sync-store`, `log-store`, `settings-store`, `notification-store`, `ui-store` (`src/renderer/stores/`)

## 기술 스택

- Electron 40, electron-vite 5 (Vite 기반 빌드)
- TypeScript 5.9 (strict), React 19, Tailwind CSS v4
- better-sqlite3 (DB), Zod v4 (검증)
- Vitest 4 + MSW 2 (테스트), Playwright (E2E)

## 주요 컨벤션

- 모든 서비스 인터페이스는 `I` 접두사 사용 (`ILogger`, `ISyncEngine` 등)
- 에러 계층: `SyncAppError` 추상 클래스 기반, `code`/`category`/`retryable` 속성
- `RetryManager`가 서킷 브레이커 패턴으로 `lguplus-download`, `webhard-upload` 회로 관리
- 한국어 UI/문서 (electron-builder 언어 코드 1042)

## 테스트 구조

- `tests/core/`: 단위 테스트 (vitest, node 환경)
- `tests/main/`: IPC 라우터 테스트
- `tests/renderer/`: 렌더러 유틸 테스트
- `tests/mocks/`: MSW 핸들러 (lguplus, yjlaser API 목)
- `tests/e2e/`: Playwright (직렬 실행, 워커 1개)

## 설계 문서

`docs/plans/`에 PRD, 아키텍처, 데이터구조, 동기화엔진, GUI/UX, API, 테스트케이스 등 10개의 설계 문서 존재.
