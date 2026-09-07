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

  static STOPPING = { issue: WatchDouble.NUMBER, repository: WatchDouble.REPOSITORY }

  static A_CHANGE = new ChangeAsked({
    id: 'IC_kwDOT9lB5c8AAAABRCF0GG', text: 'añade el caso de la issue sin descripción',
  })

  static ANOTHER_CHANGE = new ChangeAsked({
    id: 'IC_kwDOT9lB5c8AAAABRCF0HH', text: WatchDouble.A_CHANGE.text,
  })

  constructor(soundings, { refusingTheDelivery = null, waits = null, stoppingOnDelivery = false } = {}) {
    this.soundings = soundings
    this.refusingTheDelivery = refusingTheDelivery
    this.stoppingOnDelivery = stoppingOnDelivery
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

  static recovering(...soundings) {
    return new WatchDouble(soundings, { waits: soundings.length - 1 })
  }

  static stoppedBeforeTheFirstWait() {
    return new WatchDouble([[WatchDouble.A_CHANGE]], { waits: 0 })
  }

  static stoppedWhileDelivering() {
    return new WatchDouble([[WatchDouble.A_CHANGE, WatchDouble.ANOTHER_CHANGE]], {
      stoppingOnDelivery: true,
    })
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
        if (this.stoppingOnDelivery) this.watch.stop(WatchDouble.STOPPING)
        if (this.refusingTheDelivery !== null) return Promise.reject(this.refusingTheDelivery)

        return Promise.resolve()
      },
      sleep: () => {
        this.slept += 1
        if (this.slept > this.waits) this.watch.stop(WatchDouble.STOPPING)

        return Promise.resolve()
      },
      stderr: (line) => this.warnings.push(line),
    })
  }

  async run() {
    this.watch = this.#reviews()

    return this.watch.start(WatchDouble.SUBJECT)
  }

  async runRecovered() {
    this.watch = this.#reviews()

    return this.watch.startRecovered(WatchDouble.SUBJECT)
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
    const watched = WatchDouble.answering(
      new TypeError('changes is not iterable'), [WatchDouble.A_CHANGE]
    )

    await watched.run()

    expect(watched.warnings).toHaveLength(1)
    expect(watched.warnings[0]).toContain('changes is not iterable')
    expect(watched.asked).toHaveLength(1)
  })

  it('a_change_asked_for_twice_in_the_same_words_is_handed_over_twice_because_the_id_is_what_counts', async () => {
    const watched = WatchDouble.answering(
      [WatchDouble.A_CHANGE], [WatchDouble.A_CHANGE, WatchDouble.ANOTHER_CHANGE]
    )

    await watched.run()

    expect(watched.reviewed).toHaveLength(2)
  })

  it('a_delivery_that_blew_up_on_a_defect_of_ours_ends_that_watch_instead_of_repeating_it', async () => {
    const watched = WatchDouble.refusingTheDelivery(new TypeError('agent is not a string'))

    await watched.run()

    expect(watched.reviewed).toHaveLength(1)
    expect(watched.asked).toHaveLength(1)
    expect(watched.warnings[0]).toContain('agent is not a string')
  })

  it('a_watch_that_died_is_no_longer_listed_as_live_so_the_map_cannot_promise_a_loop_that_is_gone', async () => {
    const watched = WatchDouble.answering(
      new TypeError('changes is not iterable'), [WatchDouble.A_CHANGE]
    )

    await watched.run()

    expect(watched.watch.live.size).toBe(0)
  })

  it('a_stop_in_the_middle_of_a_round_is_honoured_before_the_next_change_is_typed', async () => {
    const watched = WatchDouble.stoppedWhileDelivering()

    await watched.run()

    expect(watched.reviewed.map(({ changes }) => changes)).toEqual([WatchDouble.A_CHANGE.text])
  })

  it('a_stop_for_an_issue_nobody_is_watching_answers_the_same_as_one_that_was', async () => {
    const watched = WatchDouble.answering([])

    await watched.run()

    expect(() => watched.watch.stop(WatchDouble.STOPPING)).not.toThrow()
  })

  it('a_recovered_watch_reads_its_baseline_before_the_first_wait', async () => {
    const watched = WatchDouble.recovering([WatchDouble.A_CHANGE])

    await watched.runRecovered()

    expect(watched.asked).toEqual([WatchDouble.SUBJECT])
    expect(watched.reviewed).toEqual([])
  })

  it('a_recovered_watch_delivers_changes_that_arrive_after_its_baseline', async () => {
    const watched = WatchDouble.recovering(
      [WatchDouble.A_CHANGE], [WatchDouble.A_CHANGE, WatchDouble.ANOTHER_CHANGE]
    )

    await watched.runRecovered()

    expect(watched.reviewed.map(({ changes }) => changes)).toEqual([WatchDouble.ANOTHER_CHANGE.text])
  })

  it('a_recovered_watch_retries_a_failed_baseline_without_delivering_historical_changes', async () => {
    const watched = WatchDouble.recovering(
      new PlanChangesNotRead('gh issue view failed: gh: not authenticated'),
      [WatchDouble.A_CHANGE],
      [WatchDouble.A_CHANGE, WatchDouble.ANOTHER_CHANGE]
    )

    await watched.runRecovered()

    expect(watched.warnings).toHaveLength(1)
    expect(watched.reviewed.map(({ changes }) => changes)).toEqual([WatchDouble.ANOTHER_CHANGE.text])
  })

  it('stopping_a_recovered_watch_during_its_baseline_does_not_start_its_live_loop', async () => {
    const baseline = Promise.withResolvers()
    let slept = 0
    let reviewed = 0
    const watch = new PlanReviewWatch({
      asked: () => baseline.promise,
      review: () => { reviewed += 1 },
      sleep: () => { slept += 1 },
      stderr: () => {},
    })

    const following = watch.startRecovered(WatchDouble.SUBJECT)
    watch.stop(WatchDouble.STOPPING)
    baseline.resolve({ changes: [WatchDouble.A_CHANGE] })
    await following

    expect(slept).toBe(0)
    expect(reviewed).toBe(0)
    expect(watch.live.size).toBe(0)
  })
})

