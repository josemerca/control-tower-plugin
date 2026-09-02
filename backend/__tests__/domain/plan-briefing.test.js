import { describe, it, expect } from 'vitest'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'

describe('PlanBriefing', () => {
  const located = new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' })
  const repository = new RepositoryName('josemerca/ct-loop-sandbox')
  const built = () =>
    new PlanBriefing({ story: new UserStoryKey('ABC-42'), issue: { number: 42 }, located, repository })

  it('it_carries_where_to_run_and_which_repository_the_issue_lives_in_because_the_agent_needs_both', () => {
    expect(built().located.path).toBe('/repo/.worktrees/42')
    expect(built().repository).toBe(repository)
  })

  it('it_keeps_the_story_whole_so_the_tab_can_be_named_after_it', () => {
    expect(String(built().story)).toBe('ABC-42')
  })

  it('a_story_that_was_never_validated_refuses_to_exist_because_it_becomes_the_name_of_the_cmux_tab', () => {
    const raw = { issue: { number: 42 }, located, repository }

    expect(() => new PlanBriefing({ ...raw, story: 'ABC-42' })).toThrow(/story/)
    expect(() => new PlanBriefing({ ...raw, story: undefined })).toThrow(/story/)
  })

  it('a_repository_that_was_never_validated_refuses_to_exist_because_it_becomes_an_argument_of_gh', () => {
    const raw = { story: new UserStoryKey('ABC-42'), issue: { number: 42 }, located }

    expect(() => new PlanBriefing({ ...raw, repository: 'josemerca/ct-loop-sandbox' })).toThrow(/repository/)
    expect(() => new PlanBriefing({ ...raw, repository: undefined })).toThrow(/repository/)
  })

  it('a_briefing_without_a_location_refuses_to_exist_instead_of_letting_the_cmux_adapter_crash_on_it_later', () => {
    expect(() => new PlanBriefing({
      story: new UserStoryKey('ABC-42'),
      issue: { number: 42 },
      located: undefined,
      repository,
    })).toThrow(/located/)
  })

  it('a_briefing_without_an_issue_refuses_to_exist_because_the_agent_has_nowhere_to_hydrate_from', () => {
    expect(() => new PlanBriefing({
      story: new UserStoryKey('ABC-42'),
      issue: undefined,
      located,
      repository,
    })).toThrow(/issue/)
  })
})
