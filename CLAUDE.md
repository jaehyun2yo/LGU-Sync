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
npm run test:integration # 실서버 연결 통합 테스트
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

## 세션 프로토콜

### 시작 시
1. `docs/progress.txt` 읽어 현재 진행 상황 파악
2. `git log --oneline -10`으로 최근 작업 확인
3. 미완료 항목부터 작업 시작

### 종료 시
1. `docs/progress.txt` 업데이트 (완료/미완료 항목)
2. 작업 로그 작성 (`docs/work-logs/`)
3. 커밋하지 않은 변경사항 정리

## 컨텍스트 관리

- `docs/plans/` 내 대용량 명세서(500줄+)는 필요한 섹션만 offset/limit으로 부분 읽기
- 코드 탐색 시 심볼 기반 도구 우선 사용 (전체 파일 읽기 자제)

### 대용량 명세 분리 완료
아래 명세는 인덱스 + 서브파일로 분리됨 (각 서브파일 500줄 이하):
- `docs/plans/01-PRD/` (5개 파일), `docs/plans/04-동기화엔진/` (7개 파일)
- `docs/plans/05-GUI-UX/` (5개 파일), `docs/plans/07-테스트케이스/` (6개 파일)
- `docs/plans/10-SDD/` (6개 파일)
- 인덱스 파일(`01-PRD-제품요구사항정의서.md` 등)에서 필요한 섹션 링크 확인 후 해당 서브파일만 읽기

## 스킬 & 커맨드

### 스킬 트리거

| 키워드 | 스킬 | 설명 |
|--------|------|------|
| "다운로드 팀", "다운로드팀" | `download-pipeline-team` | 다운로드 파이프라인 멀티에이전트 |
| "감지 팀", "감지팀" | `realtime-detection-team` | 실시간 감지 멀티에이전트 |
| "웹하드팀", "웹하드 팀" | `webhard-team` | 웹하드 전담 에이전트 팀 |
| "계획", "plan", "설계" | `project-planning` | 구조화된 작업 계획 수립 |
| "세션정리", "마무리", "handoff" | `session-handoff` | 세션 종료 + 인수인계 |

### 슬래시 커맨드

| 커맨드 | 설명 |
|--------|------|
| `/check` | typecheck + lint + test 순차 실행 |
| `/review` | 변경 코드 리뷰 + 리팩토링 제안 |
| `/post-code` | 코딩 후 전체 파이프라인 (typecheck → lint → test → 코드리뷰 → 인수인계) |

## 설계 문서

`docs/plans/`에 PRD, 아키텍처, 데이터구조, 동기화엔진, GUI/UX, API, 테스트케이스 등 10개의 설계 문서 존재.

## 작업 기록 규칙

기능 수정 및 개발 완료 후 반드시 `docs/work-logs/`에 작업 문서를 작성한다.

**파일명 형식:** `NNN-작업명.md` (예: `001-폴더트리-정렬기능.md`)
- NNN: 3자리 순번 (기존 파일의 마지막 번호 + 1)
- 작업명: 한글 케밥케이스, 핵심 내용을 간결하게

**문서 템플릿:**
```markdown
# NNN. 작업명

- **날짜:** YYYY-MM-DD
- **브랜치:** feature/xxx (해당 시)

## 변경 요약
변경한 내용을 1~3줄로 요약

## 변경 파일
- `경로/파일.ts` — 변경 설명

## 주요 결정사항
왜 이렇게 구현했는지, 대안이 있었다면 왜 선택하지 않았는지

## 검증
- typecheck / lint / test 결과
- 수동 확인 항목
```

**작성 시점:** 커밋 완료 후, 작업 브랜치가 아직 활성 상태일 때 작성한다.
