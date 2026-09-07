import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AttemptBeyondCap, AttemptBudget, AttemptEffect, AttemptStep } from '../src/attempt-budget.js'

class Budgets {
  static ofThreeAttempts() {
    return new AttemptBudget({ cap: 3 })
  }
}

describe('AttemptBudget', () => {
  it('an attempt under the cap retries with the next number', () => {
    assert.deepEqual(Budgets.ofThreeAttempts().next(1), new AttemptEffect({ step: AttemptStep.RETRY, attempt: 2 }))
  })

  it('the attempt at the cap is blocked instead of retried', () => {
    assert.deepEqual(Budgets.ofThreeAttempts().next(3), new AttemptEffect({ step: AttemptStep.BLOCKED, attempt: 3 }))
  })

  it('an attempt beyond the cap is an error, not a silent block', () => {
    assert.throws(() => Budgets.ofThreeAttempts().next(4), AttemptBeyondCap)
  })
})
