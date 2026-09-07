import { Answer, JsonBody, Refusal } from './http.js'
import { Projection } from './projection.js'
import { StartPlanParams } from '../application/actions/start-plan.js'
import { UserStoryKey } from '../domain/value-objects/user-story-key.js'
import { PlanComment } from '../domain/value-objects/plan-comment.js'
import { RepositoryName } from '../domain/value-objects/repository-name.js'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.js'
import { PlanTarget } from '../domain/value-objects/plan-target.js'
import {
  PlanFailure,
  UserStoryNotRead, UserStoryNotUnderstood, PlanIssueNotCreated, PlanIssueNotNamed,
  PlanIssueNotClaimed,
  PlanAgentNotLaunched, PlanAgentNotNamed, WorkspaceNotPrepared, WorkspaceNotRead,
  WorkspaceNotUnderstood, CheckoutNotConfirmed,
} from '../domain/exceptions.js'

export const PlanRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_ID: 'malformed-id',
  MALFORMED_USER_COMMENT: 'malformed-user-comment',
  NOTHING_TO_PLAN: 'nothing-to-plan',
  TARGET_SAID_TWICE: 'target-said-twice',
  MALFORMED_REPO_LIST: 'malformed-repo-list',
  MALFORMED_REPO: 'malformed-repo',
  MALFORMED_PATH: 'malformed-path',
  REPO_LISTED_TWICE: 'repo-listed-twice',
  NO_PLAN_STARTED: 'no-plan-started',
})

export class PlanRequest {
  static ID_FIELD = 'id'
  static COMMENT_FIELD = 'user_comment'
  static REPO_FIELD = 'repo'
  static PATH_FIELD = 'path'
  static REPO_LIST_FIELD = 'repo_list'
  static ENTRY_FIELDS = Object.freeze([PlanRequest.REPO_FIELD, PlanRequest.PATH_FIELD])
  static KNOWN_FIELDS = Object.freeze([
    PlanRequest.ID_FIELD, PlanRequest.COMMENT_FIELD, PlanRequest.REPO_FIELD, PlanRequest.PATH_FIELD,
    PlanRequest.REPO_LIST_FIELD,
  ])

  constructor({ outcome, story, comment, targets, fields, named = null, listed = false }) {
    this.outcome = outcome
    this.story = story
    this.comment = comment
    this.targets = targets === null ? null : Object.freeze([...targets])
    this.listed = listed
    this.fields = Object.freeze([...fields])
    this.named = named
    Object.freeze(this)
  }

  static accepted(story, comment, targets, listed = false) {
    return new PlanRequest({ outcome: PlanRequestOutcome.ACCEPTED, story, comment, targets, listed, fields: [] })
  }

  static refused(outcome, named = null) {
    return new PlanRequest({
      outcome, story: null, comment: null, targets: null, fields: [], named,
    })
  }

  static withUnknownFields(fields) {
    return new PlanRequest({
      outcome: PlanRequestOutcome.UNKNOWN_FIELD, story: null, comment: null, targets: null, fields,
    })
  }

