export class GhBudget {
  constructor({ attempts, waitSeconds }) {
    if (!Number.isInteger(attempts) || attempts < 0) {
      throw new Error(`the retries of a gh call are a count, got ${JSON.stringify(attempts)}`)
    }
    if (!Number.isInteger(waitSeconds) || waitSeconds < 0) {
      throw new Error(`the wait between gh calls is in seconds, got ${JSON.stringify(waitSeconds)}`)
    }
    this.attempts = attempts
    this.waitSeconds = waitSeconds
    Object.freeze(this)
  }
}

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
