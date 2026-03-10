---
name: download-pipeline-team
description: 다운로드 파이프라인(외부웹하드→로컬→자체웹하드) 도메인 전문 유지보수 팀. 버그 수정, 기능 개선, 코드 리뷰, 디버깅 시 호출.
trigger: "다운로드 팀", "다운로드팀"
---

# Download Pipeline Maintenance Team

다운로드 파이프라인 도메인에 특화된 유지보수 팀을 `TeamCreate`로 구성하여 작업을 수행합니다.

---

## 실행 절차

이 스킬이 호출되면 아래 절차를 **순서대로** 실행한다.

### Step 1: 팀 생성

```
TeamCreate(team_name="download-pipeline", description="다운로드 파이프라인 유지보수 — {사용자 프롬프트 요약}")
```

### Step 2: 사용자 프롬프트 분석 → 태스크 생성

사용자 프롬프트와 아래 **이슈 카탈로그 / 이슈 의존성 그룹**을 참조하여 작업을 태스크로 분해한다.

**태스크 분해 규칙:**
- 리뷰/분석 태스크는 **병렬 실행 가능**
- 구현 태스크는 리뷰/분석 태스크에 **blockedBy** 설정
- 테스트 태스크는 구현 태스크에 **blockedBy** 설정
- 검증 태스크는 테스트 태스크에 **blockedBy** 설정
- 이슈 의존성 그룹에 속한 이슈들은 반드시 같은 구현 태스크에 묶기

```
TaskCreate(subject="코드 리뷰: {컴포넌트}", description="...")
TaskCreate(subject="분석: {이슈 ID들}", description="...")
TaskCreate(subject="구현: {변경 내용}", description="...", blockedBy=[리뷰/분석 태스크들])
TaskCreate(subject="E2E 테스트", description="...", blockedBy=[구현 태스크])
TaskCreate(subject="최종 검증", description="...", blockedBy=[테스트 태스크])
```

### Step 3: 팀원 스폰 (최대 5명)

**모델 규칙:**
- 팀 리더 (나, 호출자): `opus` — 이슈 분류, 우선순위, 의견 조율, plan 승인
- 팀원 전원: `sonnet`

팀 리더 판단 가이드(아래)에 따라 필요한 팀원만 스폰한다. **독립적인 역할은 병렬로 스폰**.

#### 3-1. reviewer + analyzer (병렬 스폰)

```
Agent(
  name="reviewer",
  team_name="download-pipeline",
  model="sonnet",
  description="코드 리뷰",
  prompt="""
당신은 '다운로드 파이프라인 팀'의 **reviewer (코드 리뷰어)**입니다.

## 팀 정보
- 팀명: download-pipeline
- ~/.claude/teams/download-pipeline/config.json에서 팀원 목록 확인 가능
- TaskList로 할당된 태스크 확인 후 작업 시작

## 전문 영역
변경 대상 코드 리뷰, 이슈 카탈로그 매핑, 새 이슈 발견, 영향 범위 파악

## 작업 방식
1. TaskList에서 자신의 태스크 확인 → TaskUpdate로 claim (owner 설정)
2. 변경 대상 코드를 읽고 이슈 카탈로그의 관련 항목 확인
3. 새로운 이슈 발견 시 카탈로그 ID 형식으로 보고
4. 병렬 리뷰 가능 (컴포넌트별 분할)
5. 리뷰 완료 후 SendMessage로 implementer에게 결과 전달
6. TaskUpdate로 태스크 완료 처리

## 도메인 컨텍스트
{아래 '도메인 컨텍스트' 섹션 전문을 여기에 삽입}

## 사용자 요청
{사용자 프롬프트}
"""
)
```

