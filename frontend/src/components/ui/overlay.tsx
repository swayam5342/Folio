import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

import { Button, cx } from './primitives'

// --- Toasts -------------------------------------------------------------

type Toast = { id: number; message: string; tone: 'info' | 'error' }
type ToastFn = (message: string, tone?: Toast['tone']) => void

const ToastContext = createContext<ToastFn>(() => {})
export const useToast = () => useContext(ToastContext)

// --- Confirm dialog -----------------------------------------------------

type ConfirmOptions = { title: string; body?: string; confirmLabel: string; danger?: boolean }
type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn>(async () => false)
export const useConfirm = () => useContext(ConfirmContext)

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const toast = useCallback<ToastFn>((message, tone = 'info') => {
    const id = nextId.current++
    setToasts((t) => [...t.slice(-3), { id, message, tone }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500)
  }, [])

  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)
  const confirm = useCallback<ConfirmFn>(
    (options) => new Promise((resolve) => setDialog({ ...options, resolve })),
    [],
  )
  const close = (ok: boolean) => {
    dialog?.resolve(ok)
    setDialog(null)
  }

  return (
    <ToastContext.Provider value={toast}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        <div
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className={cx(
                'pointer-events-auto max-w-md rounded-md px-4 py-2.5 text-sm shadow-[0_8px_30px_-10px_rgba(20,25,35,0.35)]',
                t.tone === 'error' ? 'bg-danger text-paper' : 'bg-ink text-paper',
              )}
            >
              {t.message}
            </div>
          ))}
        </div>
        {dialog && <ConfirmDialog {...dialog} onClose={close} />}
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  )
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onClose,
}: ConfirmOptions & { onClose: (ok: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(20,23,29,0.45)] px-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-sm rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="confirm-title" className="font-serif text-lg font-semibold">
          {title}
        </h2>
        {body && <p className="mt-1.5 text-sm text-muted">{body}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button ref={confirmRef} variant={danger ? 'danger' : 'primary'} onClick={() => onClose(true)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
