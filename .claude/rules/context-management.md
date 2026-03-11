# Context Management Rules

## Thresholds
| Usage | Action |
|-------|--------|
| 0-50% | Work freely |
| 50-70% | Use Grep, avoid full file reads |
| 70-90% | /compact |
| 90%+ | Commit -> progress.txt -> /clear |

## Large Files — Read via Index
These specs are split into sub-files. NEVER read the parent file in full:
- docs/plans/01-PRD-제품요구사항정의서.md -> read docs/plans/01-PRD/01-N-*.md
- docs/plans/04-동기화엔진-설계서.md -> read docs/plans/04-동기화엔진/04-N-*.md
- docs/plans/05-GUI-UX-설계서.md -> read docs/plans/05-GUI-UX/05-N-*.md
- docs/plans/07-테스트케이스-명세서.md -> read docs/plans/07-테스트케이스/07-N-*.md
- docs/plans/10-SDD-개발방법론.md -> read docs/plans/10-SDD/10-N-*.md

Read the index file first (< 50 lines), then the relevant sub-file only.

## Team Skills Context Warning
- download-pipeline-team.md: loads ~250 lines (compressed)
- realtime-detection-team.md: loads ~250 lines (compressed)
- Issue catalogs are in .claude/skills/supporting/ (loaded on demand only)
These consume significant context. Prefer subagents for simple tasks.