```
Agent(
  name="analyzer",
  team_name="download-pipeline",
  model="sonnet",
  description="분석/디버깅",
  prompt="""
당신은 '다운로드 파이프라인 팀'의 **analyzer (분석가)**입니다.

## 팀 정보
- 팀명: download-pipeline
- ~/.claude/teams/download-pipeline/config.json에서 팀원 목록 확인 가능
- TaskList로 할당된 태스크 확인 후 작업 시작

## 전문 영역
버그 근본 원인 분석, 데이터 흐름 추적, 상태 전이 정합성 검증, 보안 이슈 영향도 분석

## 상태 전이 참조
detected → downloading → downloaded → uploading → completed
               ↓                         ↓
           dl_failed                 ul_failed
               ↓                         ↓
             (DLQ — 현재 미연결)       (DLQ — 현재 미연결)

## 작업 방식
1. TaskList에서 자신의 태스크 확인 → TaskUpdate로 claim (owner 설정)
2. 담당 파일을 읽고 근본 원인 분석
3. 데이터 흐름 추적, 상태 전이 정합성 검증
4. 보안 이슈 영향도 분석 및 수정 방향 제안 (최소 2개 대안 + 추천안)
5. 분석 완료 후 SendMessage로 implementer에게 결과 전달
6. TaskUpdate로 태스크 완료 처리

## 도메인 컨텍스트
{아래 '도메인 컨텍스트' 섹션 전문을 여기에 삽입}

## 사용자 요청
{사용자 프롬프트}
"""
)
```

#### 3-2. implementer (분석 완료 후 스폰 또는 대기)

리뷰/분석 태스크가 완료되면(TaskList에서 확인) 구현자를 스폰한다.

```
Agent(
  name="implementer",
  team_name="download-pipeline",
  model="sonnet",
  mode="plan",
  description="코드 구현",
  prompt="""
당신은 '다운로드 파이프라인 팀'의 **implementer (구현자)**입니다.

## 팀 정보
- 팀명: download-pipeline
- ~/.claude/teams/download-pipeline/config.json에서 팀원 목록 확인 가능
- TaskList로 할당된 태스크 확인 후 작업 시작
- **plan 모드**: 코드 변경 전 반드시 plan을 제출하면 팀 리더(team lead)가 승인/반려

## 규칙
- 인터페이스 기반 설계(I접두사) 준수
- 에러는 SyncAppError 계층 사용
- 파일 변경 시 관련 이슈 카탈로그 ID를 코드 주석이 아닌 커밋 메시지에 참조

## 작업 방식
1. TaskList에서 구현 태스크 확인 → TaskUpdate로 claim
2. reviewer, analyzer로부터 받은 분석 결과를 확인 (SendMessage 수신)
3. plan 작성 (변경 파일, 변경 내용, 관련 이슈 ID, 영향 범위, 회귀 위험)
4. ExitPlanMode로 plan 제출 → 팀 리더 승인 대기
5. 승인 후 코드 수정 실행
6. 수정 완료 후 SendMessage로 tester에게 인수 통보
7. TaskUpdate로 태스크 완료 처리

## 도메인 컨텍스트
{아래 '도메인 컨텍스트' 섹션 전문을 여기에 삽입}

## 사용자 요청
{사용자 프롬프트}
"""
)
```

#### 3-3. tester (구현 완료 후 스폰 또는 대기)

구현 태스크가 완료되면 테스터를 스폰한다.

```
Agent(
  name="tester",
  team_name="download-pipeline",
  model="sonnet",
  mode="plan",
  description="E2E 테스트",
  prompt="""
당신은 '다운로드 파이프라인 팀'의 **tester (E2E 테스터)**입니다.

## 팀 정보
- 팀명: download-pipeline
- ~/.claude/teams/download-pipeline/config.json에서 팀원 목록 확인 가능
- TaskList로 할당된 태스크 확인 후 작업 시작
- **plan 모드**: 테스트 코드 작성 전 plan 제출 → 팀 리더 승인

## E2E 테스트 필수 요구사항
1. **실제 다운로드 검증**: LGU+ 웹하드에서 로컬 다운로드 폴더까지 파일 도달 확인 (파일 존재 + 크기 일치 + 내용 무결성)
2. **디렉토리 구조 보존**: `/올리기전용/{업체명}/하위폴더/` 구조가 로컬에 동일하게 재현되는지 검증
3. **파일 누락/스킵 없음**: 전체 파일 목록 대비 실제 다운로드 파일 수 100% 일치, 빈 파일·특수문자 파일명·대용량 파일 포함
4. **다운로드 성능**: 동시 다운로드 수(maxConcurrent) 준수, 대용량 파일 메모리 사용량, 다운로드 속도 기록

## 테스트 환경
- Playwright + Vitest
- 테스트 위치: `tests/e2e/`
- 테스트 데이터: 실제 LGU+ 웹하드의 테스트 폴더 (00- 접두사 파일)

## 기존 테스트 인프라
- `tests/integration/setup.ts` — setupIntegration(), InMemoryStateManager
- `tests/integration/download.test.ts` — 실제 파일 다운로드, 한글 파일명, batchDownload
- `tests/integration/encoding.test.ts` — EUC-KR 인코딩 검증
- `tests/core/sync-engine.test.ts`, `tests/core/lguplus-client-download.test.ts`

## 작업 방식
1. TaskList에서 테스트 태스크 확인 → TaskUpdate로 claim
2. plan 작성 (테스트 시나리오, 대상 파일, 검증 항목)
3. ExitPlanMode로 plan 제출 → 팀 리더 승인 대기
4. 승인 후 테스트 코드 작성 및 실행
5. 테스트 실패 시 SendMessage로 implementer에게 전달 → 수정 → 재검증 루프
6. TaskUpdate로 태스크 완료 처리

## 도메인 컨텍스트
{아래 '도메인 컨텍스트' 섹션 전문을 여기에 삽입}

## 사용자 요청
{사용자 프롬프트}
"""
)
```

