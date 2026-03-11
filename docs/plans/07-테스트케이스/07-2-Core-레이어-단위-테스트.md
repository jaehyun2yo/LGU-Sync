# 테스트케이스 명세서 - 2. Core 레이어 단위 테스트

> **원본 문서**: [07-테스트케이스-명세서](../07-테스트케이스-명세서.md)

---

## 2. Core 레이어 단위 테스트

### 2.1 SyncEngine

> 동기화 오케스트레이션. 상태: idle | syncing | paused | error. 관련 기능: F-03, F-15

| TC ID | 테스트명 | 입력 | 기대 결과 | 우선순위 | Spec Ref |
|-------|---------|------|----------|---------|---------|
| TC-CORE-SYNC-001 | 엔진 시작 시 RUNNING 상태 전이 | `start()` 호출 | 상태가 `RUNNING`으로 변경, FileDetector.start() 호출됨 | P0 | `ISyncEngine.start()` |
| TC-CORE-SYNC-002 | 엔진 중지 시 체크포인트 저장 | `stop()` 호출 | 상태가 `STOPPED`, 진행중 작업 완료 후 체크포인트 저장 | P0 | `ISyncEngine.stop()` |
| TC-CORE-SYNC-003 | 일시정지 시 새 감지 중단 | `pause()` 호출 | 상태가 `PAUSED`, 진행중 다운로드는 완료, 새 폴링 중단 | P0 | `ISyncEngine.pause()` |
| TC-CORE-SYNC-004 | 재개 시 폴링 재시작 | PAUSED 상태에서 `resume()` | 상태가 `RUNNING`, FileDetector 폴링 재시작 | P0 | `ISyncEngine.resume()` |
| TC-CORE-SYNC-005 | 전체 동기화 파이프라인 실행 | `fullSync()` 호출 + 3개 파일 존재 | 스캔 -> 비교 -> 다운로드 -> 업로드 순서 실행, 3건 완료 | P0 | `ISyncEngine.fullSync()` |
| TC-CORE-SYNC-006 | 감지 이벤트의 파이프라인 처리 | FileDetector가 FILE_CREATED 이벤트 발행 | 큐잉 -> 다운로드 -> 업로드 -> 완료 이벤트 발행 | P0 | `ISyncEngine` |
| TC-CORE-SYNC-007 | 동시 다운로드 수 제한 (기본 5) | 10개 파일 동시 감지 | 최대 5개만 동시 다운로드, 나머지 큐 대기 | P1 | `ISyncEngine` |
| TC-CORE-SYNC-008 | 파이프라인 중 에러 발생 시 상태 전이 | 다운로드 실패(네트워크 오류) | 상태가 `ERROR`, 자동 복구 시도, 복구 성공 시 `RUNNING` | P0 | `ISyncEngine` |
| TC-CORE-SYNC-009 | 이벤트 우선순위 처리 순서 | FOLDER_CREATED(1) + FILE_CREATED(2) 동시 발생 | FOLDER_CREATED 먼저 처리 후 FILE_CREATED 처리 | P1 | `ISyncEngine` |
| TC-CORE-SYNC-010 | 전체 동기화 중 실시간 감지 병행 | fullSync() 진행 중 새 파일 업로드 | 전체 동기화와 실시간 감지 모두 정상 처리 | P1 | `ISyncEngine.fullSync()` |
| TC-CORE-SYNC-011 | 전체 동기화 중간 취소 및 이어받기 | fullSync() 50% 진행 후 취소, 재시작 | 나머지 50%만 처리 (체크포인트 기반) | P1 | `ISyncEngine.fullSync()` |
| TC-CORE-SYNC-012 | FATAL 상태에서 수동 재시작 | 복구 불가 에러 → FATAL 상태 | FATAL에서 `start()` 호출 시 재초기화 시도 | P2 | `ISyncEngine.start()` |

### 2.2 FileDetector

> 3중 감지 전략 (폴링 + 스냅샷 + 무결성). 관련 기능: F-02

