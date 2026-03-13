---
name: test-and-refactor
description: Test-driven development cycle with refactoring for this project. Triggers on "tdd", "테스트 먼저", "test first", "refactor", "리팩토링".
---

# Test & Refactor Cycle

## Phase 1: Test First
1. Read feature spec or completion criteria
2. Write tests (Vitest + MSW for mocks)
3. Run: `npx vitest run tests/core/<target>.test.ts`
4. Confirm tests FAIL (red phase)

## Phase 2: Implement
5. Write minimal code to pass failing tests
6. Run tests — max 2 attempts, then STOP and analyze
7. If tests pass, proceed to Phase 3

## Phase 3: Refactor
8. Check project conventions:
   - [ ] No `any` types
   - [ ] Interface prefix `I` (ILogger, ISyncEngine)
   - [ ] IPC types in `src/shared/ipc-types.ts`
   - [ ] No direct Node.js API in renderer (use preload bridge)
   - [ ] contextBridge for all main↔renderer communication
   - [ ] Zustand stores for renderer state
   - [ ] `SyncAppError` hierarchy for errors (not raw Error/throw)
   - [ ] DI pattern: interface injection via `container.ts`
9. Check function size (< 50 lines)
10. Remove duplication
11. Re-run tests: `npm run test`

## Phase 4: Quality Gate
12. `npm run typecheck` — must pass
13. `npm run lint` — fix if needed (`npm run lint:fix`)
14. `npm run test` — full suite green
15. Commit with test files included

## Failure Protocol
2 consecutive failures on same issue → STOP → record in progress.txt → /clear → different approach

## Test File Conventions
- Unit tests: `tests/core/<service>.test.ts`
- IPC tests: `tests/main/<handler>.test.ts`
- E2E tests: `tests/e2e/<scenario>.spec.ts`
- MSW mocks: `tests/mocks/` (lguplus, yjlaser API handlers)
- Single file run: `npx vitest run tests/core/some.test.ts`
