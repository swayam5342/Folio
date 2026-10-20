import { DropdownMenu } from 'radix-ui'
import type { ComponentPropsWithRef, ReactNode } from 'react'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
export { cx }

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger'

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-paper hover:opacity-90 disabled:opacity-40',
  accent: 'bg-accent text-accent-ink shadow-glow hover:brightness-110 disabled:opacity-40 disabled:shadow-none',
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
}: ComponentPropsWithRef<'button'> & { label: string }) {
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

/**
 * Small dropdown menu. Rendered in a portal (Radix) so a card's overflow or a
 * scrolling list can never clip it, and it flips upward near the screen edge.
 * `trigger` receives props to spread on the trigger element; Radix adds the
 * open/close behaviour and ARIA state itself.
 */
export function Menu({
  trigger,
  items,
  align = 'right',
}: {
  trigger: (props: { onClick?: () => void; 'aria-expanded'?: boolean; 'aria-haspopup'?: 'menu' }) => ReactNode
  items: { label: string; onSelect: () => void; danger?: boolean }[]
  align?: 'left' | 'right'
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger({})}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align === 'right' ? 'end' : 'start'}
          sideOffset={4}
          collisionPadding={8}
          onClick={(e) => e.stopPropagation()}
          className="z-(--z-dropdown) min-w-36 rounded-md border border-line bg-surface p-1 shadow-[0_6px_24px_-8px_rgba(20,25,35,0.35)]"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.label}
              onSelect={item.onSelect}
              className={cx(
                'block w-full cursor-default select-none rounded px-2.5 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-sunken',
                item.danger ? 'text-danger' : 'text-ink',
              )}
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