| TC ID | 테스트명 | 입력 | 기대 결과 | 우선순위 | Spec Ref |
|-------|---------|------|----------|---------|---------|
| TC-CORE-DETECT-001 | 히스토리 폴링으로 신규 파일 감지 | 히스토리 API에 새 항목(operCode: UP) | `detection:found` 이벤트 발행, SyncEvent 생성 | P0 | `IFileDetector.forceCheck()` |
| TC-CORE-DETECT-002 | historyNo 체크포인트 기반 중복 방지 | 동일 historyNo 2회 반환 | 첫 번째만 처리, 두 번째는 무시 | P0 | `IFileDetector` |
| TC-CORE-DETECT-003 | 이벤트 감지 후 즉시 재폴링 (최대 3회) | 첫 폴링에서 1건 감지 | 500ms 이내 재폴링 실행, 최대 3회 연속 | P0 | `IFileDetector` |
| TC-CORE-DETECT-004 | 스냅샷 비교로 누락 파일 감지 | 이전 스냅샷 대비 새 파일 2건 | FILE_CREATED 이벤트 2건 생성 | P0 | `IFileDetector.forceCheck()` |
| TC-CORE-DETECT-005 | 스냅샷 비교 - 수정된 파일 감지 | 동일 경로, 크기/mtime 변경 | FILE_MODIFIED 이벤트 생성 | P1 | `IFileDetector.forceCheck()` |
| TC-CORE-DETECT-006 | 스냅샷 비교 - 삭제된 파일 감지 | 이전 스냅샷에 있던 파일이 현재 없음 | FILE_DELETED 이벤트 생성 | P1 | `IFileDetector.forceCheck()` |
| TC-CORE-DETECT-007 | 무결성 검증 - 누락 파일 재동기화 | DB에 completed인데 내부웹하드에 없음 | FILE_CREATED 이벤트 재생성 | P1 | `IFileDetector` |
| TC-CORE-DETECT-008 | 중복 제거 - 3중 감지의 동일 파일 | 폴링+스냅샷 모두 같은 파일 감지 | 이벤트 1건만 큐에 추가 (fileKey 기반) | P0 | `IFileDetector` |
| TC-CORE-DETECT-009 | 비대상 폴더 파일 필터링 | 선택되지 않은 폴더의 파일 업로드 | 이벤트 생성되지 않음 | P0 | `IFileDetector` |
| TC-CORE-DETECT-010 | 임시 파일 확장자 필터링 | .tmp, .partial, .crdownload 파일 | 이벤트 폐기 + 로그 기록 | P1 | `IFileDetector` |
| TC-CORE-DETECT-011 | 시스템 파일 패턴 필터링 | Thumbs.db, desktop.ini, ~$temp | 이벤트 폐기 | P1 | `IFileDetector` |
| TC-CORE-DETECT-012 | 0바이트 파일 필터링 | fileSize === 0 | 이벤트 폐기 | P1 | `IFileDetector` |
| TC-CORE-DETECT-013 | 폴링 간격 동적 변경 | `setPollingInterval(10000)` | 다음 폴링부터 10초 간격 적용 | P2 | `IFileDetector.setPollingInterval()` |
| TC-CORE-DETECT-014 | Primary 연속 3회 실패 시 Secondary 간격 단축 | 폴링 3회 연속 실패 | 스냅샷 비교 간격 10분 -> 5분으로 단축 | P1 | `IFileDetector` |
| TC-CORE-DETECT-015 | 프로그램 재시작 후 체크포인트 이어받기 | 저장된 historyNo=500 | historyNo 500 이후부터 폴링 시작 | P0 | `IFileDetector.start()` |

### 2.3 LGUplusClient

> LGU+ 웹하드 비공식 API HTTP 통신. 관련 기능: F-01

