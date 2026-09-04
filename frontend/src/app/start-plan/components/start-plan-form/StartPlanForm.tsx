import { FormEvent, useState } from 'react'
import { StartPlanClient } from 'app/start-plan/client'
import { LocalPath } from 'app/start-plan/LocalPath'
import { RepositoryName } from 'app/start-plan/RepositoryName'
import { StartPlanOutcome, StartedPlan } from 'app/start-plan/StartPlan.types'
import { TicketKey } from 'app/start-plan/TicketKey'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { FormField } from 'system-ui/form-field'
import { Input } from 'system-ui/input'
import './StartPlanForm.css'

const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'

type StartPlanRefusal = Exclude<StartPlanOutcome, { kind: 'started' }>

type StartPlanFormProps = {
  onStarted: (plan: StartedPlan) => void
  isLocked: boolean
}

const StartPlanForm = ({ onStarted, isLocked }: StartPlanFormProps) => {
  const [ticketKey, setTicketKey] = useState('')
  const [repository, setRepository] = useState('')
  const [path, setPath] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [refusal, setRefusal] = useState<StartPlanRefusal | null>(null)

  const canStart =
    TicketKey.isWellFormed(ticketKey) &&
    RepositoryName.isWellFormed(repository) &&
    LocalPath.isWellFormed(path) &&
    !isSending &&
    !isLocked

  const startPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSending(true)
    setRefusal(null)
    const outcome = await StartPlanClient.start({ id: ticketKey, repo: repository, path: LocalPath.normalize(path) })
    setIsSending(false)
    if (outcome.kind === 'started') {
      onStarted(outcome.plan)
      return
    }
    setRefusal(outcome)
  }

  if (isLocked) {
    return (
      <dl className="start-plan-form__summary">
        <div>
          <dt>Ticket</dt>
          <dd>{ticketKey}</dd>
        </div>
        <div>
          <dt>Repositorio</dt>
          <dd><code>{repository}</code></dd>
        </div>
        <div>
          <dt>Ruta local</dt>
          <dd><code>{LocalPath.normalize(path)}</code></dd>
        </div>
      </dl>
    )
  }

  return (
    <form className="start-plan-form" onSubmit={startPlan}>
      <FormField label="Clave del ticket" message={`Con la forma ${TicketKey.EXAMPLE}`}>
        <Input
          placeholder={TicketKey.EXAMPLE}
          value={ticketKey}
          disabled={isSending || isLocked}
          autoComplete="off"
          onChange={(event) => setTicketKey(event.target.value)}
        />
      </FormField>
      <FormField label="Repositorio" message={`Con la forma ${RepositoryName.EXAMPLE}`}>
        <Input
          placeholder={RepositoryName.EXAMPLE}
          value={repository}
          disabled={isSending || isLocked}
          autoComplete="off"
          onChange={(event) => setRepository(event.target.value)}
        />
      </FormField>
      <FormField label="Ruta local" message={`Con la forma ${LocalPath.EXAMPLE}`}>
        <Input
          placeholder={LocalPath.EXAMPLE}
          value={path}
          disabled={isSending || isLocked}
          autoComplete="off"
          onChange={(event) => setPath(event.target.value)}
        />
      </FormField>
      <div className="start-plan-form__actions">
        <Button type="submit" disabled={!canStart}>
          Arrancar plan
        </Button>
      </div>
      {refusal?.kind === 'refused' && <Banner type="error" role="alert" title={refusal.error} />}
      {refusal?.kind === 'backend-unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
    </form>
  )
}

export { StartPlanForm }
export type { StartPlanFormProps }
