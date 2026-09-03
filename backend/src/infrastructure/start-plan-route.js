import { Answer, JsonBody, Refusal } from './http.js'
import { StartPlanParams } from '../application/actions/start-plan.js'
import { UserStoryKey } from '../domain/value-objects/user-story-key.js'
import { RepositoryName } from '../domain/value-objects/repository-name.js'
import {
  PlanFailure,
  UserStoryNotRead, UserStoryNotUnderstood, PlanIssueNotCreated, PlanIssueNotNamed,
  PlanIssueNotClaimed,
  PlanAgentNotLaunched, PlanAgentNotNamed, WorkspaceNotPrepared, WorkspaceNotUnderstood,
} from '../domain/exceptions.js'

export const PlanRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_ID: 'malformed-id',
  MALFORMED_REPO: 'malformed-repo',
})

export class PlanRequest {
  static ID_FIELD = 'id'
  static REPO_FIELD = 'repo'
  static KNOWN_FIELDS = Object.freeze([PlanRequest.ID_FIELD, PlanRequest.REPO_FIELD])

  constructor({ outcome, story, repository, fields }) {
    if (!Object.values(PlanRequestOutcome).includes(outcome)) {
      throw new Error(`outcome must be a PlanRequestOutcome member, got ${outcome}`)
    }
    if ((outcome === PlanRequestOutcome.ACCEPTED) === (story === null)) {
      throw new Error(`outcome ${outcome} disagrees with its story, got ${story}`)
    }
    if ((outcome === PlanRequestOutcome.ACCEPTED) === (repository === null)) {
      throw new Error(`outcome ${outcome} disagrees with its repository, got ${repository}`)
    }
    if (outcome !== PlanRequestOutcome.UNKNOWN_FIELD && fields.length > 0) {
      throw new Error(`outcome ${outcome} must carry no fields, got ${fields.join(', ')}`)
    }
    if (outcome === PlanRequestOutcome.UNKNOWN_FIELD && fields.length === 0) {
      throw new Error('an unknown-field outcome must name the fields it rejected')
    }
    this.outcome = outcome
    this.story = story
    this.repository = repository
    this.fields = Object.freeze([...fields])
    Object.freeze(this)
  }

  static accepted(story, repository) {
    return new PlanRequest({ outcome: PlanRequestOutcome.ACCEPTED, story, repository, fields: [] })
  }

  static refused(outcome) {
    return new PlanRequest({ outcome, story: null, repository: null, fields: [] })
  }

  static withUnknownFields(fields) {
    return new PlanRequest({
      outcome: PlanRequestOutcome.UNKNOWN_FIELD, story: null, repository: null, fields,
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
    return PlanRequest.accepted(new UserStoryKey(given), new RepositoryName(asked))
  }
}

export class PlanRefusal {
  static #BY_OUTCOME = Object.freeze({
    [PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT]: () =>
      new Refusal({ status: 400, error: 'body must be a JSON object' }),
    [PlanRequestOutcome.MALFORMED_ID]: () => new Refusal({
      status: 400,
      error: `${PlanRequest.ID_FIELD} must be a user story key such as ${UserStoryKey.EXAMPLE}`,
    }),
    [PlanRequestOutcome.MALFORMED_REPO]: () => new Refusal({
      status: 400,
      error: `${PlanRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    }),
    [PlanRequestOutcome.UNKNOWN_FIELD]: (asked) => new Refusal({
      status: 400,
      error: `unknown field: ${asked.fields.join(', ')}`,
    }),
  })

  static of(asked) {
    const declared = PlanRefusal.#BY_OUTCOME[asked.outcome]
    if (declared === undefined) {
      throw new Error(`no refusal declared for outcome ${asked.outcome}`)
    }

    return declared(asked)
  }

  static declaredOutcomes() {
    return Object.keys(PlanRefusal.#BY_OUTCOME)
  }
}

export class PlanCollapse {
  static #REFUSED = 503
  static #ANSWERED_SOMETHING_ELSE = 502

  static #BY_FAILURE = [
    [UserStoryNotRead, PlanCollapse.#REFUSED],
    [PlanIssueNotCreated, PlanCollapse.#REFUSED],
    [PlanIssueNotClaimed, PlanCollapse.#REFUSED],
    [PlanAgentNotLaunched, PlanCollapse.#REFUSED],
    [WorkspaceNotPrepared, PlanCollapse.#REFUSED],
    [UserStoryNotUnderstood, PlanCollapse.#ANSWERED_SOMETHING_ELSE],
    [PlanIssueNotNamed, PlanCollapse.#ANSWERED_SOMETHING_ELSE],
    [PlanAgentNotNamed, PlanCollapse.#ANSWERED_SOMETHING_ELSE],
    [WorkspaceNotUnderstood, PlanCollapse.#ANSWERED_SOMETHING_ELSE],
  ]

  static of(cause) {
    const declared = PlanCollapse.#BY_FAILURE.find(([failure]) => cause.constructor === failure)
    if (declared === undefined) {
      throw new Error(`no status declared for ${cause.constructor.name}`)
    }

    return new Refusal({ status: declared[1], error: `could not start the plan: ${cause.message}` })
  }

  static declaredFailures() {
    return PlanCollapse.#BY_FAILURE.map(([failure]) => failure.name)
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
        new StartPlanParams({ story: asked.story, repository: asked.repository })
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
    })
  }

  static refuseOtherMethods(request, response) {
    response.setHeader('Allow', StartPlanRoute.METHOD)
    Answer.refuse(response, 405, 'method not allowed')
  }
}
