import { describe, it, expect } from 'vitest'
import { BranchReconciliation } from '../scripts/branch-reconciliation.js'
import { ReconcileOutcome, DiscardReason } from '../scripts/reconcile-outcome.js'

class GitConversation {
  constructor(answers) {
    this.answers = answers
    this.calls = []
  }

  run = (argv) => {
    const key = argv.join(' ')
    this.calls.push(key)
    if (!(key in this.answers)) throw new Error(`nadie escribió respuesta para: git ${key}`)
    const answer = this.answers[key]
    if (!Array.isArray(answer)) return answer
    if (answer.length === 0) throw new Error(`nadie escribió respuesta para: git ${key}`)
    return answer.shift()
  }

  asked(fragment) {
    return this.calls.some((c) => c.includes(fragment))
  }

  static ok(stdout = '') {
    return { code: 0, stdout }
  }

  static failed(stdout = '') {
    return { code: 1, stdout }
  }

  static markerScanOf(...files) {
    return [...ANCHORED_MARKER_SCAN, ...files].join(' ')
  }

  static nulSeparated(...paths) {
    return paths.join('\0')
  }
}

const UNMERGED_FILES = 'diff --name-only -z --diff-filter=U'
const FILES_DIFFERING_FROM_THE_INDEX = 'diff --name-only -z'
const HEAD_IS_A_MERGE_COMMIT = 'rev-parse --verify --quiet HEAD^2'
const MERGE_IN_PROGRESS = 'rev-parse --verify --quiet MERGE_HEAD'
const ANCHORED_MARKER_SCAN = ['grep', '-l', '-e', '^<<<<<<< ', '-e', '^=======$', '-e', '^>>>>>>> ', '--']

class ConversationMother {
  static aBaseThatDidNotMove() {
    return new GitConversation({
      'fetch origin main': GitConversation.ok(),
      'rev-list --count HEAD..origin/main': GitConversation.ok('0'),
      [MERGE_IN_PROGRESS]: GitConversation.failed(),
      [HEAD_IS_A_MERGE_COMMIT]: GitConversation.failed(),
    })
  }

  static aBaseThatMergesCleanly() {
    return new GitConversation({
      'fetch origin main': GitConversation.ok(),
      'rev-list --count HEAD..origin/main': GitConversation.ok('2'),
      'merge --no-edit origin/main': GitConversation.ok(),
    })
  }

  static aBaseThatConflictsOnTwoFiles() {
    return new GitConversation({
      'fetch origin main': GitConversation.ok(),
      'rev-list --count HEAD..origin/main': GitConversation.ok('2'),
      'merge --no-edit origin/main': GitConversation.failed(),
      [MERGE_IN_PROGRESS]: GitConversation.ok('aaaa'),
      [UNMERGED_FILES]: GitConversation.ok(GitConversation.nulSeparated('src/a.js', 'src/b.js')),
    })
  }

  static aMergeThatGitRefusedToStart() {
    return new GitConversation({
      'fetch origin main': GitConversation.ok(),
      'rev-list --count HEAD..origin/main': GitConversation.ok('2'),
      'merge --no-edit origin/main': GitConversation.failed(),
      [MERGE_IN_PROGRESS]: GitConversation.failed(),
    })
  }

  static aResolutionWithNoLeftovers() {
    return new GitConversation({
      [UNMERGED_FILES]: [GitConversation.ok(GitConversation.nulSeparated('src/a.js', 'src/b.js')), GitConversation.ok('')],
      [FILES_DIFFERING_FROM_THE_INDEX]: GitConversation.ok(GitConversation.nulSeparated('src/a.js', 'src/b.js')),
      [GitConversation.markerScanOf('src/a.js', 'src/b.js')]: GitConversation.failed(''),
      'add src/a.js src/b.js': GitConversation.ok(),
      'commit --no-edit': GitConversation.ok(),
    })
  }

  static aResolutionThatStillCarriesMarkers() {
    return new GitConversation({
      [UNMERGED_FILES]: GitConversation.ok(GitConversation.nulSeparated('src/a.js', 'src/b.js')),
      [FILES_DIFFERING_FROM_THE_INDEX]: GitConversation.ok(GitConversation.nulSeparated('src/a.js', 'src/b.js')),
      [GitConversation.markerScanOf('src/a.js', 'src/b.js')]: GitConversation.ok('src/a.js'),
      'checkout --merge -- src/a.js src/b.js': GitConversation.ok(),
    })
  }

  static aFileTouchedOutsideTheConflict() {
    return new GitConversation({
      [UNMERGED_FILES]: GitConversation.ok('src/a.js'),
      [FILES_DIFFERING_FROM_THE_INDEX]: GitConversation.ok(GitConversation.nulSeparated('src/a.js', 'src/other.js')),
      'checkout --merge -- src/a.js': GitConversation.ok(),
    })
  }

