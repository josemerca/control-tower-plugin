import { FormEvent, useRef, useState } from 'react'
import { StartPlanClient } from 'app/start-plan/client'
import { LocalPath } from 'app/start-plan/LocalPath'
import { RepositoryName } from 'app/start-plan/RepositoryName'
import { StartPlanOutcome, StartedPlan, StartPlanRequest } from 'app/start-plan/StartPlan.types'
import { TicketKey } from 'app/start-plan/TicketKey'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { FormField } from 'system-ui/form-field'
import { Input } from 'system-ui/input'
import './StartPlanForm.css'

type StartPlanRefusal = Exclude<StartPlanOutcome, { kind: 'started' }>

type StartPlanFormProps = {
  onStarted: (plan: StartedPlan, request: StartPlanRequest) => void
  onBackendUnreachable: (request: StartPlanRequest) => void
  onInteraction: () => void
  isLocked: boolean
  request?: StartPlanRequest
}

const StartPlanForm = ({ onStarted, onBackendUnreachable, onInteraction, isLocked, request }: StartPlanFormProps) => {
  const [ticketKey, setTicketKey] = useState('')
  const [repository, setRepository] = useState('')
  const [path, setPath] = useState('')
  const [isSending, setIsSending] = useState(false)
  const isSendingRef = useRef(false)
  const [refusal, setRefusal] = useState<StartPlanRefusal | null>(null)

  const canStart =
    TicketKey.isWellFormed(ticketKey) &&
    RepositoryName.isWellFormed(repository) &&
    LocalPath.isWellFormed(path) &&
    !isSending &&
    !isLocked

  const startPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSendingRef.current || isLocked) return
    onInteraction()
    isSendingRef.current = true
    setIsSending(true)
    setRefusal(null)
    const submitted = { id: ticketKey, repo: repository, path: LocalPath.normalize(path) }
    const outcome = await StartPlanClient.start(submitted)
    isSendingRef.current = false
    setIsSending(false)
    if (outcome.kind === 'started') {
      onStarted(outcome.plan, submitted)
      return
    }
    if (outcome.kind === 'backend-unreachable') onBackendUnreachable(submitted)
    setRefusal(outcome)
  }

  if (isLocked) {
    return (
      <dl className="start-plan-form__summary">
        <div>
          <dt>Ticket</dt>
          <dd>{request?.id ?? ticketKey}</dd>
        </div>
        <div>
          <dt>Repositorio</dt>
          <dd><code>{request?.repo ?? repository}</code></dd>
        </div>
        <div>
          <dt>Ruta local</dt>
          <dd><code>{request?.path ?? LocalPath.normalize(path)}</code></dd>
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
          onChange={(event) => {
            onInteraction()
            setTicketKey(event.target.value)
          }}
        />
      </FormField>
      <FormField label="Repositorio" message={`Con la forma ${RepositoryName.EXAMPLE}`}>
        <Input
          placeholder={RepositoryName.EXAMPLE}
          value={repository}
          disabled={isSending || isLocked}
          autoComplete="off"
          onChange={(event) => {
            onInteraction()
            setRepository(event.target.value)
          }}
        />
      </FormField>
      <FormField label="Ruta local" message={`Con la forma ${LocalPath.EXAMPLE}`}>
        <Input
          placeholder={LocalPath.EXAMPLE}
          value={path}
          disabled={isSending || isLocked}
          autoComplete="off"
          onChange={(event) => {
            onInteraction()
            setPath(event.target.value)
          }}
        />
      </FormField>
      <div className="start-plan-form__actions">
        <Button type="submit" disabled={!canStart}>
          Arrancar plan
        </Button>
      </div>
      {refusal?.kind === 'refused' && <Banner type="error" role="alert" title={refusal.error} />}
    </form>
  )
}

export { StartPlanForm }
export type { StartPlanFormProps }
