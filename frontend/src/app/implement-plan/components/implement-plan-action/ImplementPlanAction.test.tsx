import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ImplementPlanMother } from '__scenarios__/ImplementPlanMother'
import { ImplementPlanAction } from './ImplementPlanAction'

const IMPLEMENT_BUTTON = { name: 'Implementar plan' }

describe('ImplementPlanAction', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should notify its parent once only after the implementation is accepted', async () => {
    let answer: (response: Response) => void = () => undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve
          }),
      ),
    )
    const onImplementationStarted = vi.fn()
    const user = userEvent.setup()
    render(<ImplementPlanAction plan={ImplementPlanMother.plan()} onImplementationStarted={onImplementationStarted} />)

    await user.click(screen.getByRole('button', IMPLEMENT_BUTTON))

    expect(onImplementationStarted).not.toHaveBeenCalled()
    answer(new Response(ImplementPlanMother.implementing().body, { status: 202 }))
    expect(await screen.findByText('Implementación en curso')).toBeInTheDocument()
    expect(onImplementationStarted).toHaveBeenCalledTimes(1)
  })

  it('should present an accepted implementation as active information', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(ImplementPlanMother.implementing().body, { status: 202 })))
    const user = userEvent.setup()
    render(<ImplementPlanAction plan={ImplementPlanMother.plan()} onImplementationStarted={vi.fn()} />)

    await user.click(screen.getByRole('button', IMPLEMENT_BUTTON))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Información: Implementación en curso')
    expect(status).toHaveTextContent(ImplementPlanMother.AGENT)
  })

  it('should not notify its parent when the backend refuses the implementation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(ImplementPlanMother.agentNotResumed().body, { status: 503 })))
    const onImplementationStarted = vi.fn()
    const user = userEvent.setup()
    render(<ImplementPlanAction plan={ImplementPlanMother.plan()} onImplementationStarted={onImplementationStarted} />)

    await user.click(screen.getByRole('button', IMPLEMENT_BUTTON))

    expect(await screen.findByRole('alert')).toHaveTextContent('could not implement the plan: cmux send failed: no such workspace')
    expect(onImplementationStarted).not.toHaveBeenCalled()
  })

  it('should not notify its parent when the backend is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const onImplementationStarted = vi.fn()
    const user = userEvent.setup()
    render(<ImplementPlanAction plan={ImplementPlanMother.plan()} onImplementationStarted={onImplementationStarted} />)

    await user.click(screen.getByRole('button', IMPLEMENT_BUTTON))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
    expect(onImplementationStarted).not.toHaveBeenCalled()
  })
})
