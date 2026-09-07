import { Answer, Refusal } from './http.js'
import { Projection } from './projection.js'
import { ReadImplementationProgressParams } from '../application/queries/read-implementation-progress.js'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.js'
import { RepositoryName } from '../domain/value-objects/repository-name.js'
import { ImplementationProgressFailure, ImplementationProgressNotRead } from '../domain/exceptions.js'

export const ProgressRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  MALFORMED_ROOT: 'malformed-root',
  MALFORMED_REPO: 'malformed-progress-repo',
})

export class ProgressRequest {
  static ROOT_FIELD = 'root'
  static REPO_FIELD = 'repo'

  constructor({ outcome, root, issue, repository }) {
    this.outcome = outcome
    this.root = root
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }

  static accepted({ root, issue, repository }) {
    return new ProgressRequest({ outcome: ProgressRequestOutcome.ACCEPTED, root, issue, repository })
  }

  static refused(outcome) {
    return new ProgressRequest({ outcome, root: null, issue: null, repository: null })
  }

  static from(rawIssue, rawRoot, rawRepo) {
    if (!CheckoutRoot.isWellFormed(rawRoot)) {
      return ProgressRequest.refused(ProgressRequestOutcome.MALFORMED_ROOT)
    }
    if (!RepositoryName.isWellFormed(rawRepo)) {
      return ProgressRequest.refused(ProgressRequestOutcome.MALFORMED_REPO)
    }

    return ProgressRequest.accepted({
      root: new CheckoutRoot(rawRoot), issue: Number(rawIssue), repository: new RepositoryName(rawRepo),
    })
  }
}

export class ProgressRefusal {
  static #BY_OUTCOME = new Projection('refusal', [
    [ProgressRequestOutcome.MALFORMED_ROOT, () => new Refusal({
      status: 400,
      code: ProgressRequestOutcome.MALFORMED_ROOT,
      detail: `${ProgressRequest.ROOT_FIELD} is an absolute path such as ${CheckoutRoot.EXAMPLE}`,
    })],
    [ProgressRequestOutcome.MALFORMED_REPO, () => new Refusal({
      status: 400,
      code: ProgressRequestOutcome.MALFORMED_REPO,
      detail: `${ProgressRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
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
      const asked = ProgressRequest.from(
        request.params.issue,
        request.query[ProgressRequest.ROOT_FIELD],
        request.query[ProgressRequest.REPO_FIELD]
      )
      if (asked.outcome !== ProgressRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, ProgressRefusal.of(asked))
        return
      }
      let read
      try {
        read = await readImplementationProgress.execute(
          new ReadImplementationProgressParams({
            root: asked.root, issue: asked.issue, repository: asked.repository,
          })
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
        pull_request: read.state.pullRequest,
      })
    }
  }

  static refuseOtherMethods(request, response) {
    response.setHeader('Allow', ImplementProgressRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
