import { describe, it, expect } from 'vitest'
import { HarvestClock, SweepLine } from '../../src/infrastructure/harvest-clock.js'
import { HarvestDeliveryResult } from '../../src/application/actions/harvest-delivery.js'
import { SurveyWorkspacesResult } from '../../src/application/queries/survey-workspaces.js'
import { HarvestOutcome } from '../../src/domain/value-objects/harvest-outcome.js'
import { PreparedWorkspace } from '../../src/domain/value-objects/prepared-workspace.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { WorkspaceSurvey } from '../../src/domain/value-objects/workspace-survey.js'
import {
  HarvestFailure, HarvestNotRead, HarvestNotUnderstood, WorkspaceNotRead,
} from '../../src/domain/exceptions.js'
import * as exceptions from '../../src/domain/exceptions.js'

class Sweeping {
  static ROOT = '/repo/checkout'
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static SURVEY = 'survey'
  static SLEEP = 'sleep'

  constructor({ checkouts, harvests, sweeps = 1, stoppingAt = null }) {
    this.checkouts = [...checkouts]
    this.harvests = new Map(harvests)
    this.sweeps = sweeps
    this.stoppingAt = stoppingAt
    this.trace = []
    this.written = []
    this.slept = 0
    this.clock = null
  }

  static preparedFor(issueNumber) {
    return new PreparedWorkspace({
      issueNumber,
      located: new WorkspaceLocation({
        path: `${Sweeping.ROOT}/.worktrees/${issueNumber}`,
        branch: `feat/${issueNumber}`,
      }),
    })
  }

  static checkoutHolding(harvests) {
    return new SurveyWorkspacesResult({
      survey: new WorkspaceSurvey({
        repository: Sweeping.REPOSITORY,
        prepared: harvests.map(([issueNumber]) => Sweeping.preparedFor(issueNumber)),
      }),
    })
  }

  static answering(harvests) {
    return new Sweeping({ checkouts: [Sweeping.checkoutHolding(harvests)], harvests })
  }

  static answeringTwice(harvests) {
    return new Sweeping({
      checkouts: [Sweeping.checkoutHolding(harvests), Sweeping.checkoutHolding(harvests)],
      harvests,
      sweeps: 2,
    })
  }

  static unableToSurvey(failure) {
    return new Sweeping({ checkouts: [failure], harvests: [] })
  }

  static stoppingDuring(issueNumber, harvests) {
    return new Sweeping({
      checkouts: [Sweeping.checkoutHolding(harvests)],
      harvests,
      stoppingAt: issueNumber,
    })
  }

  #surveyed() {
    this.trace.push(Sweeping.SURVEY)
    if (this.checkouts.length === 0) {
      throw new Error('the checkout was surveyed more times than this test scripted an answer for')
    }
    const answer = this.checkouts.shift()
    if (answer instanceof Error) return Promise.reject(answer)

    return Promise.resolve(answer)
  }

  #harvested(prepared, repository) {
    this.trace.push(`harvest #${prepared.issueNumber}`)
    if (repository !== Sweeping.REPOSITORY) {
      throw new Error(`the harvest of #${prepared.issueNumber} was asked for in ${repository?.text}`)
    }
    if (prepared.issueNumber === this.stoppingAt) this.clock.stop()
    if (!this.harvests.has(prepared.issueNumber)) {
      throw new Error(`the harvest of #${prepared.issueNumber} was asked for and no answer was scripted`)
    }
    const answer = this.harvests.get(prepared.issueNumber)
    if (answer instanceof Error) return Promise.reject(answer)

    return Promise.resolve(new HarvestDeliveryResult({ outcome: answer }))
  }

  #slept() {
    this.trace.push(Sweeping.SLEEP)
    this.slept += 1
    if (this.slept >= this.sweeps) this.clock.stop()

    return Promise.resolve()
  }

  async run() {
    this.clock = new HarvestClock({
      survey: () => this.#surveyed(),
      harvest: (prepared, repository) => this.#harvested(prepared, repository),
      sleep: () => this.#slept(),
      stderr: (line) => this.written.push(line),
    })
    await this.clock.start()

    return this
  }

  broke() {
    return this.run().catch((cause) => cause)
  }
}