  static aFileStillUnmergedAfterTheAdd() {
    return new GitConversation({
      [UNMERGED_FILES]: [GitConversation.ok('src/a.js'), GitConversation.ok('src/a.js')],
      [FILES_DIFFERING_FROM_THE_INDEX]: GitConversation.ok('src/a.js'),
      [GitConversation.markerScanOf('src/a.js')]: GitConversation.failed(''),
      'add src/a.js': GitConversation.ok(),
      'checkout --merge -- src/a.js': GitConversation.ok(),
    })
  }

  static aGitGrepThatFailsWhileCheckingForMarkers() {
    return new GitConversation({
      [UNMERGED_FILES]: [GitConversation.ok('src/a.js'), GitConversation.ok('')],
      [FILES_DIFFERING_FROM_THE_INDEX]: GitConversation.ok('src/a.js'),
      [GitConversation.markerScanOf('src/a.js')]: { code: 128, stdout: '' },
      'add src/a.js': GitConversation.ok(),
      'commit --no-edit': GitConversation.ok(),
    })
  }

  static aTrackedMachineryFileModifiedOutsideTheConflict() {
    return new GitConversation({
      [UNMERGED_FILES]: [GitConversation.ok('src/a.js'), GitConversation.ok('')],
      [FILES_DIFFERING_FROM_THE_INDEX]: GitConversation.ok(GitConversation.nulSeparated('src/a.js', 'docs/superpowers/metrics/7.jsonl')),
      [GitConversation.markerScanOf('src/a.js')]: GitConversation.failed(''),
      'add src/a.js': GitConversation.ok(),
      'commit --no-edit': GitConversation.ok(),
    })
  }

  static aForeignFileAlongsideAMachineryFile() {
    return new GitConversation({
      [UNMERGED_FILES]: GitConversation.ok('src/a.js'),
      [FILES_DIFFERING_FROM_THE_INDEX]: GitConversation.ok(GitConversation.nulSeparated('src/a.js', 'src/other.js', 'docs/superpowers/metrics/7.jsonl')),
      'checkout --merge -- src/a.js': GitConversation.ok(),
    })
  }

  static aMachineryShapedFileWithoutThePredicate() {
    return new GitConversation({
      [UNMERGED_FILES]: GitConversation.ok('src/a.js'),
      [FILES_DIFFERING_FROM_THE_INDEX]: GitConversation.ok(GitConversation.nulSeparated('src/a.js', 'docs/superpowers/metrics/7.jsonl')),
      'checkout --merge -- src/a.js': GitConversation.ok(),
    })
  }
}

describe('BranchReconciliation, when merging', () => {
  it('a_base_that_did_not_move_produces_no_merge_commit_and_no_merge_call', () => {
    const git = ConversationMother.aBaseThatDidNotMove()
    const round = new BranchReconciliation({ git: git.run }).merge({ baseBranch: 'main' })

    expect(round.outcome).toBe(ReconcileOutcome.UP_TO_DATE)
    expect(git.asked('merge --no-edit')).toBe(false)
  })

  it('a_base_that_moved_is_merged_and_never_rebased_so_the_open_pull_request_keeps_its_hashes', () => {
    const git = ConversationMother.aBaseThatMergesCleanly()
    const round = new BranchReconciliation({ git: git.run }).merge({ baseBranch: 'main' })

    expect(round.outcome).toBe(ReconcileOutcome.MERGED)
    expect(git.asked('rebase')).toBe(false)
  })

  it('a_content_conflict_names_the_files_and_leaves_the_merge_alive_for_someone_to_resolve', () => {
    const git = ConversationMother.aBaseThatConflictsOnTwoFiles()
    const round = new BranchReconciliation({ git: git.run }).merge({ baseBranch: 'main' })

    expect(round.outcome).toBe(ReconcileOutcome.CONFLICTING)
    expect(round.files).toEqual(['src/a.js', 'src/b.js'])
    expect(git.asked('merge --abort')).toBe(false)
  })

  it('a_merge_that_left_no_merge_head_is_not_a_content_conflict_and_says_so', () => {
    const git = ConversationMother.aMergeThatGitRefusedToStart()
    const round = new BranchReconciliation({ git: git.run }).merge({ baseBranch: 'main' })

    expect(round.outcome).toBe(ReconcileOutcome.UNMERGEABLE_TREE)
  })

  it('the_classification_of_a_failed_merge_asks_the_tree_and_never_reads_the_error_text', () => {
    const git = ConversationMother.aBaseThatConflictsOnTwoFiles()
    new BranchReconciliation({ git: git.run }).merge({ baseBranch: 'main' })

    expect(git.asked('rev-parse --verify --quiet MERGE_HEAD')).toBe(true)
  })
})

