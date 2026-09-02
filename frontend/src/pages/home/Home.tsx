import { StartPlanForm } from 'app/start-plan/components/start-plan-form'
import './Home.css'

const Home = () => {
  return (
    <main className="home">
      <h1 className="home__title">Control Tower</h1>
      <StartPlanForm />
    </main>
  )
}

export { Home }