| TC ID | 테스트명 | 입력 | 기대 결과 | 우선순위 | Spec Ref |
|-------|---------|------|----------|---------|---------|
| TC-CORE-LGUPLUS-001 | HTTP API 직접 로그인 성공 | 유효한 아이디/비밀번호 | 세션 쿠키 획득, validateSession() 성공 | P0 | `ILGUplusClient.login()` |
| TC-CORE-LGUPLUS-002 | HTTP 로그인 실패 시 Playwright 폴백 | HTTP 로그인 실패(403) | Playwright 브라우저 로그인 시도 | P0 | `ILGUplusClient.login()` |
| TC-CORE-LGUPLUS-003 | 세션 유효성 검증 (15분 타이머) | 15분 경과 | validateSession() 호출, 만료 시 refreshSession() | P0 | `ILGUplusClient.validateSession()` |
| TC-CORE-LGUPLUS-004 | API 호출 중 세션 만료 감지 | 302 리다이렉트 / RESULT_CODE 9999 | 자동 재로그인 후 원래 API 재시도 | P0 | `ILGUplusClient.refreshSession()` |
| TC-CORE-LGUPLUS-005 | 업로드 히스토리 조회 | since_no=100, limit=100 | history_no > 100인 항목 반환, 올바른 파싱 | P0 | `ILGUplusClient.getUploadHistory()` |
| TC-CORE-LGUPLUS-006 | 폴더 목록 조회 (재귀) | 루트 폴더 경로 | 하위 폴더 트리 구조 정상 반환 | P0 | `ILGUplusClient.listFolder()` |
| TC-CORE-LGUPLUS-007 | 파일 다운로드 정보 획득 | 유효한 fileId | session, nonce, url 포함된 응답 | P0 | `ILGUplusClient.getDownloadInfo()` |
| TC-CORE-LGUPLUS-008 | 파일 다운로드 실행 | 다운로드 URL 정보 | 파일 정상 다운로드, 크기 일치 | P0 | `ILGUplusClient.downloadFile()` |
| TC-CORE-LGUPLUS-009 | 잘못된 자격증명 처리 | 틀린 비밀번호 | 로그인 실패 에러, 적절한 에러 코드 반환 | P0 | `ILGUplusClient.login()` |
| TC-CORE-LGUPLUS-010 | 로그인 연속 3회 실패 시 알림 | 3회 연속 실패 | 사용자 알림 이벤트 발행, 재입력 요청 | P1 | `ILGUplusClient.login()` |
| TC-CORE-LGUPLUS-011 | CAPTCHA 감지 처리 | 로그인 응답에 CAPTCHA 포함 | CAPTCHA 알림 이벤트 발행 | P1 | `ILGUplusClient.login()` |
| TC-CORE-LGUPLUS-012 | API 응답 타임아웃 | 10초 이상 무응답 | 타임아웃 에러 발생, 재시도 대상 | P1 | `ILGUplusClient` |
| TC-CORE-LGUPLUS-013 | 자격증명 암호화 저장 | 비밀번호 저장 | 저장소에 평문이 아닌 암호화된 값 기록 | P0 | `ILGUplusClient` |

### 2.4 RetryManager

> 재시도 정책, 서킷 브레이커, DLQ. 관련 기능: F-16, F-17

