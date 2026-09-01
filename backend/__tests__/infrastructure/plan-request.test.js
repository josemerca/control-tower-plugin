import { describe, it, expect } from 'vitest'
import { PlanRequest, PlanRequestOutcome } from '../../src/infrastructure/plan-request.js'
import { TicketKey } from '../../src/domain/ticket-key.js'
import { RepositoryName } from '../../src/domain/repository-name.js'

describe('PlanRequest', () => {
  it('every_outcome_is_distinct_so_no_two_refusals_answered_differently_collapse_into_one', () => {
    const members = Object.values(PlanRequestOutcome)

    expect(new Set(members).size).toBe(members.length)
    expect(Object.isFrozen(PlanRequestOutcome)).toBe(true)
  })

  it('a_refused_request_cannot_carry_a_ticket_that_a_consumer_would_then_act_on', () => {
    expect(() =>
      new PlanRequest({
        outcome: PlanRequestOutcome.MALFORMED_ID,
        ticket: new TicketKey('ABC-123'),
        fields: [],
      })
    ).toThrow(/disagrees with its ticket/)
  })

  it('an_accepted_request_cannot_be_built_without_the_ticket_the_caller_will_read', () => {
    expect(() => PlanRequest.accepted(null, new RepositoryName('owner/name')))
      .toThrow(/disagrees with its ticket/)
  })

  it('an_accepted_request_cannot_be_built_without_the_repository_the_issue_goes_to', () => {
    expect(() => PlanRequest.accepted(new TicketKey('ABC-123'), null))
      .toThrow(/disagrees with its repository/)
  })

  it('a_body_whose_repo_is_not_a_repository_comes_back_refused_and_not_as_a_malformed_id', () => {
    const refused = [
      '{"id":"ABC-1","repo":"name"}',
      '{"id":"ABC-1","repo":"owner/name/extra"}',
      '{"id":"ABC-1","repo":"-o/name"}',
      '{"id":"ABC-1","repo":"owner/.."}',
      '{"id":"ABC-1"}',
    ].map((raw) => PlanRequest.from(raw).outcome)

    expect(refused).toEqual(Array(5).fill(PlanRequestOutcome.MALFORMED_REPO))
  })

  it('a_malformed_id_is_reported_before_the_repo_so_the_first_thing_wrong_is_what_gets_named', () => {
    expect(PlanRequest.from('{"id":"nope","repo":"nope"}').outcome)
      .toBe(PlanRequestOutcome.MALFORMED_ID)
  })

  it('a_body_whose_id_is_not_a_ticket_key_comes_back_refused_rather_than_raising_at_the_boundary', () => {
    const refused = [
      '{"id":"abc-1","repo":"owner/name"}',
      '{"id":"../../etc/passwd","repo":"owner/name"}',
      '{"id":123,"repo":"owner/name"}',
      '{"id":"   ","repo":"owner/name"}',
    ].map((raw) => PlanRequest.from(raw).outcome)

    expect(refused).toEqual(Array(4).fill(PlanRequestOutcome.MALFORMED_ID))
  })

  it('the_unknown_fields_come_back_in_a_settled_order_so_the_answer_does_not_depend_on_the_sender', () => {
    expect(PlanRequest.from('{"id":"ABC-1","zulu":1,"alpha":2}').fields).toEqual(['alpha', 'zulu'])
  })

  it('an_accepted_body_hands_back_the_ticket_as_a_domain_value_and_not_as_the_raw_string', () => {
    const accepted = PlanRequest.from('{"id":"MO_SHOP-42","repo":"josemerca/ct-loop-sandbox"}')

    expect(accepted.ticket).toBeInstanceOf(TicketKey)
    expect(accepted.ticket.text).toBe('MO_SHOP-42')
    expect(Object.isFrozen(accepted.ticket)).toBe(true)
  })

  it('an_accepted_body_hands_back_the_repository_as_a_domain_value_too', () => {
    const accepted = PlanRequest.from('{"id":"MO_SHOP-42","repo":"josemerca/ct-loop-sandbox"}')

    expect(accepted.repository).toBeInstanceOf(RepositoryName)
    expect(accepted.repository.text).toBe('josemerca/ct-loop-sandbox')
    expect(Object.isFrozen(accepted.repository)).toBe(true)
  })

  it('an_unknown_field_outcome_has_to_name_what_it_rejected_or_the_answer_says_nothing', () => {
    expect(() => PlanRequest.withUnknownFields([])).toThrow(/must name the fields/)
  })

  it('an_outcome_outside_the_vocabulary_raises_instead_of_travelling_on_as_a_string', () => {
    expect(() => PlanRequest.refused('invented')).toThrow(/PlanRequestOutcome member/)
  })

  it('an_accepted_request_cannot_be_edited_after_it_was_validated', () => {
    const asked = PlanRequest.accepted(new TicketKey('ABC-123'), new RepositoryName('owner/name'))

    expect(Object.isFrozen(asked)).toBe(true)
    expect(Object.isFrozen(asked.fields)).toBe(true)
  })
})
