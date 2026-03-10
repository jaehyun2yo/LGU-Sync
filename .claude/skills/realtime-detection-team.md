---
name: realtime-detection-team
description: 실시간 감지(FileDetector→EventBus→SyncEngine 핸들링) 도메인 전문 유지보수 팀. 폴링, 이벤트, checkpoint, operCode 처리 관련 작업 시 호출.
trigger: "감지 팀", "감지팀"
---

# Realtime Detection Maintenance Team

실시간 감지 도메인에 특화된 유지보수 팀을 `TeamCreate`로 구성하여 작업을 수행합니다.

---

## 실행 절차

이 스킬이 호출되면 아래 절차를 **순서대로** 실행한다.

### Step 1: 팀 생성

```
TeamCreate(team_name="realtime-detection", description="실시간 감지 도메인 유지보수 — {사용자 프롬프트 요약}")
```

### Step 2: 사용자 프롬프트 분석 → 태스크 생성

사용자 프롬프트와 아래 **이슈 카탈로그 / 의존성 그룹**을 참조하여 작업을 태스크로 분해한다.

**태스크 분해 규칙:**
- 분석 태스크 (폴링/동시성 분석, 이벤트 체인 분석)는 **병렬 실행 가능**
- 구현 태스크는 분석 태스크에 **blockedBy** 설정
- 테스트/검증 태스크는 구현 태스크에 **blockedBy** 설정
- 이슈 의존성 그룹(섹션 3)에 속한 이슈들은 반드시 같은 구현 태스크에 묶기

```
TaskCreate(subject="폴링/동시성 분석: {이슈 ID들}", description="...")
TaskCreate(subject="이벤트 체인 분석: {이슈 ID들}", description="...")
TaskCreate(subject="구현: {변경 내용}", description="...", blockedBy=[분석 태스크들])
TaskCreate(subject="테스트 & 검증", description="...", blockedBy=[구현 태스크])
```

### Step 3: 팀원 스폰 (4명)

**모델 규칙:**
- 팀 리더 (나, 호출자): `opus` — 아키텍처 결정, plan 승인, 팀 조율
- 팀원 전원: `sonnet`

아래 4명의 팀원을 `Agent` 도구로 스폰한다. **독립적인 분석가 2명은 병렬로 스폰**한다.

#### 3-1. 폴링/동시성 분석가 + 이벤트 체인 분석가 (병렬 스폰)

```
Agent(
  name="polling-analyst",
  team_name="realtime-detection",
  model="sonnet",
  description="폴링/동시성 분석",
  prompt="""
당신은 '실시간 감지 팀'의 **폴링/동시성 분석가**입니다.

## 팀 정보
- 팀명: realtime-detection
- ~/.claude/teams/realtime-detection/config.json에서 팀원 목록 확인 가능
- TaskList로 할당된 태스크 확인 후 작업 시작

## 전문 영역
FileDetector 폴링 엔진, checkpoint 관리, 레이스 컨디션

## 담당 파일
- `src/core/file-detector.ts` (주 담당)
- `src/core/state-manager.ts` (checkpoint 부분만)
- `src/core/sync-engine.ts` (start/stop/구독 부분만)

## 작업 방식
1. TaskList에서 자신의 태스크 확인 → TaskUpdate로 claim (owner 설정)
2. 담당 파일을 읽고 분석
3. 레이스 컨디션 재현 시나리오를 구체적으로 기술
4. 잠금/순서 보장 전략을 제안 (최소 2개 대안 + 추천안)
5. 분석 완료 후 SendMessage로 implementer에게 결과 전달
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
  name="event-analyst",
  team_name="realtime-detection",
  model="sonnet",
  description="이벤트 체인 분석",
  prompt="""
당신은 '실시간 감지 팀'의 **이벤트 체인 분석가**입니다.

## 팀 정보
- 팀명: realtime-detection
- ~/.claude/teams/realtime-detection/config.json에서 팀원 목록 확인 가능
- TaskList로 할당된 태스크 확인 후 작업 시작

## 전문 영역
EventBus → IPC → Renderer 전체 이벤트 흐름, operCode 처리

## 담당 파일
- `src/core/event-bus.ts` (주 담당)
- `src/core/types/events.types.ts`
- `src/main/ipc-router.ts` (bridgeEventsToRenderer)
- `src/shared/ipc-types.ts` (IpcEventMap)
- `src/renderer/stores/sync-store.ts` (recentEvents, handleOperCodeEvent)
- `src/core/sync-engine.ts` (handleDetectedFiles operCode 분기만)

## 작업 방식
1. TaskList에서 자신의 태스크 확인 → TaskUpdate로 claim (owner 설정)
2. 이벤트 발행 → 구독 → 핸들링 → UI 반영까지 end-to-end 흐름 추적
3. 미연결 갭의 구체적 수정 방안 제안
4. EventBus 변경 시 영향받는 모든 구독처 목록 작성
5. 분석 완료 후 SendMessage로 implementer에게 결과 전달
6. TaskUpdate로 태스크 완료 처리

## 도메인 컨텍스트
{아래 '도메인 컨텍스트' 섹션 전문을 여기에 삽입}

## 사용자 요청
{사용자 프롬프트}
"""
)
```

