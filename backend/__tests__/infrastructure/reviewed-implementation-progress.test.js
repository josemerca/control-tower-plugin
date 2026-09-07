import { describe, it, expect } from 'vitest'
import { ReviewedImplementationProgress } from '../../src/infrastructure/reviewed-implementation-progress.js'
import { ImplementationProgress } from '../../src/domain/ports/implementation-progress.js'
import { PullRequests } from '../../src/domain/ports/pull-requests.js'
import { PlanIssues } from '../../src/domain/ports/plan-issues.js'
import { ImplementationState, ImplementationStep } from '../../src/domain/value-objects/implementation-state.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PullRequestNotRead, ImplementationProgressNotRead } from '../../src/domain/exceptions.js'

class ImplementedDouble extends ImplementationProgress {
  constructor(answer) {
    super()
    this.answer = answer
    this.asked = []
  }

  static parkedAt(step) {
    return new ImplementedDouble(ImplementationState.of({
      step, task: 3, totalTasks: 7, name: 'el lector del plan', attempt: 2, discards: 1,
    }))
  }

  static delivered() {
    return new ImplementedDouble(ImplementationState.of({
      step: ImplementationStep.DELIVERED, task: null, totalTasks: 7, name: null, attempt: null, discards: 1,
    }))
  }

  static refusing(cause) {
    return new ImplementedDouble(cause)
  }

  async of(subject) {
    this.asked.push(subject)
    if (this.answer instanceof Error) throw this.answer

    return this.answer
  }
}

class PullRequestsDouble extends PullRequests {
  constructor({ open = null, failing = null } = {}) {
    super()
    this.open = open
    this.failing = failing
    this.asked = []
  }

  async openOf(subject) {
    this.asked.push(subject)
    if (this.failing !== null) throw this.failing

    return this.open
  }
}

class PlanIssuesDouble extends PlanIssues {
  constructor(inReview) {
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
  static ROOT = new CheckoutRoot('/checkout')
  static ISSUE = 42
  static REPOSITORY = new RepositoryName('owner/name')
  static PULL_REQUEST = Object.freeze({ number: 7, url: 'https://github.com/owner/name/pull/7' })

  constructor({ implemented, pullRequests, planIssues } = {}) {
    this.implemented = implemented ?? ImplementedDouble.delivered()
    this.pullRequests = pullRequests ?? new PullRequestsDouble({ open: Flow.PULL_REQUEST })
    this.planIssues = planIssues ?? new PlanIssuesDouble(true)
  }

  static stillWorking() {
    return new Flow({ implemented: ImplementedDouble.parkedAt(ImplementationStep.JUDGE) })
  }

  static deliveredWithNoPullRequestYet() {
    return new Flow({ pullRequests: new PullRequestsDouble({ open: null }) })
  }

  static waitingForAReview() {
    return new Flow({ planIssues: new PlanIssuesDouble(true) })
  }

  static fixingWhatWasAsked() {
    return new Flow({ planIssues: new PlanIssuesDouble(false) })
  }

  async run() {
    return new ReviewedImplementationProgress(this)
      .of({ root: Flow.ROOT, issue: Flow.ISSUE, repository: Flow.REPOSITORY })
  }
}

describe('ReviewedImplementationProgress', () => {
  it('a_run_still_working_is_handed_back_untouched_and_github_is_never_asked', async () => {
    const flow = Flow.stillWorking()

    const state = await flow.run()

    expect(state.step).toBe(ImplementationStep.JUDGE)
    expect(state.task).toBe(3)
    expect(flow.pullRequests.asked).toEqual([])
    expect(flow.planIssues.asked).toEqual([])
  })

  it('a_delivered_run_with_no_pull_request_yet_stays_delivered_and_the_gate_is_never_asked', async () => {
    const flow = Flow.deliveredWithNoPullRequestYet()

    const state = await flow.run()

    expect(state.step).toBe(ImplementationStep.DELIVERED)
    expect(state.pullRequest).toBeNull()
    expect(flow.planIssues.asked).toEqual([])
  })

  it('a_delivered_run_whose_issue_stands_in_review_is_waiting_for_a_person', async () => {
    const state = await Flow.waitingForAReview().run()

    expect(state.step).toBe(ImplementationStep.IN_REVIEW)
    expect(state.pullRequest).toEqual(Flow.PULL_REQUEST)
  })

  it('a_delivered_run_whose_issue_went_back_to_the_workbench_is_fixing_what_was_asked', async () => {
    const state = await Flow.fixingWhatWasAsked().run()

    expect(state.step).toBe(ImplementationStep.FIXING)
    expect(state.pullRequest).toEqual(Flow.PULL_REQUEST)
  })

  it('what_the_run_counted_survives_the_review_steps_because_the_slice_did_not_shrink', async () => {
    const state = await Flow.waitingForAReview().run()

    expect(state.totalTasks).toBe(7)
    expect(state.discards).toBe(1)
    expect(state.task).toBeNull()
    expect(state.attempt).toBeNull()
  })

  it('the_pull_request_it_looks_for_is_the_one_of_the_issue_and_the_repository_it_was_given', async () => {
    const flow = Flow.waitingForAReview()

    await flow.run()

    expect(flow.pullRequests.asked).toEqual([{ issueNumber: Flow.ISSUE, repository: Flow.REPOSITORY }])
    expect(flow.planIssues.asked).toEqual([{ issueNumber: Flow.ISSUE, repository: Flow.REPOSITORY }])
  })

  it('the_run_it_reads_is_asked_for_the_root_the_issue_and_the_repository', async () => {
    const flow = Flow.waitingForAReview()

    await flow.run()

    expect(flow.implemented.asked).toEqual([
      { root: Flow.ROOT, issue: Flow.ISSUE, repository: Flow.REPOSITORY },
    ])
  })

  it('a_pull_request_that_could_not_be_read_travels_out_typed_instead_of_looking_still_delivered', async () => {
    const flow = new Flow({
      pullRequests: new PullRequestsDouble({ failing: new PullRequestNotRead('HTTP 502') }),
    })

    await expect(flow.run()).rejects.toBeInstanceOf(PullRequestNotRead)
  })

  it('a_run_that_could_not_be_read_travels_out_before_github_is_asked_anything', async () => {
    const flow = new Flow({
      implemented: ImplementedDouble.refusing(new ImplementationProgressNotRead('no run file')),
    })

    await expect(flow.run()).rejects.toBeInstanceOf(ImplementationProgressNotRead)
    expect(flow.pullRequests.asked).toEqual([])
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new ImplementationProgress().of({
      root: Flow.ROOT, issue: Flow.ISSUE, repository: Flow.REPOSITORY,
    })).rejects.toThrow(/must implement of/)
  })
})
