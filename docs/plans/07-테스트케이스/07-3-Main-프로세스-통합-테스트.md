# 테스트케이스 명세서 - 3. Main 프로세스 통합 테스트

> **원본 문서**: [07-테스트케이스-명세서](../07-테스트케이스-명세서.md)

---

## 3. Main 프로세스 통합 테스트

### 3.1 IPC 핸들러

> 채널별 요청/응답, Core 메서드 위임. 관련 기능: 전체 UI-Core 연동

| TC ID | 테스트명 | 입력 | 기대 결과 | 우선순위 |
|-------|---------|------|----------|---------|
| TC-MAIN-IPC-001 | sync:getStatus 채널 | invoke('sync:getStatus') | 현재 SyncEngine 상태(state, stats) 반환 | P0 |
| TC-MAIN-IPC-002 | sync:start 채널 | invoke('sync:start') | SyncEngine.start() 호출, 성공 응답 | P0 |
| TC-MAIN-IPC-003 | sync:stop 채널 | invoke('sync:stop') | SyncEngine.stop() 호출, 성공 응답 | P0 |
| TC-MAIN-IPC-004 | sync:pause 채널 | invoke('sync:pause') | SyncEngine.pause() 호출 | P0 |
| TC-MAIN-IPC-005 | sync:resume 채널 | invoke('sync:resume') | SyncEngine.resume() 호출 | P0 |
| TC-MAIN-IPC-006 | sync:fullSync 채널 | invoke('sync:fullSync') | SyncEngine.fullSync() 호출 | P0 |
| TC-MAIN-IPC-007 | settings:get 채널 | invoke('settings:get', 'pollingIntervalSec') | ConfigManager.get() 결과 반환 | P0 |
| TC-MAIN-IPC-008 | settings:set 채널 | invoke('settings:set', key, value) | ConfigManager.set() 호출, 성공 응답 | P0 |
| TC-MAIN-IPC-009 | settings:testConnection 채널 | invoke('settings:testConnection', 'lguplus') | LGUplusClient.login() 테스트 결과 반환 | P1 |
| TC-MAIN-IPC-010 | folders:getList 채널 | invoke('folders:getList') | 동기화 폴더 목록 반환 | P0 |
| TC-MAIN-IPC-011 | folders:setEnabled 채널 | invoke('folders:setEnabled', folderId, true) | 폴더 활성화 상태 변경 | P0 |
| TC-MAIN-IPC-012 | logs:query 채널 | invoke('logs:query', { level, search, dateRange }) | 필터링된 로그 목록 반환 | P1 |
| TC-MAIN-IPC-013 | stats:get 채널 | invoke('stats:get', { period: '30d' }) | 기간별 통계 데이터 반환 | P1 |
| TC-MAIN-IPC-014 | dlq:getItems 채널 | invoke('dlq:getItems') | DLQ 항목 목록 반환 | P1 |
| TC-MAIN-IPC-015 | dlq:retry 채널 | invoke('dlq:retry', itemId) | DLQ 항목 재시도 실행 | P1 |
| TC-MAIN-IPC-016 | EventBus -> IPC 이벤트 브릿지 | Core에서 sync:progress 이벤트 발행 | webContents.send로 Renderer에 전달 | P0 |
| TC-MAIN-IPC-017 | 존재하지 않는 채널 호출 | invoke('invalid:channel') | 에러 응답 반환 (앱 크래시 없음) | P1 |

### 3.2 시스템 트레이

> 트레이 아이콘, 컨텍스트 메뉴, 상태 표시. 관련 기능: F-07

