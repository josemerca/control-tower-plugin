// ============================================================================
// Reconciliación de ramas, tarea 3 — `ct-step` cuenta commits desde la
// referencia de MEDIDA (el merge-base con la base remota), no desde el corte
// congelado en `run.baseSha`, y descarta las fusiones de la cuenta.
//
// La guardia de arranque de `ct-step` (`hechos !== esperados`, ver
// scripts/ct-step.mjs) cruza lo que el estado afirma contra los commits que
// hay de verdad. Antes de esta tarea, esa cuenta era `baseSha..HEAD` a secas:
// en cuanto la rama del slice mergea su base avanzada, cada commit ajeno que
// el merge trae (y el propio commit de fusión) entra en el rango y `hechos`
// se dispara por encima de `esperados` — un proceso nuevo (cada verbo relee
// el fichero desde cero) no tiene forma de distinguir eso de un estado
// corrupto, y muere en PRECONDITION para siempre: el run nunca vuelve a dar
// un paso.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const STEP = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-step.mjs')

// ----------------------------------------------------------------------------
// Step 1 del brief — characterization test: pina el HECHO de git en crudo del
// que depende el cambio (3 commits desde el corte, 1 desde el merge-base sin
// fusiones). Queda verde ANTES y DESPUÉS del cambio en ct-step.mjs porque no
// ejecuta ct-step: documenta por qué hace falta, no lo sustituye.
// ----------------------------------------------------------------------------
describe('la cuenta de commits del run', () => {
  it('a_merge_of_the_base_does_not_inflate_the_count_of_committed_tasks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-count-'))
    const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
    git('init', '-b', 'main')
    git('config', 'user.email', 'x@y.z')
    git('config', 'user.name', 'x')
    writeFileSync(join(dir, 'a.txt'), 'B\n'); git('add', '.'); git('commit', '-m', 'B')
    const cut = git('rev-parse', 'HEAD')

    git('switch', '-c', 'feat/42')
    writeFileSync(join(dir, 's.txt'), 'S1\n'); git('add', '.'); git('commit', '-m', 'S1')

    git('switch', 'main')
    writeFileSync(join(dir, 'c.txt'), 'C\n'); git('add', '.'); git('commit', '-m', 'C')
    const advanced = git('rev-parse', 'HEAD')

    git('switch', 'feat/42')
    git('merge', '--no-edit', 'main')

    const fromTheCut = Number(git('rev-list', '--count', `${cut}..HEAD`))
    const fromTheMergeBase = Number(git('rev-list', '--count', '--no-merges', `${advanced}..HEAD`))

    expect(fromTheCut).toBe(3)
    expect(fromTheMergeBase).toBe(1)

    rmSync(dir, { recursive: true, force: true })
  })
})

// ----------------------------------------------------------------------------
// El test que exige el override del dispatcher: ejercita `ct-step` DE
// VERDAD, con un run parado en un paso de slice tras haber mergeado su base
// avanzada. El arrange lo construye git real (RepoMother de abajo) — nunca
// ct-step, que es la pieza bajo prueba (conventions/testing.md).
// ----------------------------------------------------------------------------
const FENCE = '```'

// Copiado (no importado — conventions/testing.md: los tests de este repo no
// se importan entre sí) de __tests__/e2e-ct-step.test.js: el único plan
// mínimo de una tarea que plan-tasks.js#extractTasks trocea sin marcar
// PLAN_NOT_EXECUTABLE (los ficheros van entre backticks; sin ellas
// `splitFiles` no los reconoce y CUALQUIER verbo muere con exit 6 antes de
// llegar a la guardia que este test quiere ejercitar).
const planDeUnaTarea = () => [
  '# #99 — fixture slice',
  '',
  '> **This plan is written to be executed by task-scoped subagents with zero context.**',
  '',
  '## 1. Context and goal',
  'Fixture.',
  '### Desired end state',
  'Work done.',
  '### Out of scope',
  'N/A — fixture.',
  '## 2. Closed decisions',
  '| Decision | Value |',
  '|---|---|',
  '| fixture | yes |',
  '## 3. Reference patterns',
  'N/A — fixture.',
  '## 4. Inventory',
  'work.txt',
  '## 5. Interfaces',
  'Consumes: N/A. Produces: N/A.',
  '## 6. Test strategy',
  'N/A — fixture.',
  '## 7. Tasks',
  '### Task 1 — do the work',
  '**Objective:** the work is committed.',
  '**Files:** `work.txt` (create).',
  'Final text (work.txt):',
  FENCE,
  'trabajo',
  FENCE,
  '**TDD:** No TDD — fixture.',
  '**Tests:** N/A — fixture.',
  '**Verification:** git log shows the commit.',
  FENCE + 'bash',
  'git log --oneline -1',
  FENCE,
  '## 8. Global verification',
  'N/A — fixture.',
  '## 9. Assumptions',
  'None.',
  '',
].join('\n')

