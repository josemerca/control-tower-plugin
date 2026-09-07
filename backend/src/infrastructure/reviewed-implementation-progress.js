import { ImplementationProgress } from '../domain/ports/implementation-progress.js'
import { ImplementationStep } from '../domain/value-objects/implementation-state.js'
import { DeliveryPolicy, DeliveryState } from '../domain/policies/delivery-policy.js'

export class ReviewedImplementationProgress extends ImplementationProgress {
  static #BY_STATE = Object.freeze({
    [DeliveryState.IN_REVIEW]: ImplementationStep.IN_REVIEW,
    [DeliveryState.FIXING]: ImplementationStep.FIXING,
  })

  constructor({ implemented, pullRequests, planIssues }) {
    super()
    this.implemented = implemented
    this.pullRequests = pullRequests
    this.planIssues = planIssues
  }

  async of({ root, issue, repository }) {
    const state = await this.implemented.of({ root, issue, repository })
    if (state.step !== ImplementationStep.DELIVERED) return state

    const pullRequest = await this.pullRequests.openOf({ issueNumber: issue, repository })
    if (pullRequest === null) return state

    const inReview = await this.planIssues.isInReview({ issueNumber: issue, repository })
    const step = ReviewedImplementationProgress.#BY_STATE[DeliveryPolicy.of({ pullRequest, inReview })]

    return state.underReview({ step, pullRequest })
  }
}
