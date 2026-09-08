import { LOOP_BRANCH_PREFIX } from '../../../plugin/scripts/conventions.js'
import { PullRequests } from '../domain/ports/pull-requests.js'
import { ChangeAsked } from '../domain/value-objects/change-asked.js'
import { PullRequestNotRead, PullRequestNotUnderstood } from '../domain/exceptions.js'
import { Gh } from './gh.js'

export class OpenPullRequest {
  constructor({ number, url }) {
    this.number = number
    this.url = url
    Object.freeze(this)
  }
}

export class GhPullRequests extends PullRequests {
  static #ASKS = Object.freeze(['CHANGES_REQUESTED', 'COMMENTED'])
  static #PAGE_SIZE = 'per_page=100'

  constructor({ gh }) {
    super()
    this.gh = gh
  }

  static #branchOf(issueNumber) {
    return `${LOOP_BRANCH_PREFIX}${issueNumber}`
  }

  static #listArgvFor({ issueNumber, repository }) {
    return [
      'pr', 'list', '--repo', repository.text,
      '--head', GhPullRequests.#branchOf(issueNumber),
      '--state', 'open', '--json', 'number,url', '--limit', '1',
    ]
  }

  static #reviewsArgvFor({ pullRequest, repository }) {
    return [
      'api', `repos/${repository.text}/pulls/${pullRequest.number}/reviews`,
      '-f', GhPullRequests.#PAGE_SIZE, '--paginate', '--slurp', '--method', 'GET',
    ]
  }

  static #commentsArgvFor({ pullRequest, repository }) {
    return [
      'api', `repos/${repository.text}/pulls/${pullRequest.number}/comments`,
      '-f', GhPullRequests.#PAGE_SIZE, '--paginate', '--slurp', '--method', 'GET',
    ]
  }

  async openOf({ issueNumber, repository }) {
    const printed = await this.#read(GhPullRequests.#listArgvFor({ issueNumber, repository }))
    const listed = GhPullRequests.#arrayIn(printed, `the pull requests of ${GhPullRequests.#branchOf(issueNumber)}`)
    if (listed.length === 0) return null

    const found = listed[0]
    if (!Number.isInteger(found?.number) || typeof found?.url !== 'string') {
      throw new PullRequestNotUnderstood(
        `${Gh.BIN} named a pull request without the number and the url this reads, it printed ${JSON.stringify(printed)}`
      )
    }

    return new OpenPullRequest({ number: found.number, url: found.url })
  }

  async fixesAsked({ pullRequest, repository }) {
    const reviews = GhPullRequests.#pagesIn(
      await this.#read(GhPullRequests.#reviewsArgvFor({ pullRequest, repository })),
      `the reviews of #${pullRequest.number}`
    )
    const comments = GhPullRequests.#pagesIn(
      await this.#read(GhPullRequests.#commentsArgvFor({ pullRequest, repository })),
      `the comments of #${pullRequest.number}`
    )
    const anchored = GhPullRequests.#byReview(comments, pullRequest)

    return GhPullRequests.#asked(reviews, anchored, pullRequest)
  }

  static #asked(reviews, anchored, pullRequest) {
    const changes = []
    for (const review of [...reviews].sort((one, other) => GhPullRequests.#idOf(one, pullRequest) - GhPullRequests.#idOf(other, pullRequest))) {
      const id = GhPullRequests.#idOf(review, pullRequest)
      const carried = anchored.get(id) ?? []
      if (!GhPullRequests.#asksForAChange(review, carried, pullRequest)) continue

      changes.push(new ChangeAsked({ id: String(id), text: GhPullRequests.#textOf(review, carried) }))
    }

    return changes
  }

  static #asksForAChange(review, carried, pullRequest) {
    if (typeof review?.state !== 'string' || typeof review?.body !== 'string') {
      throw new PullRequestNotUnderstood(
        `${Gh.BIN} sent a review of #${pullRequest.number} without the state and the body this reads, it printed ${JSON.stringify(review)}`
      )
    }
    if (!GhPullRequests.#ASKS.includes(review.state)) return false

    return review.body.trim().length > 0 || carried.length > 0
  }

  static #textOf(review, carried) {
    const parts = review.body.trim().length > 0 ? [review.body.trim()] : []
    parts.push(...carried.map((comment) => GhPullRequests.#anchored(comment)))

    return parts.join('\n')
  }

  static #anchored(comment) {
    const where = Number.isInteger(comment.line) ? `${comment.path}:${comment.line}` : comment.path

    return `${where}: ${comment.body.trim()}`
  }

  static #byReview(comments, pullRequest) {
    const anchored = new Map()
    for (const comment of comments) {
      if (typeof comment?.body !== 'string' || typeof comment?.path !== 'string') {
        throw new PullRequestNotUnderstood(
          `${Gh.BIN} sent a comment of #${pullRequest.number} without the body and the path this reads, it printed ${JSON.stringify(comment)}`
        )
      }
      const id = comment.pull_request_review_id
      if (!anchored.has(id)) anchored.set(id, [])
      anchored.get(id).push(comment)
    }

    return anchored
  }

  static #idOf(review, pullRequest) {
    if (!Number.isInteger(review?.id)) {
      throw new PullRequestNotUnderstood(
        `${Gh.BIN} sent a review of #${pullRequest.number} without the id this reads, it printed ${JSON.stringify(review)}`
      )
    }

    return review.id
  }

  static #arrayIn(printed, what) {
    let parsed
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new PullRequestNotUnderstood(
        `${Gh.BIN} answered something that is not json for ${what}, it printed ${JSON.stringify(printed)}`
      )
    }
    if (!Array.isArray(parsed)) {
      throw new PullRequestNotUnderstood(
        `${Gh.BIN} answered ${what} without a list, it printed ${JSON.stringify(printed)}`
      )
    }

    return parsed
  }

  static #pagesIn(printed, what) {
    return GhPullRequests.#arrayIn(printed, what).flat()
  }

  async #read(argv) {
    const outcome = await this.gh.run(argv, { safeToRepeat: true })
    if (outcome.failed) {
      throw new PullRequestNotRead(`${Gh.BIN} ${argv[0]} failed: ${outcome.stderr.trim()}`)
    }

    return outcome.stdout
  }
}
