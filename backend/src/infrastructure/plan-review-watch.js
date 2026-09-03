import { PlanFailure } from '../domain/exceptions.js'

class Followed {
  constructor() {
    this.stopped = false
    this.attended = new Set()
  }

  attend(change) {
    if (this.attended.has(change.id)) return false
    this.attended.add(change.id)

    return true
  }
}

export class PlanReviewWatch {
  constructor({ asked, review, sleep, stderr }) {
    this.asked = asked
    this.review = review
    this.sleep = sleep
    this.stderr = stderr
    this.live = new Map()
  }

  start(watch) {
    const followed = new Followed()
    this.live.set(watch.issue.number, followed)

    return this.#follow(watch, followed).catch((cause) => {
      this.#warn(watch, `stopped watching it: ${cause.message}`)
    })
  }

  stop(issueNumber) {
    const followed = this.live.get(issueNumber)
    if (followed === undefined) return
    followed.stopped = true
    this.live.delete(issueNumber)
  }

  async #follow(watch, followed) {
    while (!followed.stopped) {
      await this.sleep()
      if (followed.stopped) return
      await this.#attend(watch, followed)
    }
  }

  async #attend(watch, followed) {
    const read = await this.#sound(watch)
    if (read === null) return
    for (const change of read.changes) {
      if (!followed.attend(change)) continue
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
