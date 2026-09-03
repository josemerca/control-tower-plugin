import { HarvestOutcome } from '../domain/value-objects/harvest-outcome.js'
import { Projection } from './projection.js'
import { HarvestNotRead, HarvestNotUnderstood, PlanFailure } from '../domain/exceptions.js'

export class SweepLine {
  static SILENT = null
  static #BY_OUTCOME = new Projection('harvest outcome sweep line', [
    [HarvestOutcome.WAITING, () => SweepLine.SILENT],
    [HarvestOutcome.COLLECTED, (prepared) => `harvest #${prepared.issueNumber}: collected\n`],
    [HarvestOutcome.KEPT, (prepared) =>
      `harvest #${prepared.issueNumber}: kept, the plugin refused to delete because the disk disagrees with the merged pull request; look at ${prepared.located.path}\n`],
    [HarvestOutcome.PARTIAL, (prepared) =>
      `harvest #${prepared.issueNumber}: PARTIAL, something was deleted and a later step failed; run dispatch-check ${prepared.issueNumber} --collect by hand to see what is pending\n`],
  ])

  static #BY_FAILURE = new Projection('harvest failure sweep line', [
    [HarvestNotRead, (prepared, failure) =>
      `harvest #${prepared.issueNumber}: could not be read, the next sweep retries: ${failure.message}\n`],
    [HarvestNotUnderstood, (prepared, failure) =>
      `harvest #${prepared.issueNumber}: FAILED and retrying will not fix it: ${failure.message}\n`],
  ])

  static declaredOutcomes() {
    return SweepLine.#BY_OUTCOME.members()
  }

  static declaredFailures() {
    return SweepLine.#BY_FAILURE.members()
  }

  static of(outcome, prepared) {
    return SweepLine.#BY_OUTCOME.of(outcome)(prepared)
  }

  static forHarvest(prepared, failure) {
    return SweepLine.#BY_FAILURE.of(failure.constructor)(prepared, failure)
  }

  static forSurvey(failure) {
    return `harvest sweep: could not survey the checkout: ${failure.message}\n`
  }
}

export class HarvestClock {
  constructor({ survey, harvest, sleep, stderr }) {
    this.survey = survey
    this.harvest = harvest
    this.sleep = sleep
    this.stderr = stderr
  }

  async start() {
    for (;;) {
      await this.sweep()
      await this.sleep()
    }
  }

  async sweep() {
    let checkout
    try {
      checkout = (await this.survey()).survey
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