describe('HarvestClock', () => {
  it('the_first_sweep_happens_at_once_so_a_restarted_server_does_not_leave_a_merged_slice_lying_a_minute', async () => {
    const swept = await Sweeping.answering([[42, HarvestOutcome.COLLECTED]]).run()

    expect(swept.trace).toEqual(['survey', 'harvest #42', 'sleep'])
  })

  it('it_waits_only_after_the_sweep_is_over_so_two_sweeps_can_never_overlap', async () => {
    const swept = await Sweeping.answeringTwice([
      [42, HarvestOutcome.COLLECTED], [7, HarvestOutcome.WAITING],
    ]).run()

    expect(swept.trace).toEqual([
      'survey', 'harvest #42', 'harvest #7', 'sleep',
      'survey', 'harvest #42', 'harvest #7', 'sleep',
    ])
  })

  it('a_slice_still_waiting_for_its_pull_request_is_written_nowhere_because_that_is_the_ordinary_case', async () => {
    const swept = await Sweeping.answering([[42, HarvestOutcome.WAITING]]).run()

    expect(swept.written).toEqual([])
  })

  it('a_slice_the_plugin_collected_says_so_in_one_line_naming_the_issue', async () => {
    const swept = await Sweeping.answering([[42, HarvestOutcome.COLLECTED]]).run()

    expect(swept.written).toEqual(['harvest #42: collected\n'])
  })

  it('a_slice_the_plugin_kept_names_the_worktree_to_look_at_instead_of_spelling_the_path_itself', async () => {
    const swept = await Sweeping.answering([[42, HarvestOutcome.KEPT]]).run()

    expect(swept.written).toEqual([
      'harvest #42: kept, the plugin refused to delete because the disk disagrees with the merged pull request; look at /repo/checkout/.worktrees/42\n',
    ])
  })

  it('a_half_done_harvest_says_how_to_see_what_is_pending_because_the_outcome_carries_no_text', async () => {
    const swept = await Sweeping.answering([[42, HarvestOutcome.PARTIAL]]).run()

    expect(swept.written).toEqual([
      'harvest #42: PARTIAL, something was deleted and a later step failed; run dispatch-check 42 --collect by hand to see what is pending\n',
    ])
  })

  it('a_harvest_the_plugin_could_not_read_leaves_its_line_and_the_next_workspace_is_still_collected', async () => {
    const swept = await Sweeping.answering([
      [1, new HarvestNotRead('dispatch-check --collect could not reach gh')],
      [2, HarvestOutcome.COLLECTED],
    ]).run()

    expect(swept.written).toEqual([
      'harvest #1: nothing was touched, the next sweep retries: dispatch-check --collect could not reach gh\n',
      'harvest #2: collected\n',
    ])
  })

  it('a_harvest_nobody_can_repair_by_waiting_leaves_its_line_and_the_next_workspace_is_still_collected', async () => {
    const swept = await Sweeping.answering([
      [1, new HarvestNotUnderstood('dispatch-check --collect refused the invocation')],
      [2, HarvestOutcome.COLLECTED],
    ]).run()

    expect(swept.written).toEqual([
      'harvest #1: FAILED and retrying will not fix it: dispatch-check --collect refused the invocation\n',
      'harvest #2: collected\n',
    ])
  })

  it('a_checkout_that_could_not_be_surveyed_ends_the_sweep_without_asking_the_plugin_to_collect_anything', async () => {
    const swept = await Sweeping.unableToSurvey(new WorkspaceNotRead('git worktree list refused')).run()

    expect(swept.written).toEqual([
      'harvest sweep: could not survey the checkout: git worktree list refused\n',
    ])
    expect(swept.trace).toEqual(['survey', 'sleep'])
  })

  it('a_bug_of_ours_while_surveying_rises_instead_of_being_swallowed_as_one_more_failed_sweep', async () => {
    const broken = Sweeping.unableToSurvey(new TypeError('checkout.prepared is not iterable'))

    expect(await broken.broke()).toBeInstanceOf(TypeError)
    expect(broken.trace).toEqual(['survey'])
    expect(broken.written).toEqual([])
  })

  it('a_bug_of_ours_while_harvesting_rises_instead_of_letting_the_clock_pretend_it_keeps_sweeping', async () => {
    const broken = Sweeping.answering([
      [1, new TypeError('prepared.located is undefined')], [2, HarvestOutcome.COLLECTED],
    ])

    expect(await broken.broke()).toBeInstanceOf(TypeError)
    expect(broken.trace).toEqual(['survey', 'harvest #1'])
  })

  it('stopping_lets_the_sweep_in_flight_finish_and_then_never_sleeps_into_another_one', async () => {
    const swept = await Sweeping.stoppingDuring(1, [
      [1, HarvestOutcome.COLLECTED], [2, HarvestOutcome.COLLECTED],
    ]).run()

    expect(swept.trace).toEqual(['survey', 'harvest #1', 'harvest #2'])
    expect(swept.written).toEqual(['harvest #1: collected\n', 'harvest #2: collected\n'])
  })
})

describe('SweepLine', () => {
  it('every_harvest_outcome_the_vocabulary_declares_has_its_line_declared_so_a_fifth_one_cannot_pass_for_silence', () => {
    expect(SweepLine.declaredOutcomes().sort()).toEqual(HarvestOutcome.declared().sort())
  })

  it('an_outcome_nobody_declared_a_line_for_raises_instead_of_being_swept_past_without_a_word', async () => {
    const broken = Sweeping.answering([[42, 'invented']])

    expect((await broken.broke()).message).toBe('no sweep line declared for harvest outcome invented')
  })

  it('every_harvest_failure_the_catalogue_declares_has_a_line_so_a_third_one_cannot_kill_the_server_unnamed', () => {
    const byName = (one, other) => one.name.localeCompare(other.name)
    const ways = Object.values(exceptions).filter((thrown) => thrown.prototype instanceof HarvestFailure)

    expect([...SweepLine.declaredFailures()].sort(byName)).toEqual(ways.sort(byName))
  })

  it('a_harvest_failure_nobody_declared_a_line_for_raises_instead_of_being_reported_as_one_of_the_two', async () => {
    const broken = Sweeping.answering([[42, new HarvestFailure('a family nobody projected')]])

    expect((await broken.broke()).message).toBe('no sweep line declared for harvest failure HarvestFailure')
  })
})
