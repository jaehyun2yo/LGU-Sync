# UI Design Reference - 외부웹하드동기화프로그램2

> 다른 프로젝트 리팩토링 시 참고용 디자인 레퍼런스 문서

---

## 기술 스택

| 항목 | 버전 | 역할 |
|---|---|---|
| React | 19 | UI 라이브러리 |
| TypeScript | 5.9 | 타입 시스템 |
| Tailwind CSS | v4 | 유틸리티 CSS (`@theme` 블록으로 토큰 정의) |
| Zustand | 5 | 클라이언트 상태 관리 |
| lucide-react | 0.575 | 아이콘 |
| recharts | 3.7 | 차트 |
| clsx + tailwind-merge | - | 조건부 클래스 조합 |

**핵심**: `tailwind.config.ts` 없이 `index.css` 내 `@theme` 블록에서 CSS 커스텀 프로퍼티로 디자인 토큰 정의 (Tailwind v4 방식)

---

## 디자인 토큰

### 라이트 모드 (기본)

```css
@theme {
  /* 배경 */
  --color-background: #ffffff;
  --color-card:       #ffffff;
  --color-popover:    #ffffff;
  --color-sidebar:    #f5f5f5;

  /* 텍스트 */
  --color-foreground:          #171717;
  --color-card-foreground:     #171717;
  --color-popover-foreground:  #171717;
  --color-sidebar-foreground:  #171717;

  /* 인터랙티브 */
  --color-primary:             #171717;
  --color-primary-foreground:  #fafafa;
  --color-secondary:           #f5f5f5;
  --color-secondary-foreground:#171717;
  --color-muted:               #f5f5f5;
  --color-muted-foreground:    #737373;
  --color-accent:              #f5f5f5;
  --color-accent-foreground:   #171717;

  /* 피드백 */
  --color-destructive:            #ef4444;
  --color-destructive-foreground: #fafafa;
  --color-success:                #22c55e;
  --color-warning:                #eab308;
  --color-error:                  #ef4444;
  --color-info:                   #3b82f6;

  /* 경계/입력 */
  --color-border:        #e5e5e5;
  --color-input:         #e5e5e5;
  --color-ring:          #171717;
  --color-sidebar-border:#e5e5e5;

  /* 반경 */
  --radius-sm: 0.25rem;   /* 4px */
  --radius-md: 0.375rem;  /* 6px */
  --radius-lg: 0.5rem;    /* 8px */

  /* 폰트 */
  --font-sans: "Pretendard", "Inter", system-ui, sans-serif;
}
```

### 다크 모드 (`.dark` 클래스 기반)

```css
.dark {
  --color-background: #0a0a0a;
  --color-card:       #1c1c1c;
  --color-popover:    #171717;
  --color-sidebar:    #171717;

  --color-foreground:         #fafafa;
  --color-card-foreground:    #fafafa;
  --color-popover-foreground: #fafafa;
  --color-sidebar-foreground: #fafafa;

  --color-primary:            #fafafa;
  --color-primary-foreground: #171717;
  --color-secondary:          #262626;
  --color-muted:              #262626;
  --color-muted-foreground:   #a3a3a3;
  --color-accent:             #262626;
  --color-accent-foreground:  #fafafa;

  --color-border:        #2e2e2e;
  --color-input:         #2e2e2e;
  --color-ring:          #fafafa;
  --color-sidebar-border:#2e2e2e;
}
```

**테마 전환**: `document.documentElement.classList.toggle('dark')` + localStorage. 기본값 `'dark'`

### 스크롤바

```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--color-muted-foreground); border-radius: 3px; }
```

---

## 전역 스타일

```css
body { overflow: hidden; }  /* Electron 앱 전체 스크롤 방지 */
* { border-color: var(--color-border); }
```

---

## 레이아웃 구조

```
div.flex.h-screen.w-screen.overflow-hidden
├── <Sidebar />                          (좌측, w-[220px] / w-16)
└── div.flex.flex-col.flex-1.min-w-0
    ├── <Header />                       (상단, h-14)
    ├── main.flex-1.overflow-auto.p-6    (콘텐츠)
    └── (오버레이)
        ├── <NotificationCenter />       (fixed)
        └── <ConfirmDialog />            (fixed)
```

---

## 컴포넌트 패턴

### Sidebar

```
aside.flex.flex-col.h-full.bg-sidebar.border-r
  너비: 확장 w-[220px] / 접힘 w-16
  트랜지션: transition-all duration-200
```

**활성 네비 아이템**:
```
bg-accent text-accent-foreground font-medium
+ 좌측 인디케이터: absolute left-0 w-[3px] h-5 bg-info rounded-r
```

**비활성 네비 아이템**:
```
text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground
```

