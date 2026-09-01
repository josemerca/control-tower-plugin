import { describe, it, expect } from 'vitest'
import { PlanIssueBody } from '../../src/infrastructure/plan-issue-body.js'
import { Ticket } from '../../src/domain/ticket.js'
import { TicketKey } from '../../src/domain/ticket-key.js'
import { mapGhIssue, extractAc, extractOrder } from '../../../plugin/scripts/gh-issue-map.js'
import { parseScope } from '../../../plugin/scripts/scope.js'

class Opened {
  static NUMBER = 41

  static ticket({ summary = 'El buscador acepta acentos', description = 'como comprador quiero' } = {}) {
    return new Ticket({ key: new TicketKey('MO_SHOP-42'), summary, description })
  }

  static asGithubSees(ticket = Opened.ticket()) {
    return {
      number: Opened.NUMBER,
      title: PlanIssueBody.titleFor(ticket),
      body: PlanIssueBody.of(ticket),
      labels: PlanIssueBody.labels().map((name) => ({ name })),
      milestone: null,
    }
  }

  static asTheDispatcherReadsIt(ticket = Opened.ticket()) {
    return mapGhIssue(Opened.asGithubSees(ticket))
  }
}

describe('PlanIssueBody', () => {
  it('the_dispatcher_reads_the_issue_as_ready_with_the_plan_gate_that_stops_it_for_a_human', () => {
    const seen = Opened.asTheDispatcherReadsIt()

    expect(seen.status).toBe('ready')
    expect(seen.gates).toEqual(['plan'])
    expect(seen.gatesDeclared).toBe(true)
  })

  it('with_no_order_marker_the_dispatcher_falls_back_to_the_issue_number_so_two_tickets_never_collide', () => {
    expect(extractOrder(PlanIssueBody.of(Opened.ticket()))).toBe(null)
    expect(Opened.asTheDispatcherReadsIt().n).toBe(Opened.NUMBER)
  })

  it('the_sections_nobody_wrote_are_read_as_empty_and_not_as_content_that_was_never_there', () => {
    const seen = Opened.asTheDispatcherReadsIt()

    expect(seen.ac).toEqual([])
    expect(seen.deps).toEqual([])
    expect(extractAc(PlanIssueBody.of(Opened.ticket()))).toEqual([])
  })

  it('what_jira_said_is_where_the_kickoff_sends_the_agent_to_read_it', () => {
    const body = PlanIssueBody.of(Opened.ticket({ description: 'la búsqueda ignora los acentos' }))

    expect(body).toContain('## Contexto del epic\nla búsqueda ignora los acentos')
    expect(body).toContain('## Descripción\nEl buscador acepta acentos')
  })

  it('a_ticket_with_no_description_says_the_user_story_is_unwritten_instead_of_leaving_a_blank', () => {
    const body = PlanIssueBody.of(Opened.ticket({ description: '   ' }))

    expect(body).toContain('MO_SHOP-42 no trae descripción en Jira')
  })

  it('the_scope_guard_finds_no_scope_declared_which_is_what_it_answers_when_it_cannot_check', () => {
    const scope = parseScope(PlanIssueBody.of(Opened.ticket()))

    expect(scope.declared).toBe(false)
    expect(scope.reason).toContain('no declara `Alcance:`')
  })

  it('the_title_names_the_ticket_because_without_a_slice_table_there_is_no_order_to_name', () => {
    expect(PlanIssueBody.titleFor(Opened.ticket())).toBe('MO_SHOP-42 El buscador acepta acentos')
  })

  it('every_section_the_plugin_writes_and_we_can_fill_is_there_in_the_order_it_writes_them', () => {
    const headings = PlanIssueBody.of(Opened.ticket()).split('\n').filter((line) => line.startsWith('## '))

    expect(headings).toEqual([
      '## Descripción',
      '## Contexto del epic',
      '## Contexto heredado',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '## Gates',
      '## Out of scope / Protected',
    ])
  })

  it('the_gates_section_tells_the_human_how_to_answer_the_go_instead_of_naming_the_gate_alone', () => {
    expect(PlanIssueBody.of(Opened.ticket())).toContain('-OK <nonce>')
  })
})
