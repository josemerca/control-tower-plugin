import { describe, it, expect } from 'vitest'
import { PlanIssueBody } from '../../src/infrastructure/plan-issue-body.js'
import { Ticket } from '../../src/domain/value-objects/ticket.js'
import { TicketKey } from '../../src/domain/value-objects/ticket-key.js'
import { mapGhIssue, extractAc, extractOrder } from '../../../plugin/scripts/gh-issue-map.js'
import { parseScope } from '../../../plugin/scripts/scope.js'
import { buildIssueBody } from '../../../plugin/scripts/groom.js'

class Groomed {
  static #ROW = {
    n: 1, name: 'un slice', entrega: 'lo que entrega', type: '', gate: '', e2e: '',
    ac: ['un criterio'], deps: [], protected: '',
  }

  static body() {
    return buildIssueBody(Groomed.#ROW, { path: 'spec.md', reason: 'sin remoto' }, 'contexto', null)
  }
}

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
      labels: PlanIssueBody.labels(ticket).map((name) => ({ name })),
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

  it('an_issue_number_written_in_jira_does_not_become_a_link_to_someone_elses_issue_here', () => {
    const body = PlanIssueBody.of(Opened.ticket({ description: 'Slice #7 del epic, sobre las vistas de #5' }))

    expect(body).toContain('Slice `#7` del epic, sobre las vistas de `#5`')
    expect(body.split('\n').filter((line) => /(?<![\w`])#\d+/.test(line))).toEqual([])
  })

  it('a_handle_written_in_jira_does_not_notify_whoever_owns_it_on_github', () => {
    const body = PlanIssueBody.of(Opened.ticket({ description: 'lo revisa @jjponz, escribe a foo@bar.com' }))

    expect(body).toContain('lo revisa `@jjponz`, escribe a foo@bar.com')
  })

  it('what_jira_already_wrote_as_code_is_left_alone_instead_of_being_fenced_twice', () => {
    expect(PlanIssueBody.quieted('ya viene en `#7` y suelto #8')).toBe('ya viene en `#7` y suelto `#8`')
  })

  it('the_headings_it_writes_are_the_ones_the_plugin_writes_so_a_rename_there_cannot_pass_unseen', () => {
    const groomed = Groomed.body()

    for (const heading of [
      PlanIssueBody.DESCRIPTION_HEADING,
      PlanIssueBody.AC_HEADING,
      PlanIssueBody.PROTECTED_HEADING,
    ]) {
      expect(groomed, `the plugin no longer writes ${heading}`).toContain(`\n${heading}\n`)
    }
  })

  it('a_summary_carrying_an_issue_number_does_not_reach_out_and_touch_that_issue_either', () => {
    const body = PlanIssueBody.of(Opened.ticket({ summary: 'Bug #4521 con @jjponz' }))

    expect(body).toContain('## Descripción\nBug `#4521` con `@jjponz`')
    expect(body.split('\n').filter((line) => /(?<![\w`])#\d+/.test(line))).toEqual([])
  })

  it('a_reference_written_the_long_way_round_reaches_the_other_repository_just_the_same', () => {
    expect(PlanIssueBody.quieted('ver mercadona/shop#123 ahora'))
      .toBe('ver `mercadona/shop#123` ahora')
    expect(PlanIssueBody.quieted('ver https://github.com/mercadona/shop/issues/9 ahora'))
      .toBe('ver `https://github.com/mercadona/shop/issues/9` ahora')
  })

  it('a_ticket_with_no_summary_worth_the_name_says_so_instead_of_leaving_the_section_blank', () => {
    expect(PlanIssueBody.of(Opened.ticket({ summary: '—' })))
      .toContain('_MO_SHOP-42 no trae resumen en Jira._')
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
