import { describe, it, expect } from 'vitest'
import { PlanRequestOutcome, PlanCollapse } from '../../src/infrastructure/start-plan-route.js'
import { ImplementRequestOutcome, ImplementCollapse } from '../../src/infrastructure/implement-plan-route.js'
import { EventsRequestOutcome, PlanEvents } from '../../src/infrastructure/plan-events-route.js'
import { ProgressRequestOutcome, ProgressCollapse } from '../../src/infrastructure/implement-progress-route.js'

class RequestVocabularies {
  static #ACCEPTED = 'accepted'

  static codes() {
    return [
      ...Object.values(PlanRequestOutcome),
      ...Object.values(ImplementRequestOutcome),
      ...Object.values(EventsRequestOutcome),
      ...Object.values(ProgressRequestOutcome),
    ].filter((outcome) => outcome !== RequestVocabularies.#ACCEPTED)
  }
}

class SharedOnPurposeAcrossRequestVocabularies {
  static CODES = Object.freeze([
    PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT,
    PlanRequestOutcome.UNKNOWN_FIELD,
    PlanRequestOutcome.MALFORMED_REPO,
  ])
}

class Repeats {
  static within(codes) {
    const seen = new Map()
    for (const code of codes) seen.set(code, (seen.get(code) ?? 0) + 1)
    return [...seen.entries()].filter(([, count]) => count > 1).map(([code]) => code)
  }
}

class CodesRememberedByHandFromHttpAndApiServer {
  static VALUES = Object.freeze([
    'not-found', 'method-not-allowed', 'foreign-origin', 'unsupported-media-type', 'body-too-large', 'request-failed',
  ])
}

class EventStreamCodes {
  static VALUES = Object.freeze([PlanEvents.PROGRESS_NOT_READ])
}

describe('the codes the api can emit', () => {
  it('a_code_repeated_across_request_vocabularies_is_a_finding_unless_it_is_declared_shared_on_purpose', () => {
    const repeated = Repeats.within(RequestVocabularies.codes())

    expect(repeated.sort()).toEqual([...SharedOnPurposeAcrossRequestVocabularies.CODES].sort())
  })

  it('every_code_the_api_emits_is_distinct_though_six_of_them_are_remembered_by_hand_and_not_watched_for_a_rename', () => {
    const codes = [
      ...new Set(RequestVocabularies.codes()),
      ...PlanCollapse.declaredCodes(),
      ...ImplementCollapse.declaredCodes(),
      ...ProgressCollapse.declaredCodes(),
      ...CodesRememberedByHandFromHttpAndApiServer.VALUES,
      ...EventStreamCodes.VALUES,
    ]

    expect(new Set(codes).size).toBe(codes.length)
  })
})
