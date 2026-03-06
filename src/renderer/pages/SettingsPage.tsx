import { useEffect, useState } from 'react'
import { Eye, EyeOff, Check, X, Loader, Save } from 'lucide-react'
import { cn } from '../lib/utils'
import { useSettingsStore } from '../stores/settings-store'
import type { AppSettings, ConnectionTestResult } from '../../shared/ipc-types'

// ── Tab config ──

type TabId = 'account' | 'sync' | 'notification' | 'system' | 'about'

const TABS: { id: TabId; label: string }[] = [
  { id: 'account', label: '계정' },
  { id: 'sync', label: '동기화' },
  { id: 'notification', label: '알림' },
  { id: 'system', label: '시스템' },
  { id: 'about', label: '정보' },
]

// ── Toggle switch ──

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <span className="text-sm text-card-foreground">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0',
          checked ? 'bg-info' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform shadow-sm',
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
          )}
        />
      </button>
    </label>
  )
}

// ── Password input with show/hide ──

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 pr-9 text-sm bg-background border border-border rounded-md text-card-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-info"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-card-foreground transition-colors"
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

// ── Connection test result display ──

function ConnectionResult({ result }: { result: ConnectionTestResult | null }) {
  if (!result) return null
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-xs mt-1.5',
        result.success ? 'text-success' : 'text-error',
      )}
    >
      {result.success ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      <span>
        {result.success
          ? `연결 성공 (${result.latencyMs}ms)`
          : result.message}
      </span>
    </div>
  )
}

// ── Number input with min/max/unit ──

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  unit,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  unit?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-card-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10)
            if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)))
          }}
          className="w-20 px-2 py-1.5 text-sm text-right bg-background border border-border rounded-md text-card-foreground focus:outline-none focus:ring-1 focus:ring-info"
        />
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
    </div>
  )
}

// ── Section wrapper ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-card-foreground border-b border-border pb-2">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

// ── Account tab ──

