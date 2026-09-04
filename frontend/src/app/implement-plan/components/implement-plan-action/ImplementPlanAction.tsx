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
}

const ImplementPlanAction = ({ plan }: ImplementPlanActionProps) => {
  const [outcome, setOutcome] = useState<ImplementPlanOutcome | null>(null)
  const [isSending, setIsSending] = useState(false)

  const implementPlan = async () => {
    setIsSending(true)
    setOutcome(null)
    setOutcome(await ImplementPlanClient.implement({ agent: plan.agent, issue: plan.issue.number, repo: plan.repo }))
    setIsSending(false)
  }

  if (outcome?.kind === 'implementing') {
    return (
      <div className="implement-plan-action">
        <Banner
          type="success"
          title="Implementación arrancada"
          description={
            <span className="implement-plan-action__facts">
              El agente <code>{outcome.agent}</code> implementa el plan
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
