export class RetryBudget {
  constructor({ attempts, waitSeconds }) {
    this.attempts = attempts
    this.waitSeconds = waitSeconds
    Object.freeze(this)
  }
}

class RetryDecision {
  constructor({ retry, waitSeconds = 0 }) {
    this.retry = retry
    this.waitSeconds = waitSeconds
    Object.freeze(this)
  }
}

export class RetryPolicy {
  constructor({ budget }) {
    this.budget = budget
    Object.freeze(this)
  }

  afterAFailure({ transient, safeToRepeat, attempted }) {
    if (!transient || !safeToRepeat || attempted >= this.budget.attempts) {
      return new RetryDecision({ retry: false })
    }

    return new RetryDecision({ retry: true, waitSeconds: this.budget.waitSeconds })
  }
}
