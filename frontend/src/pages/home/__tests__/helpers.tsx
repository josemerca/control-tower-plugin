import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Home } from 'pages/home/Home'

type Answer = { status: number; body: string }

const JSON_HEADERS = { 'Content-Type': 'application/json' }

const backendAnswering = (answer: Answer) => {
  const fetching = vi.fn(async () => new Response(answer.body, { status: answer.status, headers: JSON_HEADERS }))
  vi.stubGlobal('fetch', fetching)

  return fetching
}

const backendUnreachable = () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }),
  )
}

const openHome = () => {
  render(<Home />)

  return userEvent.setup()
}

const typeTicket = async (user: ReturnType<typeof userEvent.setup>, ticket: string) => {
  await user.type(screen.getByLabelText('Clave del ticket'), ticket)
}

const pressStart = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Arrancar plan' }))
}

export { backendAnswering, backendUnreachable, openHome, typeTicket, pressStart }
