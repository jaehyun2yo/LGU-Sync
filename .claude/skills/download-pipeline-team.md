---
name: download-pipeline-team
description: Download pipeline (external webhard -> local -> self webhard) domain maintenance team. For bug fixes, feature work, code review, debugging.
trigger: "다운로드 팀", "다운로드팀"
---

# Download Pipeline Maintenance Team

Compose a domain-specialized maintenance team via `TeamCreate` for download pipeline work.

## Execution

### Step 1: Create Team
```
TeamCreate(team_name="download-pipeline", description="Download pipeline maintenance — {user prompt summary}")
```

### Step 2: Analyze Prompt -> Create Tasks
Decompose user request into tasks using the issue catalog (`.claude/skills/supporting/download-pipeline-issues.md`).

**Task decomposition rules:**
- Review/analysis tasks: **parallel**
- Implementation tasks: **blockedBy** review/analysis
- Test tasks: **blockedBy** implementation
- Verification tasks: **blockedBy** tests
- Issues in the same dependency group MUST be in the same implementation task

### Step 3: Spawn Team Members (max 5)

**Model rules:** Team leader (me): `opus` | All members: `sonnet`

#### Spawn Strategy

| Request Type | Members to Spawn |
|-------------|-----------------|
| Code review only | reviewer (can parallelize by component) |
| Bug fix | analyzer + implementer + verifier |
| Security fix (SEC-*) | analyzer + reviewer + implementer + verifier |
| Feature completion (IMPL-*) | reviewer + analyzer + implementer + tester + verifier |
| E2E test writing | reviewer + tester |
| Full pipeline fix | all 5 |
| Simple bug (no analysis needed) | implementer + verifier |

#### 3-1. reviewer + analyzer (parallel)

Spawn with `Agent(name, team_name="download-pipeline", model="sonnet")`.

**reviewer** prompt must include:
- Role: code reviewer — review target code, map to issue catalog, find new issues, assess impact scope
- Workflow: TaskList -> claim -> review -> SendMessage to implementer -> TaskUpdate complete

**analyzer** prompt must include:
- Role: analyst — root cause analysis, data flow tracing, state transition verification, security impact
- State transition reference: `detected -> downloading -> downloaded -> uploading -> completed` (+ dl_failed/ul_failed -> DLQ)
- Workflow: TaskList -> claim -> analyze -> SendMessage to implementer -> TaskUpdate complete

#### 3-2. implementer (after analysis)

Spawn with `mode="plan"`. Must include:
- Rules: I-prefix interfaces, SyncAppError hierarchy, reference issue IDs in commit messages
- Workflow: TaskList -> claim -> read analysis results -> write plan -> ExitPlanMode -> await approval -> implement -> SendMessage to tester -> TaskUpdate complete

#### 3-3. tester (after implementation)

Spawn with `mode="plan"`. Must include:
- E2E requirements: actual download verification (file existence + size + integrity), directory structure preservation, zero file skip/miss, download performance metrics
- Test infra: Playwright + Vitest, `tests/e2e/`, test data = LGU+ webhard 00- prefix files
- Workflow: TaskList -> claim -> write plan -> ExitPlanMode -> await approval -> test -> fail = SendMessage to implementer -> TaskUpdate complete

#### 3-4. verifier (after tests)

Must include:
- Verification process: `npm run typecheck` -> `npm run lint` -> `npm run test` -> compare before/after
- Workflow: TaskList -> claim -> verify -> PASS = SendMessage to leader / FAIL = SendMessage to implementer -> TaskUpdate complete

### Step 4: Team Leader Role

1. **Monitor TaskList**: Check task progress periodically
2. **Plan approval**: Approve/reject implementer and tester plans via SendMessage
3. **Security coordination**: For SEC-* fixes, mediate analyzer + implementer consensus
4. **Incomplete feature coordination**: For IMPL-* completion, mediate reviewer + analyzer consensus
5. **Final judgment**: Receive verifier PASS/FAIL -> direct fix loop on FAIL

**Plan approval checklist:**
- [ ] Correct file list?
- [ ] Issue dependency groups considered?
- [ ] I-prefix convention?
- [ ] SyncAppError hierarchy?
- [ ] Security (SEC-*): analyst consensus?
- [ ] No cross-domain (detection team) impact?
- [ ] Regression risk managed?

### Step 5: Shutdown

All tasks complete + verifier PASS:
1. SendMessage(type="shutdown_request") to each member
2. TeamDelete(team_name="download-pipeline")
3. Write work log in `docs/work-logs/`

## Domain Context

> Insert this section into each team member prompt.

### Pipeline Overview
```
FileDetector(polling) -> EventBus -> SyncEngine -> LGUplusClient(download) -> YjlaserUploader(upload) -> StateManager(SQLite)
```

### Key File Map
| Component | File | Role |
|-----------|------|------|
| FileDetector | `src/core/file-detector.ts` | LGU+ webhard change polling, checkpoint-based detection |
| SyncEngine | `src/core/sync-engine.ts` | Sync orchestration (downloadOnly -> uploadOnly), state machine |
| LGUplusClient | `src/core/lguplus-client.ts` | LGU+ REST API, session/cookie mgmt, streaming download (1200+ LOC) |
| YjlaserUploader | `src/core/webhard-uploader/yjlaser-uploader.ts` | Self-webhard upload, folder path creation, R2 presign |
| StateManager | `src/core/state-manager.ts` | SQLite WAL, sync_files/sync_folders/dlq management |
| RetryManager | `src/core/retry-manager.ts` | Circuit breaker (lguplus-download, webhard-upload) |
| EventBus | `src/core/event-bus.ts` | Event pub-sub |
| Container | `src/core/container.ts` | DI factory |
| Errors | `src/core/errors/index.ts` | SyncAppError hierarchy (retryable/code/category) |

### DB Schema
- **sync_files**: id, folder_id(FK), history_no(UNIQUE), file_name, file_path, file_size, lguplus_file_id, status, download_path, self_webhard_file_id, retry_count, last_error
- **sync_folders**: id, lguplus_folder_id, lguplus_folder_name, self_webhard_path, company_name, enabled
- **dlq**: id, file_id, failure_reason, error_code, retry_count, can_retry, next_retry_at

### Issue Catalog
Read `.claude/skills/supporting/download-pipeline-issues.md` for the full 86-issue catalog with dependency groups.

### Cross-Domain Warning
Changes to SyncEngine, StateManager, EventBus, or FileDetector may affect the detection team domain. Check the detection team issue catalog too.
