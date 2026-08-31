export const ReconcileOutcome = Object.freeze({
  UP_TO_DATE: 'up-to-date',
  MERGED: 'merged',
  CONFLICTING: 'conflicting',
  UNMERGEABLE_TREE: 'unmergeable-tree',
  RESOLVED: 'resolved',
  ROUND_DISCARDED: 'round-discarded',
})

export const DiscardReason = Object.freeze({
  MARKERS_LEFT: 'markers-left',
  TOUCHED_OUTSIDE_THE_CONFLICT: 'touched-outside-the-conflict',
  UNRESOLVED_FILES_REMAIN: 'unresolved-files-remain',
})

export class ReconcileRound {
  constructor({ outcome, files, reason }) {
    if (outcome === ReconcileOutcome.ROUND_DISCARDED) {
      if (!Object.values(DiscardReason).includes(reason)) {
        throw new Error(`ROUND_DISCARDED outcome requires a reason from DiscardReason, got ${reason}`)
      }
    } else {
      if (reason !== null) {
        throw new Error(`outcome ${outcome} must have reason null, got ${reason}`)
      }
    }
    this.outcome = outcome
    this.files = Object.freeze([...files])
    this.reason = reason
    Object.freeze(this)
  }

  static of({ outcome, files }) {
    if (outcome === ReconcileOutcome.ROUND_DISCARDED) {
      throw new Error(`ReconcileRound.of() cannot create ROUND_DISCARDED outcome; use discarded() instead`)
    }
    return new ReconcileRound({ outcome, files, reason: null })
  }

  static discarded({ files, reason }) {
    if (!Object.values(DiscardReason).includes(reason)) {
      throw new Error(`discarded() requires reason to be a DiscardReason member, got ${reason}`)
    }
    return new ReconcileRound({ outcome: ReconcileOutcome.ROUND_DISCARDED, files, reason })
  }
}
