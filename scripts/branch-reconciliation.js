import { ReconcileOutcome, ReconcileRound } from './reconcile-outcome.js'

export class BranchReconciliation {
  constructor({ git }) {
    this.git = git
  }

  merge({ baseBranch }) {
    this.git(['fetch', 'origin', baseBranch])
    const behind = this.git(['rev-list', '--count', `HEAD..origin/${baseBranch}`])
    if (Number(behind.stdout.trim()) === 0) {
      return ReconcileRound.of({ outcome: ReconcileOutcome.UP_TO_DATE, files: [] })
    }
    const merged = this.git(['merge', '--no-edit', `origin/${baseBranch}`])
    if (merged.code === 0) {
      return ReconcileRound.of({ outcome: ReconcileOutcome.MERGED, files: [] })
    }
    if (!this.isMergeInProgress()) {
      return ReconcileRound.of({ outcome: ReconcileOutcome.UNMERGEABLE_TREE, files: [] })
    }
    return ReconcileRound.of({ outcome: ReconcileOutcome.CONFLICTING, files: this.unmergedFiles() })
  }

  isMergeInProgress() {
    return this.git(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']).code === 0
  }

  unmergedFiles() {
    return this.git(['diff', '--name-only', '--diff-filter=U'])
      .stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  }
}
