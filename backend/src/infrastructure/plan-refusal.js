import { PlanRequestOutcome } from './plan-request.js'
import { TicketKey } from '../domain/ticket-key.js'
import { RepositoryName } from '../domain/repository-name.js'
import { PlanRequest } from './plan-request.js'
import {
  TicketNotRead, TicketNotUnderstood, PlanIssueNotCreated, PlanIssueNotNamed,
  PlanSessionNotStarted, PlanSessionNotNamed,
} from '../domain/exceptions.js'

export class PlanRefusal {
  static #BY_OUTCOME = Object.freeze({
    [PlanRequestOutcome.BODY_TOO_LARGE]: () => ({ status: 413, error: 'body must not exceed 8192 bytes' }),
    [PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT]: () => ({ status: 400, error: 'body must be a JSON object' }),
    [PlanRequestOutcome.MALFORMED_ID]: () => ({
      status: 400,
      error: `${PlanRequest.ID_FIELD} must be a ticket key such as ${TicketKey.EXAMPLE}`,
    }),
    [PlanRequestOutcome.MALFORMED_REPO]: () => ({
      status: 400,
      error: `${PlanRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    }),
    [PlanRequestOutcome.UNKNOWN_FIELD]: (asked) => ({
      status: 400,
      error: `unknown field: ${asked.fields.join(', ')}`,
    }),
  })

  static of(asked) {
    const declared = PlanRefusal.#BY_OUTCOME[asked.outcome]
    if (declared === undefined) {
      throw new Error(`no refusal declared for outcome ${asked.outcome}`)
    }

    return declared(asked)
  }

  static declaredOutcomes() {
    return Object.keys(PlanRefusal.#BY_OUTCOME)
  }
}

export class PlanCollapse {
  static #REFUSED = 503
  static #ANSWERED_SOMETHING_ELSE = 502

  static #BY_FAILURE = [
    [TicketNotRead, PlanCollapse.#REFUSED],
    [PlanIssueNotCreated, PlanCollapse.#REFUSED],
    [PlanSessionNotStarted, PlanCollapse.#REFUSED],
    [TicketNotUnderstood, PlanCollapse.#ANSWERED_SOMETHING_ELSE],
    [PlanIssueNotNamed, PlanCollapse.#ANSWERED_SOMETHING_ELSE],
    [PlanSessionNotNamed, PlanCollapse.#ANSWERED_SOMETHING_ELSE],
  ]

  static of(cause) {
    const declared = PlanCollapse.#BY_FAILURE.find(([failure]) => cause.constructor === failure)
    if (declared === undefined) {
      throw new Error(`no status declared for ${cause.constructor.name}`)
    }

    return { status: declared[1], error: `could not start the plan: ${cause.message}` }
  }

  static declaredFailures() {
    return PlanCollapse.#BY_FAILURE.map(([failure]) => failure.name)
  }
}
