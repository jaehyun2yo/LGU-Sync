---
description: Review changed code for quality, patterns, and refactoring opportunities
---

Perform a code review on all files changed since the last commit.

## Steps

1. **변경 파일 파악**
   - `git diff --name-only` (unstaged)
   - `git diff --cached --name-only` (staged)
   - 변경된 `.ts`, `.tsx` 파일만 대상

2. **타입 안전성 검사**
   - `any` 타입 사용 여부
   - 타입 단언(`as`) 남용 여부
   - 인터페이스 `I` 접두사 컨벤션 준수

3. **코드 품질 검사**
   - 에러 처리: `SyncAppError` 계층 사용 여부
   - DI 패턴: 직접 의존 대신 인터페이스 주입 사용
   - 불필요한 코드 중복
   - 함수/메서드 길이 (50줄 초과 시 분리 제안)

4. **성능 검사**
   - 불필요한 리렌더링 유발 패턴 (React)
   - SQLite 쿼리 최적화 기회
   - 메모리 누수 가능성 (이벤트 리스너 정리)

5. **보안 검사**
   - 하드코딩된 credentials
   - SQL injection 가능성
   - XSS 가능성 (React dangerouslySetInnerHTML)

6. **리팩토링 제안**
   - 각 제안에 대해: 현재 코드 → 개선 코드 → 이유
   - 우선순위: 높음/중간/낮음

Report format:
```
=== 코드 리뷰 결과 ===
파일: [filename]
- [PASS/WARN/FAIL] [항목]: [설명]

=== 리팩토링 제안 ===
[우선순위] [파일:라인] [제안 내용]
```
