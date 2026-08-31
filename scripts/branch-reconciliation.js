import { DiscardReason, ReconcileOutcome, ReconcileRound } from './reconcile-outcome.js'

const CONFLICT_MARKERS_ANCHORED_AS_GIT_WRITES_THEM = ['^<<<<<<< ', '^=======$', '^>>>>>>> ']

export class BranchReconciliation {
  constructor({ git, isMachineryPath = () => false }) {
    this.git = git
    this.isMachineryPath = isMachineryPath
  }

  merge({ baseBranch }) {
    const fetched = this.git(['fetch', 'origin', baseBranch])
    if (fetched.code !== 0) {
      throw new Error(`git fetch origin ${baseBranch} failed (exit code ${fetched.code}): a stale origin/${baseBranch} cannot be told apart from a base that did not move`)
    }
    const behind = this.git(['rev-list', '--count', `HEAD..origin/${baseBranch}`])
    if (behind.code !== 0) {
      throw new Error(`git rev-list --count HEAD..origin/${baseBranch} failed (exit code ${behind.code}): how far behind the base this branch is cannot be counted`)
    }
    if (Number(behind.stdout.trim()) === 0) {
      const committed = this.markersCommittedInTheMergeAtHead()
      return committed.length
        ? ReconcileRound.of({ outcome: ReconcileOutcome.MARKERS_COMMITTED, files: committed })
        : ReconcileRound.of({ outcome: ReconcileOutcome.UP_TO_DATE, files: [] })
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

  headIsAMergeCommit() {
    return this.git(['rev-parse', '--verify', '--quiet', 'HEAD^2']).code === 0
  }

  markersCommittedInTheMergeAtHead() {
    if (this.isMergeInProgress() || !this.headIsAMergeCommit()) return []
    const brought = this.filesBroughtByTheMergeAtHead()
    if (!brought.length) return []
    return this.filesCarryingMarkers(['HEAD', '--', ...brought]).map((path) => path.replace(/^HEAD:/, ''))
  }

  filesBroughtByTheMergeAtHead() {
    return this.pathsIn(this.git(['diff', '--name-only', '-z', 'HEAD^1', 'HEAD']))
  }

  unmergedFiles() {
    return this.pathsIn(this.git(['diff', '--name-only', '-z', '--diff-filter=U']))
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
    return this.filesDifferingFromTheIndex()
      .filter((path) => !files.includes(path))
      .filter((path) => !this.isMachineryPath(path))
  }

  filesDifferingFromTheIndex() {
    return this.pathsIn(this.git(['diff', '--name-only', '-z']))
  }

  filesStillCarryingMarkers(files) {
    return this.filesCarryingMarkers(['--', ...files])
  }

  filesCarryingMarkers(scope) {
    const patterns = CONFLICT_MARKERS_ANCHORED_AS_GIT_WRITES_THEM.flatMap((pattern) => ['-e', pattern])
    const result = this.git(['grep', '-l', ...patterns, ...scope])
    if (result.code !== 0 && result.code !== 1) {
      throw new Error(`git grep failed while checking for conflict markers (exit code ${result.code})`)
    }
    return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  }

  pathsIn(result) {
    return result.stdout.split('\0').filter((path) => path.trim().length > 0)
  }
}
