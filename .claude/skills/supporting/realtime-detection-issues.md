# Realtime Detection Issue Catalog

## CRITICAL (3)

| ID | Component | File:Line | Issue |
|----|-----------|-----------|-------|
| DET-C1 | SyncEngine | `sync-engine.ts:59-75` | start() duplicate call registers onFilesDetected handler twice -> double processing |
| DET-C2 | SyncEngine | `sync-engine.ts:77-103` | stop() order: detectionUnsubscribe->detector.stop() -> detection event loss |
| DET-C3 | SyncEngine | `sync-engine.ts:220-228` | scanFolder worker pool bypasses global maxConcurrent (detection+fullSync = x2) |

## MAJOR (8)

| ID | Component | File:Line | Issue |
|----|-----------|-----------|-------|
| DET-M1 | FileDetector | `file-detector.ts:214-231` | Backoff recovery stop()->start() recursion -> concurrent polls |
| DET-M2 | FileDetector | `file-detector.ts:99` | isPolling no lock -> interval+forceCheck concurrent execution |
| DET-M3 | FileDetector | `file-detector.ts:104-112` | Baseline from page 1 only -> past items may become max |
| DET-M4 | FileDetector | `file-detector.ts:83` | Guest uploads in history unverified — **core program assumption** |
| DET-M5 | SyncEngine | `sync-engine.ts:563-569` | handleFileRename new_path always equals old_path (no newPath in DetectedFile) |
| DET-M6 | IPC Router | `ipc-router.ts` | opercode:event -> Renderer bridge **not registered** -> recentEvents always empty |
| DET-M7 | SyncEngine | `sync-engine.ts:59-75` | stopped->syncing direct transition (bypasses idle) -> UI state confusion |
| DET-M8 | SyncEngine | `sync-engine.ts` | startFileSync silently skips unregistered folder files (log only, no user alert) |

## MINOR (13)

| ID | Component | File:Line | Issue |
|----|-----------|-----------|-------|
| DET-m1 | FileDetector | `file-detector.ts:198-200` | Unknown operCode fallback without warning log |
| DET-m2 | FileDetector | `file-detector.ts:205` | fileSize always 0 -> UI progress 0%, inaccurate daily_stats |
| DET-m3 | FileDetector | `file-detector.ts:76-83` | Backoff interval change + stop->start recursion = non-deterministic |
| DET-m4 | FileDetector | `file-detector.ts:16` | MAX_POLL_PAGES=10 hardcoded -> 200+ events missed (long offline) |
| DET-m5 | FileDetector | `file-detector.ts:239-243` | Polling errors not emitted via EventBus -> no "disconnected" UI alert |
| DET-m6 | FileDetector | `file-detector.ts:184,188,194` | filePath trailing slash not guarded -> path join errors |
| DET-m7 | EventBus | `event-bus.ts:24-29` | emit handler exception blocks subsequent handlers |
| DET-m8 | EventBus | `event-bus.ts:15-22` | off removes only first of duplicate handlers |
| DET-m9 | EventBus | `events.types.ts:86-89` | IEventBus.on() doesn't return unsubscribe function |
| DET-m10 | SyncEngine | `sync-engine.ts:714-717` | getPathSegments doesn't filter '..' (path traversal) |
| DET-m11 | LGUplusClient | `lguplus-client.ts` | getUploadHistory encoding fallback (EUC-KR) double decode |
| DET-m12 | Renderer | `sync-store.ts` | handleOperCodeEvent ready but never called (related to DET-M6) |
| DET-m13 | IPC Router | `ipc-router.ts` | test:realtime-start engine state restore edge case |

## Issue Dependency Groups

| Group | Issues | Reason |
|-------|--------|--------|
| Concurrency Control | DET-C1, C2, M1, M2, m3 | Polling/subscribe/unsubscribe race conditions cascade |
| OperCode Event Chain | DET-M5, M6, m1, m12 | opercode:event emit->bridge->store->UI full flow |
| Detection Consistency | DET-M3, M4, m4, m6 | Checkpoint/baseline/path consistency |
| EventBus Stability | DET-m7, m8, m9 | Handler safety/unsubscribe pattern consistency |
