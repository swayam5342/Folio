import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'

import { useLogout, useMe } from '../api/queries'
import { Menu, ThemeToggle, Wordmark } from './ui/primitives'

export default function AppHeader({ children }: { children?: ReactNode }) {
  const user = useMe().data
  const logout = useLogout()
  const navigate = useNavigate()

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-paper px-4 sm:px-5">
      <Link to="/" className="shrink-0 rounded" aria-label="Folio home">
        <Wordmark />
      </Link>
      <div className="min-w-0 flex-1">{children}</div>
      <ThemeToggle />
      {user && (
        <Menu
          trigger={(props) => (
            <button
              type="button"
              {...props}
              className="flex h-8 items-center gap-2 rounded-md pl-1 pr-2 text-sm text-muted hover:bg-sunken hover:text-ink"
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-ink text-xs font-semibold text-paper">
                {user.username[0].toUpperCase()}
              </span>
              <span className="hidden sm:inline">{user.username}</span>
            </button>
          )}
          items={[
            {
              label: 'Sign out',
              onSelect: () => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) }),
            },
          ]}
        />
      )}
    </header>
  )
}
