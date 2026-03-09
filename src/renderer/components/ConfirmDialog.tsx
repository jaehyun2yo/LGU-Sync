import { useEffect, useRef } from 'react'
import { useUiStore } from '../stores/ui-store'

export function ConfirmDialog() {
  const { confirmDialog, hideConfirm } = useUiStore()
  const { open, title, message, onConfirm } = confirmDialog
  const dialogRef = useRef<HTMLDivElement>(null)

  // Focus trap and Escape key
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hideConfirm()
        return
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        const first = focusable[0]
        const last = focusable[focusable.length - 1]

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault()
            last?.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first?.focus()
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    // Auto-focus the cancel button
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button')
    focusable?.[0]?.focus()

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, hideConfirm])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-50" onClick={hideConfirm} />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          className="bg-popover border border-border rounded-lg shadow-xl w-full max-w-[400px] p-6"
        >
          <h2 id="confirm-dialog-title" className="text-lg font-semibold text-foreground mb-2">{title}</h2>
          <p className="text-sm text-muted-foreground mb-6">{message}</p>
          <div className="flex justify-end gap-2">
            <button
              onClick={hideConfirm}
              className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent text-foreground transition-colors"
            >
              취소
            </button>
            <button
              onClick={() => {
                onConfirm?.()
                hideConfirm()
              }}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-colors"
            >
              확인
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
