import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ComponentPropsWithRef, type ReactNode } from 'react'

import { MoonIcon, SunIcon } from './icons'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
export { cx }

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-paper hover:opacity-90 disabled:opacity-40',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-sunken disabled:opacity-50',
  ghost: 'text-muted hover:text-ink hover:bg-sunken disabled:opacity-40',
  danger: 'bg-danger text-paper hover:opacity-90 disabled:opacity-40',
}

export function Button({
  variant = 'secondary',
  className,
  busy,
  children,
  ...props
}: ComponentPropsWithRef<'button'> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={cx(
        'inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed',
        variants[variant],
        className,
      )}
    >
      {busy && <Spinner size={14} />}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cx(
        'inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cx('animate-spin', className)}
      role="status"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/** Small anchored dropdown menu. Closes on outside click and Escape. */
export function Menu({
  trigger,
  items,
  align = 'right',
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode
  items: { label: string; onSelect: () => void; danger?: boolean }[]
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div
          role="menu"
          className={cx(
            'absolute top-full z-30 mt-1 min-w-36 rounded-md border border-line bg-surface p-1 shadow-[0_6px_24px_-8px_rgba(20,25,35,0.25)]',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                item.onSelect()
              }}
              className={cx(
                'block w-full rounded px-2.5 py-1.5 text-left text-sm hover:bg-sunken',
                item.danger ? 'text-danger' : 'text-ink',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type Theme = 'light' | 'dark'

function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme
  if (set === 'light' || set === 'dark') return set
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme)
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  return (
    <IconButton
      label={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.dataset.theme = next
        try {
          localStorage.setItem('folio-theme', next)
        } catch {
          /* storage unavailable: theme still applies for this visit */
        }
        setTheme(next)
      }}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </IconButton>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx('font-serif text-xl font-semibold tracking-tight text-ink', className)}>
      <span className="bg-[linear-gradient(transparent_58%,var(--highlight)_58%,var(--highlight)_88%,transparent_88%)] px-0.5">
        Folio
      </span>
    </span>
  )
}