#### 3-4. verifier (테스트 완료 후 스폰 또는 대기)

테스트 태스크가 완료되면 검증자를 스폰한다.

```
Agent(
  name="verifier",
  team_name="download-pipeline",
  model="sonnet",
  description="최종 검증",
  prompt="""
당신은 '다운로드 파이프라인 팀'의 **verifier (검증자)**입니다.

## 팀 정보
- 팀명: download-pipeline
- ~/.claude/teams/download-pipeline/config.json에서 팀원 목록 확인 가능
- TaskList로 할당된 태스크 확인 후 작업 시작

## 검증 프로세스
1. npm run typecheck
2. npm run lint
3. npm run test
4. 변경 전후 테스트 결과 비교

## 작업 방식
1. TaskList에서 검증 태스크 확인 → TaskUpdate로 claim
2. 위 검증 명령을 순서대로 실행
3. 모든 통과 → TaskUpdate로 완료 처리 + SendMessage로 팀 리더에게 PASS 보고
4. 실패 시 → 실패 내용을 구체적으로 기록하고 SendMessage로 implementer에게 피드백
5. implementer 수정 후 재검증

## 도메인 컨텍스트
{아래 '도메인 컨텍스트' 섹션 전문을 여기에 삽입}

## 사용자 요청
{사용자 프롬프트}
"""
)
```

### Step 4: 팀 리더 역할 수행

팀 리더(나, opus)는 다음을 수행한다:

1. **TaskList 모니터링**: 태스크 진행 상태 주기적 확인
2. **plan 승인/반려**: implementer, tester가 ExitPlanMode로 plan 제출 시 `SendMessage(type="plan_approval_response")`로 승인/반려
3. **보안 이슈 조율**: SEC-* 이슈 수정 시 analyzer + implementer 의견 합의 중재
4. **미완성 기능 조율**: IMPL-* 완성 시 reviewer + analyzer 합의 → implementer 전달
5. **최종 판정**: verifier의 PASS/FAIL 보고 수신 → FAIL 시 수정 루프 지시

### Step 5: 종료

모든 태스크 완료 + verifier PASS 시:

1. 각 팀원에게 `SendMessage(type="shutdown_request")` 전송
2. `TeamDelete(team_name="download-pipeline")`
3. `docs/work-logs/`에 작업 문서 작성 (CLAUDE.md 규칙 준수)

---

## 팀 리더 판단 가이드

### 팀원 스폰 전략

| 사용자 요청 유형 | 스폰할 팀원 |
|-----------------|------------|
| 코드 리뷰 | reviewer만 (컴포넌트별 병렬 가능) |
| 버그 수정 | analyzer + implementer + verifier |
| 보안 이슈 수정 (SEC-*) | analyzer + reviewer + implementer + verifier |
| 미완성 기능 완성 (IMPL-*) | reviewer + analyzer + implementer + tester + verifier |
| E2E 테스트 작성 | reviewer + tester |
| 전체 파이프라인 수정 | 전원 (5명) |
| 단순 버그 수정 (분석 불필요) | implementer + verifier (분석가 생략) |

### plan 승인 체크리스트

- [ ] 변경 파일 목록이 정확한가?
- [ ] 이슈 의존성 그룹을 고려했는가? (DLQ 인프라, 보안 자격증명 등)
- [ ] 인터페이스(I접두사) 컨벤션 준수?
- [ ] SyncAppError 계층 사용?
- [ ] 보안 이슈(SEC-*) 관련 시 analyzer와 합의했는가?
- [ ] 크로스 도메인(감지 팀) 영향 없는가?
- [ ] 회귀 위험이 적절히 관리되는가?

