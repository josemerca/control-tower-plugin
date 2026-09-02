import { describe, it, expect } from 'vitest'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'

describe('PlanBriefing', () => {
  const located = new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' })
  const built = (errand = 'escribe el plan') =>
    new PlanBriefing({ story: new UserStoryKey('ABC-42'), issue: { number: 42 }, located, errand })

  it('it_carries_where_to_run_and_what_to_ask_for_because_a_session_needs_both', () => {
    expect(built().located.path).toBe('/repo/.worktrees/42')
    expect(built().errand).toBe('escribe el plan')
  })

  it('it_keeps_the_story_whole_so_the_tab_can_be_named_after_it', () => {
    expect(String(built().story)).toBe('ABC-42')
  })

  it('it_cannot_be_edited_after_it_is_built', () => {
    expect(Object.isFrozen(built())).toBe(true)
  })

  it('an_errand_with_nothing_in_it_refuses_to_exist_because_the_agent_would_start_idle', () => {
    expect(() => built('   ')).toThrow(/errand/)
  })

  it('a_briefing_without_a_location_refuses_to_exist_instead_of_letting_the_cmux_adapter_crash_on_it_later', () => {
    expect(() => new PlanBriefing({
      story: new UserStoryKey('ABC-42'),
      issue: { number: 42 },
      located: undefined,
      errand: 'escribe el plan',
    })).toThrow(/located/)
  })

  it('a_briefing_without_an_issue_refuses_to_exist_because_the_agent_has_nowhere_to_hydrate_from', () => {
    expect(() => new PlanBriefing({
      story: new UserStoryKey('ABC-42'),
      issue: undefined,
      located,
      errand: 'escribe el plan',
    })).toThrow(/issue/)
  })
})
