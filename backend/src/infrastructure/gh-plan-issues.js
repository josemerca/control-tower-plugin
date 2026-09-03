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
import { PlanIssues } from '../domain/ports/plan-issues.js'
import { PlanIssue } from '../domain/value-objects/plan-issue.js'
import {
  PlanIssueNotCreated, PlanIssueNotNamed, PlanIssueNotClaimed, PlanGoNotAnswered,
} from '../domain/exceptions.js'
import { Gh } from './gh.js'

export class GhPlanIssues extends PlanIssues {
  static IN_PROGRESS_LABEL = 'status:in-progress'
  static IN_REVIEW_LABEL = 'status:in-review'
  static GO_TOKEN = '-OK'
  static #REF = /\/issues\/(\d+)\s*$/

  constructor({ gh, stderr = (line) => process.stderr.write(line) }) {
    super()
    this.gh = gh
    this.stderr = stderr
  }

  static goBodyFor(nonce) {
    return `${GhPlanIssues.GO_TOKEN} ${nonce}`
  }

  static goArgvFor({ issueNumber, repository, nonce }) {
    return [
      'issue', 'comment', String(issueNumber),
      '--repo', repository.text,
      '--body', GhPlanIssues.goBodyFor(nonce),
    ]
  }

  static statusArgvFor({ issue, repository, adding, removing }) {
    return [
      'issue', 'edit', String(issue.number),
      '--repo', repository.text,
      '--add-label', adding,
      '--remove-label', removing,
    ]
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
    const outcome = await this.#sowing({
      argv: GhPlanIssues.argvFor({ story, repository }),
      ours: PlanIssueBody.labels(story),
      repository,
      safeToRepeat: false,
    })
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

  async claim({ issue, repository }) {
    await this.#sowForTheRelease(repository)
    const { outcome } = await this.#swapping({
      issue, repository,
      adding: GhPlanIssues.IN_PROGRESS_LABEL,
      removing: PlanIssueBody.READY_LABEL,
    })
    if (outcome.failed) {
      throw new PlanIssueNotClaimed(`${Gh.BIN} issue edit failed: ${outcome.stderr.trim()}`)
    }
  }

  async requeue({ issue, repository }) {
    const { argv, outcome } = await this.#swapping({
      issue, repository,
      adding: PlanIssueBody.READY_LABEL,
      removing: GhPlanIssues.IN_PROGRESS_LABEL,
    })
    if (outcome.failed) this.#warn({ issue, argv, said: outcome.stderr.trim() })
  }

  async answerGo({ issueNumber, repository, nonce }) {
    const outcome = await this.gh.run(
      GhPlanIssues.goArgvFor({ issueNumber, repository, nonce }), { safeToRepeat: false }
    )
    if (outcome.failed) {
      throw new PlanGoNotAnswered(`${Gh.BIN} issue comment failed: ${outcome.stderr.trim()}`)
    }
  }

  async #sowForTheRelease(repository) {
    const argv = GhPlanIssues.labelArgvFor(repository, GhPlanIssues.IN_REVIEW_LABEL)
    const outcome = await this.gh.run(argv, { safeToRepeat: true })
    if (outcome.failed) {
      throw new PlanIssueNotClaimed(
        `${GhPlanIssues.IN_REVIEW_LABEL} could not be sown in ${repository.text}, and dispatch-check --release cannot create it when the agent delivers: ${outcome.stderr.trim()}`
      )
    }
  }

  async #swapping({ issue, repository, adding, removing }) {
    const argv = GhPlanIssues.statusArgvFor({ issue, repository, adding, removing })
    const outcome = await this.#sowing({ argv, ours: [adding], repository, safeToRepeat: true })

    return { argv, outcome }
  }

  #warn({ issue, argv, said }) {
    this.stderr(
      `gh plan issues: ${issue} stays claimed because it could not be put back in the queue: ${said}. Run it yourself: ${Gh.BIN} ${argv.join(' ')}\n`
    )
  }

  async #sowing({ argv, ours, repository, safeToRepeat }) {
    const sown = new Set()
    let outcome = await this.gh.run(argv, { safeToRepeat })
    while (outcome.failed) {
      const missing = Gh.labelMissingIn(outcome.stderr)
      if (missing === null || !ours.includes(missing) || sown.has(missing)) break

      sown.add(missing)
      await this.gh.run(GhPlanIssues.labelArgvFor(repository, missing), { safeToRepeat: true })
      outcome = await this.gh.run(argv, { safeToRepeat })
    }

    return outcome
  }
}

export class PlanIssueBody {
  static DESCRIPTION_HEADING = '## Descripción'
  static PROTECTED_HEADING = '## Out of scope / Protected'
  static AC_HEADING = '## Acceptance criteria (EARS, 1:1 con tests)'
  static #ACTIVE =
    /((?<![\w])[\w.-]+\/[\w.-]+#\d+|(?<![\w])#\d+|(?<![\w.])@[A-Za-z0-9][A-Za-z0-9-]*|https?:\/\/\S*github\.com\/\S+)/g
  static #CODE_SPAN = /(`[^`]*`)/
  static READY_LABEL = 'status:ready'

  static labels(story) {
    return [...gateLabels(gatesOf(PlanIssueBody.rowFor(story)).gates), PlanIssueBody.READY_LABEL]
  }

  static titleFor(story) {
    return `${story.key} ${story.summary}`
  }

  static rowFor(story) {
    return {
      n: null,
      name: story.summary,
      entrega: PlanIssueBody.quieted(story.summary),
      type: '',
      e2e: '',
      ac: [],
      deps: [],
      protected: '',
    }
  }

  static #epicContextOf(story) {
    return story.hasDescription()
      ? PlanIssueBody.quieted(story.description)
      : `_${story.key} no trae descripción en Jira: la historia de usuario está sin escribir._`
  }

  static quieted(text) {
    return text
      .split(PlanIssueBody.#CODE_SPAN)
      .map((piece, index) => (
        index % 2 === 1 ? piece : piece.replace(PlanIssueBody.#ACTIVE, '`$1`')
      ))
      .join('')
  }

  static of(story) {
    const row = PlanIssueBody.rowFor(story)

    return [
      `> Historia de usuario: ${story.key}`,
      '',
      PlanIssueBody.DESCRIPTION_HEADING,
      renderDescripcion(row) ?? `_${story.key} no trae resumen en Jira._`,
      '',
      EPIC_CONTEXT_HEADING,
      PlanIssueBody.#epicContextOf(story),
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