| TC ID | 테스트명 | 입력 | 기대 결과 | 우선순위 | Spec Ref |
|-------|---------|------|----------|---------|---------|
| TC-CORE-RETRY-001 | 네트워크 에러 지수 백오프 재시도 | NetworkError 발생 | 1s -> 2s -> 4s -> 8s -> 16s 간격, 최대 5회 | P0 | `IRetryManager.execute()` |
| TC-CORE-RETRY-002 | 인증 에러 재인증 후 1회 재시도 | AuthError 발생 | 재인증 시도 -> 성공 시 원래 요청 1회 재시도 | P0 | `IRetryManager.execute()` |
| TC-CORE-RETRY-003 | Rate Limit Retry-After 헤더 대기 | 429 + Retry-After: 45 | 45초 대기 후 재시도, 최대 3회 | P1 | `IRetryManager.execute()` |
| TC-CORE-RETRY-004 | 파일시스템 에러 즉시 실패 | FileSystemError | 재시도 없이 즉시 실패, 사용자 알림 | P0 | `IRetryManager.execute()` |
| TC-CORE-RETRY-005 | 서버 에러 고정 간격 재시도 | 500 Server Error | 30초 간격으로 최대 3회 재시도 | P1 | `IRetryManager.execute()` |
| TC-CORE-RETRY-006 | 최대 재시도 소진 시 DLQ 이동 | 네트워크 에러 6회 연속 실패 | DLQ에 이벤트 추가, 알림 발행 | P0 | `IRetryManager.execute()` |
| TC-CORE-RETRY-007 | 서킷 브레이커 CLOSED -> OPEN 전이 | 최근 20건 중 8건 실패 (40%) | 상태 OPEN, 모든 요청 즉시 실패 반환 | P0 | `IRetryManager.getCircuitState()` |
| TC-CORE-RETRY-008 | 서킷 브레이커 OPEN -> HALF_OPEN 전이 | OPEN 상태에서 10초 경과 | 상태 HALF_OPEN, 테스트 요청 1건 허용 | P0 | `IRetryManager.getCircuitState()` |
| TC-CORE-RETRY-009 | 서킷 브레이커 HALF_OPEN -> CLOSED 전이 | HALF_OPEN에서 테스트 요청 성공 | 상태 CLOSED, 모든 요청 허용 | P0 | `IRetryManager.getCircuitState()` |
| TC-CORE-RETRY-010 | 서킷 브레이커 HALF_OPEN -> OPEN 전이 | HALF_OPEN에서 테스트 요청 실패 | 상태 OPEN으로 복귀 | P1 | `IRetryManager.getCircuitState()` |
| TC-CORE-RETRY-011 | DLQ 수동 개별 재시도 | DLQ 항목 선택 -> 재시도 | retryCount 초기화, 이벤트 큐에 재추가 | P1 | `IRetryManager.retryDlqItem()` |
| TC-CORE-RETRY-012 | DLQ 전체 재시도 | `retryAllDlq()` 호출 | 모든 DLQ 항목을 이벤트 큐에 재추가 | P1 | `IRetryManager.retryAllDlq()` |
| TC-CORE-RETRY-013 | DLQ 항목 자동 삭제 (30일 보관) | 30일 이상 된 DLQ 항목 | 자동 삭제 실행 | P2 | `IRetryManager.getDlqItems()` |
| TC-CORE-RETRY-014 | 지터(Jitter) 적용 확인 | 네트워크 에러 재시도 | 대기 시간에 ±50% 범위 지터 적용 | P2 | `IRetryManager.execute()` |

### 2.5 StateManager

> SQLite WAL 기반 상태 영속화. 관련 기능: F-18, F-15

| TC ID | 테스트명 | 입력 | 기대 결과 | 우선순위 | Spec Ref |
|-------|---------|------|----------|---------|---------|
| TC-CORE-STATE-001 | 체크포인트 저장/조회 | `saveCheckpoint('primary.last_history_no', 500)` | `getCheckpoint()` 시 500 반환 | P0 | `IStateManager.saveCheckpoint()` |
| TC-CORE-STATE-002 | 동기화 이벤트 CRUD | SyncEvent 저장 | 저장 -> 조회 -> 상태 업데이트 -> 재조회 정상 | P0 | `IStateManager.saveFile()` |
| TC-CORE-STATE-003 | 이벤트 상태 전이 | pending -> downloading -> uploading -> completed | 각 전이 시 DB 반영, 타임스탬프 갱신 | P0 | `IStateManager.updateFileStatus()` |
| TC-CORE-STATE-004 | 일별 통계 집계 | 10건 completed, 2건 failed 기록 | `getStats(today)` 시 success:10, failed:2 반환 | P1 | `IStateManager.getStats()` |
| TC-CORE-STATE-005 | DLQ 항목 CRUD | DLQ 항목 추가/조회/삭제 | 정상 CRUD 동작 | P0 | `IStateManager.moveToDlq()` |
| TC-CORE-STATE-006 | 동기화 폴더 선택 저장/조회 | 폴더 enabled/disabled 설정 | 재시작 후에도 선택 상태 유지 | P0 | `IStateManager.toggleFolder()` |
| TC-CORE-STATE-007 | 설정값 저장/조회/기본값 | `set('pollingIntervalSec', 10)` | `get('pollingIntervalSec')` 시 10 반환 | P0 | `IStateManager.getFolders()` |
| TC-CORE-STATE-008 | WAL 모드 읽기/쓰기 동시성 | 동시 읽기 + 쓰기 | 오류 없이 정상 동작 | P1 | `IStateManager` |
| TC-CORE-STATE-009 | 스키마 자동 마이그레이션 | 이전 버전 DB 파일 | 마이그레이션 실행, schema_version 갱신 | P1 | `IStateManager.initialize()` |
| TC-CORE-STATE-010 | DB 파일 손상 시 복구 | 손상된 DB 파일 | 백업에서 복원 시도, 실패 시 새 DB 생성 + 전체 동기화 | P1 | `IStateManager.backup()` |
| TC-CORE-STATE-011 | 자동 백업 실행 (일 1회) | 24시간 경과 | DB 파일 백업 생성, 최근 7개만 보관 | P2 | `IStateManager.backup()` |
| TC-CORE-STATE-012 | 로그 자동 정리 (30일) | 30일 이상 된 로그 레코드 | 자동 삭제 실행 | P2 | `IStateManager` |

