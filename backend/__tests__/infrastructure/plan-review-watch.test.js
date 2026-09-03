import { describe, it, expect } from 'vitest'
import { PlanReviewWatch } from '../../src/infrastructure/plan-review-watch.js'
import { ChangeAsked } from '../../src/infrastructure/gh-plan-issues.js'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PlanChangesNotRead, PlanAgentNotResumed } from '../../src/domain/exceptions.js'

class WatchDouble {
  static AGENT = 'workspace:20'
  static NUMBER = 7
  static ISSUE = new PlanIssue({
    number: WatchDouble.NUMBER, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/7',
  })
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static SUBJECT = new PlanWatch({
    issue: WatchDouble.ISSUE,
    located: new WorkspaceLocation({ path: '/repo/.worktrees/7', branch: 'feat/7' }),
    repository: WatchDouble.REPOSITORY,
    agent: WatchDouble.AGENT,
  })

  static A_CHANGE = new ChangeAsked({
    id: 'IC_kwDOT9lB5c8AAAABRCF0GG', text: 'añade el caso de la issue sin descripción',
  })

  static ANOTHER_CHANGE = new ChangeAsked({
    id: 'IC_kwDOT9lB5c8AAAABRCF0HH', text: 'y parte la tarea 3 en dos',
  })

  constructor(soundings, { refusingTheDelivery = null, waits = null } = {}) {
    this.soundings = soundings
    this.refusingTheDelivery = refusingTheDelivery
    this.waits = waits ?? soundings.length
    this.asked = []
    this.reviewed = []
    this.warnings = []
    this.slept = 0
    this.watch = null
  }

  static answering(...soundings) {
    return new WatchDouble(soundings)
  }

  static stoppedBeforeTheFirstWait() {
    return new WatchDouble([[WatchDouble.A_CHANGE]], { waits: 0 })
  }

  static refusingTheDelivery(cause) {
    return new WatchDouble([[WatchDouble.A_CHANGE], [WatchDouble.A_CHANGE]], {
      refusingTheDelivery: cause,
    })
  }

  #reviews() {
    return new PlanReviewWatch({
      asked: (watch) => {
        this.asked.push(watch)
        const answer = this.soundings[this.asked.length - 1]
        if (answer === undefined) {
          throw new Error(`nobody wrote an answer for sounding ${this.asked.length}`)
        }
        if (answer instanceof Error) return Promise.reject(answer)

        return Promise.resolve({ changes: answer })
      },
      review: (params) => {
        this.reviewed.push(params)
        if (this.refusingTheDelivery !== null) return Promise.reject(this.refusingTheDelivery)

        return Promise.resolve()
      },
      sleep: () => {
        this.slept += 1
        if (this.slept > this.waits) this.watch.stop(WatchDouble.NUMBER)

        return Promise.resolve()
      },
      stderr: (line) => this.warnings.push(line),
    })
  }

  async run() {
    this.watch = this.#reviews()

    return this.watch.start(WatchDouble.SUBJECT)
  }
}

describe('PlanReviewWatch', () => {
  it('a_change_asked_for_is_handed_to_the_agent_that_wrote_that_plan', async () => {
    const watched = WatchDouble.answering([WatchDouble.A_CHANGE])

    await watched.run()

    expect(watched.reviewed).toEqual([{
      agent: WatchDouble.AGENT,
      issue: WatchDouble.NUMBER,
      repository: WatchDouble.REPOSITORY,
      changes: WatchDouble.A_CHANGE.text,
    }])
  })

  it('the_same_change_is_never_handed_over_twice_however_long_the_issue_keeps_it', async () => {
    const watched = WatchDouble.answering(
      [WatchDouble.A_CHANGE],
      [WatchDouble.A_CHANGE],
      [WatchDouble.A_CHANGE, WatchDouble.ANOTHER_CHANGE]
    )

    await watched.run()

    expect(watched.reviewed.map(({ changes }) => changes)).toEqual([
      WatchDouble.A_CHANGE.text, WatchDouble.ANOTHER_CHANGE.text,
    ])
  })

  it('it_asks_the_issue_only_after_the_first_wait_so_a_brand_new_issue_is_not_read', async () => {
    const watched = WatchDouble.stoppedBeforeTheFirstWait()

    await watched.run()

    expect(watched.asked).toEqual([])
    expect(watched.reviewed).toEqual([])
  })

  it('the_issue_it_sounds_is_the_one_it_was_told_to_watch', async () => {
    const watched = WatchDouble.answering([])

    await watched.run()

    expect(watched.asked).toEqual([WatchDouble.SUBJECT])
  })

  it('a_sounding_that_failed_is_written_to_stderr_and_the_watch_lives_on', async () => {
    const watched = WatchDouble.answering(
      new PlanChangesNotRead('gh issue view failed: gh: not authenticated'),
      [WatchDouble.A_CHANGE]
    )

    await watched.run()

    expect(watched.warnings).toHaveLength(1)
    expect(watched.warnings[0]).toContain('gh: not authenticated')
    expect(watched.reviewed.map(({ changes }) => changes)).toEqual([WatchDouble.A_CHANGE.text])
  })

  it('a_delivery_that_failed_is_not_retried_forever_and_says_so', async () => {
    const watched = WatchDouble.refusingTheDelivery(new PlanAgentNotResumed('no such workspace'))

    await watched.run()

    expect(watched.reviewed).toHaveLength(1)
    expect(watched.warnings).toHaveLength(1)
    expect(watched.warnings[0]).toContain('no such workspace')
  })

  it('a_watch_it_was_told_to_stop_asks_the_issue_nothing_else', async () => {
    const watched = WatchDouble.answering([WatchDouble.A_CHANGE])

    await watched.run()

    expect(watched.asked).toHaveLength(1)
    expect(watched.slept).toBe(2)
  })

  it('a_defect_of_ours_ends_that_watch_instead_of_taking_the_whole_api_down', async () => {
    const watched = WatchDouble.answering(new TypeError('changes is not iterable'))

    await watched.run()

    expect(watched.warnings).toHaveLength(1)
    expect(watched.warnings[0]).toContain('changes is not iterable')
    expect(watched.asked).toHaveLength(1)
  })
})
