---
description: Run full post-coding pipeline - typecheck, lint, test, code review, handoff
---

Run the complete post-coding quality pipeline on changed files. Execute each step sequentially and stop on critical failures. After all checks pass, automatically update session tracking documents.

## Pipeline

### Step 1: TypeScript 타입 검사
```bash
npm run typecheck
```
- FAIL 시: 타입 에러를 즉시 수정하고 다시 실행
- PASS 시: Step 2 진행

### Step 2: ESLint 검사
```bash
npm run lint
```
- FAIL 시: `npm run lint:fix`로 자동 수정 시도, 수동 수정 필요한 것은 수정
- PASS 시: Step 3 진행

### Step 3: 관련 테스트 실행
- `git diff --name-only`로 변경 파일 파악
- 변경 파일에 대응하는 테스트 파일 찾기:
  - `src/core/foo.ts` → `tests/core/foo.test.ts`
  - `src/renderer/stores/foo.ts` → `tests/renderer/stores/foo.test.ts`
- 대응 테스트가 있으면 해당 테스트만 실행: `npx vitest run [test-file]`
- 대응 테스트가 없으면 전체 테스트: `npm run test`
- FAIL 시: 테스트 실패 원인 분석 후 코드 수정, 다시 Step 1부터

### Step 4: 코드 리뷰
- 변경된 파일을 읽고 아래 항목 검사:
  - 타입 안전성 (`any` 사용, 타입 단언 남용)
  - 프로젝트 컨벤션 (`I` 접두사, `SyncAppError` 계층, DI 패턴)
  - 코드 중복, 함수 길이 (50줄 초과)
  - 성능 이슈 (불필요한 리렌더링, 메모리 누수)
- 문제 발견 시: 수정 후 Step 1부터 재실행
- 문제 없으면: Step 5 진행

### Step 5: 인수인계 (자동)
모든 품질 검사를 통과한 후, 세션 추적 문서를 자동 업데이트:

1. **`docs/progress.txt` 업데이트**
   - "진행 중" 섹션에 현재 작업 상태 반영
   - 완료된 항목은 "완료된 기능"으로 이동
   - 새로 발견된 이슈는 "알려진 이슈"에 추가

2. **`docs/features-list.md` 업데이트**
   - 변경된 기능의 상태 갱신
   - 새 버그 발견 시 "미해결 버그" 테이블에 추가

3. **`CHANGELOG.md` 업데이트**
   - `[Unreleased]` 섹션에 변경사항 추가 (Added/Fixed/Changed 분류)

### 결과 보고
```
=== Post-Code Pipeline 결과 ===
1. TypeCheck: PASS/FAIL
2. Lint: PASS/FAIL
3. Test: PASS/FAIL (N개 통과, M개 실패)
4. Review: PASS/WARN (N개 제안)
5. Handoff: UPDATED (progress.txt, features-list.md, CHANGELOG.md)
=== 전체: PASS/FAIL ===
```
