import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router'

import { setUnauthorizedHandler } from './api/client'
import { keys, useMe } from './api/queries'
import { Spinner } from './components/ui/primitives'
import LoginPage from './pages/LoginPage'
import NotebooksPage from './pages/NotebooksPage'
import WorkspacePage from './pages/WorkspacePage'

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

const router = createBrowserRouter([
  { element: <GuestOnly />, children: [{ path: '/login', element: <LoginPage /> }] },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <NotebooksPage /> },
      { path: '/notebooks/:notebookId', element: <WorkspacePage /> },
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
