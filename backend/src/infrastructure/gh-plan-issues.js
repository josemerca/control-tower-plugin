import { PlanIssues } from '../domain/plan-issues.js'
import { PlanIssue } from '../domain/plan-issue.js'
import { PlanIssueNotCreated, PlanIssueNotNamed } from '../domain/exceptions.js'
import { PlanIssueBody } from './plan-issue-body.js'
import { GhFailure } from './gh-failure.js'
import { GhCall } from './gh-call.js'

export class GhPlanIssues extends PlanIssues {
  static #REF = /\/issues\/(\d+)\s*$/

  constructor({ call }) {
    super()
    this.call = call
  }

  static argvFor({ ticket, repository }) {
    return [
      'issue', 'create',
      '--repo', repository.text,
      '--title', PlanIssueBody.titleFor(ticket),
      '--body', PlanIssueBody.of(ticket),
      ...PlanIssueBody.labels().flatMap((label) => ['--label', label]),
    ]
  }

  static labelArgvFor(repository, label) {
    return ['label', 'create', label, '--repo', repository.text, '--force']
  }

  async open({ ticket, repository }) {
    const outcome = await this.#createSowingLabels({ ticket, repository })
    if (outcome.failed) {
      throw new PlanIssueNotCreated(`${GhCall.BIN} issue create failed: ${outcome.stderr.trim()}`)
    }
    const url = outcome.stdout.trim().split('\n').pop() ?? ''
    const found = url.match(GhPlanIssues.#REF)
    if (found === null) {
      throw new PlanIssueNotNamed(
        `${GhCall.BIN} did not name the issue it created, it printed ${JSON.stringify(outcome.stdout)}`
      )
    }

    return new PlanIssue({ number: Number(found[1]), url })
  }

  async #createSowingLabels({ ticket, repository }) {
    const argv = GhPlanIssues.argvFor({ ticket, repository })
    const sown = new Set()
    let outcome = await this.call.make(argv, { safeToRepeat: false })
    while (outcome.failed) {
      const missing = GhFailure.labelMissingIn(outcome.stderr)
      if (missing === null || !PlanIssueBody.labels().includes(missing) || sown.has(missing)) break

      sown.add(missing)
      await this.call.make(GhPlanIssues.labelArgvFor(repository, missing), { safeToRepeat: true })
      outcome = await this.call.make(argv, { safeToRepeat: false })
    }

    return outcome
  }
}
