import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { Home } from 'pages/home/Home'
import { FakeEventSource } from './FakeEventSource'

type Answer = { status: number; body: string }
type User = ReturnType<typeof userEvent.setup>

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const NO_ACTIVE_PLANS = { status: 200, body: '{"plans":[]}' }

const responseFor = (answer: Answer) => new Response(answer.body, { status: answer.status, headers: JSON_HEADERS })

const backendAnswering = (answer: Answer) => {
  const fetching = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => responseFor(answer))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      input === '/active-plans' ? responseFor(NO_ACTIVE_PLANS) : fetching(input, init),
    ),
  )

  return fetching
}

const backendRecovering = (answer: Answer) => {
  const fetching = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => responseFor(answer))
  vi.stubGlobal('fetch', fetching)

  return fetching
}

const backendPending = () => {
  let answerWith: (answer: Answer) => void = () => undefined
  const pending = new Promise<Response>((resolve) => {
    answerWith = (answer) => resolve(responseFor(answer))
  })
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => input === '/active-plans' ? responseFor(NO_ACTIVE_PLANS) : pending),
  )

  return { answerWith: async (answer: Answer) => act(async () => answerWith(answer)) }
}

const backendUnreachable = () => {
  const fetching = vi.fn(async () => {
    throw new TypeError('Failed to fetch')
  })
  vi.stubGlobal(
    'fetch',
    fetching,
  )

  return fetching
}

const openHome = () => {
  FakeEventSource.install()
  const { unmount } = render(<StrictMode><Home /></StrictMode>)

  return { user: userEvent.setup(), unmount }
}

const typeTicket = async (user: User, ticket: string) => {
  await user.type(screen.getByLabelText('Clave del ticket'), ticket)
}

const typeRepository = async (user: User, repository: string) => {
  await user.type(screen.getByLabelText('Repositorio'), repository)
}

const typePath = async (user: User, path: string) => {
  await user.type(screen.getByLabelText('Ruta local'), path)
}

const pressStart = async (user: User) => {
  await user.click(screen.getByRole('button', { name: 'Arrancar plan' }))
}

const startPlan = async (user: User) => {
  await typeTicket(user, StartPlanMother.TICKET)
  await typeRepository(user, StartPlanMother.REPO)
  await typePath(user, StartPlanMother.PATH)
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
  backendRecovering,
  backendPending,
  backendUnreachable,
  openHome,
  typeTicket,
  typeRepository,
  typePath,
  pressStart,
  startPlan,
  streamFrame,
  streamFailure,
  dropStream,
}
