import { PlanIssues } from '../domain/plan-issues.js'
import { PlanIssue } from '../domain/plan-issue.js'
import { PlanIssueNotCreated, PlanIssueNotNamed } from '../domain/exceptions.js'

export class GhPlanIssues extends PlanIssues {
  static #REF = /\/issues\/(\d+)\s*$/
  static READY_LABEL = 'status:ready'

  constructor({ run }) {
    super()
    this.run = run
  }

  static titleFor(ticket) {
    return `${ticket.key} ${ticket.summary}`
  }

  static bodyFor(ticket) {
    return [
      `> Historia de usuario: ${ticket.key}`,
      '',
      ticket.hasDescription() ? ticket.description : `_${ticket.key} no trae descripción en Jira._`,
      '',
    ].join('\n')
  }

  static argvFor({ ticket, repository }) {
    return [
      'issue', 'create',
      '--repo', repository.text,
      '--title', GhPlanIssues.titleFor(ticket),
      '--body', GhPlanIssues.bodyFor(ticket),
      '--label', GhPlanIssues.READY_LABEL,
    ]
  }

  async open({ ticket, repository }) {
    let printed
    try {
      printed = await this.run(GhPlanIssues.argvFor({ ticket, repository }))
    } catch (cause) {
      throw new PlanIssueNotCreated(cause.message)
    }
    const url = printed.trim().split('\n').pop() ?? ''
    const found = url.match(GhPlanIssues.#REF)
    if (found === null) {
      throw new PlanIssueNotNamed(
        `gh did not name the issue it created, it printed ${JSON.stringify(printed)}`
      )
    }
    return new PlanIssue({ number: Number(found[1]), url })
  }
}
