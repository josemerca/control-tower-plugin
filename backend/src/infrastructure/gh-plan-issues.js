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
import { ChangeAsked } from '../domain/value-objects/change-asked.js'
import {
  PlanIssueNotCreated, PlanIssueNotNamed, PlanIssueNotClaimed, PlanGoNotAnswered,
  PlanChangesNotRead, PlanChangesNotUnderstood,
} from '../domain/exceptions.js'
import { Gh } from './gh.js'

export class GhPlanIssues extends PlanIssues {
  static CHANGES_TOKEN = '-REVIEW'
  static IN_PROGRESS_LABEL = 'status:in-progress'
  static IN_REVIEW_LABEL = 'status:in-review'
  static GO_TOKEN = '-OK'
  static #REF = /\/issues\/([1-9]\d*)\s*$/

  constructor({ gh, stderr }) {
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

  static changesArgvFor({ issue, repository }) {
    return [
      'issue', 'view', String(issue.number),
      '--repo', repository.text,
      '--json', 'comments',
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

  static argvFor({ story, comment, repository }) {
    return [
      'issue', 'create',
      '--repo', repository.text,
      '--title', PlanIssueBody.titleFor({ story, comment }),
      '--body', PlanIssueBody.of({ story, comment }),
      ...PlanIssueBody.labels({ story, comment }).flatMap((label) => ['--label', label]),
    ]
  }

  static labelArgvFor(repository, label) {
    return ['label', 'create', label, '--repo', repository.text, '--force']
  }

  static labelsArgvFor({ issueNumber, repository }) {
    return ['issue', 'view', String(issueNumber), '--repo', repository.text, '--json', 'labels']
  }

  async open({ story, comment, repository }) {
    const outcome = await this.#sowing({
      argv: GhPlanIssues.argvFor({ story, comment, repository }),
      ours: PlanIssueBody.labels({ story, comment }),
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

  async changesAsked({ issue, repository }) {
    const outcome = await this.gh.run(
      GhPlanIssues.changesArgvFor({ issue, repository }), { safeToRepeat: true }
    )
    if (outcome.failed) {
      throw new PlanChangesNotRead(`${Gh.BIN} issue view failed: ${outcome.stderr.trim()}`)
    }

    return GhPlanIssues.#changesIn(outcome.stdout, issue)
  }

  static #changesIn(printed, issue) {
    const asked = []
    for (const comment of GhPlanIssues.#commentsIn(printed, issue)) {
      GhPlanIssues.#demandRead(comment, issue)
      if (!comment.body.startsWith(GhPlanIssues.CHANGES_TOKEN)) continue

      asked.push(new ChangeAsked({
        id: comment.id,
        text: comment.body.slice(GhPlanIssues.CHANGES_TOKEN.length).trim(),
      }))
    }

    return asked
  }

  static #commentsIn(printed, issue) {
    let parsed
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new PlanChangesNotUnderstood(
        `${Gh.BIN} answered something that is not json for the comments of ${issue.number}, it printed ${JSON.stringify(printed)}`
      )
    }
    if (!Array.isArray(parsed?.comments)) {
      throw new PlanChangesNotUnderstood(
        `${Gh.BIN} answered without the comments of ${issue.number}, it printed ${JSON.stringify(printed)}`
      )
    }

    return parsed.comments
  }

  static #demandRead(comment, issue) {
    if (typeof comment?.id === 'string' && typeof comment?.body === 'string') return

    throw new PlanChangesNotUnderstood(
      `${Gh.BIN} answered a comment of ${issue.number} without the id and the body this reads, it printed ${JSON.stringify(comment)}`
    )
  }

