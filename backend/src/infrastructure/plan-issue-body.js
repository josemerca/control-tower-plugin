import {
  EPIC_CONTEXT_HEADING,
  INHERITED_CONTEXT_HEADING,
  INHERITED_CONTEXT_PLACEHOLDER,
  GATES_HEADING,
  renderAcContent,
  renderDescripcion,
  renderGatesContent,
  renderProtectedLine,
} from '../../../plugin/scripts/groom.js'
import { gatesOf } from '../../../plugin/scripts/groom.js'
import { gateLabels } from '../../../plugin/scripts/gates.js'

export class PlanIssueBody {
  static DESCRIPTION_HEADING = '## Descripción'
  static PROTECTED_HEADING = '## Out of scope / Protected'
  static AC_HEADING = '## Acceptance criteria (EARS, 1:1 con tests)'
  static #ACTIVE =
    /((?<![\w])[\w.-]+\/[\w.-]+#\d+|(?<![\w])#\d+|(?<![\w.])@[A-Za-z0-9][A-Za-z0-9-]*|https?:\/\/\S*github\.com\/\S+)/g
  static #CODE_SPAN = /(`[^`]*`)/
  static READY_LABEL = 'status:ready'

  static labels(ticket) {
    return [...gateLabels(gatesOf(PlanIssueBody.rowFor(ticket)).gates), PlanIssueBody.READY_LABEL]
  }

  static titleFor(ticket) {
    return `${ticket.key} ${ticket.summary}`
  }

  static rowFor(ticket) {
    return {
      n: null,
      name: ticket.summary,
      entrega: PlanIssueBody.quieted(ticket.summary),
      type: '',
      e2e: '',
      ac: [],
      deps: [],
      protected: '',
    }
  }

  static #epicContextOf(ticket) {
    return ticket.hasDescription()
      ? PlanIssueBody.quieted(ticket.description)
      : `_${ticket.key} no trae descripción en Jira: la historia de usuario está sin escribir._`
  }

  static quieted(text) {
    return text
      .split(PlanIssueBody.#CODE_SPAN)
      .map((piece, index) => (
        index % 2 === 1 ? piece : piece.replace(PlanIssueBody.#ACTIVE, '`$1`')
      ))
      .join('')
  }

  static of(ticket) {
    const row = PlanIssueBody.rowFor(ticket)

    return [
      `> Historia de usuario: ${ticket.key}`,
      '',
      PlanIssueBody.DESCRIPTION_HEADING,
      renderDescripcion(row) ?? `_${ticket.key} no trae resumen en Jira._`,
      '',
      EPIC_CONTEXT_HEADING,
      PlanIssueBody.#epicContextOf(ticket),
      '',
      INHERITED_CONTEXT_HEADING,
      INHERITED_CONTEXT_PLACEHOLDER,
      '',
      PlanIssueBody.AC_HEADING,
      renderAcContent(row.ac),
      '',
      GATES_HEADING,
      renderGatesContent(row),
      '',
      PlanIssueBody.PROTECTED_HEADING,
      renderProtectedLine(row),
      '',
    ].join('\n')
  }
}
