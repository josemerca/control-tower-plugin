import {
  ImplementPlanOutcome,
  ImplementPlanRefusal,
  ImplementPlanRequest,
  ImplementPlanResult,
} from 'app/implement-plan/ImplementPlan.types'

const PATH = '/implement-plan'
const ACCEPTED = 202

const implement = async ({ agent, issue, repo }: ImplementPlanRequest): Promise<ImplementPlanOutcome> => {
  let response: Response
  try {
    response = await fetch(PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, issue, repo }),
    })
  } catch {
    return { kind: 'backend-unreachable' }
  }
  if (response.status === ACCEPTED) {
    const implementing = (await response.json()) as ImplementPlanResult
    return { kind: 'implementing', agent: implementing.agent, issue: implementing.issue }
  }
  const refused = (await response.json()) as ImplementPlanRefusal
  return { kind: 'refused', error: refused.error }
}

export const ImplementPlanClient = {
  implement,
}
