// ============================================================================
// Reconciliación de ramas, tarea 2 — las puertas de --release miden desde el
// merge-base, no desde el corte congelado en la semilla.
//
// La geometría real: un worktree de slice se corta de `origin/main` en un
// commit S (`base_sha:` lo congela ahí, para siempre — no se reescribe). Si
// la sesión coordinadora avanza `main` DESPUÉS del corte (p. ej. actualiza
// `.agent/STATE.md`, el estado que la propia doctrina de F22 dice que ningún
// PR de slice puede introducir) y el slice hace `git merge origin/main` en
// algún punto de su trabajo, ese commit de STATE.md entra en la historia de
// la rama del slice. Medir `base_sha:...HEAD` (el corte) ve ese cambio como
// si lo hubiera escrito el slice: falso positivo, exit 5, el slice no se
// libera por un fichero que nunca tocó. Medir `merge-base HEAD
// origin/main...HEAD` no lo ve: el merge-base es el propio commit que trajo
// STATE.md, así que STATE.md ya está en el punto de comparación.
//
// Se ejercen las DOS funciones de dispatch-check.mjs invocando el script de
// verdad (spawnSync sobre `--release --dry-run`), no midiendo git a mano —
// conventions/testing.md: el observable es el gate, no su implementación. El
// arranque del mundo (el repo, el remoto, el merge) sí usa git de verdad,
// pero nunca invocando dispatch-check para construirlo.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { envDelGo } from './fixtures/go-gate.js'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'dispatch-check.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']

