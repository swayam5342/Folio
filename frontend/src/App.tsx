import { useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router'

import { setUnauthorizedHandler } from './api/client'
import { keys, useMe } from './api/queries'
import { Spinner } from './components/ui/primitives'
import LoginPage from './pages/LoginPage'
import NotebooksPage from './pages/NotebooksPage'

// The workspace (markdown rendering, PDF viewer) loads only when a notebook is opened.
const WorkspacePage = lazy(() => import('./pages/WorkspacePage'))

function FullPageSpinner() {
  return (
    <div className="flex h-full items-center justify-center text-muted">
      <Spinner size={22} />
    </div>
  )
}

function RequireAuth() {
  const me = useMe()
  const location = useLocation()
  if (me.isPending) return <FullPageSpinner />
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

function GuestOnly() {
  const me = useMe()
  if (me.isPending) return <FullPageSpinner />
  if (me.data) return <Navigate to="/" replace />
  return <Outlet />
}

function RouteError() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="font-serif text-2xl font-semibold">Something went wrong on this page</h1>
      <p className="mt-2 text-muted">Reload to try again. Your notebooks and sources are saved.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 font-medium underline underline-offset-4"
      >
        Reload
      </button>
    </div>
  )
}

const router = createBrowserRouter([
  { element: <GuestOnly />, errorElement: <RouteError />, children: [{ path: '/login', element: <LoginPage /> }] },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <NotebooksPage /> },
      {
        path: '/notebooks/:notebookId',
        element: (
          <Suspense fallback={<FullPageSpinner />}>
            <WorkspacePage />
          </Suspense>
        ),
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default function App() {
  const qc = useQueryClient()
  useEffect(() => {
    // Session expired mid-use: drop cached data; RequireAuth then redirects to /login.
    setUnauthorizedHandler(() => {
      qc.clear()
      qc.setQueryData(keys.me, null)
    })
  }, [qc])
  return <RouterProvider router={router} />
}