### 2.6 EventBus

> 타입 안전 이벤트 발행/구독. 관련 기능: 전체 모듈 간 통신

| TC ID | 테스트명 | 입력 | 기대 결과 | 우선순위 | Spec Ref |
|-------|---------|------|----------|---------|---------|
| TC-CORE-EVENT-001 | 이벤트 발행 및 구독 | `on('sync:completed')` + `emit('sync:completed', data)` | 구독 핸들러에 data 전달 | P0 | `IEventBus.emit()` / `IEventBus.on()` |
| TC-CORE-EVENT-002 | 다중 구독자 동시 수신 | 동일 이벤트에 3개 핸들러 등록 | 3개 핸들러 모두 호출 | P0 | `IEventBus.on()` |
| TC-CORE-EVENT-003 | 구독 해제 | `off('sync:completed', handler)` | 이후 이벤트 발행 시 해당 핸들러 미호출 | P0 | `IEventBus.off()` |
| TC-CORE-EVENT-004 | 1회성 구독 (once) | `once('session:expired')` | 첫 이벤트만 핸들러 호출, 이후 자동 해제 | P1 | `IEventBus.once()` |
| TC-CORE-EVENT-005 | 타입 안전성 검증 | 잘못된 페이로드 타입 전달 | TypeScript 컴파일 에러 (런타임은 아닌 정적 검증) | P1 | `IEventBus.emit()` |
| TC-CORE-EVENT-006 | 핸들러 에러 격리 | 구독 핸들러에서 예외 발생 | 다른 핸들러 실행에 영향 없음, 에러 로그 기록 | P0 | `IEventBus.emit()` |
| TC-CORE-EVENT-007 | 이벤트 순서 보장 | 순차적 emit 3회 | 구독자가 발행 순서대로 수신 | P1 | `IEventBus.emit()` |

### 2.7 DownloadManager

> 동시 다운로드, 진행률, atomic write, 검증. 관련 기능: F-04

