// ============================================================================
// Reconciliación de ramas, tarea 3 — `ct-step` cuenta los commits QUE ESTE RUN
// HA HECHO: el origen del rango sigue siendo `run.baseSha`, y lo que se quita
// es lo que la base aportó.
//
//   git rev-list --count --no-merges run.baseSha..HEAD ^origin/<rama-base>
//
// La guardia de arranque de `ct-step` (`hechos !== esperados`, ver
// scripts/ct-step.mjs) cruza lo que el estado afirma contra los commits que
// hay de verdad. Dos formas de romperla, y las dos matan el run en
// PRECONDITION para siempre (cada verbo es un proceso nuevo que relee el
// fichero desde cero, y no tiene forma de distinguir eso de un estado
// corrupto):
//
//   - Contar `baseSha..HEAD` a secas: en cuanto la rama mergea su base
//     avanzada, cada commit ajeno que el merge trae —y el propio commit de
//     fusión— entra en el rango y `hechos` se dispara. De ahí
//     `^origin/<rama-base>` y `--no-merges`.
//   - Mover el origen al merge-base: `run.baseSha` NO es el corte de la rama,
//     es `headSha()` cuando nace el fichero del run, y para entonces el
//     kickoff ya ha ordenado commitear el plan. Medir desde el corte mete ese
//     commit del plan en la cuenta y `hechos` sale uno de más SIEMPRE, sin
//     que haya ninguna fusión de por medio.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const STEP = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-step.mjs')

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
// `origin/main` exista de verdad, que es lo que la exclusión de la cuenta
// necesita) y un clon donde vive el slice. NUNCA llama a ct-step.mjs para
// construir el arrange (conventions/testing.md: el arrange no se construye
// con la pieza bajo prueba).
class RepoMother {
  static #unRemotoConSuClon(prefijo, issue) {
    const remote = mkdtempSync(join(tmpdir(), `${prefijo}-remote-`))
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: remote })

    const seed = mkdtempSync(join(tmpdir(), `${prefijo}-seed-`))
    const seedGit = (...a) => execFileSync('git', a, { cwd: seed, encoding: 'utf8' })
    seedGit('init', '-q', '-b', 'main')
    seedGit('config', 'user.email', 'coordinadora@x.z')
    seedGit('config', 'user.name', 'coordinadora')
    writeFileSync(join(seed, 'f.txt'), 'base\n')
    seedGit('add', '-A')
    seedGit('commit', '-qm', 'corte')
    seedGit('remote', 'add', 'origin', remote)
    seedGit('push', '-q', '-u', 'origin', 'main')

    const work = mkdtempSync(join(tmpdir(), `${prefijo}-work-`))
    execFileSync('git', ['clone', '-q', remote, '.'], { cwd: work })
    const workGit = (...a) => execFileSync('git', a, { cwd: work, encoding: 'utf8' })
    workGit('config', 'user.email', 'slice@x.z')
    workGit('config', 'user.name', 'slice')
    workGit('switch', '-q', '-c', `feat/${issue}`)

    return { remote, seed, work, seedGit, workGit }
  }

  static #laBaseAvanzaYElSliceLaMergea(seed, seedGit, workGit) {
    writeFileSync(join(seed, 'g.txt'), 'avance\n')
    seedGit('add', '-A')
    seedGit('commit', '-qm', 'la base avanza')
    seedGit('push', '-q', 'origin', 'main')

    workGit('fetch', '-q', 'origin', 'main')
    workGit('merge', '-q', '--no-edit', 'origin/main')
  }

  static #escribeElRunParadoEnGlobal(work, issue, baseSha) {
    writeFileSync(join(work, '.agent', `run-${issue}.json`), JSON.stringify({
      plan: 'docs/superpowers/plans/plan.md', issue, baseSha,
      task: 1, tasksTotal: 1, step: 'global',
      controlRetries: 0, judgeRetries: 0, correctionRetries: 0, discards: 0, spendUsd: 0,
    }, null, 2))
  }

  static #escribeElPlanYLaSemilla(work, issue) {
    mkdirSync(join(work, 'docs', 'superpowers', 'plans'), { recursive: true })
    writeFileSync(join(work, 'docs', 'superpowers', 'plans', 'plan.md'), planDeUnaTarea())
    mkdirSync(join(work, '.agent'), { recursive: true })
    writeFileSync(join(work, '.agent', 'SLICE.md'), `---\nissue: ${issue}\nbase: main\n---\n# s\n`)
  }

  // El corte congelado en `baseSha` coincide con el merge-base: el caso
  // degenerado en el que la única contaminación posible es la que trajo la
  // fusión.
  static aSliceThatMergedAnAdvancedBase(issue) {
    const { remote, seed, work, seedGit, workGit } = RepoMother.#unRemotoConSuClon('ct-step-mb', issue)
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim()

    RepoMother.#escribeElPlanYLaSemilla(work, issue)
    writeFileSync(join(work, 'work.txt'), 'trabajo\n')
    workGit('add', '-A')
    workGit('commit', '-qm', 'tarea 1')

    RepoMother.#laBaseAvanzaYElSliceLaMergea(seed, seedGit, workGit)
    RepoMother.#escribeElRunParadoEnGlobal(work, issue, baseSha)

    return { remote, seed, work }
  }

  // La secuencia de PRODUCCIÓN: el kickoff ordena commitear el plan («viaja
  // en el PR») y sólo DESPUÉS se pide el primer paso, que es cuando nace el
  // fichero del run con `baseSha = headSha()`. Así que hay un commit de la
  // rama ANTERIOR al run, y `baseSha` (P) NO es el merge-base (B).
  static aRunBornAfterThePlanCommit(issue) {
    const { remote, seed, work, seedGit, workGit } = RepoMother.#unRemotoConSuClon('ct-step-plan', issue)
    const cut = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim()

    RepoMother.#escribeElPlanYLaSemilla(work, issue)
    workGit('add', '-A')
    workGit('commit', '-qm', 'plan: la slice, planificada')
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim()

    writeFileSync(join(work, 'work.txt'), 'trabajo\n')
    workGit('add', '-A')
    workGit('commit', '-qm', 'tarea 1')

    RepoMother.#laBaseAvanzaYElSliceLaMergea(seed, seedGit, workGit)
    RepoMother.#escribeElRunParadoEnGlobal(work, issue, baseSha)

    return { remote, seed, work, cut, baseSha }
  }
}

