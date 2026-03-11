# 외부웹하드동기화프로그램 v2 - GUI/UX 설계서: 상태 관리 (Zustand)

> **원본 문서**: [05-GUI-UX-설계서](../05-GUI-UX-설계서.md)

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
