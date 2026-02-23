# 외부웹하드동기화프로그램 v2 - GUI/UX 설계서

> **문서 버전**: 1.0
> **작성일**: 2026-02-23
> **상태**: 초안
> **기술 스택**: Electron + React 18, TypeScript, Tailwind CSS, shadcn/ui, Zustand, Recharts, Lucide Icons
> **선행 문서**: [10-SDD-개발방법론](./10-SDD-개발방법론.md)

---

## 목차

1. [UI 설계 원칙](#1-ui-설계-원칙)
2. [화면 구조](#2-화면-구조)
3. [화면별 설계](#3-화면별-설계)
4. [시스템 트레이](#4-시스템-트레이)
5. [컴포넌트 계층](#5-컴포넌트-계층)
6. [상태 관리 (Zustand)](#6-상태-관리-zustand)
7. [반응형/접근성](#7-반응형접근성)
8. [에러 UI](#8-에러-ui)

---

## 1. UI 설계 원칙

### 1.1 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **즉시 인지** | 동기화 상태를 색상과 아이콘으로 0.5초 내 파악 가능 |
| **무간섭 운영** | 정상 상태에서는 사용자 개입이 필요 없음. 문제 발생 시에만 주의 환기 |
| **최소 클릭** | 주요 액션은 2클릭 이내로 도달. 빠른 액션 버튼 제공 |
| **일관성** | shadcn/ui 컴포넌트 기반 통일된 디자인 언어 |
| **비개발자 친화** | 기술 용어 최소화, 상태를 자연어로 표현 (예: "정상 작동 중", "연결 끊김") |

### 1.2 컬러 팔레트

**다크 모드 (기본)**

| 용도 | 색상 | Tailwind |
|------|------|----------|
| 배경 (메인) | `#0a0a0a` | `bg-neutral-950` |
| 배경 (사이드바) | `#171717` | `bg-neutral-900` |
| 배경 (카드) | `#1c1c1c` | `bg-neutral-900/80` |
| 텍스트 (기본) | `#fafafa` | `text-neutral-50` |
| 텍스트 (보조) | `#a3a3a3` | `text-neutral-400` |
| 테두리 | `#2e2e2e` | `border-neutral-800` |
| 정상/성공 | `#22c55e` | `text-green-500` |
| 경고 | `#eab308` | `text-yellow-500` |
| 오류 | `#ef4444` | `text-red-500` |
| 정보/강조 | `#3b82f6` | `text-blue-500` |
| 일시중지 | `#737373` | `text-neutral-500` |

**라이트 모드**

| 용도 | 색상 | Tailwind |
|------|------|----------|
| 배경 (메인) | `#ffffff` | `bg-white` |
| 배경 (사이드바) | `#f5f5f5` | `bg-neutral-100` |
| 배경 (카드) | `#ffffff` | `bg-white` |
| 텍스트 (기본) | `#171717` | `text-neutral-900` |
| 텍스트 (보조) | `#737373` | `text-neutral-500` |
| 테두리 | `#e5e5e5` | `border-neutral-200` |

상태 색상(정상/경고/오류/정보)은 다크/라이트 동일.

### 1.3 간격 시스템

Tailwind 기본 4px 단위 사용. 주요 간격:

| 용도 | 값 | Tailwind |
|------|-----|----------|
| 컴포넌트 내부 패딩 | 16px | `p-4` |
| 카드 간 간격 | 16px | `gap-4` |
| 섹션 간 간격 | 24px | `gap-6` |
| 사이드바 메뉴 항목 간격 | 4px | `gap-1` |
| 인라인 아이콘-텍스트 간격 | 8px | `gap-2` |

### 1.4 타이포그래피

| 용도 | 크기 | 굵기 | Tailwind |
|------|------|------|----------|
| 페이지 제목 | 24px | Bold | `text-2xl font-bold` |
| 섹션 제목 | 18px | Semibold | `text-lg font-semibold` |
| 카드 제목 | 14px | Medium | `text-sm font-medium` |
| 본문 | 14px | Normal | `text-sm` |
| 보조 텍스트 | 12px | Normal | `text-xs` |

폰트: `"Pretendard", "Inter", system-ui, sans-serif`

---

## 2. 화면 구조

### 2.1 전체 레이아웃

```
+--sidebar--+------------------main------------------+
| [로고]     | [페이지 제목]         [알림벨] [테마]    |
|            |------------------------------------------|
| 대시보드   |                                          |
| 파일탐색기 |          페이지 콘텐츠 영역               |
| 폴더설정   |                                          |
| 동기화로그 |                                          |
| 통계       |                                          |
|            |                                          |
| -----      |                                          |
| 설정       |                                          |
|            |                                          |
| [상태표시] |                                          |
+------------+------------------------------------------+
```

### 2.2 사이드바 구성

- **너비**: 고정 220px (축소 시 64px, 아이콘만 표시)
- **구조**:
  - 상단: 로고 + 앱 이름 ("웹하드 동기화")
  - 중단: 네비게이션 메뉴 (6개 항목)
  - 하단 구분선 아래: 설정
  - 최하단: 연결 상태 표시기 (외부웹하드/자체웹하드 연결 점 2개)

**네비게이션 메뉴 항목**:

| 순서 | 메뉴 | 아이콘 (Lucide) | 단축키 |
|------|------|----------------|--------|
| 1 | 대시보드 | `LayoutDashboard` | `Ctrl+1` |
| 2 | 파일 탐색기 | `FolderOpen` | `Ctrl+2` |
| 3 | 폴더 설정 | `FolderSync` | `Ctrl+3` |
| 4 | 동기화 로그 | `ScrollText` | `Ctrl+4` |
| 5 | 통계 | `BarChart3` | `Ctrl+5` |
| --- | 구분선 | - | - |
| 6 | 설정 | `Settings` | `Ctrl+,` |

- 활성 메뉴: 좌측 3px 강조 바 + 배경 하이라이트
- 로그/동기화에 미확인 오류가 있으면 메뉴 옆에 빨간 배지 표시

### 2.3 헤더 바

- 좌측: 현재 페이지 제목
- 우측: 알림 벨 아이콘 (미읽음 배지), 다크/라이트 토글 버튼
- 높이: 56px

---

## 3. 화면별 설계

### 3.1 대시보드

#### 와이어프레임

```
+--------------------------------------------------+
| 대시보드                          [벨(3)] [테마]  |
|--------------------------------------------------|
| [정상 작동 중]  연속 가동: 2일 4시간               |
|--------------------------------------------------|
| [오늘요약]  [성공파일]  [실패파일]  [전송용량]     |
|  127건       125건       2건       1.8 GB         |
|--------------------------------------------------|
| 진행 중인 작업 (3)                                |
| > sample.dxf       다운로드 67%  ████████░░░      |
| > design.ai        업로드   45%  ██████░░░░░      |
| > plan.pdf         대기중                         |
|--------------------------------------------------|
| 최근 동기화 파일                     [전체보기 >] |
| V 10:32  원컴퍼니/도면A.dxf          2.1 MB       |
| V 10:30  대성목형/설계도.dwg         4.5 MB       |
| X 10:28  한빛포장/시안.ai            실패-재시도  |
| V 10:25  원컴퍼니/견적서.pdf         0.3 MB       |
+--------------------------------------------------+
```

#### 데이터 항목

**상태 카드 (최상단)**:
- 동기화 상태: 정상(`green`), 경고(`yellow`), 오류(`red`), 일시중지(`gray`)
- 상태 텍스트: "정상 작동 중" / "일부 오류 발생" / "동기화 중단됨" / "일시중지"
- 연속 가동 시간
- 빠른 액션: [일시중지/재개] [전체 동기화]

**오늘 요약 카드 (4개 그리드)**:
- 총 동기화 건수 (전일 대비 증감 화살표)
- 성공 건수
- 실패 건수 (0이면 초록, 1 이상이면 빨강)
- 총 전송 용량

**진행 중인 작업**:
- 현재 다운로드/업로드 중인 파일 목록 (최대 5건)
- 각 항목: 파일명, 작업 유형(다운로드/업로드), 진행률 바, 퍼센트
- 작업 없으면 "진행 중인 작업이 없습니다" 표시

**최근 동기화 파일**:
- 최근 20건 표시 (시간 역순)
- 각 항목: 상태 아이콘(V/X), 시간, 폴더/파일명, 크기 또는 실패 사유
- 실패 항목은 빨간 텍스트 + "재시도" 링크

#### 주요 인터랙션

| 액션 | 동작 |
|------|------|
| 상태 카드 [일시중지] 클릭 | 폴링 중지, 상태를 "일시중지"로 변경 |
| 상태 카드 [전체 동기화] 클릭 | 확인 다이얼로그 → 전체 동기화 시작, 진행률 모달 표시 |
| 실패 항목 "재시도" 클릭 | 해당 파일만 즉시 동기화 큐에 추가 |
| 최근 파일 항목 클릭 | 파일 탐색기의 해당 파일 위치로 이동 |
| [전체보기] 클릭 | 동기화 로그 페이지로 이동 |

#### 로딩/에러 상태

- **초기 로딩**: 카드 영역에 스켈레톤 UI (shimmer 효과)
- **데이터 없음**: "아직 동기화 이력이 없습니다. 폴더 설정 후 동기화를 시작하세요." + [폴더 설정으로 이동] 버튼
- **IPC 통신 실패**: "상태 정보를 불러올 수 없습니다" + [새로고침] 버튼

**컴포넌트 Props 스펙 (SDD Level 2):**

```typescript
interface DashboardPageProps {
  // 데이터는 Zustand store에서 주입
}

interface SyncStatusCardProps {
  status: SyncEngineStatus;
  lastSyncTime: string | null;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
}

interface RecentActivityListProps {
  events: SyncEvent[];
  maxItems?: number;
}

interface QuickStatsProps {
  totalFiles: number;
  totalBytes: number;
  successRate: number;
  period: 'today' | 'week' | 'month';
}
```

---

### 3.2 파일 탐색기

#### 와이어프레임

```
+--------------------------------------------------+
| 파일 탐색기                       [벨(3)] [테마]  |
|--------------------------------------------------|
| [검색: 파일명 검색...]            [새로고침]      |
|--------------------------------------------------|
| 폴더 트리     | 파일 목록                         |
| ----------    | 이름▼      크기    수정일   상태   |
| v 올리기전용  | sample.dxf 2.1MB  02-23   V 완료 |
|   v 원컴퍼니  | design.ai  4.5MB  02-23   V 완료 |
|     서브폴더A | plan.pdf   0.3MB  02-22   X 실패 |
|   > 대성목형  |                                    |
|   > 한빛포장  |------------------------------------|
|               | 선택: plan.pdf                     |
|               | 크기: 310KB  수정일: 2026-02-22    |
|               | 상태: 실패 - 다운로드 타임아웃     |
|               | [지금 동기화] [로그 보기]          |
+--------------------------------------------------+
```

#### 데이터 항목

**좌측 폴더 트리 (너비 240px, 리사이즈 가능)**:
- 루트: `올리기전용/`
- 각 폴더: 접기/펼치기 토글, 폴더명, 파일 수 배지
- 동기화 비활성 폴더: 흐리게(opacity 50%) 표시
- 현재 선택 폴더: 배경 하이라이트

**우측 파일 목록 (테이블)**:

| 컬럼 | 설명 | 정렬 |
|------|------|------|
| 상태 아이콘 | 완료(V), 대기(시계), 진행중(스피너), 실패(X) | 가능 |
| 파일명 | 파일 이름 + 확장자 아이콘 | 가능 |
| 크기 | 사람이 읽기 쉬운 단위 (KB/MB/GB) | 가능 |
| 수정일 | 외부웹하드 기준 수정 시간 | 가능 |
| 동기화 시간 | 동기화 완료 시간 (미완료면 "-") | 가능 |

**하단 상세 패널 (파일 선택 시)**:
- 파일 메타 정보: 이름, 경로, 크기, 수정일
- 동기화 상태: 상태, 동기화 시간, 실패 사유(있을 경우)
- 액션 버튼: [지금 동기화], [로그 보기]

#### 주요 인터랙션

| 액션 | 동작 |
|------|------|
| 폴더 트리 폴더 클릭 | 우측에 해당 폴더의 파일 목록 표시 |
| 컬럼 헤더 클릭 | 해당 컬럼 기준 오름차순/내림차순 정렬 토글 |
| 파일 행 클릭 | 하단 상세 패널에 파일 정보 표시 |
| 파일 행 더블클릭 | 해당 파일의 동기화 로그로 이동 |
| [지금 동기화] 클릭 | 선택 파일을 동기화 큐에 추가, 상태 아이콘 → 대기 |
| 검색 입력 | 현재 폴더(하위 포함) 내 파일명 실시간 필터링 (300ms 디바운스) |
| [새로고침] 클릭 | 외부웹하드에서 폴더/파일 목록 재조회 |

#### 로딩/에러 상태

- **폴더 트리 로딩**: 트리 영역에 스켈레톤
- **파일 목록 로딩**: 테이블 행 스켈레톤 (5행)
- **빈 폴더**: "이 폴더에 파일이 없습니다" 빈 상태 일러스트
- **조회 실패**: "폴더를 불러올 수 없습니다" + [재시도] 버튼
- **1000개 이상 파일**: 가상 스크롤 적용 (react-virtual)

**컴포넌트 Props 스펙 (SDD Level 2):**

```typescript
interface FileExplorerPageProps {
  // 데이터는 Zustand store에서 주입
}

interface FolderTreeProps {
  folders: SyncFolder[];
  selectedFolderId: string | null;
  onSelect: (folderId: string) => void;
}

interface FileListProps {
  files: SyncFile[];
  sortBy: 'name' | 'date' | 'size' | 'status';
  sortOrder: 'asc' | 'desc';
  onSort: (field: string) => void;
  onRetry: (fileId: string) => void;
}

interface FileStatusBadgeProps {
  status: FileSyncStatus;
}
```

---

### 3.3 폴더 설정

#### 와이어프레임

```
+--------------------------------------------------+
| 폴더 설정                         [벨(3)] [테마]  |
|--------------------------------------------------|
| 동기화할 폴더를 선택하세요        [새로고침]      |
|--------------------------------------------------|
| [V] 올리기전용           전체  마지막동기화       |
|   [V] 원컴퍼니          45건  10분 전             |
|   [V] 대성목형          23건  30분 전             |
|   [ ] 한빛포장 (비활성)  0건  -                   |
|   [V] 삼성패키지        12건  1시간 전            |
|--------------------------------------------------|
| 선택: 3/4 폴더  |  전체 파일: 80건  |  1.2 GB    |
+--------------------------------------------------+
```

#### 데이터 항목

**폴더 목록 (체크박스 리스트)**:

각 항목에 표시되는 정보:

| 항목 | 설명 |
|------|------|
| 체크박스 | 동기화 활성/비활성 토글 |
| 폴더명 | `올리기전용/` 하위 폴더명 |
| 파일 수 | 해당 폴더 내 총 파일 수 |
| 마지막 동기화 | 상대 시간 ("방금", "10분 전", "1시간 전") |
| 동기화 상태 바 | 성공/실패 비율 미니 프로그레스 바 (초록/빨강) |

**하단 요약 바**:
- 선택된 폴더 수 / 전체 폴더 수
- 선택된 폴더의 총 파일 수
- 선택된 폴더의 총 용량

#### 주요 인터랙션

| 액션 | 동작 |
|------|------|
| 상위 폴더 체크 | 하위 폴더 전체 자동 체크 |
| 상위 폴더 체크 해제 | 하위 폴더 전체 자동 해제 |
| 개별 폴더 체크 변경 | 즉시 SQLite에 저장, 다음 폴링부터 반영 |
| [새로고침] 클릭 | 외부웹하드에서 폴더 목록 재조회. 신규 폴더는 "NEW" 배지 표시 |
| 폴더 행 호버 | 해당 폴더의 최근 동기화 통계 툴팁 표시 |

#### 로딩/에러 상태

- **목록 로딩**: 체크박스 리스트 스켈레톤
- **빈 목록**: "외부웹하드에 폴더가 없습니다" 메시지
- **조회 실패**: 마지막 캐시된 목록 표시 + 상단에 경고 배너 "최신 목록을 불러올 수 없습니다"

**컴포넌트 Props 스펙 (SDD Level 2):**

```typescript
interface FolderSettingsPageProps {
  // 데이터는 Zustand store에서 주입
}

interface FolderListItemProps {
  folder: SyncFolder;
  onToggle: (folderId: string, enabled: boolean) => void;
}
```

---

### 3.4 동기화 로그

#### 와이어프레임

```
+--------------------------------------------------+
| 동기화 로그                       [벨(3)] [테마]  |
|--------------------------------------------------|
| [레벨: 전체 v] [유형: 전체 v] [날짜: 오늘 v]     |
| [검색: 파일명 또는 메시지...]      [내보내기]     |
|--------------------------------------------------|
| 10:32:15 INFO  다운로드완료 원컴퍼니/도면A.dxf    |
| 10:32:16 INFO  업로드시작  원컴퍼니/도면A.dxf     |
| 10:32:18 INFO  업로드완료  원컴퍼니/도면A.dxf     |
| 10:30:05 WARN  재시도(2/3) 한빛포장/시안.ai      |
| 10:28:01 ERROR 다운로드실패 한빛포장/시안.ai      |
|          > 타임아웃 (30초 초과)         [재시도]  |
|--------------------------------------------------|
| 총 1,247건 | INFO: 1,200 | WARN: 35 | ERR: 12    |
+--------------------------------------------------+
```

#### 데이터 항목

**필터 바**:

| 필터 | 옵션 |
|------|------|
| 레벨 | 전체, DEBUG, INFO, WARN, ERROR |
| 유형 | 전체, 다운로드, 업로드, 세션, 시스템 |
| 날짜 | 오늘, 최근 7일, 최근 30일, 사용자 지정 (DatePicker) |
| 검색 | 파일명, 메시지 텍스트 검색 (디바운스 300ms) |

**로그 항목**:

| 필드 | 설명 |
|------|------|
| 시간 | `HH:mm:ss` 형식 (오늘 아닌 경우 `MM-DD HH:mm:ss`) |
| 레벨 | 컬러 배지: DEBUG(회색), INFO(파랑), WARN(노랑), ERROR(빨강) |
| 이벤트 유형 | 다운로드시작/완료/실패, 업로드시작/완료/실패, 세션갱신, 재시도 등 |
| 대상 | 폴더/파일명 |
| 확장 상세 | 클릭 시 펼침: 오류 메시지, 스택 트레이스, 컨텍스트 정보 |

**하단 요약 바**:
- 현재 필터 기준 총 건수
- 레벨별 건수 요약

#### 주요 인터랙션

| 액션 | 동작 |
|------|------|
| 실시간 모드 (기본) | 새 로그가 하단에 자동 추가, 자동 스크롤 |
| 위로 스크롤 | 자동 스크롤 일시 정지, "최신으로 이동" 플로팅 버튼 표시 |
| 로그 행 클릭 | 상세 정보 확장/축소 토글 |
| ERROR 항목 [재시도] 클릭 | 해당 파일 동기화 재시도 |
| [내보내기] 클릭 | 현재 필터 기준 로그를 `.txt` 파일로 저장 (파일 저장 다이얼로그) |
| 필터 변경 | 즉시 로그 목록 갱신 (서버사이드 필터링 via IPC) |

#### 로딩/에러 상태

- **초기 로딩**: 로그 영역 스켈레톤 (8행)
- **빈 로그**: "아직 동기화 로그가 없습니다"
- **필터 결과 없음**: "조건에 맞는 로그가 없습니다. 필터를 변경해 보세요."
- **대량 로그 성능**: 가상 스크롤 적용, 한 번에 100건씩 로드 (무한 스크롤)

**컴포넌트 Props 스펙 (SDD Level 2):**

```typescript
interface LogViewerPageProps {
  // 데이터는 Zustand store에서 주입
}

interface LogFilterBarProps {
  level: LogLevel;
  dateRange: { from: Date; to: Date };
  search: string;
  onFilterChange: (filters: LogFilters) => void;
}

interface LogEntryRowProps {
  entry: LogEntry;
  expanded: boolean;
  onToggle: () => void;
}
```

---

### 3.5 통계

#### 와이어프레임

```
+--------------------------------------------------+
| 통계                              [벨(3)] [테마]  |
|--------------------------------------------------|
| [오늘] [7일] [30일] [전체]                        |
|--------------------------------------------------|
| 요약 카드                                         |
| [총건수: 3,456] [성공률: 98.7%] [총용량: 45.2GB] |
|--------------------------------------------------|
| 일별 동기화 건수            | 성공/실패 비율      |
| ▌                          |    /---------\      |
| ▌▌  ▌                      |   /   98.7%   \     |
| ▌▌▌ ▌▌ ▌                   |  | 성공  실패  |    |
| ▌▌▌▌▌▌▌▌▌▌                 |   \   1.3%   /     |
| 02/16  ...  02/23          |    \---------/      |
|--------------------------------------------------|
| 폴더별 동기화 현황                                |
| 원컴퍼니    ████████████░░  82건  45%             |
| 대성목형    ██████░░░░░░░░  38건  21%             |
| 한빛포장    ████░░░░░░░░░░  25건  14%             |
| 기타        ████░░░░░░░░░░  37건  20%             |
+--------------------------------------------------+
```

#### 데이터 항목

**기간 선택 탭**: 오늘, 7일, 30일, 전체

**요약 카드 (3개)**:

| 카드 | 데이터 | 부가 정보 |
|------|--------|-----------|
| 총 동기화 건수 | 선택 기간 내 총 건수 | 전일/전주 대비 증감률 |
| 성공률 | (성공 / 전체) * 100 | 컬러 표시: 95%+ 초록, 90%+ 노랑, 90% 미만 빨강 |
| 총 전송 용량 | 선택 기간 내 총 바이트 | 일평균 전송량 표시 |

**차트 영역 (Recharts)**:

| 차트 | 유형 | 데이터 |
|------|------|--------|
| 일별 동기화 건수 | 막대 차트 (BarChart) | X: 날짜, Y: 건수 (성공 파랑 + 실패 빨강 스택) |
| 성공/실패 비율 | 도넛 차트 (PieChart) | 성공(초록), 실패(빨강) 비율 |
| 일별 전송 용량 | 라인 차트 (LineChart) | X: 날짜, Y: 전송 용량(MB) |

**폴더별 현황 (수평 막대)**:
- 각 폴더별 동기화 건수, 전체 대비 비율
- 상위 5개 표시, 나머지는 "기타"로 합산

#### 주요 인터랙션

| 액션 | 동작 |
|------|------|
| 기간 탭 전환 | 모든 차트와 요약 카드 데이터 갱신 |
| 차트 영역 호버 | 툴팁에 해당 날짜의 상세 수치 표시 |
| 폴더별 항목 클릭 | 해당 폴더의 파일 탐색기로 이동 |
| 차트 막대/점 클릭 | 해당 날짜의 동기화 로그로 이동 |

#### 로딩/에러 상태

- **초기 로딩**: 차트 영역 스켈레톤
- **데이터 없음**: "선택한 기간에 동기화 데이터가 없습니다" + 빈 차트 플레이스홀더
- **차트 렌더링 오류**: 해당 차트 위치에 테이블 형태로 폴백 표시

**컴포넌트 Props 스펙 (SDD Level 2):**

```typescript
interface StatisticsPageProps {
  // 데이터는 Zustand store에서 주입
}

interface SyncChartProps {
  data: DailyStats[];
  period: 'week' | 'month' | 'year';
  onPeriodChange: (period: string) => void;
}

interface StatsSummaryCardProps {
  title: string;
  value: number;
  unit: string;
  trend?: { direction: 'up' | 'down'; percentage: number };
}
```

---

### 3.6 설정

#### 와이어프레임

```
+--------------------------------------------------+
| 설정                              [벨(3)] [테마]  |
|--------------------------------------------------|
| [계정] [동기화] [알림] [시스템] [저장소] [정보]   |
|--------------------------------------------------|
| -- 계정 탭 --                                     |
| LGU+ 웹하드                                      |
|   아이디:    [____________]                       |
|   비밀번호:  [••••••••••••]  [연결 테스트]        |
|   상태: V 연결됨 (세션 유효)                      |
|                                                   |
| 자체웹하드 API                                    |
|   URL:       [https://api.yjlaser...]             |
|   API Key:   [••••••••••••]  [연결 테스트]        |
|   상태: V 연결됨                                  |
|--------------------------------------------------|
|                                          [저장]   |
+--------------------------------------------------+
```

#### 설정 탭 구성

**계정 탭**:

| 항목 | 입력 유형 | 유효성 검사 |
|------|-----------|-------------|
| LGU+ 아이디 | 텍스트 | 필수, 비어있으면 인라인 오류 |
| LGU+ 비밀번호 | 비밀번호 (토글로 표시/숨김) | 필수 |
| 연결 테스트 버튼 | 버튼 → 결과 인라인 표시 | 성공: 초록 체크, 실패: 빨간 X + 사유 |
| 자체웹하드 URL | URL 입력 | 필수, URL 형식 검사 |
| 자체웹하드 API Key | 비밀번호 | 필수 |

**동기화 탭**:

| 항목 | 입력 유형 | 기본값 | 범위 |
|------|-----------|--------|------|
| 폴링 간격 | 숫자 + 슬라이더 | 5초 | 3~60초 |
| 최대 동시 다운로드 | 숫자 | 5 | 1~10 |
| 최대 동시 업로드 | 숫자 | 3 | 1~5 |
| 스냅샷 비교 간격 | 숫자 | 10분 | 5~60분 |
| DLQ 재시도 간격 | 숫자 | 60분 | 10~180분 |

**알림 탭**:

| 항목 | 입력 유형 | 기본값 |
|------|-----------|--------|
| 인앱 알림 활성화 | 토글 | ON |
| Windows 토스트 알림 | 토글 | ON |
| 동기화 완료 알림 | 토글 | OFF |
| 오류 알림 | 토글 | ON |
| 세션 만료 알림 | 토글 | ON |
| 알림음 | 토글 | OFF |

**시스템 탭**:

| 항목 | 입력 유형 | 기본값 |
|------|-----------|--------|
| Windows 시작 시 자동 실행 | 토글 | ON |
| 시작 시 트레이로 시작 | 토글 | ON |
| 창 닫기 시 트레이로 최소화 | 토글 | ON |
| 다크/라이트 모드 | 라디오 (다크/라이트/시스템) | 다크 |
| 언어 | 드롭다운 | 한국어 |

**저장소 탭**:

| 항목 | 입력 유형 | 기본값 |
|------|-----------|--------|
| 임시 다운로드 경로 | 경로 선택기 + 찾아보기 | `%APPDATA%/yjsync/temp` |
| 로그 보관 기간 | 숫자 | 30일 |
| 알림 보관 기간 | 숫자 | 7일 |
| 데이터 초기화 | 버튼 (위험 액션) | - |

**정보 탭**:
- 앱 버전, 빌드 번호
- Electron/Node.js/Chrome 버전
- 라이선스 정보
- 업데이트 확인 버튼

#### 주요 인터랙션

| 액션 | 동작 |
|------|------|
| [연결 테스트] 클릭 | 버튼 로딩 스피너 → 결과 인라인 표시 (2초 타임아웃) |
| 필드 변경 | 변경사항 있으면 [저장] 버튼 활성화, 변경 없으면 비활성화 |
| [저장] 클릭 | 유효성 검사 → 통과 시 저장 + 토스트 "설정이 저장되었습니다" |
| [데이터 초기화] 클릭 | 확인 다이얼로그 ("모든 동기화 이력과 설정이 삭제됩니다") → 확인 시 실행 |
| 탭 전환 | 미저장 변경사항 있으면 "변경사항을 저장하시겠습니까?" 다이얼로그 |

#### 로딩/에러 상태

- **설정 로딩 실패**: "설정을 불러올 수 없습니다" + [기본값으로 복원] 버튼
- **저장 실패**: 빨간 토스트 "설정 저장에 실패했습니다. 다시 시도해 주세요."
- **연결 테스트 실패**: 인라인 빨간 텍스트로 구체적 오류 표시 (타임아웃/인증 실패/서버 없음)

**컴포넌트 Props 스펙 (SDD Level 2):**

```typescript
interface SettingsPageProps {
  // 데이터는 Zustand store에서 주입
}

interface ConnectionTestButtonProps {
  type: 'lguplus' | 'webhard';
  onTest: () => Promise<boolean>;
}

interface SettingsFormProps {
  config: AppConfig;
  onSave: (config: Partial<AppConfig>) => void;
  onTestConnection: (type: 'lguplus' | 'webhard') => Promise<boolean>;
}
```

---

## 4. 시스템 트레이

### 4.1 트레이 아이콘 상태

| 상태 | 아이콘 색상 | 툴팁 텍스트 예시 |
|------|------------|------------------|
| 정상 동기화 중 | 초록 | "동기화 중 - 오늘 45건 완료" |
| 동기화 진행 중 | 초록 + 회전 애니메이션 | "파일 전송 중... (3/5)" |
| 경고 (일부 실패) | 노랑 | "경고 - 2건 실패, 43건 성공" |
| 오류 (동기화 중단) | 빨강 | "오류 - 연결 끊김" |
| 일시중지 | 회색 | "일시중지됨" |

### 4.2 컨텍스트 메뉴 (우클릭)

```
+----------------------------+
| 웹하드 동기화 v2.0.0       |
|----------------------------|
| 열기                       |
|----------------------------|
| V 동기화 활성              |
|   일시중지                 |
|   전체 동기화              |
|----------------------------|
| 오늘: 45건 완료 (1.8 GB)   |
|----------------------------|
| 종료                       |
+----------------------------+
```

| 메뉴 항목 | 동작 |
|-----------|------|
| 열기 | 메인 창 복원/포커스. 최소화 상태면 복원 |
| 동기화 활성/일시중지 | 토글. 체크마크로 현재 상태 표시 |
| 전체 동기화 | 전체 동기화 즉시 시작 |
| 종료 | 확인 다이얼로그 → "동기화가 중단됩니다. 종료하시겠습니까?" → 프로세스 완전 종료 |

### 4.3 더블클릭 동작

- 메인 창이 숨겨진 상태: 창 표시 + 포커스
- 메인 창이 최소화 상태: 복원 + 포커스
- 메인 창이 이미 표시된 상태: 포커스만

### 4.4 Windows 토스트 알림

**알림 유형별 디자인**:

| 유형 | 제목 | 본문 예시 | 클릭 시 |
|------|------|-----------|---------|
| 동기화 완료 | "동기화 완료" | "원컴퍼니/도면A.dxf (2.1 MB)" | 파일 탐색기 → 해당 파일 |
| 동기화 실패 | "동기화 실패" | "한빛포장/시안.ai - 다운로드 타임아웃" | 동기화 로그 → 해당 항목 |
| 세션 만료 | "연결 끊김" | "LGU+ 웹하드 세션이 만료되었습니다. 자동 재연결 시도 중..." | 설정 → 계정 탭 |
| 자동 복구 성공 | "연결 복구" | "LGU+ 웹하드에 다시 연결되었습니다" | 대시보드 |
| 신규 폴더 감지 | "새 폴더 발견" | "올리기전용/신규업체 폴더가 추가되었습니다" | 폴더 설정 |

**알림 그룹핑**: 10초 이내 동일 유형 알림 3건 이상 발생 시 그룹핑.
예: "동기화 완료 (5건)" + 마지막 파일명

---

## 5. 컴포넌트 계층

### 5.1 컴포넌트 트리

```
App
├── ThemeProvider
│   └── AppLayout
│       ├── Sidebar
│       │   ├── SidebarLogo
│       │   ├── SidebarNav
│       │   │   └── SidebarNavItem (x6)
│       │   └── SidebarStatus
│       │       ├── ConnectionDot (외부웹하드)
│       │       └── ConnectionDot (자체웹하드)
│       ├── Header
│       │   ├── PageTitle
│       │   ├── NotificationBell
│       │   └── ThemeToggle
│       ├── MainContent (React Router)
│       │   ├── DashboardPage
│       │   │   ├── StatusCard
│       │   │   ├── SummaryCards (x4)
│       │   │   ├── ActiveTransfers
│       │   │   │   └── TransferItem
│       │   │   └── RecentFiles
│       │   │       └── RecentFileRow
│       │   ├── FileExplorerPage
│       │   │   ├── SearchBar
│       │   │   ├── FolderTree
│       │   │   │   └── FolderTreeNode (재귀)
│       │   │   ├── FileTable
│       │   │   │   ├── FileTableHeader
│       │   │   │   └── FileTableRow
│       │   │   └── FileDetailPanel
│       │   ├── FolderSettingsPage
│       │   │   ├── FolderCheckList
│       │   │   │   └── FolderCheckItem
│       │   │   └── FolderSummaryBar
│       │   ├── SyncLogPage
│       │   │   ├── LogFilterBar
│       │   │   ├── LogList (가상 스크롤)
│       │   │   │   └── LogEntry
│       │   │   └── LogSummaryBar
│       │   ├── StatsPage
│       │   │   ├── PeriodTabs
│       │   │   ├── StatsSummaryCards (x3)
│       │   │   ├── DailyBarChart
│       │   │   ├── SuccessRatioPieChart
│       │   │   ├── DailyVolumeLineChart
│       │   │   └── FolderBreakdown
│       │   └── SettingsPage
│       │       └── SettingsTabs
│       │           ├── AccountTab
│       │           ├── SyncTab
│       │           ├── NotificationTab
│       │           ├── SystemTab
│       │           ├── StorageTab
│       │           └── AboutTab
│       └── NotificationCenter (오버레이)
│           └── NotificationItem
├── GlobalToast (포탈)
├── ConfirmDialog (포탈)
└── FullSyncProgressModal (포탈)
```

### 5.2 공통 컴포넌트 (shadcn/ui 기반)

| 컴포넌트 | 용도 | shadcn/ui 기반 |
|----------|------|---------------|
| `StatusBadge` | 동기화 상태 표시 (색상 + 텍스트) | `Badge` |
| `ProgressBar` | 다운로드/업로드 진행률 | `Progress` |
| `ConnectionDot` | 연결 상태 점 (초록/빨강) | 커스텀 |
| `EmptyState` | 데이터 없을 때 안내 문구 + CTA | 커스텀 |
| `SkeletonCard` | 로딩 중 스켈레톤 | `Skeleton` |
| `SearchInput` | 검색 입력 (디바운스) | `Input` |
| `ConfirmDialog` | 확인/취소 다이얼로그 | `AlertDialog` |
| `GlobalToast` | 전역 토스트 알림 | `Toast` |
| `DataTable` | 정렬/필터 가능 테이블 | `Table` |

### 5.3 컴포넌트 Props 타입 카탈로그 (SDD Level 2)

모든 React 컴포넌트는 명시적 Props 인터페이스를 가진다.

| 컴포넌트 | Props 인터페이스 | 스펙 파일 |
|---|---|---|
| `DashboardPage` | `DashboardPageProps` | `src/renderer/types/pages.types.ts` |
| `SyncStatusCard` | `SyncStatusCardProps` | `src/renderer/types/components.types.ts` |
| `RecentActivityList` | `RecentActivityListProps` | `src/renderer/types/components.types.ts` |
| `QuickStats` | `QuickStatsProps` | `src/renderer/types/components.types.ts` |
| `FileExplorerPage` | `FileExplorerPageProps` | `src/renderer/types/pages.types.ts` |
| `FolderTree` | `FolderTreeProps` | `src/renderer/types/components.types.ts` |
| `FileList` | `FileListProps` | `src/renderer/types/components.types.ts` |
| `FolderSettingsPage` | `FolderSettingsPageProps` | `src/renderer/types/pages.types.ts` |
| `LogViewerPage` | `LogViewerPageProps` | `src/renderer/types/pages.types.ts` |
| `StatisticsPage` | `StatisticsPageProps` | `src/renderer/types/pages.types.ts` |
| `SettingsPage` | `SettingsPageProps` | `src/renderer/types/pages.types.ts` |

> 📌 Props 타입의 Core 데이터 타입 참조는 [10-SDD-개발방법론](./10-SDD-개발방법론.md) §4.1을 참조한다.

---

## 6. 상태 관리 (Zustand)

### 6.1 스토어 분리 원칙

각 스토어는 독립적 관심사를 담당하며, IPC를 통해 Main 프로세스와 통신한다.

```
[Renderer Process]
  syncStore ──── IPC ──── [Main Process: SyncEngine]
  fileStore ──── IPC ──── [Main Process: FileService]
  logStore  ──── IPC ──── [Main Process: LogService]
  settingsStore ─ IPC ─── [Main Process: ConfigService]
  uiStore   (로컬 전용, IPC 불필요)
```

### 6.2 syncStore (동기화 상태)

```typescript
interface SyncStore {
  // 상태
  status: 'idle' | 'syncing' | 'paused' | 'error';
  connectionStatus: {
    external: 'connected' | 'disconnected' | 'reconnecting';
    internal: 'connected' | 'disconnected' | 'reconnecting';
  };
  activeTransfers: Transfer[];       // 현재 진행 중인 전송 목록
  todaySummary: {
    total: number;
    success: number;
    failed: number;
    totalBytes: number;
  };
  recentFiles: SyncedFile[];          // 최근 동기화 파일 (최대 50건)
  uptime: number;                     // 연속 가동 시간(초)
  fullSyncProgress: FullSyncProgress | null; // 전체 동기화 진행 상태

  // 액션
  pause: () => void;
  resume: () => void;
  startFullSync: () => void;
  cancelFullSync: () => void;
  retryFile: (fileId: string) => void;
}
```

#### Sync Store 타입 인터페이스 (SDD Level 2):

```typescript
interface SyncStoreState {
  status: SyncEngineStatus;
  progress: SyncProgress | null;
  lastSyncTime: string | null;
  isRunning: boolean;
}

interface SyncStoreActions {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  setStatus: (status: SyncEngineStatus) => void;
  setProgress: (progress: SyncProgress) => void;
}

type SyncStore = SyncStoreState & SyncStoreActions;
```

### 6.3 fileStore (파일 탐색)

```typescript
interface FileStore {
  // 상태
  folderTree: FolderNode[];           // 폴더 트리 구조
  currentFolderId: string | null;     // 현재 선택된 폴더
  files: FileItem[];                  // 현재 폴더의 파일 목록
  selectedFile: FileItem | null;      // 선택된 파일
  searchQuery: string;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  isLoading: boolean;

  // 액션
  loadFolderTree: () => void;
  selectFolder: (folderId: string) => void;
  selectFile: (fileId: string) => void;
  syncFile: (fileId: string) => void;
  refreshFolder: () => void;
  setSearch: (query: string) => void;
  setSort: (column: string) => void;
}
```

#### File Store 타입 인터페이스 (SDD Level 2):

```typescript
interface FileStoreState {
  folderTree: SyncFolder[];
  currentFolderId: string | null;
  files: SyncFile[];
  selectedFileId: string | null;
  isLoading: boolean;
}

interface FileStoreActions {
  loadFolderTree: () => Promise<void>;
  selectFolder: (folderId: string) => void;
  selectFile: (fileId: string) => void;
  retryFile: (fileId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

type FileStore = FileStoreState & FileStoreActions;
```

### 6.4 logStore (로그)

```typescript
interface LogStore {
  // 상태
  logs: LogEntry[];                   // 현재 표시 중인 로그 목록
  filters: {
    level: 'all' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    type: 'all' | 'download' | 'upload' | 'session' | 'system';
    dateRange: { start: Date; end: Date };
    searchQuery: string;
  };
  isRealtime: boolean;                // 실시간 모드 여부
  totalCount: number;
  levelCounts: Record<string, number>;

  // 액션
  setFilter: (key: string, value: any) => void;
  loadMore: () => void;               // 무한 스크롤용
  exportLogs: () => void;
  retryFromLog: (logId: string) => void;
  toggleRealtime: () => void;
}
```

#### Log Store 타입 인터페이스 (SDD Level 2):

```typescript
interface LogStoreState {
  entries: LogEntry[];
  filters: LogFilters;
  totalCount: number;
  isRealtime: boolean;
}

interface LogStoreActions {
  query: (filters: LogFilters) => Promise<void>;
  loadMore: () => Promise<void>;
  exportLogs: () => Promise<void>;
  setFilters: (filters: Partial<LogFilters>) => void;
  appendEntry: (entry: LogEntry) => void;
}

type LogStore = LogStoreState & LogStoreActions;
```

### 6.5 settingsStore (설정)

```typescript
interface SettingsStore {
  // 상태
  settings: {
    account: {
      externalWebhardId: string;
      externalWebhardPassword: string;  // 암호화 상태
      internalApiUrl: string;
      internalApiKey: string;            // 암호화 상태
    };
    sync: {
      pollingInterval: number;           // 초
      maxConcurrentDownloads: number;
      maxConcurrentUploads: number;
      snapshotInterval: number;          // 분
      dlqRetryInterval: number;          // 분
    };
    notification: {
      inApp: boolean;
      toast: boolean;
      onComplete: boolean;
      onError: boolean;
      onSessionExpiry: boolean;
      sound: boolean;
    };
    system: {
      autoStart: boolean;
      startMinimized: boolean;
      minimizeToTray: boolean;
      theme: 'dark' | 'light' | 'system';
      language: string;
    };
    storage: {
      tempDownloadPath: string;
      logRetentionDays: number;
      notificationRetentionDays: number;
    };
  };
  isDirty: boolean;                      // 미저장 변경사항 존재 여부
  activeTab: string;

  // 액션
  updateSetting: (path: string, value: any) => void;
  save: () => Promise<void>;
  testConnection: (type: 'external' | 'internal') => Promise<TestResult>;
  resetToDefaults: () => void;
  setActiveTab: (tab: string) => void;
}
```

#### Settings Store 타입 인터페이스 (SDD Level 2):

```typescript
interface SettingsStoreState {
  config: AppConfig;
  isDirty: boolean;
  activeTab: string;
}

interface SettingsStoreActions {
  load: () => Promise<void>;
  save: (config: Partial<AppConfig>) => Promise<void>;
  testConnection: (type: 'lguplus' | 'webhard') => Promise<boolean>;
  reset: () => void;
  setActiveTab: (tab: string) => void;
}

type SettingsStore = SettingsStoreState & SettingsStoreActions;
```

### 6.6 uiStore (UI 전용)

```typescript
interface UIStore {
  // 상태
  sidebarCollapsed: boolean;
  currentPage: string;
  notifications: Notification[];       // 인앱 알림 목록
  unreadCount: number;
  isNotificationCenterOpen: boolean;
  confirmDialog: ConfirmDialogState | null;

  // 액션
  toggleSidebar: () => void;
  navigate: (page: string) => void;
  addNotification: (notification: Notification) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  toggleNotificationCenter: () => void;
  showConfirmDialog: (config: ConfirmDialogConfig) => Promise<boolean>;
}
```

#### UI Store 타입 인터페이스 (SDD Level 2):

```typescript
interface UIStoreState {
  sidebarCollapsed: boolean;
  currentPage: string;
  notifications: AppNotification[];
  unreadCount: number;
  isNotificationCenterOpen: boolean;
}

interface UIStoreActions {
  toggleSidebar: () => void;
  navigate: (page: string) => void;
  addNotification: (notification: AppNotification) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  toggleNotificationCenter: () => void;
}

type UIStore = UIStoreState & UIStoreActions;
```

#### Stats Store 타입 인터페이스 (SDD Level 2):

```typescript
interface StatsStoreState {
  dailyStats: DailyStats[];
  period: 'today' | 'week' | 'month' | 'all';
  isLoading: boolean;
}

interface StatsStoreActions {
  load: (period: 'today' | 'week' | 'month' | 'all') => Promise<void>;
  setPeriod: (period: 'today' | 'week' | 'month' | 'all') => void;
}

type StatsStore = StatsStoreState & StatsStoreActions;
```

#### Folder Store 타입 인터페이스 (SDD Level 2):

```typescript
interface FolderStoreState {
  folders: SyncFolder[];
  isLoading: boolean;
}

interface FolderStoreActions {
  load: () => Promise<void>;
  toggle: (folderId: string, enabled: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

type FolderStore = FolderStoreState & FolderStoreActions;
```

### 6.7 IPC 이벤트 수신

Main 프로세스로부터 푸시되는 실시간 이벤트 처리:

```typescript
// Renderer 초기화 시 IPC 리스너 등록
window.electronAPI.on('sync:status-changed', (status) => {
  useSyncStore.getState().setStatus(status);
});

window.electronAPI.on('sync:transfer-progress', (transfer) => {
  useSyncStore.getState().updateTransfer(transfer);
});

window.electronAPI.on('sync:file-completed', (file) => {
  useSyncStore.getState().addRecentFile(file);
});

window.electronAPI.on('log:new-entry', (entry) => {
  useLogStore.getState().appendLog(entry);
});

window.electronAPI.on('notification:new', (notification) => {
  useUIStore.getState().addNotification(notification);
});

window.electronAPI.on('connection:status-changed', (connectionStatus) => {
  useSyncStore.getState().setConnectionStatus(connectionStatus);
});
```

---

## 7. 반응형/접근성

### 7.1 윈도우 크기

| 항목 | 값 |
|------|-----|
| 최소 크기 | 960 x 640 px |
| 기본 크기 | 1200 x 800 px |
| 최대 크기 | 제한 없음 (모니터 해상도까지) |

- 960px 미만으로는 리사이즈 불가 (`minWidth`, `minHeight` 설정)
- 사이드바는 960~1100px 구간에서 자동으로 아이콘 모드(64px)로 축소
- 파일 탐색기의 폴더 트리/파일 목록 구분선은 드래그로 리사이즈 가능 (최소 각 200px)

### 7.2 키보드 단축키

| 단축키 | 동작 |
|--------|------|
| `Ctrl+1` ~ `Ctrl+5` | 각 메뉴 페이지로 이동 |
| `Ctrl+,` | 설정 페이지로 이동 |
| `Ctrl+F` | 현재 페이지의 검색 입력에 포커스 |
| `Ctrl+R` | 현재 페이지 데이터 새로고침 |
| `Ctrl+Shift+S` | 전체 동기화 시작 |
| `Ctrl+P` | 동기화 일시중지/재개 토글 |
| `Escape` | 다이얼로그/오버레이 닫기 |
| `Tab` / `Shift+Tab` | 포커스 이동 (표준) |
| `Enter` / `Space` | 포커스된 항목 활성화 |

### 7.3 접근성 (ARIA)

| 요소 | ARIA 속성 |
|------|-----------|
| 사이드바 | `role="navigation"`, `aria-label="메인 네비게이션"` |
| 상태 카드 | `role="status"`, `aria-live="polite"` |
| 진행률 바 | `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax` |
| 알림 벨 | `aria-label="알림 N건"` |
| 토글 버튼 | `aria-pressed="true/false"` |
| 테이블 | `role="table"`, 정렬 헤더에 `aria-sort` |
| 트리 뷰 | `role="tree"`, 노드에 `role="treeitem"`, `aria-expanded` |
| 다이얼로그 | `role="alertdialog"`, `aria-modal="true"` |
| 토스트 알림 | `role="alert"`, `aria-live="assertive"` |

- 모든 아이콘 버튼에 `aria-label` 제공
- 색상만으로 정보를 전달하지 않음 (아이콘 + 텍스트 병행)
- 포커스 링: `focus-visible:ring-2 ring-blue-500` (키보드 탐색 시에만 표시)

---

## 8. 에러 UI

### 8.1 연결 끊김 (Connection Lost)

**표시 위치**: 메인 콘텐츠 상단 고정 배너

```
+--------------------------------------------------+
| [!] LGU+ 웹하드 연결이 끊겼습니다.               |
|     자동 재연결 시도 중... (3/5)       [수동 연결] |
+--------------------------------------------------+
```

- 배경: `bg-red-500/10`, 텍스트: `text-red-500`
- 자동 재연결 중이면 시도 횟수 표시
- 재연결 성공 시 초록 배너 2초 표시 후 자동 닫힘
- 5회 실패 후: "자동 재연결에 실패했습니다. [수동 연결] 버튼을 눌러주세요."

### 8.2 인증 만료 (Auth Expired)

**표시 위치**: 전체 화면 오버레이

```
+--------------------------------------------------+
|                                                    |
|          [잠금 아이콘]                             |
|    LGU+ 웹하드 세션이 만료되었습니다               |
|                                                    |
|    자동 재로그인을 시도했지만 실패했습니다.         |
|    비밀번호가 변경되었을 수 있습니다.               |
|                                                    |
|    [설정에서 계정 확인]    [재시도]                 |
|                                                    |
+--------------------------------------------------+
```

- 반투명 배경 오버레이
- [설정에서 계정 확인] → 설정 > 계정 탭으로 이동
- [재시도] → 현재 저장된 자격증명으로 재로그인 시도

### 8.3 동기화 실패 표시

**개별 파일 실패**: 해당 행에 인라인 표시

| 위치 | 표시 방식 |
|------|-----------|
| 대시보드 최근 파일 | 빨간 X 아이콘 + "실패-재시도" 링크 |
| 파일 탐색기 | 파일 행 배경 `bg-red-500/5` + 상태 아이콘 X |
| 동기화 로그 | ERROR 레벨 행 + 펼쳐서 상세 사유 확인 + [재시도] 버튼 |

**대량 실패 (10건 이상)**: 대시보드 상단에 경고 카드

```
+--------------------------------------------------+
| [!] 12건의 파일이 동기화에 실패했습니다            |
|     주요 원인: 네트워크 타임아웃 (8건), 서버오류   |
|     [실패 목록 보기]  [전체 재시도]                |
+--------------------------------------------------+
```

### 8.4 전역 토스트 (Global Toast)

**위치**: 화면 우하단, 최대 3개 스택

```
+-------------------------------+
| V  설정이 저장되었습니다      | <- 성공 (초록, 3초 후 자동 닫힘)
+-------------------------------+
| !  연결 테스트에 실패했습니다  | <- 오류 (빨강, 수동 닫기)
+-------------------------------+
```

**토스트 유형**:

| 유형 | 색상 | 자동 닫힘 | 용도 |
|------|------|-----------|------|
| 성공 | 초록 좌측 바 | 3초 | 저장 완료, 동기화 완료 |
| 정보 | 파랑 좌측 바 | 5초 | 상태 변경 알림 |
| 경고 | 노랑 좌측 바 | 수동 | 부분 실패, 주의 필요 |
| 오류 | 빨강 좌측 바 | 수동 | 저장 실패, 연결 실패 |

### 8.5 에러 바운더리 (React Error Boundary)

페이지 단위 에러 바운더리 적용. 한 페이지 오류가 전체 앱을 중단시키지 않음.

```
+--------------------------------------------------+
|                                                    |
|          [경고 아이콘]                             |
|    이 페이지를 표시할 수 없습니다                   |
|                                                    |
|    오류가 발생했습니다. 문제가 지속되면             |
|    개발자에게 문의해 주세요.                        |
|                                                    |
|    [새로고침]    [대시보드로 이동]                  |
|                                                    |
|    > 오류 상세 정보 (펼치기)                        |
+--------------------------------------------------+
```

- [새로고침]: 해당 페이지만 리마운트
- [대시보드로 이동]: 안전한 페이지로 이동
- 오류 상세: 개발자 전달용 기술 정보 (접힌 상태 기본)
- 에러 발생 시 자동으로 Main 프로세스에 에러 로그 전송

---

## 부록: 화면 흐름 요약

```
[앱 시작]
  ├── 자격증명 없음 → 설정 > 계정 탭 (온보딩)
  ├── 자격증명 있음 → 자동 로그인 → 대시보드
  └── 트레이 모드 → 백그라운드 동기화 (창 숨김)

[일상 운영]
  트레이 아이콘 관찰 → 초록이면 정상
  더블클릭 → 대시보드에서 오늘 현황 확인
  이상 없으면 닫기 → 트레이 복귀

[오류 발생]
  토스트 알림 수신 → 클릭 → 해당 화면 이동
  ├── 개별 파일 실패 → [재시도] 클릭
  ├── 세션 만료 → [재시도] 또는 [설정에서 계정 확인]
  └── 대량 실패 → [실패 목록 보기] → [전체 재시도]
```

---

## UI 스펙 체계

### 컴포넌트 스펙 → IPC 스펙 연결 규칙

UI 컴포넌트는 다음 규칙에 따라 Core 레이어와 통신한다:

1. **Props → IPC 매핑**: 컴포넌트 액션 Props(`onStart`, `onSave` 등)는 Zustand store action을 통해 IPC 채널을 호출한다
2. **Store → IPC 바인딩**: 각 Zustand store는 대응하는 IPC 핸들러 채널과 1:1 매핑된다
3. **이벤트 → Store 업데이트**: Main→Renderer IPC 이벤트는 store 상태를 직접 업데이트한다

```
[Component Props] → [Zustand Store Action] → [IPC Handler] → [Core Module]
                     ↑                                              |
                     └── [IPC Event] ← [EventBus] ←────────────────┘
```

| Store | IPC Handler 채널 | IPC Event 채널 |
|---|---|---|
| `SyncStore` | `sync:start`, `sync:stop`, `sync:pause` | `sync:statusChanged`, `sync:progress` |
| `FileStore` | `files:listFolder` | `sync:fileCompleted`, `sync:fileFailed` |
| `FolderStore` | `folders:getAll`, `folders:toggle` | — |
| `LogStore` | `logs:query`, `logs:export` | `log:entry` |
| `StatsStore` | `stats:daily` | — |
| `SettingsStore` | `config:getAll`, `config:set` | — |

> 📌 IPC 채널 타입 정의는 [06-API-인터페이스-설계서](./06-API-인터페이스-설계서.md) §2를, SDD 스펙 체계는 [10-SDD-개발방법론](./10-SDD-개발방법론.md)을 참조한다.
