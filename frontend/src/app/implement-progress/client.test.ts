import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'
import { ImplementProgressClient } from 'app/implement-progress/client'

const answerWith = (answer: { status: number; body: string }) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))
}

const get = () => ImplementProgressClient.get({
  issue: ImplementProgressMother.ISSUE,
  root: ImplementProgressMother.ROOT,
  repo: ImplementProgressMother.REPO,
})

describe('ImplementProgressClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should read the step, the task, the name, the attempt and the discards of a run in progress', async () => {
    answerWith(ImplementProgressMother.progress())

    const outcome = await get()

    expect(outcome).toEqual({
      kind: 'read',
      state: { step: 'judge', task: 3, totalTasks: 7, name: 'el lector del plan', attempt: 2, discards: 0, pullRequest: null },
    })
  })

  it('should keep a task whose name the backend could not read as null instead of hiding it', async () => {
    answerWith(ImplementProgressMother.withoutTaskName())

    const outcome = await get()

    expect(outcome).toEqual({
      kind: 'read',
      state: { step: 'implement', task: 1, totalTasks: 8, name: null, attempt: 1, discards: 0, pullRequest: null },
    })
  })

  it('should read the number and the url of the pull request once the plan is in review', async () => {
    answerWith(ImplementProgressMother.inReview())

    const outcome = await get()

    expect(outcome).toEqual({
      kind: 'read',
      state: {
        step: 'in-review',
        task: null,
        totalTasks: 7,
        name: null,
        attempt: null,
        discards: 0,
        pullRequest: { number: 31, url: 'https://github.com/owner/name/pull/31' },
      },
    })
  })

  it('should treat a pull request without a url as absent instead of showing it half done', async () => {
    answerWith(ImplementProgressMother.inReviewWithMalformedPullRequest())

    const outcome = await get()

    expect(outcome).toEqual({
      kind: 'read',
      state: { step: 'in-review', task: null, totalTasks: 7, name: null, attempt: null, discards: 0, pullRequest: null },
    })
  })

  it('should read the real backend answer for a plan whose pull request is in review', async () => {
    answerWith(ImplementProgressMother.realWorldInReview())

    const outcome = await get()

    expect(outcome).toEqual({
      kind: 'read',
      state: {
        step: 'in-review',
        task: null,
        totalTasks: 8,
        name: null,
        attempt: null,
        discards: 0,
        pullRequest: { number: 46, url: 'https://github.com/jjponz/repo-pulse/pull/46' },
      },
    })
  })

  it('should treat a worktree without a run yet as not read instead of a refusal', async () => {
    answerWith(ImplementProgressMother.notRead())

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'not-read' })
  })

  it('should keep the backend refusal text for a refusal other than not-read', async () => {
    answerWith(ImplementProgressMother.malformedRoot())

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'refused', error: ImplementProgressMother.MALFORMED_ROOT_DETAIL })
  })

  it('should say the backend is unreachable when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'backend-unreachable' })
  })

  it('should say the backend is unreachable instead of crashing on an unknown step', async () => {
    answerWith({ status: 200, body: '{"step":"unknown-step","task":1,"total_tasks":1,"name":null,"attempt":1,"discards":0}' })

    const outcome = await get()

    expect(outcome).toEqual({ kind: 'backend-unreachable' })
  })

  it('should ask with the issue in the path and the canonical root and the repository as query', async () => {
    const fetching = vi.fn(async () => new Response(ImplementProgressMother.progress().body, { status: 200 }))
    vi.stubGlobal('fetch', fetching)

    await ImplementProgressClient.get({ issue: 7, root: '/Users/pedro/code/name', repo: 'owner/name' })

    expect(fetching).toHaveBeenCalledWith(
      '/implement-progress/7?root=%2FUsers%2Fpedro%2Fcode%2Fname&repo=owner%2Fname',
    )
  })
})
