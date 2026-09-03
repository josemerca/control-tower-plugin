import { act, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { Home } from 'pages/home/Home'
import { FakeEventSource } from './FakeEventSource'

type Answer = { status: number; body: string }
type User = ReturnType<typeof userEvent.setup>

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
  FakeEventSource.install()
  const { unmount } = render(<Home />)

  return { user: userEvent.setup(), unmount }
}

const typeTicket = async (user: User, ticket: string) => {
  await user.type(screen.getByLabelText('Clave del ticket'), ticket)
}

const typeRepository = async (user: User, repository: string) => {
  await user.type(screen.getByLabelText('Repositorio'), repository)
}

const pressStart = async (user: User) => {
  await user.click(screen.getByRole('button', { name: 'Arrancar plan' }))
}

const startPlan = async (user: User) => {
  await typeTicket(user, StartPlanMother.TICKET)
  await typeRepository(user, StartPlanMother.REPO)
  await pressStart(user)
}

const streamFrame = async (data: string) => {
  await act(async () => FakeEventSource.last().receive(data))
}

const streamFailure = async (data: string) => {
  await act(async () => FakeEventSource.last().failWith(data))
}

const dropStream = async () => {
  await act(async () => FakeEventSource.last().dropConnection())
}

export {
  backendAnswering,
  backendUnreachable,
  openHome,
  typeTicket,
  typeRepository,
  pressStart,
  startPlan,
  streamFrame,
  streamFailure,
  dropStream,
}
