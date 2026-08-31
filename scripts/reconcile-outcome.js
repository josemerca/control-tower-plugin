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
    this.outcome = outcome
    this.files = Object.freeze([...files])
    this.reason = reason ?? null
    Object.freeze(this)
  }

  static of({ outcome, files }) {
    return new ReconcileRound({ outcome, files, reason: null })
  }

  static discarded({ files, reason }) {
    return new ReconcileRound({ outcome: ReconcileOutcome.ROUND_DISCARDED, files, reason })
  }
}
