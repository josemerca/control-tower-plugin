import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { ActivePlansClient } from 'app/active-plans/client'

const activePlan = () => ({
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
})

const answerWith = (plan: ReturnType<typeof activePlan>) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ plans: [plan] }), { status: 200 })))
}

describe('ActivePlansClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should load a valid active plan', async () => {
    const plan = activePlan()
    answerWith(plan)

    expect(await ActivePlansClient.get()).toEqual({ kind: 'loaded', plans: [plan] })
  })

  it('should load an uncertain active plan', async () => {
    const plan = { ...activePlan(), phase: 'uncertain' }
    answerWith(plan as ReturnType<typeof activePlan>)

    expect(await ActivePlansClient.get()).toEqual({ kind: 'loaded', plans: [plan] })
  })

  it.each([
    ['invalid request ticket', (value: ReturnType<typeof activePlan>) => { value.request.id = 'abc-123' }],
    ['invalid request repository', (value: ReturnType<typeof activePlan>) => { value.request.repo = 'name' }],
    ['invalid request path', (value: ReturnType<typeof activePlan>) => { value.request.path = 'relative' }],
    ['non-positive issue', (value: ReturnType<typeof activePlan>) => { value.plan.issue = { ...value.plan.issue, number: -1 } }],
    ['empty URL', (value: ReturnType<typeof activePlan>) => { value.plan.issue = { ...value.plan.issue, url: '' } }],
    ['empty agent', (value: ReturnType<typeof activePlan>) => { value.plan.agent = ' ' }],
    ['empty branch', (value: ReturnType<typeof activePlan>) => { value.plan.branch = '' }],
    ['empty worktree', (value: ReturnType<typeof activePlan>) => { value.plan.worktree = '' }],
    ['mismatched ticket', (value: ReturnType<typeof activePlan>) => { value.plan.id = 'XYZ-456' }],
    ['mismatched repository', (value: ReturnType<typeof activePlan>) => { value.plan.repo = 'owner/other' }],
    ['worktree outside the request path', (value: ReturnType<typeof activePlan>) => { value.plan.worktree = '/tmp/worktree' }],
  ])('should reject an active plan with an %s', async (_case, makeInvalid) => {
    const plan = activePlan()
    makeInvalid(plan)
    answerWith(plan)

    expect(await ActivePlansClient.get()).toEqual({ kind: 'unavailable' })
  })

  it('should reject a malformed response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('null', { status: 200 })))

    expect(await ActivePlansClient.get()).toEqual({ kind: 'unavailable' })
  })
})
