import { Answer, Refusal } from './http.js'
import { Projection } from './projection.js'
import { ReadImplementationProgressParams } from '../application/queries/read-implementation-progress.js'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.js'
import { ImplementationProgressFailure, ImplementationProgressNotRead } from '../domain/exceptions.js'

export const ProgressRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  MALFORMED_ROOT: 'malformed-root',
})

export class ProgressRequest {
  static ROOT_FIELD = 'root'

  constructor({ outcome, root, issue }) {
    this.outcome = outcome
    this.root = root
    this.issue = issue
    Object.freeze(this)
  }

  static accepted({ root, issue }) {
    return new ProgressRequest({ outcome: ProgressRequestOutcome.ACCEPTED, root, issue })
  }

  static refused(outcome) {
    return new ProgressRequest({ outcome, root: null, issue: null })
  }

  static from(rawIssue, rawRoot) {
    if (!CheckoutRoot.isWellFormed(rawRoot)) {
      return ProgressRequest.refused(ProgressRequestOutcome.MALFORMED_ROOT)
    }

    return ProgressRequest.accepted({ root: new CheckoutRoot(rawRoot), issue: Number(rawIssue) })
  }
}

export class ProgressRefusal {
  static #BY_OUTCOME = new Projection('refusal', [
    [ProgressRequestOutcome.MALFORMED_ROOT, () => new Refusal({
      status: 400,
      code: ProgressRequestOutcome.MALFORMED_ROOT,
      detail: `${ProgressRequest.ROOT_FIELD} is an absolute path such as ${CheckoutRoot.EXAMPLE}`,
    })],
  ])

  static of(asked) {
    return ProgressRefusal.#BY_OUTCOME.of(asked.outcome)(asked)
  }

  static declaredOutcomes() {
    return ProgressRefusal.#BY_OUTCOME.members()
  }
}

export class ProgressCollapse {
  static #STATUS = 400

  static #collapsed(code) {
    return (cause) => new Refusal({ status: ProgressCollapse.#STATUS, code, detail: cause.message })
  }

  static #BY_FAILURE = new Projection('refusal', [
    [ImplementationProgressNotRead, ProgressCollapse.#collapsed('implementation-progress-not-read')],
  ])

  static of(cause) {
    return ProgressCollapse.#BY_FAILURE.of(cause.constructor)(cause)
  }

  static declaredFailures() {
    return ProgressCollapse.#BY_FAILURE.members().map((failure) => failure.name)
  }

  static declaredCodes() {
    return ProgressCollapse.#BY_FAILURE.members().map((failure) => ProgressCollapse.of(new failure('x')).code)
  }
}

export class ImplementProgressRoute {
  static PATH = '/implement-progress/:issue'
  static METHOD = 'GET'

  static handledBy(readImplementationProgress) {
    return async (request, response) => {
      const asked = ProgressRequest.from(request.params.issue, request.query[ProgressRequest.ROOT_FIELD])
      if (asked.outcome !== ProgressRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, ProgressRefusal.of(asked))
        return
      }
      let read
      try {
        read = await readImplementationProgress.execute(
          new ReadImplementationProgressParams({ root: asked.root, issue: asked.issue })
        )
      } catch (cause) {
        if (!(cause instanceof ImplementationProgressFailure)) throw cause
        Answer.refuseAs(response, ProgressCollapse.of(cause))
        return
      }
      Answer.send(response, 200, {
        step: read.state.step,
        task: read.state.task,
        total_tasks: read.state.totalTasks,
        name: read.state.name,
        attempt: read.state.attempt,
        discards: read.state.discards,
      })
    }
  }
}
