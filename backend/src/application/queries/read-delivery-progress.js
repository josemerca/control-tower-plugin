import { DeliveryPolicy } from '../../domain/policies/delivery-policy.js'

export class ReadDeliveryProgressParams {
  constructor({ issue, repository }) {
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

class ReadDeliveryProgressResult {
  constructor({ state, pullRequest }) {
    this.state = state
    this.pullRequest = pullRequest
    Object.freeze(this)
  }
}

export class ReadDeliveryProgress {
  constructor({ pullRequests, planIssues }) {
    this.pullRequests = pullRequests
    this.planIssues = planIssues
  }

  async execute(params) {
    const pullRequest = await this.pullRequests.openOf({
      issue: params.issue, repository: params.repository,
    })
    if (pullRequest === null) {
      return new ReadDeliveryProgressResult({
        state: DeliveryPolicy.of({ pullRequest, inReview: false }), pullRequest: null,
      })
    }
    const inReview = await this.planIssues.isInReview({
      issue: params.issue, repository: params.repository,
    })

    return new ReadDeliveryProgressResult({
      state: DeliveryPolicy.of({ pullRequest, inReview }), pullRequest,
    })
  }
}
