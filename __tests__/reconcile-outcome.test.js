import { describe, it, expect } from 'vitest'
import { ReconcileOutcome, DiscardReason, ReconcileRound } from '../scripts/reconcile-outcome.js'

describe('ReconcileOutcome', () => {
  it('every_member_is_distinct_so_no_two_states_that_are_fixed_differently_collapse', () => {
    const members = Object.values(ReconcileOutcome)
    expect(new Set(members).size).toBe(members.length)
    expect(members).toHaveLength(6)
  })

  it('the_vocabulary_cannot_be_widened_at_runtime_by_a_consumer', () => {
    expect(Object.isFrozen(ReconcileOutcome)).toBe(true)
  })

  it('a_discarded_round_carries_why_instead_of_leaving_the_consumer_to_guess', () => {
    const round = ReconcileRound.discarded({
      files: ['a.txt'],
      reason: DiscardReason.MARKERS_LEFT,
    })

    expect(round.outcome).toBe(ReconcileOutcome.ROUND_DISCARDED)
    expect(round.reason).toBe(DiscardReason.MARKERS_LEFT)
    expect(round.files).toEqual(['a.txt'])
  })

  it('a_round_that_was_not_discarded_has_no_reason_field_standing_in_for_absence', () => {
    const round = ReconcileRound.of({ outcome: ReconcileOutcome.MERGED, files: [] })

    expect(round.reason).toBe(null)
  })
})
