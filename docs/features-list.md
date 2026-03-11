# 기능 및 버그 추적

## 핵심 기능 상태

| # | 기능 | 상태 | 담당 서비스 |
|---|------|------|------------|
| 1 | 외부웹하드 폴링 감지 | 완료 | FileDetector |
| 2 | 파일 다운로드 | 완료 | LGUplusClient |
| 3 | 자체웹하드 업로드 | 완료 | YjlaserUploader |
| 4 | 동기화 상태 관리 | 완료 | StateManager (SQLite) |
| 5 | 실시간 감지 | 완료 | DetectionService |
| 6 | 통합 알림 | 완료 | NotificationService + 토스트 |
| 7 | 서킷 브레이커 | 완료 | RetryManager |
| 8 | 폴더 구조 보존 다운로드 | 완료 | SyncEngine |
| 9 | 깊은 폴더 스캔 | 완료 | FolderDiscovery |
| 10 | 스캔 진행바/디렉토리 트리 | 완료 | UI (RealtimeDetectionPage) |
| 11 | 한글 인코딩 처리 | 완료 | LGUplusClient |

## 미해결 버그

| # | 설명 | 심각도 | 관련 파일 |
|---|------|--------|----------|
| 1 | 실시간 감지 버그 3건 | 중간 | detection-service.ts (진행 중) |

## 계획된 기능

| # | 기능 | 우선순위 |
|---|------|----------|
| - | (계획 시 추가) | - |
