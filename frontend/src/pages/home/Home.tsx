import { useCallback, useEffect, useState } from 'react'
import { ImplementPlanAction } from 'app/implement-plan/components/implement-plan-action'
import { DeliveryProgress } from 'app/plan-events/components/delivery-progress'
import { PlanProgress } from 'app/plan-events/components/plan-progress'
import { PlanProgress as PlanProgressState, usePlanProgress } from 'app/plan-events/usePlanProgress'
import { StartPlanForm } from 'app/start-plan/components/start-plan-form'
import { StartedPlan } from 'app/start-plan/StartPlan.types'
import { Button } from 'system-ui/button'
import { TopBar } from 'system-ui/top-bar'
import { WorkflowStep, WorkflowStepStatus } from 'system-ui/workflow-step'
import './Home.css'

type WorkflowStepName = 'request' | 'plan' | 'implementation' | 'review'

const DELIVERED: PlanProgressState['phase'][] = ['in-review', 'fixing']

const Home = () => {
  const [started, setStarted] = useState<StartedPlan | null>(null)
  const [isPlanReady, setIsPlanReady] = useState(false)
  const [expandedStep, setExpandedStep] = useState<WorkflowStepName>('request')
  const [requestFormVersion, setRequestFormVersion] = useState(0)
  const progress = usePlanProgress(started?.issue.number ?? null, started?.repo ?? null)

  const expand = (step: WorkflowStepName) => (isExpanded: boolean) => {
    if (isExpanded) setExpandedStep(step)
  }

  const planStarted = useCallback((plan: StartedPlan) => {
    setStarted(plan)
    setExpandedStep('plan')
  }, [])

  const planReady = useCallback(() => {
    setIsPlanReady(true)
    setExpandedStep('implementation')
  }, [])

  const startAnotherPlan = () => {
    setStarted(null)
    setIsPlanReady(false)
    setExpandedStep('request')
    setRequestFormVersion((version) => version + 1)
  }

  const isDelivered = DELIVERED.includes(progress.phase)
  const showsDelivery = isPlanReady && progress.phase !== 'ready'

  useEffect(() => {
    if (showsDelivery) setExpandedStep('review')
  }, [showsDelivery])

  const requestStatus: WorkflowStepStatus = started === null ? 'active' : 'completed'
  const planStatus: WorkflowStepStatus = started === null ? 'pending' : isPlanReady ? 'completed' : 'active'
  const implementationStatus: WorkflowStepStatus = !isPlanReady
    ? 'pending'
    : isDelivered ? 'completed' : 'active'
  const reviewStatus: WorkflowStepStatus = isDelivered ? 'active' : 'pending'

  return (
    <div className="home">
      <TopBar productName="Control Tower" logo={<span className="home__logo">CT</span>} />
      <main className="home__content">
        <WorkflowStep
          title="Solicitud"
          status={requestStatus}
          isExpanded={expandedStep === 'request'}
          canCollapse={expandedStep !== 'request'}
          onExpandedChange={expand('request')}
        >
          <StartPlanForm key={requestFormVersion} onStarted={planStarted} isLocked={started !== null} />
        </WorkflowStep>
        {started !== null && (
          <WorkflowStep
            title="Plan"
            status={planStatus}
            isExpanded={expandedStep === 'plan'}
            canCollapse={expandedStep !== 'plan'}
            onExpandedChange={expand('plan')}
          >
            <PlanProgress
              key={`${started.repo}:${started.issue.number}`}
              plan={started}
              progress={progress}
              onReady={planReady}
            />
          </WorkflowStep>
        )}
        <WorkflowStep
          title="Implementación"
          status={implementationStatus}
          isExpanded={expandedStep === 'implementation'}
          canCollapse={expandedStep !== 'implementation'}
          onExpandedChange={expand('implementation')}
        >
          {started !== null && isPlanReady && (
            <ImplementPlanAction plan={started} onImplementationStarted={() => undefined} />
          )}
        </WorkflowStep>
        <WorkflowStep
          title="Revisión"
          status={reviewStatus}
          isExpanded={expandedStep === 'review'}
          canCollapse={expandedStep !== 'review'}
          onExpandedChange={expand('review')}
        >
          <DeliveryProgress progress={progress} />
          {isDelivered && (
            <Button className="home__start-another" type="button" variant="secondary" onClick={startAnotherPlan}>
              Arrancar otro plan
            </Button>
          )}
        </WorkflowStep>
      </main>
    </div>
  )
}

export { Home }
