# 011. 전체 operCode 실시간 감지

- **날짜:** 2026-03-09
- **브랜치:** master

## 변경 요약
FileDetector의 polling 전략을 `operCode='UP'`에서 `operCode=''`(전체)로 변경하여 UP, D, MV, RN, CP, FC, FD, FMV, FRN 모든 변동을 감지하도록 개선. DN(다운로드)은 본인 다운로드 기록이므로 자동 필터링.

## 변경 파일
- `src/core/types/events.types.ts` — `OperCode` 타입 추가, `DetectedFile`에 `operCode` 필드 추가
- `src/core/file-detector.ts` — `getUploadHistory({ operCode: '' })` 전체 조회, DN 필터링, 폴더 operCode 파일명 처리
- `src/core/snapshot-diff.ts` — snapshot 감지 시 `operCode: 'UP'` 기본값 추가
- `src/core/sync-engine.ts` — `handleDetectedFiles`에서 operCode별 분기 (UP/CP만 동기화, 나머지는 로깅)
- `src/main/ipc-router.ts` — 실시간 감지 테스트에 operCode 라벨 표시, UP/CP만 다운로드/업로드
- `src/shared/ipc-types.ts` — `RealtimeTestEvent`에 `operCode` 필드 추가
- `src/renderer/pages/TestPage.tsx` — 실시간 감지 로그에 operCode 유형 컬럼 및 색상 추가
- `tests/core/file-detector.test.ts` — DN 필터링, 전체 operCode 감지, operCode='' 호출 테스트 추가
- `tests/core/file-detector-snapshot.test.ts` — operCode 검증 추가
- `tests/core/file-detector-limitations.test.ts` — 해결된 한계 반영 (operCode 전체 조회)

## 주요 결정사항
- **DN 제외**: 본인 다운로드 기록은 감지할 필요 없으므로 필터링. 단, checkpoint 갱신 시에는 DN 포함하여 max historyNo 계산 (누락 방지)
- **UP/CP만 동기화**: 삭제(D), 이동(MV), 이름변경(RN) 등은 로깅만 수행. 향후 자체 웹하드 측 삭제/이동 동기화 필요 시 확장 가능
- **폴더 operCode**: FC/FD/FMV/FRN은 확장자가 없으므로 파일명 생성 로직 분기
- **OperCode 타입**: string literal union으로 정의하여 타입 안전성 확보

## 검증
- `npm run typecheck` — 통과
- `npm run test` — file-detector 관련 31개 테스트 모두 통과 (기존 better-sqlite3 환경 문제는 무관)
