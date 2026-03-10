# Skills 사용법

## 등록된 팀

| 팀 | 트리거 키워드 | 파일 |
|----|-------------|------|
| 다운로드 팀 | `다운로드 팀` `다운로드팀` | `download-pipeline-team.md` |
| 감지 팀 | `감지 팀` `감지팀` | `realtime-detection-team.md` |

## 사용 예시

### 다운로드 팀

```bash
# 코드 리뷰
다운로드 팀 파이프라인 전체 코드 리뷰

# 이슈 그룹 수정
다운로드 팀 DLQ 인프라 전체 수정 (DLQ-1~6)
다운로드 팀 SQL 인젝션 수정 (SEC-4, SEC-5)

# 버그 수정
다운로드 팀 대용량 파일 다운로드 시 타임아웃 발생

# E2E 테스트
다운로드 팀 다운로드 파이프라인 E2E 테스트 작성

# 기능 완성
다운로드 팀 IWebhardUploader 미구현 메서드 완성
```

### 감지 팀

```bash
# 코드 리뷰
감지 팀 감지 도메인 전체 리뷰

# 이슈 그룹 수정
감지 팀 동시성 제어 수정 (DET-C1, C2, M1, M2)
감지 팀 operCode 이벤트 체인 완성 (DET-M5, M6, m1, m12)

# 버그 수정
감지 팀 폴링 중복 실행으로 파일 이중 감지됨

# E2E 테스트 + 실제 동작 검증
감지 팀 실시간 감지 E2E 테스트 작성

# 기능 완성
감지 팀 operCode D/MV/RN 처리 시 자체웹하드 반영 구현
```

## 팀 구성

### 공통 규칙
- **팀 리더**: opus (조율/아키텍처/plan 승인)
- **팀원**: sonnet (분석/구현/테스트)
- **구현자/테스터**: 변경 전 반드시 plan 승인 필요
- 보안/미완성 이슈 시 관련 팀원 간 의견 조율 후 작업

### 다운로드 팀 (6역할)
1. 팀 리더 (opus) — 이슈 분류, 우선순위, plan 승인
2. reviewer (sonnet) — 코드 리뷰
3. analyzer (sonnet) — 버그 분석, 데이터 흐름 추적
4. implementer (sonnet, plan) — 코드 수정
5. tester (sonnet, plan) — E2E 테스트
6. verifier (sonnet) — typecheck + lint + test

### 감지 팀 (4역할 + 리더)
1. 팀 리더 (opus) — 동시성 설계, operCode 정책, plan 승인
2. 폴링/동시성 분석가 (sonnet) — FileDetector, checkpoint, race condition
3. 이벤트 체인 분석가 (sonnet) — EventBus → IPC → Renderer 흐름
4. 구현자 (sonnet, plan) — 코드 수정
5. E2E 테스터 & QA 검증자 (sonnet, plan) — 테스트 작성 + 실제 동작 검증
