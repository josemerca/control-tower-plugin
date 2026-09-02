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

export class PlanAgentFailure extends PlanFailure {}

export class PlanAgentNotLaunched extends PlanAgentFailure {}

export class PlanAgentNotNamed extends PlanAgentFailure {}
