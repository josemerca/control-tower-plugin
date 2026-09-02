export class PlanFailure extends Error {
  constructor(reason) {
    super(reason)
    this.name = new.target.name
  }
}

export class UserStoryFailure extends PlanFailure {}

export class UserStoryNotRead extends UserStoryFailure {}

export class UserStoryNotUnderstood extends UserStoryFailure {}

export class PlanIssueFailure extends PlanFailure {}

export class PlanIssueNotCreated extends PlanIssueFailure {}

export class PlanIssueNotNamed extends PlanIssueFailure {}

export class PlanAgentFailure extends PlanFailure {}

export class PlanAgentNotLaunched extends PlanAgentFailure {}

export class PlanAgentNotNamed extends PlanAgentFailure {}

export class PlanAgentNotResumed extends PlanAgentFailure {}

export class WorkspaceFailure extends PlanFailure {}

export class WorkspaceNotPrepared extends WorkspaceFailure {}

export class WorkspaceNotUnderstood extends WorkspaceFailure {}

export class PlanProgressFailure extends PlanFailure {}

export class PlanProgressNotRead extends PlanProgressFailure {}
