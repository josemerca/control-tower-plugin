import { useState } from 'react'
import { ImplementPlanClient } from 'app/implement-plan/client'
import { ImplementPlanOutcome } from 'app/implement-plan/ImplementPlan.types'
import { StartedPlan } from 'app/start-plan/StartPlan.types'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import './ImplementPlanAction.css'

const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'

type ImplementPlanActionProps = {
  plan: StartedPlan
  onImplementationStarted: () => void
  isImplementationStarted?: boolean
}

const ImplementPlanAction = ({ plan, onImplementationStarted, isImplementationStarted = false }: ImplementPlanActionProps) => {
  const [outcome, setOutcome] = useState<ImplementPlanOutcome | null>(null)
  const [isSending, setIsSending] = useState(false)

  const implementPlan = async () => {
    setIsSending(true)
    setOutcome(null)
    const outcome = await ImplementPlanClient.implement({ agent: plan.agent, issue: plan.issue.number, repo: plan.repo })
    setOutcome(outcome)
    setIsSending(false)
    if (outcome.kind === 'implementing') {
      onImplementationStarted()
    }
  }

  if (isImplementationStarted || outcome?.kind === 'implementing') {
    return (
      <div className="implement-plan-action">
        <Banner
          type="informative"
          title="Implementación en curso"
          description={
            <span className="implement-plan-action__facts">
              El agente <code>{outcome?.kind === 'implementing' ? outcome.agent : plan.agent}</code> implementa el plan
            </span>
          }
        />
      </div>
    )
  }

  return (
    <div className="implement-plan-action">
      <Button onClick={implementPlan} disabled={isSending}>
        Implementar plan
      </Button>
      {outcome?.kind === 'refused' && <Banner type="error" role="alert" title={outcome.error} />}
      {outcome?.kind === 'backend-unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
    </div>
  )
}

export { ImplementPlanAction }
export type { ImplementPlanActionProps }
