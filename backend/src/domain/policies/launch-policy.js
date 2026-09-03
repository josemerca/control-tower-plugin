export class LaunchStep {
  static KEEP_PROBING = 'keep-probing'
  static RESEND_THE_LINE = 'resend-the-line'
  static GIVE_UP = 'give-up'

  static declared() {
    return Object.values(LaunchStep)
  }
}

export class LaunchBudget {
  constructor({ attempts, resends }) {
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
