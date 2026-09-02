import { screen } from '@testing-library/react'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { backendAnswering, backendUnreachable, openHome, pressStart, typeTicket } from './helpers'

describe('Home · start plan', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should show the session the backend started', async () => {
    backendAnswering(StartPlanMother.started())
    const user = openHome()

    await typeTicket(user, StartPlanMother.TICKET)
    await pressStart(user)

    expect(await screen.findByRole('status')).toHaveTextContent(`Sesión arrancada: ${StartPlanMother.SESSION}`)
  })

  it('should send exactly the payload the backend contract declares', async () => {
    const fetching = backendAnswering(StartPlanMother.started())
    const user = openHome()

    await typeTicket(user, StartPlanMother.TICKET)
    await pressStart(user)

    await screen.findByRole('status')
    expect(fetching).toHaveBeenCalledTimes(1)
    const [url, init] = fetching.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/start-plan')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init.body).toBe('{"id":"ABC-123"}')
  })

  it('should show the backend refusal text as it came', async () => {
    backendAnswering(StartPlanMother.sessionNotStarted())
    const user = openHome()

    await typeTicket(user, StartPlanMother.TICKET)
    await pressStart(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not start the plan session: cmux is not reachable',
    )
  })

  it('should say the backend is unreachable when the network fails', async () => {
    backendUnreachable()
    const user = openHome()

    await typeTicket(user, StartPlanMother.TICKET)
    await pressStart(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
  })

  it('should keep the start button disabled until the ticket key is well formed', async () => {
    backendAnswering(StartPlanMother.started())
    const user = openHome()

    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    await typeTicket(user, 'abc-1')
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Clave del ticket'))
    await typeTicket(user, 'MO_SHOP-42')
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeEnabled()
  })

  it('should keep the ticket key in the field after a session starts', async () => {
    backendAnswering(StartPlanMother.started())
    const user = openHome()

    await typeTicket(user, StartPlanMother.TICKET)
    await pressStart(user)

    await screen.findByRole('status')
    expect(screen.getByLabelText('Clave del ticket')).toHaveValue(StartPlanMother.TICKET)
  })
})