describe('BranchReconciliation, when concluding a round', () => {
  it('a_resolution_with_no_leftovers_is_staged_by_the_program_and_committed_so_the_merge_concludes', () => {
    const git = ConversationMother.aResolutionWithNoLeftovers()
    const round = new BranchReconciliation({ git: git.run }).conclude()

    expect(round.outcome).toBe(ReconcileOutcome.RESOLVED)
    expect(round.reason).toBe(null)
    expect(git.asked('add src/a.js src/b.js')).toBe(true)
    expect(git.asked('commit --no-edit')).toBe(true)
  })

  it('markers_left_in_a_resolved_file_discard_the_round_before_anything_is_committed', () => {
    const git = ConversationMother.aResolutionThatStillCarriesMarkers()
    const round = new BranchReconciliation({ git: git.run }).conclude()

    expect(round.outcome).toBe(ReconcileOutcome.ROUND_DISCARDED)
    expect(round.reason).toBe(DiscardReason.MARKERS_LEFT)
    expect(git.asked('checkout --merge')).toBe(true)
    expect(git.asked('commit')).toBe(false)
  })

  it('a_file_touched_outside_the_conflict_discards_the_round_before_anything_is_committed', () => {
    const git = ConversationMother.aFileTouchedOutsideTheConflict()
    const round = new BranchReconciliation({ git: git.run }).conclude()

    expect(round.outcome).toBe(ReconcileOutcome.ROUND_DISCARDED)
    expect(round.reason).toBe(DiscardReason.TOUCHED_OUTSIDE_THE_CONFLICT)
    expect(git.asked('checkout --merge')).toBe(true)
    expect(git.asked('commit')).toBe(false)
  })

  it('a_file_still_unmerged_after_the_add_discards_the_round_instead_of_committing_half_a_merge', () => {
    const git = ConversationMother.aFileStillUnmergedAfterTheAdd()
    const round = new BranchReconciliation({ git: git.run }).conclude()

    expect(round.outcome).toBe(ReconcileOutcome.ROUND_DISCARDED)
    expect(round.reason).toBe(DiscardReason.UNRESOLVED_FILES_REMAIN)
    expect(git.asked('checkout --merge')).toBe(true)
    expect(git.asked('commit')).toBe(false)
  })

  it('a_git_grep_that_cannot_tell_whether_markers_are_left_raises_instead_of_concluding_the_merge', () => {
    const git = ConversationMother.aGitGrepThatFailsWhileCheckingForMarkers()

    expect(() => new BranchReconciliation({ git: git.run }).conclude()).toThrow(/git grep failed/)
    expect(git.asked('add')).toBe(false)
    expect(git.asked('commit')).toBe(false)
  })

  const theLoopsOwnFootprint = (path) => path.startsWith('docs/superpowers/')

  it('a_machinery_file_outside_the_conflict_does_not_discard_and_the_round_still_resolves', () => {
    const git = ConversationMother.aTrackedMachineryFileModifiedOutsideTheConflict()
    const round = new BranchReconciliation({ git: git.run, isMachineryPath: theLoopsOwnFootprint }).conclude()

    expect(round.outcome).toBe(ReconcileOutcome.RESOLVED)
    expect(git.asked('checkout --merge')).toBe(false)
    expect(git.asked('add src/a.js')).toBe(true)
    expect(git.asked('commit --no-edit')).toBe(true)
  })

  it('a_genuinely_foreign_file_still_discards_even_alongside_a_machinery_file', () => {
    const git = ConversationMother.aForeignFileAlongsideAMachineryFile()
    const round = new BranchReconciliation({ git: git.run, isMachineryPath: theLoopsOwnFootprint }).conclude()

    expect(round.outcome).toBe(ReconcileOutcome.ROUND_DISCARDED)
    expect(round.reason).toBe(DiscardReason.TOUCHED_OUTSIDE_THE_CONFLICT)
    expect(git.asked('checkout --merge')).toBe(true)
    expect(git.asked('commit')).toBe(false)
  })

  it('without_a_machinery_predicate_a_machinery_shaped_file_still_discards_so_the_default_never_fails_open', () => {
    const git = ConversationMother.aMachineryShapedFileWithoutThePredicate()
    const round = new BranchReconciliation({ git: git.run }).conclude()

    expect(round.outcome).toBe(ReconcileOutcome.ROUND_DISCARDED)
    expect(round.reason).toBe(DiscardReason.TOUCHED_OUTSIDE_THE_CONFLICT)
  })
})