const FENCE = '```'
const minimalPlanFor = (issue) => [
  `# #${issue} — fixture slice`,
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
  '**Files:** work.txt',
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

const planCitingFoo = (issue, fooContent) => [
  `# #${issue} — fixture slice`,
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
  'foo.txt, work.txt',
  '## 5. Interfaces',
  'Consumes: N/A. Produces: N/A.',
  '## 6. Test strategy',
  'N/A — fixture.',
  '## 7. Tasks',
  '### Task 1 — do the work',
  '**Objective:** the work is committed, citing the base state of foo.txt.',
  '**Files:** foo.txt, work.txt',
  'Current state (foo.txt):',
  FENCE,
  fooContent,
  FENCE,
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

// RepoMother — monta el mundo con `git` de verdad. NUNCA llama a
// dispatch-check.mjs para construir el arrange: eso mediría la pieza bajo
// prueba con la pieza bajo prueba.
class RepoMother {
  static aSliceThatMergedAnAdvancedBase(issue) {
    const remote = mkdtempSync(join(tmpdir(), 'ct-mb-remote-'))
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: remote })

    const seed = mkdtempSync(join(tmpdir(), 'ct-mb-seed-'))
    const seedGit = (...a) => execFileSync('git', a, { cwd: seed, encoding: 'utf8' })
    seedGit('init', '-q', '-b', 'main')
    seedGit('config', 'user.email', 'coordinadora@x.z')
    seedGit('config', 'user.name', 'coordinadora')
    mkdirSync(join(seed, '.agent'), { recursive: true })
    writeFileSync(join(seed, '.agent', 'STATE.md'), '---\ntask: el epic\n---\n# estado v1\n')
    writeFileSync(join(seed, 'f.txt'), 'base\n')
    seedGit('add', '-A')
    seedGit('commit', '-qm', 'corte')
    seedGit('remote', 'add', 'origin', remote)
    seedGit('push', '-q', '-u', 'origin', 'main')
    const cutSha = seedGit('rev-parse', 'HEAD').trim()

    const work = mkdtempSync(join(tmpdir(), 'ct-mb-work-'))
    execFileSync('git', ['clone', '-q', remote, '.'], { cwd: work })
    const workGit = (...a) => execFileSync('git', a, { cwd: work, encoding: 'utf8' })
    workGit('config', 'user.email', 'slice@x.z')
    workGit('config', 'user.name', 'slice')
    workGit('switch', '-q', '-c', `feat/${issue}`)

    mkdirSync(join(work, 'docs', 'superpowers', 'plans'), { recursive: true })
    writeFileSync(join(work, 'docs', 'superpowers', 'plans', `2026-08-28-issue-${issue}-work.md`), minimalPlanFor(issue))
    writeFileSync(join(work, 'work.txt'), 'trabajo\n')
    workGit('add', '-A')
    workGit('commit', '-qm', 'work')

    // La coordinadora avanza `main` DESPUÉS del corte: actualiza su propio
    // estado. El slice nunca escribió esto.
    writeFileSync(join(seed, '.agent', 'STATE.md'), '---\ntask: el epic\n---\n# estado v2\n')
    seedGit('add', '-A')
    seedGit('commit', '-qm', 'la coordinadora avanza')
    seedGit('push', '-q', 'origin', 'main')

    // El slice hace merge de esa base avanzada — el vector que reconciliar
    // ramas viene a arreglar.
    workGit('fetch', '-q', 'origin', 'main')
    workGit('merge', '-q', '--no-edit', 'origin/main')

    mkdirSync(join(work, '.agent'), { recursive: true })
    writeFileSync(join(work, '.agent', 'SLICE.md'), `---\ntask: slice\nbase: main\nbase_sha: ${cutSha}\n---\n# s\n`)
    writeFileSync(join(work, '.agent', `run-${issue}.json`), JSON.stringify({
      plan: `docs/superpowers/plans/2026-08-28-issue-${issue}-work.md`,
      issue, task: 1, tasksTotal: 1, step: 'commit', closed: 'delivered',
    }))

    return { remote, seed, work, cutSha }
  }

  // Fix round 1, Importante 2 — el escenario que le falta a la clase de
  // arriba: aquí NADA toca `.agent/STATE.md` (la puerta de ficheros de
  // estado nunca puede morder), así que la única forma de que el release
  // falle es que la validación del PLAN mida el fichero citado contra la
  // referencia equivocada. `foo.txt` existe en el corte con un contenido, el
  // plan lo cita verbatim con ESE contenido, y la base avanza cambiándolo
  // ANTES de que el slice haga merge — si `readFileAtBase` leyera desde
  // `measurementRef` (el merge-base) en vez de desde el corte, la cita
  // saldría "de memoria" porque el contenido de hoy ya no es el citado.
  static aSliceWhoseCitedFileWasChangedByTheMergedBase(issue, { cutContent, newContent }) {
    const remote = mkdtempSync(join(tmpdir(), 'ct-mb-cite-remote-'))
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: remote })

    const seed = mkdtempSync(join(tmpdir(), 'ct-mb-cite-seed-'))
    const seedGit = (...a) => execFileSync('git', a, { cwd: seed, encoding: 'utf8' })
    seedGit('init', '-q', '-b', 'main')
    seedGit('config', 'user.email', 'coordinadora@x.z')
    seedGit('config', 'user.name', 'coordinadora')
    writeFileSync(join(seed, 'foo.txt'), cutContent)
    seedGit('add', '-A')
    seedGit('commit', '-qm', 'corte')
    seedGit('remote', 'add', 'origin', remote)
    seedGit('push', '-q', '-u', 'origin', 'main')
    const cutSha = seedGit('rev-parse', 'HEAD').trim()

    const work = mkdtempSync(join(tmpdir(), 'ct-mb-cite-work-'))
    execFileSync('git', ['clone', '-q', remote, '.'], { cwd: work })
    const workGit = (...a) => execFileSync('git', a, { cwd: work, encoding: 'utf8' })
    workGit('config', 'user.email', 'slice@x.z')
    workGit('config', 'user.name', 'slice')
    workGit('switch', '-q', '-c', `feat/${issue}`)

    mkdirSync(join(work, 'docs', 'superpowers', 'plans'), { recursive: true })
    writeFileSync(join(work, 'docs', 'superpowers', 'plans', `2026-08-28-issue-${issue}-work.md`), planCitingFoo(issue, cutContent))
    writeFileSync(join(work, 'work.txt'), 'trabajo\n')
    workGit('add', '-A')
    workGit('commit', '-qm', 'work')

    // La base avanza y CAMBIA el fichero que el plan citó contra el corte.
    writeFileSync(join(seed, 'foo.txt'), newContent)
    seedGit('add', '-A')
    seedGit('commit', '-qm', 'la base cambia foo.txt')
    seedGit('push', '-q', 'origin', 'main')

    workGit('fetch', '-q', 'origin', 'main')
    workGit('merge', '-q', '--no-edit', 'origin/main')

    mkdirSync(join(work, '.agent'), { recursive: true })
    writeFileSync(join(work, '.agent', 'SLICE.md'), `---\ntask: slice\nbase: main\nbase_sha: ${cutSha}\n---\n# s\n`)
    writeFileSync(join(work, '.agent', `run-${issue}.json`), JSON.stringify({
      plan: `docs/superpowers/plans/2026-08-28-issue-${issue}-work.md`,
      issue, task: 1, tasksTotal: 1, step: 'commit', closed: 'delivered',
    }))

    return { remote, seed, work, cutSha }
  }
}

const release = (issue, cwd) => spawnSync(process.execPath, [SCRIPT, String(issue), '--repo', 'o/r', '--release', '--dry-run'], {
  cwd,
  encoding: 'utf8',
  stdio: QUIET_STDIO,
  env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...envDelGo({ repo: 'o/r', issue }) },
})

