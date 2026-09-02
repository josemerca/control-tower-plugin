import { PlanIssues } from '../domain/ports/plan-issues.js'
import { PlanIssue } from '../domain/value-objects/plan-issue.js'
import { PlanIssueNotCreated, PlanIssueNotNamed } from '../domain/exceptions.js'
import { PlanIssueBody } from './plan-issue-body.js'
import { Gh } from './gh.js'

export class GhPlanIssues extends PlanIssues {
  static #REF = /\/issues\/(\d+)\s*$/

  constructor({ gh }) {
    super()
    this.gh = gh
  }

  static argvFor({ story, repository }) {
    return [
      'issue', 'create',
      '--repo', repository.text,
      '--title', PlanIssueBody.titleFor(story),
      '--body', PlanIssueBody.of(story),
      ...PlanIssueBody.labels(story).flatMap((label) => ['--label', label]),
    ]
  }

  static labelArgvFor(repository, label) {
    return ['label', 'create', label, '--repo', repository.text, '--force']
  }

  async open({ story, repository }) {
    const outcome = await this.#createSowingLabels({ story, repository })
    if (outcome.failed) {
      throw new PlanIssueNotCreated(`${Gh.BIN} issue create failed: ${outcome.stderr.trim()}`)
    }
    const url = outcome.stdout.trim().split('\n').pop() ?? ''
    const found = url.match(GhPlanIssues.#REF)
    if (found === null) {
      throw new PlanIssueNotNamed(
        `${Gh.BIN} did not name the issue it created, it printed ${JSON.stringify(outcome.stdout)}`
      )
    }

    return new PlanIssue({ number: Number(found[1]), url })
  }

  async #createSowingLabels({ story, repository }) {
    const argv = GhPlanIssues.argvFor({ story, repository })
    const ours = PlanIssueBody.labels(story)
    const sown = new Set()
    let outcome = await this.gh.run(argv, { safeToRepeat: false })
    while (outcome.failed) {
      const missing = Gh.labelMissingIn(outcome.stderr)
      if (missing === null || !ours.includes(missing) || sown.has(missing)) break

      sown.add(missing)
      await this.gh.run(GhPlanIssues.labelArgvFor(repository, missing), { safeToRepeat: true })
      outcome = await this.gh.run(argv, { safeToRepeat: false })
    }

    return outcome
  }
}
