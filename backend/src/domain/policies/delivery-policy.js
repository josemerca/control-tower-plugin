import { PlanIssueStatus } from '../value-objects/plan-issue-status.js'

export class DeliveryState {
  static IN_REVIEW = 'in-review'
  static FIXING = 'fixing'
  static UNATTENDED = 'unattended'
}

export class DeliveryPolicy {
  static #BY_STATUS = new Map([
    [PlanIssueStatus.IN_REVIEW, DeliveryState.IN_REVIEW],
    [PlanIssueStatus.IN_PROGRESS, DeliveryState.FIXING],
    [PlanIssueStatus.READY, DeliveryState.UNATTENDED],
    [PlanIssueStatus.BACKLOG, DeliveryState.UNATTENDED],
    [PlanIssueStatus.NONE, DeliveryState.UNATTENDED],
  ])

  static of({ status }) {
    const projected = DeliveryPolicy.#BY_STATUS.get(status)
    if (projected === undefined) {
      throw new Error(`no delivery state declared for the plan issue status ${JSON.stringify(status)}`)
    }

    return projected
  }
}
