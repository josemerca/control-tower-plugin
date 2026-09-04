import { StartPlanOutcome, StartPlanRefusal, StartPlanRequest, StartPlanResult } from 'app/start-plan/StartPlan.types'

const PATH = '/start-plan'
const ACCEPTED = 202

const start = async ({ id, repo, path }: StartPlanRequest): Promise<StartPlanOutcome> => {
  let response: Response
  try {
    response = await fetch(PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, repo, path }),
    })
  } catch {
    return { kind: 'backend-unreachable' }
  }
  if (response.status === ACCEPTED) {
    const started = (await response.json()) as StartPlanResult
    return {
      kind: 'started',
      plan: {
        id: started.id,
        repo: started.repo,
        issue: started.issue,
        agent: started.agent,
        branch: started.branch,
        worktree: started.worktree,
      },
    }
  }
  const refused = (await response.json()) as StartPlanRefusal
  return { kind: 'refused', error: refused.error }
}

export const StartPlanClient = {
  start,
}