function AccountTab() {
  const { settings, updateSettings, testConnection, connectionTestResults } = useSettingsStore()
  const [testingLguplus, setTestingLguplus] = useState(false)
  const [testingWebhard, setTestingWebhard] = useState(false)

  if (!settings) return null

  const handleTestLguplus = async () => {
    setTestingLguplus(true)
    try {
      await testConnection('lguplus')
    } finally {
      setTestingLguplus(false)
    }
  }

  const handleTestWebhard = async () => {
    setTestingWebhard(true)
    try {
      await testConnection('webhard')
    } finally {
      setTestingWebhard(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* LGU+ */}
      <Section title="LGU+ 웹하드">
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">사용자 이름</label>
            <input
              type="text"
              value={settings.lguplus.username}
              onChange={(e) =>
                updateSettings({ lguplus: { ...settings.lguplus, username: e.target.value } })
              }
              placeholder="LGU+ 아이디"
              className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-md text-card-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-info"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">비밀번호</label>
            <PasswordInput
              value={settings.lguplus.password}
              onChange={(v) =>
                updateSettings({ lguplus: { ...settings.lguplus, password: v } })
              }
              placeholder="LGU+ 비밀번호"
            />
          </div>
          <div className="flex items-center justify-between">
            <ConnectionResult result={connectionTestResults.lguplus} />
            <button
              onClick={handleTestLguplus}
              disabled={testingLguplus}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-accent-foreground hover:bg-accent/80 transition-colors disabled:opacity-50"
            >
              {testingLguplus ? (
                <Loader className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              연결 테스트
            </button>
          </div>
        </div>
      </Section>

      {/* Webhard API */}
      <Section title="자체웹하드 API">
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">API URL</label>
            <input
              type="text"
              value={settings.webhard.apiUrl}
              onChange={(e) =>
                updateSettings({ webhard: { ...settings.webhard, apiUrl: e.target.value } })
              }
              placeholder="https://api.example.com"
              className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-md text-card-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-info"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">API Key</label>
            <PasswordInput
              value={settings.webhard.apiKey}
              onChange={(v) =>
                updateSettings({ webhard: { ...settings.webhard, apiKey: v } })
              }
              placeholder="API Key"
            />
          </div>
          <div className="flex items-center justify-between">
            <ConnectionResult result={connectionTestResults.webhard} />
            <button
              onClick={handleTestWebhard}
              disabled={testingWebhard}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-accent-foreground hover:bg-accent/80 transition-colors disabled:opacity-50"
            >
              {testingWebhard ? (
                <Loader className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              연결 테스트
            </button>
          </div>
        </div>
      </Section>
    </div>
  )
}

// ── Sync tab ──

function SyncTab() {
  const { settings, updateSettings } = useSettingsStore()
  if (!settings) return null

  return (
    <Section title="동기화 설정">
      <NumberField
        label="폴링 간격"
        value={settings.sync.pollingIntervalSec}
        onChange={(v) =>
          updateSettings({ sync: { ...settings.sync, pollingIntervalSec: v } })
        }
        min={3}
        max={60}
        unit="초"
      />
      <NumberField
        label="최대 동시 다운로드"
        value={settings.sync.maxConcurrentDownloads}
        onChange={(v) =>
          updateSettings({ sync: { ...settings.sync, maxConcurrentDownloads: v } })
        }
        min={1}
        max={10}
      />
      <NumberField
        label="최대 동시 업로드"
        value={settings.sync.maxConcurrentUploads}
        onChange={(v) =>
          updateSettings({ sync: { ...settings.sync, maxConcurrentUploads: v } })
        }
        min={1}
        max={5}
      />
      <NumberField
        label="스냅샷 간격"
        value={settings.sync.snapshotIntervalMin}
        onChange={(v) =>
          updateSettings({ sync: { ...settings.sync, snapshotIntervalMin: v } })
        }
        min={5}
        max={60}
        unit="분"
      />
    </Section>
  )
}

// ── Notification tab ──

function NotificationTab() {
  const { settings, updateSettings } = useSettingsStore()
  if (!settings) return null

  return (
    <Section title="알림 설정">
      <Toggle
        label="인앱 알림"
        checked={settings.notification.inApp}
        onChange={(v) =>
          updateSettings({ notification: { ...settings.notification, inApp: v } })
        }
      />
      <Toggle
        label="토스트 알림"
        checked={settings.notification.toast}
        onChange={(v) =>
          updateSettings({ notification: { ...settings.notification, toast: v } })
        }
      />
    </Section>
  )
}

// ── System tab ──

function SystemTab() {
  const { settings, updateSettings } = useSettingsStore()
  if (!settings) return null

  return (
    <div className="space-y-6">
      <Section title="시스템 설정">
        <Toggle
          label="자동 시작"
          checked={settings.system.autoStart}
          onChange={(v) =>
            updateSettings({ system: { ...settings.system, autoStart: v } })
          }
        />
        <div>
          <label className="block text-sm text-card-foreground mb-1">임시 다운로드 경로</label>
          <input
            type="text"
            value={settings.system.tempDownloadPath}
            onChange={(e) =>
              updateSettings({ system: { ...settings.system, tempDownloadPath: e.target.value } })
            }
            placeholder="C:\temp\downloads"
            className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-md text-card-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-info"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            다운로드 임시 파일이 저장되는 폴더 경로
          </p>
        </div>
        <NumberField
          label="로그 보관 기간"
          value={settings.system.logRetentionDays}
          onChange={(v) =>
            updateSettings({ system: { ...settings.system, logRetentionDays: v } })
          }
          min={7}
          max={365}
          unit="일"
        />
      </Section>
    </div>
  )
}

// ── About tab ──

function AboutTab() {
  return (
    <Section title="프로그램 정보">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">앱 버전</span>
          <span className="text-sm font-medium text-card-foreground">2.0.0</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">빌드 환경</span>
          <span className="text-sm font-medium text-card-foreground">Electron + React</span>
        </div>
      </div>
    </Section>
  )
}

// ── SettingsPage (main export) ──

export function SettingsPage() {
  const { settings, isDirty, isLoading, isSaving, fetchSettings, saveSettings, activeTab, setActiveTab } =
    useSettingsStore()
  const [saveMessage, setSaveMessage] = useState(false)

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const handleSave = async () => {
    const success = await saveSettings()
    if (success) {
      setSaveMessage(true)
      setTimeout(() => setSaveMessage(false), 3000)
    }
  }

  if (isLoading || !settings) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader className="h-5 w-5 text-muted-foreground animate-spin" />
        <span className="ml-2 text-sm text-muted-foreground">설정 불러오는 중...</span>
      </div>
    )
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case 'account':
        return <AccountTab />
      case 'sync':
        return <SyncTab />
      case 'notification':
        return <NotificationTab />
      case 'system':
        return <SystemTab />
      case 'about':
        return <AboutTab />
      default:
        return <AccountTab />
    }
  }

  return (
    <div className="flex flex-col gap-4 p-1 h-full">
      {/* Tab navigation */}
      <div className="bg-card border border-border rounded-lg">
        <div className="flex border-b border-border">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium transition-colors relative',
                activeTab === tab.id
                  ? 'text-card-foreground'
                  : 'text-muted-foreground hover:text-card-foreground',
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-info" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-5">{renderTabContent()}</div>
      </div>

      {/* Save bar */}
      <div className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3">
        <div className="text-xs text-muted-foreground">
          {saveMessage && (
            <span className="flex items-center gap-1.5 text-success">
              <Check className="h-3.5 w-3.5" />
              설정이 저장되었습니다
            </span>
          )}
          {isDirty && !saveMessage && (
            <span className="text-warning">저장되지 않은 변경사항이 있습니다</span>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={!isDirty || isSaving}
          className={cn(
            'flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
            isDirty
              ? 'bg-info text-white hover:bg-info/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {isSaving ? (
            <Loader className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          저장
        </button>
      </div>
    </div>
  )
}
