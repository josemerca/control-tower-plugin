import { Answer, JsonBody, Refusal } from './http.js'
import { ImplementPlanParams } from '../application/actions/implement-plan.js'
import { RepositoryName } from '../domain/value-objects/repository-name.js'
import {
  PlanFailure, PlanAgentNotResumed, PlanGoNotAnswered, GoNotRecorded,
} from '../domain/exceptions.js'

export const ImplementRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_AGENT: 'malformed-agent',
  MALFORMED_ISSUE: 'malformed-issue',
  MALFORMED_REPO: 'malformed-repo',
})

class ImplementRequest {
  static AGENT_FIELD = 'agent'
  static ISSUE_FIELD = 'issue'
  static REPO_FIELD = 'repo'
  static KNOWN_FIELDS = Object.freeze([
    ImplementRequest.AGENT_FIELD, ImplementRequest.ISSUE_FIELD, ImplementRequest.REPO_FIELD,
  ])

  constructor({ outcome, agent, issue, repository, fields }) {
    this.outcome = outcome
    this.agent = agent
    this.issue = issue
    this.repository = repository
    this.fields = Object.freeze([...fields])
    Object.freeze(this)
  }

  static accepted({ agent, issue, repository }) {
    return new ImplementRequest({
      outcome: ImplementRequestOutcome.ACCEPTED, agent, issue, repository, fields: [],
    })
  }

  static refused(outcome) {
    return new ImplementRequest({
      outcome, agent: null, issue: null, repository: null, fields: [],
    })
  }

  static withUnknownFields(fields) {
    return new ImplementRequest({
      outcome: ImplementRequestOutcome.UNKNOWN_FIELD,
      agent: null, issue: null, repository: null, fields,
    })
  }

  static #isWellFormedIssue(given) {
    return Number.isInteger(given) && given >= 1
  }

  static #isWellFormedAgent(given) {
    return typeof given === 'string' && given.length > 0 && !/\s/.test(given)
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
    if (!ImplementRequest.#isWellFormedAgent(parsed[ImplementRequest.AGENT_FIELD])) {
      return ImplementRequest.refused(ImplementRequestOutcome.MALFORMED_AGENT)
    }
    if (!ImplementRequest.#isWellFormedIssue(parsed[ImplementRequest.ISSUE_FIELD])) {
      return ImplementRequest.refused(ImplementRequestOutcome.MALFORMED_ISSUE)
    }
    if (!RepositoryName.isWellFormed(parsed[ImplementRequest.REPO_FIELD])) {
      return ImplementRequest.refused(ImplementRequestOutcome.MALFORMED_REPO)
    }

    return ImplementRequest.accepted({
      agent: parsed[ImplementRequest.AGENT_FIELD],
      issue: parsed[ImplementRequest.ISSUE_FIELD],
      repository: new RepositoryName(parsed[ImplementRequest.REPO_FIELD]),
    })
  }
}

export class ImplementRefusal {
  static #BY_OUTCOME = Object.freeze({
    [ImplementRequestOutcome.BODY_NOT_A_JSON_OBJECT]: () =>
      new Refusal({ status: 400, error: 'body must be a JSON object' }),
    [ImplementRequestOutcome.MALFORMED_AGENT]: () => new Refusal({
      status: 400,
      error: `${ImplementRequest.AGENT_FIELD} must be the handle start-plan answered with`,
    }),
    [ImplementRequestOutcome.MALFORMED_ISSUE]: () => new Refusal({
      status: 400,
      error: `${ImplementRequest.ISSUE_FIELD} must be a whole number from one`,
    }),
    [ImplementRequestOutcome.MALFORMED_REPO]: () => new Refusal({
      status: 400,
      error: `${ImplementRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
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

  static #BY_FAILURE = [
    [GoNotRecorded, ImplementCollapse.#REFUSED],
    [PlanGoNotAnswered, ImplementCollapse.#REFUSED],
    [PlanAgentNotResumed, ImplementCollapse.#REFUSED],
  ]

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

  static handledBy(implementPlan, sessions, reviews) {
    return async (request, response) => {
      const asked = ImplementRequest.from(JsonBody.textOf(request))
      if (asked.outcome !== ImplementRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, ImplementRefusal.of(asked))
        return
      }
      await ImplementPlanRoute.#accept(implementPlan, sessions, reviews, response, asked)
    }
  }

  static async #accept(implementPlan, sessions, reviews, response, asked) {
    try {
      await implementPlan.execute(new ImplementPlanParams({
        agent: asked.agent, issue: asked.issue, repository: asked.repository,
      }))
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      Answer.refuseAs(response, ImplementCollapse.of(cause))
      return
    }
    reviews.stop(asked.issue)
    sessions.forget(asked.issue)
    Answer.send(response, 202, {
      status: 'implementing',
      [ImplementRequest.AGENT_FIELD]: asked.agent,
      [ImplementRequest.ISSUE_FIELD]: asked.issue,
    })
  }

  static refuseOtherMethods(request, response) {
    response.setHeader('Allow', ImplementPlanRoute.METHOD)
    Answer.refuse(response, 405, 'method not allowed')
  }
}
