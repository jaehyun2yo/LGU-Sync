import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diff = now - date
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return '방금'
  if (minutes < 60) return `${minutes}분 전`
  if (hours < 24) return `${hours}시간 전`
  if (days < 7) return `${days}일 전`
  return new Date(dateStr).toLocaleDateString('ko-KR')
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return ''
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `~${sec}초`
  const min = Math.floor(sec / 60)
  if (min < 60) return `~${min}분`
  const hr = Math.floor(min / 60)
  return `~${hr}시간 ${min % 60}분`
}

export function formatElapsedTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}초`
  const min = Math.floor(sec / 60)
  const remainSec = sec % 60
  if (min < 60) return `${min}분 ${remainSec}초`
  const hr = Math.floor(min / 60)
  const remainMin = min % 60
  return `${hr}시간 ${remainMin}분`
}

export function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  const today = new Date()
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()

  if (isToday) {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
  return d.toLocaleDateString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
