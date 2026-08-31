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

  static aResolutionWithNoLeftovers() {
    return new GitConversation({
      'diff --name-only --diff-filter=U': [ok('src/a.js\nsrc/b.js'), ok('')],
      'status --porcelain': ok(''),
      'grep -l -e <<<<<<< -e ======= -e >>>>>>> -- src/a.js src/b.js': failed(''),
      'add src/a.js src/b.js': ok(),
      'commit --no-edit': ok(),
    })
  }

  static aResolutionThatStillCarriesMarkers() {
    return new GitConversation({
      'diff --name-only --diff-filter=U': ok('src/a.js\nsrc/b.js'),
      'status --porcelain': ok(''),
      'grep -l -e <<<<<<< -e ======= -e >>>>>>> -- src/a.js src/b.js': ok('src/a.js'),
      'checkout --merge -- src/a.js src/b.js': ok(),
    })
  }

  static aFileTouchedOutsideTheConflict() {
    return new GitConversation({
      'diff --name-only --diff-filter=U': ok('src/a.js'),
      'status --porcelain': ok(' M src/other.js'),
      'checkout --merge -- src/a.js': ok(),
    })
  }

  static aFileStillUnmergedAfterTheAdd() {
    return new GitConversation({
      'diff --name-only --diff-filter=U': [ok('src/a.js'), ok('src/a.js')],
      'status --porcelain': ok(''),
      'grep -l -e <<<<<<< -e ======= -e >>>>>>> -- src/a.js': failed(''),
      'add src/a.js': ok(),
      'checkout --merge -- src/a.js': ok(),
    })
  }

  static aGitGrepThatFailsWhileCheckingForMarkers() {
    return new GitConversation({
      'diff --name-only --diff-filter=U': [ok('src/a.js'), ok('')],
      'status --porcelain': ok(''),
      'grep -l -e <<<<<<< -e ======= -e >>>>>>> -- src/a.js': { code: 128, stdout: '' },
      'add src/a.js': ok(),
      'commit --no-edit': ok(),
    })
  }

  // Fix round 2 (Task 8): la huella del propio loop (telemetría, veredictos,
  // el plan) sin comitear en `status --porcelain` no es una resolución
  // tocando de más — es la máquina, no el reconciliador.
  static aMachineryFileOutsideTheConflict() {
    return new GitConversation({
      'diff --name-only --diff-filter=U': [ok('src/a.js'), ok('')],
      'status --porcelain': ok('?? docs/superpowers/metrics/7.jsonl'),
      'grep -l -e <<<<<<< -e ======= -e >>>>>>> -- src/a.js': failed(''),
      'add src/a.js': ok(),
      'commit --no-edit': ok(),
    })
  }

  // La exención no puede tragarse el caso que la comprobación existe para
  // cazar: un fichero AJENO de verdad, junto a uno de la maquinaria, sigue
  // descartando.
  static aForeignFileAlongsideAMachineryFile() {
    return new GitConversation({
      'diff --name-only --diff-filter=U': ok('src/a.js'),
      'status --porcelain': ok(' M src/other.js\n?? docs/superpowers/metrics/7.jsonl'),
      'checkout --merge -- src/a.js': ok(),
    })
  }

  // Sin `isMachineryPath` (el valor por defecto), un fichero con la MISMA
  // forma que uno de la maquinaria sigue descartando: el default es
  // conservador (`() => false`, nadie exento), nunca un fail-open.
  static aMachineryShapedFileWithoutThePredicate() {
    return new GitConversation({
      'diff --name-only --diff-filter=U': ok('src/a.js'),
      'status --porcelain': ok('?? docs/superpowers/metrics/7.jsonl'),
      'checkout --merge -- src/a.js': ok(),
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

describe('BranchReconciliation, al concluir una ronda', () => {
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

  // Fix round 2 (Task 8) — `isMachineryPath` entra por constructor
  // (`conventions/architecture.md`: la política no vive en el adaptador).
  const esDeLaMaquinariaDePrueba = (path) => path.startsWith('docs/superpowers/')

  it('a_machinery_file_outside_the_conflict_does_not_discard_and_the_round_still_resolves', () => {
    const git = ConversationMother.aMachineryFileOutsideTheConflict()
    const round = new BranchReconciliation({ git: git.run, isMachineryPath: esDeLaMaquinariaDePrueba }).conclude()

    expect(round.outcome).toBe(ReconcileOutcome.RESOLVED)
    expect(git.asked('checkout --merge')).toBe(false)
    expect(git.asked('add src/a.js')).toBe(true)
    expect(git.asked('commit --no-edit')).toBe(true)
  })

  it('a_genuinely_foreign_file_still_discards_even_alongside_a_machinery_file', () => {
    const git = ConversationMother.aForeignFileAlongsideAMachineryFile()
    const round = new BranchReconciliation({ git: git.run, isMachineryPath: esDeLaMaquinariaDePrueba }).conclude()

    expect(round.outcome).toBe(ReconcileOutcome.ROUND_DISCARDED)
    expect(round.reason).toBe(DiscardReason.TOUCHED_OUTSIDE_THE_CONFLICT)
    expect(git.asked('checkout --merge')).toBe(true)
    expect(git.asked('commit')).toBe(false)
  })

  it('without isMachineryPath (the default), a machinery-shaped file still discards — the default never fails open', () => {
    const git = ConversationMother.aMachineryShapedFileWithoutThePredicate()
    const round = new BranchReconciliation({ git: git.run }).conclude()

    expect(round.outcome).toBe(ReconcileOutcome.ROUND_DISCARDED)
    expect(round.reason).toBe(DiscardReason.TOUCHED_OUTSIDE_THE_CONFLICT)
  })
})