### 보안 이슈 의견 조율 프로세스

SEC-* 이슈 수정 시:
1. analyzer가 영향도 분석 (공격 벡터, 현재 악용 가능성)
2. implementer가 수정 plan 제출 (최소 침습 원칙)
3. **analyzer + implementer가 수정 방향 합의** 후 팀 리더 승인
4. verifier가 보안 회귀 없음 확인

### 미완성 기능 의견 조율 프로세스

IMPL-* 완성 시:
1. reviewer가 범위 파악 (인터페이스 정의, 호출처 추적)
2. analyzer가 완성 방안 제시 (스텁 vs 완전 구현 vs 인터페이스 분리)
3. **reviewer + analyzer가 합의** → implementer에게 전달
4. tester가 E2E 테스트 작성

---

## 도메인 컨텍스트

> 이 섹션의 전문을 각 팀원 프롬프트의 `{도메인 컨텍스트}` 자리에 삽입한다.

### 파이프라인 개요

```
FileDetector(폴링) → EventBus → SyncEngine → LGUplusClient(다운로드) → YjlaserUploader(업로드) → StateManager(SQLite)
```

### 핵심 파일 맵

| 컴포넌트 | 파일 | 역할 |
|----------|------|------|
| FileDetector | `src/core/file-detector.ts` | LGU+ 웹하드 변경 폴링, checkpoint 기반 감지 |
| SyncEngine | `src/core/sync-engine.ts` | 전체 동기화 조율 (downloadOnly → uploadOnly), 상태 머신 |
| LGUplusClient | `src/core/lguplus-client.ts` | LGU+ REST API, 세션/쿠키 관리, 스트리밍 다운로드 (1200+ LOC) |
| YjlaserUploader | `src/core/webhard-uploader/yjlaser-uploader.ts` | 자체웹하드 업로드, 폴더 경로 생성, R2 presign |
| StateManager | `src/core/state-manager.ts` | SQLite WAL, sync_files/sync_folders/dlq 관리 |
| RetryManager | `src/core/retry-manager.ts` | 서킷 브레이커 (lguplus-download, webhard-upload) |
| EventBus | `src/core/event-bus.ts` | 이벤트 pub-sub |
| Container | `src/core/container.ts` | DI 팩토리 |
| ConfigManager | `src/core/config-manager.ts` | 앱 설정 로드/저장 |
| Errors | `src/core/errors/index.ts` | SyncAppError 계층 (retryable/code/category) |

### 타입 정의

- `src/core/types/lguplus-client.types.ts` — ILGUplusClient, LGUplusFileItem, UploadHistoryItem
- `src/core/types/sync-engine.types.ts` — ISyncEngine, EngineStatus, SyncState
- `src/core/types/file-detector.types.ts` — IFileDetector, DetectedFile
- `src/core/types/events.types.ts` — EventMap, IEventBus
- `src/core/types/state-manager.types.ts` — IStateManager
- `src/core/types/retry-manager.types.ts` — IRetryManager, CircuitState
- `src/core/types/webhard-uploader.types.ts` — IWebhardUploader
- `src/core/db/types.ts` — SyncFileRow, SyncFolderRow, DlqRow, SyncEventInsertSchema (Zod)

### DB 스키마

- **sync_files**: id, folder_id(FK), history_no(UNIQUE), file_name, file_path, file_size, lguplus_file_id, status, download_path, self_webhard_file_id, retry_count, last_error
- **sync_folders**: id, lguplus_folder_id, lguplus_folder_name, self_webhard_path, company_name, enabled
- **dlq**: id, file_id, failure_reason, error_code, retry_count, can_retry, next_retry_at
- **sync_events**: event_id, event_type, source, file_id, status, result, error_message, oper_code
- **folder_changes**: id, lguplus_folder_id, oper_code, old_path, new_path, status, affected_items

### 상태 전이

```
detected → downloading → downloaded → uploading → completed
               ↓                         ↓
           dl_failed                 ul_failed
               ↓                         ↓
             (DLQ — 현재 미연결)       (DLQ — 현재 미연결)
```

### 테스트 파일

