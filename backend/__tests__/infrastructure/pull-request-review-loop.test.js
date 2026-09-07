import { describe, it, expect } from 'vitest'
import { ReviewWatch } from '../../src/infrastructure/review-watch.js'
import { DispatchCheckWorkbench } from '../../src/infrastructure/dispatch-check-workbench.js'
import { CmuxPlanAgents } from '../../src/infrastructure/cmux-plan-agents.js'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.js'
import { PullRequests } from '../../src/domain/ports/pull-requests.js'
import { PlanIssues } from '../../src/domain/ports/plan-issues.js'
import { OpenPullRequest } from '../../src/infrastructure/gh-pull-requests.js'
import { ChangeAsked } from '../../src/domain/value-objects/change-asked.js'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { ReadFixesAsked, ReadFixesAskedParams } from '../../src/application/queries/read-fixes-asked.js'
import { RequestFixes, RequestFixesParams } from '../../src/application/actions/request-fixes.js'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.js'

class PullRequestsDouble extends PullRequests {
  constructor({ pullRequest, changes }) {
    super()
    this.pullRequest = pullRequest
    this.changes = changes
  }

  async openOf() {
    return this.pullRequest
  }

  async fixesAsked() {
    return this.changes
  }
}

class PlanIssuesDouble extends PlanIssues {
  async isInReview() {
    return true
  }
}

class NodeDouble {
  constructor() {
    this.calls = []
  }

  async run(argv) {
    this.calls.push(argv)

    return new ProcessOutput({ code: 0, stdout: '', stderr: '' })
  }
}

class CmuxDouble {
  constructor() {
    this.calls = []
  }

  async run(argv) {
    this.calls.push(argv)

    return new ProcessOutput({ code: 0, stdout: '', stderr: '' })
  }
}

class Sweep {
  constructor(reviews) {
    this.reviews = reviews
    this.ticks = 0
  }

  sleep(watch) {
    this.ticks += 1
    if (this.ticks > 1) this.reviews.stop({ issue: watch.issue.number, repository: watch.repository })

    return Promise.resolve()
  }
}

class PullRequestReviewLoop {
  static DISPATCH_CHECK = '/plugin/scripts/dispatch-check.mjs'
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static ISSUE = new PlanIssue({
    number: 7, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/7',
  })
  static AGENT = 'workspace:9'
  static CHANGE = new ChangeAsked({ id: '101', text: 'arregla el guard de []' })
  static PULL_REQUEST = new OpenPullRequest({
    number: 42, url: 'https://github.com/josemerca/ct-loop-sandbox/pull/42',
  })
  static SUBJECT = new PlanWatch({
    issue: PullRequestReviewLoop.ISSUE,
    located: new WorkspaceLocation({ path: '/repo/.worktrees/7', branch: 'feat/7' }),
    repository: PullRequestReviewLoop.REPOSITORY,
    agent: PullRequestReviewLoop.AGENT,
  })

  constructor() {
    this.node = new NodeDouble()
    this.cmux = new CmuxDouble()
    this.pullRequests = new PullRequestsDouble({
      pullRequest: PullRequestReviewLoop.PULL_REQUEST,
      changes: [PullRequestReviewLoop.CHANGE],
    })
    this.planIssues = new PlanIssuesDouble()
    this.brief = new PlanAgentBrief({
      dispatchCheck: PullRequestReviewLoop.DISPATCH_CHECK,
      conventions: '/plugin/conventions',
      ctStep: '/plugin/scripts/ct-step.mjs',
    })
  }

  #graph() {
    const readFixesAsked = new ReadFixesAsked({ pullRequests: this.pullRequests, planIssues: this.planIssues })
    const workbench = new DispatchCheckWorkbench({
      node: (argv) => this.node.run(argv),
      dispatchCheck: PullRequestReviewLoop.DISPATCH_CHECK,
    })
    const planAgents = new CmuxPlanAgents({ brief: this.brief, run: (argv) => this.cmux.run(argv) })
    const requestFixes = new RequestFixes({ workbench, planAgents })
    const sweep = new Sweep(null)
    const reviews = new ReviewWatch({
      asked: (watch) => readFixesAsked.execute(new ReadFixesAskedParams(watch)),
      review: (params) => requestFixes.execute(new RequestFixesParams(params)),
      sleep: () => sweep.sleep(PullRequestReviewLoop.SUBJECT),
      stderr: () => {},
      label: 'pull request review watch',
    })
    sweep.reviews = reviews

    return reviews
  }

  async run() {
    return this.#graph().start(PullRequestReviewLoop.SUBJECT)
  }
}

describe('the pull request review loop composed end to end, only node and cmux doubled', () => {
  it('reopens_the_exact_issue_the_review_named_instead_of_sending_undefined_to_dispatch_check', async () => {
    const loop = new PullRequestReviewLoop()

    await loop.run()

    expect(loop.node.calls).toEqual([[
      PullRequestReviewLoop.DISPATCH_CHECK, '7', '--repo', 'josemerca/ct-loop-sandbox', '--reopen',
    ]])
  })

  it('types_an_errand_naming_the_real_issue_instead_of_issue_hash_undefined', async () => {
    const loop = new PullRequestReviewLoop()

    await loop.run()

    const expectedErrand = loop.brief.fixErrandFor({
      issueNumber: 7,
      repository: PullRequestReviewLoop.REPOSITORY,
      changes: PullRequestReviewLoop.CHANGE.text,
    })
    expect(loop.cmux.calls).toEqual([
      ['send', '--workspace', PullRequestReviewLoop.AGENT, expectedErrand],
      ['send-key', '--workspace', PullRequestReviewLoop.AGENT, 'Enter'],
    ])
    expect(expectedErrand).toContain('#7')
    expect(expectedErrand).not.toContain('undefined')
  })
})
