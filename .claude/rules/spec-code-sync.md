# Spec-Code Synchronization Rules

## Rule 1: Code Changes -> Spec Awareness
After modifying code, check if a matching plan exists in docs/plans/:
- Core service changes -> check docs/plans/04-동기화엔진/ specs
- UI changes -> check docs/plans/05-GUI-UX/ specs
- API changes -> check docs/plans/06-API-인터페이스-설계서.md
- If code diverges from spec: note in work-log and update spec

## Rule 2: New Features -> Plan First
Before implementing new features:
1. Create a plan in docs/plans/ (use project-planning skill)
2. Get approval
3. Then implement

## Rule 3: Work-Log as Change Record
Every work-log entry (docs/work-logs/NNN-*.md) serves as the change record.
The "주요 결정사항" section in work-logs = lightweight ADR.

## Rule 4: CHANGELOG Sync
CHANGELOG.md [Unreleased] section must reflect all work since last release.
Stop hook already checks this — ensure it stays current.