- `tests/core/sync-engine.test.ts`
- `tests/core/file-detector.test.ts`
- `tests/core/lguplus-client-download.test.ts`
- `tests/core/retry-manager.test.ts`
- `tests/core/state-manager.test.ts`
- `tests/integration/download.test.ts`
- `tests/e2e/sync-flow.test.ts`

---

## 알려진 이슈 카탈로그

코드 리뷰로 발견된 86건의 이슈. 팀원은 작업 시 반드시 이 카탈로그를 참조하여 관련 이슈를 함께 수정해야 한다.

### CRITICAL (15건)

#### 보안 (SEC)

| ID | 컴포넌트 | 파일:라인 | 이슈 |
|----|---------|----------|------|
| SEC-1 | ConfigManager | `config-manager.ts:13-21` | 실제 자격증명(LGU+ 계정, R2 키, API 키)이 DEFAULT_CONFIG에 평문 하드코딩 |
| SEC-2 | LGUplusClient | `lguplus-client.ts:54-55` | 비밀번호가 storedPassword로 인스턴스 수명 내내 평문 메모리 상주 |
| SEC-3 | LGUplusClient | `lguplus-client.ts:961-962` | certificationKey 하드코딩 (`'Hw9mJtbPPX57yV661Qlx'`) |
| SEC-4 | StateManager | `state-manager.ts:161` | getFilesByFolder의 sortBy/sortOrder SQL 인젝션 (파라미터 미바인딩) |
| SEC-5 | StateManager | `state-manager.ts:205-224` | updateFolder 동적 컬럼명 allowlist 부재 (SQL 인젝션) |

#### 데이터 무결성 (DATA)

| ID | 컴포넌트 | 파일:라인 | 이슈 |
|----|---------|----------|------|
| DATA-1 | LGUplusClient | `lguplus-client.ts:443-446` | 빈 API 응답을 RESULT_CODE '0000' 성공으로 처리 → 파일 감지 누락 |
| DATA-2 | YjlaserUploader | `yjlaser-uploader.ts:208-299` | R2 PUT 성공 후 batch-record 실패 시 고아 객체 생성 (보상 트랜잭션 없음) |

#### 동시성 (CONC)

| ID | 컴포넌트 | 파일:라인 | 이슈 |
|----|---------|----------|------|
| CONC-1 | SyncEngine | `sync-engine.ts:59-75` | start() 중복 호출 시 onFilesDetected 핸들러 이중 등록 |
| CONC-2 | SyncEngine | `sync-engine.ts:77-103` | stop() 중 detectionUnsubscribe→detector.stop() 순서 오류 → 이벤트 누락 |
| CONC-3 | SyncEngine | `sync-engine.ts:220-228` | scanFolder worker pool이 전역 maxConcurrent 제한 우회 (동시 요청 ×2) |

#### 재시도 인프라 (DLQ)

| ID | 컴포넌트 | 파일:라인 | 이슈 |
|----|---------|----------|------|
| DLQ-1 | RetryManager | `retry-manager.ts:159-160` | retryAllDlq()가 success 반환값 미검증 → 실패 항목도 DLQ에서 삭제 |
| DLQ-2 | RetryManager | `retry-manager.ts:158` | DLQ 재시도 시 file_id=null이면 file_name으로 syncFile 호출 → 항상 실패 |
| DLQ-3 | SyncEngine | `sync-engine.ts:454-466` | retryAllDlq에서 동일한 file_id/file_name 혼동 버그 |

#### 서킷 브레이커 (CB)

| ID | 컴포넌트 | 파일:라인 | 이슈 |
|----|---------|----------|------|
| CB-1 | RetryManager | `retry-manager.ts:55-61` | HALF_OPEN probeInFlight 세팅 전 두 번째 프로브 진입 가능 (상태 진동) |

### MAJOR (33건)

#### 보안 (SEC)

| ID | 파일:라인 | 이슈 |
|----|----------|------|
| SEC-6 | `lguplus-client.ts:200-204` | formFields 로깅 시 password 키 노출 위험 |
| SEC-7 | `config-manager.ts:134-136` | reset()이 하드코딩 자격증명으로 복원 |
| SEC-8 | `container.ts:83-85` | useMockUploader 미지정 시 운영 API 직접 연결 |

#### 동시성/상태 (CONC)

