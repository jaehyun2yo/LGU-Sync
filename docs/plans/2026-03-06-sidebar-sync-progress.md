# Sidebar Sync Progress UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 전체동기화 진행 중일 때 사이드바에 실시간 진행 상태(단계, 퍼센트, 현재파일, 속도, 예상시간)를 표시한다.

**Architecture:** sync-store의 fullSyncProgress 타입을 확장하여 speedBps/estimatedRemainingMs를 포함시키고, Sidebar.tsx에 SyncProgressPanel 컴포넌트를 추가한다. 펼침 모드에서는 상세 정보, 접힘 모드에서는 SVG 원형 프로그레스를 표시한다. 동기화 중이 아닐 때는 완전히 숨긴다.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Zustand 5, lucide-react, vitest

---

## Task 1: sync-store fullSyncProgress 타입 확장

**Files:**
- Modify: `src/renderer/stores/sync-store.ts:33` (fullSyncProgress 타입)
- Modify: `src/renderer/stores/sync-store.ts:160-168` (handleProgress에서 추가 필드 저장)

**Step 1: fullSyncProgress 타입에 speedBps, estimatedRemainingMs 추가**

`sync-store.ts:33` 변경:

```typescript
// 기존
fullSyncProgress: { phase: string; progress: number; currentFile?: string } | null

// 변경
fullSyncProgress: {
  phase: string
  progress: number
  currentFile?: string
  speedBps: number
  estimatedRemainingMs: number
} | null
```

**Step 2: handleProgress에서 추가 필드 저장**

`sync-store.ts:160-168`의 `set()` 호출 내 fullSyncProgress 객체 변경:

```typescript
fullSyncProgress: {
  phase: event.phase,
  progress:
    event.totalFiles > 0 ? (event.completedFiles / event.totalFiles) * 100 : 0,
  currentFile: event.currentFile,
  speedBps: event.speedBps,
  estimatedRemainingMs: event.estimatedRemainingMs,
},
```

**Step 3: stop 액션에서 fullSyncProgress null 처리 확인**

이미 `sync-store.ts:111`에서 `fullSyncProgress: null`로 설정하고 있으므로 변경 불필요.

**Step 4: typecheck 실행**

Run: `npx tsc --noEmit`
Expected: PASS (또는 Sidebar.tsx에서 아직 사용하지 않으므로 기존과 동일)

**Step 5: Commit**

```bash
git add src/renderer/stores/sync-store.ts
git commit -m "feat: extend fullSyncProgress with speedBps and estimatedRemainingMs"
```

---

## Task 2: formatDuration 유틸 함수 추가

**Files:**
- Modify: `src/renderer/lib/utils.ts` (함수 추가)
- Create: `tests/renderer/lib/utils.test.ts` (테스트)

**Step 1: 테스트 작성**

`tests/renderer/lib/utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { formatDuration } from '../../../src/renderer/lib/utils'

describe('formatDuration', () => {
  it('returns empty string for zero or negative', () => {
    expect(formatDuration(0)).toBe('')
    expect(formatDuration(-1000)).toBe('')
  })

  it('formats seconds', () => {
    expect(formatDuration(5000)).toBe('~5초')
    expect(formatDuration(45000)).toBe('~45초')
  })

  it('formats minutes', () => {
    expect(formatDuration(60000)).toBe('~1분')
    expect(formatDuration(150000)).toBe('~2분')
    expect(formatDuration(3540000)).toBe('~59분')
  })

  it('formats hours and minutes', () => {
    expect(formatDuration(3600000)).toBe('~1시간 0분')
    expect(formatDuration(5400000)).toBe('~1시간 30분')
  })
})
```

**Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/renderer/lib/utils.test.ts`
Expected: FAIL - `formatDuration is not a function`

**Step 3: 구현**

`src/renderer/lib/utils.ts` 파일 끝에 추가:

```typescript
export function formatDuration(ms: number): string {
  if (ms <= 0) return ''
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `~${sec}초`
  const min = Math.floor(sec / 60)
  if (min < 60) return `~${min}분`
  const hr = Math.floor(min / 60)
  return `~${hr}시간 ${min % 60}분`
}
```

**Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/renderer/lib/utils.test.ts`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add src/renderer/lib/utils.ts tests/renderer/lib/utils.test.ts
git commit -m "feat: add formatDuration utility function"
```

---

## Task 3: SyncProgressPanel 컴포넌트 구현 (Sidebar.tsx)

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx`

이 태스크는 Sidebar.tsx 내에 두 개의 내부 컴포넌트를 추가한다:
- `CircularProgress` - 접힘 모드용 SVG 원형 프로그레스
- `SyncProgressPanel` - 펼침/접힘 모드 분기를 포함하는 메인 컴포넌트

**Step 1: import 추가**

`Sidebar.tsx` 상단 lucide-react import에 `RefreshCw`, `ArrowDown`, `ArrowUp`, `Search` 추가:

```typescript
import {
  LayoutDashboard,
  FolderOpen,
  FolderSync,
  ScrollText,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  DatabaseBackup,
  RefreshCw,
  ArrowDown,
  ArrowUp,
  Search,
} from 'lucide-react'
```

utils import 추가:

```typescript
import { cn } from '../lib/utils'
// 변경 →
import { cn, formatBytes, formatDuration } from '../lib/utils'
```

**Step 2: CircularProgress 컴포넌트 추가**

`ConnectionDot` 컴포넌트 아래에 추가:

```typescript
function CircularProgress({ percent, title }: { percent: number; title: string }) {
  const size = 20
  const strokeWidth = 2.5
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(100, percent) / 100) * circumference

  return (
    <svg width={size} height={size} className="shrink-0" title={title}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-muted)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-info)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-all duration-300"
      />
    </svg>
  )
}
```

**Step 3: phase 표시 헬퍼 추가**

```typescript
const PHASE_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; iconClass: string }> = {
  scanning: { label: '스캔 중', icon: Search, iconClass: 'text-muted-foreground' },
  comparing: { label: '비교 중', icon: Search, iconClass: 'text-muted-foreground' },
  downloading: { label: '다운로드 중', icon: ArrowDown, iconClass: 'text-info animate-pulse' },
  uploading: { label: '업로드 중', icon: ArrowUp, iconClass: 'text-success animate-pulse' },
}
```

**Step 4: SyncProgressPanel 컴포넌트 추가**

```typescript
function SyncProgressPanel({ collapsed }: { collapsed: boolean }) {
  const { fullSyncProgress } = useSyncStore()

  if (!fullSyncProgress) return null

  const { phase, progress, currentFile, speedBps, estimatedRemainingMs } = fullSyncProgress
  const percent = Math.round(progress)
  const phaseConf = PHASE_CONFIG[phase] ?? PHASE_CONFIG.scanning
  const PhaseIcon = phaseConf.icon

  const tooltipText = `전체동기화 ${percent}% · ${phaseConf.label}${estimatedRemainingMs > 0 ? ` · ${formatDuration(estimatedRemainingMs)} 남음` : ''}`

  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-3 border-t border-sidebar-border">
        <CircularProgress percent={percent} title={tooltipText} />
      </div>
    )
  }

  return (
    <div className="px-4 py-3 border-t border-sidebar-border space-y-1.5">
      <div className="flex items-center gap-1.5">
        <RefreshCw className="h-3.5 w-3.5 text-info animate-spin shrink-0" />
        <span className="text-xs text-info font-medium truncate">전체동기화 중..</span>
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <PhaseIcon className={cn('h-3 w-3 shrink-0', phaseConf.iconClass)} />
            <span className="text-[11px] text-muted-foreground">{phaseConf.label}</span>
          </div>
          <span className="text-[11px] font-medium text-sidebar-foreground">{percent}%</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-info rounded-full transition-all duration-300"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      </div>
      {currentFile && (
        <p className="text-[11px] text-muted-foreground truncate" title={currentFile}>
          {currentFile}
        </p>
      )}
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {speedBps > 0 && <span>{formatBytes(speedBps)}/s</span>}
        {speedBps > 0 && estimatedRemainingMs > 0 && <span>·</span>}
        {estimatedRemainingMs > 0 && <span>{formatDuration(estimatedRemainingMs)}</span>}
      </div>
    </div>
  )
}
```

