import { DiscardReason, ReconcileOutcome, ReconcileRound } from './reconcile-outcome.js'

export class BranchReconciliation {
  constructor({ git, isMachineryPath = () => false }) {
    this.git = git
    this.isMachineryPath = isMachineryPath
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

  conclude() {
    const files = this.unmergedFiles()
    if (this.filesTouchedOutside(files).length) {
      return this.discard(files, DiscardReason.TOUCHED_OUTSIDE_THE_CONFLICT)
    }
    if (this.filesStillCarryingMarkers(files).length) {
      return this.discard(files, DiscardReason.MARKERS_LEFT)
    }
    this.git(['add', ...files])
    if (this.unmergedFiles().length) {
      return this.discard(files, DiscardReason.UNRESOLVED_FILES_REMAIN)
    }
    this.git(['commit', '--no-edit'])
    return ReconcileRound.of({ outcome: ReconcileOutcome.RESOLVED, files })
  }

  discard(files, reason) {
    this.git(['checkout', '--merge', '--', ...files])
    return ReconcileRound.discarded({ files, reason })
  }

  filesTouchedOutside(files) {
    return this.git(['status', '--porcelain'])
      .stdout.split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => line.slice(3).trim())
      .filter((path) => !files.includes(path))
      .filter((path) => !this.isMachineryPath(path))
  }

  filesStillCarryingMarkers(files) {
    const result = this.git(['grep', '-l', '-e', '<<<<<<<', '-e', '=======', '-e', '>>>>>>>', '--', ...files])
    if (result.code !== 0 && result.code !== 1) {
      throw new Error(`git grep failed while checking for conflict markers (exit code ${result.code})`)
    }
    return result.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  }
}
