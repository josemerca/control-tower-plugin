import { StartPlanForm } from 'app/start-plan/components/start-plan-form'
import { Panel } from 'system-ui/panel'
import { TopBar } from 'system-ui/top-bar'
import './Home.css'

const Home = () => {
  return (
    <div className="home">
      <TopBar productName="Control Tower" logo={<span className="home__logo">CT</span>} />
      <main className="home__content">
        <Panel heading="Arrancar plan" level={1}>
          <StartPlanForm />
        </Panel>
      </main>
    </div>
  )
}

export { Home }