describe('PlanReviewWatch telling two plans apart', () => {
  const watchFor = (repo, number) => new PlanWatch({
    issue: new PlanIssue({ number, url: `https://github.com/${repo}/issues/${number}` }),
    located: new WorkspaceLocation({ path: `/repo/${repo}/.worktrees/${number}`, branch: `feat/${number}` }),
    repository: new RepositoryName(repo),
    agent: `workspace:${number}`,
  })

  const ALPHA_7 = watchFor('owner/alpha', 7)
  const BETA_7 = watchFor('owner/beta', 7)
  const ALPHA_8 = watchFor('owner/alpha', 8)
  const ROUND_MS = 1
  const ROUNDS = 15
  const BUDGET = ROUNDS * 6

  class TwoPlans {
    constructor() {
      this.sounded = []
      this.rounds = 0
      this.reviews = new PlanReviewWatch({
        asked: (watch) => {
          this.rounds += 1
          if (this.rounds > BUDGET) {
            throw new Error(`the watches sounded ${this.rounds} times, past what this test allows`)
          }
          this.sounded.push(TwoPlans.#nameOf(watch))

          return Promise.resolve({ changes: [] })
        },
        review: () => Promise.resolve(),
        sleep: () => new Promise((resolve) => setTimeout(resolve, ROUND_MS)),
        stderr: () => {},
      })
    }

    static #nameOf(watch) {
      return `${watch.repository.text}#${watch.issue.number}`
    }

    static #settling() {
      return new Promise((resolve) => setTimeout(resolve, ROUND_MS * ROUNDS))
    }

    static #stopping(watch) {
      return { issue: watch.issue.number, repository: watch.repository }
    }

    async soundedAfterStopping(stopped, kept) {
      this.reviews.start(stopped)
      this.reviews.start(kept)
      await TwoPlans.#settling()
      this.reviews.stop(TwoPlans.#stopping(stopped))
      this.sounded = []
      await TwoPlans.#settling()
      this.reviews.stop(TwoPlans.#stopping(kept))

      return this.sounded
    }
  }

  it('two_plans_sharing_an_issue_number_in_different_repositories_are_watched_apart', async () => {
    const two = new TwoPlans()

    const sounded = await two.soundedAfterStopping(ALPHA_7, BETA_7)

    expect(sounded).not.toContain('owner/alpha#7')
    expect(sounded).toContain('owner/beta#7')
  })

  it('two_plans_of_the_same_repository_are_watched_apart_by_the_issue_they_plan', async () => {
    const two = new TwoPlans()

    const sounded = await two.soundedAfterStopping(ALPHA_8, ALPHA_7)

    expect(sounded).not.toContain('owner/alpha#8')
    expect(sounded).toContain('owner/alpha#7')
  })

  it('nothing_keeps_sounding_once_both_plans_have_been_stopped', async () => {
    const two = new TwoPlans()

    await two.soundedAfterStopping(ALPHA_7, BETA_7)
    two.sounded = []
    await new Promise((resolve) => setTimeout(resolve, ROUND_MS * ROUNDS))

    expect(two.sounded).toEqual([])
    expect(two.reviews.live.size).toBe(0)
  })
})
