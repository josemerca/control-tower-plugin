import { render, screen } from '@testing-library/react'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { ImplementProgress } from './ImplementProgress'

const answerWith = (answer: { status: number; body: string }) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))
}

const renderProgress = () => render(<ImplementProgress issue={ImplementProgressMother.ISSUE} root={ImplementProgressMother.ROOT} repo={ImplementProgressMother.REPO} />)

describe('ImplementProgress', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should show the task, the total tasks, the task name and the attempt of a run in progress', async () => {
    answerWith(ImplementProgressMother.progress())

    renderProgress()

    const status = await screen.findByText(/Tarea 3 de 7/)
    expect(status).toHaveAttribute('role', 'status')
    expect(status).toHaveTextContent('el lector del plan')
    expect(status).toHaveTextContent('Intento 2')
  })

  it('should show a task without a name instead of the word null', async () => {
    answerWith(ImplementProgressMother.withoutTaskName())

    renderProgress()

    const status = await screen.findByText(/Tarea 1 de 8/)
    expect(status).not.toHaveTextContent('null')
  })

  it('should link the pull request a review step is waiting on so a person can reach it', async () => {
    answerWith(ImplementProgressMother.inReview())

    renderProgress()

    const link = await screen.findByRole('link', { name: 'Ver la pull request #31' })
    expect(link).toHaveAttribute('href', 'https://github.com/owner/name/pull/31')
  })

  it('should link no pull request while the run is still implementing', async () => {
    answerWith(ImplementProgressMother.progress())

    renderProgress()

    await screen.findByText(/Tarea 3 de 7/)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('should show a worktree without a run yet as a wait, not an error', async () => {
    answerWith(ImplementProgressMother.notRead())

    renderProgress()

    expect(await screen.findByText('Esperando a que arranque la implementación…')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('should show a real refusal as an error with the backend text', async () => {
    answerWith(ImplementProgressMother.malformedRoot())

    renderProgress()

    expect(await screen.findByRole('alert')).toHaveTextContent(ImplementProgressMother.MALFORMED_ROOT_DETAIL)
  })

  it('should say the backend is unreachable when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    renderProgress()

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
  })

  it('should name the review the delivered plan is standing in', async () => {
    answerWith(ImplementProgressMother.inReview())

    renderProgress()

    expect(await screen.findByText(/En revisión/)).toHaveAttribute('role', 'status')
  })

  it('should name the work of fixing what the review asked for', async () => {
    answerWith(ImplementProgressMother.fixing())

    renderProgress()

    expect(await screen.findByText(/Corrigiendo lo pedido en la revisión/)).toHaveAttribute('role', 'status')
  })
})
