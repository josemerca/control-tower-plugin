import { screen, waitFor } from '@testing-library/react'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { WorkflowSnapshotStorage } from 'app/workflow-snapshot/storage'
import {
  backendAnswering,
  backendPending,
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

  it('should keep the active request expanded when its header is clicked', async () => {
    const { user } = openHome()

    await user.click(screen.getByRole('button', { name: /Solicitud Activo/ }))

    expect(screen.getByRole('button', { name: /Solicitud Activo/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Solicitud Activo/ })).toHaveAttribute('aria-disabled', 'true')
  })

  it('should show the plan the backend started with a link to its issue', async () => {
    backendAnswering(StartPlanMother.started())
    const { user } = openHome()

    await startPlan(user)

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Plan arrancado')
    expect(screen.getByLabelText('Progreso del plan')).toHaveTextContent(StartPlanMother.AGENT)
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

    expect(await screen.findByRole('alert')).toHaveTextContent('cmux is not reachable')
  })

  it('should keep the form unlocked after a backend refusal', async () => {
    backendAnswering(StartPlanMother.planNotStarted())
    const { user } = openHome()

    await startPlan(user)

    await screen.findByRole('alert')
    expect(screen.getByLabelText('Clave del ticket')).toBeEnabled()
    expect(screen.getByLabelText('Repositorio')).toBeEnabled()
    expect(screen.getByLabelText('Ruta local')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeEnabled()
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

  it('should restore a matching plan on retry without another start request', async () => {
    const active = {
      phase: 'planning',
      request: { id: StartPlanMother.TICKET, repo: StartPlanMother.REPO, path: StartPlanMother.PATH },
      plan: {
        id: StartPlanMother.TICKET,
        repo: StartPlanMother.REPO,
        issue: StartPlanMother.ISSUE,
        agent: StartPlanMother.AGENT,
        branch: StartPlanMother.BRANCH,
        worktree: StartPlanMother.WORKTREE,
      },
    }
    const fetching = vi.fn()
      .mockResolvedValueOnce(new Response('{"plans":[]}', { status: 200 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('{"plans":[]}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ plans: [active] }), { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const { user } = openHome()
    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    await startPlan(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se puede confirmar si el plan arrancó')
    await user.click(screen.getByRole('button', { name: 'Reintentar recuperación' }))

    expect(await screen.findByText('Plan arrancado')).toBeInTheDocument()
    expect(fetching.mock.calls.filter(([input]) => input === '/start-plan')).toHaveLength(1)
    expect(fetching.mock.calls.filter(([input]) => input === '/active-plans')).toHaveLength(3)
  })

  it('should block a duplicate start while lost-response recovery is unavailable', async () => {
    const fetching = vi.fn()
      .mockResolvedValueOnce(new Response('{"plans":[]}', { status: 200 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
    vi.stubGlobal('fetch', fetching)
    const { user } = openHome()
    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    await startPlan(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo comprobar el estado del plan')
    expect(screen.queryByRole('button', { name: 'Arrancar plan' })).toBeNull()
    expect(fetching.mock.calls.filter(([input]) => input === '/start-plan')).toHaveLength(1)
  })

  it('should keep the form blocked when lost-response recovery finds no matching plan', async () => {
    const fetching = vi.fn()
      .mockResolvedValueOnce(new Response('{"plans":[]}', { status: 200 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('{"plans":[]}', { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const { user } = openHome()
    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    await startPlan(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('La solicitud puede completarse más tarde')
    expect(screen.queryByRole('button', { name: 'Arrancar plan' })).toBeNull()
    expect(screen.getByText('Ruta local').parentElement).toHaveTextContent(StartPlanMother.PATH)
    expect(fetching.mock.calls.filter(([input]) => input === '/start-plan')).toHaveLength(1)
  })

  it('should remain blocked when repeated recovery finds no matching plan', async () => {
    const fetching = vi.fn()
      .mockResolvedValueOnce(new Response('{"plans":[]}', { status: 200 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('{"plans":[]}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"plans":[]}', { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const { user } = openHome()
    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    await startPlan(user)
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Reintentar recuperación' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se puede confirmar si el plan arrancó')
    expect(screen.queryByRole('button', { name: 'Arrancar plan' })).toBeNull()
    expect(fetching.mock.calls.filter(([input]) => input === '/start-plan')).toHaveLength(1)
    expect(fetching.mock.calls.filter(([input]) => input === '/active-plans')).toHaveLength(3)
  })

  it('should discard an uncertain start and clear its pending request', async () => {
    const fetching = vi.fn()
      .mockResolvedValueOnce(new Response('{"plans":[]}', { status: 200 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('{"plans":[]}', { status: 200 }))
    vi.stubGlobal('fetch', fetching)
    const { user } = openHome()
    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    await startPlan(user)
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Descartar estado' }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('Clave del ticket')).toBeEnabled()
    expect(screen.getByLabelText('Clave del ticket')).toHaveValue('')
    expect(screen.getByLabelText('Repositorio')).toHaveValue('')
    expect(screen.getByLabelText('Ruta local')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
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
    expect(WorkflowSnapshotStorage.load()?.request).toEqual({
      id: StartPlanMother.TICKET,
      repo: StartPlanMother.REPO,
      path: StartPlanMother.PATH,
    })
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

    expect(await screen.findByRole('alert')).toHaveTextContent('owner/name: /repo holds someone/else')
  })

  it('should show the branch and the worktree the backend started', async () => {
    backendAnswering(StartPlanMother.started())
    const { user } = openHome()

    await startPlan(user)

    await screen.findByRole('status')
    expect(screen.getByLabelText('Progreso del plan')).toHaveTextContent(StartPlanMother.BRANCH)
    expect(screen.getByLabelText('Progreso del plan')).toHaveTextContent(StartPlanMother.WORKTREE)
  })

  it('should show a compact read-only request summary when the completed request reopens', async () => {
    backendAnswering(StartPlanMother.started())
    const { user } = openHome()

    await startPlan(user)

    await screen.findByRole('status')
    await user.click(screen.getByRole('button', { name: /Solicitud Completado/ }))
    expect(screen.getByText('Ticket').parentElement).toHaveTextContent(StartPlanMother.TICKET)
    expect(screen.getByText('Repositorio').parentElement).toHaveTextContent(StartPlanMother.REPO)
    expect(screen.getByText('Ruta local').parentElement).toHaveTextContent(StartPlanMother.PATH)
  })

  it('should prevent duplicate plan starts after a plan starts', async () => {
    backendAnswering(StartPlanMother.started())
    const { user } = openHome()

    await startPlan(user)

    await screen.findByRole('status')
    expect(screen.queryByRole('button', { name: 'Arrancar plan' })).toBeNull()
    expect(screen.getByRole('button', { name: /Solicitud Completado/ })).toBeEnabled()
  })

  it('should prevent duplicate plan starts while a request is in flight', async () => {
    const backend = backendPending()
    const { user } = openHome()
    await typeTicket(user, StartPlanMother.TICKET)
    await typeRepository(user, StartPlanMother.REPO)
    await typePath(user, StartPlanMother.PATH)

    await user.dblClick(screen.getByRole('button', { name: 'Arrancar plan' }))

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    await backend.answerWith(StartPlanMother.started())
  })
})
