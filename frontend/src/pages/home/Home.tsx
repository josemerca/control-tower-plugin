import { useState } from 'react'
import { ImplementPlanAction } from 'app/implement-plan/components/implement-plan-action'
import { PlanProgress } from 'app/plan-events/components/plan-progress'
import { StartPlanForm } from 'app/start-plan/components/start-plan-form'
import { StartedPlan } from 'app/start-plan/StartPlan.types'
import { Button } from 'system-ui/button'
import { TopBar } from 'system-ui/top-bar'
import { WorkflowStep, WorkflowStepStatus } from 'system-ui/workflow-step'
import './Home.css'

const Home = () => {
  const [started, setStarted] = useState<StartedPlan | null>(null)
  const [isPlanReady, setIsPlanReady] = useState(false)
  const [isImplementationStarted, setIsImplementationStarted] = useState(false)

  const startAnotherPlan = () => {
    setStarted(null)
    setIsPlanReady(false)
    setIsImplementationStarted(false)
  }

  const requestStatus: WorkflowStepStatus = started === null ? 'active' : 'completed'
  const planStatus: WorkflowStepStatus = started === null ? 'pending' : isPlanReady ? 'completed' : 'active'
  const implementationStatus: WorkflowStepStatus = isPlanReady ? 'active' : 'pending'

  return (
    <div className="home">
      <TopBar productName="Control Tower" logo={<span className="home__logo">CT</span>} />
      <main className="home__content">
        <WorkflowStep title="Solicitud" status={requestStatus}>
          <StartPlanForm onStarted={setStarted} isLocked={started !== null} />
        </WorkflowStep>
        {started !== null && (
          <WorkflowStep title="Plan" status={planStatus}>
            <PlanProgress
              key={`${started.repo}:${started.issue.number}`}
              plan={started}
              onReady={() => setIsPlanReady(true)}
            />
          </WorkflowStep>
        )}
        <WorkflowStep title="Implementación" status={implementationStatus}>
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
