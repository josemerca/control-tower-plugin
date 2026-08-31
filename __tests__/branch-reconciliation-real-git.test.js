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
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs'
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

// Fix round 2 (Task 8) — el hallazgo del fix round 1: `medir('reconcile',
// ...)` deja una fila de telemetría SIN comitear en `docs/superpowers/metrics/`
// en CADA invocación de `ct-step reconcile`, y sin la exención por
// `isMachineryPath`, la segunda llamada la ve en `git status --porcelain` y
// descarta con `TOUCHED_OUTSIDE_THE_CONFLICT` — pase lo que pase con la
// resolución real. Este test reproduce la secuencia completa de producción
// (CONFLICTING → el artefacto de la maquinaria aparece → resolución correcta
// → segunda llamada) contra git de verdad, y es el que prueba que `RESOLVED`
// —inalcanzable antes de este fix— ahora sí se alcanza, con su commit de
// fusión real en el log.
const aRepoAboutToConflictWithABase = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ct-recon-2call-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main', '.')
  git('config', 'user.email', 'test@test')
  git('config', 'user.name', 'test')
  writeFileSync(join(dir, 'conflict.txt'), 'line1\nline2\nline3\n')
  // El fichero de métricas ya TRACKEADO desde la base: en producción,
  // `verboCommit` lo stagea dentro del commit de la PRIMERA tarea
  // (`git add -- docs/superpowers/metrics/<issue>.jsonl`), así que para
  // cuando el run llega a `reconcile` ese fichero lleva ya, como mínimo, un
  // commit encima. Sin trackearlo aquí, `git status --porcelain` colapsaría
  // el directorio entero sin trackear en una sola línea `?? docs/` —una
  // forma real, pero de un caso distinto (el PRIMER slice de un repo que
  // nunca escribió métricas), no el que este test reproduce.
  mkdirSync(join(dir, 'docs', 'superpowers', 'metrics'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'metrics', '7.jsonl'), '{"step":"controls"}\n')
  git('add', '-A')
  git('commit', '-qm', 'base')

  // Un `origin` real: `merge({ baseBranch })` hace `git fetch origin
  // <rama>`, así que hace falta un remoto de verdad, no una segunda rama
  // local.
  const origin = mkdtempSync(join(tmpdir(), 'ct-recon-2call-origin-'))
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' })
  git('remote', 'add', 'origin', origin)
  git('push', '-q', 'origin', 'main')

  git('switch', '-q', '-c', 'feature')
  writeFileSync(join(dir, 'conflict.txt'), 'line1\nline2-feature\nline3\n')
  git('add', '-A')
  git('commit', '-qm', 'feature side')

  // La base avanza DESPUÉS de que `feature` se bifurcara, tocando la MISMA
  // línea — empujada desde un clon del bare, como avanza una base real (no
  // se puede tocar un bare a mano).
  const clone = mkdtempSync(join(tmpdir(), 'ct-recon-2call-clone-'))
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

describe('BranchReconciliation, dos invocaciones reales — conflicto y resolución (fix round 2)', () => {
  it('conflicting_then_a_correct_resolution_ends_in_resolved_with_a_real_merge_commit_despite_the_loops_own_untracked_metrics_file', () => {
    const dir = aRepoAboutToConflictWithABase()
    try {
      // La misma forma que declara `LOOP_ARTIFACT_PATTERNS` en scope.js —no
      // se importa aquí para no acoplar este test a ese módulo, sólo se
      // reproduce la FORMA de la política que `ct-step.mjs` de verdad pasa.
      const isMachineryPath = (path) => path.startsWith('docs/superpowers/')

      // Primera llamada: CONFLICTING de verdad, MERGE_HEAD vivo.
      const first = new BranchReconciliation({ git: gitPort(dir), isMachineryPath }).merge({ baseBranch: 'main' })
      expect(first.outcome).toBe(ReconcileOutcome.CONFLICTING)
      expect(first.files).toEqual(['conflict.txt'])

      // Lo que `ct-step reconcile` deja detrás en CADA invocación: `medir()`
      // hace `appendFileSync` sobre el fichero de métricas —YA trackeado,
      // ver arriba—, así que la primera llamada a `reconcile` lo deja
      // MODIFICADO y sin comitear (`M`, no `??`). Es justo la forma real del
      // hallazgo del fix round 1.
      appendFileSync(join(dir, 'docs', 'superpowers', 'metrics', '7.jsonl'), '{"step":"reconcile"}\n')

      // La resolución correcta: las tres marcas fuera, el contenido fusionado
      // a mano, y SIN stagear — el `git add` lo hace `conclude()`.
      writeFileSync(join(dir, 'conflict.txt'), 'line1\nline2-feature\nline2-main\nline3\n')

      const second = new BranchReconciliation({ git: gitPort(dir), isMachineryPath }).conclude()

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
