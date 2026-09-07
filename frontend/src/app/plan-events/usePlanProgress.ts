import { useEffect, useState } from 'react'
import { PlanEventsClient } from 'app/plan-events/client'

type PlanProgress =
  | { phase: 'connecting' }
  | { phase: 'writing' }
  | { phase: 'ready' }
  | { phase: 'failed'; error: string }
  | { phase: 'unreachable' }

const CONNECTING: PlanProgress = { phase: 'connecting' }

const usePlanProgress = (issue: number, repo: string): PlanProgress => {
  const [progress, setProgress] = useState<PlanProgress>(CONNECTING)

  useEffect(() => {
    setProgress(CONNECTING)
    let close: (() => void) | undefined
    const connection = window.setTimeout(() => {
      close = PlanEventsClient.watch(issue, repo, {
        onState: (state) => setProgress({ phase: state }),
        onFailure: (error) => setProgress({ phase: 'failed', error }),
        onUnreachable: () => setProgress({ phase: 'unreachable' }),
      }).close
    })

    return () => {
      window.clearTimeout(connection)
      close?.()
    }
  }, [issue, repo])

  return progress
}

export { usePlanProgress }
export type { PlanProgress }
