import { useEffect, useState } from 'react'
import { PlanEventsClient } from 'app/plan-events/client'
import { PullRequest } from 'app/plan-events/PlanEvents.types'

type PlanProgress =
  | { phase: 'connecting' }
  | { phase: 'writing' }
  | { phase: 'ready' }
  | { phase: 'implementing' }
  | { phase: 'in-review'; pullRequest: PullRequest }
  | { phase: 'fixing'; pullRequest: PullRequest }
  | { phase: 'failed'; error: string }
  | { phase: 'unreachable' }

const CONNECTING: PlanProgress = { phase: 'connecting' }

const usePlanProgress = (issue: number | null, repo: string | null): PlanProgress => {
  const [progress, setProgress] = useState<PlanProgress>(CONNECTING)

  useEffect(() => {
    if (issue === null || repo === null) return
    setProgress(CONNECTING)
    const subscription = PlanEventsClient.watch(issue, repo, {
      onState: (state, pullRequest) => setProgress(
        pullRequest === null
          ? ({ phase: state } as PlanProgress)
          : ({ phase: state, pullRequest } as PlanProgress)
      ),
      onFailure: (error) => setProgress({ phase: 'failed', error }),
      onUnreachable: () => setProgress({ phase: 'unreachable' }),
    })

    return subscription.close
  }, [issue, repo])

  return progress
}

export { usePlanProgress }
export type { PlanProgress }
