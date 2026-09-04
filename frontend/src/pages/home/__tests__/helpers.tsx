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

const backendPending = () => {
  let answerWith: (answer: Answer) => void = () => undefined
  const pending = new Promise<Response>((resolve) => {
    answerWith = (answer) => resolve(new Response(answer.body, { status: answer.status, headers: JSON_HEADERS }))
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(() => pending),
  )

  return { answerWith: async (answer: Answer) => act(async () => answerWith(answer)) }
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

const typeRoot = async (user: User, root: string) => {
  await user.type(screen.getByLabelText('Ruta del clon local'), root)
}

const pressStart = async (user: User) => {
  await user.click(screen.getByRole('button', { name: 'Arrancar plan' }))
}

const startPlan = async (user: User) => {
  await typeTicket(user, StartPlanMother.TICKET)
  await typeRepository(user, StartPlanMother.REPO)
  await typeRoot(user, StartPlanMother.ROOT)
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
  backendPending,
  backendUnreachable,
  openHome,
  typeTicket,
  typeRepository,
  typeRoot,
  pressStart,
  startPlan,
  streamFrame,
  streamFailure,
  dropStream,
}
