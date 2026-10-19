import { Check, Leaf, Monitor, Moon, Sparkles, Sun, type LucideIcon } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useRef } from 'react'

import { THEMES, useTheme, type ThemePref } from '../../lib/theme'
import { cx } from './primitives'

const ICONS: Record<ThemePref, LucideIcon> = { system: Monitor, light: Sun, dark: Moon, aurora: Sparkles }

const itemClass =
  'flex cursor-default select-none items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-sm text-ink outline-none data-[highlighted]:bg-sunken'

/** Theme picker (System / Light / Dark / Aurora) plus the Calm mode switch. */
export function ThemeMenu({ className }: { className?: string }) {
  const { pref, theme, calm, setPref, setCalm } = useTheme()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const Current = ICONS[pref === 'system' ? theme : pref]

  // The reveal animation grows out of the menu button.
  const origin = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        ref={triggerRef}
        aria-label="Theme and display"
        title="Theme and display"
        className={cx(
          'inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-sunken hover:text-ink data-[state=open]:bg-sunken data-[state=open]:text-ink',
          className,
        )}
      >
        <Current size={17} strokeWidth={1.8} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="glass z-(--z-dropdown) min-w-56 rounded-[14px] p-1.5"
        >
          <DropdownMenu.Label className="px-2.5 pb-1 pt-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
            Theme
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={pref}
            onValueChange={(value) => setPref(value as ThemePref, origin())}
          >
            {THEMES.map(({ value, label, hint }) => {
              const Icon = ICONS[value]
              return (
                <DropdownMenu.RadioItem key={value} value={value} className={itemClass}>
                  <Icon size={16} strokeWidth={1.8} aria-hidden className="text-muted" />
                  <span className="flex-1">
                    {label}
                    <span className="block text-xs text-faint">{hint}</span>
                  </span>
                  <DropdownMenu.ItemIndicator>
                    <Check size={15} strokeWidth={2.2} aria-hidden className="text-accent" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              )
            })}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="mx-1 my-1.5 h-px bg-line" />
          <DropdownMenu.CheckboxItem checked={calm} onCheckedChange={setCalm} className={itemClass}>
            <Leaf size={16} strokeWidth={1.8} aria-hidden className="text-muted" />
            <span className="flex-1">
              Calm mode
              <span className="block text-xs text-faint">No grain or animation</span>
            </span>
            <DropdownMenu.ItemIndicator>
              <Check size={15} strokeWidth={2.2} aria-hidden className="text-accent" />
            </DropdownMenu.ItemIndicator>
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