describe('dispatch-check --release — la medida del diff es el merge-base, no el corte (reconciliación de ramas, tarea 2)', () => {
  const issue = 91
  let world

  beforeEach(() => { world = RepoMother.aSliceThatMergedAnAdvancedBase(issue) })
  afterEach(() => {
    for (const d of [world.work, world.remote, world.seed]) rmSync(d, { recursive: true, force: true })
  })

  it('a_branch_that_merged_its_base_does_not_report_the_files_that_merge_brought_as_its_own', () => {
    const r = release(issue, world.work)

    // Con el corte congelado (`base_sha:`) como medida, esto salía exit 5:
    // ".agent/STATE.md" contado como introducido por el slice. Con el
    // merge-base, el slice se libera — el gate no le atribuye el fichero
    // que trajo el merge.
    expect((r.stderr || '')).not.toContain('.agent/STATE.md')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(new RegExp(`released #${issue}.*in-review`))
  })

  // Characterization test (permitido explícitamente): pina el HECHO de git
  // en crudo que explica por qué hace falta el cambio de arriba. No
  // sustituye al test del gate — documenta la causa.
  it('the_cut_recorded_in_the_seed_would_have_reported_the_foreign_file_as_the_slices_own', () => {
    const diffFrom = (ref) => execFileSync(
      'git',
      ['diff', '--no-relative', '--no-renames', '--name-only', `${ref}...HEAD`],
      { cwd: world.work, encoding: 'utf8' },
    ).split('\n').filter(Boolean)

    const mergeBase = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: world.work, encoding: 'utf8' }).trim()

    expect(diffFrom(world.cutSha)).toContain('.agent/STATE.md')
    expect(diffFrom(mergeBase)).not.toContain('.agent/STATE.md')
  })
})

// ============================================================================
// Fix round 1, Importante 2 — la mitad de la propiedad que el round anterior
// dejó sin red: `branchIntroducedFiles()` mide lo que la rama aporta desde
// `measurementRef` (el merge-base), pero las CITAS del plan tienen que
// seguir leyéndose desde `cut` (el corte real) — `readFileAtBase(plan.cut)`.
// Si alguien revirtiera eso a `readFileAtBase(plan.measurementRef)` (el
// exacto falso positivo que `base_sha:` existe para cerrar), el escenario de
// arriba no lo detectaría: su único fichero ajeno es `.agent/STATE.md`, que
// muere en la puerta de ESTADO (exit 5) antes de que el plan se valide
// siquiera. Aquí NADA toca `.agent/STATE.md`: la única puerta que puede
// morder es la del plan.
// ============================================================================
describe('dispatch-check --release — las citas del plan se leen contra el corte, no contra el merge-base (fix round 1, Importante 2)', () => {
  const issue = 92
  const cutContent = 'valor del corte\n'
  const newContent = 'valor nuevo tras el merge\n'
  let world

  beforeEach(() => {
    world = RepoMother.aSliceWhoseCitedFileWasChangedByTheMergedBase(issue, { cutContent, newContent })
  })
  afterEach(() => {
    for (const d of [world.work, world.remote, world.seed]) rmSync(d, { recursive: true, force: true })
  })

  it('a_plan_citation_written_against_the_cut_is_not_invalidated_by_a_file_the_merged_base_later_changed', () => {
    const r = release(issue, world.work)

    // Con `readCitedFile` apuntando al merge-base, "Current state (foo.txt):"
    // citaría `cutContent`, pero foo.txt en el merge-base ya vale
    // `newContent` — el contrato lo acusaría de "cita de memoria" (exit 6).
    // Contra el corte, el contenido citado SIGUE siendo el real: el release
    // no debe quejarse del plan.
    expect((r.stderr || '')).not.toContain('cita de memoria')
    expect((r.stderr || '')).not.toContain('no existe en la base')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(new RegExp(`released #${issue}.*in-review`))
  })

  // Characterization test: pina en crudo que foo.txt de verdad difiere entre
  // el corte y el merge-base — la premisa que hace el test de arriba
  // significativo. No sustituye al test del gate.
  it('the_cited_file_really_does_differ_between_the_cut_and_the_merge_base', () => {
    const atRef = (ref) => execFileSync('git', ['show', `${ref}:foo.txt`], { cwd: world.work, encoding: 'utf8' })
    const mergeBase = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: world.work, encoding: 'utf8' }).trim()

    expect(atRef(world.cutSha)).toBe(cutContent)
    expect(atRef(mergeBase)).toBe(newContent)
  })
})
