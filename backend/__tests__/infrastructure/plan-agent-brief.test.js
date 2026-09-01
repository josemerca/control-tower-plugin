import { describe, it, expect } from 'vitest'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.js'

describe('PlanAgentBrief', () => {
  const errand = () => new PlanAgentBrief({
    dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
    conventions: '/plugin/conventions',
  }).errandFor({ issue: { number: 42 }, repository: 'owner/name' })

  it('it_starts_by_asking_for_the_ground_to_be_checked_before_anything_is_touched', () => {
    expect(errand()).toMatch(/pwd/)
    expect(errand()).toMatch(/baseline/)
  })

  it('it_names_the_skill_that_writes_the_plan_instead_of_describing_the_shape_of_one', () => {
    expect(errand()).toContain('control-tower-loop:writing-plans-prescriptive')
  })

  it('it_interpolates_the_absolute_path_of_dispatch_check_because_the_plugin_token_stays_literal_in_plain_text', () => {
    expect(errand()).toContain('node /plugin/scripts/dispatch-check.mjs 42 --repo owner/name --check-plan')
    expect(errand()).not.toContain('CLAUDE_PLUGIN_ROOT')
  })

  it('it_says_where_the_plan_file_goes_so_the_contract_can_find_it_by_name', () => {
    expect(errand()).toContain('docs/superpowers/plans/YYYY-MM-DD-issue-42-<slug>.md')
  })

  it('it_orders_the_session_to_stop_after_committing_instead_of_starting_the_work', () => {
    expect(errand()).toMatch(/PARA/)
    expect(errand()).toMatch(/no implementes/i)
  })

  it('it_never_promises_a_permission_nobody_mints', () => {
    expect(errand()).not.toContain('-OK')
    expect(errand()).not.toContain('nonce')
  })

  it('a_brief_without_the_paths_it_interpolates_refuses_to_exist_instead_of_shipping_the_word_undefined', () => {
    expect(() => new PlanAgentBrief({ conventions: '/plugin/conventions' })).toThrow(/dispatch-check/)
    expect(() => new PlanAgentBrief({ dispatchCheck: '/x' })).toThrow(/yardstick/)
  })

  it('it_rejects_relative_paths_because_they_resolve_silently_wrong_in_the_agents_working_directory', () => {
    expect(() => new PlanAgentBrief({
      dispatchCheck: 'scripts/dispatch-check.mjs',
      conventions: '/plugin/conventions',
    })).toThrow(/dispatch-check/)
    expect(() => new PlanAgentBrief({
      dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
      conventions: 'plugin/conventions',
    })).toThrow(/yardstick/)
  })

  it('a_missing_repository_refuses_to_exist_instead_of_shipping_the_word_undefined_into_gh_issue_view', () => {
    const brief = new PlanAgentBrief({
      dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
      conventions: '/plugin/conventions',
    })

    expect(() => brief.errandFor({ issue: { number: 42 }, repository: undefined })).toThrow(/repository/)
  })

  it('a_repository_made_only_of_spaces_refuses_to_exist_the_same_as_a_missing_one', () => {
    const brief = new PlanAgentBrief({
      dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
      conventions: '/plugin/conventions',
    })

    expect(() => brief.errandFor({ issue: { number: 42 }, repository: '   ' })).toThrow(/repository/)
  })
})
