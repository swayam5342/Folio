import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { ApiError } from '../api/client'
import { useLogin, useRegister } from '../api/queries'
import { Button, ThemeToggle, Wordmark, cx } from '../components/ui/primitives'

type Mode = 'signin' | 'register'

function Field({
  id,
  label,
  hint,
  error,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; hint?: string; error?: string }) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        {...input}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        className={cx(
          'mt-1.5 h-10 w-full rounded-md border bg-surface px-3 text-[15px] outline-none transition-colors placeholder:text-faint focus:border-ink',
          error ? 'border-danger' : 'border-line-strong',
        )}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1.5 text-sm text-faint">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

/** The product, shown rather than described: a cited answer as it appears in a notebook. */
function SampleAnswer() {
  return (
    <figure className="max-w-md">
      <p className="text-sm text-muted">You asked: What did the 2023 audit find about vendor payments?</p>
      <blockquote className="mt-4 font-serif text-[1.35rem] leading-[1.55] text-ink">
        The audit found that 14% of vendor payments lacked a signed purchase order
        <Chip n={1} />, and recommended a two-person approval for invoices above ₹5 lakh
        <Chip n={2} />.
      </blockquote>
      <figcaption className="mt-6 space-y-2 border-t border-line pt-4 text-sm">
        <p className="flex gap-3">
          <Chip n={1} static />
          <span className="text-muted">audit-report-2023.pdf, page 12</span>
        </p>
        <p className="flex gap-3">
          <Chip n={2} static />
          <span className="text-muted">audit-report-2023.pdf, page 31</span>
        </p>
      </figcaption>
    </figure>
  )
}

function Chip({ n, static: isStatic }: { n: number; static?: boolean }) {
  return (
    <span
      className={cx(
        'hl-mark inline-flex h-[1.35em] min-w-[1.6em] items-center justify-center rounded-sm px-1 align-[0.1em] font-sans text-[0.62em] font-semibold',
        !isStatic && 'ml-1',
      )}
    >
      {n}
    </span>
  )
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const login = useLogin()
  const register = useRegister()
  const navigate = useNavigate()
  const location = useLocation()
  const mutation = mode === 'signin' ? login : register

  const error = mutation.error instanceof ApiError ? mutation.error : null
  const friendly = {
    username: 'Use 3–32 characters: letters, numbers, or _',
    password: 'Use at least 8 characters',
  }
  const fieldError = (field: 'username' | 'password') =>
    error?.status === 422 && error.message.startsWith(field) ? friendly[field] : undefined
  const formError = error && !fieldError('username') && !fieldError('password') ? error.message : undefined

  const submit = (e: FormEvent) => {
    e.preventDefault()
    mutation.mutate(
      { username, password },
      {
        onSuccess: () => {
          const from = (location.state as { from?: string } | null)?.from
          navigate(from && from !== '/login' ? from : '/', { replace: true })
        },
      },
    )
  }

  const switchMode = () => {
    login.reset()
    register.reset()
    setMode((m) => (m === 'signin' ? 'register' : 'signin'))
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between border-r border-line px-14 py-12 lg:flex">
        <Wordmark className="text-2xl" />
        <SampleAnswer />
        <p className="max-w-sm text-sm text-muted">
          Upload PDFs, ask questions, and every answer points to the page it came from.
        </p>
      </section>

      <section className="flex flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end">
          <Wordmark className="lg:hidden" />
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            {mode === 'signin' ? 'Sign in to Folio' : 'Create your account'}
          </h1>
          <p className="mt-2 text-muted">
            {mode === 'signin'
              ? 'Pick up where you left off in your notebooks.'
              : 'Your notebooks and sources stay private to your account.'}
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            <Field
              id="username"
              label="Username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              hint={mode === 'register' ? '3–32 characters: letters, numbers, or _' : undefined}
              error={fieldError('username')}
              required
            />
            <Field
              id="password"
              label="Password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint={mode === 'register' ? 'At least 8 characters' : undefined}
              error={fieldError('password')}
              required
            />
            {formError && (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {formError}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              className="h-10 w-full"
              busy={mutation.isPending}
              disabled={!username.trim() || !password}
            >
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <p className="mt-6 text-sm text-muted">
            {mode === 'signin' ? 'New to Folio?' : 'Already have an account?'}{' '}
            <button type="button" onClick={switchMode} className="font-medium text-ink underline underline-offset-4">
              {mode === 'signin' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        </div>
      </section>
    </div>
  )
}
