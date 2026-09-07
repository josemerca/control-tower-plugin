import { screen, waitFor } from '@testing-library/react'
import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { openHome, startPlan, streamFrame } from './helpers'

const IMPLEMENT_BUTTON = { name: 'Implementar plan' }
const NO_ACTIVE_PLANS = { status: 200, body: '{"plans":[]}' }
const IMPLEMENTING = { status: 202, body: '{"status":"implementing","agent":"workspace:4","issue":7}' }

const responseFor = (answer: { status: number; body: string }) => new Response(answer.body, { status: answer.status })

const activePlanImplementing = (root?: string) => ({
  phase: 'implementing' as const,
  request: { id: StartPlanMother.TICKET, repo: StartPlanMother.REPO, path: StartPlanMother.PATH },
  plan: {
    id: StartPlanMother.TICKET,
    repo: StartPlanMother.REPO,
    issue: StartPlanMother.ISSUE,
    agent: StartPlanMother.AGENT,
    branch: StartPlanMother.BRANCH,
    worktree: StartPlanMother.WORKTREE,
    ...(root !== undefined ? { root } : {}),
  },
})

const stubFetchByPath = (byPath: (url: string) => { status: number; body: string }) => {
  const fetching = vi.fn(async (input: string | URL | Request) => responseFor(byPath(String(input))))
  vi.stubGlobal('fetch', fetching)

  return fetching
}

describe('Home · implement progress', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should ask for progress with the non-canonical root the plan started with, not the path the user typed', async () => {
    const fetching = stubFetchByPath((url) => {
      if (url === '/active-plans') return NO_ACTIVE_PLANS
      if (url === '/start-plan') return StartPlanMother.startedFromNonCanonicalPath()
      if (url === '/implement-plan') return IMPLEMENTING
      if (url.startsWith('/implement-progress/')) return ImplementProgressMother.notRead()
      throw new Error(`unexpected fetch to ${url}`)
    })

    const { user } = openHome()
    await startPlan(user)
    await screen.findByRole('status')
    await streamFrame(PlanEventsMother.ready())
    await user.click(screen.getByRole('button', IMPLEMENT_BUTTON))
    await screen.findByText('Implementación en curso')

    await waitFor(() =>
      expect(fetching).toHaveBeenCalledWith(
        `/implement-progress/${StartPlanMother.ISSUE.number}?root=${encodeURIComponent(StartPlanMother.NON_CANONICAL_ROOT)}&repo=${encodeURIComponent(StartPlanMother.REPO)}`,
      ),
    )
  })

  it('should fall back to the request path when a recovered plan carries no canonical root', async () => {
    const fetching = stubFetchByPath((url) => {
      if (url === '/active-plans') return { status: 200, body: JSON.stringify({ plans: [activePlanImplementing()] }) }
      if (url.startsWith('/implement-progress/')) return ImplementProgressMother.notRead()
      throw new Error(`unexpected fetch to ${url}`)
    })

    openHome()

    await screen.findByText('Implementación en curso')
    await waitFor(() =>
      expect(fetching).toHaveBeenCalledWith(
        `/implement-progress/${StartPlanMother.ISSUE.number}?root=${encodeURIComponent(StartPlanMother.PATH)}&repo=${encodeURIComponent(StartPlanMother.REPO)}`,
      ),
    )
  })

  it('should show the task, the step and the task name once the run reports progress', async () => {
    stubFetchByPath((url) => {
      if (url === '/active-plans') {
        return { status: 200, body: JSON.stringify({ plans: [activePlanImplementing(StartPlanMother.PATH)] }) }
      }
      if (url.startsWith('/implement-progress/')) return ImplementProgressMother.progress()
      throw new Error(`unexpected fetch to ${url}`)
    })

    openHome()

    expect(await screen.findByText(/Tarea 3 de 7/)).toBeInTheDocument()
    expect(screen.getByText(/el lector del plan/)).toBeInTheDocument()
  })

  it('should stop polling once the page is left', async () => {
    const fetching = stubFetchByPath((url) => {
      if (url === '/active-plans') {
        return { status: 200, body: JSON.stringify({ plans: [activePlanImplementing(StartPlanMother.PATH)] }) }
      }
      if (url.startsWith('/implement-progress/')) return ImplementProgressMother.notRead()
      throw new Error(`unexpected fetch to ${url}`)
    })

    const { unmount } = openHome()
    await waitFor(() => expect(fetching.mock.calls.some(([input]) => String(input).startsWith('/implement-progress/'))).toBe(true))
    const callsBeforeUnmount = fetching.mock.calls.length

    unmount()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(fetching.mock.calls.length).toBe(callsBeforeUnmount)
  })
})
