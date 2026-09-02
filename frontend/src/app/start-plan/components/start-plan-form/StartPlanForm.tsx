import { FormEvent, useState } from 'react'
import { StartPlanClient } from 'app/start-plan/client'
import { StartPlanOutcome } from 'app/start-plan/StartPlan.types'
import { TicketKey } from 'app/start-plan/TicketKey'
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
      <label className="start-plan-form__label" htmlFor="ticket-key">
        Clave del ticket
      </label>
      <input
        id="ticket-key"
        className="start-plan-form__input"
        type="text"
        placeholder={TicketKey.EXAMPLE}
        value={ticketKey}
        disabled={isSending}
        onChange={(event) => setTicketKey(event.target.value)}
      />
      <button className="start-plan-form__button" type="submit" disabled={!canStart}>
        Arrancar plan
      </button>
      {outcome?.kind === 'started' && (
        <p className="start-plan-form__result start-plan-form__result--started" role="status">
          Sesión arrancada: <code>{outcome.session}</code>
        </p>
      )}
      {outcome?.kind === 'refused' && (
        <p className="start-plan-form__result start-plan-form__result--refused" role="alert">
          {outcome.error}
        </p>
      )}
      {outcome?.kind === 'backend-unreachable' && (
        <p className="start-plan-form__result start-plan-form__result--refused" role="alert">
          {UNREACHABLE_MESSAGE}
        </p>
      )}
    </form>
  )
}

export { StartPlanForm }
