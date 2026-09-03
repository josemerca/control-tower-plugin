import { ComponentProps } from 'react'
import { PlanProgress as Progress, usePlanProgress } from 'app/plan-events/usePlanProgress'
import { StartedPlan } from 'app/start-plan/StartPlan.types'
import { Banner } from 'system-ui/banner'
import './PlanProgress.css'

const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'

type BannerType = NonNullable<ComponentProps<typeof Banner>['type']>
type Look = { type: BannerType; role: 'alert' | null; title: string }

type SettledPhase = Exclude<Progress['phase'], 'failed'>

const LOOK_BY_PHASE: Record<SettledPhase, Look> = {
  connecting: { type: 'informative', role: null, title: 'Plan arrancado' },
  writing: { type: 'informative', role: null, title: 'Escribiendo el plan…' },
  ready: { type: 'success', role: null, title: 'Plan listo' },
  unreachable: { type: 'error', role: 'alert', title: UNREACHABLE_MESSAGE },
}

const lookFor = (progress: Progress): Look => {
  if (progress.phase === 'failed') return { type: 'error', role: 'alert', title: progress.error }

  return LOOK_BY_PHASE[progress.phase]
}

type PlanProgressProps = {
  plan: StartedPlan
}

const PlanProgress = ({ plan }: PlanProgressProps) => {
  const progress = usePlanProgress(plan.issue.number)
  const look = lookFor(progress)
  const roleProps = look.role === null ? {} : { role: look.role }

  const facts = (
    <span className="plan-progress__facts">
      Issue{' '}
      <a href={plan.issue.url} target="_blank" rel="noreferrer">
        #{plan.issue.number}
      </a>{' '}
      en <code>{plan.repo}</code> · agente <code>{plan.agent}</code>
    </span>
  )

  return (
    <section className="plan-progress" aria-label="Progreso del plan">
      <Banner type={look.type} title={look.title} description={facts} {...roleProps} />
    </section>
  )
}

export { PlanProgress }
export type { PlanProgressProps }
