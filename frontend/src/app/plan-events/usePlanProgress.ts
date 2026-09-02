import { useEffect, useState } from 'react'
import { PlanEventsClient } from 'app/plan-events/client'

type PlanProgress =
  | { phase: 'connecting' }
  | { phase: 'writing' }
  | { phase: 'ready' }
  | { phase: 'failed'; error: string }
  | { phase: 'unreachable' }

const CONNECTING: PlanProgress = { phase: 'connecting' }

const usePlanProgress = (issue: number): PlanProgress => {
  const [progress, setProgress] = useState<PlanProgress>(CONNECTING)

  useEffect(() => {
    setProgress(CONNECTING)
    const subscription = PlanEventsClient.watch(issue, {
      onState: (state) => setProgress({ phase: state }),
      onFailure: (error) => setProgress({ phase: 'failed', error }),
      onUnreachable: () => setProgress({ phase: 'unreachable' }),
    })

    return subscription.close
  }, [issue])

  return progress
}

export { usePlanProgress }
export type { PlanProgress }
