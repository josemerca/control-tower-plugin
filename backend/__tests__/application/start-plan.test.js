import { describe, it, expect } from 'vitest'
import { StartPlan, StartPlanParams } from '../../src/application/actions/start-plan.js'
import { PlanSession } from '../../src/domain/plan-session.js'
import { PlanSessionNotStarted } from '../../src/domain/exceptions.js'
import { TicketKey } from '../../src/domain/ticket-key.js'

class PlanSessionDouble extends PlanSession {
  constructor(answer) {
    super()
    this.answer = answer
    this.asked = []
  }

  async start(ticket) {
    this.asked.push(ticket)
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
}

describe('StartPlan', () => {
  it('the_ticket_it_was_given_is_the_one_the_session_is_asked_to_open', async () => {
    const planSession = new PlanSessionDouble('workspace:4')
    const ticket = new TicketKey('MO_SHOP-42')

    await new StartPlan({ planSession }).execute(new StartPlanParams({ ticket }))

    expect(planSession.asked).toEqual([ticket])
  })

  it('the_handle_the_session_answers_is_what_the_caller_gets_back', async () => {
    const planSession = new PlanSessionDouble('workspace:9')

    const started = await new StartPlan({ planSession })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-1') }))

    expect(started.session).toBe('workspace:9')
  })

  it('a_session_that_refuses_to_start_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const planSession = new PlanSessionDouble(new PlanSessionNotStarted('Access denied'))

    const refusal = await new StartPlan({ planSession })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-1') }))
      .catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanSessionNotStarted)
    expect(refusal.name).toBe('PlanSessionNotStarted')
    expect(refusal.message).toBe('Access denied')
  })

  it('neither_what_goes_in_nor_what_comes_out_can_be_edited_after_the_use_case_settled_it', async () => {
    const planSession = new PlanSessionDouble('workspace:4')
    const params = new StartPlanParams({ ticket: new TicketKey('ABC-1') })

    const started = await new StartPlan({ planSession }).execute(params)

    expect(Object.isFrozen(params)).toBe(true)
    expect(Object.isFrozen(started)).toBe(true)
  })

  it('the_ticket_reaches_the_session_whole_so_the_tab_can_be_named_after_it', async () => {
    const planSession = new PlanSessionDouble('workspace:4')

    await new StartPlan({ planSession })
      .execute(new StartPlanParams({ ticket: new TicketKey('MO_SHOP-42') }))

    expect(String(planSession.asked[0])).toBe('MO_SHOP-42')
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanSession().start(new TicketKey('ABC-1'))).rejects.toThrow(/must implement start/)
  })
})
