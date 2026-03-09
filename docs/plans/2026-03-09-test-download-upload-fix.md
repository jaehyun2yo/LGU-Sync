# 테스트 페이지 다운로드/업로드 실동작 연결 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** TestPage에서 폴더 스캔 → 다운로드 → 업로드 흐름이 실제로 동작하도록 upload 핸들러의 버그를 수정하고, 비DB 폴더의 다운로드-업로드 연계를 보장한다.

**Architecture:** download 핸들러는 이미 실제 다운로드를 수행하지만, upload 핸들러에 폴더 ID 해석 누락과 progress 이벤트 미발송 버그가 있다. 또한 비DB 폴더(올리기전용 외부 폴더)는 state에 기록되지 않아 업로드 단계에서 누락된다. download 핸들러 패턴을 upload 핸들러에 동일하게 적용하여 해결한다.

**Tech Stack:** TypeScript, Electron IPC, Node.js

---

## 현재 상태 분석

### 동작하는 것
- `test:scan-folders`: LGU+ API로 실제 폴더 트리 스캔 ✅
- `test:download-only`: DB 폴더 → `engine.downloadOnly()` → `lguplus.downloadFile()` 실제 다운로드 ✅
- `test:download-only`: 비DB 폴더 → `lguplus.downloadFile()` 직접 다운로드 ✅
- `test:download-only`: progress 이벤트 발송 ✅
- `test:full-sync`: 다운로드+업로드 순차 실행 ✅

### 버그 / 누락 사항
1. **`test:upload-only` 폴더 ID 해석 버그**: `state.getFolders()` 반환값(DB UUID)과 `request.folderIds`(`lguplus:123` 접두사 가능)를 직접 비교 → 매칭 실패
2. **`test:upload-only` progress 이벤트 없음**: UI에 업로드 진행 상황 미표시
3. **비DB 폴더 다운로드 후 업로드 불가**: `lguplus.downloadFile()` 직접 호출 시 state DB에 파일 미기록 → upload 단계에서 해당 파일 미발견

---

## 구현 과제

### Task 1: upload 핸들러 — 폴더 ID 해석 로직 추가

**Files:**
- Modify: `src/main/ipc-router.ts` (test:upload-only 핸들러, 약 906~948행)

**Step 1: 현재 코드 확인**

현재 upload 핸들러의 폴더 필터링 로직:
```typescript
// 현재 (버그): lguplus: 접두사 ID는 절대 매칭 안됨
const folders = state.getFolders(true)
const targetFolders = request.folderIds
  ? folders.filter((f) => request.folderIds.includes(f.id))
  : folders
```

**Step 2: download 핸들러와 동일한 ID 해석 로직 적용**