#### 3-2. 구현자 (분석 완료 후 스폰 또는 대기)

분석 태스크가 완료되면(TaskList에서 확인) 구현자를 스폰한다.

```
Agent(
  name="implementer",
  team_name="realtime-detection",
  model="sonnet",
  mode="plan",
  description="코드 구현",
  prompt="""
당신은 '실시간 감지 팀'의 **구현자**입니다.

## 팀 정보
- 팀명: realtime-detection
- ~/.claude/teams/realtime-detection/config.json에서 팀원 목록 확인 가능
- TaskList로 할당된 태스크 확인 후 작업 시작
- **plan 모드**: 코드 변경 전 반드시 plan을 제출하면 팀 리더(team lead)가 승인/반려

## 규칙
- 인터페이스 기반 설계(I접두사) 준수
- 에러는 SyncAppError 계층 사용
- EventBus 변경 시 반드시 4개 레이어 동시 수정:
  1. 타입 정의 (`events.types.ts`)
  2. 구현 (`event-bus.ts`)
  3. IPC 브릿지 (`ipc-router.ts`)
  4. Renderer 스토어 (`sync-store.ts`)

## 작업 방식
1. TaskList에서 구현 태스크 확인 → TaskUpdate로 claim
2. polling-analyst, event-analyst로부터 받은 분석 결과를 확인 (SendMessage 수신)
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

#### 3-3. E2E 테스터 & QA 검증자 (구현 완료 후 스폰 또는 대기)

구현 태스크가 완료되면 테스터를 스폰한다.

```
Agent(
  name="tester",
  team_name="realtime-detection",
  model="sonnet",
  mode="plan",
  description="테스트 & QA 검증",
  prompt="""
당신은 '실시간 감지 팀'의 **E2E 테스터 & QA 검증자**입니다.

## 팀 정보
- 팀명: realtime-detection
- ~/.claude/teams/realtime-detection/config.json에서 팀원 목록 확인 가능
- TaskList로 할당된 태스크 확인 후 작업 시작
- **plan 모드**: 테스트 코드 작성 전 plan 제출 → 팀 리더 승인

## 검증 프로세스 (순서대로)

[Step 1] 정적 검증
    npm run typecheck && npm run lint && npm run test

[Step 2] 통합 테스트 — 실제 LGU+ API
    npm run test:integration

[Step 3] 전체 파이프라인 검증
    npx tsx tests/integration/connection-test.ts --phase=5 --monitor=30

[Step 4] 파일 시스템 확인
    다운로드 폴더 파일 존재, 디렉토리 구조, 파일 크기 > 0

[Step 5] DB 상태 확인
    detection_checkpoints, sync_files 상태 확인

## 기존 테스트 인프라
- `tests/integration/setup.ts` — setupIntegration(), InMemoryStateManager, waitForDetection()
- `tests/integration/folder-detection.test.ts` — FC operCode 감지, forceCheck
- `tests/integration/download.test.ts` — 실제 파일 다운로드, 한글 파일명
- `tests/integration/encoding.test.ts` — EUC-KR 인코딩 검증
- `tests/core/file-detector.test.ts` — 폴링, checkpoint, operCode, 백오프
- `tests/core/file-detector-limitations.test.ts` — 알려진 한계 문서화

## 검증 실패 시
실패 케이스를 구체적으로 기록하고 SendMessage로 implementer에게 전달 → 수정 → 재검증 루프

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
3. **아키텍처 결정**: 동시성 설계, operCode 정책 등 설계 판단이 필요한 경우 직접 결정하여 SendMessage로 전달
4. **크로스 도메인 조율**: SyncEngine, StateManager, EventBus 등 공유 영역 충돌 방지
5. **최종 검증**: 모든 태스크 완료 후 `npm run typecheck && npm run lint && npm run test` 직접 실행

### Step 5: 종료

모든 태스크 완료 + 최종 검증 통과 시:

1. 각 팀원에게 `SendMessage(type="shutdown_request")` 전송
2. `TeamDelete(team_name="realtime-detection")`
3. `docs/work-logs/`에 작업 문서 작성 (CLAUDE.md 규칙 준수)

---

## 팀 리더 판단 가이드

### 분석가 스폰 전략

| 사용자 요청 유형 | 스폰할 분석가 |
|-----------------|--------------|
| 폴링/동시성 이슈만 (DET-C1~C3, M1~M2 등) | polling-analyst만 |
| 이벤트/IPC 이슈만 (DET-M5~M8 등) | event-analyst만 |
| 복합 이슈 / 전체 리뷰 | 둘 다 병렬 |
| 단순 버그 수정 (분석 불필요) | 분석가 생략, implementer 직행 |

### plan 승인 체크리스트

- [ ] 변경 파일 목록이 정확한가?
- [ ] 이슈 의존성 그룹(섹션 3)을 고려했는가?
- [ ] 인터페이스(I접두사) 컨벤션 준수?
- [ ] EventBus 변경 시 4레이어 동시 수정?
- [ ] 크로스 도메인(다운로드 팀) 영향 없는가?
- [ ] 회귀 위험이 적절히 관리되는가?

---

## 도메인 컨텍스트

> 이 섹션의 전문을 각 팀원 프롬프트의 `{도메인 컨텍스트}` 자리에 삽입한다.

### 감지 파이프라인 개요

```
LGU+ API (getUploadHistory)
    │
    ▼
FileDetector (폴링, checkpoint 비교)
    │
    ├─ EventBus.emit('detection:found')  → IPC → Renderer (notification)
    │
    └─ onFilesDetected 핸들러 → SyncEngine.handleDetectedFiles()
                                     │
                                     ├─ UP/CP → enqueueFileSync → downloadOnly → uploadOnly
                                     ├─ D/MV/RN → saveFolderChange (로그)
                                     ├─ FC/FD/FRN/FMV → saveFolderChange (로그)
                                     └─ EventBus.emit('opercode:event') → [미연결] Renderer 미도달
```

### 핵심 파일 맵

| 컴포넌트 | 파일 | 역할 |
|----------|------|------|
| FileDetector | `src/core/file-detector.ts` | LGU+ 웹하드 변경 폴링, checkpoint 기반 증분 감지, operCode 분류 |
| EventBus | `src/core/event-bus.ts` | 이벤트 pub-sub (Map 기반) |
| SyncEngine (감지 부분) | `src/core/sync-engine.ts` | handleDetectedFiles, startFileSync, operCode 분기 처리 |
| LGUplusClient (감지 부분) | `src/core/lguplus-client.ts` | getUploadHistory() — POST /wh (USE_HISTORY) |
| StateManager (감지 부분) | `src/core/state-manager.ts` | getCheckpoint/saveCheckpoint — detection_checkpoints 테이블 |
| FolderTreeCache | `src/core/folder-tree-cache.ts` | 폴더 트리 TTL 캐시 (fullSync에서만 사용, 실시간 감지와 무관) |
| IPC Router (감지 부분) | `src/main/ipc-router.ts` | test:realtime-start/stop, bridgeEventsToRenderer |
| Sync Store (감지 부분) | `src/renderer/stores/sync-store.ts` | recentEvents, handleOperCodeEvent |

### 타입 정의

- `src/core/types/file-detector.types.ts` — IFileDetector, DetectedFile
- `src/core/types/events.types.ts` — EventMap, OperCode, DetectionStrategy, IEventBus
- `src/shared/ipc-types.ts` — IpcEventMap (detection:new-files, opercode:event)

### DB 테이블 (감지 관련)

- **detection_checkpoints**: key(PK), value — `last_history_no` 저장
- **sync_files**: 감지된 파일 저장 (saveFile → lguplus_file_id = itemSrcNo)
- **folder_changes**: operCode별 폴더 변경 이력 (D/MV/RN/FC/FD/FRN/FMV)

### OperCode 체계

| 코드 | 의미 | 대상 | 처리 |
|------|------|------|------|
| `UP` | 업로드 | 파일 | enqueueFileSync (다운로드+업로드) |
| `CP` | 복사 | 파일 | enqueueFileSync |
| `D` | 삭제 | 파일 | saveFolderChange (로그) |
| `MV` | 이동 | 파일 | saveFolderChange (로그) |
| `RN` | 이름변경 | 파일 | saveFolderChange (로그, new_path 미구현) |
| `FC` | 폴더생성 | 폴더 | saveFolderChange (로그) |
| `FD` | 폴더삭제 | 폴더 | saveFolderChange (로그) |
| `FMV` | 폴더이동 | 폴더 | saveFolderChange (로그) |
| `FRN` | 폴더이름변경 | 폴더 | saveFolderChange (로그) |
| `DN` | 다운로드 | 파일 | **필터링 제외** (자기 다운로드 기록) |

### 폴링 메커니즘 상세

```
pollForFiles() 실행 흐름:

1. getCheckpoint('last_history_no')
   ├─ null → baseline 모드: page=1 조회, max historyNo 저장, 빈 배열 반환
   └─ 존재 → 증분 모드

2. getUploadHistory(operCode='', page=1) 호출
   └─ POST /wh { MESSAGE_TYPE: 'USE_HISTORY', REQUEST_OPER_CODE: '' }

3. 다중 페이지 처리 (최대 MAX_POLL_PAGES=10)
   ├─ 첫 페이지에서 totalPages 계산
   ├─ historyNo > lastNo인 항목 필터링
   ├─ DN operCode 제외
   └─ 모든 항목이 lastNo 이하이면 조기 중단

4. checkpoint 갱신
   └─ 전체 신규 항목(DN 포함)의 max historyNo로 갱신

5. toDetectedFile() 변환
   ├─ 폴더 operCode: 확장자 없음
   ├─ 파일 operCode: 확장자 중복 방지 (대소문자 무시)
   └─ lguplusFileId = item.itemSrcNo (ITEM_SRC_NO)

6. notifyDetection()
   ├─ 등록된 핸들러 콜백
   └─ EventBus.emit('detection:found')
```

### 에러 백오프

```
연속 실패 5회: 폴링 간격 ×2 (최대 60초)
연속 실패 3회: warn 로그 발행 (EventBus 미발행)
성공 시: consecutiveFailures 리셋, 원래 간격 복원 (stop→start 재귀)
```

### EventBus → Renderer 브릿지

| EventBus 이벤트 | IPC 채널 | 연결 상태 |
|---|---|---|
| `detection:found` | `detection:new-files` | **연결됨** |
| `engine:status` | `sync:status-changed` | 연결됨 |
| `sync:progress` | `sync:progress` | 연결됨 |
| `file:completed` | `sync:file-completed` | 연결됨 |
| `sync:failed` | `sync:file-failed` | 연결됨 |
| `opercode:event` | — | **미연결 (갭)** |

### 테스트 파일

- `tests/core/file-detector.test.ts` — 폴링, checkpoint, operCode, 백오프, 확장자 처리
- `tests/core/file-detector-limitations.test.ts` — 알려진 한계 문서화

### 알려진 한계

| 한계 | 상태 | 내용 |
|------|------|------|
| 게스트 업로드 감지 | **미검증** | getUploadHistory()가 거래처 업로드를 반환하는지 실제 환경에서 확인 안 됨 |
| fullSync와 단절 | 문서화 | 실시간 감지(history polling)와 전체 스캔(폴더 직접 조회)은 서로 다른 메커니즘 |
| snapshot/integrity 전략 | 미구현 | DetectionStrategy에 정의만 있고 polling만 구현됨 |
| operCode 실제 처리 | 일부만 | UP/CP만 파일 동기화, 나머지는 로그만 기록 (자체웹하드 반영 미구현) |

---

## 알려진 이슈 카탈로그

### CRITICAL (3건)

| ID | 컴포넌트 | 파일:라인 | 이슈 |
|----|---------|----------|------|
| DET-C1 | SyncEngine | `sync-engine.ts:59-75` | start() 중복 호출 시 onFilesDetected 핸들러 이중 등록 → 동일 파일 이중 처리 |
| DET-C2 | SyncEngine | `sync-engine.ts:77-103` | stop() 시 detectionUnsubscribe→detector.stop() 순서 오류 → 감지 이벤트 누락 |
| DET-C3 | SyncEngine | `sync-engine.ts:220-228` | scanFolder worker pool이 전역 maxConcurrent 우회 (감지+fullSync 동시 시 ×2) |

### MAJOR (8건)

| ID | 컴포넌트 | 파일:라인 | 이슈 |
|----|---------|----------|------|
| DET-M1 | FileDetector | `file-detector.ts:214-231` | 백오프 복원 시 stop()→start() 재귀로 동시 poll 발생 가능 |
| DET-M2 | FileDetector | `file-detector.ts:99` | isPolling 잠금 없어 setInterval + forceCheck 동시 실행 가능 |
| DET-M3 | FileDetector | `file-detector.ts:104-112` | 베이스라인 설정 시 1페이지만으로 global max 결정 → 과거 항목이 max로 잡힐 위험 |
| DET-M4 | FileDetector | `file-detector.ts:83 / limitations test` | 게스트(거래처) 업로드가 history에 나오는지 미검증 — **프로그램 핵심 전제** |
| DET-M5 | SyncEngine | `sync-engine.ts:563-569` | handleFileRename의 new_path가 항상 old_path와 동일 (DetectedFile에 newPath 없음) |
| DET-M6 | IPC Router | `ipc-router.ts:bridgeEventsToRenderer` | opercode:event → Renderer 브릿지 **미등록** → recentEvents 항상 비어 있음 |
| DET-M7 | SyncEngine | `sync-engine.ts:59-75` | stopped→syncing 직접 전이 (idle 미경유) → UI 상태 표시 혼란 |
| DET-M8 | SyncEngine | `sync-engine.ts` | startFileSync에서 미등록 폴더의 감지 파일을 조용히 스킵 (로그만, 사용자 알림 없음) |

### MINOR (13건)

| ID | 컴포넌트 | 파일:라인 | 이슈 |
|----|---------|----------|------|
| DET-m1 | FileDetector | `file-detector.ts:198-200` | 알 수 없는 operCode 폴백 시 경고 로그 없음 |
| DET-m2 | FileDetector | `file-detector.ts:205` | fileSize 항상 0 → UI 진행률 0%, daily_stats 부정확 |
| DET-m3 | FileDetector | `file-detector.ts:76-83` | 백오프 인터벌 변경이 stop→start 재귀와 맞물려 비결정적 |
| DET-m4 | FileDetector | `file-detector.ts:16` | MAX_POLL_PAGES=10 하드코딩 → 200개 초과 이벤트 누락 가능 (장기 오프라인) |
| DET-m5 | FileDetector | `file-detector.ts:239-243` | 폴링 에러가 EventBus로 발행되지 않음 → UI "연결 끊김" 알림 불가 |
| DET-m6 | FileDetector | `file-detector.ts:184,188,194` | filePath 구성 시 trailing slash 미방어 → 경로 결합 오류 |
| DET-m7 | EventBus | `event-bus.ts:24-29` | emit에서 핸들러 예외가 이후 핸들러 실행을 차단 |
| DET-m8 | EventBus | `event-bus.ts:15-22` | off가 중복 등록 핸들러의 첫 번째만 제거 |
| DET-m9 | EventBus | `events.types.ts:86-89` | IEventBus.on()이 unsubscribe 함수를 반환하지 않음 |
| DET-m10 | SyncEngine | `sync-engine.ts:714-717` | getPathSegments에서 '..' 미필터링 (path traversal) |
| DET-m11 | LGUplusClient | `lguplus-client.ts` | getUploadHistory 응답 인코딩 폴백 (EUC-KR) 시 이중 디코딩 |
| DET-m12 | Renderer | `sync-store.ts` | handleOperCodeEvent 준비되어 있지만 호출되지 않음 (DET-M6 연관) |
| DET-m13 | IPC Router | `ipc-router.ts` | test:realtime-start에서 엔진 원래 상태 복원 로직 edge case |

---

## 이슈 의존성 그룹

다음 이슈들은 함께 수정해야 한다:

| 그룹 | 이슈들 | 이유 |
|------|--------|------|
| 동시성 제어 | DET-C1, C2, M1, M2, m3 | 폴링/구독/해제 레이스 컨디션이 모두 연쇄적 |
| operCode 이벤트 체인 | DET-M5, M6, m1, m12 | opercode:event 발행→브릿지→스토어→UI 전체 흐름 |
| 감지 정합성 | DET-M3, M4, m4, m6 | checkpoint/베이스라인/경로 정합성 |
| EventBus 안정성 | DET-m7, m8, m9 | 핸들러 안전성/해제 패턴 일관성 |

---

## 크로스 도메인 주의사항

감지 팀의 수정이 다운로드 팀 영역에 영향을 줄 수 있는 경우:
- SyncEngine 변경 (startFileSync, enqueueFileSync)
- StateManager 변경 (saveFile, checkpoint 관련)
- EventBus 타입 변경 (EventMap)

이 경우 **다운로드 팀 이슈 카탈로그도 참조**하여 충돌 방지.

---

## 호출 예시

```bash
# 코드 리뷰
/realtime-detection-team 감지 도메인 전체 리뷰

# 이슈 그룹 수정
/realtime-detection-team 동시성 제어 수정 (DET-C1, C2, M1, M2)
/realtime-detection-team operCode 이벤트 체인 완성 (DET-M5, M6, m1, m12)

# 버그 수정
/realtime-detection-team 폴링 중복 실행으로 파일 이중 감지됨
/realtime-detection-team 앱 재시작 후 이미 처리된 파일 재감지

# E2E 테스트
/realtime-detection-team 실시간 감지 E2E 테스트 작성

# 기능 완성
/realtime-detection-team operCode D/MV/RN 처리 시 자체웹하드 반영 구현
```
