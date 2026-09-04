import { HarvestOutcome } from '../domain/value-objects/harvest-outcome.js'
import { HarvestNotRead, HarvestNotUnderstood, PlanFailure } from '../domain/exceptions.js'

export class SweepLine {
  static SILENT = null
  static #BY_OUTCOME = Object.freeze({
    [HarvestOutcome.WAITING]: () => SweepLine.SILENT,
    [HarvestOutcome.COLLECTED]: (prepared) => `harvest #${prepared.issueNumber}: collected\n`,
    [HarvestOutcome.KEPT]: (prepared) =>
      `harvest #${prepared.issueNumber}: kept, the plugin refused to delete because the disk disagrees with the merged pull request; look at ${prepared.located.path}\n`,
    [HarvestOutcome.PARTIAL]: (prepared) =>
      `harvest #${prepared.issueNumber}: PARTIAL, something was deleted and a later step failed; run dispatch-check ${prepared.issueNumber} --collect by hand to see what is pending\n`,
  })

  static #BY_FAILURE = new Map([
    [HarvestNotRead, (prepared, failure) =>
      `harvest #${prepared.issueNumber}: could not be read, the next sweep retries: ${failure.message}\n`],
    [HarvestNotUnderstood, (prepared, failure) =>
      `harvest #${prepared.issueNumber}: FAILED and retrying will not fix it: ${failure.message}\n`],
  ])

  static declaredOutcomes() {
    return Object.keys(SweepLine.#BY_OUTCOME)
  }

  static declaredFailures() {
    return [...SweepLine.#BY_FAILURE.keys()]
  }

  static of(outcome, prepared) {
    const declared = SweepLine.#BY_OUTCOME[outcome]
    if (declared === undefined) {
      throw new Error(`no sweep line declared for harvest outcome ${outcome}`)
    }

    return declared(prepared)
  }

  static forHarvest(prepared, failure) {
    const declared = SweepLine.#BY_FAILURE.get(failure.constructor)
    if (declared === undefined) {
      throw new Error(`no sweep line declared for harvest failure ${failure.name}`)
    }

    return declared(prepared, failure)
  }

  static forSurvey(failure) {
    return `harvest sweep: could not survey the checkout: ${failure.message}\n`
  }
}

export class HarvestClock {
  constructor({ checkouts, survey, harvest, sleep, stderr }) {
    this.checkouts = checkouts
    this.survey = survey
    this.harvest = harvest
    this.sleep = sleep
    this.stderr = stderr
    this.sweeping = false
  }

  async start() {
    this.sweeping = true
    for (;;) {
      await this.sweep()
      if (!this.sweeping) return
      await this.sleep()
      if (!this.sweeping) return
    }
  }

  stop() {
    this.sweeping = false
  }

  async sweep() {
    for (const root of this.checkouts()) {
      await this.#sweepCheckout(root)
    }
  }

  async #sweepCheckout(root) {
    let checkout
    try {
      checkout = (await this.survey(root)).survey
    } catch (failure) {
      if (!(failure instanceof PlanFailure)) throw failure
      this.stderr(SweepLine.forSurvey(failure))
      return
    }
    for (const prepared of checkout.prepared) {
      await this.#collect(prepared, checkout.repository)
    }
  }

  #say(line) {
    if (line === SweepLine.SILENT) return
    this.stderr(line)
  }

  async #collect(prepared, repository) {
    let collected
    try {
      collected = await this.harvest(prepared, repository)
    } catch (failure) {
      if (!(failure instanceof PlanFailure)) throw failure
      this.#say(SweepLine.forHarvest(prepared, failure))
      return
    }
    this.#say(SweepLine.of(collected.outcome, prepared))
  }
}
