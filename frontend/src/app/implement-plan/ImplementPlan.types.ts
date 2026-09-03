export type ImplementPlanRequest = {
  agent: string
  issue: number
}

export type ImplementPlanResult = {
  status: 'implementing'
  agent: string
  issue: number
}

export type ImplementPlanRefusal = {
  error: string
}

export type ImplementPlanOutcome =
  | { kind: 'implementing'; agent: string; issue: number }
  | { kind: 'refused'; error: string }
  | { kind: 'backend-unreachable' }
