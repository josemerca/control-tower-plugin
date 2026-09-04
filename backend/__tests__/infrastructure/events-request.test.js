import { describe, it, expect } from 'vitest'
import {
  EventsRequest, EventsRequestOutcome, EventsRefusal, PlanSessions,
} from '../../src/infrastructure/plan-events-route.js'
import { PlanRequest, PlanRequestOutcome, PlanRefusal } from '../../src/infrastructure/start-plan-route.js'
import { Refusal } from '../../src/infrastructure/http.js'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'

class Watched {
  static REPO = 'owner/name'
  static WATCH = new PlanWatch({
    issue: new PlanIssue({ number: 42, url: 'https://github.com/owner/name/issues/42' }),
    located: new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' }),
    repository: new RepositoryName(Watched.REPO),
  })

  static OTHER_REPO = 'other/name'
  static IN_ANOTHER_REPOSITORY = new PlanWatch({
    issue: new PlanIssue({ number: 42, url: 'https://github.com/other/name/issues/42' }),
    located: new WorkspaceLocation({ path: '/other/.worktrees/42', branch: 'feat/42' }),
    repository: new RepositoryName(Watched.OTHER_REPO),
  })

  static sessions() {
    const sessions = new PlanSessions()
    sessions.remember(Watched.WATCH)

    return sessions
  }

  static inTwoRepositories() {
    const sessions = Watched.sessions()
    sessions.remember(Watched.IN_ANOTHER_REPOSITORY)

    return sessions
  }

  static none() {
    return new PlanSessions()
  }
}

describe('EventsRequest', () => {
  it('every_outcome_is_distinct_so_no_two_refusals_answered_differently_collapse_into_one', () => {
    const members = Object.values(EventsRequestOutcome)

    expect(new Set(members).size).toBe(members.length)
  })

  it('an_issue_that_is_watched_arrives_carrying_the_watch_so_the_route_never_looks_it_up_again', () => {
    const asked = EventsRequest.from('42', Watched.REPO, Watched.sessions())

    expect(asked.outcome).toBe(EventsRequestOutcome.ACCEPTED)
    expect(asked.watched).toBe(Watched.WATCH)
  })

  it('an_issue_that_is_not_a_number_is_refused_by_name_instead_of_becoming_a_lookup_for_nan', () => {
    const asked = EventsRequest.from('abc', Watched.REPO, Watched.sessions())

    expect(asked.outcome).toBe(EventsRequestOutcome.MALFORMED_ISSUE)
    expect(asked.watched).toBe(null)
  })

  it('an_issue_numbered_from_zero_or_written_with_a_sign_is_malformed_because_no_issue_is_numbered_so', () => {
    expect(EventsRequest.from('0', Watched.REPO, Watched.sessions()).outcome).toBe(EventsRequestOutcome.MALFORMED_ISSUE)
    expect(EventsRequest.from('+7', Watched.REPO, Watched.sessions()).outcome).toBe(EventsRequestOutcome.MALFORMED_ISSUE)
    expect(EventsRequest.from('4.2', Watched.REPO, Watched.sessions()).outcome).toBe(EventsRequestOutcome.MALFORMED_ISSUE)
  })

  it('a_repository_that_is_missing_is_refused_instead_of_becoming_a_lookup_with_no_repository', () => {
    const asked = EventsRequest.from('42', undefined, Watched.sessions())

    expect(asked.outcome).toBe(EventsRequestOutcome.MALFORMED_REPO)
    expect(asked.watched).toBe(null)
  })

  it('a_repository_not_shaped_like_owner_slash_name_is_refused_before_it_becomes_a_lookup_key', () => {
    const asked = EventsRequest.from('42', 'nope', Watched.sessions())

    expect(asked.outcome).toBe(EventsRequestOutcome.MALFORMED_REPO)
    expect(asked.watched).toBe(null)
  })

  it('a_well_formed_issue_nobody_started_a_plan_for_is_told_apart_from_one_nobody_could_read', () => {
    const asked = EventsRequest.from('42', Watched.REPO, Watched.none())

    expect(asked.outcome).toBe(EventsRequestOutcome.NOT_WATCHED)
    expect(asked.watched).toBe(null)
  })

  it('an_issue_number_planned_in_two_repositories_is_told_apart_by_the_repository_the_request_names', () => {
    const sessions = Watched.inTwoRepositories()

    expect(EventsRequest.from('42', Watched.REPO, sessions).watched).toBe(Watched.WATCH)
    expect(EventsRequest.from('42', Watched.OTHER_REPO, sessions).watched).toBe(Watched.IN_ANOTHER_REPOSITORY)
  })
})

describe('EventsRefusal', () => {
  it('every_refusable_outcome_has_an_answer_so_adding_one_cannot_reach_the_client_as_a_crash', () => {
    const refusable = Object.values(EventsRequestOutcome).filter(
      (outcome) => outcome !== EventsRequestOutcome.ACCEPTED
    )

    expect(EventsRefusal.declaredOutcomes().sort()).toEqual(refusable.sort())
  })

  it('an_outcome_with_no_answer_raises_instead_of_being_served_as_a_blank_refusal', () => {
    expect(() => EventsRefusal.of({ outcome: 'invented' })).toThrow(/no refusal declared/)
  })

  it('an_issue_the_caller_wrote_wrong_and_a_plan_nobody_started_are_both_400_but_told_apart_by_code', () => {
    const malformed = EventsRefusal.of(EventsRequest.from('abc', Watched.REPO, Watched.none()))
    const missing = EventsRefusal.of(EventsRequest.from('42', Watched.REPO, Watched.none()))

    expect(malformed).toBeInstanceOf(Refusal)
    expect(malformed.status).toBe(400)
    expect(malformed.code).toBe(EventsRequestOutcome.MALFORMED_ISSUE)
    expect(missing.status).toBe(400)
    expect(missing.code).toBe(EventsRequestOutcome.NOT_WATCHED)
    expect(missing.detail).toBe(EventsRefusal.NOT_WATCHED)
  })

  it('a_repository_that_is_missing_or_malformed_is_refused_with_the_same_words_start_plan_uses_for_the_same_field', () => {
    const missing = EventsRefusal.of(EventsRequest.from('42', undefined, Watched.none()))
    const malformed = EventsRefusal.of(EventsRequest.from('42', 'nope', Watched.none()))
    const startPlanMalformedRepo = PlanRefusal.of(PlanRequest.refused(PlanRequestOutcome.MALFORMED_REPO))

    expect(missing.status).toBe(400)
    expect(missing.code).toBe(startPlanMalformedRepo.code)
    expect(missing.detail).toBe(startPlanMalformedRepo.detail)
    expect(malformed.detail).toBe(missing.detail)
  })
})
