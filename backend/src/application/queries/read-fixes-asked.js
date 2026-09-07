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
      issue: params.issue, repository: params.repository,
    })
    if (pullRequest === null) return new ReadFixesAskedResult({ changes: [] })

    const inReview = await this.planIssues.isInReview({
      issue: params.issue, repository: params.repository,
    })
    if (DeliveryPolicy.of({ pullRequest, inReview }) !== DeliveryState.IN_REVIEW) {
      return new ReadFixesAskedResult({ changes: [] })
    }

    return new ReadFixesAskedResult({
      changes: await this.pullRequests.fixesAsked({ pullRequest, repository: params.repository }),
    })
  }
}
