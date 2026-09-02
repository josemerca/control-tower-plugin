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
import { PlanIssueNotCreated, PlanIssueNotNamed } from '../domain/exceptions.js'
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
