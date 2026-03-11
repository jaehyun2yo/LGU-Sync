# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

One-way file sync Electron desktop app: LGU+ external webhard (`only.webhard.co.kr`) -> YJ Laser self-hosted webhard (`yjlaser.net`).

## Commands

```bash
npm run dev              # Dev server (HMR)
npm run build            # Production build
npm run lint             # ESLint
npm run lint:fix         # ESLint auto-fix
npm run format           # Prettier
npm run typecheck        # TypeScript type check
npm run test             # Vitest unit tests (single run)
npm run test:watch       # Vitest watch mode
npm run test:coverage    # Coverage report
npx vitest run tests/core/some.test.ts  # Single test file
npm run test:integration # Integration tests (live server)
npm run test:e2e         # Playwright E2E tests
npm run rebuild          # Rebuild better-sqlite3 native module
npm run dist             # NSIS installer (Windows x64)
```

## Architecture

### Electron 3-Process Model

- **Main Process** (`src/main/`): App lifecycle, IPC router, tray, window management
- **Preload** (`src/preload/`): `contextBridge` exposes `window.electronAPI` (type-safe)
- **Renderer** (`src/renderer/`): React 19 + Zustand + Tailwind CSS v4 UI

### Core Services (`src/core/`)

DI container (`container.ts`) creates all services via factory pattern. Interface-based design (`src/core/types/`) enables easy mock replacement.

Service flow:
```
FileDetector(polling) -> EventBus -> SyncEngine -> LGUplusClient(download) -> YjlaserUploader(upload) -> StateManager(SQLite)
```

### IPC Communication

- **Type definitions**: `src/shared/ipc-types.ts` — `IpcChannelMap` (invoke/handle) + `IpcEventMap` (push)
- **Renderer->Main**: `window.electronAPI.invoke(channel, request)` -> `ApiResponse<T>`
- **Main->Renderer**: `EventBus` events -> `win.webContents.send()` bridge (`ipc-router.ts`)
- **Renderer hooks**: `useIpc` (invoke wrapper), `useIpcEvent` (push event subscription)

### UI Routing

No React Router. Zustand `ui-store`'s `currentPage` state drives switch-based page rendering in `App.tsx`.

### State Management

5 Zustand v5 stores: `sync-store`, `log-store`, `settings-store`, `notification-store`, `ui-store` (`src/renderer/stores/`)

## Tech Stack

- Electron 40, electron-vite 5 (Vite-based build)
- TypeScript 5.9 (strict), React 19, Tailwind CSS v4
- better-sqlite3 (DB), Zod v4 (validation)
- Vitest 4 + MSW 2 (tests), Playwright (E2E)

## Conventions

- All service interfaces use `I` prefix (`ILogger`, `ISyncEngine`, etc.)
- Error hierarchy: `SyncAppError` abstract base class with `code`/`category`/`retryable`
- `RetryManager` manages circuit breakers for `lguplus-download`, `webhard-upload` circuits
- Korean UI/docs (electron-builder language code 1042)

## Test Structure

- `tests/core/`: Unit tests (vitest, node env)
- `tests/main/`: IPC router tests
- `tests/renderer/`: Renderer util tests
- `tests/mocks/`: MSW handlers (lguplus, yjlaser API mocks)
- `tests/e2e/`: Playwright (serial execution, 1 worker)

## Session Protocol

### On Start
1. Read `docs/progress.txt` for current status
2. `git log --oneline -10` for recent work
3. Resume from incomplete items

### On End
1. Update `docs/progress.txt` (completed/incomplete items)
2. Write work log (`docs/work-logs/`)
3. Clean up uncommitted changes

## Context Management

- Large specs (500+ lines) in `docs/plans/`: read only needed sections via offset/limit
- Prefer symbol-based tools over full file reads

### Split Specs
These specs are split into index + sub-files (each sub-file < 500 lines):
- `docs/plans/01-PRD/` (5 files), `docs/plans/04-동기화엔진/` (7 files)
- `docs/plans/05-GUI-UX/` (5 files), `docs/plans/07-테스트케이스/` (6 files)
- `docs/plans/10-SDD/` (6 files)
- Read index file first, then only the relevant sub-file

## Skills & Commands

### Skill Triggers

| Keyword | Skill | Description |
|---------|-------|-------------|
| "다운로드 팀", "다운로드팀" | `download-pipeline-team` | Download pipeline multi-agent team |
| "감지 팀", "감지팀" | `realtime-detection-team` | Realtime detection multi-agent team |
| "웹하드팀", "웹하드 팀" | `webhard-team` | Webhard dedicated agent team |
| "계획", "plan", "설계" | `project-planning` | Structured work planning |
| "세션정리", "마무리", "handoff" | `session-handoff` | Session end + handoff |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/check` | typecheck + lint + test sequential run |
| `/review` | Changed code review + refactoring suggestions |
| `/post-code` | Full post-coding pipeline (typecheck -> lint -> test -> review -> handoff) |

## Design Documents

`docs/plans/` contains 10 design docs: PRD, architecture, data structure, sync engine, GUI/UX, API, test cases, etc.

## Work Log Rules

After completing feature work or bug fixes, always write a work document in `docs/work-logs/`.

**Filename format:** `NNN-work-name.md` (e.g., `001-폴더트리-정렬기능.md`)
- NNN: 3-digit sequence (last number + 1)
- Work name: Korean kebab-case, concise

**Template:**
```markdown
# NNN. Work Name

- **Date:** YYYY-MM-DD
- **Branch:** feature/xxx (if applicable)

## Summary
1-3 line summary of changes

## Changed Files
- `path/file.ts` — change description

## Key Decisions
Why this approach was chosen, alternatives considered

## Verification
- typecheck / lint / test results
- Manual verification items
```

**Timing:** Write after commit, while the work branch is still active.
