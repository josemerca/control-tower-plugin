import { describe, it, expect } from 'vitest'
import {
  PlanRequest, PlanRequestOutcome, PlanRefusal, PlanCollapse,
} from '../../src/infrastructure/start-plan-route.js'
import { ImplementCollapse } from '../../src/infrastructure/implement-plan-route.js'
import { Refusal } from '../../src/infrastructure/http.js'
import * as exceptions from '../../src/domain/exceptions.js'

describe('PlanRefusal', () => {
  it('every_refusable_outcome_has_an_answer_so_adding_one_cannot_reach_the_client_as_a_crash', () => {
    const refusable = Object.values(PlanRequestOutcome).filter(
      (outcome) => outcome !== PlanRequestOutcome.ACCEPTED
    )

    expect(PlanRefusal.declaredOutcomes().sort()).toEqual(refusable.sort())
  })

  it('an_outcome_with_no_answer_raises_instead_of_being_served_as_a_blank_refusal', () => {
    expect(() => PlanRefusal.of({ outcome: 'invented' })).toThrow(/no refusal declared/)
  })

  it('the_rejected_field_names_reach_the_answer_instead_of_a_generic_sentence', () => {
    const refusal = PlanRefusal.of(PlanRequest.withUnknownFields(['b', 'a']))

    expect(refusal).toBeInstanceOf(Refusal)
    expect(refusal.status).toBe(400)
    expect(refusal.code).toBe(PlanRequestOutcome.UNKNOWN_FIELD)
    expect(refusal.detail).toBe('unknown field: b, a')
  })
})

describe('PlanCollapse', () => {
  const FAMILIES = [
    'PlanFailure', 'UserStoryFailure', 'PlanIssueFailure', 'PlanAgentFailure', 'WorkspaceFailure',
    'PlanProgressFailure', 'PlanChangesFailure', 'GoFailure', 'HarvestFailure',
    'ImplementationProgressFailure',
  ]

  const RESUMING_AN_AGENT = ImplementCollapse.declaredFailures()

  const startingAPlan = ([name, thrown]) =>
    thrown.prototype instanceof exceptions.PlanFailure &&
    !FAMILIES.includes(name) &&
    !RESUMING_AN_AGENT.includes(name) &&
    !(thrown.prototype instanceof exceptions.PlanProgressFailure) &&
    !(thrown.prototype instanceof exceptions.PlanChangesFailure) &&
    !(thrown.prototype instanceof exceptions.HarvestFailure) &&
    !(thrown.prototype instanceof exceptions.ImplementationProgressFailure)

  it('every_way_the_plan_can_collapse_has_a_refusal_declared_so_adding_one_cannot_reach_the_client_as_a_crash', () => {
    const ways = Object.entries(exceptions).filter(startingAPlan).map(([name]) => name)

    expect(PlanCollapse.declaredFailures().sort()).toEqual(ways.sort())
  })

  it('every_way_the_plan_can_collapse_has_a_code_distinct_from_every_other_one', () => {
    const codes = PlanCollapse.declaredCodes()

    expect(new Set(codes).size).toBe(codes.length)
  })

  it('a_failure_of_reading_the_changes_asked_for_has_no_refusal_declared_here_because_it_only_reaches_stderr', () => {
    expect(PlanCollapse.declaredFailures()).not.toContain('PlanChangesNotRead')
    expect(PlanCollapse.declaredFailures()).not.toContain('PlanChangesNotUnderstood')
    expect(() => PlanCollapse.of(new exceptions.PlanChangesNotRead('gh: not authenticated')))
      .toThrow(/no refusal declared/)
  })

  it('a_failure_of_watching_a_plan_has_no_refusal_declared_here_because_it_travels_down_the_stream_that_is_already_open', () => {
    expect(PlanCollapse.declaredFailures()).not.toContain('PlanProgressNotRead')
    expect(() => PlanCollapse.of(new exceptions.PlanProgressNotRead('git refused')))
      .toThrow(/no refusal declared/)
  })

  it('a_failure_of_harvesting_has_no_refusal_declared_here_because_the_sweep_answers_no_request', () => {
    expect(PlanCollapse.declaredFailures()).not.toContain('HarvestNotRead')
    expect(PlanCollapse.declaredFailures()).not.toContain('HarvestNotUnderstood')
    expect(() => PlanCollapse.of(new exceptions.HarvestNotRead('gh refused')))
      .toThrow(/no refusal declared/)
  })

  it('every_way_the_plan_can_collapse_answers_400_because_the_code_carries_the_distinction_now', () => {
    const causes = [
      new exceptions.UserStoryNotRead('acli is not authenticated'),
      new exceptions.PlanIssueNotCreated('nope'),
      new exceptions.PlanIssueNotClaimed('gh issue edit failed: nope'),
      new exceptions.PlanAgentNotLaunched('nope'),
      new exceptions.WorkspaceNotPrepared('branch is taken'),
      new exceptions.WorkspaceNotRead('no such remote'),
      new exceptions.CheckoutNotConfirmed('owner/name: /repo holds someone/else'),
      new exceptions.UserStoryNotUnderstood('nope'),
      new exceptions.PlanIssueNotNamed('nope'),
      new exceptions.PlanAgentNotNamed('nope'),
      new exceptions.WorkspaceNotUnderstood('nope'),
    ]

    expect(causes.map((cause) => PlanCollapse.of(cause).status)).toEqual(Array(causes.length).fill(400))
  })

  it('a_tool_that_refused_the_call_names_the_specific_way_it_refused_and_keeps_what_it_said', () => {
    const collapse = PlanCollapse.of(new exceptions.UserStoryNotRead('acli is not authenticated'))

    expect(collapse).toBeInstanceOf(Refusal)
    expect(collapse.code).toBe('user-story-not-read')
    expect(collapse.detail).toBe('acli is not authenticated')
  })

  it('a_checkout_that_does_not_hold_the_repository_asked_for_names_the_field_to_fix_and_keeps_what_git_said', () => {
    const collapse = PlanCollapse.of(new exceptions.CheckoutNotConfirmed('owner/name: /repo holds someone/else'))

    expect(collapse).toBeInstanceOf(Refusal)
    expect(collapse.code).toBe('checkout-not-confirmed')
    expect(collapse.detail).toBe('path must be a git checkout of owner/name: /repo holds someone/else')
  })

  it('an_issue_that_could_not_be_claimed_names_what_gh_said', () => {
    const collapse = PlanCollapse.of(new exceptions.PlanIssueNotClaimed('gh issue edit failed: nope'))

    expect(collapse.code).toBe('plan-issue-not-claimed')
    expect(collapse.detail).toBe('gh issue edit failed: nope')
  })

  it('a_tool_that_answered_something_we_cannot_read_has_its_own_code_too', () => {
    expect(PlanCollapse.of(new exceptions.UserStoryNotUnderstood('nope')).code).toBe('user-story-not-understood')
    expect(PlanCollapse.of(new exceptions.PlanIssueNotNamed('nope')).code).toBe('plan-issue-not-named')
    expect(PlanCollapse.of(new exceptions.PlanAgentNotNamed('nope')).code).toBe('plan-agent-not-named')
    expect(PlanCollapse.of(new exceptions.WorkspaceNotUnderstood('nope')).code).toBe('workspace-not-understood')
  })

  it('a_family_is_not_a_way_of_collapsing_so_answering_one_raises_instead_of_guessing', () => {
    expect(() => PlanCollapse.of(new exceptions.PlanFailure('nope'))).toThrow(/no refusal declared/)
  })
})
