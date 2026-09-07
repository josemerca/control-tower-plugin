import { StartPlanOutcome, StartPlanRefusal, StartPlanResult, StartPlanSubmission } from 'app/start-plan/StartPlan.types'

const PATH = '/start-plan'
const ACCEPTED = 202

const bodyFor = ({ id, userComment, repo, path }: StartPlanSubmission): Record<string, string> => ({
  ...(id !== null ? { id } : {}),
  ...(userComment !== null ? { user_comment: userComment } : {}),
  repo,
  path,
})

const start = async (submission: StartPlanSubmission): Promise<StartPlanOutcome> => {
  let response: Response
  try {
    response = await fetch(PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyFor(submission)),
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
        root: started.root,
      },
    }
  }
  const refused = (await response.json()) as StartPlanRefusal
  return { kind: 'refused', error: refused.detail }
}

export const StartPlanClient = {
  start,
}
