import { StartedPlan, StartPlanRequest } from 'app/start-plan/StartPlan.types'

export type ActivePlan = {
  phase: 'planning' | 'implementing' | 'uncertain'
  request: StartPlanRequest
  plan: StartedPlan
}

export type ActivePlansOutcome = { kind: 'loaded'; plans: ActivePlan[] } | { kind: 'unavailable' }
