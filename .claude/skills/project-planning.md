---
name: project-planning
description: Structured planning before feature work or bug fixes. Triggers on "계획", "plan", "설계".
---

# Project Planning

Create a structured plan before feature or bugfix work to prevent context waste and direction changes.

## Procedure

### 1. Status Check (5 min)
1. Read `docs/progress.txt` for current state
2. Read `docs/features-list.md` for related feature status
3. Explore related code at symbol level (no full file reads)

### 2. Impact Analysis (5 min)
1. List files to be changed
2. Identify dependencies (which services are affected)
3. Check test files (do existing tests cover this?)

### 3. Write Plan Document
Create `docs/plans/YYYY-MM-DD-{work-name}.md`:

```markdown
# Work Name

## Goal
One-line summary

## Change Plan
| # | File | Change | Risk |
|---|------|--------|------|
| 1 | ... | ... | ... |

## Test Plan
- Existing test impact: ...
- New tests needed: ...

## Done Criteria
- [ ] Criterion 1
- [ ] Criterion 2
```

### 4. User Confirmation
Show plan to user and start work after approval.

## Notes
- Large specs (500+ lines) in `docs/plans/`: partial reads only
- Keep plan documents under 200 lines
- Never start code changes without a plan
