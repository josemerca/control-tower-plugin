import { Tickets } from '../domain/ports/tickets.js'
import { Ticket } from '../domain/value-objects/ticket.js'
import { TicketNotRead, TicketNotUnderstood } from '../domain/exceptions.js'

export class AcliTickets extends Tickets {
  static BIN = 'acli'

  static #FIELDS = 'summary,description'
  static #UNAUTHENTICATED = /auth|login|unauthorized|401/i
  static #BREAKING_NODES = ['paragraph', 'heading', 'listItem']
  static #BLANK_RUN = /\n{3,}/g

  constructor({ acli }) {
    super()
    this.acli = acli
  }

  static argvFor(key) {
    return ['jira', 'workitem', 'view', key.text, '--json', '--fields', AcliTickets.#FIELDS]
  }

  async detail(key) {
    const argv = AcliTickets.argvFor(key)
    const output = await this.acli.run(argv, { safeToRepeat: true })
    if (output.failed) {
      throw new TicketNotRead(
        `${AcliTickets.BIN} ${argv[0]} failed: ${AcliTickets.#reasonFor(output.stderr.trim())}`
      )
    }

    return AcliTickets.#ticketFrom(output.stdout, key)
  }

  static #reasonFor(message) {
    return AcliTickets.#UNAUTHENTICATED.test(message)
      ? `${AcliTickets.BIN} is not authenticated, run "acli jira auth login" and try again: ${message}`
      : message
  }

  static #ticketFrom(printed, key) {
    const fields = AcliTickets.#fieldsIn(printed, key)

    return new Ticket({
      key,
      summary: AcliTickets.#summaryIn(fields, key),
      description: AcliTickets.#plainText(fields.description),
    })
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

  static #plainText(description) {
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