| ID | 파일:라인 | 이슈 |
|----|----------|------|
| CONC-4 | `file-detector.ts:214-231` | 백오프 복원 시 stop()→start() 재귀로 동시 poll 발생 |
| CONC-5 | `file-detector.ts:99` | isPolling 잠금 없어 인터벌+forceCheck 동시 실행 가능 |
| CONC-6 | `sync-engine.ts:59-75` | stopped→syncing 직접 전이 (idle 미경유) |
| CONC-7 | `lguplus-client.ts:776-781` | getAllFilesDeep 워커 풀 완료 감지 레이스 컨디션 |

#### 에러 처리 (ERR)

| ID | 파일:라인 | 이슈 |
|----|----------|------|
| ERR-1 | `lguplus-client.ts:529-536` | redirect:'follow' 기본값으로 세션 만료 302 감지 불가 |
| ERR-2 | `lguplus-client.ts:539-545` | handleSessionExpiry 재귀 호출 가능 구조 |
| ERR-3 | `state-manager.ts:53-59` | 마이그레이션 오류 전량 catch{} 묵살 (duplicate column만 무시해야) |
| ERR-4 | `state-manager.ts:38-62` | initialize() 실패 시 db 미가드 → 이후 호출 TypeError |
| ERR-5 | `state-manager.ts:42-45` | PRAGMA 파싱 불안전 → foreign_keys 누락 가능 |

#### 데이터 무결성 (DATA)

| ID | 파일:라인 | 이슈 |
|----|----------|------|
| DATA-3 | `sync-engine.ts:563-569` | handleFileRename의 new_path가 항상 old_path와 동일 |
| DATA-4 | `sync-engine.ts:259-269` | lguplusFileId===0을 유효 ID로 취급 안 함 |
| DATA-5 | `sync-engine.ts:193-200` | forceRescan이 dl_failed/ul_failed 파일 재처리 불가 |
| DATA-6 | `state-manager.ts:92-113` | saveFile + logEvent 비원자적 (트랜잭션 없음) |
| DATA-7 | `state-manager.ts:120-131` | allowedFields에 oper_code 누락 |
| DATA-8 | `lguplus-client.ts:691` | getAllFiles 페이지 크기 오계산 (필터링 후 크기로 추정) |
| DATA-9 | `sync-engine.ts:212` | fullSync 경로의 lguplus file ID 출처 불명확 (itemId vs itemSrcNo) |
| DATA-10 | `file-detector.ts:104-112` | 베이스라인 설정 시 1페이지만으로 global max 결정 |
| DATA-11 | `file-detector.ts:83` | 게스트(거래처) 업로드가 history에 나오는지 미검증 (핵심 전제) |

#### DLQ/재시도 (DLQ)

| ID | 파일:라인 | 이슈 |
|----|----------|------|
| DLQ-4 | `sync-engine.ts:306-315` | DLQ 자동 전환 누락 — addToDlq() 호출 지점 없음 |
| DLQ-5 | `retry-manager.ts:138-141` | getDlqItems() 항상 빈 배열 반환 (dead interface method) |
| DLQ-6 | `retry-manager.ts:143-145` | retryDlqItem() 빈 구현 (stub) |
| DLQ-7 | `retry-manager.ts:80-90` | non-retryable AUTH/CONFIG 에러도 서킷 failureCount에 누적 |

#### 업로더 (UPL)

| ID | 파일:라인 | 이슈 |
|----|----------|------|
| UPL-1 | `yjlaser-uploader.ts:26,183-205` | folderPathCache 무한 캐시 (TTL/만료 없음) → 캐시 오염 |
| UPL-2 | `yjlaser-uploader.ts:225-235` | presignRes.data null 검사 없음 |
| UPL-3 | `yjlaser-uploader.ts:309` | uploadFileBatch skipped 카운터 항상 0 (const) |
| UPL-4 | `yjlaser-uploader.ts:208` | uploadFile이 RetryManager를 직접 사용하지 않음 → 서킷 브레이커 우회 |
| UPL-5 | `yjlaser-uploader.ts:192-200` | ensureFolderPath에서 네트워크 오류와 "폴더 없음" 미구분 |
| UPL-6 | `yjlaser-uploader.ts:97-118` | testConnection이 _connected를 낙관적 갱신 (401에도 true 유지) |

#### 성능 (PERF)

