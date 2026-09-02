import { describe, it, expect } from 'vitest'
import { PlanRequest, PlanRequestOutcome } from '../../src/infrastructure/plan-request.js'
import { PlanRefusal, PlanCollapse } from '../../src/infrastructure/plan-refusal.js'
import { Refusal } from '../../src/infrastructure/refusal.js'
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
    expect(refusal.error).toBe('unknown field: b, a')
  })

  it('a_status_that_is_not_a_refusal_or_a_reason_that_says_nothing_cannot_be_built', () => {
    expect(() => new Refusal({ status: 200, error: 'fine' }))
      .toThrow(/client or server status/)
    expect(() => new Refusal({ status: 400, error: '  ' })).toThrow(/says why/)
  })

  it('a_body_over_the_cap_is_answered_with_the_status_that_names_the_size_and_not_a_plain_400', () => {
    expect(PlanRefusal.of(PlanRequest.tooLarge()).status).toBe(413)
  })
})

describe('PlanCollapse', () => {
  const FAMILIES = ['PlanFailure', 'TicketFailure', 'PlanIssueFailure', 'PlanSessionFailure']

  it('every_way_the_plan_can_collapse_has_a_status_so_adding_one_cannot_reach_the_client_as_a_crash', () => {
    const ways = Object.entries(exceptions)
      .filter(([name, thrown]) =>
        thrown.prototype instanceof exceptions.PlanFailure && !FAMILIES.includes(name))
      .map(([name]) => name)

    expect(PlanCollapse.declaredFailures().sort()).toEqual(ways.sort())
  })

  it('a_tool_that_refused_the_call_is_something_to_try_again_and_says_so', () => {
    const collapse = PlanCollapse.of(new exceptions.TicketNotRead('acli is not authenticated'))

    expect(collapse).toBeInstanceOf(Refusal)
    expect(collapse.status).toBe(503)
    expect(collapse.error).toBe('could not start the plan: acli is not authenticated')
    expect(PlanCollapse.of(new exceptions.PlanIssueNotCreated('nope')).status).toBe(503)
    expect(PlanCollapse.of(new exceptions.PlanSessionNotStarted('nope')).status).toBe(503)
  })

  it('a_tool_that_answered_something_we_cannot_read_is_not_something_trying_again_would_fix', () => {
    expect(PlanCollapse.of(new exceptions.TicketNotUnderstood('nope')).status).toBe(502)
    expect(PlanCollapse.of(new exceptions.PlanIssueNotNamed('nope')).status).toBe(502)
    expect(PlanCollapse.of(new exceptions.PlanSessionNotNamed('nope')).status).toBe(502)
  })

  it('a_family_is_not_a_way_of_collapsing_so_answering_one_raises_instead_of_guessing', () => {
    expect(() => PlanCollapse.of(new exceptions.PlanFailure('nope'))).toThrow(/no status declared/)
  })
})
