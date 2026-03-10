# 015. Baseline 초기화 - 감지 시작 시점 이후만 감지

- **날짜:** 2026-03-10

## 변경 요약
감지 시작 시 이전 데이터를 모두 감지하는 버그 수정. Polling/Snapshot 전략 모두 첫 폴링에서 baseline을 설정하여 이전 데이터를 건너뛴다.

## 변경 파일
- `src/core/file-detector.ts` — pollForFiles()에 polling baseline, scanSingleFolder()에 snapshot baseline 로직 추가
- `tests/core/file-detector.test.ts` — baseline 테스트 6개 추가, mock 기본값 호환성 수정

## 주요 결정사항
- Polling: checkpoint null이면 현재 max historyNo를 저장하고 감지 건너뜀
- Snapshot: 폴더별 in-memory Map으로 baseline 파일 ID 관리, DB와 합산하여 diff
- DB 스키마/타입 변경 없이 구현 (최소 침습)

## 검증
- typecheck / lint / test 전체 통과
