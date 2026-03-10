import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useToastStore } from '../../../src/renderer/stores/toast-store'

describe('toast-store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('addToast creates a toast in entering phase', () => {
    useToastStore.getState().addToast({
      type: 'info',
      title: 'Test',
      message: 'Hello',
      durationMs: 5000,
    })

    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].phase).toBe('entering')
    expect(toasts[0].title).toBe('Test')
    expect(toasts[0].type).toBe('info')
  })

  it('toast transitions from entering to visible after 50ms', () => {
    useToastStore.getState().addToast({
      type: 'success',
      title: 'Done',
      message: 'OK',
      durationMs: 5000,
    })

    vi.advanceTimersByTime(50)

    const toasts = useToastStore.getState().toasts
    expect(toasts[0].phase).toBe('visible')
  })

  it('toast auto-dismisses after durationMs', () => {
    useToastStore.getState().addToast({
      type: 'warning',
      title: 'Warn',
      message: 'Careful',
      durationMs: 3000,
    })

    // durationMs triggers dismissToast → phase: exiting
    vi.advanceTimersByTime(3000)
    expect(useToastStore.getState().toasts[0].phase).toBe('exiting')

    // 300ms later, removeToast removes it
    vi.advanceTimersByTime(300)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('dismissToast sets phase to exiting then removes', () => {
    useToastStore.getState().addToast({
      type: 'error',
      title: 'Err',
      message: 'Fail',
      durationMs: 10000,
    })

    const id = useToastStore.getState().toasts[0].id
    useToastStore.getState().dismissToast(id)

    expect(useToastStore.getState().toasts[0].phase).toBe('exiting')

    vi.advanceTimersByTime(300)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('removeToast removes immediately', () => {
    useToastStore.getState().addToast({
      type: 'info',
      title: 'X',
      message: 'Y',
      durationMs: 5000,
    })

    const id = useToastStore.getState().toasts[0].id
    useToastStore.getState().removeToast(id)

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
