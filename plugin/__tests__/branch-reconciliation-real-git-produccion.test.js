import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BranchReconciliation } from '../scripts/branch-reconciliation.js'
import { ReconcileOutcome } from '../scripts/reconcile-outcome.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

class ProductionShapedRepoMother {
  static port(dir) {
    return (argv) => {
      const r = spawnSync('git', argv, { cwd: dir, encoding: 'utf8' })
      return { code: r.status, stdout: r.stdout ?? '' }
    }
  }

  static #gitIn(dir) {
    return (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  }

  static aSliceBranchWhoseBaseIsAboutToMove({ files, onTheSlice, onTheBase }) {
    const dir = mkdtempSync(join(tmpdir(), 'ct-recon-prod-'))
    const git = ProductionShapedRepoMother.#gitIn(dir)
    git('init', '-q', '-b', 'main', '.')
    git('config', 'user.email', 'test@test')
    git('config', 'user.name', 'test')
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true })
      writeFileSync(join(dir, path), content)
    }
    git('add', '-A')
    git('commit', '-qm', 'base')

    const origin = mkdtempSync(join(tmpdir(), 'ct-recon-prod-origin-'))
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' })
    git('remote', 'add', 'origin', origin)
    git('push', '-q', 'origin', 'main')

    git('switch', '-q', '-c', 'feature')
    for (const [path, content] of Object.entries(onTheSlice)) writeFileSync(join(dir, path), content)
    git('add', '-A')
    git('commit', '-qm', 'slice side')

    const clone = mkdtempSync(join(tmpdir(), 'ct-recon-prod-clone-'))
    execFileSync('git', ['clone', '-q', origin, clone], { encoding: 'utf8' })
    const gClone = ProductionShapedRepoMother.#gitIn(clone)
    gClone('config', 'user.email', 'base@test')
    gClone('config', 'user.name', 'base')
    for (const [path, content] of Object.entries(onTheBase)) writeFileSync(join(clone, path), content)
    gClone('add', '-A')
    gClone('commit', '-qm', 'the base moves on')
    gClone('push', '-q', 'origin', 'main')

    return dir
  }

  static aBranchAlreadyMergedByHand({ resolution }) {
    const dir = ProductionShapedRepoMother.aSliceBranchWhoseBaseIsAboutToMove({
      files: { 'shared.txt': 'original line\n' },
      onTheSlice: { 'shared.txt': 'the slice line\n' },
      onTheBase: { 'shared.txt': 'the base line\n' },
    })
    const git = ProductionShapedRepoMother.#gitIn(dir)
    git('fetch', '-q', 'origin', 'main')
    const merge = spawnSync('git', ['merge', '--no-edit', 'origin/main'], { cwd: dir, encoding: 'utf8' })
    if (merge.status === 0) throw new Error('el montaje esperaba un conflicto real y no lo obtuvo')
    writeFileSync(join(dir, 'shared.txt'), resolution)
    git('add', '-A')
    git('commit', '-qm', 'merge resuelto a mano, sin pasar por ct-step reconcile')
    return dir
  }
}

describe('BranchReconciliation against real git, shaped the way production is', () => {
  it('a_base_that_brought_a_clean_file_alongside_the_conflicted_one_still_reaches_resolved_with_a_real_merge_commit', () => {
    const dir = ProductionShapedRepoMother.aSliceBranchWhoseBaseIsAboutToMove({
      files: { 'shared.txt': 'original line\n', 'other.txt': 'untouched by the slice\n' },
      onTheSlice: { 'shared.txt': 'the slice line\n' },
      onTheBase: { 'shared.txt': 'the base line\n', 'other.txt': 'the base also moved this one\n' },
    })
    try {
      const first = new BranchReconciliation({ git: ProductionShapedRepoMother.port(dir) }).merge({ baseBranch: 'main' })
      expect(first.outcome).toBe(ReconcileOutcome.CONFLICTING)
      expect(first.files).toEqual(['shared.txt'])

      const whatGitStagedOnItsOwn = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })
      expect(whatGitStagedOnItsOwn).toMatch(/^M {2}other\.txt$/m)

      writeFileSync(join(dir, 'shared.txt'), 'the slice line\nthe base line\n')

      const second = new BranchReconciliation({ git: ProductionShapedRepoMother.port(dir) }).conclude()

      expect(second.outcome).toBe(ReconcileOutcome.RESOLVED)
      expect(second.reason).toBe(null)

      const log = execFileSync('git', ['log', '--oneline', '-1'], { cwd: dir, encoding: 'utf8' })
      expect(log).toMatch(/Merge/)
      const parents = execFileSync('git', ['rev-list', '--parents', '-1', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim().split(' ')
      expect(parents).toHaveLength(3)
      expect(readFileSync(join(dir, 'other.txt'), 'utf8')).toBe('the base also moved this one\n')
    } finally {
      rmSyncBestEffort(dir)
    }
  })

  it('a_markdown_setext_underline_in_a_correctly_resolved_file_is_not_a_conflict_marker', () => {
    const underlinedTitle = 'Título\n===========\n\n'
    const dir = ProductionShapedRepoMother.aSliceBranchWhoseBaseIsAboutToMove({
      files: { 'docs/nota.md': `${underlinedTitle}línea original\n` },
      onTheSlice: { 'docs/nota.md': `${underlinedTitle}línea de la tarea\n` },
      onTheBase: { 'docs/nota.md': `${underlinedTitle}línea de la base\n` },
    })
    try {
      const first = new BranchReconciliation({ git: ProductionShapedRepoMother.port(dir) }).merge({ baseBranch: 'main' })
      expect(first.outcome).toBe(ReconcileOutcome.CONFLICTING)
      expect(first.files).toEqual(['docs/nota.md'])

      const resolved = `${underlinedTitle}línea de la tarea\nlínea de la base\n`
      writeFileSync(join(dir, 'docs', 'nota.md'), resolved)

      const second = new BranchReconciliation({ git: ProductionShapedRepoMother.port(dir) }).conclude()

      expect(second.outcome).toBe(ReconcileOutcome.RESOLVED)
      expect(readFileSync(join(dir, 'docs', 'nota.md'), 'utf8')).toBe(resolved)
    } finally {
      rmSyncBestEffort(dir)
    }
  })

  it('a_merge_someone_else_committed_with_markers_inside_is_caught_post_hoc_instead_of_reported_as_up_to_date', () => {
    const dir = ProductionShapedRepoMother.aBranchAlreadyMergedByHand({
      resolution: '<<<<<<< HEAD\nthe slice line\n=======\nthe base line\n>>>>>>> origin/main\n',
    })
    try {
      const round = new BranchReconciliation({ git: ProductionShapedRepoMother.port(dir) }).merge({ baseBranch: 'main' })

      expect(round.outcome).toBe(ReconcileOutcome.MARKERS_COMMITTED)
      expect(round.files).toEqual(['shared.txt'])
    } finally {
      rmSyncBestEffort(dir)
    }
  })

  it('a_merge_someone_else_committed_and_resolved_properly_is_up_to_date_and_not_accused', () => {
    const dir = ProductionShapedRepoMother.aBranchAlreadyMergedByHand({ resolution: 'the slice line\nthe base line\n' })
    try {
      const round = new BranchReconciliation({ git: ProductionShapedRepoMother.port(dir) }).merge({ baseBranch: 'main' })

      expect(round.outcome).toBe(ReconcileOutcome.UP_TO_DATE)
      expect(round.files).toEqual([])
    } finally {
      rmSyncBestEffort(dir)
    }
  })
})
