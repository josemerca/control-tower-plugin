import { ImplementationStep } from '../../domain/value-objects/implementation-state.js'
import { DeliveryPolicy, DeliveryState } from '../../domain/policies/delivery-policy.js'

export class ReadImplementationProgressParams {
  constructor({ root, issue, repository }) {
    this.root = root
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

class ReadImplementationProgressResult {
  constructor({ state }) {
    this.state = state
    Object.freeze(this)
  }
}

export class ReadImplementationProgress {
  static #BY_DELIVERY = new Map([
    [DeliveryState.IN_REVIEW, (state, pullRequest) =>
      state.underReview({ step: ImplementationStep.IN_REVIEW, pullRequest })],
    [DeliveryState.FIXING, (state, pullRequest) =>
      state.underReview({ step: ImplementationStep.FIXING, pullRequest })],
    [DeliveryState.UNATTENDED, (state) => state],
  ])

  constructor({ implementationProgress, pullRequests, planIssues }) {
    this.implementationProgress = implementationProgress
    this.pullRequests = pullRequests
    this.planIssues = planIssues
  }

  async execute(params) {
    const state = await this.implementationProgress.of({
      root: params.root,
      issue: params.issue,
      repository: params.repository,
    })

    return new ReadImplementationProgressResult({ state: await this.#reviewed(state, params) })
  }

  async #reviewed(state, params) {
    if (state.step !== ImplementationStep.DELIVERED) return state
    const pullRequest = await this.pullRequests.openOf({
      issueNumber: params.issue, repository: params.repository,
    })
    if (pullRequest === null) return state

    const status = await this.planIssues.statusOf({
      issueNumber: params.issue, repository: params.repository,
    })
    const delivery = DeliveryPolicy.of({ status })
    const projected = ReadImplementationProgress.#BY_DELIVERY.get(delivery)
    if (projected === undefined) {
      throw new Error(`no implementation step declared for the delivery state ${JSON.stringify(delivery)}`)
    }

    return projected(state, pullRequest)
  }
}
