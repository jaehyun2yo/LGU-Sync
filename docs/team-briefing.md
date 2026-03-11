# LGU-Sync Team Briefing

## Project
LGU+ external webhard (only.webhard.co.kr) -> YJ Laser self-hosted webhard (yjlaser.net), one-way file sync Electron desktop app.

## Architecture
Electron 3-process: Main (lifecycle, IPC, tray) + Preload (contextBridge) + Renderer (React 19 + Zustand)

Core service flow:
```
FileDetector(polling) -> EventBus -> SyncEngine -> LGUplusClient(download) -> YjlaserUploader(upload) -> StateManager(SQLite)
```

DI container (src/core/container.ts) creates all services. Interface-based design (src/core/types/).

## Key Conventions
- Interface prefix: `I` (ILogger, ISyncEngine)
- Error class: SyncAppError (code/category/retryable)
- DI: factory pattern, no direct instantiation
- IPC types: src/shared/ipc-types.ts (IpcChannelMap + IpcEventMap)
- State: Zustand v5 (5 stores in src/renderer/stores/)
- No `any` types. Functions < 50 lines.

## Directory Map
| Path | Purpose |
|------|---------|
| src/core/ | Business logic services |
| src/main/ | Electron main process, IPC router |
| src/preload/ | Context bridge (window.electronAPI) |
| src/renderer/ | React UI (pages, components, stores, hooks) |
| src/shared/ | Shared types (IPC channels) |
| tests/ | Vitest + MSW + Playwright |
| docs/plans/ | Spec documents (66 files, split into sub-files) |
| docs/work-logs/ | Change records |

## Tech Stack
- Electron 40, electron-vite 5, TypeScript 5.9 (strict)
- React 19, Tailwind CSS v4, Zustand v5
- better-sqlite3 (DB), Zod v4 (validation)
- Vitest 4 + MSW 2 (tests), Playwright (E2E)

## Before Working
1. Read docs/progress.txt
2. Read docs/features-list.md
3. Read relevant spec in docs/plans/ (use index -> sub-file, never full parent)

## Commands
```
npm run dev | npm run build | npm run test | npm run typecheck | npm run lint
```

## State Transitions
```
detected -> downloading -> downloaded -> uploading -> completed
                |                          |
            dl_failed                  ul_failed
```

## DB Tables
- sync_files: file sync state tracking
- sync_folders: monitored folder config
- dlq: dead letter queue for failed items
- sync_events: event audit log
- folder_changes: operCode-based folder change history
- detection_checkpoints: polling checkpoint (last_history_no)
