import { useEffect } from 'react'
import { usePlanProgress } from 'app/plan-events/usePlanProgress'
import { StartedPlan } from 'app/start-plan/StartPlan.types'
import { Banner } from 'system-ui/banner'
import './PlanProgress.css'

const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'

type PlanProgressProps = {
  plan: StartedPlan
  onReady: () => void
}

const PlanProgress = ({ plan, onReady }: PlanProgressProps) => {
  const progress = usePlanProgress(plan.issue.number, plan.repo)

  useEffect(() => {
    if (progress.phase === 'ready') onReady()
  }, [onReady, progress.phase])

  const facts = (
    <span className="plan-progress__facts">
      Issue{' '}
      <a href={plan.issue.url} target="_blank" rel="noreferrer">
        #{plan.issue.number}
      </a>{' '}
      en <code>{plan.repo}</code> · agente <code>{plan.agent}</code> · rama <code>{plan.branch}</code> · worktree{' '}
      <code>{plan.worktree}</code>
    </span>
  )

  return (
    <section className="plan-progress" aria-label="Progreso del plan">
      {progress.phase === 'connecting' && <p className="plan-progress__state" role="status">Plan arrancado</p>}
      {progress.phase === 'writing' && <p className="plan-progress__state" role="status">Escribiendo el plan…</p>}
      {progress.phase === 'ready' && <p className="plan-progress__state" role="status" aria-live="polite">Plan listo</p>}
      {progress.phase === 'failed' && <Banner type="error" role="alert" title={progress.error} />}
      {progress.phase === 'unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
      <p className="plan-progress__facts">{facts}</p>
    </section>
  )
}

export { PlanProgress }
export type { PlanProgressProps }
