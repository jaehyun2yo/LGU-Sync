---
description: "Realtime detection multi-agent team. Triggers: 감지 팀, 감지팀"
---

# Realtime Detection Team

Read and execute the full team skill procedure at `.claude/skills/realtime-detection-team.md`.

## Quick Reference

**Team composition**: Leader (opus) + polling-analyst + event-analyst + implementer + tester (all sonnet)
**Domain**: FileDetector polling -> EventBus -> IPC -> Renderer, operCode handling

## Procedure
1. Read `.claude/skills/realtime-detection-team.md` in full
2. Follow the 5-step execution procedure exactly
3. Use TeamCreate, TaskCreate, Agent to orchestrate
4. Write work log on completion

## Arguments
Pass the user's full request as the team's task description.
