import { describe, it, expect } from 'vitest'
import { PlanRequest, PlanRequestOutcome } from '../../src/infrastructure/start-plan-route.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'

describe('PlanRequest', () => {
  it('every_outcome_is_distinct_so_no_two_refusals_answered_differently_collapse_into_one', () => {
    const members = Object.values(PlanRequestOutcome)

    expect(new Set(members).size).toBe(members.length)
  })

  it('a_refused_request_cannot_carry_a_story_that_a_consumer_would_then_act_on', () => {
    expect(() =>
      new PlanRequest({
        outcome: PlanRequestOutcome.MALFORMED_ID,
        story: new UserStoryKey('ABC-123'),
        fields: [],
      })
    ).toThrow(/disagrees with its story/)
  })

  it('an_accepted_request_cannot_be_built_without_the_story_the_caller_will_read', () => {
    expect(() => PlanRequest.accepted(null, new RepositoryName('owner/name')))
      .toThrow(/disagrees with its story/)
  })

  it('an_accepted_request_cannot_be_built_without_the_repository_the_issue_goes_to', () => {
    expect(() => PlanRequest.accepted(new UserStoryKey('ABC-123'), null))
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

  it('a_body_whose_id_is_not_a_story_key_comes_back_refused_rather_than_raising_at_the_boundary', () => {
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

  it('an_accepted_body_hands_back_the_story_as_a_domain_value_and_not_as_the_raw_string', () => {
    const accepted = PlanRequest.from('{"id":"MO_SHOP-42","repo":"josemerca/ct-loop-sandbox","path":"/repo/checkout"}')

    expect(accepted.story).toBeInstanceOf(UserStoryKey)
    expect(accepted.story.text).toBe('MO_SHOP-42')
  })

  it('an_accepted_body_hands_back_the_repository_as_a_domain_value_too', () => {
    const accepted = PlanRequest.from('{"id":"MO_SHOP-42","repo":"josemerca/ct-loop-sandbox","path":"/repo/checkout"}')

    expect(accepted.repository).toBeInstanceOf(RepositoryName)
    expect(accepted.repository.text).toBe('josemerca/ct-loop-sandbox')
  })

  it('an_unknown_field_outcome_has_to_name_what_it_rejected_or_the_answer_says_nothing', () => {
    expect(() => PlanRequest.withUnknownFields([])).toThrow(/must name the fields/)
  })

  it('an_outcome_outside_the_vocabulary_raises_instead_of_travelling_on_as_a_string', () => {
    expect(() => PlanRequest.refused('invented')).toThrow(/PlanRequestOutcome member/)
  })

  it('an_accepted_request_cannot_be_built_without_the_root_the_worktree_is_cut_in', () => {
    expect(() => PlanRequest.accepted(new UserStoryKey('ABC-123'), new RepositoryName('owner/name'), null))
      .toThrow(/disagrees with its root/)
  })

  it('a_body_whose_path_is_not_an_absolute_path_comes_back_refused_and_not_as_a_malformed_repo', () => {
    const refused = [
      '{"id":"ABC-1","repo":"owner/name","path":"repos/name"}',
      '{"id":"ABC-1","repo":"owner/name","path":"~/repos/name"}',
      '{"id":"ABC-1","repo":"owner/name","path":"/repos/name/"}',
      '{"id":"ABC-1","repo":"owner/name","path":"/repos//name"}',
      '{"id":"ABC-1","repo":"owner/name","path":"/repos/name\\n"}',
      '{"id":"ABC-1","repo":"owner/name","path":""}',
      '{"id":"ABC-1","repo":"owner/name","path":123}',
      '{"id":"ABC-1","repo":"owner/name"}',
    ].map((raw) => PlanRequest.from(raw).outcome)

    expect(refused).toEqual(Array(8).fill(PlanRequestOutcome.MALFORMED_PATH))
  })

  it('a_malformed_repo_is_reported_before_the_path_so_the_first_thing_wrong_is_what_gets_named', () => {
    expect(PlanRequest.from('{"id":"ABC-1","repo":"nope","path":"nope"}').outcome)
      .toBe(PlanRequestOutcome.MALFORMED_REPO)
  })

  it('an_accepted_body_hands_back_the_root_as_a_domain_value_too', () => {
    const accepted = PlanRequest.from(
      '{"id":"MO_SHOP-42","repo":"josemerca/ct-loop-sandbox","path":"/Users/someone/repos/ct-loop-sandbox"}'
    )

    expect(accepted.root).toBeInstanceOf(CheckoutRoot)
    expect(accepted.root.text).toBe('/Users/someone/repos/ct-loop-sandbox')
  })

  it('a_path_with_spaces_in_a_segment_is_still_well_formed_because_a_home_directory_can_carry_one', () => {
    expect(PlanRequest.from('{"id":"ABC-1","repo":"owner/name","path":"/Users/some one/repos/name"}').outcome)
      .toBe(PlanRequestOutcome.ACCEPTED)
  })
})
