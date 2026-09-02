export class GhRetryDecision {
  constructor({ retry, waitSeconds = 0 }) {
    this.retry = retry
    this.waitSeconds = waitSeconds
    Object.freeze(this)
  }
}

export class GhRetryPolicy {
  constructor({ budget }) {
    this.budget = budget
    Object.freeze(this)
  }

  afterAFailure({ transient, safeToRepeat, attempted }) {
    if (!transient || !safeToRepeat || attempted >= this.budget.attempts) {
      return new GhRetryDecision({ retry: false })
    }

    return new GhRetryDecision({ retry: true, waitSeconds: this.budget.waitSeconds })
  }
}
