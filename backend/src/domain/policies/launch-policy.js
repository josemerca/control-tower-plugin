export const LaunchStep = Object.freeze({
  KEEP_PROBING: 'keep-probing',
  RESEND_THE_LINE: 'resend-the-line',
  GIVE_UP: 'give-up',
})

export class LaunchBudget {
  constructor({ attempts, resends }) {
    if (!Number.isInteger(attempts) || attempts < 1) {
      throw new Error(`the probes of one send are a count of at least one, got ${JSON.stringify(attempts)}`)
    }
    if (!Number.isInteger(resends) || resends < 0) {
      throw new Error(`the resends of a launch are a count, got ${JSON.stringify(resends)}`)
    }
    this.attempts = attempts
    this.resends = resends
    Object.freeze(this)
  }

  get probes() {
    return this.attempts * (this.resends + 1)
  }
}

export class LaunchPolicy {
  constructor({ budget }) {
    this.budget = budget
    Object.freeze(this)
  }

  afterProbing(probes) {
    if (!Number.isInteger(probes) || probes < 1 || probes > this.budget.probes) {
      throw new Error(
        `a launch is probed from one up to ${this.budget.probes} times, got ${JSON.stringify(probes)}`
      )
    }
    if (probes % this.budget.attempts !== 0) return LaunchStep.KEEP_PROBING
    if (probes === this.budget.probes) return LaunchStep.GIVE_UP

    return LaunchStep.RESEND_THE_LINE
  }
}
