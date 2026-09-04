export type ImplementPlanRequest = {
  agent: string
  issue: number
  repo: string
}

export type ImplementPlanResult = {
  status: 'implementing'
  agent: string
  issue: number
}

export type ImplementPlanRefusal = {
  code: string
  detail: string
}

export type ImplementPlanOutcome =
  | { kind: 'implementing'; agent: string; issue: number }
  | { kind: 'refused'; error: string }
  | { kind: 'backend-unreachable' }
