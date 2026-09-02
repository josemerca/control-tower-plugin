import { PlanRequestOutcome } from './plan-request.js'
import { UserStoryKey } from '../domain/value-objects/user-story-key.js'
import { RepositoryName } from '../domain/value-objects/repository-name.js'
import { PlanRequest } from './plan-request.js'
export class Refusal {
  constructor({ status, error }) {
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new Error(`a refusal answers with a client or server status, got ${JSON.stringify(status)}`)
    }
    if (typeof error !== 'string' || error.trim().length === 0) {
      throw new Error(`a refusal says why, got ${JSON.stringify(error)}`)
    }
    this.status = status
    this.error = error
    Object.freeze(this)
  }
}
import {
  UserStoryNotRead, UserStoryNotUnderstood, PlanIssueNotCreated, PlanIssueNotNamed,
  PlanAgentNotLaunched, PlanAgentNotNamed,
} from '../domain/exceptions.js'

export class PlanRefusal {
  static #BY_OUTCOME = Object.freeze({
    [PlanRequestOutcome.BODY_TOO_LARGE]: () =>
      new Refusal({ status: 413, error: 'body must not exceed 8192 bytes' }),
    [PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT]: () =>
      new Refusal({ status: 400, error: 'body must be a JSON object' }),
    [PlanRequestOutcome.MALFORMED_ID]: () => new Refusal({
      status: 400,
      error: `${PlanRequest.ID_FIELD} must be a user story key such as ${UserStoryKey.EXAMPLE}`,
    }),
    [PlanRequestOutcome.MALFORMED_REPO]: () => new Refusal({
      status: 400,
      error: `${PlanRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    }),
    [PlanRequestOutcome.UNKNOWN_FIELD]: (asked) => new Refusal({
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
    [UserStoryNotRead, PlanCollapse.#REFUSED],
    [PlanIssueNotCreated, PlanCollapse.#REFUSED],
    [PlanAgentNotLaunched, PlanCollapse.#REFUSED],
    [UserStoryNotUnderstood, PlanCollapse.#ANSWERED_SOMETHING_ELSE],
    [PlanIssueNotNamed, PlanCollapse.#ANSWERED_SOMETHING_ELSE],
    [PlanAgentNotNamed, PlanCollapse.#ANSWERED_SOMETHING_ELSE],
  ]

  static of(cause) {
    const declared = PlanCollapse.#BY_FAILURE.find(([failure]) => cause.constructor === failure)
    if (declared === undefined) {
      throw new Error(`no status declared for ${cause.constructor.name}`)
    }

    return new Refusal({ status: declared[1], error: `could not start the plan: ${cause.message}` })
  }

  static declaredFailures() {
    return PlanCollapse.#BY_FAILURE.map(([failure]) => failure.name)
  }
}