**Step 5: Sidebar 컴포넌트에 SyncProgressPanel 삽입**

`Sidebar()` 함수 내에서 `{/* Connection Status */}` 주석 바로 위에 삽입:

```typescript
      {/* Sync Progress */}
      <SyncProgressPanel collapsed={sidebarCollapsed} />

      {/* Connection Status */}
```

**Step 6: typecheck 실행**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 7: Commit**

```bash
git add src/renderer/components/Sidebar.tsx
git commit -m "feat: add sync progress panel to sidebar"
```

---

## Task 4: ui-design-reference.md 스타일 패턴 추가

**Files:**
- Modify: `docs/ui-design-reference.md`

**Step 1: 재사용 UI 패턴 섹션에 원형 프로그레스 패턴 추가**

`### 진행 바` 섹션 아래에 추가:

```markdown
### 원형 프로그레스 (Circular Progress)

```html
<svg width="20" height="20">
  <!-- track -->
  <circle cx="10" cy="10" r="8.75" fill="none"
          stroke="var(--color-muted)" stroke-width="2.5" />
  <!-- fill -->
  <circle cx="10" cy="10" r="8.75" fill="none"
          stroke="var(--color-info)" stroke-width="2.5"
          stroke-linecap="round"
          stroke-dasharray="{circumference}"
          stroke-dashoffset="{offset}"
          transform="rotate(-90 10 10)"
          class="transition-all duration-300" />
</svg>
```

용도: 사이드바 접힘 모드에서 동기화 진행률 표시
크기: `h-5 w-5` (20x20px), stroke-width: 2.5
트랙: `var(--color-muted)`, 진행: `var(--color-info)`
```

**Step 2: 사이드바 섹션에 동기화 진행 패널 패턴 추가**

`### Sidebar` 섹션의 **연결 상태 점** 아래에 추가:

```markdown
**동기화 진행 패널** (동기화 중일 때만 표시):
- 위치: 설정 nav와 연결 상태 사이
- 펼침: `px-4 py-3 border-t border-sidebar-border space-y-1.5`
  - 타이틀: `RefreshCw h-3.5 w-3.5 text-info animate-spin` + `text-xs text-info font-medium`
  - phase 아이콘: `h-3 w-3` + phase별 색상 (scanning: `text-muted-foreground`, downloading: `text-info animate-pulse`, uploading: `text-success animate-pulse`)
  - 프로그레스 바: 기존 진행 바 패턴과 동일
  - 파일명/속도/시간: `text-[11px] text-muted-foreground`
- 접힘: `CircularProgress` SVG (20x20) + title 툴팁
```

**Step 3: 유틸리티 함수 섹션 업데이트**

`## 유틸리티 함수` 섹션에 추가:

```markdown
// 시간 포맷 (밀리초 → 한글)
formatDuration(ms) => "" / "~N초" / "~N분" / "~N시간 M분"
```

**Step 4: Commit**

```bash
git add docs/ui-design-reference.md
git commit -m "docs: add circular progress and sync progress panel patterns to ui-design-reference"
```

---

## 요약

| Task | 설명 | 예상 변경 |
|------|------|----------|
| 1 | sync-store fullSyncProgress 타입 확장 | ~10줄 수정 |
| 2 | formatDuration 유틸 + 테스트 | ~25줄 추가 |
| 3 | SyncProgressPanel 컴포넌트 | ~100줄 추가 |
| 4 | ui-design-reference 문서 업데이트 | ~30줄 추가 |

총 4개 커밋, 신규 파일 1개(테스트), 기존 파일 3개 수정, 문서 1개 수정.