**에러 배지**: `bg-error text-white text-[10px] font-bold rounded-full`

**연결 상태 점**: `h-2 w-2 rounded-full` + `bg-success` / `bg-error`

**동기화 진행 패널** (동기화 중일 때만 표시):
- 위치: 설정 nav와 연결 상태 사이
- 펼침: `px-4 py-3 border-t border-sidebar-border space-y-1.5`
  - 타이틀: `RefreshCw h-3.5 w-3.5 text-info animate-spin` + `text-xs text-info font-medium`
  - phase 아이콘: `h-3 w-3` + phase별 색상 (scanning: `text-muted-foreground`, downloading: `text-info animate-pulse`, uploading: `text-success animate-pulse`)
  - 프로그레스 바: 기존 진행 바 패턴과 동일
  - 파일명/속도/시간: `text-[11px] text-muted-foreground`
- 접힘: `CircularProgress` SVG (20x20) + title 툴팁

### Header

```
header.flex.items-center.h-14.px-6.border-b.bg-background.shrink-0
  좌: h1 text-lg font-semibold
  우: 알림 버튼 + 테마 토글
```

**알림 배지**: `absolute -top-0.5 -right-0.5 bg-error text-white text-[10px] font-bold rounded-full h-4 min-w-[16px]`

**헤더 버튼**: `p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors`

### ConfirmDialog (모달)

```
백드롭: fixed inset-0 bg-black/50 z-50
다이얼로그: bg-popover border border-border rounded-lg shadow-xl max-w-[400px] p-6
취소 버튼: border border-border hover:bg-accent
확인 버튼: bg-primary text-primary-foreground hover:opacity-90
```

### NotificationCenter

```
위치: fixed top-14 right-4 z-50 w-[380px] max-h-[500px]
```

**아이콘-색상 매핑**:
| 레벨 | 아이콘 | 색상 |
|---|---|---|
| info | Info | text-info |
| success | CheckCircle | text-success |
| warning | AlertTriangle | text-warning |
| error | AlertCircle | text-error |

**읽지않음**: `bg-accent/20` + `bg-info` 파란 점

---

## 페이지별 레이아웃

### Dashboard

```
space-y-4 p-1
├── SyncStatusCard (상태 + 액션 버튼)
├── QuickStats (grid-cols-4 gap-3, 통계 카드 4개)
└── grid grid-cols-2 gap-4
    ├── ActiveTransfers
    └── RecentFilesList
```

**동기화 상태 색상**:
| 상태 | 텍스트 | 배경 |
|---|---|---|
| idle | text-muted-foreground | bg-muted-foreground |
| syncing | text-success | bg-success |
| paused | text-warning | bg-warning |
| error | text-error | bg-error |
| disconnected | text-error | bg-error |

**통계 카드 색상**:
| 항목 | 아이콘 배경 | 텍스트 |
|---|---|---|
| 전체 파일 | bg-info/10 | text-info |
| 성공 | bg-success/10 | text-success |
| 실패 | bg-error/10 | text-error |
| 전송량 | bg-info/10 | text-info |

**파일 상태 아이콘**:
| 상태 | 아이콘 | 색상 | 애니메이션 |
|---|---|---|---|
| completed | CheckCircle | text-success | - |
| downloading | ArrowDown | text-info | animate-pulse |
| uploading | ArrowUp | text-info | animate-pulse |
| failed/dlq | XCircle | text-error | - |
| detected | Clock | text-muted-foreground | - |
| skipped | FileText | text-muted-foreground | - |

### File Explorer

```
flex flex-col h-full
├── 검색바 (Search 아이콘 + input)
├── 2열 분할
│   ├── FolderTree (w-60 border-r)
│   └── FileTable + Pagination (flex-1)
└── FileDetailPanel (선택 시)
```

**폴더 트리 들여쓰기**: `paddingLeft: depth * 16 + 8px`

**파일 상태 배지 색상**:
| 상태 | 스타일 |
|---|---|
| completed | `bg-success/10 text-success` |
| detected | `bg-warning/10 text-warning` |
| downloading/uploading | `bg-info/10 text-info` |
| failed/dlq | `bg-error/10 text-error` |
| skipped | `bg-muted text-muted-foreground` |

### Folder Settings

```
flex flex-col h-full gap-4
├── FolderRow 리스트 (체크박스 + 폴더명 + 미니 진행바)
└── 요약 바 (하단)
```

**커스텀 체크박스**:
```
활성: bg-primary border-primary + Check 아이콘 text-primary-foreground
비활성: border-border hover:border-muted-foreground
```

### Log Viewer

```
flex flex-col gap-3 p-1 h-full
├── FilterBar (레벨 필터 + 날짜 + 검색 + 내보내기)
├── 로그 테이블 (sticky 헤더 bg-muted/80 backdrop-blur-sm)
├── SummaryBar
└── Pagination
```

