import { ActivePlan } from 'app/active-plans/ActivePlan.types'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { ActivePlansClient } from 'app/active-plans/client'

const activePlan = (): ActivePlan => ({
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

const answerWith = (plan: ActivePlan) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ plans: [plan] }), { status: 200 })))
}

const activePlanWithoutStory = (): ActivePlan => ({
  phase: 'planning',
  request: { id: null, repo: StartPlanMother.REPO, path: StartPlanMother.PATH },
  plan: {
    id: null,
    repo: StartPlanMother.REPO,
    issue: { number: 9, url: 'https://github.com/owner/name/issues/9' },
    agent: 'workspace:5',
    branch: 'feat/9',
    worktree: `${StartPlanMother.PATH}/.worktrees/9`,
  },
})

describe('ActivePlansClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should load a valid active plan', async () => {
    const plan = activePlan()
    answerWith(plan)

    expect(await ActivePlansClient.get()).toEqual({ kind: 'loaded', plans: [plan] })
  })

  it('should load an active plan with no user story, with a null id', async () => {
    const plan = activePlanWithoutStory()
    answerWith(plan as ActivePlan)

    expect(await ActivePlansClient.get()).toEqual({ kind: 'loaded', plans: [plan] })
  })

  it('should load an uncertain active plan', async () => {
    const plan = { ...activePlan(), phase: 'uncertain' }
    answerWith(plan as ActivePlan)

    expect(await ActivePlansClient.get()).toEqual({ kind: 'loaded', plans: [plan] })
  })

  it.each([
    ['invalid request ticket', (value: ActivePlan) => { value.request.id = 'abc-123' }],
    ['invalid request repository', (value: ActivePlan) => { value.request.repo = 'name' }],
    ['invalid request path', (value: ActivePlan) => { value.request.path = 'relative' }],
    ['non-positive issue', (value: ActivePlan) => { value.plan.issue = { ...value.plan.issue, number: -1 } }],
    ['empty URL', (value: ActivePlan) => { value.plan.issue = { ...value.plan.issue, url: '' } }],
    ['empty agent', (value: ActivePlan) => { value.plan.agent = ' ' }],
    ['empty branch', (value: ActivePlan) => { value.plan.branch = '' }],
    ['empty worktree', (value: ActivePlan) => { value.plan.worktree = '' }],
    ['mismatched ticket', (value: ActivePlan) => { value.plan.id = 'XYZ-456' }],
    ['a plan id present when the request has none', (value: ActivePlan) => {
      value.request.id = null
      value.plan.id = 'XYZ-456'
    }],
    ['mismatched repository', (value: ActivePlan) => { value.plan.repo = 'owner/other' }],
    ['worktree outside the request path', (value: ActivePlan) => { value.plan.worktree = '/tmp/worktree' }],
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
