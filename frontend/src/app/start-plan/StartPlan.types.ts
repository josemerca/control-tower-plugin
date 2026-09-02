export type StartPlanResult = {
  status: 'started'
  id: string
  session: string
}

export type StartPlanRefusal = {
  error: string
}

export type StartPlanOutcome =
  | { kind: 'started'; session: string }
  | { kind: 'refused'; error: string }
  | { kind: 'backend-unreachable' }
