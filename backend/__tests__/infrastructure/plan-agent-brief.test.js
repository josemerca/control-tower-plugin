import { describe, it, expect } from 'vitest'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PluginYardstick } from '../../../plugin/scripts/plugin-yardstick.js'

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

  it('it_orders_the_plan_published_on_the_issue_because_that_is_where_a_human_reads_it_to_ask_for_changes', () => {
    expect(errand()).toContain('gh issue comment 42 --repo owner/name')
    expect(errand()).toMatch(/publ/i)
  })

  it('it_orders_the_session_to_stop_after_committing_instead_of_starting_the_work', () => {
    expect(errand()).toMatch(/PARA/)
    expect(errand()).toMatch(/no implementes/i)
  })

  it('it_carries_the_order_of_precedence_verbatim_from_the_plugin_instead_of_wording_it_again', () => {
    expect(errand()).toContain('/plugin/conventions')
    expect(errand()).toContain(PluginYardstick.precedenceHeader())
  })

  it('the_precedence_it_carries_cannot_be_read_the_other_way_round', () => {
    expect(errand()).not.toMatch(/convenciones de este repo tienen PREFERENCIA/)
    expect(errand()).not.toMatch(/las convenciones de este repo ganan/i)
  })

  it('it_does_not_override_the_scope_the_architecture_document_declares_for_itself', () => {
    expect(errand()).not.toMatch(/la vara de arquitectura se aplica SIEMPRE/)
    expect(errand()).not.toMatch(/la única regla de la vara que este encargo cambia/i)
  })

  it('it_does_not_order_the_five_documents_read_before_planning', () => {
    expect(errand()).not.toMatch(/Lee la vara de Control Tower/)
    expect(errand()).not.toContain(PluginYardstick.FILES.join(', '))
  })

  it('it_names_the_sections_that_carry_what_the_acceptance_criteria_cannot', () => {
    expect(errand()).toContain('Contexto del epic')
    expect(errand()).toContain('Contexto heredado')
    expect(errand()).toMatch(/no lo busques fuera del issue/)
  })

  it('it_does_not_send_the_agent_to_a_section_the_body_never_writes', () => {
    expect(errand()).not.toMatch(/decisiones congeladas/i)
  })

  it('it_never_promises_a_permission_nobody_mints', () => {
    expect(errand()).not.toContain('-OK')
    expect(errand()).not.toContain('nonce')
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

  it('the_release_it_orders_waives_the_merge_watcher_because_this_flow_has_no_coordinator_to_notify', () => {
    expect(errand()).toContain('--release --no-watch-merge')
  })

  it('it_still_stops_before_the_merge_because_that_is_the_second_human_decision', () => {
    expect(errand()).toMatch(/no la mergees/i)
    expect(errand()).toMatch(/PARA/)
  })
})

describe('PlanAgentBrief asking the agent for changes', () => {
  const CHANGES = 'añade el caso\nde la issue sin\tdescripción'
  const errand = (changes = CHANGES) => new PlanAgentBrief({
    dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
    conventions: '/plugin/conventions',
    ctStep: '/plugin/scripts/ct-step.mjs',
  }).reviewErrandFor({ issueNumber: 42, repository: new RepositoryName('owner/name'), changes })

  it('the_errand_is_one_line_even_when_the_person_wrote_the_change_across_several', () => {
    expect(errand()).not.toContain('\n')
    expect(errand()).not.toContain('\t')
    expect(errand()).toContain('añade el caso de la issue sin descripción')
  })

  it('the_errand_names_the_issue_the_plan_and_the_command_that_validates_it', () => {
    expect(errand()).toContain('#42')
    expect(errand()).toContain('node /plugin/scripts/dispatch-check.mjs 42 --repo owner/name --check-plan')
    expect(errand()).toMatch(/no implementes/i)
  })

  it('the_errand_orders_the_reworked_plan_back_onto_the_issue_so_the_next_change_can_be_asked_for', () => {
    expect(errand()).toMatch(/publica/i)
    expect(errand()).toMatch(/comentario/i)
  })

  it('it_never_promises_a_permission_nobody_mints', () => {
    expect(errand()).not.toContain('-OK')
    expect(errand()).not.toContain('nonce')
  })
})
