import { describe, it, expect } from 'vitest'
import { BranchReconciliation } from '../scripts/branch-reconciliation.js'
import { ReconcileOutcome } from '../scripts/reconcile-outcome.js'

class GitConversation {
  constructor(answers) {
    this.answers = answers
    this.calls = []
  }

  run = (argv) => {
    const key = argv.join(' ')
    this.calls.push(key)
    if (!(key in this.answers)) throw new Error(`nadie escribió respuesta para: git ${key}`)
    return this.answers[key]
  }

  asked(fragment) {
    return this.calls.some((c) => c.includes(fragment))
  }
}

const ok = (stdout = '') => ({ code: 0, stdout })
const failed = (stdout = '') => ({ code: 1, stdout })

class ConversationMother {
  static aBaseThatDidNotMove() {
    return new GitConversation({
      'fetch origin main': ok(),
      'rev-list --count HEAD..origin/main': ok('0'),
    })
  }

  static aBaseThatMergesCleanly() {
    return new GitConversation({
      'fetch origin main': ok(),
      'rev-list --count HEAD..origin/main': ok('2'),
      'merge --no-edit origin/main': ok(),
    })
  }

  static aBaseThatConflictsOnTwoFiles() {
    return new GitConversation({
      'fetch origin main': ok(),
      'rev-list --count HEAD..origin/main': ok('2'),
      'merge --no-edit origin/main': failed(),
      'rev-parse --verify --quiet MERGE_HEAD': ok('aaaa'),
      'diff --name-only --diff-filter=U': ok('src/a.js\nsrc/b.js'),
    })
  }

  static aMergeThatGitRefusedToStart() {
    return new GitConversation({
      'fetch origin main': ok(),
      'rev-list --count HEAD..origin/main': ok('2'),
      'merge --no-edit origin/main': failed(),
      'rev-parse --verify --quiet MERGE_HEAD': failed(),
    })
  }
}

describe('BranchReconciliation, al fusionar', () => {
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
