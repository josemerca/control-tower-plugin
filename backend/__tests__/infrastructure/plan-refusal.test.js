import { describe, it, expect } from 'vitest'
import { PlanRequest, PlanRequestOutcome } from '../../src/infrastructure/plan-request.js'
import { PlanRefusal } from '../../src/infrastructure/plan-refusal.js'

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
    expect(PlanRefusal.of(PlanRequest.withUnknownFields(['b', 'a']))).toEqual({
      status: 400,
      error: 'unknown field: b, a',
    })
  })

  it('a_body_over_the_cap_is_answered_with_the_status_that_names_the_size_and_not_a_plain_400', () => {
    expect(PlanRefusal.of(PlanRequest.tooLarge()).status).toBe(413)
  })
})
