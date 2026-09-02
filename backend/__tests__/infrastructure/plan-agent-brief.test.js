import { describe, it, expect } from 'vitest'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'

describe('PlanAgentBrief', () => {
  const errand = () => new PlanAgentBrief({
    dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
    conventions: '/plugin/conventions',
    ctStep: '/plugin/scripts/ct-step.mjs',
  }).errandFor({ issue: { number: 42 }, repository: new RepositoryName('owner/name') })

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

  it('it_says_where_the_order_of_precedence_is_written_instead_of_restating_it_a_second_time', () => {
    expect(errand()).toContain('/plugin/conventions')
    expect(errand()).toContain('AGENTS.md')
    expect(errand()).not.toMatch(/preferencia/i)
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
      ctStep: '/plugin/scripts/ct-step.mjs',
    })

    expect(() => brief.errandFor({ issue: { number: 42 }, repository: undefined })).toThrow(/repository/)
  })

  it('a_repository_that_was_never_validated_is_refused_even_when_it_reads_like_a_good_one', () => {
    const brief = new PlanAgentBrief({
      dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
      conventions: '/plugin/conventions',
      ctStep: '/plugin/scripts/ct-step.mjs',
    })

    expect(() => brief.errandFor({ issue: { number: 42 }, repository: 'owner/name' })).toThrow(/repository/)
    expect(() => brief.errandFor({ issue: { number: 42 }, repository: '   ' })).toThrow(/repository/)
  })
})

describe('PlanAgentBrief resuming the agent', () => {
  const errand = () => new PlanAgentBrief({
    dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
    conventions: '/plugin/conventions',
    ctStep: '/plugin/scripts/ct-step.mjs',
  }).implementationErrandFor({ issueNumber: 42, repository: new RepositoryName('owner/name') })

  it('it_is_one_single_line_because_a_newline_would_run_the_order_half_written', () => {
    expect(errand()).not.toContain('\n')
  })

  it('it_hands_the_driving_to_ct_step_by_absolute_path_instead_of_describing_the_sequence', () => {
    expect(errand()).toContain('node /plugin/scripts/ct-step.mjs next --plan')
    expect(errand()).toContain('--issue 42')
    expect(errand()).not.toContain('CLAUDE_PLUGIN_ROOT')
  })

  it('it_translates_ct_step_to_node_by_absolute_path_because_ct_step_is_not_a_command', () => {
    expect(errand()).toContain('donde diga `ct-step`, es `node /plugin/scripts/ct-step.mjs`')
  })

  it('it_orders_rewriting_slice_md_role_task_and_next_action_before_asking_for_the_first_step', () => {
    const composed = errand()
    expect(composed).toContain('.agent/SLICE.md')
    expect(composed).toContain('role, task y next_action')
    expect(composed.indexOf('.agent/SLICE.md')).toBeLessThan(composed.indexOf('Pregunta el paso'))
  })

  it('it_orders_the_release_that_moves_the_issue_to_review_instead_of_forbidding_it', () => {
    expect(errand()).toContain(
      'node /plugin/scripts/dispatch-check.mjs 42 --repo owner/name --release'
    )
    expect(errand()).not.toMatch(/no ejecutes/i)
    expect(errand()).not.toContain('saldría por 9')
  })

  it('it_still_stops_before_the_merge_because_that_is_the_second_human_decision', () => {
    expect(errand()).toMatch(/no la mergees/i)
    expect(errand()).toMatch(/PARA/)
  })

  it('a_brief_that_cannot_name_ct_step_refuses_to_exist_instead_of_shipping_the_word_undefined', () => {
    expect(() => new PlanAgentBrief({
      dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
      conventions: '/plugin/conventions',
    })).toThrow(/ct-step/)
    expect(() => new PlanAgentBrief({
      dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
      conventions: '/plugin/conventions',
      ctStep: 'scripts/ct-step.mjs',
    })).toThrow(/ct-step/)
  })
})
