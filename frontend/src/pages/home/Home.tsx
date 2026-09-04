import { useCallback, useState } from 'react'
import { ImplementPlanAction } from 'app/implement-plan/components/implement-plan-action'
import { PlanProgress } from 'app/plan-events/components/plan-progress'
import { StartPlanForm } from 'app/start-plan/components/start-plan-form'
import { StartedPlan } from 'app/start-plan/StartPlan.types'
import { Button } from 'system-ui/button'
import { TopBar } from 'system-ui/top-bar'
import { WorkflowStep, WorkflowStepStatus } from 'system-ui/workflow-step'
import './Home.css'

type WorkflowStepName = 'request' | 'plan' | 'implementation'

const Home = () => {
  const [started, setStarted] = useState<StartedPlan | null>(null)
  const [isPlanReady, setIsPlanReady] = useState(false)
  const [isImplementationStarted, setIsImplementationStarted] = useState(false)
  const [expandedStep, setExpandedStep] = useState<WorkflowStepName | null>('request')
  const [requestFormVersion, setRequestFormVersion] = useState(0)

  const expand = (step: WorkflowStepName) => (isExpanded: boolean) => setExpandedStep(isExpanded ? step : null)

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
    setIsImplementationStarted(false)
    setExpandedStep('request')
    setRequestFormVersion((version) => version + 1)
  }

  const requestStatus: WorkflowStepStatus = started === null ? 'active' : 'completed'
  const planStatus: WorkflowStepStatus = started === null ? 'pending' : isPlanReady ? 'completed' : 'active'
  const implementationStatus: WorkflowStepStatus = isPlanReady ? 'active' : 'pending'

  return (
    <div className="home">
      <TopBar productName="Control Tower" logo={<span className="home__logo">CT</span>} />
      <main className="home__content">
        <WorkflowStep title="Solicitud" status={requestStatus} isExpanded={expandedStep === 'request'} onExpandedChange={expand('request')}>
          <StartPlanForm key={requestFormVersion} onStarted={planStarted} isLocked={started !== null} />
        </WorkflowStep>
        {started !== null && (
          <WorkflowStep title="Plan" status={planStatus} isExpanded={expandedStep === 'plan'} onExpandedChange={expand('plan')}>
            <PlanProgress
              key={`${started.repo}:${started.issue.number}`}
              plan={started}
              onReady={planReady}
            />
          </WorkflowStep>
        )}
        <WorkflowStep
          title="Implementación"
          status={implementationStatus}
          isExpanded={expandedStep === 'implementation'}
          onExpandedChange={expand('implementation')}
        >
          {started !== null && isPlanReady && (
            <ImplementPlanAction plan={started} onImplementationStarted={() => setIsImplementationStarted(true)} />
          )}
          {isImplementationStarted && (
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