  static #onlyStatusIn(printed, issueNumber) {
    let parsed
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new PlanChangesNotUnderstood(
        `${Gh.BIN} answered something that is not json for the labels of ${issueNumber}, it printed ${JSON.stringify(printed)}`
      )
    }
    if (!Array.isArray(parsed?.labels)) {
      throw new PlanChangesNotUnderstood(
        `${Gh.BIN} answered without the labels of ${issueNumber}, it printed ${JSON.stringify(printed)}`
      )
    }
    const status = parsed.labels
      .map((label) => label?.name)
      .filter((name) => typeof name === 'string' && name.startsWith('status:'))

    return status.length === 1 ? status[0] : null
  }

  async answerGo({ issueNumber, repository, nonce }) {
    const outcome = await this.gh.run(
      GhPlanIssues.goArgvFor({ issueNumber, repository, nonce }), { safeToRepeat: false }
    )
    if (outcome.failed) {
      throw new PlanGoNotAnswered(`${Gh.BIN} issue comment failed: ${outcome.stderr.trim()}`)
    }
  }

  async isInReview({ issueNumber, repository }) {
    const outcome = await this.gh.run(
      GhPlanIssues.labelsArgvFor({ issueNumber, repository }), { safeToRepeat: true }
    )
    if (outcome.failed) {
      throw new PlanChangesNotRead(`${Gh.BIN} issue view --json labels failed: ${outcome.stderr.trim()}`)
    }

    return GhPlanIssues.#onlyStatusIn(outcome.stdout, issueNumber) === GhPlanIssues.IN_REVIEW_LABEL
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

export { ChangeAsked }

export class PlanIssueBody {
  static DESCRIPTION_HEADING = '## Descripción'
  static PROTECTED_HEADING = '## Out of scope / Protected'
  static AC_HEADING = '## Acceptance criteria (EARS, 1:1 con tests)'
  static COMMENT_SECTION = 'Comentario de quien pide el plan'
  static COMMENT_HEADING = `## ${PlanIssueBody.COMMENT_SECTION}`
  static NO_STORY_LINE = '> Plan pedido a mano: no hay historia de usuario en Jira.'
  static NO_STORY_EPIC_CONTEXT = '_El plan no viene de una historia de usuario de Jira._'
  static NO_HEADLINE = '_El comentario no trae una primera línea que resuma lo que se pide._'
  static HEADLINE_LIMIT = 72
  static HEADLINE_CUT = '…'
  static #ACTIVE =
    /((?<![\w])[\w.-]+\/[\w.-]+#\d+|(?<![\w])#\d+|(?<![\w.])@[A-Za-z0-9][A-Za-z0-9-]*|https?:\/\/\S*github\.com\/\S+)/g
  static #CODE_SPAN = /(`[^`]*`)/
  static READY_LABEL = 'status:ready'
  static CHANGES_LINE =
    `> Para pedir cambios en el plan, comenta en este issue empezando por \`${GhPlanIssues.CHANGES_TOKEN}\`: ` +
    'lo que escribas detrás es lo que se le pide al agente, y publicará el plan rehecho aquí mismo.'

  static labels({ story, comment }) {
    return [...gateLabels(gatesOf(PlanIssueBody.rowFor({ story, comment })).gates), PlanIssueBody.READY_LABEL]
  }

  static titleFor({ story, comment }) {
    return story === null ? PlanIssueBody.headlineOf(comment) : `${story.key} ${story.summary}`
  }

  static headlineOf(comment) {
    const line = comment.text.split('\n').find((candidate) => candidate.trim().length > 0)
    const collapsed = line.replace(/\s+/g, ' ').trim()

    return collapsed.length > PlanIssueBody.HEADLINE_LIMIT
      ? `${collapsed.slice(0, PlanIssueBody.HEADLINE_LIMIT - 1)}${PlanIssueBody.HEADLINE_CUT}`
      : collapsed
  }

  static rowFor({ story, comment }) {
    const name = story === null ? PlanIssueBody.headlineOf(comment) : story.summary

    return {
      n: null,
      name,
      entrega: PlanIssueBody.quieted(name),
      type: '',
      e2e: '',
      ac: [],
      deps: [],
      protected: '',
    }
  }

  static #epicContextOf(story) {
    if (story === null) return PlanIssueBody.NO_STORY_EPIC_CONTEXT

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

  static of({ story, comment }) {
    const row = PlanIssueBody.rowFor({ story, comment })

    return [
      story === null ? PlanIssueBody.NO_STORY_LINE : `> Historia de usuario: ${story.key}`,
      PlanIssueBody.CHANGES_LINE,
      '',
      PlanIssueBody.DESCRIPTION_HEADING,
      renderDescripcion(row) ??
        (story === null ? PlanIssueBody.NO_HEADLINE : `_${story.key} no trae resumen en Jira._`),
      '',
      ...(comment === null ? [] : [PlanIssueBody.COMMENT_HEADING, PlanIssueBody.quieted(comment.text), '']),
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
