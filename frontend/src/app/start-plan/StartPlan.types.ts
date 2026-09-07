export type StartPlanRequest = {
  id: string | null
  repo: string
  path: string
}

export type StartPlanSubmission = StartPlanRequest & {
  userComment: string | null
}

export type PlanIssue = {
  number: number
  url: string
}

export type StartedPlan = {
  id: string | null
  repo: string
  issue: PlanIssue
  agent: string
  branch: string
  worktree: string
  root?: string
}

export type StartPlanResult = StartedPlan & {
  status: 'started'
}

export type StartPlanRefusal = {
  code: string
  detail: string
}

export type StartPlanOutcome =
  | { kind: 'started'; plan: StartedPlan }
  | { kind: 'refused'; error: string }
  | { kind: 'backend-unreachable' }
