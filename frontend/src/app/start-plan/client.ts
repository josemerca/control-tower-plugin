import { StartPlanOutcome, StartPlanRefusal, StartPlanResult } from 'app/start-plan/StartPlan.types'

const PATH = '/start-plan'
const ACCEPTED = 202

const start = async (ticketKey: string): Promise<StartPlanOutcome> => {
  let response: Response
  try {
    response = await fetch(PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ticketKey }),
    })
  } catch {
    return { kind: 'backend-unreachable' }
  }
  if (response.status === ACCEPTED) {
    const started = (await response.json()) as StartPlanResult
    return { kind: 'started', session: started.session }
  }
  const refused = (await response.json()) as StartPlanRefusal
  return { kind: 'refused', error: refused.error }
}

export const StartPlanClient = {
  start,
}
