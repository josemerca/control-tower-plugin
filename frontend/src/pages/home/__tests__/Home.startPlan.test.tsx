import { screen } from '@testing-library/react'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import {
  backendAnswering,
  backendUnreachable,
  openHome,
  pressStart,
  startPlan,
  typePath,
  typeRepository,
  typeTicket,
} from './helpers'

describe('Home · start plan', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should show the plan the backend started with a link to its issue', async () => {
    backendAnswering(StartPlanMother.started())
    const { user } = openHome()

    await startPlan(user)

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Plan arrancado')
    expect(status).toHaveTextContent(StartPlanMother.AGENT)
    expect(screen.getByRole('link', { name: `#${StartPlanMother.ISSUE.number}` })).toHaveAttribute(
      'href',
      StartPlanMother.ISSUE.url,
    )
  })

  it('should send exactly the payload the backend contract declares', async () => {
    const fetching = backendAnswering(StartPlanMother.started())
    const { user } = openHome()

    await startPlan(user)

    await screen.findByRole('status')
    expect(fetching).toHaveBeenCalledTimes(1)
    const [url, init] = fetching.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/start-plan')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init.body).toBe(StartPlanMother.REQUEST_BODY)
  })

  it('should show the backend refusal text as it came', async () => {
    backendAnswering(StartPlanMother.planNotStarted())
    const { user } = openHome()

    await startPlan(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('could not start the plan: cmux is not reachable')
  })

  it('should show the malformed path refusal text as it came', async () => {
    backendAnswering(StartPlanMother.malformedPath())
    const { user } = openHome()

    await startPlan(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('path must be an absolute path')
  })

  it('should say the backend is unreachable when the network fails', async () => {
    backendUnreachable()
    const { user } = openHome()

    await startPlan(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
  })

  it('should keep the start button disabled until the ticket key is well formed', async () => {
    backendAnswering(StartPlanMother.started())
    const { user } = openHome()
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, StartPlanMother.PATH)

    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    await typeTicket(user, 'abc-1')
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Clave del ticket'))
    await typeTicket(user, 'MO_SHOP-42')
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeEnabled()
  })

  it('should keep the start button disabled until the repository is well formed', async () => {
    backendAnswering(StartPlanMother.started())
    const { user } = openHome()
    await typeTicket(user, StartPlanMother.TICKET)
    await typePath(user, StartPlanMother.PATH)

    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    await typeRepository(user, 'name')
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Repositorio'))
    await typeRepository(user, 'owner/name')
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeEnabled()
  })

  it('should keep the start button disabled until the local path is well formed', async () => {
    backendAnswering(StartPlanMother.started())
    const { user } = openHome()
    await typeTicket(user, StartPlanMother.TICKET)
    await typeRepository(user, StartPlanMother.REPO)

    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    await typePath(user, '   ')
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Ruta local'))
    await typePath(user, StartPlanMother.PATH)
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeEnabled()
  })

  it('should send the local path without the spaces the user left around it', async () => {
    const fetching = backendAnswering(StartPlanMother.started())
    const { user } = openHome()
    await typeTicket(user, StartPlanMother.TICKET)
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, `  ${StartPlanMother.PATH}  `)

    await pressStart(user)

    await screen.findByRole('status')
    const [, init] = fetching.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.body).toBe(StartPlanMother.REQUEST_BODY)
  })

  it('should send the local path without the trailing slash the shell adds', async () => {
    const fetching = backendAnswering(StartPlanMother.started())
    const { user } = openHome()
    await typeTicket(user, StartPlanMother.TICKET)
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, `${StartPlanMother.PATH}/`)

    await pressStart(user)

    await screen.findByRole('status')
    const [, init] = fetching.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.body).toBe(StartPlanMother.REQUEST_BODY)
  })

  it('should keep the start button disabled when the path holds an empty segment', async () => {
    backendAnswering(StartPlanMother.started())
    const { user } = openHome()
    await typeTicket(user, StartPlanMother.TICKET)
    await typeRepository(user, StartPlanMother.REPO)

    await typePath(user, '/Users/pedro//code')

    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
  })

  it('should show the refusal text as it came when the path is not a checkout of the repository', async () => {
    backendAnswering(StartPlanMother.notACheckout())
    const { user } = openHome()

    await startPlan(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'path must be a git checkout of owner/name: /repo holds someone/else',
    )
  })

  it('should show the branch and the worktree the backend started', async () => {
    backendAnswering(StartPlanMother.started())
    const { user } = openHome()

    await startPlan(user)

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(StartPlanMother.BRANCH)
    expect(status).toHaveTextContent(StartPlanMother.WORKTREE)
  })

  it('should keep all three fields filled after a plan starts', async () => {
    backendAnswering(StartPlanMother.started())
    const { user } = openHome()

    await startPlan(user)

    await screen.findByRole('status')
    expect(screen.getByLabelText('Clave del ticket')).toHaveValue(StartPlanMother.TICKET)
    expect(screen.getByLabelText('Repositorio')).toHaveValue(StartPlanMother.REPO)
    expect(screen.getByLabelText('Ruta local')).toHaveValue(StartPlanMother.PATH)
  })
})
