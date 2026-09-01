import { TicketKey } from '../domain/ticket-key.js'

export const PlanRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_TOO_LARGE: 'body-too-large',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_ID: 'malformed-id',
})

export class PlanRequest {
  static ID_FIELD = 'id'

  constructor({ outcome, ticket, fields }) {
    if (!Object.values(PlanRequestOutcome).includes(outcome)) {
      throw new Error(`outcome must be a PlanRequestOutcome member, got ${outcome}`)
    }
    if ((outcome === PlanRequestOutcome.ACCEPTED) === (ticket === null)) {
      throw new Error(`outcome ${outcome} disagrees with its ticket, got ${ticket}`)
    }
    if (outcome !== PlanRequestOutcome.UNKNOWN_FIELD && fields.length > 0) {
      throw new Error(`outcome ${outcome} must carry no fields, got ${fields.join(', ')}`)
    }
    if (outcome === PlanRequestOutcome.UNKNOWN_FIELD && fields.length === 0) {
      throw new Error('an unknown-field outcome must name the fields it rejected')
    }
    this.outcome = outcome
    this.ticket = ticket
    this.fields = Object.freeze([...fields])
    Object.freeze(this)
  }

  static accepted(ticket) {
    return new PlanRequest({ outcome: PlanRequestOutcome.ACCEPTED, ticket, fields: [] })
  }

  static refused(outcome) {
    return new PlanRequest({ outcome, ticket: null, fields: [] })
  }

  static withUnknownFields(fields) {
    return new PlanRequest({ outcome: PlanRequestOutcome.UNKNOWN_FIELD, ticket: null, fields })
  }

  static tooLarge() {
    return PlanRequest.refused(PlanRequestOutcome.BODY_TOO_LARGE)
  }

  static from(raw) {
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return PlanRequest.refused(PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return PlanRequest.refused(PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    const unknown = Object.keys(parsed).filter((field) => field !== PlanRequest.ID_FIELD)
    if (unknown.length > 0) {
      return PlanRequest.withUnknownFields(unknown.sort())
    }
    const given = parsed[PlanRequest.ID_FIELD]
    if (!TicketKey.isWellFormed(given)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_ID)
    }
    return PlanRequest.accepted(new TicketKey(given))
  }
}
