import { DeliveryPolicy, DeliveryState } from '../../domain/policies/delivery-policy.js'

export class ReadFixesAskedParams {
  constructor({ issue, repository }) {
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

class ReadFixesAskedResult {
  constructor({ changes }) {
    this.changes = changes
    Object.freeze(this)
  }
}

export class ReadFixesAsked {
  constructor({ pullRequests, planIssues }) {
    this.pullRequests = pullRequests
    this.planIssues = planIssues
  }

  async execute(params) {
    const pullRequest = await this.pullRequests.openOf({
      issueNumber: params.issue.number, repository: params.repository,
    })
    if (pullRequest === null) return new ReadFixesAskedResult({ changes: [] })

    const status = await this.planIssues.statusOf({
      issueNumber: params.issue.number, repository: params.repository,
    })
    if (DeliveryPolicy.of({ status }) !== DeliveryState.IN_REVIEW) {
      return new ReadFixesAskedResult({ changes: [] })
    }

    return new ReadFixesAskedResult({
      changes: await this.pullRequests.fixesAsked({ pullRequest, repository: params.repository }),
    })
  }
}
