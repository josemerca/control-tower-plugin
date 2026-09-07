import { screen } from '@testing-library/react'
import { ImplementPlanMother } from '__scenarios__/ImplementPlanMother'
import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { FakeEventSource } from './FakeEventSource'
import {
  backendAnswering,
  dropStream,
  openHome,
  startPlan,
  streamFailure,
  streamFrame,
} from './helpers'

describe('Home · plan events', () => {
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

  const implementationStarted = async () => {
    const opened = await planStarted()
    await streamFrame(PlanEventsMother.writing())
    await streamFrame(PlanEventsMother.ready())
    backendAnswering(ImplementPlanMother.implementing())
    await opened.user.click(screen.getByRole('button', { name: 'Implementar plan' }))

    return opened
  }

  it('should watch the issue the backend opened', async () => {
    await planStarted()

    expect(FakeEventSource.last().url).toBe(PlanEventsMother.PATH)
  })

  it('should close the active plan when reopening the completed request', async () => {
    const { user } = await planStarted()

    await user.click(screen.getByRole('button', { name: /Solicitud Completado/ }))

    expect(screen.getByRole('button', { name: /Solicitud Completado/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Plan Activo/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('should say the plan is being written when the first frame arrives', async () => {
    await planStarted()

    await streamFrame(PlanEventsMother.writing())

    expect(screen.getByRole('status')).toHaveTextContent('Escribiendo el plan…')
  })

  it('should say the plan is ready', async () => {
    await planStarted()

    await streamFrame(PlanEventsMother.writing())
    await streamFrame(PlanEventsMother.ready())

    expect(screen.getByText('Plan listo')).toHaveAttribute('role', 'status')
    expect(screen.getByText('Plan listo')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('button', { name: /Plan Completado/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /Implementación Activo/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('should show the backend failure text as it came and stop listening', async () => {
    await planStarted()

    await streamFailure(PlanEventsMother.unreadable())

    expect(screen.getByRole('alert')).toHaveTextContent('git status could not say whether the plan is committed')
    expect(FakeEventSource.last().closes).toBe(1)
  })

  it('should say the backend is unreachable when the stream fails before any frame', async () => {
    await planStarted()

    await dropStream()

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
    expect(FakeEventSource.last().closes).toBe(1)
  })

  it('should close the stream when the page goes away', async () => {
    const { unmount } = await planStarted()

    unmount()

    expect(FakeEventSource.last().closes).toBe(1)
  })

  it('should complete the implementation step once the backend accepts it', async () => {
    await implementationStarted()

    expect(await screen.findByRole('button', { name: /Implementación Completado/ })).toBeInTheDocument()
  })

  it('should focus the review step once implementation starts', async () => {
    await implementationStarted()

    expect(await screen.findByRole('button', { name: /Revisión Activo/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('should offer to start another plan as soon as implementation starts', async () => {
    await implementationStarted()

    expect(await screen.findByRole('button', { name: 'Arrancar otro plan' })).toBeInTheDocument()
  })

  it('should say the agent is implementing while there is no pull request yet', async () => {
    await implementationStarted()

    await streamFrame(PlanEventsMother.implementing())

    expect(screen.getByRole('status')).toHaveTextContent('Implementando…')
  })

  it('should link the pull request once it is open and waiting for a review', async () => {
    await implementationStarted()

    await streamFrame(PlanEventsMother.inReview())

    expect(screen.getByRole('link', { name: 'Pull request #42' }))
      .toHaveAttribute('href', PlanEventsMother.PULL_REQUEST.url)
    expect(screen.getByRole('button', { name: /Revisión Activo/ })).toBeInTheDocument()
  })

  it('should say it is fixing what the review asked for', async () => {
    await implementationStarted()

    await streamFrame(PlanEventsMother.inReview())
    await streamFrame(PlanEventsMother.fixing())

    expect(screen.getByRole('status')).toHaveTextContent('Corrigiendo lo pedido…')
  })

  it('should go back to waiting for a review once the fixes are released', async () => {
    await implementationStarted()

    await streamFrame(PlanEventsMother.fixing())
    await streamFrame(PlanEventsMother.inReview())

    const link = screen.getByRole('link', { name: 'Pull request #42' })
    expect(link.parentElement).toHaveTextContent('Pull request #42 en revisión')
  })

  it('should say so when the delivery cannot be read', async () => {
    await implementationStarted()

    await streamFailure(PlanEventsMother.deliveryUnreadable())

    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 502')
  })

  it('should say the backend is unreachable when the connection drops during delivery', async () => {
    await implementationStarted()

    await streamFrame(PlanEventsMother.implementing())
    await dropStream()

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
  })

  it('should watch the issue through a single subscription however many steps read it', async () => {
    await implementationStarted()

    await streamFrame(PlanEventsMother.inReview())

    expect(FakeEventSource.opened).toHaveLength(1)
  })
})
