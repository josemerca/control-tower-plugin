import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BranchReconciliation } from '../scripts/branch-reconciliation.js'
import { ReconcileOutcome, DiscardReason } from '../scripts/reconcile-outcome.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const THE_LOOPS_OWN_METRICS_FILE = join('docs', 'superpowers', 'metrics', '7.jsonl')
const theLoopsOwnFootprint = (path) => path.startsWith('docs/superpowers/')

const aRepoWithAGenuineConflict = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ct-recon-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main', '.')
  git('config', 'user.email', 'test@test')
  git('config', 'user.name', 'test')
  writeFileSync(join(dir, 'conflict.txt'), 'line1\nline2\nline3\n')
  git('add', '-A')
  git('commit', '-qm', 'base')
  git('switch', '-q', '-c', 'feature')
  writeFileSync(join(dir, 'conflict.txt'), 'line1\nline2-feature\nline3\n')
  git('add', '-A')
  git('commit', '-qm', 'feature side')
  git('switch', '-q', 'main')
  writeFileSync(join(dir, 'conflict.txt'), 'line1\nline2-main\nline3\n')
  git('add', '-A')
  git('commit', '-qm', 'main side')

  const merge = spawnSync('git', ['merge', 'feature'], { cwd: dir, encoding: 'utf8' })
  if (merge.status === 0) throw new Error('el montaje del test esperaba un conflicto real y no lo obtuvo')

  return dir
}

const gitPort = (dir) => (argv) => {
  const r = spawnSync('git', argv, { cwd: dir, encoding: 'utf8' })
  return { code: r.status, stdout: r.stdout ?? '' }
}

const aRepoWithATrackedMetricsFileAndABaseAboutToConflict = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ct-recon-2call-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main', '.')
  git('config', 'user.email', 'test@test')
  git('config', 'user.name', 'test')
  writeFileSync(join(dir, 'conflict.txt'), 'line1\nline2\nline3\n')
  mkdirSync(join(dir, 'docs', 'superpowers', 'metrics'), { recursive: true })
  writeFileSync(join(dir, THE_LOOPS_OWN_METRICS_FILE), '{"step":"controls"}\n')
  git('add', '-A')
  git('commit', '-qm', 'base')

  const origin = mkdtempSync(join(tmpdir(), 'ct-recon-2call-origin-'))
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' })
  git('remote', 'add', 'origin', origin)
  git('push', '-q', 'origin', 'main')

  git('switch', '-q', '-c', 'feature')
  writeFileSync(join(dir, 'conflict.txt'), 'line1\nline2-feature\nline3\n')
  git('add', '-A')
  git('commit', '-qm', 'feature side')

  const aBaseThatMovesOntoTheSameLineFromItsOwnClone = mkdtempSync(join(tmpdir(), 'ct-recon-2call-clone-'))
  const clone = aBaseThatMovesOntoTheSameLineFromItsOwnClone
  execFileSync('git', ['clone', '-q', origin, clone], { encoding: 'utf8' })
  const gClone = (...a) => execFileSync('git', a, { cwd: clone, encoding: 'utf8' })
  gClone('config', 'user.email', 'base@test')
  gClone('config', 'user.name', 'base')
  writeFileSync(join(clone, 'conflict.txt'), 'line1\nline2-main\nline3\n')
  gClone('add', '-A')
  gClone('commit', '-qm', 'main side')
  gClone('push', '-q', 'origin', 'main')

  return dir
}

describe('BranchReconciliation, dos invocaciones reales — conflicto y resolución', () => {
  it('conflicting_then_a_correct_resolution_ends_in_resolved_with_a_real_merge_commit_despite_the_loops_own_modified_metrics_file', () => {
    const dir = aRepoWithATrackedMetricsFileAndABaseAboutToConflict()
    try {
      const whatEveryReconcileCallLeavesBehind = () =>
        appendFileSync(join(dir, THE_LOOPS_OWN_METRICS_FILE), '{"step":"reconcile"}\n')
      const aCorrectResolutionNobodyStaged = () =>
        writeFileSync(join(dir, 'conflict.txt'), 'line1\nline2-feature\nline2-main\nline3\n')

      const first = new BranchReconciliation({ git: gitPort(dir), isMachineryPath: theLoopsOwnFootprint }).merge({ baseBranch: 'main' })
      expect(first.outcome).toBe(ReconcileOutcome.CONFLICTING)
      expect(first.files).toEqual(['conflict.txt'])

      whatEveryReconcileCallLeavesBehind()
      aCorrectResolutionNobodyStaged()

      const second = new BranchReconciliation({ git: gitPort(dir), isMachineryPath: theLoopsOwnFootprint }).conclude()

      expect(second.outcome).toBe(ReconcileOutcome.RESOLVED)
      expect(second.reason).toBe(null)

      const log = execFileSync('git', ['log', '--oneline', '-1'], { cwd: dir, encoding: 'utf8' })
      expect(log).toMatch(/Merge/)

      const mergeConcluded = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { cwd: dir, encoding: 'utf8' })
      expect(mergeConcluded.status).not.toBe(0)

      const content = readFileSync(join(dir, 'conflict.txt'), 'utf8')
      expect(content).not.toMatch(/<<<<<<<|=======|>>>>>>>/)
      expect(content).toBe('line1\nline2-feature\nline2-main\nline3\n')
    } finally {
      rmSyncBestEffort(dir)
    }
  })
})

describe('BranchReconciliation.conclude() contra un repositorio git real', () => {
  it('a_stray_conflict_marker_left_after_resolving_discards_the_round_and_leaves_no_merge_commit_in_the_log', () => {
    const dir = aRepoWithAGenuineConflict()
    try {
      const headBeforeConclude = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()

      const aResolutionThatOnlyForgotTheOpeningMarker = () =>
        writeFileSync(join(dir, 'conflict.txt'), '<<<<<<< HEAD\nline1\nline2-main\nline3\n')
      aResolutionThatOnlyForgotTheOpeningMarker()

      const round = new BranchReconciliation({ git: gitPort(dir) }).conclude()

      expect(round.outcome).toBe(ReconcileOutcome.ROUND_DISCARDED)
      expect(round.reason).toBe(DiscardReason.MARKERS_LEFT)

      const headAfterConclude = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
      expect(headAfterConclude).toBe(headBeforeConclude)

      const log = execFileSync('git', ['log', '--oneline', '--all'], { cwd: dir, encoding: 'utf8' })
      expect(log).not.toMatch(/Merge branch/)

      const mergeStillInProgress = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], {
        cwd: dir,
        encoding: 'utf8',
      })
      expect(mergeStillInProgress.status).toBe(0)

      const restored = readFileSync(join(dir, 'conflict.txt'), 'utf8')
      expect(restored).toContain('<<<<<<<')
      expect(restored).toContain('=======')
      expect(restored).toContain('>>>>>>>')
    } finally {
      rmSyncBestEffort(dir)
    }
  })
})
