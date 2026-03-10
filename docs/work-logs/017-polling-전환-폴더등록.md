# 017. Polling 단일화, 스냅샷 전략 폐기, 한글 인코딩 수정

- **날짜:** 2026-03-10
- **브랜치:** master

## 변경 요약

FileDetector의 snapshot 전략을 폐기하고 polling 전략으로 단일화했다. FolderDiscovery는 게스트폴더 전체 재귀 탐색으로 전환. LGU+ API 응답의 한글 인코딩(EUC-KR) 깨짐 문제를 해결했다.

## 변경 파일

### 스냅샷 전략 폐기
- `src/core/file-detector.ts` — `pollBySnapshot()`, `scanSingleFolder()`, strategy 분기 전면 제거
- `src/core/container.ts` — strategy 옵션 제거
- `src/core/snapshot-diff.ts` — 삭제
- `tests/core/file-detector-snapshot.test.ts` — 삭제
- `tests/core/snapshot-detector.test.ts` — 삭제
- `tests/core/file-detector-limitations.test.ts` — snapshot 참조 정리, checkpoint 설정 추가
- `tests/core/file-detector.test.ts` — snapshot 전략 테스트 블록 제거

### Polling 전환 + 폴더 재귀 탐색
- `src/core/folder-discovery.ts` — 게스트폴더 전체 재귀 탐색
- `tests/core/folder-discovery.test.ts` — 재귀 탐색 mock/기대값 수정

### 한글 인코딩 수정
- `src/core/lguplus-client.ts` — `decodeResponse()` 헬퍼 추가 (Content-Type charset 감지 + EUC-KR fallback)

### UI 교체
- `src/main/ipc-router.ts` — EventBus 구독 방식 전환
- `src/shared/ipc-types.ts` — `RealtimeTestStartRequest` 간소화
- `src/renderer/pages/TestPage.tsx` — 전략 선택기 제거
- `src/renderer/pages/DashboardPage.tsx` — 상태 표시 업데이트
- `src/renderer/pages/FileExplorerPage.tsx` — 파일 탐색기 개선
- `src/renderer/stores/sync-store.ts` — 스토어 타입 정리

## 주요 결정사항

### Snapshot 전략 폐기 이유
- polling이 통합 테스트로 검증됨
- snapshot은 미완성 상태 + 추가 메모리 사용
- 두 전략 유지보수 비용 대비 이점 없음

### EUC-KR 인코딩 처리 전략
`decodeResponse()` 헬퍼: charset 명시 → 해당 charset 사용, charset 미지정 → UTF-8 시도 후 replacement char(U+FFFD) 있으면 EUC-KR fallback. LGU+ API가 `charset=euc-kr`를 명시하기도 하고, charset 없이 EUC-KR로 보내기도 함.

## 검증

- `npm run test` — 291/291 통과
- `npm run test:integration` — 16/16 통과 (폴더감지 8 + 인코딩 2 + 다운로드 6)
- typecheck: 에러 없음
