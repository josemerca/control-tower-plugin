export const AttemptStep = Object.freeze({
  RETRY: 'retry',
  BLOCKED: 'blocked',
})

export class AttemptBeyondCap extends RangeError {
  constructor({ attempt, cap }) {
    super(`attempt ${attempt} is beyond the cap of ${cap}`)
    this.attempt = attempt
    this.cap = cap
  }
}

export class AttemptEffect {
  constructor({ step, attempt }) {
    this.step = step
    this.attempt = attempt
    Object.freeze(this)
  }
}

export class AttemptBudget {
  constructor({ cap }) {
    if (!Number.isInteger(cap) || cap < 1) {
      throw new RangeError(`cap must be a positive integer, got ${JSON.stringify(cap)}`)
    }
    this.cap = cap
    Object.freeze(this)
  }

  next(attempt) {
    if (!Number.isInteger(attempt) || attempt < 1) {
      throw new RangeError(`attempt must be a positive integer, got ${JSON.stringify(attempt)}`)
    }
    if (attempt > this.cap) throw new AttemptBeyondCap({ attempt, cap: this.cap })
    return attempt < this.cap
      ? new AttemptEffect({ step: AttemptStep.RETRY, attempt: attempt + 1 })
      : new AttemptEffect({ step: AttemptStep.BLOCKED, attempt })
  }
}