| TC ID | 테스트명 | 입력 | 기대 결과 | 우선순위 | Spec Ref |
|-------|---------|------|----------|---------|---------|
| TC-CORE-DOWN-001 | 단일 파일 다운로드 성공 | 유효한 fileId + 다운로드 URL | 임시파일 -> 검증 -> 최종 경로 이동 완료 | P0 | `IDownloadManager.download()` |
| TC-CORE-DOWN-002 | 동시 다운로드 수 제한 (5개) | 10개 파일 동시 요청 | 최대 5개 동시 진행, 나머지 대기 | P0 | `IDownloadManager.batchDownload()` |
| TC-CORE-DOWN-003 | 다운로드 진행률 추적 | 10MB 파일 다운로드 | 500ms 간격으로 progress 이벤트 발행 | P1 | `IDownloadManager.download()` |
| TC-CORE-DOWN-004 | Atomic Write 패턴 | 다운로드 완료 | 임시파일(.tmp) -> rename으로 최종 경로 이동 | P0 | `IDownloadManager.download()` |
| TC-CORE-DOWN-005 | 다운로드 중 실패 시 임시 파일 정리 | 네트워크 단절 | 불완전한 .tmp 파일 삭제 | P0 | `IDownloadManager.download()` |
| TC-CORE-DOWN-006 | 파일 크기 검증 | 다운로드 완료 파일 | downloaded.size === expected.size | P0 | `IDownloadManager.download()` |
| TC-CORE-DOWN-007 | 파일 읽기 가능 검증 | 다운로드 완료 파일 | fs.open(path, 'r') 성공 | P1 | `IDownloadManager.download()` |
| TC-CORE-DOWN-008 | 동적 타임아웃 (크기별) | 10MB 미만 / 100MB 미만 / 1GB 미만 | 2분 / 5분 / 15분 타임아웃 적용 | P1 | `IDownloadManager.download()` |
| TC-CORE-DOWN-009 | 특수문자 파일명 처리 | `[어뮤즈] 가차_목형.DXF` | 경로 구분자/제어문자 제거, 정상 저장 | P0 | `IDownloadManager.download()` |
| TC-CORE-DOWN-010 | 동일 파일명 충돌 처리 | 같은 경로에 다른 내용의 파일 | 타임스탬프 추가된 파일명으로 저장 | P1 | `IDownloadManager.download()` |
| TC-CORE-DOWN-011 | 동시성 자동 조절 | 성공률 < 50% | concurrency를 1로 감소 | P2 | `IDownloadManager.batchDownload()` |
| TC-CORE-DOWN-012 | 임시 파일 정리 (24시간) | 24시간 이상 된 .tmp 파일 | 자동 삭제 | P2 | `IDownloadManager` |
| TC-CORE-DOWN-013 | 스트림 기반 대용량 다운로드 | 500MB 파일 Mock | 메모리 사용량 64KB 내외 유지 | P1 | `IDownloadManager.download()` |

### 2.8 ConfigManager

> 설정 읽기/쓰기/검증/암호화. 관련 기능: F-09

| TC ID | 테스트명 | 입력 | 기대 결과 | 우선순위 | Spec Ref |
|-------|---------|------|----------|---------|---------|
| TC-CORE-CONF-001 | 설정 로드 (파일 존재) | 유효한 설정 파일 | 모든 설정값 정상 로드 | P0 | `IConfigManager.getAll()` |
| TC-CORE-CONF-002 | 설정 로드 (파일 없음) | 설정 파일 미존재 | 기본값으로 초기화, 파일 생성 | P0 | `IConfigManager.getAll()` |
| TC-CORE-CONF-003 | 개별 설정 저장 | `set('pollingIntervalSec', 10)` | DB/파일에 반영, 변경 이벤트 발행 | P0 | `IConfigManager.set()` |
| TC-CORE-CONF-004 | 비밀번호 암호화 저장 | `set('lguplusPassword', 'secret')` | 저장소에 암호화된 값, get() 시 복호화 | P0 | `IConfigManager.set()` / `IConfigManager.get()` |
| TC-CORE-CONF-005 | 설정 검증 (유효하지 않은 값) | pollingIntervalSec = -1 | 검증 에러 반환, 저장 거부 | P0 | `IConfigManager.validate()` |
| TC-CORE-CONF-006 | 설정 변경 이벤트 구독 | `onChanged('pollingIntervalSec', handler)` | 변경 시 handler 호출됨 | P1 | `IConfigManager.onChanged()` |
| TC-CORE-CONF-007 | 전체 설정 초기화 | `reset()` 호출 | 모든 설정 기본값으로 복원 | P1 | `IConfigManager.reset()` |
| TC-CORE-CONF-008 | 설정 파일 손상 시 기본값 복원 | 손상된 JSON 파일 | 기본값으로 복원 + 사용자 알림 | P1 | `IConfigManager.getAll()` |
| TC-CORE-CONF-009 | 설정 변경 즉시 적용 (재시작 불필요) | 폴링 간격 변경 | 변경 이벤트를 통해 SyncEngine에 즉시 반영 | P0 | `IConfigManager.set()` |
