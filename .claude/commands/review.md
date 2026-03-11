---
description: Review changed code for quality, patterns, and refactoring opportunities
---

Perform a code review on all files changed since the last commit.

## Steps

1. **Identify changed files**
   - `git diff --name-only` (unstaged)
   - `git diff --cached --name-only` (staged)
   - Target only `.ts`, `.tsx` files

2. **Type safety**
   - `any` type usage
   - Type assertion (`as`) overuse
   - Interface `I` prefix convention

3. **Code quality**
   - Error handling: `SyncAppError` hierarchy usage
   - DI pattern: interface injection, not direct deps
   - Unnecessary code duplication
   - Function/method length (suggest split if > 50 lines)

4. **Performance**
   - Unnecessary re-render patterns (React)
   - SQLite query optimization opportunities
   - Memory leak potential (event listener cleanup)

5. **Security**
   - Hardcoded credentials
   - SQL injection potential
   - XSS potential (React dangerouslySetInnerHTML)

6. **Refactoring suggestions**
   - For each: current code -> improved code -> reason
   - Priority: High / Medium / Low

Report format:
```
=== Code Review ===
File: [filename]
- [PASS/WARN/FAIL] [item]: [description]

=== Refactoring Suggestions ===
[priority] [file:line] [suggestion]
```
