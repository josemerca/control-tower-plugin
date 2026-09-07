import { ActivePlan, ActivePlansOutcome } from 'app/active-plans/ActivePlan.types'
import { isPlanForRequest, isRecord, isRequest } from 'app/workflow-snapshot/validation'

const PATH = '/active-plans'

const isActivePlan = (value: unknown): value is ActivePlan =>
  isRecord(value) &&
  (value.phase === 'planning' || value.phase === 'implementing' || value.phase === 'uncertain') &&
  isRequest(value.request) &&
  isPlanForRequest(value.plan, value.request)

const get = async (): Promise<ActivePlansOutcome> => {
  try {
    const response = await fetch(PATH)
    if (!response.ok) return { kind: 'unavailable' }

    const body: unknown = await response.json()
    if (!isRecord(body) || !Array.isArray(body.plans) || !body.plans.every(isActivePlan)) {
      return { kind: 'unavailable' }
    }

    return { kind: 'loaded', plans: body.plans }
  } catch {
    return { kind: 'unavailable' }
  }
}

export const ActivePlansClient = { get }
