import { PlanFailure } from '../domain/exceptions.js'

export class PlanReviewWatch {
  constructor({ asked, review, sleep, stderr }) {
    this.asked = asked
    this.review = review
    this.sleep = sleep
    this.stderr = stderr
    this.live = new Map()
  }

  static #keyFor(repository, issueNumber) {
    return `${repository.text}#${issueNumber}`
  }

  start(watch) {
    const key = PlanReviewWatch.#keyFor(watch.repository, watch.issue.number)
    const attended = new Set()
    this.live.set(key, attended)

    return this.#follow(watch, key, attended).catch((cause) => {
      this.stop({ issue: watch.issue.number, repository: watch.repository })
      this.#warn(watch, `is no longer watched: ${cause.message}`)
    })
  }

  stop({ issue, repository }) {
    this.live.delete(PlanReviewWatch.#keyFor(repository, issue))
  }

  async #follow(watch, key, attended) {
    for (;;) {
      await this.sleep()
      if (!this.live.has(key)) return
      await this.#attend(watch, key, attended)
    }
  }

  async #attend(watch, key, attended) {
    const read = await this.#sound(watch)
    if (read === null) return
    for (const change of read.changes) {
      if (!this.live.has(key)) return
      if (attended.has(change.id)) continue
      attended.add(change.id)
      await this.#deliver(watch, change)
    }
  }

  async #sound(watch) {
    try {
      return await this.asked(watch)
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      this.#warn(watch, `could not be asked what changes were asked for: ${cause.message}`)

      return null
    }
  }

  async #deliver(watch, change) {
    try {
      await this.review({
        agent: watch.agent,
        issue: watch.issue.number,
        repository: watch.repository,
        changes: change.text,
      })
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      this.#warn(watch, `the changes asked for in ${change.id} could not be typed into ${watch.agent}: ${cause.message}`)
    }
  }

  #warn(watch, said) {
    this.stderr(`plan review watch: ${watch.repository.text}#${watch.issue.number} ${said}\n`)
  }
}
