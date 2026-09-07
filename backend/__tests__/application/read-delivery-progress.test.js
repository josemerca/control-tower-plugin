import { describe, it, expect } from 'vitest'
import {
  ReadDeliveryProgress, ReadDeliveryProgressParams,
} from '../../src/application/queries/read-delivery-progress.js'
import { DeliveryState } from '../../src/domain/policies/delivery-policy.js'
import { PullRequests } from '../../src/domain/ports/pull-requests.js'
import { PlanIssues } from '../../src/domain/ports/plan-issues.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PullRequestNotRead } from '../../src/domain/exceptions.js'

class PullRequestsDouble extends PullRequests {
  constructor({ open = null, failing = null } = {}) {
    super()
    this.open = open
    this.failing = failing
  }

  async openOf() {
    if (this.failing !== null) throw this.failing

    return this.open
  }
}

class PlanIssuesDouble extends PlanIssues {
  constructor(inReview) {
    super()
    this.inReview = inReview
  }

  async isInReview() {
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

  constructor({ pullRequests, planIssues } = {}) {
    this.pullRequests = pullRequests ?? new PullRequestsDouble()
    this.planIssues = planIssues ?? new PlanIssuesDouble(true)
  }

  static implementing() {
    return new Flow({ pullRequests: new PullRequestsDouble({ open: null }) })
  }

  static inReview() {
    return new Flow({
      pullRequests: new PullRequestsDouble({ open: Flow.PULL_REQUEST }),
      planIssues: new PlanIssuesDouble(true),
    })
  }

  static fixing() {
    return new Flow({
      pullRequests: new PullRequestsDouble({ open: Flow.PULL_REQUEST }),
      planIssues: new PlanIssuesDouble(false),
    })
  }

  async run() {
    return new ReadDeliveryProgress(this).execute(new ReadDeliveryProgressParams({
      issue: Flow.ISSUE, repository: Flow.REPOSITORY,
    }))
  }
}

describe('ReadDeliveryProgress', () => {
  it('with_no_pull_request_yet_the_agent_is_still_implementing_and_there_is_nothing_to_link', async () => {
    const read = await Flow.implementing().run()

    expect(read.state).toBe(DeliveryState.IMPLEMENTING)
    expect(read.pullRequest).toBeNull()
  })

  it('an_open_pull_request_on_an_issue_in_review_is_waiting_for_a_person', async () => {
    const read = await Flow.inReview().run()

    expect(read.state).toBe(DeliveryState.IN_REVIEW)
    expect(read.pullRequest).toEqual(Flow.PULL_REQUEST)
  })

  it('an_open_pull_request_on_an_issue_back_in_progress_is_being_fixed', async () => {
    const read = await Flow.fixing().run()

    expect(read.state).toBe(DeliveryState.FIXING)
    expect(read.pullRequest).toEqual(Flow.PULL_REQUEST)
  })

  it('a_pull_request_that_could_not_be_located_travels_out_typed_instead_of_looking_like_implementing', async () => {
    const flow = new Flow({
      pullRequests: new PullRequestsDouble({ failing: new PullRequestNotRead('HTTP 502') }),
    })

    await expect(flow.run()).rejects.toBeInstanceOf(PullRequestNotRead)
  })
})
