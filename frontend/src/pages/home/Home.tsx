import { useState } from 'react'
import { ImplementPlanAction } from 'app/implement-plan/components/implement-plan-action'
import { PlanProgress } from 'app/plan-events/components/plan-progress'
import { StartPlanForm } from 'app/start-plan/components/start-plan-form'
import { StartedPlan } from 'app/start-plan/StartPlan.types'
import { Panel } from 'system-ui/panel'
import { TopBar } from 'system-ui/top-bar'
import './Home.css'

const Home = () => {
  const [started, setStarted] = useState<StartedPlan | null>(null)

  return (
    <div className="home">
      <TopBar productName="Control Tower" logo={<span className="home__logo">CT</span>} />
      <main className="home__content">
        <Panel heading="Arrancar plan" level={1}>
          <StartPlanForm onStarted={setStarted} />
        </Panel>
        {started !== null && (
          <PlanProgress
            key={started.issue.number}
            plan={started}
            whenReady={<ImplementPlanAction plan={started} />}
          />
        )}
      </main>
    </div>
  )
}

export { Home }
