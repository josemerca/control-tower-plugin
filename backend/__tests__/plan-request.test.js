import { describe, it, expect } from 'vitest'
import { PlanRequest, PlanRequestOutcome } from '../src/plan-request.js'

describe('PlanRequest', () => {
  it('every_outcome_is_distinct_so_no_two_refusals_answered_differently_collapse_into_one', () => {
    const members = Object.values(PlanRequestOutcome)

    expect(new Set(members).size).toBe(members.length)
    expect(Object.isFrozen(PlanRequestOutcome)).toBe(true)
  })

  it('a_refused_request_cannot_carry_an_id_that_a_consumer_would_then_act_on', () => {
    expect(() =>
      new PlanRequest({ outcome: PlanRequestOutcome.MALFORMED_ID, id: 'ABC-123', fields: [] })
    ).toThrow(/must carry a null id/)
  })

  it('an_accepted_request_cannot_be_built_around_an_id_that_is_not_a_ticket_key', () => {
    expect(() => PlanRequest.accepted('../../etc/passwd')).toThrow(/shaped like a ticket key/)
  })

  it('an_unknown_field_outcome_has_to_name_what_it_rejected_or_the_answer_says_nothing', () => {
    expect(() => PlanRequest.withUnknownFields([])).toThrow(/must name the fields/)
  })

  it('an_outcome_outside_the_vocabulary_raises_instead_of_travelling_on_as_a_string', () => {
    expect(() => PlanRequest.refused('invented')).toThrow(/PlanRequestOutcome member/)
  })

  it('an_accepted_request_cannot_be_edited_after_it_was_validated', () => {
    const asked = PlanRequest.accepted('ABC-123')

    expect(Object.isFrozen(asked)).toBe(true)
    expect(Object.isFrozen(asked.fields)).toBe(true)
  })
})