**레벨 필터 활성 색상**:
| 레벨 | 스타일 |
|---|---|
| debug | `bg-muted text-muted-foreground` |
| info | `bg-info/10 text-info` |
| warn | `bg-warning/10 text-warning` |
| error | `bg-error/10 text-error` |

**로그 행**: 오류 행 `bg-error/5`, 확장 `bg-accent/20`, hover `hover:bg-accent/30`

### Statistics

```
space-y-4 p-1
├── 기간 탭 (Segmented Control)
├── SummaryCards (grid-cols-3)
└── grid grid-cols-2 gap-4
    ├── DailyChart (Recharts BarChart)
    └── FolderBreakdown
```

**Segmented Control**:
```
flex items-center gap-1 bg-muted rounded-lg p-1 w-fit
  활성: bg-background text-foreground shadow-sm
  비활성: text-muted-foreground hover:text-foreground
```

**차트 색상**:
- 성공 바: `hsl(210, 80%, 55%)` (파란색)
- 실패 바: `hsl(0, 70%, 55%)` (붉은색)

### Settings

```
flex flex-col gap-4 p-1 h-full
├── 탭 네비게이션 (5개 탭)
└── 탭 콘텐츠
```

**탭**: 계정 / 동기화 / 알림 / 시스템 / 정보

**탭 활성 인디케이터**: `absolute bottom-0 left-0 right-0 h-0.5 bg-info`

---

## 재사용 UI 패턴

### 카드

```
bg-card border border-border rounded-lg p-4
```

### 버튼

| 종류 | 클래스 |
|---|---|
| 공통 | `px-3 py-1.5 text-sm font-medium rounded-md transition-colors` |
| Ghost/Accent | `bg-accent text-accent-foreground hover:bg-accent/80` |
| Primary/Info | `bg-info text-white hover:bg-info/90` |
| Danger | `bg-error/10 text-error hover:bg-error/20` |
| Success | `bg-success/10 text-success hover:bg-success/20` |
| Warning | `bg-warning/10 text-warning hover:bg-warning/20` |
| Outline | `border border-border hover:bg-accent hover:text-accent-foreground` |
| Primary(dark) | `bg-primary text-primary-foreground hover:opacity-90` |
| Disabled | `disabled:opacity-50 disabled:cursor-not-allowed` |

### 진행 바

```html
<div class="h-1.5 bg-muted rounded-full overflow-hidden">
  <div class="h-full rounded-full transition-all duration-300 bg-info"
       style="width: {percent}%">
  </div>
</div>
```

색상: `bg-info`(다운로드) / `bg-success`(업로드/완료) / `bg-warning`(진행중)

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

### 입력 필드

```
px-3 py-1.5 text-sm bg-background border border-border rounded-md
text-card-foreground placeholder:text-muted-foreground
focus:outline-none focus:ring-1 focus:ring-info
```

### 토글 스위치

```html
<button class="h-5 w-9 rounded-full transition-colors {활성 ? 'bg-info' : 'bg-muted'}">
  <div class="h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform
              {활성 ? 'translate-x-[18px]' : 'translate-x-[3px]'}" />
</button>
```

### 상태 배지

```
text-xs px-2 py-0.5 rounded-full bg-{color}/10 text-{color}
```

### 빈 상태

```html
<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
  <Icon class="h-8 w-8 mb-2 opacity-30" />
  <span class="text-sm">메시지</span>
</div>
```

### 로딩 스피너

```html
<!-- 큰 스피너 -->
<Loader class="h-5 w-5 animate-spin text-muted-foreground" />

<!-- 작은 원형 스피너 -->
<div class="h-3 w-3 border-2 border-info border-t-transparent rounded-full animate-spin" />
```

### 구분선

```html
<!-- 수직 -->
<div class="h-4 w-px bg-border" />

<!-- 수평 -->
<div class="border-t border-border" />
```

### 섹션 헤더

```
text-sm font-semibold text-card-foreground border-b border-border pb-2
```

### 모달/오버레이

```html
<!-- 백드롭 -->
<div class="fixed inset-0 bg-black/50 z-50" />

<!-- 컨테이너 -->
<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
  <div class="bg-popover border border-border rounded-lg shadow-xl max-w-[400px] p-6">
    ...
  </div>
</div>
```

### 데이터 라벨-값 쌍

```html
<span class="text-muted-foreground">라벨:</span>
<span class="font-medium">값</span>
```

---

## 아이콘 사용 규칙

**라이브러리**: `lucide-react`

