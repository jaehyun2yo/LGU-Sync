---
name: session-handoff
description: Save work state and prepare handoff for next session. Triggers on "세션정리", "마무리", "handoff".
---

# Session Handoff

Save current session state and prepare handoff documents for seamless continuation.

## Procedure

### 1. Check Uncommitted Changes
```bash
git status
git diff --stat
```

### 2. Update progress.txt
Update `docs/progress.txt` with current state:
- Mark completed items with `[x]`
- Record specific status for in-progress items
- Add newly discovered bugs to known issues
- Record next steps

### 3. Write Work Log (if changes exist)
Create `docs/work-logs/NNN-work-name.md`:
- Check last number: `ls docs/work-logs/ | tail -1`
- Follow CLAUDE.md template format

### 4. Update features-list.md
In `docs/features-list.md`:
- Update completed feature status
- Add newly discovered bugs
- Update planned features

### 5. Update CHANGELOG.md (if release-worthy)
Add significant changes to `[Unreleased]` section

### 6. Print Handoff Summary
Show user:
```
=== Session Handoff ===
- Completed: [what was done this session]
- In Progress: [unfinished work]
- Next Steps: [what to do next session]
- Notes: [issues to be aware of]
```
