import { Harvest } from '../domain/ports/harvest.js'
import { HarvestOutcome } from '../domain/value-objects/harvest-outcome.js'
import { HarvestNotRead, HarvestNotUnderstood } from '../domain/exceptions.js'

export class DispatchCheckHarvest extends Harvest {
  static COMMAND = 'dispatch-check --collect'
  static COLLECTED = 0
  static WAITING = 1
  static USAGE_REFUSED = 2
  static NOT_READ = 3
  static PARTIAL = 4
  static KEPT = 10
  static LEDGER_REFUSED = 11

  static #BY_CODE = Object.freeze({
    [DispatchCheckHarvest.COLLECTED]: () => HarvestOutcome.COLLECTED,
    [DispatchCheckHarvest.WAITING]: (said, issueNumber) => DispatchCheckHarvest.#waiting(said, issueNumber),
    [DispatchCheckHarvest.USAGE_REFUSED]: (said, issueNumber) => {
      throw new HarvestNotUnderstood(
        `${DispatchCheckHarvest.COMMAND} refused the invocation it was given for #${issueNumber}, so this is configuration and retrying changes nothing: ${said.stderr.trim()}`
      )
    },
    [DispatchCheckHarvest.NOT_READ]: (said, issueNumber) => {
      throw new HarvestNotRead(
        `${DispatchCheckHarvest.COMMAND} could not read what #${issueNumber} left behind and touched nothing, so the next sweep can try again: ${said.stderr.trim()}`
      )
    },
    [DispatchCheckHarvest.PARTIAL]: () => HarvestOutcome.PARTIAL,
    [DispatchCheckHarvest.KEPT]: () => HarvestOutcome.KEPT,
    [DispatchCheckHarvest.LEDGER_REFUSED]: (said, issueNumber) => {
      throw new HarvestNotRead(
        `${DispatchCheckHarvest.COMMAND} could not load the harvest row of #${issueNumber} into the ledger, so the next sweep can try again: ${said.stderr.trim()}`
      )
    },
  })

  constructor({ node, dispatchCheck, root, harvestTable }) {
    super()
    this.node = node
    this.dispatchCheck = dispatchCheck
    this.root = root
    this.harvestTable = harvestTable
  }

  static argvFor({ dispatchCheck, issueNumber, repository, harvestTable }) {
    const argv = [dispatchCheck, String(issueNumber), '--repo', repository.text, '--collect']
    return harvestTable === null ? argv : [...argv, '--bq', harvestTable]
  }

  static declaredCodes() {
    return Object.keys(DispatchCheckHarvest.#BY_CODE).map(Number)
  }

  async collect({ issueNumber, repository }) {
    const said = await this.node(
      DispatchCheckHarvest.argvFor({
        dispatchCheck: this.dispatchCheck,
        issueNumber,
        repository,
        harvestTable: this.harvestTable,
      }),
      { cwd: this.root }
    )
    const projected = DispatchCheckHarvest.#BY_CODE[said.code]
    if (projected === undefined) {
      throw new HarvestNotUnderstood(
        `${DispatchCheckHarvest.COMMAND} exited ${said.code} for #${issueNumber} and the harvest contract declares only ${DispatchCheckHarvest.declaredCodes().join(', ')}: ${DispatchCheckHarvest.#printed(said)}`
      )
    }

    return projected(said, issueNumber)
  }

  static #waiting(said, issueNumber) {
    if (said.stdout.trim().length === 0) {
      throw new HarvestNotUnderstood(
        `${DispatchCheckHarvest.COMMAND} exited ${DispatchCheckHarvest.WAITING} for #${issueNumber} without saying what it waits for, so it broke instead of waiting: ${DispatchCheckHarvest.#printed(said)}`
      )
    }

    return HarvestOutcome.WAITING
  }

  static #printed(said) {
    return `stdout ${JSON.stringify(said.stdout.trim())}, stderr ${JSON.stringify(said.stderr.trim())}`
  }
}
