// Este fichero lanza subprocesos `git` de verdad — no hay marcador para eso
// en este repo, así que el nombre del fichero es la declaración: la suite
// rápida es `branch-reconciliation.test.js`, con el puerto doblado.
//
// La razón de existir de este test es pinchar la lección de la tarea contra
// git real, no contra un doble que podría estar de acuerdo con el mismo
// error: un resolutor que deja `<<<<<<<` dentro del fichero y `conclude()`
// que no lo mirase concluiría la fusión con los marcadores dentro del commit.
import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BranchReconciliation } from '../scripts/branch-reconciliation.js'
import { ReconcileOutcome, DiscardReason } from '../scripts/reconcile-outcome.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

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

describe('BranchReconciliation.conclude() contra un repositorio git real', () => {
  it('a_stray_conflict_marker_left_after_resolving_discards_the_round_and_leaves_no_merge_commit_in_the_log', () => {
    const dir = aRepoWithAGenuineConflict()
    try {
      const headBeforeConclude = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()

      // Resolución incompleta: quita `=======` y `>>>>>>>` pero olvida el
      // `<<<<<<<` de arriba. Con solo esa marca dentro, este es el fichero
      // que pincha específicamente la comprobación de `<<<<<<<`.
      writeFileSync(join(dir, 'conflict.txt'), '<<<<<<< HEAD\nline1\nline2-main\nline3\n')

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
