---
description: "Download pipeline multi-agent team. Triggers: 다운로드 팀, 다운로드팀"
---

# Download Pipeline Team

Read and execute the full team skill procedure at `.claude/skills/download-pipeline-team.md`.

## Quick Reference

**Team composition**: Leader (opus) + reviewer + analyzer + implementer + tester + verifier (all sonnet)
**Domain**: FileDetector -> EventBus -> SyncEngine -> LGUplusClient -> YjlaserUploader -> StateManager

## Procedure
1. Read `.claude/skills/download-pipeline-team.md` in full
2. Follow the 5-step execution procedure exactly
3. Use TeamCreate, TaskCreate, Agent to orchestrate
4. Write work log on completion

## Arguments
Pass the user's full request as the team's task description.