const next = (cwd, issue) => spawnSync(process.execPath, [
  STEP, 'next', '--plan', 'docs/superpowers/plans/plan.md', '--issue', String(issue),
], { cwd, encoding: 'utf8' })

const limpia = (...dirs) => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) }

// ----------------------------------------------------------------------------
// Characterization test: pina el HECHO de git en crudo del que depende la
// guardia, sobre el grafo de producción. No ejecuta ct-step — documenta por
// qué la forma es la que es, no la sustituye.
// ----------------------------------------------------------------------------
describe('la cuenta de commits del run', () => {
  it('counts_neither_the_plan_commit_that_precedes_the_run_nor_what_the_merge_of_the_base_brought', () => {
    const { remote, seed, work, cut, baseSha } = RepoMother.aRunBornAfterThePlanCommit(99)
    const cuenta = (...a) => Number(execFileSync('git', ['rev-list', '--count', ...a], { cwd: work, encoding: 'utf8' }).trim())
    try {
      expect(cuenta(`${baseSha}..HEAD`)).toBe(3)
      expect(cuenta('--no-merges', `${cut}..HEAD`, '^origin/main')).toBe(2)
      expect(cuenta('--no-merges', `${baseSha}..HEAD`, '^origin/main')).toBe(1)
    } finally {
      limpia(work, seed, remote)
    }
  })
})

describe('ct-step — el run de un slice que mergeó su base avanzada', () => {
  const issue = 99

  it('a_run_paused_at_a_slice_step_after_merging_an_advanced_base_is_not_rejected_as_out_of_sync', () => {
    const { remote, seed, work } = RepoMother.aSliceThatMergedAnAdvancedBase(issue)
    try {
      const r = next(work, issue)
      expect(r.stderr).not.toMatch(/no cuentan lo mismo/)
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/GLOBAL VERIFICATION/)
    } finally {
      limpia(work, seed, remote)
    }
  })
})

// ----------------------------------------------------------------------------
// La red de regresión de Critical 1: la secuencia de producción, con un
// `origin/main` de verdad y el commit del plan ANTES de que nazca el fichero
// del run. Se pone en rojo en cuanto alguien vuelve a mover el origen de la
// cuenta al merge-base — ahí el commit del plan entra en el rango y `hechos`
// sale 2 contra 1 esperado.
// ----------------------------------------------------------------------------
describe('ct-step — el run nacido después del commit del plan', () => {
  const issue = 99

  it('the_plan_commit_made_before_the_run_was_born_is_not_counted_as_work_this_run_did', () => {
    const { remote, seed, work } = RepoMother.aRunBornAfterThePlanCommit(issue)
    try {
      const r = next(work, issue)
      expect(r.stderr).not.toMatch(/no cuentan lo mismo/)
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/GLOBAL VERIFICATION/)
    } finally {
      limpia(work, seed, remote)
    }
  })
})
