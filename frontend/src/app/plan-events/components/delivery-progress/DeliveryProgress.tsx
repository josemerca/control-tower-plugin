import { PlanProgress } from 'app/plan-events/usePlanProgress'
import { Banner } from 'system-ui/banner'
import './DeliveryProgress.css'

const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'

type DeliveryProgressProps = {
  progress: PlanProgress
}

const DeliveryProgress = ({ progress }: DeliveryProgressProps) => (
  <section className="delivery-progress" aria-label="Progreso de la entrega">
    {progress.phase === 'implementing' && (
      <p className="delivery-progress__state" role="status">Implementando…</p>
    )}
    {progress.phase === 'in-review' && (
      <p className="delivery-progress__state" role="status" aria-live="polite">
        <a href={progress.pullRequest.url} target="_blank" rel="noreferrer">
          Pull request #{progress.pullRequest.number}
        </a>{' '}
        en revisión
      </p>
    )}
    {progress.phase === 'fixing' && (
      <p className="delivery-progress__state" role="status" aria-live="polite">
        Corrigiendo lo pedido…
      </p>
    )}
    {progress.phase === 'failed' && <Banner type="error" role="alert" title={progress.error} />}
    {progress.phase === 'unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
  </section>
)

export { DeliveryProgress }
export type { DeliveryProgressProps }