| TC ID | 테스트명 | 입력 | 기대 결과 | 우선순위 |
|-------|---------|------|----------|---------|
| TC-MAIN-TRAY-001 | 트레이 아이콘 생성 | 앱 시작 | 시스템 트레이에 아이콘 표시 | P0 |
| TC-MAIN-TRAY-002 | 상태별 아이콘 색상 변경 | 엔진 상태 변경 이벤트 | 정상(초록), 오류(빨강), 일시중지(회색) | P0 |
| TC-MAIN-TRAY-003 | 컨텍스트 메뉴 - 열기 | 우클릭 -> "열기" | BrowserWindow 표시 (restore/focus) | P0 |
| TC-MAIN-TRAY-004 | 컨텍스트 메뉴 - 일시중지/재개 | 우클릭 -> "일시중지" | SyncEngine.pause() 호출, 메뉴 라벨 "재개"로 변경 | P0 |
| TC-MAIN-TRAY-005 | 컨텍스트 메뉴 - 전체 동기화 | 우클릭 -> "전체 동기화" | SyncEngine.fullSync() 호출 | P1 |
| TC-MAIN-TRAY-006 | 컨텍스트 메뉴 - 종료 | 우클릭 -> "종료" | 확인 대화상자 표시 후 앱 종료 | P0 |
| TC-MAIN-TRAY-007 | 더블클릭으로 창 복원 | 트레이 아이콘 더블클릭 | 메인 창 표시 (최소화 복원) | P1 |
| TC-MAIN-TRAY-008 | 툴팁 상태 정보 표시 | 마우스 호버 | "동기화 중 - 오늘 N건 완료" 표시 | P2 |

### 3.3 자동 시작

> Windows 시작 시 자동 실행. 관련 기능: F-08

| TC ID | 테스트명 | 입력 | 기대 결과 | 우선순위 |
|-------|---------|------|----------|---------|
| TC-MAIN-AUTO-001 | 자동 시작 활성화 | 설정에서 autoStart=true | 레지스트리(HKCU\...\Run) 등록 | P0 |
| TC-MAIN-AUTO-002 | 자동 시작 비활성화 | 설정에서 autoStart=false | 레지스트리 항목 제거 | P0 |
| TC-MAIN-AUTO-003 | 자동 시작 시 트레이 모드 | 자동 시작으로 앱 실행 | 메인 창 없이 트레이 아이콘만 표시 | P0 |
| TC-MAIN-AUTO-004 | 레지스트리 쓰기 권한 없을 시 폴백 | 레지스트리 접근 실패 | 시작 폴더 바로가기 방식으로 대체 | P1 |

### 3.4 알림

> Windows 토스트 알림 및 인앱 알림. 관련 기능: F-13

| TC ID | 테스트명 | 입력 | 기대 결과 | 우선순위 |
|-------|---------|------|----------|---------|
| TC-MAIN-NOTI-001 | 오류 발생 시 토스트 알림 | SyncEngine ERROR 이벤트 | Windows Notification API 호출 | P0 |
| TC-MAIN-NOTI-002 | 알림 클릭 시 앱 활성화 | 토스트 알림 클릭 | 메인 창 표시 + 관련 화면 이동 | P1 |
| TC-MAIN-NOTI-003 | 알림 유형별 설정 반영 | 동기화 완료 알림 OFF | 동기화 완료 시 토스트 미표시 | P1 |
| TC-MAIN-NOTI-004 | 대량 알림 그룹핑 | 10건의 동기화 완료 | "10건의 파일 동기화 완료" 그룹 알림 1건 | P1 |
| TC-MAIN-NOTI-005 | 토스트 API 실패 시 인앱 폴백 | Notification API 에러 | 인앱 알림으로 대체 | P2 |

### 3.5 앱 생명주기

> 시작, 종료, 단일 인스턴스. 관련 기능: F-07, F-08

| TC ID | 테스트명 | 입력 | 기대 결과 | 우선순위 |
|-------|---------|------|----------|---------|
| TC-MAIN-LIFE-001 | 앱 시작 시 초기화 순서 | app.whenReady() | initCore -> registerIPC -> createTray -> createWindow -> startSync | P0 |
| TC-MAIN-LIFE-002 | 앱 종료 시 정리 순서 | before-quit 이벤트 | stopSync(5초 타임아웃) -> saveState -> closeDb | P0 |
| TC-MAIN-LIFE-003 | 단일 인스턴스 보장 | 앱 2번째 실행 시도 | 기존 인스턴스 활성화, 새 인스턴스 종료 | P0 |
| TC-MAIN-LIFE-004 | 창 닫기 시 트레이 최소화 | X 버튼 클릭 | 창 숨김 (프로세스 유지), 트레이 상주 | P0 |
| TC-MAIN-LIFE-005 | 창 위치/크기 저장 및 복원 | 창 이동/리사이즈 후 재시작 | 이전 위치/크기로 복원 | P2 |
