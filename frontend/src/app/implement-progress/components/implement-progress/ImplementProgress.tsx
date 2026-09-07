import { ImplementationStep } from 'app/implement-progress/ImplementProgress.types'
import { useImplementProgress } from 'app/implement-progress/useImplementProgress'
import { Banner } from 'system-ui/banner'
import './ImplementProgress.css'

const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'
const WAITING_MESSAGE = 'Esperando a que arranque la implementación…'
const CONNECTING_MESSAGE = 'Comprobando el progreso de la implementación…'

const STEP_LABELS: Record<ImplementationStep, string> = {
  [ImplementationStep.STARTING]: 'Arrancando',
  [ImplementationStep.IMPLEMENT]: 'Implementando',
  [ImplementationStep.CONTROLS]: 'Revisando controles',
  [ImplementationStep.JUDGE]: 'Evaluando',
  [ImplementationStep.ADVISE]: 'Generando consejo',
  [ImplementationStep.COMMIT]: 'Guardando cambios',
  [ImplementationStep.RECONCILE]: 'Reconciliando',
  [ImplementationStep.GLOBAL]: 'Revisión global',
  [ImplementationStep.SLICE_JUDGE]: 'Evaluando el slice',
  [ImplementationStep.E2E]: 'Ejecutando pruebas end-to-end',
  [ImplementationStep.DELIVERED]: 'Entregado',
}

type ImplementProgressProps = {
  issue: number
  root: string
}

const ImplementProgress = ({ issue, root }: ImplementProgressProps) => {
  const progress = useImplementProgress(issue, root)

  return (
    <section className="implement-progress" aria-label="Progreso de la implementación">
      {progress.phase === 'connecting' && (
        <p className="implement-progress__state" role="status">{CONNECTING_MESSAGE}</p>
      )}
      {progress.phase === 'waiting' && (
        <p className="implement-progress__state" role="status">{WAITING_MESSAGE}</p>
      )}
      {progress.phase === 'progress' && (
        <p className="implement-progress__state" role="status" aria-live="polite">
          {STEP_LABELS[progress.step]}
          {progress.task !== null && progress.totalTasks !== null && ` · Tarea ${progress.task} de ${progress.totalTasks}`}
          {progress.name !== null && ` · ${progress.name}`}
          {progress.attempt !== null && ` · Intento ${progress.attempt}`}
          {progress.discards !== null && ` · Descartes: ${progress.discards}`}
        </p>
      )}
      {progress.phase === 'failed' && <Banner type="error" role="alert" title={progress.error} />}
      {progress.phase === 'unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
    </section>
  )
}

export { ImplementProgress }
export type { ImplementProgressProps }
