import { PlanRequestOutcome } from './plan-request.js'

export class PlanRefusal {
  static #BY_OUTCOME = Object.freeze({
    [PlanRequestOutcome.BODY_TOO_LARGE]: { status: 413, error: 'body must not exceed 8192 bytes' },
    [PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT]: { status: 400, error: 'body must be a JSON object' },
    [PlanRequestOutcome.MALFORMED_ID]: { status: 400, error: 'id must be a ticket key such as ABC-123' },
    [PlanRequestOutcome.UNKNOWN_FIELD]: { status: 400, error: null },
  })

  static of(asked) {
    const declared = PlanRefusal.#BY_OUTCOME[asked.outcome]
    if (declared === undefined) {
      throw new Error(`no refusal declared for outcome ${asked.outcome}`)
    }
    if (declared.error !== null) return declared
    return { status: declared.status, error: `unknown field: ${asked.fields.join(', ')}` }
  }

  static declaredOutcomes() {
    return Object.keys(PlanRefusal.#BY_OUTCOME)
  }
}
