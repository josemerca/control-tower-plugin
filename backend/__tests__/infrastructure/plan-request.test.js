import { describe, it, expect } from 'vitest'
import { PlanRequest, PlanRequestOutcome } from '../../src/infrastructure/start-plan-route.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { PlanComment } from '../../src/domain/value-objects/plan-comment.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'

describe('PlanRequest', () => {
  it('every_outcome_is_distinct_so_no_two_refusals_answered_differently_collapse_into_one', () => {
    const members = Object.values(PlanRequestOutcome)

    expect(new Set(members).size).toBe(members.length)
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

  it('a_body_whose_path_is_not_an_absolute_path_comes_back_refused_and_not_as_a_malformed_repo', () => {
    const refused = [
      '{"id":"ABC-1","repo":"owner/name","path":"repos/name"}',
      '{"id":"ABC-1","repo":"owner/name","path":"~/repos/name"}',
      '{"id":"ABC-1","repo":"owner/name","path":""}',
      '{"id":"ABC-1","repo":"owner/name","path":123}',
      '{"id":"ABC-1","repo":"owner/name"}',
    ].map((raw) => PlanRequest.from(raw).outcome)

    expect(refused).toEqual(Array(5).fill(PlanRequestOutcome.MALFORMED_PATH))
  })

  it('a_trailing_slash_a_doubled_slash_or_a_trailing_newline_is_accepted_because_git_canonicalises_the_root_later', () => {
    const accepted = [
      '{"id":"ABC-1","repo":"owner/name","path":"/repos/name/"}',
      '{"id":"ABC-1","repo":"owner/name","path":"/repos//name"}',
      '{"id":"ABC-1","repo":"owner/name","path":"/repos/name\\n"}',
    ].map((raw) => PlanRequest.from(raw).outcome)

    expect(accepted).toEqual(Array(3).fill(PlanRequestOutcome.ACCEPTED))
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

  it('a_body_with_neither_an_id_nor_a_comment_is_refused_by_naming_both_fields', () => {
    expect(PlanRequest.from('{"repo":"owner/name","path":"/repo/checkout"}').outcome)
      .toBe(PlanRequestOutcome.NOTHING_TO_PLAN)
  })

  it('a_body_with_a_comment_and_no_id_is_accepted_because_the_comment_says_what_to_plan', () => {
    const accepted = PlanRequest.from(
      '{"user_comment":"añade el endpoint de salud","repo":"owner/name","path":"/repo/checkout"}'
    )

    expect(accepted.outcome).toBe(PlanRequestOutcome.ACCEPTED)
    expect(accepted.story).toBeNull()
  })

  it('a_comment_that_is_not_text_or_is_only_whitespace_is_refused_before_it_becomes_an_issue_body', () => {
    const refused = [
      '{"user_comment":123,"repo":"owner/name","path":"/repo/checkout"}',
      '{"user_comment":null,"repo":"owner/name","path":"/repo/checkout"}',
      '{"user_comment":"","repo":"owner/name","path":"/repo/checkout"}',
      '{"user_comment":"   ","repo":"owner/name","path":"/repo/checkout"}',
    ].map((raw) => PlanRequest.from(raw).outcome)

    expect(refused).toEqual(Array(4).fill(PlanRequestOutcome.MALFORMED_USER_COMMENT))
  })

  it('a_malformed_id_is_reported_before_the_comment_so_the_first_thing_wrong_is_what_gets_named', () => {
    expect(PlanRequest.from('{"id":"nope","user_comment":123}').outcome)
      .toBe(PlanRequestOutcome.MALFORMED_ID)
  })

  it('an_accepted_body_hands_back_the_comment_as_a_domain_value_and_not_as_the_raw_string', () => {
    const accepted = PlanRequest.from(
      '{"user_comment":"añade el endpoint de salud","repo":"josemerca/ct-loop-sandbox","path":"/repo/checkout"}'
    )

    expect(accepted.comment).toBeInstanceOf(PlanComment)
    expect(accepted.comment.text).toBe('añade el endpoint de salud')
  })

  it('the_refusal_about_a_field_carries_the_name_of_the_field_it_is_about', () => {
    expect(PlanRequest.from('{"id":"ABC-1"}').named).toBe('repo')
    expect(PlanRequest.from('{"id":"ABC-1","repo":"owner/name"}').named).toBe('path')
    expect(PlanRequest.from('{"repo":"owner/name","path":"/repo/checkout"}').named).toBeNull()
  })
})
