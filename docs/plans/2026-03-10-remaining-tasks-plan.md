# 실시간 감지 파이프라인 안정화 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** polling 기반 실시간 감지 → 다운로드까지 전체 파이프라인을 안정화하고 테스트를 통과시킨다.

**Architecture:** FileDetector(polling) → EventBus → SyncEngine → LGUplusClient(download) → 로컬 저장. snapshot 전략은 폐기하고 polling 전략 단일화. FolderDiscovery는 게스트폴더 전체 재귀 탐색.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Electron

---

## 현재 상태

- 단위 테스트: 272 pass / 38 fail (23 파일)
- 통합 테스트: 8/8 pass
- 실패 분류:
  - better-sqlite3 네이티브 모듈: 29개 (state-manager 전체)
  - FolderDiscovery 재귀 변경: 2개
  - FileDetector snapshot: 4개
  - FileDetector limitations: 3개
- 미커밋 변경: 25개 파일
- 한글 파일명 인코딩 깨짐 (`?뚯뒪??`) 미해결

---

### Task 1: better-sqlite3 네이티브 모듈 재빌드

**Files:**
- 없음 (환경 설정)

**Step 1: 현재 Node 버전과 Electron 버전 확인**

Run: `node -v && npx electron -v`

**Step 2: better-sqlite3 재빌드**

Run: `npm run rebuild`

이 명령은 `electron-rebuild -f -w better-sqlite3`를 실행한다.

**Step 3: state-manager 테스트 실행**

Run: `npx vitest run tests/core/state-manager.test.ts`
Expected: 29/29 PASS

**Step 4: 실패 시 대안**

rebuild 실패 시 `node_modules` 삭제 후 재설치:
```bash
rm -rf node_modules && npm install && npm run rebuild
```

---

### Task 2: snapshot 전략 폐기 — 테스트 정리

polling 전략이 통합 테스트로 검증됨. snapshot 전략은 미완성이고 사용하지 않으므로 폐기.

**Files:**
- Delete: `tests/core/file-detector-snapshot.test.ts`
- Delete: `src/core/snapshot-diff.ts` (있으면)
- Modify: `src/core/file-detector.ts` — snapshot 관련 코드 제거
- Modify: `src/core/types/events.types.ts` — `DetectionStrategy`에서 `'snapshot'` 유지 (하위 호환)
- Modify: `tests/core/file-detector-limitations.test.ts` — snapshot 참조 제거

**Step 1: snapshot 테스트 파일 삭제**

```bash
rm tests/core/file-detector-snapshot.test.ts
```

**Step 2: FileDetector에서 snapshot 코드 제거**

`src/core/file-detector.ts`에서:
- `import { diffSnapshot }` 제거
- `snapshotBaselines` 필드 제거
- `pollBySnapshot()` 메서드 전체 제거
- `scanSingleFolder()` 메서드 전체 제거
- `start()`의 strategy 분기 제거 — polling만 남김
- `forceCheck()`의 strategy 분기 제거
- `FileDetectorOptions.strategy` 필드 제거

**Step 3: snapshot-diff 파일 삭제 (있으면)**

```bash
ls src/core/snapshot-diff.ts && rm src/core/snapshot-diff.ts
```

**Step 4: limitations 테스트 수정**

`tests/core/file-detector-limitations.test.ts`에서 snapshot 관련 테스트 확인 후:
- `'기본 전략은 polling이고 operCode='' 전체 조회를 사용한다'` → strategy 필드 제거에 맞게 수정
- 실패 중인 3개 테스트 원인 분석 후 수정

**Step 5: 테스트 실행**

Run: `npx vitest run tests/core/file-detector.test.ts tests/core/file-detector-limitations.test.ts`
Expected: ALL PASS (snapshot 테스트 4개 제거, limitations 3개 수정)

**Step 6: typecheck**

Run: `npx tsc --noEmit`
Expected: 에러 없음

---

### Task 3: FolderDiscovery 테스트 수정

재귀 탐색으로 변경되었으므로 테스트의 mock 설정과 기대값 수정.

**Files:**
- Modify: `tests/core/folder-discovery.test.ts`

**Step 1: 실패 원인 파악**

현재 실패:
- "새 폴더 5개" → 실제 6개 (올리기전용 폴더 자체도 등록됨)
- "기존 폴더 1개" → 실제 2개 (올리기전용 + ExistingCo)

재귀 탐색에서는 HOME 직속 폴더(올리기전용, 내리기전용 등)도 등록 대상이므로 mock이 이를 반영해야 한다.

**Step 2: mock 수정 — `getSubFolders` 재귀 호출 대응**

재귀 탐색에서 `getSubFolders`가 추가로 호출됨:
1. `getSubFolders(HOME)` → [올리기전용, ...]
2. `getSubFolders(올리기전용)` → [Company-0, Company-1, ...]
3. `getSubFolders(Company-0)` → [] (리프)
4. `getSubFolders(Company-1)` → [] (리프)
5. ...

mock을 `.mockResolvedValue([])`로 기본값 설정하고, 특정 호출만 override.

**Step 3: 기대값 수정**

- 새 폴더 테스트: `result.total`이 6 (올리기전용 1 + 하위 5), `result.newFolders` 6
- 기존 폴더 테스트: `existingFolders` 2 (올리기전용 + ExistingCo) 또는 mock 조정

**Step 4: 테스트 실행**

Run: `npx vitest run tests/core/folder-discovery.test.ts`
Expected: ALL PASS