**크기 패턴**:
| 용도 | 크기 |
|---|---|
| 네비/헤더 | `h-4 w-4` ~ `h-5 w-5` |
| 상태 표시기 | `h-4 w-4` |
| 배지 내부 | `h-3 w-3` ~ `h-3.5 w-3.5` |
| 빈 상태 | `h-8 w-8` ~ `h-10 w-10 opacity-40` |

**자주 쓰는 아이콘**:
| 아이콘 | 용도 |
|---|---|
| LayoutDashboard | 대시보드 |
| FolderOpen / Folder | 파일/폴더 |
| FolderSync | 동기화 |
| ScrollText | 로그 |
| BarChart3 | 통계 |
| Settings | 설정 |
| Bell | 알림 |
| Moon / Sun | 테마 전환 |
| RefreshCw | 새로고침 (로딩 시 animate-spin) |
| CheckCircle / XCircle | 성공/실패 |
| ArrowDown / ArrowUp | 다운로드/업로드 (animate-pulse) |
| Search | 검색 |
| Loader | 로딩 (animate-spin) |
| Eye / EyeOff | 비밀번호 표시/숨김 |
| ChevronLeft / Right / Down | 접기/펼치기/드롭다운 |
| Info / AlertTriangle / AlertCircle / Bug | 로그 레벨 |

---

## 애니메이션 / 트랜지션

| 패턴 | 용도 |
|---|---|
| `transition-colors` | 모든 버튼, hover 효과 |
| `transition-all duration-200` | 사이드바 너비 변화 |
| `transition-all duration-300` | 진행 바 |
| `transition-all duration-500` | 폴더별 현황 바 |
| `animate-spin` | 로딩 아이콘 (Loader, RefreshCw) |
| `animate-pulse` | 전송 중 화살표 (ArrowDown/Up) |
| `backdrop-blur-sm` | sticky 헤더 |

---

## 고정 치수

| 요소 | 크기 |
|---|---|
| 사이드바 (확장) | `w-[220px]` |
| 사이드바 (접힘) | `w-16` |
| 헤더 | `h-14` |
| 알림 패널 | `w-[380px] max-h-[500px]` |
| 확인 다이얼로그 | `max-w-[400px]` |
| 파일 트리 | `w-60` |
| 사이드바 활성 인디케이터 | `w-[3px] h-5` |
| 탭 활성 인디케이터 | `h-0.5` |

---

## 상태 관리 (Zustand)

### ui-store

```ts
{
  currentPage: PageId       // 현재 페이지
  sidebarCollapsed: boolean // 사이드바 접힘
  theme: 'dark' | 'light'  // 테마 (기본 'dark', localStorage 연동)
  confirmDialog: { open, title, message, onConfirm }
}
```

### sync-store

```ts
{
  status: 'idle' | 'syncing' | 'paused' | 'error' | 'disconnected'
  lguplusConnected: boolean
  webhardConnected: boolean
  todayTotal / todaySuccess / todayFailed / todayBytes: number
  activeTransfers: ActiveTransfer[]   // 최대 5개
  recentFiles: SyncFileInfo[]         // 최대 20개
  fullSyncProgress: { phase, progress, currentFile } | null
}
```

### notification-store

```ts
{
  notifications: NotificationItem[]
  isOpen: boolean
}
```

### log-store

```ts
{
  logs: LogEntry[]
  filters: { levels, search, dateFrom, dateTo }
  page / pageSize / total / totalPages
  isRealtime: boolean
}
```

### settings-store

```ts
{
  settings: AppSettings | null   // lguplus, webhard, sync, notification, system
  isDirty / isLoading / isSaving: boolean
  activeTab: string
}
```

---

## 유틸리티 함수 (lib/utils.ts)

```ts
// 클래스 조합 (모든 컴포넌트에서 필수)
cn(...inputs: ClassValue[]) => twMerge(clsx(inputs))

// 파일 크기 포맷
formatBytes(bytes) => "0 B" / "1.2 KB" / "3.4 MB" / "1.2 GB"

// 상대 시간
formatRelativeTime(dateStr) => "방금" / "N분 전" / "N시간 전" / "N일 전" / 날짜

// 시간 포맷
formatTime(dateStr) => 오늘이면 "HH:MM:SS", 아니면 "MM/DD HH:MM"

// 시간 포맷 (밀리초 → 한글)
formatDuration(ms) => "" / "~N초" / "~N분" / "~N시간 M분"
```

---

## IPC 통신 패턴

```ts
// invoke (요청-응답)
window.electronAPI.invoke(channel, ...args)

// 이벤트 구독 (useIpcEvent 훅)
window.electronAPI.on(channel, handler) => unsubscribe
```

**구독 중인 이벤트**: `sync:progress`, `sync:file-completed`, `sync:file-failed`, `sync:status-changed`

**키보드 단축키**: `Ctrl+1~5` (페이지 이동), `Ctrl+,` (설정)
