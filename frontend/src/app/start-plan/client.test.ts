import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { StartPlanClient } from 'app/start-plan/client'

const request = () => ({ id: StartPlanMother.TICKET, repo: StartPlanMother.REPO, path: StartPlanMother.PATH })

const answerWith = (answer: { status: number; body: string }) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))
}

describe('StartPlanClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should keep the canonical root the backend answered with', async () => {
    answerWith(StartPlanMother.started())

    const outcome = await StartPlanClient.start(request())

    expect(outcome).toEqual({
      kind: 'started',
      plan: {
        id: StartPlanMother.TICKET,
        repo: StartPlanMother.REPO,
        issue: StartPlanMother.ISSUE,
        agent: StartPlanMother.AGENT,
        branch: StartPlanMother.BRANCH,
        worktree: StartPlanMother.WORKTREE,
        root: StartPlanMother.PATH,
      },
    })
  })

  it('should keep a root that differs from the path the person typed', async () => {
    answerWith(StartPlanMother.startedFromNonCanonicalPath())

    const outcome = await StartPlanClient.start(request())

    expect(outcome).toEqual({
      kind: 'started',
      plan: {
        id: StartPlanMother.TICKET,
        repo: StartPlanMother.REPO,
        issue: StartPlanMother.ISSUE,
        agent: StartPlanMother.AGENT,
        branch: StartPlanMother.BRANCH,
        worktree: StartPlanMother.NON_CANONICAL_WORKTREE,
        root: StartPlanMother.NON_CANONICAL_ROOT,
      },
    })
  })
})
