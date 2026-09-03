import { screen } from '@testing-library/react'
import { ImplementPlanMother } from '__scenarios__/ImplementPlanMother'
import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { backendAnswering, backendPending, backendUnreachable, openHome, startPlan, streamFrame } from './helpers'

const IMPLEMENT_BUTTON = { name: 'Implementar plan' }

describe('Home · implement plan', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const planStarted = async () => {
    backendAnswering(StartPlanMother.started())
    const opened = openHome()
    await startPlan(opened.user)
    await screen.findByRole('status')

    return opened
  }

  const planReady = async () => {
    const opened = await planStarted()
    await streamFrame(PlanEventsMother.ready())

    return opened
  }

  const pressImplement = async (user: Awaited<ReturnType<typeof planReady>>['user']) => {
    await user.click(screen.getByRole('button', IMPLEMENT_BUTTON))
  }

  it('should offer to implement the plan only once it is ready', async () => {
    await planStarted()

    await streamFrame(PlanEventsMother.writing())
    expect(screen.queryByRole('button', IMPLEMENT_BUTTON)).toBeNull()

    await streamFrame(PlanEventsMother.ready())
    expect(screen.getByRole('button', IMPLEMENT_BUTTON)).toBeEnabled()
  })

  it('should send exactly the payload the backend contract declares', async () => {
    const { user } = await planReady()
    const fetching = backendAnswering(ImplementPlanMother.implementing())

    await pressImplement(user)

    await screen.findByText('Implementación arrancada')
    expect(fetching).toHaveBeenCalledTimes(1)
    const [url, init] = fetching.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/implement-plan')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init.body).toBe(ImplementPlanMother.REQUEST_BODY)
  })

  it('should say the implementation started and name the agent', async () => {
    const { user } = await planReady()
    backendAnswering(ImplementPlanMother.implementing())

    await pressImplement(user)

    const started = await screen.findByText('Implementación arrancada')
    const status = started.closest('[role="status"]')
    expect(status).not.toBeNull()
    expect(status).toHaveTextContent(ImplementPlanMother.AGENT)
    expect(screen.queryByRole('button', IMPLEMENT_BUTTON)).toBeNull()
  })

  it('should show the backend refusal text as it came and keep offering the button', async () => {
    const { user } = await planReady()
    backendAnswering(ImplementPlanMother.agentNotResumed())

    await pressImplement(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not implement the plan: cmux send failed: no such workspace',
    )
    expect(screen.getByRole('button', IMPLEMENT_BUTTON)).toBeEnabled()
  })

  it('should say the backend is unreachable when the network fails', async () => {
    const { user } = await planReady()
    backendUnreachable()

    await pressImplement(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
    expect(screen.getByRole('button', IMPLEMENT_BUTTON)).toBeEnabled()
  })

  it('should keep the button disabled while the request is in flight', async () => {
    const { user } = await planReady()
    const backend = backendPending()

    await pressImplement(user)

    expect(screen.getByRole('button', IMPLEMENT_BUTTON)).toBeDisabled()
    await backend.answerWith(ImplementPlanMother.implementing())
    expect(await screen.findByText('Implementación arrancada')).toBeInTheDocument()
  })
})
