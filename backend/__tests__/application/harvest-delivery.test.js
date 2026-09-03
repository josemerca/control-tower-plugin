import { describe, it, expect } from 'vitest'
import { HarvestDelivery, HarvestDeliveryParams } from '../../src/application/actions/harvest-delivery.js'
import { Harvest } from '../../src/domain/ports/harvest.js'
import { HarvestOutcome } from '../../src/domain/value-objects/harvest-outcome.js'
import { PreparedWorkspace } from '../../src/domain/value-objects/prepared-workspace.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { HarvestNotRead } from '../../src/domain/exceptions.js'

class HarvestDouble extends Harvest {
  static ROOT = '/repo/checkout'
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static PREPARED = new PreparedWorkspace({
    issueNumber: 42,
    located: new WorkspaceLocation({ path: `${HarvestDouble.ROOT}/.worktrees/42`, branch: 'feat/42' }),
  })

  constructor(answer) {
    super()
    this.answer = answer
    this.asked = []
  }

  static answering(outcome) {
    return new HarvestDouble(outcome)
  }

  static unable(said) {
    return new HarvestDouble(new HarvestNotRead(said))
  }

  async collect(subject) {
    this.asked.push(subject)
    if (this.answer instanceof Error) throw this.answer

    return this.answer
  }

  harvested(prepared = HarvestDouble.PREPARED) {
    return new HarvestDelivery({ harvest: this })
      .execute(new HarvestDeliveryParams({ prepared, repository: HarvestDouble.REPOSITORY }))
  }

  refusal() {
    return this.harvested().catch((cause) => cause)
  }
}

describe('HarvestDelivery', () => {
  it('what_the_plugin_answered_is_what_the_caller_gets_without_being_reinterpreted', async () => {
    const harvested = await HarvestDouble.answering(HarvestOutcome.COLLECTED).harvested()

    expect(harvested.outcome).toBe(HarvestOutcome.COLLECTED)
  })

  it('the_plugin_is_asked_for_the_issue_number_of_the_workspace_and_never_for_the_workspace_itself', async () => {
    const harvest = HarvestDouble.answering(HarvestOutcome.WAITING)

    await harvest.harvested()

    expect(harvest.asked).toEqual([{ issueNumber: 42, repository: HarvestDouble.REPOSITORY }])
  })

  it('the_repository_the_survey_named_is_the_one_the_plugin_is_told_so_no_harvest_reaches_a_stranger', async () => {
    const harvest = HarvestDouble.answering(HarvestOutcome.COLLECTED)

    await harvest.harvested()

    expect(harvest.asked[0].repository.text).toBe('josemerca/ct-loop-sandbox')
  })

  it('each_prepared_workspace_is_harvested_under_its_own_number_and_not_under_the_first_one_asked_for', async () => {
    const harvest = HarvestDouble.answering(HarvestOutcome.WAITING)

    await harvest.harvested(new PreparedWorkspace({
      issueNumber: 7,
      located: new WorkspaceLocation({ path: `${HarvestDouble.ROOT}/.worktrees/7`, branch: 'feat/7' }),
    }))

    expect(harvest.asked[0].issueNumber).toBe(7)
  })

  it('a_harvest_that_could_not_be_read_travels_out_typed_instead_of_becoming_an_outcome', async () => {
    const refusal = await HarvestDouble.unable('dispatch-check could not reach gh').refusal()

    expect(refusal).toBeInstanceOf(HarvestNotRead)
    expect(refusal.message).toBe('dispatch-check could not reach gh')
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new Harvest().collect({ issueNumber: 42, repository: HarvestDouble.REPOSITORY }))
      .rejects.toThrow(/must implement collect/)
  })
})
