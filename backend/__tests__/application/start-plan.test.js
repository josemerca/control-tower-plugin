import { describe, it, expect } from 'vitest'
import { StartPlan, StartPlanParams } from '../../src/application/actions/start-plan.js'
import { PlanSession } from '../../src/domain/plan-session.js'
import { PlanIssues } from '../../src/domain/plan-issues.js'
import { PlanIssue } from '../../src/domain/plan-issue.js'
import { Tickets } from '../../src/domain/tickets.js'
import { Ticket } from '../../src/domain/ticket.js'
import { TicketKey } from '../../src/domain/ticket-key.js'
import { RepositoryName } from '../../src/domain/repository-name.js'
import {
  PlanSessionNotStarted, PlanIssueNotCreated, TicketNotRead,
} from '../../src/domain/exceptions.js'

class TicketsDouble extends Tickets {
  constructor(answer) {
    super()
    this.answer = answer
    this.asked = []
  }

  static reading(summary) {
    return new TicketsDouble((key) => new Ticket({ key, summary, description: 'as a user I want' }))
  }

  async detail(key) {
    this.asked.push(key)
    if (this.answer instanceof Error) throw this.answer
    return this.answer(key)
  }
}

class PlanIssuesDouble extends PlanIssues {
  static OPENED = new PlanIssue({ number: 7, url: 'https://github.com/owner/name/issues/7' })

  constructor(answer = PlanIssuesDouble.OPENED) {
    super()
    this.answer = answer
    this.asked = []
  }

  async open({ ticket, repository }) {
    this.asked.push({ ticket, repository })
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
}

class PlanSessionDouble extends PlanSession {
  constructor(answer = 'workspace:4') {
    super()
    this.answer = answer
    this.asked = []
  }

  async start({ ticket, issue }) {
    this.asked.push({ ticket, issue })
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
}

class Flow {
  static TICKET = new TicketKey('MO_SHOP-42')
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')

  constructor({ tickets, planIssues, planSession } = {}) {
    this.tickets = tickets ?? TicketsDouble.reading('the summary of the ticket')
    this.planIssues = planIssues ?? new PlanIssuesDouble()
    this.planSession = planSession ?? new PlanSessionDouble()
  }

  async run(ticket = Flow.TICKET) {
    return new StartPlan(this).execute(
      new StartPlanParams({ ticket, repository: Flow.REPOSITORY })
    )
  }

  async refusal(ticket = Flow.TICKET) {
    return this.run(ticket).catch((cause) => cause)
  }
}

describe('StartPlan', () => {
  it('the_ticket_it_was_given_is_the_one_it_reads_before_anything_is_created', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.tickets.asked).toEqual([Flow.TICKET])
  })

  it('the_issue_is_opened_in_the_repository_the_caller_named_and_carries_what_jira_said', async () => {
    const flow = new Flow({ tickets: TicketsDouble.reading('rename the button') })

    await flow.run()

    const [asked] = flow.planIssues.asked
    expect(asked.repository).toBe(Flow.REPOSITORY)
    expect(asked.ticket.summary).toBe('rename the button')
    expect(asked.ticket.key).toBe(Flow.TICKET)
  })

  it('the_session_is_opened_on_the_issue_that_was_just_created_and_not_on_the_ticket_alone', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.planSession.asked).toEqual([
      { ticket: Flow.TICKET, issue: PlanIssuesDouble.OPENED },
    ])
  })

  it('both_the_issue_and_the_session_come_back_so_the_caller_can_reach_either_of_them_later', async () => {
    const started = await new Flow().run()

    expect(started.issue).toBe(PlanIssuesDouble.OPENED)
    expect(started.session).toBe('workspace:4')
  })

  it('a_ticket_that_cannot_be_read_stops_the_flow_before_an_issue_is_created_for_nothing', async () => {
    const flow = new Flow({ tickets: new TicketsDouble(new TicketNotRead('acli is not authenticated')) })

    const refusal = await flow.refusal()

    expect(refusal).toBeInstanceOf(TicketNotRead)
    expect(flow.planIssues.asked).toEqual([])
    expect(flow.planSession.asked).toEqual([])
  })

  it('an_issue_that_cannot_be_created_stops_the_flow_before_a_session_is_opened_for_nothing', async () => {
    const flow = new Flow({ planIssues: new PlanIssuesDouble(new PlanIssueNotCreated('label not found')) })

    const refusal = await flow.refusal()

    expect(refusal).toBeInstanceOf(PlanIssueNotCreated)
    expect(flow.planSession.asked).toEqual([])
  })

  it('a_session_that_refuses_to_start_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const flow = new Flow({ planSession: new PlanSessionDouble(new PlanSessionNotStarted('Access denied')) })

    const refusal = await flow.refusal()

    expect(refusal).toBeInstanceOf(PlanSessionNotStarted)
    expect(refusal.name).toBe('PlanSessionNotStarted')
    expect(refusal.message).toBe('Access denied')
  })

  it('the_ticket_reaches_the_session_whole_so_the_tab_can_be_named_after_it', async () => {
    const flow = new Flow()

    await flow.run()

    expect(String(flow.planSession.asked[0].ticket)).toBe('MO_SHOP-42')
  })

  it('a_ticket_with_no_summary_at_all_is_refused_by_the_value_object_and_not_carried_around_empty', async () => {
    const flow = new Flow({ tickets: TicketsDouble.reading(undefined) })

    await expect(flow.run()).rejects.toThrow(/a ticket carries text/)
  })

  it('a_ticket_that_is_not_keyed_by_a_ticket_key_cannot_be_built_at_all', () => {
    expect(() => new Ticket({ key: 'MO_SHOP-42', summary: 'a', description: 'b' }))
      .toThrow(/keyed by a TicketKey/)
  })

  it('an_issue_without_a_number_cannot_be_built_because_nothing_downstream_could_use_it', () => {
    expect(() => new PlanIssue({ number: 0, url: 'https://github.com/owner/name/issues/0' }))
      .toThrow(/numbered from one/)
    expect(() => new PlanIssue({ number: 7, url: '' })).toThrow(/reachable at a url/)
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanSession().start({ ticket: Flow.TICKET, issue: PlanIssuesDouble.OPENED }))
      .rejects.toThrow(/must implement start/)
    await expect(new PlanIssues().open({ ticket: null, repository: Flow.REPOSITORY }))
      .rejects.toThrow(/must implement open/)
    await expect(new Tickets().detail(Flow.TICKET)).rejects.toThrow(/must implement detail/)
  })
})
