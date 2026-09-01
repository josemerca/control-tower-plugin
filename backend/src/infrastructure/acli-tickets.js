import { Tickets } from '../domain/tickets.js'
import { Ticket } from '../domain/ticket.js'
import { TicketNotRead, TicketNotUnderstood } from '../domain/exceptions.js'

export class AcliTickets extends Tickets {
  static #FIELDS = 'summary,description'
  static #UNAUTHENTICATED = /auth|login|unauthorized|401/i
  static #BREAKING_NODES = ['paragraph', 'heading', 'listItem']
  static #BLANK_RUN = /\n{3,}/g

  constructor({ run }) {
    super()
    this.run = run
  }

  static argvFor(key) {
    return ['jira', 'workitem', 'view', key.text, '--json', '--fields', AcliTickets.#FIELDS]
  }

  async detail(key) {
    let printed
    try {
      printed = await this.run(AcliTickets.argvFor(key))
    } catch (cause) {
      throw new TicketNotRead(AcliTickets.#reasonFor(cause.message))
    }
    const fields = AcliTickets.#fieldsIn(printed, key)
    return new Ticket({
      key,
      summary: AcliTickets.#summaryIn(fields, key),
      description: AcliTickets.plainText(fields.description),
    })
  }

  static #reasonFor(message) {
    return AcliTickets.#UNAUTHENTICATED.test(message)
      ? `acli is not authenticated, run "acli jira auth login" and try again: ${message}`
      : message
  }

  static #fieldsIn(printed, key) {
    let parsed
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new TicketNotUnderstood(
        `acli answered something that is not json for ${key}, it printed ${JSON.stringify(printed)}`
      )
    }
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.fields !== 'object' || parsed.fields === null) {
      throw new TicketNotUnderstood(
        `acli answered without the fields of ${key}, it printed ${JSON.stringify(printed)}`
      )
    }
    return parsed.fields
  }

  static #summaryIn(fields, key) {
    const { summary } = fields
    if (typeof summary !== 'string' || summary.trim().length === 0) {
      throw new TicketNotUnderstood(`${key} has no summary in jira, so there is nothing to plan`)
    }
    return summary.trim()
  }

  static plainText(description) {
    if (typeof description === 'string') return description.trim()
    if (description === null || typeof description !== 'object') return ''
    const parts = []
    AcliTickets.#walk(description, parts)
    return parts.join('').replace(AcliTickets.#BLANK_RUN, '\n\n').trim()
  }

  static #walk(node, parts) {
    if (node === null || typeof node !== 'object') return
    if (typeof node.text === 'string') parts.push(node.text)
    if (!Array.isArray(node.content)) return
    for (const child of node.content) AcliTickets.#walk(child, parts)
    if (AcliTickets.#BREAKING_NODES.includes(node.type)) parts.push('\n')
  }
}
