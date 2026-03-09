# 008. 업로드 batch-record 응답 파싱 수정

- **날짜:** 2026-03-09
- **브랜치:** master

## 변경 요약
`/batch-record` API 응답 형식 불일치로 인한 업로드 실패 버그 수정. 서버는 `{ data: { inserted, files } }` 구조를 반환하지만 클라이언트가 `{ data: Array<...> }`를 기대하여 `data[0].id`에서 TypeError 발생.

## 변경 파일
- `src/core/webhard-uploader/yjlaser-uploader.ts` — batch-record 응답 타입 및 파싱 로직을 서버 실제 형식에 맞게 수정, null 안전 처리 추가
- `tests/mocks/yjlaser-api-handlers.ts` — MSW mock 응답을 새 형식 `{ success, data: { inserted, files } }`으로 업데이트
- `tests/core/yjlaser-uploader.test.ts` — 인라인 batch-record mock 핸들러를 새 형식으로 수정
- `tests/core/yjlaser-uploader-batch-record.test.ts` — batch-record 응답 파싱 전용 단위 테스트 3개 추가

## 주요 결정사항
- 서버가 `size`, `createdAt` 필드를 반환하지 않으므로 로컬 값(`fileStat.size`, `new Date().toISOString()`) 사용
- `recorded.id`가 서버에서 number로 반환되므로 `String()` 변환
- `recordRes.data?.files?.[0]` optional chaining + null 체크로 빈 응답 시 명확한 에러 메시지 제공

## 검증
- typecheck: PASS
- 기존 uploader 테스트 31개: PASS
- 신규 batch-record 테스트 3개: PASS
- 빌드: PASS
