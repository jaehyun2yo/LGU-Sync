# Team Protocol — All Agents Must Follow

These rules apply to ALL agents (main, subagents, team members).

---

## 1. Session & Progress Awareness

Before starting work:
1. Read `docs/progress.txt` for current project status
2. Read `docs/features-list.md` for feature tracking
3. `git log --oneline -5` for recent changes

After completing work:
1. Update `docs/progress.txt` (completed/in-progress/next)
2. Write work log if feature work or bug fix (see section 7)
3. Update `CHANGELOG.md` [Unreleased] section

---

## 2. Coding Conventions

| Rule | Detail |
|------|--------|
| Interface prefix | `I` prefix (ILogger, ISyncEngine, IStateManager) |
| Error hierarchy | `SyncAppError` base class with `code`/`category`/`retryable` |
| DI pattern | Factory in `container.ts`, inject interfaces, no direct instantiation |
| IPC types | All channels defined in `src/shared/ipc-types.ts` (IpcChannelMap + IpcEventMap) |
| State stores | Zustand v5, 5 stores in `src/renderer/stores/` |
| No `any` | Use proper types or `unknown` |
| Function length | Max 50 lines per function/method |
| Korean UI | UI text in Korean, code/comments/commits in English allowed |

---

## 3. Quality Verification Pipeline

Run these checks **in order** after code changes:

```bash
# Step 1: Type check
npm run typecheck

# Step 2: Lint
npm run lint
# If fails: npm run lint:fix, then fix remaining manually

# Step 3: Tests
npm run test                              # All unit tests
npx vitest run tests/core/some.test.ts    # Specific test file
npm run test:integration                  # Integration tests (live server)
```

**Failure protocol:** Fix the issue, then re-run from Step 1. Never skip a step.

---

## 4. Code Review Checklist

When reviewing or writing code, verify:

### Type Safety
- [ ] No `any` types
- [ ] No unnecessary type assertions (`as`)
- [ ] Interface `I` prefix convention

### Architecture
- [ ] `SyncAppError` hierarchy for errors (not raw Error/throw)
- [ ] DI pattern: interface injection, not direct dependencies
- [ ] No direct instantiation of services (use container.ts)

### IPC
- [ ] New channels defined in `src/shared/ipc-types.ts`
- [ ] Channel names match between main/preload/renderer

### Performance & Safety
- [ ] Event listener cleanup (no leaks in EventBus subscriptions)
- [ ] SQLite connection handling (proper WAL mode, no concurrent write issues)
- [ ] No unnecessary re-renders (React)
- [ ] No hardcoded credentials, SQL injection, or XSS

### EventBus Changes (4-Layer Simultaneous Edit)
If modifying EventBus events, ALL 4 layers must be updated together:
1. Type definitions: `src/core/types/events.types.ts`
2. Implementation: `src/core/event-bus.ts`
3. IPC bridge: `src/main/ipc-router.ts` (bridgeEventsToRenderer)
4. Renderer store: `src/renderer/stores/sync-store.ts`

---

## 5. Bug Analysis Procedure

### Data Flow to Trace
```
FileDetector(polling) -> EventBus -> SyncEngine -> LGUplusClient(download) -> YjlaserUploader(upload) -> StateManager(SQLite)
```

### Common Bug Patterns
1. **Circuit breaker tripped** — RetryManager state, check lguplus-download/webhard-upload circuits
2. **SQLite locking** — concurrent access to state DB, check StateManager transactions
3. **IPC channel mismatch** — channel name typo between main/preload/renderer
4. **Polling race condition** — FileDetector concurrent polls, check dedup logic
5. **Encoding issues** — LGU+ API Korean filename encoding (EUC-KR vs UTF-8)
6. **Event listener leak** — EventBus subscriptions without cleanup

### State Transitions
```
detected -> downloading -> downloaded -> uploading -> completed
                |                          |
            dl_failed                  ul_failed
                |                          |
              (DLQ)                      (DLQ)
```

