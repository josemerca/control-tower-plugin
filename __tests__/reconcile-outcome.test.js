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

  it('discarded_throws_if_reason_is_not_a_discard_reason_member', () => {
    expect(() =>
      ReconcileRound.discarded({ files: ['a.txt'], reason: 'invalid-reason' })
    ).toThrow(/requires reason to be a DiscardReason member/)
  })

  it('of_throws_if_outcome_is_round_discarded', () => {
    expect(() =>
      ReconcileRound.of({ outcome: ReconcileOutcome.ROUND_DISCARDED, files: [] })
    ).toThrow(/cannot create ROUND_DISCARDED outcome/)
  })

  it('constructor_throws_if_round_discarded_lacks_reason', () => {
    expect(() =>
      new ReconcileRound({ outcome: ReconcileOutcome.ROUND_DISCARDED, files: [], reason: null })
    ).toThrow(/ROUND_DISCARDED outcome requires a reason/)
  })

  it('constructor_throws_if_non_discarded_outcome_has_reason', () => {
    expect(() =>
      new ReconcileRound({
        outcome: ReconcileOutcome.MERGED,
        files: [],
        reason: DiscardReason.MARKERS_LEFT,
      })
    ).toThrow(/must have reason null/)
  })

  it('constructor_throws_if_round_discarded_has_undefined_reason', () => {
    expect(() =>
      new ReconcileRound({ outcome: ReconcileOutcome.ROUND_DISCARDED, files: [], reason: undefined })
    ).toThrow(/ROUND_DISCARDED outcome requires a reason/)
  })

  it('constructor_throws_if_round_discarded_has_invalid_reason', () => {
    expect(() =>
      new ReconcileRound({
        outcome: ReconcileOutcome.ROUND_DISCARDED,
        files: [],
        reason: 'invented-reason',
      })
    ).toThrow(/ROUND_DISCARDED outcome requires a reason/)
  })
})
