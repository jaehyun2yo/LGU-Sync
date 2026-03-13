---
name: context-check
description: Monitors context usage and takes corrective action. Triggers on "context", "컨텍스트", "tokens", "slow", "느려졌다".
---

# Context Management

## Thresholds
| Usage | Action |
|-------|--------|
| 0-50% | Work freely |
| 50-70% | Grep only, no full file reads |
| 70-90% | /compact immediately |
| 90%+ | Commit → update progress.txt → /clear |

## "Stuck Loop" Detection
If same fix attempted twice with same result:
1. STOP immediately
2. Commit current state
3. Write analysis in progress.txt (what tried, why failed, which files)
4. /clear → new session → different approach

## Never Read in Full
These specs are split into sub-files. Read the index first, then only the relevant sub-file:
- `docs/plans/01-PRD-제품요구사항정의서.md` → `docs/plans/01-PRD/01-N-*.md`
- `docs/plans/04-동기화엔진-설계서.md` → `docs/plans/04-동기화엔진/04-N-*.md`
- `docs/plans/05-GUI-UX-설계서.md` → `docs/plans/05-GUI-UX/05-N-*.md`
- `docs/plans/07-테스트케이스-명세서.md` → `docs/plans/07-테스트케이스/07-N-*.md`
- `docs/plans/10-SDD-개발방법론.md` → `docs/plans/10-SDD/10-N-*.md`

## Team Skills Context Warning
These skills consume ~250 lines each. Use subagents for simple tasks:
- `.claude/skills/download-pipeline-team.md`
- `.claude/skills/realtime-detection-team.md`
- Issue catalogs in `.claude/skills/supporting/` (load on demand only)

## Session Switch Protocol
Before /clear or session end:
1. `git add` + `git commit` all changes
2. Update `docs/progress.txt` (completed/in-progress/next)
3. Update `CHANGELOG.md` [Unreleased] if applicable
4. Write work log if feature/bug work was done