// RepoMother — monta el mundo con git real: un remoto desnudo (para que
// `origin/main` exista, que es lo que `SliceBase.measurementRef` necesita
// para calcular el merge-base) y un clon donde vive el slice. NUNCA llama a
// ct-step.mjs para construir el arrange.
class RepoMother {
  static aSliceThatMergedAnAdvancedBase(issue) {
    const remote = mkdtempSync(join(tmpdir(), 'ct-step-mb-remote-'))
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: remote })

    const seed = mkdtempSync(join(tmpdir(), 'ct-step-mb-seed-'))
    const seedGit = (...a) => execFileSync('git', a, { cwd: seed, encoding: 'utf8' })
    seedGit('init', '-q', '-b', 'main')
    seedGit('config', 'user.email', 'coordinadora@x.z')
    seedGit('config', 'user.name', 'coordinadora')
    writeFileSync(join(seed, 'f.txt'), 'base\n')
    seedGit('add', '-A')
    seedGit('commit', '-qm', 'corte')
    seedGit('remote', 'add', 'origin', remote)
    seedGit('push', '-q', '-u', 'origin', 'main')

    const work = mkdtempSync(join(tmpdir(), 'ct-step-mb-work-'))
    execFileSync('git', ['clone', '-q', remote, '.'], { cwd: work })
    const workGit = (...a) => execFileSync('git', a, { cwd: work, encoding: 'utf8' })
    workGit('config', 'user.email', 'slice@x.z')
    workGit('config', 'user.name', 'slice')
    workGit('switch', '-q', '-c', `feat/${issue}`)

    // La tarea 1 del plan: un único commit, con el plan y la semilla dentro
    // (igual que hace ct-step de verdad — `report`+`commit` stagean y
    // comitean juntos lo que la tarea toca).
    mkdirSync(join(work, 'docs', 'superpowers', 'plans'), { recursive: true })
    writeFileSync(join(work, 'docs', 'superpowers', 'plans', 'plan.md'), planDeUnaTarea())
    mkdirSync(join(work, '.agent'), { recursive: true })
    writeFileSync(join(work, '.agent', 'SLICE.md'), `---\nissue: ${issue}\nbase: main\n---\n# s\n`)
    writeFileSync(join(work, 'work.txt'), 'trabajo\n')
    workGit('add', '-A')
    workGit('commit', '-qm', 'tarea 1')
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim()

    // La base avanza DESPUÉS del corte que congeló `baseSha` — un commit que
    // el slice nunca escribió.
    writeFileSync(join(seed, 'g.txt'), 'avance\n')
    seedGit('add', '-A')
    seedGit('commit', '-qm', 'la base avanza')
    seedGit('push', '-q', 'origin', 'main')

    // El slice mergea esa base avanzada: el vector que esta reconciliación
    // viene a arreglar.
    workGit('fetch', '-q', 'origin', 'main')
    workGit('merge', '-q', '--no-edit', 'origin/main')

    // El run queda parado en un paso DE SLICE (`global`, tras la única tarea
    // ya comiteada): `esperados` = tasksTotal + sliceCommits = 1. Con el
    // corte congelado como referencia, `hechos` cuenta la tarea, el commit
    // ajeno que trajo el merge y el propio commit de fusión: 3 contra 1, y
    // hoy CUALQUIER verbo muere en PRECONDITION.
    writeFileSync(join(work, '.agent', `run-${issue}.json`), JSON.stringify({
      plan: 'docs/superpowers/plans/plan.md', issue, baseSha,
      task: 1, tasksTotal: 1, step: 'global',
      controlRetries: 0, judgeRetries: 0, correctionRetries: 0, discards: 0, spendUsd: 0,
    }, null, 2))

    return { remote, seed, work }
  }
}

const next = (cwd, issue) => spawnSync(process.execPath, [
  STEP, 'next', '--plan', 'docs/superpowers/plans/plan.md', '--issue', String(issue),
], { cwd, encoding: 'utf8' })

describe('ct-step — el run de un slice que mergeó su base avanzada', () => {
  const issue = 99

  it('a_run_paused_at_a_slice_step_after_merging_an_advanced_base_is_not_rejected_as_out_of_sync', () => {
    const { remote, seed, work } = RepoMother.aSliceThatMergedAnAdvancedBase(issue)
    try {
      const r = next(work, issue)
      // Antes de esta tarea: exit PRECONDITION, "el estado y git no cuentan
      // lo mismo" (3 commits desde el corte contra 1 esperado). Con la
      // referencia de medida resuelta al merge-base, la cuenta vuelve a
      // cuadrar y el run sigue dando pasos.
      expect(r.stderr).not.toMatch(/no cuentan lo mismo/)
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/GLOBAL VERIFICATION/)
    } finally {
      for (const d of [work, seed, remote]) rmSync(d, { recursive: true, force: true })
    }
  })
})
