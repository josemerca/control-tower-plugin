import { screen } from '@testing-library/react'
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

  it('should say the plan is ready and stop listening', async () => {
    await planStarted()

    await streamFrame(PlanEventsMother.writing())
    await streamFrame(PlanEventsMother.ready())

    expect(screen.getByText('Plan listo')).toHaveAttribute('role', 'status')
    expect(screen.getByText('Plan listo')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('button', { name: /Plan Completado/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /Implementación Activo/ })).toHaveAttribute('aria-expanded', 'true')
    expect(FakeEventSource.last().closes).toBe(1)
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

  it('should ignore the connection error the browser fires once the plan is ready', async () => {
    await planStarted()

    await streamFrame(PlanEventsMother.ready())
    await dropStream()

    expect(screen.getByRole('button', { name: /Plan Completado/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(FakeEventSource.last().closes).toBe(1)
  })

  it('should close the stream when the page goes away', async () => {
    const { unmount } = await planStarted()

    unmount()

    expect(FakeEventSource.last().closes).toBe(1)
  })
})