  static from(raw) {
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return PlanRequest.refused(PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return PlanRequest.refused(PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    const unknown = Object.keys(parsed).filter((field) => !PlanRequest.KNOWN_FIELDS.includes(field))
    if (unknown.length > 0) {
      return PlanRequest.withUnknownFields(unknown.sort())
    }
    const idGiven = Object.hasOwn(parsed, PlanRequest.ID_FIELD)
    const given = parsed[PlanRequest.ID_FIELD]
    if (idGiven && !UserStoryKey.isWellFormed(given)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_ID)
    }
    const commentGiven = Object.hasOwn(parsed, PlanRequest.COMMENT_FIELD)
    const saidByHand = parsed[PlanRequest.COMMENT_FIELD]
    if (commentGiven && !PlanComment.isWellFormed(saidByHand)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_USER_COMMENT)
    }
    if (!idGiven && !commentGiven) {
      return PlanRequest.refused(PlanRequestOutcome.NOTHING_TO_PLAN)
    }
    const story = idGiven ? new UserStoryKey(given) : null
    const comment = commentGiven ? new PlanComment(saidByHand) : null

    const listGiven = Object.hasOwn(parsed, PlanRequest.REPO_LIST_FIELD)
    const repoGiven = Object.hasOwn(parsed, PlanRequest.REPO_FIELD)
    const pathGiven = Object.hasOwn(parsed, PlanRequest.PATH_FIELD)
    if (listGiven && (repoGiven || pathGiven)) {
      return PlanRequest.refused(PlanRequestOutcome.TARGET_SAID_TWICE)
    }
    if (listGiven) {
      return PlanRequest.#fromList(parsed[PlanRequest.REPO_LIST_FIELD], story, comment)
    }

    const asked = parsed[PlanRequest.REPO_FIELD]
    if (!RepositoryName.isWellFormed(asked)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_REPO, PlanRequest.REPO_FIELD)
    }
    const where = parsed[PlanRequest.PATH_FIELD]
    if (!CheckoutRoot.isWellFormed(where)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_PATH, PlanRequest.PATH_FIELD)
    }
    return PlanRequest.accepted(story, comment, [
      new PlanTarget({ repository: new RepositoryName(asked), root: new CheckoutRoot(where) }),
    ])
  }

  static #isEntryShaped(entry) {
    return entry !== null && typeof entry === 'object' && !Array.isArray(entry) &&
      Object.keys(entry).length === PlanRequest.ENTRY_FIELDS.length &&
      PlanRequest.ENTRY_FIELDS.every((field) => Object.hasOwn(entry, field))
  }

  static #fromList(list, story, comment) {
    if (!Array.isArray(list) || list.length === 0 || !list.every(PlanRequest.#isEntryShaped)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_REPO_LIST)
    }
    for (const [index, entry] of list.entries()) {
      const repo = entry[PlanRequest.REPO_FIELD]
      if (!RepositoryName.isWellFormed(repo)) {
        return PlanRequest.refused(
          PlanRequestOutcome.MALFORMED_REPO, `${PlanRequest.REPO_LIST_FIELD}[${index}].${PlanRequest.REPO_FIELD}`
        )
      }
      const path = entry[PlanRequest.PATH_FIELD]
      if (!CheckoutRoot.isWellFormed(path)) {
        return PlanRequest.refused(
          PlanRequestOutcome.MALFORMED_PATH, `${PlanRequest.REPO_LIST_FIELD}[${index}].${PlanRequest.PATH_FIELD}`
        )
      }
    }
    const seen = new Set()
    for (const entry of list) {
      const repo = entry[PlanRequest.REPO_FIELD]
      if (seen.has(repo)) {
        return PlanRequest.refused(PlanRequestOutcome.REPO_LISTED_TWICE, repo)
      }
      seen.add(repo)
    }
    const targets = list.map((entry) => new PlanTarget({
      repository: new RepositoryName(entry[PlanRequest.REPO_FIELD]),
      root: new CheckoutRoot(entry[PlanRequest.PATH_FIELD]),
    }))

    return PlanRequest.accepted(story, comment, targets, true)
  }
}

export class PlanRefusal {
  static #BY_OUTCOME = new Projection('refusal', [
    [PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT,
      detail: 'body must be a JSON object',
    })],
    [PlanRequestOutcome.MALFORMED_ID, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.MALFORMED_ID,
      detail: `${PlanRequest.ID_FIELD} must be a user story key such as ${UserStoryKey.EXAMPLE}`,
    })],
    [PlanRequestOutcome.MALFORMED_USER_COMMENT, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.MALFORMED_USER_COMMENT,
      detail: `${PlanRequest.COMMENT_FIELD} must be text saying what to plan`,
    })],
    [PlanRequestOutcome.NOTHING_TO_PLAN, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.NOTHING_TO_PLAN,
      detail: `either ${PlanRequest.ID_FIELD} or ${PlanRequest.COMMENT_FIELD} must say what to plan`,
    })],
    [PlanRequestOutcome.TARGET_SAID_TWICE, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.TARGET_SAID_TWICE,
      detail: `${PlanRequest.REPO_LIST_FIELD} already says where to plan, so `
        + `${PlanRequest.REPO_FIELD} and ${PlanRequest.PATH_FIELD} must not be given beside it`,
    })],
    [PlanRequestOutcome.MALFORMED_REPO_LIST, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.MALFORMED_REPO_LIST,
      detail: `${PlanRequest.REPO_LIST_FIELD} must be a non-empty list of `
        + `{ ${PlanRequest.REPO_FIELD}, ${PlanRequest.PATH_FIELD} }`,
    })],
    [PlanRequestOutcome.MALFORMED_REPO, (asked) => new Refusal({
      status: 400,
      code: PlanRequestOutcome.MALFORMED_REPO,
      detail: `${asked.named} must be a repository such as ${RepositoryName.EXAMPLE}`,
    })],
    [PlanRequestOutcome.MALFORMED_PATH, (asked) => new Refusal({
      status: 400,
      code: PlanRequestOutcome.MALFORMED_PATH,
      detail: `${asked.named} must be an absolute path`,
    })],
    [PlanRequestOutcome.REPO_LISTED_TWICE, (asked) => new Refusal({
      status: 400,
      code: PlanRequestOutcome.REPO_LISTED_TWICE,
      detail: `${PlanRequest.REPO_LIST_FIELD} names ${asked.named} twice`,
    })],
    [PlanRequestOutcome.NO_PLAN_STARTED, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.NO_PLAN_STARTED,
      detail: `no plan started: every repository of ${PlanRequest.REPO_LIST_FIELD} failed`,
    })],
    [PlanRequestOutcome.UNKNOWN_FIELD, (asked) => new Refusal({
      status: 400,
      code: PlanRequestOutcome.UNKNOWN_FIELD,
      detail: `unknown field: ${asked.fields.join(', ')}`,
    })],
  ])

  static of(asked) {
    return PlanRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }

  static declaredOutcomes() {
    return PlanRefusal.#BY_OUTCOME.members()
  }
}

