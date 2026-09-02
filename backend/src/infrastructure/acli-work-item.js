import { Ticket } from '../domain/value-objects/ticket.js'
import { TicketNotUnderstood } from '../domain/exceptions.js'

export class AcliWorkItem {
  static FIELDS = 'summary,description'

  static #BREAKING_NODES = ['paragraph', 'heading', 'listItem']
  static #BLANK_RUN = /\n{3,}/g

  static ticketFrom(printed, key) {
    const fields = AcliWorkItem.#fieldsIn(printed, key)

    return new Ticket({
      key,
      summary: AcliWorkItem.#summaryIn(fields, key),
      description: AcliWorkItem.#plainText(fields.description),
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
    AcliWorkItem.#walk(description, parts)

    return parts.join('').replace(AcliWorkItem.#BLANK_RUN, '\n\n').trim()
  }

  static #walk(node, parts) {
    if (node === null || typeof node !== 'object') return
    if (typeof node.text === 'string') parts.push(node.text)
    if (!Array.isArray(node.content)) return
    for (const child of node.content) AcliWorkItem.#walk(child, parts)
    if (AcliWorkItem.#BREAKING_NODES.includes(node.type)) parts.push('\n')
  }
}
