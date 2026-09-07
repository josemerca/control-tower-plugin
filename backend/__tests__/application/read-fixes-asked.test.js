import { describe, it, expect } from 'vitest'
import { ReadFixesAsked, ReadFixesAskedParams } from '../../src/application/queries/read-fixes-asked.js'
import { PullRequests } from '../../src/domain/ports/pull-requests.js'
import { PlanIssues } from '../../src/domain/ports/plan-issues.js'
import { ChangeAsked } from '../../src/domain/value-objects/change-asked.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PullRequestNotRead } from '../../src/domain/exceptions.js'

class PullRequestsDouble extends PullRequests {
  constructor({ open = null, asked = [], failing = null } = {}) {
    super()
    this.open = open
    this.answer = asked
    this.failing = failing
    this.located = []
    this.read = []
  }

  async openOf(subject) {
    this.located.push(subject)
    if (this.failing !== null) throw this.failing

    return this.open
  }

  async fixesAsked(subject) {
    this.read.push(subject)

    return this.answer
  }
}

class PlanIssuesDouble extends PlanIssues {
  constructor(inReview = true) {
    super()
    this.inReview = inReview
    this.asked = []
  }

  async isInReview(subject) {
    this.asked.push(subject)

    return this.inReview
  }
}

class Flow {
  static ISSUE = new PlanIssue({
    number: 7, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/7',
  })
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static PULL_REQUEST = Object.freeze({
    number: 42, url: 'https://github.com/josemerca/ct-loop-sandbox/pull/42',
  })
  static A_CHANGE = new ChangeAsked({ id: '101', text: 'src/foo.js:42: revienta con []' })

  constructor({ pullRequests, planIssues } = {}) {
    this.pullRequests = pullRequests ?? new PullRequestsDouble()
    this.planIssues = planIssues ?? new PlanIssuesDouble()
  }

  static implementing() {
    return new Flow({ pullRequests: new PullRequestsDouble({ open: null }) })
  }

  static inReview(asked = [Flow.A_CHANGE]) {
    return new Flow({
      pullRequests: new PullRequestsDouble({ open: Flow.PULL_REQUEST, asked }),
      planIssues: new PlanIssuesDouble(true),
    })
  }

  static fixing() {
    return new Flow({
      pullRequests: new PullRequestsDouble({ open: Flow.PULL_REQUEST, asked: [Flow.A_CHANGE] }),
      planIssues: new PlanIssuesDouble(false),
    })
  }

  async run() {
    return new ReadFixesAsked(this).execute(new ReadFixesAskedParams({
      issue: Flow.ISSUE, repository: Flow.REPOSITORY,
    }))
  }
}

describe('ReadFixesAsked', () => {
  it('the_pull_request_it_looks_for_is_the_one_of_the_issue_and_the_repository_it_was_given', async () => {
    const flow = Flow.inReview()

    await flow.run()

    expect(flow.pullRequests.located).toEqual([{ issue: Flow.ISSUE, repository: Flow.REPOSITORY }])
  })

  it('a_branch_with_no_pull_request_yet_asks_for_no_reviews_because_there_is_nothing_to_review', async () => {
    const flow = Flow.implementing()

    const read = await flow.run()

    expect(read.changes).toEqual([])
    expect(flow.pullRequests.read).toEqual([])
    expect(flow.planIssues.asked).toEqual([])
  })

  it('an_issue_still_being_fixed_hands_nothing_over_so_nothing_is_typed_over_a_busy_agent', async () => {
    const flow = Flow.fixing()

    const read = await flow.run()

    expect(read.changes).toEqual([])
    expect(flow.pullRequests.read).toEqual([])
  })

  it('an_issue_in_review_hands_over_every_change_asked_for_in_its_pull_request', async () => {
    const flow = Flow.inReview()

    const read = await flow.run()

    expect(read.changes).toEqual([Flow.A_CHANGE])
    expect(flow.pullRequests.read).toEqual([
      { pullRequest: Flow.PULL_REQUEST, repository: Flow.REPOSITORY },
    ])
  })

  it('a_pull_request_in_review_with_nothing_asked_of_it_answers_an_empty_list_and_not_a_null', async () => {
    const read = await Flow.inReview([]).run()

    expect(read.changes).toEqual([])
  })

  it('the_gate_is_asked_about_the_issue_and_the_repository_it_was_given', async () => {
    const flow = Flow.inReview()

    await flow.run()

    expect(flow.planIssues.asked).toEqual([{ issue: Flow.ISSUE, repository: Flow.REPOSITORY }])
  })

  it('a_pull_request_that_could_not_be_located_travels_out_typed_instead_of_looking_like_no_pull_request', async () => {
    const flow = new Flow({
      pullRequests: new PullRequestsDouble({ failing: new PullRequestNotRead('HTTP 502') }),
    })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PullRequestNotRead)
    expect(flow.planIssues.asked).toEqual([])
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PullRequests().openOf({ issue: Flow.ISSUE, repository: Flow.REPOSITORY }))
      .rejects.toThrow(/must implement openOf/)
    await expect(new PlanIssues().isInReview({ issue: Flow.ISSUE, repository: Flow.REPOSITORY }))
      .rejects.toThrow(/must implement isInReview/)
  })
})