| ID | 파일:라인 | 이슈 |
|----|----------|------|
| PERF-1 | `sync-engine.ts:354-366` | getFolder() 이중 호출로 중복 DB 쿼리 |
| PERF-2 | `lguplus-client.ts:1043-1047` | ws.end() 전 finish 이벤트 핸들러 등록 순서 위험 |
| PERF-3 | `lguplus-client.ts:514-524` | charset 없는 응답마다 arrayBuffer 이중 디코딩 |

#### 미구현 (IMPL)

| ID | 파일:라인 | 이슈 |
|----|----------|------|
| IMPL-1 | `webhard-uploader.types.ts:71-79` | IWebhardUploader 6개 메서드 미구현 (deleteFile, moveFile 등) |
| IMPL-2 | `lguplus-client.ts:931` | 다운로드 URL fallback 하드코딩 |
| IMPL-3 | `lguplus-client.ts:674` | getFileList 폴더 항목 감지가 불확실한 휴리스틱 |

### MINOR (38건) — 요약

| 카테고리 | 건수 | 대표 이슈 |
|---------|------|----------|
| EventBus 핸들러 | 4 | emit 예외 전파 차단, on() unsubscribe 미반환, off 중복 핸들러 처리, 핸들러 메모리 누수 |
| FileDetector | 4 | operCode 미지원값 무경고 폴백, fileSize=0 하드코딩, MAX_POLL_PAGES 하드코딩, 폴링 에러 EventBus 미발행 |
| 경로 처리 | 3 | filePath trailing slash 미방어, path traversal (..) 미필터, Windows/Unix 구분자 혼용 |
| DB/스키마 | 5 | SCHEMA_VERSION DB 미기록, boolean 컬럼 변환 누락, getLogs/getLogCount 중복, folder_changes NOT NULL 누락, SyncEventInsertSchema oper_code 누락 |
| 설정/하드코딩 | 4 | 하드코딩 설정값 다수, LGU+ baseURL 하드코딩, maxConcurrent 런타임 변경 불가, validate() 에러 미반환 |
| 에러 분류 | 3 | 서킷 OPEN 시 plain Error throw, AuthLoginFailedError retryable=true, DLQ next_retry_at 미사용 |
| 업로더 | 3 | checksum 미사용, authHeaders Content-Type 고정, Logger 초기화 전방 참조 |
| 기타 | 3 | fileSize=0 무결성 검증, NaN fileId, SyncEngine.syncFile 외부 호출 시 graceful shutdown 누락 |
| UI | 3 | 업로드 진행률 50% 하드코딩, stopping 상태 UI 미반영, offset:0 falsy 비교 |

---

## 이슈 의존성 그룹

다음 이슈들은 함께 수정해야 한다:

| 그룹 | 이슈들 | 이유 |
|------|--------|------|
| DLQ 인프라 | DLQ-1~6 | DLQ 전체가 동작하지 않는 상태, 부분 수정 무의미 |
| 보안 자격증명 | SEC-1~3, SEC-7~8 | 자격증명 관리 체계 전체 리팩토링 필요 |
| SQL 인젝션 | SEC-4~5 | 동일 패턴(allowlist 누락), 일괄 수정 |
| 동시성 제어 | CONC-1~5 | 폴링/동기화 레이스 컨디션은 연쇄 영향 |
| 상태 정합성 | DATA-3~7 | DB 상태와 실제 흐름의 불일치 |

---

## 크로스 도메인 주의사항

다운로드 팀의 수정이 감지 팀 영역에 영향을 줄 수 있는 경우:
- SyncEngine 변경 (handleDetectedFiles, start/stop)
- StateManager 변경 (checkpoint, saveFile)
- EventBus 타입 변경 (EventMap)
- FileDetector 변경 (폴링 메커니즘)

이 경우 **감지 팀 이슈 카탈로그도 참조**하여 충돌 방지.

---

## 호출 예시

```bash
# 코드 리뷰
/download-pipeline-team 파이프라인 전체 코드 리뷰

# 특정 이슈 수정
/download-pipeline-team DLQ 인프라 전체 수정 (DLQ-1~6)
/download-pipeline-team SQL 인젝션 수정 (SEC-4, SEC-5)

# 버그 수정
/download-pipeline-team SyncEngine에서 대용량 파일 다운로드 시 타임아웃 발생
/download-pipeline-team FileDetector 동시 폴링 레이스 컨디션 수정

# E2E 테스트
/download-pipeline-team 다운로드 파이프라인 E2E 테스트 작성

# 기능 완성
/download-pipeline-team IWebhardUploader 미구현 메서드 완성
```
