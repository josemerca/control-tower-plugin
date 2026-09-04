import { describe, it, expect } from 'vitest'
import { PlanRequestOutcome, PlanCollapse } from '../../src/infrastructure/start-plan-route.js'
import { ImplementRequestOutcome, ImplementCollapse } from '../../src/infrastructure/implement-plan-route.js'
import { EventsRequestOutcome, PlanEvents } from '../../src/infrastructure/plan-events-route.js'

class Vocabularies {
  static #ACCEPTED = 'accepted'

  static requestCodes() {
    return [
      ...Object.values(PlanRequestOutcome),
      ...Object.values(ImplementRequestOutcome),
      ...Object.values(EventsRequestOutcome),
    ].filter((outcome) => outcome !== Vocabularies.#ACCEPTED)
  }
}

class Plumbing {
  static CODES = Object.freeze([
    'not-found', 'method-not-allowed', 'foreign-origin', 'unsupported-media-type', 'body-too-large', 'request-failed',
  ])
}

class EventStream {
  static CODES = Object.freeze([PlanEvents.PROGRESS_NOT_READ])
}

describe('the codes the api can emit', () => {
  it('are_all_distinct_so_the_frontend_can_decide_by_code_alone', () => {
    const sharedByField = new Set(Vocabularies.requestCodes())
    const codes = [
      ...sharedByField,
      ...PlanCollapse.declaredCodes(),
      ...ImplementCollapse.declaredCodes(),
      ...Plumbing.CODES,
      ...EventStream.CODES,
    ]

    expect(new Set(codes).size).toBe(codes.length)
  })
})
