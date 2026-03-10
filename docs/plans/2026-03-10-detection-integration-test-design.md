# 폴링 기반 실시간 감지 고도화 — 통합 테스트 설계

- **날짜:** 2026-03-10
- **목적:** LGU+ 웹하드 파일/폴더 변경 감지의 신뢰성 검증 및 감지 속도 최적화

## 1. 개요

LGU+ 웹하드 `게스트폴더 > 테스트동기화` 폴더를 대상으로 실제 API를 호출하는 통합 테스트를 작성한다.
파일/폴더 CRUD 조작 후 FileDetector가 올바르게 감지하는지, 감지 속도가 얼마나 되는지,
로컬에 동일한 디렉토리 구조로 동기화되는지를 자동화 검증한다.

## 2. LGUplusClient 쓰기 API 확장

기존 `/wh` 엔드포인트의 `MESSAGE_TYPE`/`PROCESS_TYPE` 패턴을 따라 쓰기 메서드 추가.

### 파일 조작

```typescript
uploadFile(folderId: number, filePath: string): Promise<{ itemId: number }>
deleteFile(itemId: number): Promise<void>
moveFile(itemId: number, targetFolderId: number): Promise<void>
renameFile(itemId: number, newName: string): Promise<void>
```

### 폴더 조작

```typescript
createFolder(parentFolderId: number, folderName: string): Promise<{ folderId: number }>
deleteFolder(folderId: number): Promise<void>
moveFolder(folderId: number, targetParentFolderId: number): Promise<void>
renameFolder(folderId: number, newName: string): Promise<void>
```

### API 역분석 전략

브라우저 DevTools 또는 탐색 스크립트로 `/wh` 엔드포인트의 유효한 MESSAGE_TYPE/PROCESS_TYPE 조합 확인.

## 3. 통합 테스트 구조

### 파일 구성

```
tests/integration/
  setup.ts                     — 공통 설정 (로그인, 테스트 폴더 탐색, cleanup)
  file-operations.test.ts      — 파일 CRUD 감지 테스트
  folder-operations.test.ts    — 폴더 CRUD 감지 테스트
  detection-speed.test.ts      — 폴링 간격별 감지 속도 측정
  local-sync.test.ts           — 로컬 디렉토리 동기화 검증
```

### 실행

```bash
npx vitest run tests/integration/
```

- vitest.config.ts에 integration 프로젝트 추가 (단위 테스트와 분리)
- 타임아웃: 120초 (speed 테스트는 600초)
- 직렬 실행

### 테스트 라이프사이클

```
beforeAll:
  1. LGUplusClient 로그인
  2. 게스트폴더 > 테스트동기화 folderId 탐색
  3. 테스트 폴더 내 기존 파일 정리

each test:
  1. 조작 실행 (업로드/이동/삭제/이름변경)
  2. FileDetector 폴링 시작
  3. 감지될 때까지 대기 (최대 30초)
  4. operCode, 파일명 등 assertion

afterAll:
  1. 테스트 생성 파일/폴더 정리
  2. FileDetector 중지
  3. 로그아웃
```

## 4. 테스트 케이스

### file-operations.test.ts

| 테스트 | 조작 | 기대 operCode |
|--------|------|--------------|
| 파일 업로드 감지 | uploadFile() | UP |
| 파일 삭제 감지 | deleteFile() | D |
| 파일 이동 감지 | moveFile() | MV |
| 파일 이름변경 감지 | renameFile() | RN |

### folder-operations.test.ts

| 테스트 | 조작 | 기대 operCode |
|--------|------|--------------|
| 폴더 생성 감지 | createFolder() | FC |
| 폴더 삭제 감지 | deleteFolder() | FD |
| 폴더 이동 감지 | moveFolder() | FMV |
| 폴더 이름변경 감지 | renameFolder() | FRN |

## 5. 감지 속도 측정

### detection-speed.test.ts

파일 업로드 시각(t0) vs 감지 시각(t1)의 차이를 폴링 간격별로 측정.

| 폴링 간격 | 반복 | 측정 항목 |
|-----------|------|----------|
| 5초 | 3회 | 평균/최소/최대 감지 지연 |
| 3초 | 3회 | 평균/최소/최대 감지 지연 |
| 2초 | 3회 | 평균/최소/최대 감지 지연 |
| 1초 | 3회 | 감지 지연 + API 에러 발생 여부 |

- 각 간격 테스트 사이 10초 쿨다운
- API 에러 없는 최소 간격 = 최적 간격
- 결과를 콘솔 테이블로 출력

## 6. 로컬 디렉토리 동기화 검증

### local-sync.test.ts

동기화 대상 경로: `C:\Users\jaehy\AppData\Roaming\webhard-sync\downloads`

### 시나리오

1. **단일 파일** — 웹하드 업로드 → 로컬 `테스트동기화/test-file.txt` 동기화 확인
2. **하위 폴더 구조** — 하위폴더 생성 + 파일 업로드 → 로컬 중첩 경로 동기화
3. **다중 파일 동시** — 3개 파일 동시 업로드 → 누락 없이 전체 동기화
4. **한글/특수문자 파일명** — `도면_수정본(최종).dxf` 등 인코딩 검증

### 검증 항목

| 항목 | 방법 |
|------|------|
| 파일 존재 | fs.existsSync |
| 파일 크기 | fs.statSync.size === expected |
| 디렉토리 구조 | 웹하드 경로 ↔ 로컬 경로 매핑 |
| 파일 내용 | 원본과 MD5 해시 비교 |

### Cleanup

- 로컬: downloads/테스트동기화/ 하위만 삭제
- 웹하드: 테스트 생성 파일/폴더 삭제
