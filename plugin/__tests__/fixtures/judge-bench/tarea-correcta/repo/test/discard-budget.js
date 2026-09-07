import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DiscardBeyondCap, DiscardBudget, DiscardEffect, DiscardStep } from '../src/discard-budget.js'

class Budgets {
  static ofThreeDiscards() {
    return new DiscardBudget({ cap: 3 })
  }
}

describe('DiscardBudget', () => {
  it('a discard under the cap asks again with the next count', () => {
    assert.deepEqual(Budgets.ofThreeDiscards().next(1), new DiscardEffect({ step: DiscardStep.ASK_AGAIN, discards: 2 }))
  })

  it('the discard at the cap aborts instead of asking again', () => {
    assert.deepEqual(Budgets.ofThreeDiscards().next(3), new DiscardEffect({ step: DiscardStep.ABORT, discards: 3 }))
  })

  it('a count beyond the cap is an error, not a silent abort', () => {
    assert.throws(() => Budgets.ofThreeDiscards().next(4), DiscardBeyondCap)
  })
})
