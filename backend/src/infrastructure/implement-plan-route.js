import { Answer, JsonBody, Refusal } from './http.js'
import { Projection } from './projection.js'
import { ImplementPlanParams } from '../application/actions/implement-plan.js'
import { RepositoryName } from '../domain/value-objects/repository-name.js'
import { ActivePlanPhase } from './active-plans-route.js'
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
  NO_LIVE_SESSION: 'no-live-planning-session',
  UNCERTAIN_PHASE: 'implementation-phase-uncertain',
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
  static #BY_OUTCOME = new Projection('refusal', [
    [ImplementRequestOutcome.BODY_NOT_A_JSON_OBJECT, () => new Refusal({
      status: 400,
      code: ImplementRequestOutcome.BODY_NOT_A_JSON_OBJECT,
      detail: 'body must be a JSON object',
    })],
    [ImplementRequestOutcome.MALFORMED_AGENT, () => new Refusal({
      status: 400,
      code: ImplementRequestOutcome.MALFORMED_AGENT,
      detail: `${ImplementRequest.AGENT_FIELD} must be the handle start-plan answered with`,
    })],
    [ImplementRequestOutcome.MALFORMED_ISSUE, () => new Refusal({
      status: 400,
      code: ImplementRequestOutcome.MALFORMED_ISSUE,
      detail: `${ImplementRequest.ISSUE_FIELD} must be a whole number from one`,
    })],
    [ImplementRequestOutcome.MALFORMED_REPO, () => new Refusal({
      status: 400,
      code: ImplementRequestOutcome.MALFORMED_REPO,
      detail: `${ImplementRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    })],
    [ImplementRequestOutcome.UNKNOWN_FIELD, (asked) => new Refusal({
      status: 400,
      code: ImplementRequestOutcome.UNKNOWN_FIELD,
      detail: `unknown field: ${asked.fields.join(', ')}`,
    })],
    [ImplementRequestOutcome.NO_LIVE_SESSION, () => new Refusal({
      status: 409,
      code: ImplementRequestOutcome.NO_LIVE_SESSION,
      detail: 'no matching live planning session exists',
    })],
    [ImplementRequestOutcome.UNCERTAIN_PHASE, () => new Refusal({
      status: 409,
      code: ImplementRequestOutcome.UNCERTAIN_PHASE,
      detail: 'implementation may have started; inspect the plan before retrying',
    })],
  ])

  static of(asked) {
    return ImplementRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }

  static declaredOutcomes() {
    return ImplementRefusal.#BY_OUTCOME.members()
  }
}

export class ImplementCollapse {
  static #STATUS = 400

  static #collapsed(code) {
    return (cause) => new Refusal({ status: ImplementCollapse.#STATUS, code, detail: cause.message })
  }

  static #BY_FAILURE = new Projection('refusal', [
    [GoNotRecorded, ImplementCollapse.#collapsed('go-not-recorded')],
    [PlanGoNotAnswered, ImplementCollapse.#collapsed('plan-go-not-answered')],
    [PlanAgentNotResumed, ImplementCollapse.#collapsed('plan-agent-not-resumed')],
  ])

  static of(cause) {
    return ImplementCollapse.#BY_FAILURE.of(cause.constructor)(cause)
  }

  static declaredFailures() {
    return ImplementCollapse.#BY_FAILURE.members().map((failure) => failure.name)
  }

  static declaredCodes() {
    return ImplementCollapse.#BY_FAILURE.members().map((failure) => ImplementCollapse.of(new failure('x')).code)
  }
}

export class ImplementPlanRoute {
  static PATH = '/implement-plan'
  static METHOD = 'POST'

  static handledBy(implementPlan, sessions, reviews, activePlans, implementationStarts, stderr) {
    const transitions = new Map()
    return async (request, response) => {
      const asked = ImplementRequest.from(JsonBody.textOf(request))
      if (asked.outcome !== ImplementRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, ImplementRefusal.of(asked))
        return
      }
      const key = `${asked.repository.text}#${asked.issue}`
      const pending = transitions.get(key)
      if (pending !== undefined) await pending
      const transition = ImplementPlanRoute.#accept(
        implementPlan, sessions, reviews, activePlans, implementationStarts, stderr, response, asked
      )
      transitions.set(key, transition)
      try {
        await transition
      } finally {
        if (transitions.get(key) === transition) transitions.delete(key)
      }
    }
  }

  static async #accept(implementPlan, sessions, reviews, activePlans, implementationStarts, stderr, response, asked) {
    const active = activePlans.find({ issue: asked.issue, repository: asked.repository })
    if (active === null || active.watch.agent !== asked.agent) {
      Answer.refuseAs(response, ImplementRefusal.of({ outcome: ImplementRequestOutcome.NO_LIVE_SESSION }))
      return
    }
    if (active.phase === ActivePlanPhase.UNCERTAIN) {
      Answer.refuseAs(response, ImplementRefusal.of({ outcome: ImplementRequestOutcome.UNCERTAIN_PHASE }))
      return
    }
    if (active.phase === ActivePlanPhase.IMPLEMENTING) {
      ImplementPlanRoute.#answerAccepted(response, asked)
      return
    }
    try {
      await implementPlan.execute(new ImplementPlanParams({
        agent: asked.agent, issue: asked.issue, repository: asked.repository,
      }))
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      Answer.refuseAs(response, ImplementCollapse.of(cause))
      return
    }
    const watch = active.watch
    activePlans.rememberImplementing(watch)
    try {
      await implementationStarts.remember(watch)
    } catch (failure) {
      stderr(`could not persist implementation start for ${asked.repository.text}#${asked.issue}: ${failure.message}\n`)
    }
    reviews.stop({ issue: asked.issue, repository: asked.repository })
    ImplementPlanRoute.#answerAccepted(response, asked)
  }

  static #answerAccepted(response, asked) {
    Answer.send(response, 202, {
      status: 'implementing',
      [ImplementRequest.AGENT_FIELD]: asked.agent,
      [ImplementRequest.ISSUE_FIELD]: asked.issue,
    })
  }

  static refuseOtherMethods(request, response) {
    response.setHeader('Allow', ImplementPlanRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
