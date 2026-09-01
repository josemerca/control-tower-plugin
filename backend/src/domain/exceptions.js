export class PlanFailure extends Error {
  constructor(reason) {
    super(reason)
    this.name = new.target.name
  }
}

export class TicketFailure extends PlanFailure {}

export class TicketNotRead extends TicketFailure {}

export class TicketNotUnderstood extends TicketFailure {}

export class PlanIssueFailure extends PlanFailure {}

export class PlanIssueNotCreated extends PlanIssueFailure {}

export class PlanIssueNotNamed extends PlanIssueFailure {}

export class PlanSessionFailure extends PlanFailure {}

export class PlanSessionNotStarted extends PlanSessionFailure {}

export class PlanSessionNotNamed extends PlanSessionFailure {}
