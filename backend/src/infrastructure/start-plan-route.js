import { Answer, JsonBody, Refusal } from './http.js'
import { Projection } from './projection.js'
import { StartPlanParams } from '../application/actions/start-plan.js'
import { UserStoryKey } from '../domain/value-objects/user-story-key.js'
import { RepositoryName } from '../domain/value-objects/repository-name.js'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.js'
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
  MALFORMED_REPO: 'malformed-repo',
  MALFORMED_PATH: 'malformed-path',
})

export class PlanRequest {
  static ID_FIELD = 'id'
  static REPO_FIELD = 'repo'
  static PATH_FIELD = 'path'
  static KNOWN_FIELDS = Object.freeze([PlanRequest.ID_FIELD, PlanRequest.REPO_FIELD, PlanRequest.PATH_FIELD])

  constructor({ outcome, story, repository, root, fields }) {
    this.outcome = outcome
    this.story = story
    this.repository = repository
    this.root = root
    this.fields = Object.freeze([...fields])
    Object.freeze(this)
  }

  static accepted(story, repository, root) {
    return new PlanRequest({ outcome: PlanRequestOutcome.ACCEPTED, story, repository, root, fields: [] })
  }

  static refused(outcome) {
    return new PlanRequest({ outcome, story: null, repository: null, root: null, fields: [] })
  }

  static withUnknownFields(fields) {
    return new PlanRequest({
      outcome: PlanRequestOutcome.UNKNOWN_FIELD, story: null, repository: null, root: null, fields,
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
    const given = parsed[PlanRequest.ID_FIELD]
    if (!UserStoryKey.isWellFormed(given)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_ID)
    }
    const asked = parsed[PlanRequest.REPO_FIELD]
    if (!RepositoryName.isWellFormed(asked)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_REPO)
    }
    const where = parsed[PlanRequest.PATH_FIELD]
    if (!CheckoutRoot.isWellFormed(where)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_PATH)
    }
    return PlanRequest.accepted(new UserStoryKey(given), new RepositoryName(asked), new CheckoutRoot(where))
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
    [PlanRequestOutcome.MALFORMED_REPO, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.MALFORMED_REPO,
      detail: `${PlanRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    })],
    [PlanRequestOutcome.MALFORMED_PATH, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.MALFORMED_PATH,
      detail: `${PlanRequest.PATH_FIELD} must be an absolute path`,
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

  static #BY_FAILURE = new Projection('status', [
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
    let started
    try {
      started = await startPlan.execute(
        new StartPlanParams({ story: asked.story, repository: asked.repository, root: asked.root })
      )
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      Answer.refuseAs(response, PlanCollapse.of(cause))
      return
    }
    sessions.remember(started.watch)
    reviews.start(started.watch)
    Answer.send(response, 202, {
      status: 'started',
      [PlanRequest.ID_FIELD]: asked.story.text,
      [PlanRequest.REPO_FIELD]: asked.repository.text,
      issue: { number: started.watch.issue.number, url: started.watch.issue.url },
      agent: started.agent,
      branch: started.watch.located.branch,
      worktree: started.watch.located.path,
    })
  }

  static refuseOtherMethods(request, response) {
    response.setHeader('Allow', StartPlanRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