---

### Task 4: 한글 파일명 인코딩 문제 조사 및 수정

로그에서 `?뚯뒪??(8).DXF.DXF` 같은 깨진 파일명 발생.

**Files:**
- Modify: `src/core/lguplus-client.ts` — `callWhApi` 응답 인코딩 처리
- Test: 통합 테스트로 검증

**Step 1: 실제 API 응답 인코딩 확인**

통합 테스트에서 `getUploadHistory` 응답의 raw bytes를 확인하는 스크립트 작성.
`callWhApi`의 `response.text()` → `response.arrayBuffer()` 로 바꿔서 바이너리 확인.

LGU+ 웹하드 API는 `Content-Type: application/json; charset=euc-kr` 또는 유사 인코딩을 사용할 수 있다.

**Step 2: 인코딩 변환 적용 (필요시)**

`callWhApi`에서:
```typescript
const buffer = await response.arrayBuffer()
const decoder = new TextDecoder('euc-kr')
const text = decoder.decode(buffer)
const data = JSON.parse(text)
```

**Step 3: 통합 테스트로 한글 파일명 확인**

한글 파일이 포함된 history를 조회하여 파일명이 정상적으로 디코딩되는지 확인.

**Step 4: 기존 테스트 영향 확인**

Run: `npx vitest run tests/core/lguplus-client*.test.ts`
Expected: ALL PASS

---

### Task 5: 다운로드 E2E 통합 테스트

실제 LGU+ API에서 파일을 다운로드하여 로컬에 저장되는지 검증.

**Files:**
- Create: `tests/integration/download.test.ts`
- Modify: `tests/integration/setup.ts` — 다운로드 관련 유틸 추가

**Step 1: 테스트 셋업 확장**

setup.ts에 `SyncEngine` 생성 헬퍼 추가:
- ConfigManager (tempDownloadPath 지정)
- RetryManager
- MockUploader (업로드 스킵)
- SyncEngine with 모든 deps

**Step 2: 다운로드 테스트 작성**

1. 감지된 UP 이벤트 → `engine.downloadOnly(fileId)` → 로컬 파일 존재 확인
2. 다운로드된 파일 크기 검증
3. 한글 파일명 다운로드 검증

**Step 3: 테스트 실행**

Run: `npm run test:integration`
Expected: 기존 8개 + 새 테스트 PASS

**Step 4: cleanup — 다운로드된 임시 파일 삭제**

`afterAll`에서 다운로드 폴더 정리.

---

### Task 6: 미커밋 변경사항 커밋 정리

현재 25개 파일이 미커밋. 논리적 단위로 분리 커밋.

**커밋 1: 핵심 서비스 리팩토링 (이전 세션 작업)**
- `src/core/db/schema.ts`, `src/core/db/types.ts`
- `src/core/file-detector.ts`, `src/core/sync-engine.ts`
- `src/core/state-manager.ts`
- `src/core/types/events.types.ts`, `src/core/types/state-manager.types.ts`
- `src/core/types/sync-status.types.ts`, `src/core/types/webhard-uploader.types.ts`
- `tests/core/file-detector.test.ts`, `tests/core/sync-engine.test.ts`
- `tests/core/pipeline-integration.test.ts`, `tests/mocks/lguplus-handlers.ts`

**커밋 2: 실시간 감지 polling 전환**
- `src/core/container.ts` (strategy: 'polling')
- `src/core/lguplus-client.ts` (createFolder 추가)
- `src/core/types/lguplus-client.types.ts`
- `src/core/folder-discovery.ts` (재귀 탐색)

**커밋 3: 테스트 - 실시간 감지 UI 교체**
- `src/main/ipc-router.ts` (EventBus 구독 방식)
- `src/shared/ipc-types.ts` (RealtimeTestStartRequest 간소화)
- `src/renderer/pages/TestPage.tsx` (전략 선택기 제거)
- `src/renderer/pages/DashboardPage.tsx`
- `src/renderer/pages/FileExplorerPage.tsx`
- `src/renderer/stores/sync-store.ts`

**커밋 4: 통합 테스트 인프라**
- `vitest.integration.config.ts`
- `vitest.config.ts` (integration 제외)
- `package.json` (test:integration 스크립트)
- `tests/integration/setup.ts`
- `tests/integration/folder-detection.test.ts`

**커밋 5: 작업 문서**
- `docs/plans/2026-03-10-detection-integration-test-design.md`
- `docs/plans/2026-03-10-detection-integration-test-plan.md`
- `docs/work-logs/014~016`

---

### Task 7: 작업 문서 갱신

**Files:**
- Modify: `docs/work-logs/016-통합테스트-폴더감지.md` — 최종 변경사항 반영
- Create: `docs/work-logs/017-polling-전환-폴더등록.md` — polling 전환, 폴더 재귀 등록, 테스트 UI 교체

---

## 실행 순서

```
Task 1 (better-sqlite3) ─┐
Task 2 (snapshot 폐기)   ├→ Task 6 (커밋 정리) → Task 7 (문서)
Task 3 (폴더 테스트)     │
Task 4 (인코딩)          ┘
Task 5 (다운로드 E2E) ────→ 별도 진행 가능
```

Task 1~3은 독립적으로 병렬 수행 가능.
Task 4는 통합 테스트 환경 필요 (API 호출).
Task 5는 Task 4 이후 진행.
Task 6은 Task 1~4 완료 후 한번에 커밋.
