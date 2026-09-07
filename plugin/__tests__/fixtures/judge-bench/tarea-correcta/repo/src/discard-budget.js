export const DiscardStep = Object.freeze({
  ASK_AGAIN: 'ask-again',
  ABORT: 'abort',
})

export class DiscardBeyondCap extends RangeError {
  constructor({ discards, cap }) {
    super(`${discards} discards is beyond the cap of ${cap}`)
    this.discards = discards
    this.cap = cap
  }
}

export class DiscardEffect {
  constructor({ step, discards }) {
    this.step = step
    this.discards = discards
    Object.freeze(this)
  }
}

export class DiscardBudget {
  constructor({ cap }) {
    if (!Number.isInteger(cap) || cap < 1) {
      throw new RangeError(`cap must be a positive integer, got ${JSON.stringify(cap)}`)
    }
    this.cap = cap
    Object.freeze(this)
  }

  next(discards) {
    if (!Number.isInteger(discards) || discards < 0) {
      throw new RangeError(`discards must be a non-negative integer, got ${JSON.stringify(discards)}`)
    }
    if (discards > this.cap) throw new DiscardBeyondCap({ discards, cap: this.cap })
    return discards < this.cap
      ? new DiscardEffect({ step: DiscardStep.ASK_AGAIN, discards: discards + 1 })
      : new DiscardEffect({ step: DiscardStep.ABORT, discards })
  }
}