export class PlanCollapse {
  static #STATUS = 400

  static #collapsed(code) {
    return (cause) => new Refusal({ status: PlanCollapse.#STATUS, code, detail: cause.message })
  }

  static #BY_FAILURE = new Projection('refusal', [
    [UserStoryNotRead, PlanCollapse.#collapsed('user-story-not-read')],
    [PlanIssueNotCreated, PlanCollapse.#collapsed('plan-issue-not-created')],
    [PlanIssueNotClaimed, PlanCollapse.#collapsed('plan-issue-not-claimed')],
    [PlanAgentNotLaunched, PlanCollapse.#collapsed('plan-agent-not-launched')],
    [WorkspaceNotPrepared, PlanCollapse.#collapsed('workspace-not-prepared')],
    [WorkspaceNotRead, PlanCollapse.#collapsed('workspace-not-read')],
    [CheckoutNotConfirmed, (cause) => new Refusal({
      status: PlanCollapse.#STATUS,
      code: 'checkout-not-confirmed',
      detail: `${PlanRequest.PATH_FIELD} must be a git checkout of ${cause.message}`,
    })],
    [UserStoryNotUnderstood, PlanCollapse.#collapsed('user-story-not-understood')],
    [PlanIssueNotNamed, PlanCollapse.#collapsed('plan-issue-not-named')],
    [PlanAgentNotNamed, PlanCollapse.#collapsed('plan-agent-not-named')],
    [WorkspaceNotUnderstood, PlanCollapse.#collapsed('workspace-not-understood')],
  ])

  static of(cause) {
    return PlanCollapse.#BY_FAILURE.of(cause.constructor)(cause)
  }

  static declaredFailures() {
    return PlanCollapse.#BY_FAILURE.members().map((failure) => failure.name)
  }

  static declaredCodes() {
    return PlanCollapse.#BY_FAILURE.members().map((failure) => PlanCollapse.of(new failure('x')).code)
  }
}

export class StartPlanRoute {
  static PATH = '/start-plan'
  static METHOD = 'POST'

  static handledBy(startPlan, sessions, reviews) {
    return async (request, response) => {
      const asked = PlanRequest.from(JsonBody.textOf(request))
      if (asked.outcome !== PlanRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, PlanRefusal.of(asked))
        return
      }
      await StartPlanRoute.#accept(startPlan, sessions, reviews, response, asked)
    }
  }

  static async #accept(startPlan, sessions, reviews, response, asked) {
    let result
    try {
      result = await startPlan.execute(
        new StartPlanParams({ story: asked.story, comment: asked.comment, targets: asked.targets })
      )
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      Answer.refuseAs(response, PlanCollapse.of(cause))
      return
    }
    if (asked.listed) {
      StartPlanRoute.#sendListed(sessions, reviews, response, result)
      return
    }
    if (result.failed.length > 0) {
      Answer.refuseAs(response, PlanCollapse.of(result.failed[0].cause))
      return
    }
    const [started] = result.started
    sessions.remember(started.watch)
    reviews.start(started.watch)
    Answer.send(response, 202, { status: 'started', ...StartPlanRoute.#startedAnswer(started) })
  }

  static #sendListed(sessions, reviews, response, result) {
    const started = result.started.map((one) => {
      sessions.remember(one.watch)
      reviews.start(one.watch)
      return StartPlanRoute.#startedAnswer(one)
    })
    const failed = result.failed.map((notStarted) => {
      const collapse = PlanCollapse.of(notStarted.cause)
      return { [PlanRequest.REPO_FIELD]: notStarted.repository.text, code: collapse.code, detail: collapse.detail }
    })

    if (started.length === 0) {
      const refusal = PlanRefusal.of(PlanRequest.refused(PlanRequestOutcome.NO_PLAN_STARTED))
      Answer.send(response, 400, { code: refusal.code, detail: refusal.detail, failed })
      return
    }

    Answer.send(response, 202, { status: 'started', started, failed })
  }

  static #startedAnswer(started) {
    return {
      [PlanRequest.ID_FIELD]: started.watch.storyText(),
      [PlanRequest.REPO_FIELD]: started.watch.repository.text,
      issue: { number: started.watch.issue.number, url: started.watch.issue.url },
      agent: started.agent,
      branch: started.watch.located.branch,
      worktree: started.watch.located.path,
      root: started.watch.located.root,
    }
  }

  static refuseOtherMethods(request, response) {
    response.setHeader('Allow', StartPlanRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
