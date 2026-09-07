export class PlanIssueStatus {
  static BACKLOG = 'backlog'
  static READY = 'ready'
  static IN_PROGRESS = 'in-progress'
  static IN_REVIEW = 'in-review'
  static NONE = 'none'

  static declared() {
    return [
      PlanIssueStatus.BACKLOG, PlanIssueStatus.READY,
      PlanIssueStatus.IN_PROGRESS, PlanIssueStatus.IN_REVIEW,
    ]
  }
}
