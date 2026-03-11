---
name: realtime-detection-team
description: Realtime detection (FileDetector -> EventBus -> SyncEngine handling) domain maintenance team. For polling, events, checkpoint, operCode work.
trigger: "감지 팀", "감지팀"
---

# Realtime Detection Maintenance Team

Compose a domain-specialized maintenance team via `TeamCreate` for realtime detection work.

## Execution

### Step 1: Create Team
```
TeamCreate(team_name="realtime-detection", description="Realtime detection maintenance — {user prompt summary}")
```

### Step 2: Analyze Prompt -> Create Tasks
Decompose using the issue catalog (`.claude/skills/supporting/realtime-detection-issues.md`).

**Task decomposition rules:**
- Analysis tasks (polling/concurrency, event chain): **parallel**
- Implementation tasks: **blockedBy** analysis
- Test/verification tasks: **blockedBy** implementation
- Issues in the same dependency group MUST be in the same implementation task

### Step 3: Spawn Team Members (4)

**Model rules:** Team leader (me): `opus` | All members: `sonnet`

#### Spawn Strategy

| Request Type | Members to Spawn |
|-------------|-----------------|
| Polling/concurrency only (DET-C1~C3, M1~M2) | polling-analyst only |
| Event/IPC only (DET-M5~M8) | event-analyst only |
| Complex / full review | both analysts parallel |
| Simple bug (no analysis) | skip analysts, implementer directly |

#### 3-1. polling-analyst + event-analyst (parallel)

**polling-analyst** prompt:
- Specialization: FileDetector polling engine, checkpoint management, race conditions
- Files: `file-detector.ts` (primary), `state-manager.ts` (checkpoint), `sync-engine.ts` (start/stop/subscribe)
- Output: Race condition reproduction scenarios, lock/ordering strategies (2+ alternatives + recommendation)

**event-analyst** prompt:
- Specialization: EventBus -> IPC -> Renderer full event flow, operCode handling
- Files: `event-bus.ts`, `events.types.ts`, `ipc-router.ts` (bridgeEventsToRenderer), `ipc-types.ts`, `sync-store.ts`, `sync-engine.ts` (operCode branches)
- Output: End-to-end flow trace, gap fix proposals, affected subscriber list for EventBus changes

#### 3-2. implementer (after analysis)

Spawn with `mode="plan"`. Must include:
- Rules: I-prefix interfaces, SyncAppError hierarchy
- **EventBus changes require 4-layer simultaneous edit:**
  1. Type definitions (`events.types.ts`)
  2. Implementation (`event-bus.ts`)
  3. IPC bridge (`ipc-router.ts`)
  4. Renderer store (`sync-store.ts`)

#### 3-3. tester (after implementation)

Spawn with `mode="plan"`. Verification process:
1. Static: `npm run typecheck && npm run lint && npm run test`
2. Integration: `npm run test:integration`
3. Full pipeline: `npx tsx tests/integration/connection-test.ts --phase=5 --monitor=30`
4. Filesystem: Download folder files exist, directory structure, file size > 0
5. DB state: detection_checkpoints, sync_files status

Existing test infra:
- `tests/integration/setup.ts`, `folder-detection.test.ts`, `download.test.ts`, `encoding.test.ts`
- `tests/core/file-detector.test.ts`, `file-detector-limitations.test.ts`

### Step 4: Team Leader Role

1. **Monitor TaskList** periodically
2. **Plan approval**: Approve/reject via SendMessage
3. **Architecture decisions**: Concurrency design, operCode policy
4. **Cross-domain coordination**: Prevent conflicts in SyncEngine, StateManager, EventBus shared areas
5. **Final verification**: All tasks done -> run `npm run typecheck && npm run lint && npm run test`

**Plan approval checklist:**
- [ ] Correct file list?
- [ ] Issue dependency groups considered?
- [ ] I-prefix convention?
- [ ] EventBus change = 4-layer simultaneous edit?
- [ ] No cross-domain (download team) impact?
- [ ] Regression risk managed?

### Step 5: Shutdown

All tasks complete + final verification pass:
1. SendMessage(type="shutdown_request") to each member
2. TeamDelete(team_name="realtime-detection")
3. Write work log in `docs/work-logs/`

## Domain Context

> Insert this section into each team member prompt.

### Detection Pipeline
```
LGU+ API (getUploadHistory)
    |
    v
FileDetector (polling, checkpoint comparison)
    |
    +-- EventBus.emit('detection:found') -> IPC -> Renderer (notification)
    |
    +-- onFilesDetected handler -> SyncEngine.handleDetectedFiles()
                                       |
                                       +-- UP/CP -> enqueueFileSync -> downloadOnly -> uploadOnly
                                       +-- D/MV/RN -> saveFolderChange (log)
                                       +-- FC/FD/FRN/FMV -> saveFolderChange (log)
                                       +-- EventBus.emit('opercode:event') -> [UNCONNECTED] Renderer unreachable
```

### Key File Map
| Component | File | Role |
|-----------|------|------|
| FileDetector | `src/core/file-detector.ts` | LGU+ webhard change polling, checkpoint-based incremental detection, operCode classification |
| EventBus | `src/core/event-bus.ts` | Event pub-sub (Map-based) |
| SyncEngine | `src/core/sync-engine.ts` | handleDetectedFiles, startFileSync, operCode branch handling |
| LGUplusClient | `src/core/lguplus-client.ts` | getUploadHistory() — POST /wh (USE_HISTORY) |
| StateManager | `src/core/state-manager.ts` | getCheckpoint/saveCheckpoint — detection_checkpoints table |
| IPC Router | `src/main/ipc-router.ts` | test:realtime-start/stop, bridgeEventsToRenderer |

### OperCode Reference
| Code | Meaning | Target | Action |
|------|---------|--------|--------|
| UP | Upload | File | enqueueFileSync (download+upload) |
| CP | Copy | File | enqueueFileSync |
| D | Delete | File | saveFolderChange (log) |
| MV | Move | File | saveFolderChange (log) |
| RN | Rename | File | saveFolderChange (log, new_path unimplemented) |
| FC | Folder create | Folder | saveFolderChange (log) |
| FD | Folder delete | Folder | saveFolderChange (log) |
| FMV | Folder move | Folder | saveFolderChange (log) |
| FRN | Folder rename | Folder | saveFolderChange (log) |
| DN | Download | File | **Filtered out** (self-download record) |

### EventBus -> Renderer Bridge Status
| EventBus Event | IPC Channel | Status |
|----------------|-------------|--------|
| detection:found | detection:new-files | Connected |
| engine:status | sync:status-changed | Connected |
| sync:progress | sync:progress | Connected |
| file:completed | sync:file-completed | Connected |
| sync:failed | sync:file-failed | Connected |
| opercode:event | — | **UNCONNECTED (gap)** |

### Issue Catalog
Read `.claude/skills/supporting/realtime-detection-issues.md` for the full issue catalog with dependency groups.

### Cross-Domain Warning
Changes to SyncEngine (startFileSync, enqueueFileSync), StateManager (saveFile, checkpoint), or EventBus (EventMap) may affect the download team domain. Check the download team issue catalog too.
