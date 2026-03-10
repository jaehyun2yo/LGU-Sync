# 014. operCode 실시간 감지 + 로그인 디버깅

- **날짜:** 2026-03-10
- **브랜치:** master

## 변경 요약
LGU+ 웹하드 로그인 실패 디버깅 강화 + 모든 operCode(UP/D/MV/RN/CP/FC/FD/FMV/FRN) 실시간 감지 및 라우팅 구현. DB 스키마 확장, SyncEngine operCode별 처리, UI 이벤트 타임라인, IWebhardUploader 확장 인터페이스 추가.

## 변경 파일

### Phase 0: 로그인 디버깅
- `src/main/ipc-router.ts` — 에러 메시지 전달 수정 (`'Login failed'` → `result.message || 'Login failed'`)
- `src/core/lguplus-client.ts` — 쿠키 파싱 개선 (`getSetCookie()` 우선 사용), 로그인 각 Step별 상세 로그 추가, hidden field 자동 파싱, Accept/Accept-Language 헤더 추가

### Phase 1-4: operCode 실시간 감지

**DB 확장:**
- `src/core/db/schema.ts` — `sync_files.oper_code`, `sync_events.oper_code` 마이그레이션 추가, `folder_changes` 테이블 신규 생성
- `src/core/db/types.ts` — `SyncFileRow/Insert`, `SyncEventRow/Insert`에 `oper_code` 필드 추가, `FolderChangeRow/Insert` 인터페이스 추가
- `src/core/state-manager.ts` — `saveFolderChange()`, `getFolderChanges()`, `updateFolderChange()` 메서드 추가, `saveFile()`에 `oper_code` 바인딩
- `src/core/types/state-manager.types.ts` — `IStateManager`에 새 메서드 3개 추가

**Core 서비스:**
- `src/core/sync-engine.ts` — `handleDetectedFiles()` switch-case 라우팅으로 재작성, 8개 private 핸들러 추가 (D/RN/MV/FC/FD/FRN/FMV), `opercode:event` emit
- `src/core/types/events.types.ts` — `EventMap`에 `opercode:event` 추가
- `src/core/types/webhard-uploader.types.ts` — `IWebhardUploader`에 delete/move/rename 메서드 6개 추가
- `src/shared/ipc-types.ts` — `OperCodeEvent` 인터페이스, `IpcEventMap`에 `opercode:event` 추가, `NewFilesEvent`에 `operCode` 필드

**UI:**
- `src/renderer/stores/sync-store.ts` — `recentEvents` 상태 + `handleOperCodeEvent` 액션 추가
- `src/renderer/pages/DashboardPage.tsx` — `OPERCODE_CONFIG` 9개 operCode 매핑, `EventTimeline` 컴포넌트, `downloaded` 상태 아이콘
- `src/renderer/pages/FileExplorerPage.tsx` — `source_deleted` 전용 아이콘/스타일 분리

**테스트:**
- `tests/mocks/lguplus-handlers.ts` — `createMockHistoryItem()`, `setMockHistory()`, `createAllOperCodeHistory()` 헬퍼 추가
- `tests/core/file-detector.test.ts` — operCode 감지 테스트 4개 추가
- `tests/core/sync-engine.test.ts` — operCode 라우팅 테스트 8개 추가

## 주요 결정사항
- `getSetCookie()` API를 우선 사용하여 Node.js fetch의 Set-Cookie 헤더 병합 문제 해결
- 아직 자체웹하드(yjlaser.net) API에 삭제/이동/이름변경 엔드포인트가 없으므로, D/MV/RN/FC/FD/FRN/FMV는 DB에 `folder_changes` 레코드만 생성 (향후 API 구현 시 연동)
- IWebhardUploader 인터페이스만 확장하고 구현체는 아직 추가하지 않음 (자체웹하드 API 구현 후 작업)

## 검증
- typecheck: 통과 (`tsc --noEmit` 에러 0)
- test: 22/23 파일 통과 (state-manager.test.ts는 better-sqlite3 네이티브 모듈 버전 불일치 - 기존 환경 이슈)
- 275개 테스트 통과, 29개 실패 (전부 better-sqlite3 환경 이슈)
