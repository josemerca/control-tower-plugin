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
import { AC_HEADING_FORMS } from '../../../plugin/scripts/gh-issue-map.js'

export class PlanIssueBody {
  static DESCRIPTION_HEADING = '## Descripción'
  static PROTECTED_HEADING = '## Out of scope / Protected'
  static AC_HEADING = AC_HEADING_FORMS[AC_HEADING_FORMS.length - 1]
  static PLAN_GATE = 'plan'
  static READY_LABEL = 'status:ready'

  static labels() {
    return [`gate:${PlanIssueBody.PLAN_GATE}`, PlanIssueBody.READY_LABEL]
  }

  static titleFor(ticket) {
    return `${ticket.key} ${ticket.summary}`
  }

  static #rowFor(ticket) {
    return {
      n: null,
      name: ticket.summary,
      entrega: ticket.summary,
      type: '',
      e2e: '',
      ac: [],
      deps: [],
      protected: '',
    }
  }

  static #epicContextOf(ticket) {
    return ticket.hasDescription()
      ? ticket.description
      : `_${ticket.key} no trae descripción en Jira: la historia de usuario está sin escribir._`
  }

  static of(ticket) {
    const row = PlanIssueBody.#rowFor(ticket)

    return [
      `> Historia de usuario: ${ticket.key}`,
      '',
      PlanIssueBody.DESCRIPTION_HEADING,
      renderDescripcion(row),
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
