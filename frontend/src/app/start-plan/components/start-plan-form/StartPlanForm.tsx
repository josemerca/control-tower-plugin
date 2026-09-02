import { FormEvent, useState } from 'react'
import { StartPlanClient } from 'app/start-plan/client'
import { StartPlanOutcome } from 'app/start-plan/StartPlan.types'
import { TicketKey } from 'app/start-plan/TicketKey'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { FormField } from 'system-ui/form-field'
import { Input } from 'system-ui/input'
import './StartPlanForm.css'

const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'

const StartPlanForm = () => {
  const [ticketKey, setTicketKey] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [outcome, setOutcome] = useState<StartPlanOutcome | null>(null)

  const canStart = TicketKey.isWellFormed(ticketKey) && !isSending

  const startPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSending(true)
    setOutcome(null)
    setOutcome(await StartPlanClient.start(ticketKey))
    setIsSending(false)
  }

  return (
    <form className="start-plan-form" onSubmit={startPlan}>
      <FormField label="Clave del ticket" message={`Con la forma ${TicketKey.EXAMPLE}`}>
        <Input
          placeholder={TicketKey.EXAMPLE}
          value={ticketKey}
          disabled={isSending}
          autoComplete="off"
          onChange={(event) => setTicketKey(event.target.value)}
        />
      </FormField>
      <div className="start-plan-form__actions">
        <Button type="submit" disabled={!canStart}>
          Arrancar plan
        </Button>
      </div>
      {outcome?.kind === 'started' && (
        <Banner type="success" title="Sesión arrancada:" description={<code>{outcome.session}</code>} descriptionLayout="inline" />
      )}
      {outcome?.kind === 'refused' && <Banner type="error" role="alert" title={outcome.error} />}
      {outcome?.kind === 'backend-unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
    </form>
  )
}

export { StartPlanForm }
