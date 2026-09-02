import { Tickets } from '../domain/ports/tickets.js'
import { Ticket } from '../domain/value-objects/ticket.js'
import { TicketNotRead } from '../domain/exceptions.js'
import { AcliWorkItem } from './acli-work-item.js'

export class AcliTickets extends Tickets {
  static BIN = 'acli'
  static #UNAUTHENTICATED = /auth|login|unauthorized|401/i

  constructor({ acli }) {
    super()
    this.acli = acli
  }

  static argvFor(key) {
    return ['jira', 'workitem', 'view', key.text, '--json', '--fields', AcliWorkItem.FIELDS]
  }

  async detail(key) {
    const argv = AcliTickets.argvFor(key)
    const output = await this.acli.run(argv, { safeToRepeat: true })
    if (output.failed) {
      throw new TicketNotRead(
        `${AcliTickets.BIN} ${argv[0]} failed: ${AcliTickets.#reasonFor(output.stderr.trim())}`
      )
    }
    const item = AcliWorkItem.from(output.stdout, key)

    return new Ticket({ key, summary: item.summary, description: item.description })
  }

  static #reasonFor(message) {
    return AcliTickets.#UNAUTHENTICATED.test(message)
      ? `${AcliTickets.BIN} is not authenticated, run "acli jira auth login" and try again: ${message}`
      : message
  }
}
