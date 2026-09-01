import { TicketKey } from './ticket-key.js'

export class Ticket {
  constructor({ key, summary, description }) {
    if (!(key instanceof TicketKey)) {
      throw new Error(`a ticket is keyed by a TicketKey, got ${JSON.stringify(key)}`)
    }
    if (typeof summary !== 'string' || typeof description !== 'string') {
      throw new Error(`a ticket carries text, got summary ${JSON.stringify(summary)} and description ${JSON.stringify(description)}`)
    }
    this.key = key
    this.summary = summary
    this.description = description
    Object.freeze(this)
  }

  hasDescription() {
    return this.description.trim().length > 0
  }
}