### Procedure
1. Extract error keywords -> Grep related code
2. Trace data flow (which stage fails?)
3. Form 3 hypotheses ranked by likelihood
4. Verify top hypothesis, then fix

---

## 6. Key File Map

| Component | File | Role |
|-----------|------|------|
| FileDetector | `src/core/file-detector.ts` | LGU+ webhard change polling, checkpoint-based detection |
| SyncEngine | `src/core/sync-engine.ts` | Sync orchestration, state machine, operCode handling |
| LGUplusClient | `src/core/lguplus-client.ts` | LGU+ REST API, session/cookie mgmt, download |
| YjlaserUploader | `src/core/webhard-uploader/yjlaser-uploader.ts` | Self-webhard upload, folder path creation |
| StateManager | `src/core/state-manager.ts` | SQLite WAL, sync_files/sync_folders/dlq management |
| RetryManager | `src/core/retry-manager.ts` | Circuit breaker (lguplus-download, webhard-upload) |
| EventBus | `src/core/event-bus.ts` | Event pub-sub (Map-based) |
| Container | `src/core/container.ts` | DI factory |
| Errors | `src/core/errors/index.ts` | SyncAppError hierarchy |
| IPC Router | `src/main/ipc-router.ts` | IPC handlers, event bridge |
| IPC Types | `src/shared/ipc-types.ts` | Channel definitions |

---

## 7. Work Log Rules

After **feature work or bug fixes** (not config/formatting changes), write:

**File:** `docs/work-logs/NNN-work-name.md`
- NNN: 3-digit sequence (check `ls docs/work-logs/ | tail -1` for last number)
- Name: Korean kebab-case, concise

**Template:**
```markdown
# NNN. Work Name

- **Date:** YYYY-MM-DD
- **Branch:** feature/xxx (if applicable)

## Summary
1-3 line summary

## Changed Files
- `path/file.ts` — change description

## Key Decisions
Why this approach, alternatives considered

## Verification
- typecheck / lint / test results
```

---

## 8. Spec-Code Sync

After modifying code, check if a matching plan exists in `docs/plans/`:
- Core service changes -> `docs/plans/04-동기화엔진/`
- UI changes -> `docs/plans/05-GUI-UX/`
- API changes -> `docs/plans/06-API-인터페이스-설계서.md`

If code diverges from spec: note in work-log and update spec.

**New features require a plan first** — create in `docs/plans/` before implementation.

---

## 9. Cross-Domain Warnings

Changes to these shared components affect BOTH download and detection domains:
- `SyncEngine` (startFileSync, enqueueFileSync, handleDetectedFiles)
- `StateManager` (saveFile, checkpoint, folder changes)
- `EventBus` (EventMap, emit/subscribe)
- `FileDetector` (polling, operCode classification)

When editing shared components, check issue catalogs for both domains:
- `.claude/skills/supporting/download-pipeline-issues.md`
- `.claude/skills/supporting/realtime-detection-issues.md`

---

## 10. DB Schema Reference

| Table | Purpose |
|-------|---------|
| sync_files | File sync state (status, paths, retry_count, errors) |
| sync_folders | Monitored folder config (lguplus_folder_id, company_name) |
| dlq | Dead letter queue (failure_reason, can_retry, next_retry_at) |
| sync_events | Event audit log |
| folder_changes | operCode-based folder change history |
| detection_checkpoints | Polling checkpoint (last_history_no) |

---

## 11. OperCode Reference

| Code | Target | Action |
|------|--------|--------|
| UP | File upload | enqueueFileSync (download+upload) |
| CP | File copy | enqueueFileSync |
| D | File delete | saveFolderChange (log) |
| MV | File move | saveFolderChange (log) |
| RN | File rename | saveFolderChange (log) |
| FC | Folder create | saveFolderChange (log) |
| FD | Folder delete | saveFolderChange (log) |
| FMV | Folder move | saveFolderChange (log) |
| FRN | Folder rename | saveFolderChange (log) |
| DN | File download | **Filtered out** (self-download) |
