---
description: Run full post-coding pipeline - typecheck, lint, test, code review, handoff
---

Run the complete post-coding quality pipeline on changed files. Execute each step sequentially and stop on critical failures. After all checks pass, automatically update session tracking documents.

## Pipeline

### Step 1: TypeScript Type Check
```bash
npm run typecheck
```
- FAIL: Fix type errors immediately, re-run
- PASS: Proceed to Step 2

### Step 2: ESLint
```bash
npm run lint
```
- FAIL: Try `npm run lint:fix`, manually fix remaining issues
- PASS: Proceed to Step 3

### Step 3: Run Related Tests
- `git diff --name-only` to identify changed files
- Find corresponding test files:
  - `src/core/foo.ts` -> `tests/core/foo.test.ts`
  - `src/renderer/stores/foo.ts` -> `tests/renderer/stores/foo.test.ts`
- If matching tests exist: `npx vitest run [test-file]`
- If no matching tests: `npm run test`
- FAIL: Analyze failure, fix code, restart from Step 1

### Step 4: Code Review
- Read changed files and check:
  - Type safety (`any` usage, type assertion overuse)
  - Project conventions (`I` prefix, `SyncAppError` hierarchy, DI pattern)
  - Code duplication, function length (> 50 lines)
  - Performance issues (unnecessary re-renders, memory leaks)
- Issues found: Fix, restart from Step 1
- Clean: Proceed to Step 5

### Step 5: Handoff (automatic)
After all quality checks pass, auto-update session tracking:

1. **`docs/progress.txt`** — Reflect current work status, move completed items, add new issues
2. **`docs/features-list.md`** — Update feature status, add new bugs
3. **`CHANGELOG.md`** — Add changes to `[Unreleased]` (Added/Fixed/Changed)

### Report
```
=== Post-Code Pipeline ===
1. TypeCheck: PASS/FAIL
2. Lint: PASS/FAIL
3. Test: PASS/FAIL (N passed, M failed)
4. Review: PASS/WARN (N suggestions)
5. Handoff: UPDATED (progress.txt, features-list.md, CHANGELOG.md)
=== Overall: PASS/FAIL ===
```
