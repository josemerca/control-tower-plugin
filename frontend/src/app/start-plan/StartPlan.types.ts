export type StartPlanRequest = {
  id: string
  repo: string
}

export type PlanIssue = {
  number: number
  url: string
}

export type StartedPlan = {
  id: string
  repo: string
  issue: PlanIssue
  agent: string
}

export type StartPlanResult = StartedPlan & {
  status: 'started'
}

export type StartPlanRefusal = {
  error: string
}

export type StartPlanOutcome =
  | { kind: 'started'; plan: StartedPlan }
  | { kind: 'refused'; error: string }
  | { kind: 'backend-unreachable' }
