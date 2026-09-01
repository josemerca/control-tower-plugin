import { describe, it, expect } from 'vitest'
import { PlanBriefing } from '../../src/domain/plan-briefing.js'
import { WorkspaceLocation } from '../../src/domain/workspace-location.js'
import { TicketKey } from '../../src/domain/ticket-key.js'

describe('PlanBriefing', () => {
  const located = new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' })
  const built = (errand = 'escribe el plan') =>
    new PlanBriefing({ ticket: new TicketKey('ABC-42'), issue: { number: 42 }, located, errand })

  it('it_carries_where_to_run_and_what_to_ask_for_because_a_session_needs_both', () => {
    expect(built().located.path).toBe('/repo/.worktrees/42')
    expect(built().errand).toBe('escribe el plan')
  })

  it('it_keeps_the_ticket_whole_so_the_tab_can_be_named_after_it', () => {
    expect(String(built().ticket)).toBe('ABC-42')
  })

  it('it_cannot_be_edited_after_it_is_built', () => {
    expect(Object.isFrozen(built())).toBe(true)
  })

  it('an_errand_with_nothing_in_it_refuses_to_exist_because_the_session_would_start_idle', () => {
    expect(() => built('   ')).toThrow(/errand/)
  })
})
