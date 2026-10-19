import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'

import DesignPage from './DesignPage'

it('renders every style-guide section', () => {
  render(
    <MemoryRouter>
      <DesignPage />
    </MemoryRouter>,
  )

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Neo-maximalist research cockpit.')
  for (const name of [/Ink, paper/, /keeps its color/, /Editorial display/, /Glass, grain/, /Springs/, /parts bin/]) {
    expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
  }
})
