import { useUiStore } from '../stores/ui-store'

export function ConfirmDialog() {
  const { confirmDialog, hideConfirm } = useUiStore()
  const { open, title, message, onConfirm } = confirmDialog

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-50" onClick={hideConfirm} />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-popover border border-border rounded-lg shadow-xl w-full max-w-[400px] p-6">
          <h2 className="text-lg font-semibold text-foreground mb-2">{title}</h2>
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