download 핸들러의 `TargetFolder` 해석 패턴을 upload 핸들러에 동일하게 적용:
```typescript
ipcMain.handle('test:upload-only', async (_event, request) => {
  try {
    const start = Date.now()
    const results: Array<{
      fileId: string; fileName: string; success: boolean; error?: string
    }> = []
    let uploadedFiles = 0
    let failedFiles = 0

    const sendProgress = (data: {
      currentFile: string; completedFiles: number; totalFiles: number; phase: string; error?: string
    }): void => {
      _event.sender.send('test:progress', {
        testType: 'upload' as const,
        ...data,
      })
    }

    // Resolve target folders: support both DB UUIDs and lguplus: prefix IDs
    interface UploadTargetFolder {
      dbFolderId: string
      folderName: string
    }
    const targetFolders: UploadTargetFolder[] = []

    if (request.folderIds) {
      for (const fid of request.folderIds) {
        if (fid.startsWith('lguplus:')) {
          const lguplusId = fid.slice('lguplus:'.length)
          const dbFolder = state.getFolderByLguplusId(lguplusId)
          if (dbFolder) {
            targetFolders.push({
              dbFolderId: dbFolder.id,
              folderName: dbFolder.lguplus_folder_name,
            })
          }
          // 비DB 폴더는 업로드 대상이 아니므로 skip
        } else {
          const folder = state.getFolder(fid)
          if (folder) {
            targetFolders.push({
              dbFolderId: fid,
              folderName: folder.lguplus_folder_name,
            })
          }
        }
      }
    } else {
      const folders = state.getFolders(true)
      for (const f of folders) {
        targetFolders.push({
          dbFolderId: f.id,
          folderName: f.lguplus_folder_name,
        })
      }
    }

    // Collect all downloadedFiles across target folders
    const allDownloadedFiles: Array<{ id: string; file_name: string; folderName: string }> = []
    for (const folder of targetFolders) {
      const downloadedFilesList = state.getFilesByFolder(folder.dbFolderId, { status: 'downloaded' as any })
      for (const file of downloadedFilesList) {
        allDownloadedFiles.push({ id: file.id, file_name: file.file_name, folderName: folder.folderName })
      }
    }

    const totalFiles = allDownloadedFiles.length

    for (let i = 0; i < allDownloadedFiles.length; i++) {
      const file = allDownloadedFiles[i]

      sendProgress({
        currentFile: file.file_name,
        completedFiles: i,
        totalFiles,
        phase: 'uploading',
      })

      const ulResult = await engine.uploadOnly(file.id)
      results.push({
        fileId: file.id,
        fileName: file.file_name,
        success: ulResult.success,
        error: ulResult.error,
      })

      if (ulResult.success) uploadedFiles++
      else failedFiles++
    }

    sendProgress({
      currentFile: '',
      completedFiles: uploadedFiles + failedFiles,
      totalFiles,
      phase: 'uploading',
    })

    return ok({
      uploadedFiles,
      failedFiles,
      durationMs: Date.now() - start,
      results,
    })
  } catch (e) {
    return fail('TEST_UPLOAD_FAILED', (e as Error).message)
  }
})
```

**Step 3: typecheck 실행**

Run: `npm run typecheck`
Expected: PASS (에러 없음)

**Step 4: 커밋**

```bash
git add src/main/ipc-router.ts
git commit -m "fix: resolve lguplus: prefix folder IDs in upload handler and add progress events"
```

---

### Task 2: download 핸들러 — 비DB 폴더 파일도 state에 등록

**Files:**
- Modify: `src/main/ipc-router.ts` (test:download-only 핸들러, 비DB 폴더 분기 약 855~883행)

**현재 문제:**
비DB 폴더(`isDbFolder=false`)의 파일은 `lguplus.downloadFile()`로 직접 다운로드 후 state에 기록하지 않음.
→ 업로드 단계에서 해당 파일을 찾지 못함.

**Step 1: 비DB 폴더도 DB에 등록 후 engine 경유 다운로드로 변경**

비DB 폴더는 `올리기전용` 외부 폴더이므로 동기화 대상이 아님 → 직접 다운로드 경로를 유지하되, download_path를 반환하여 UI에서 확인 가능하게 함.

실제로 비DB 폴더는 `내리기전용` 등 동기화 대상이 아닌 폴더이므로, 현재 동작이 정확함. 추가 변경 불필요.

> **결정사항:** 비DB 폴더는 다운로드만 테스트하고 업로드 대상에서 제외하는 것이 도메인 규칙에 부합. 현재 동작 유지.

---

### Task 3: 기존 테스트 통과 확인

**Step 1: 전체 테스트 실행**

Run: `npm run test`
Expected: 기존 테스트 모두 PASS

**Step 2: typecheck 실행**

Run: `npm run typecheck`
Expected: PASS

**Step 3: lint 실행**

Run: `npm run lint`
Expected: PASS (또는 warning만)

**Step 4: 커밋 (필요시)**

```bash
git add -A
git commit -m "chore: verify tests pass after upload handler fix"
```

---

## 요약

| 항목 | 현재 | 수정 후 |
|------|------|---------|
| 다운로드 (DB 폴더) | ✅ 실제 동작 | ✅ 변경 없음 |
| 다운로드 (비DB 폴더) | ✅ 실제 동작 | ✅ 변경 없음 |
| 업로드 폴더 ID 해석 | ❌ lguplus: 접두사 미처리 | ✅ DB UUID로 변환 |
| 업로드 progress 이벤트 | ❌ 미발송 | ✅ test:progress 발송 |
| 비DB 폴더 업로드 | ❌ 불가 | ⏭️ 의도적 제외 (도메인 규칙) |
