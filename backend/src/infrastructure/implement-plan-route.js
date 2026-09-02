import { Answer, JsonBody, Refusal } from './http.js'
import { ImplementPlanParams } from '../application/actions/implement-plan.js'
import { UserStoryKey } from '../domain/value-objects/user-story-key.js'
import { RepositoryName } from '../domain/value-objects/repository-name.js'
import { PlanFailure, PlanAgentNotResumed } from '../domain/exceptions.js'

export const ImplementRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_ID: 'malformed-id',
  MALFORMED_REPO: 'malformed-repo',
  MALFORMED_ISSUE: 'malformed-issue',
})

export class ImplementRequest {
  static ID_FIELD = 'id'
  static REPO_FIELD = 'repo'
  static ISSUE_FIELD = 'issue'
  static KNOWN_FIELDS = Object.freeze([
    ImplementRequest.ID_FIELD, ImplementRequest.REPO_FIELD, ImplementRequest.ISSUE_FIELD,
  ])

  constructor({ outcome, story, issue, repository, fields }) {
    if (!Object.values(ImplementRequestOutcome).includes(outcome)) {
      throw new Error(`outcome must be an ImplementRequestOutcome member, got ${outcome}`)
    }
    if ((outcome === ImplementRequestOutcome.ACCEPTED) === (story === null)) {
      throw new Error(`outcome ${outcome} disagrees with its story, got ${story}`)
    }
    if ((outcome === ImplementRequestOutcome.ACCEPTED) === (issue === null)) {
      throw new Error(`outcome ${outcome} disagrees with its issue, got ${issue}`)
    }
    if ((outcome === ImplementRequestOutcome.ACCEPTED) === (repository === null)) {
      throw new Error(`outcome ${outcome} disagrees with its repository, got ${repository}`)
    }
    if (outcome !== ImplementRequestOutcome.UNKNOWN_FIELD && fields.length > 0) {
      throw new Error(`outcome ${outcome} must carry no fields, got ${fields.join(', ')}`)
    }
    if (outcome === ImplementRequestOutcome.UNKNOWN_FIELD && fields.length === 0) {
      throw new Error('an unknown-field outcome must name the fields it rejected')
    }
    this.outcome = outcome
    this.story = story
    this.issue = issue
    this.repository = repository
    this.fields = Object.freeze([...fields])
    Object.freeze(this)
  }

  static accepted({ story, issue, repository }) {
    return new ImplementRequest({
      outcome: ImplementRequestOutcome.ACCEPTED, story, issue, repository, fields: [],
    })
  }

  static refused(outcome) {
    return new ImplementRequest({
      outcome, story: null, issue: null, repository: null, fields: [],
    })
  }

  static withUnknownFields(fields) {
    return new ImplementRequest({
      outcome: ImplementRequestOutcome.UNKNOWN_FIELD,
      story: null, issue: null, repository: null, fields,
    })
  }

  static isWellFormedIssue(given) {
    return Number.isInteger(given) && given >= 1
  }

  static from(raw) {
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return ImplementRequest.refused(ImplementRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return ImplementRequest.refused(ImplementRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    const unknown = Object.keys(parsed).filter(
      (field) => !ImplementRequest.KNOWN_FIELDS.includes(field)
    )
    if (unknown.length > 0) {
      return ImplementRequest.withUnknownFields(unknown.sort())
    }
    if (!UserStoryKey.isWellFormed(parsed[ImplementRequest.ID_FIELD])) {
      return ImplementRequest.refused(ImplementRequestOutcome.MALFORMED_ID)
    }
    if (!RepositoryName.isWellFormed(parsed[ImplementRequest.REPO_FIELD])) {
      return ImplementRequest.refused(ImplementRequestOutcome.MALFORMED_REPO)
    }
    if (!ImplementRequest.isWellFormedIssue(parsed[ImplementRequest.ISSUE_FIELD])) {
      return ImplementRequest.refused(ImplementRequestOutcome.MALFORMED_ISSUE)
    }

    return ImplementRequest.accepted({
      story: new UserStoryKey(parsed[ImplementRequest.ID_FIELD]),
      issue: parsed[ImplementRequest.ISSUE_FIELD],
      repository: new RepositoryName(parsed[ImplementRequest.REPO_FIELD]),
    })
  }
}

export class ImplementRefusal {
  static #BY_OUTCOME = Object.freeze({
    [ImplementRequestOutcome.BODY_NOT_A_JSON_OBJECT]: () =>
      new Refusal({ status: 400, error: 'body must be a JSON object' }),
    [ImplementRequestOutcome.MALFORMED_ID]: () => new Refusal({
      status: 400,
      error: `${ImplementRequest.ID_FIELD} must be a user story key such as ${UserStoryKey.EXAMPLE}`,
    }),
    [ImplementRequestOutcome.MALFORMED_REPO]: () => new Refusal({
      status: 400,
      error: `${ImplementRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    }),
    [ImplementRequestOutcome.MALFORMED_ISSUE]: () => new Refusal({
      status: 400,
      error: `${ImplementRequest.ISSUE_FIELD} must be a whole number from one`,
    }),
    [ImplementRequestOutcome.UNKNOWN_FIELD]: (asked) => new Refusal({
      status: 400,
      error: `unknown field: ${asked.fields.join(', ')}`,
    }),
  })

  static of(asked) {
    const declared = ImplementRefusal.#BY_OUTCOME[asked.outcome]
    if (declared === undefined) {
      throw new Error(`no refusal declared for outcome ${asked.outcome}`)
    }

    return declared(asked)
  }

  static declaredOutcomes() {
    return Object.keys(ImplementRefusal.#BY_OUTCOME)
  }
}

export class ImplementCollapse {
  static #REFUSED = 503

  static #BY_FAILURE = [[PlanAgentNotResumed, ImplementCollapse.#REFUSED]]

  static of(cause) {
    const declared = ImplementCollapse.#BY_FAILURE.find(([failure]) => cause.constructor === failure)
    if (declared === undefined) {
      throw new Error(`no status declared for ${cause.constructor.name}`)
    }

    return new Refusal({
      status: declared[1], error: `could not implement the plan: ${cause.message}`,
    })
  }

  static declaredFailures() {
    return ImplementCollapse.#BY_FAILURE.map(([failure]) => failure.name)
  }
}

export class ImplementPlanRoute {
  static PATH = '/implement-plan'
  static METHOD = 'POST'

  static handledBy(implementPlan) {
    return async (request, response) => {
      const asked = ImplementRequest.from(JsonBody.textOf(request))
      if (asked.outcome !== ImplementRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, ImplementRefusal.of(asked))
        return
      }
      await ImplementPlanRoute.#accept(implementPlan, response, asked)
    }
  }

  static async #accept(implementPlan, response, asked) {
    try {
      await implementPlan.execute(new ImplementPlanParams({
        story: asked.story, issue: asked.issue, repository: asked.repository,
      }))
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      Answer.refuseAs(response, ImplementCollapse.of(cause))
      return
    }
    Answer.send(response, 202, {
      status: 'implementing',
      [ImplementRequest.ID_FIELD]: asked.story.text,
      [ImplementRequest.REPO_FIELD]: asked.repository.text,
      [ImplementRequest.ISSUE_FIELD]: asked.issue,
    })
  }

  static refuseOtherMethods(request, response) {
    response.setHeader('Allow', ImplementPlanRoute.METHOD)
    Answer.refuse(response, 405, 'method not allowed')
  }
}
