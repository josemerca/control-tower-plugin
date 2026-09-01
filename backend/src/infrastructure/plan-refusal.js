import { PlanRequestOutcome } from './plan-request.js'
import { TicketKey } from '../domain/ticket-key.js'
import { RepositoryName } from '../domain/repository-name.js'
import { PlanRequest } from './plan-request.js'

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
