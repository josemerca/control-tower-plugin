import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { E2E_REQUIRED_BY_VERDICT } from '../scripts/step-contracts.js'

const STEP = new URL('../scripts/ct-step.mjs', import.meta.url).pathname
const A = 'el server escucha en 9115 por defecto y en el puerto indicado si se pasa'

// Un worktree de slice con UNA tarea ya comiteada y el run parado en `e2e`.
// La tarea comiteada importa: ct-step cruza los commits reales con el estado.
//
// `comiteaLaTarea: false` deja el trabajo STAGEADO en vez de comiteado: cero
// commits desde `baseSha`, que es la cuenta que el paso `commit` exige
// (`task - 1`, con `task: 1`). Es la única forma de ejercitar el paso `commit`
// de verdad con este fixture — ver el test "sin recorridos…", que durante toda
// la rama murió en PRECONDITION sin que nadie se enterara.
function worktreeEnE2e({ tasksTotal = 1, e2eRuns = [A], comiteaLaTarea = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-step-e2e-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'f.txt'), 'base\n'); git('add', '-A'); git('commit', '-qm', 'base')
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  git('checkout', '-qb', 'feat/4')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', 'plan.md'), planDeUnaTarea())
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), '---\nissue: 4\n---\n')
  git('add', '-A')
  if (comiteaLaTarea) git('commit', '-qm', 'tarea 1')
  writeFileSync(join(dir, '.agent', 'run-4.json'), JSON.stringify({
    plan: 'docs/superpowers/plans/plan.md', issue: 4, baseSha,
    task: tasksTotal, tasksTotal, e2eRuns, step: 'e2e',
    controlRetries: 0, judgeRetries: 0, correctionRetries: 0, discards: 0, spendUsd: 0,
  }, null, 2))
  return dir
}

// Un worktree de slice con la última tarea ya comiteada y el run parado en
// `reconcile` (Fase B, Tarea 8). A diferencia de `worktreeEnE2e`, aquí SÍ
// hace falta un `origin` de verdad: `verboReconcile` habla con git —
// `BranchReconciliation.merge` hace `git fetch origin <rama>` y mide cuántos
// commits trae— así que sin remoto real no hay "base sin mover" que probar.
// El `origin` es un bare que arranca en el mismo commit que `HEAD` y no se
// vuelve a tocar: eso ES "la base no se ha movido", sin necesidad de fingir
// nada más.
function worktreeEnReconcile({ tasksTotal = 1 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-step-reconcile-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'f.txt'), 'base\n'); git('add', '-A'); git('commit', '-qm', 'base')
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  const origin = mkdtempSync(join(tmpdir(), 'ct-step-reconcile-origin-'))
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { stdio: 'ignore' })
  git('remote', 'add', 'origin', origin)
  git('push', '-q', 'origin', 'main')
  git('checkout', '-qb', 'feat/4')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', 'plan.md'), planDeUnaTarea())
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), '---\nissue: 4\n---\n')
  writeFileSync(join(dir, 'work.txt'), 'trabajo\n')
  git('add', '-A')
  git('commit', '-qm', 'tarea 1')
  writeFileSync(join(dir, '.agent', 'run-4.json'), JSON.stringify({
    plan: 'docs/superpowers/plans/plan.md', issue: 4, baseSha,
    task: tasksTotal, tasksTotal, e2eRuns: [], step: 'reconcile',
    controlRetries: 0, judgeRetries: 0, correctionRetries: 0, reconcileRetries: 0,
    discards: 0, spendUsd: 0,
  }, null, 2))
  return dir
}

// Un worktree de slice SIN run-<issue>.json todavía: es el único camino que
// pasa por `newRun` (ver `else` de la carga del estado en ct-step.mjs), y por
// tanto el único que puede probar que el lector de `.agent/SLICE.md` de
// verdad alimenta `e2eRuns` — el helper de arriba siembra el run a mano y no
// pasa nunca por ahí.
function worktreeNuevo({ e2eYaml = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-step-nuevo-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'f.txt'), 'base\n'); git('add', '-A'); git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feat/4')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', 'plan.md'), planDeUnaTarea())
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), `---\nissue: 4\n${e2eYaml}---\n`)
  git('add', '-A'); git('commit', '-qm', 'setup')
  return dir
}

// El plan mínimo que plan-contract.js acepta y plan-tasks.js sabe trocear, con
// UNA tarea y su bloque **Verification:**. Es el `minimalPlanFor` de
// __tests__/dispatch-check-dryrun.test.js:73, copiado (no importado: los tests
// de este repo no se importan entre sí) y fijado al issue 4.
const FENCE = '```'
const planDeUnaTarea = () => [
  '# #4 — fixture slice',
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
  // El `minimalPlanFor` original de dispatch-check-dryrun.test.js escribe
  // `**Files:** work.txt` sin backticks, y ese plan nunca pasa por
  // `plan-tasks.js#splitFiles` (dispatch-check.mjs usa plan-contract.js, con
  // otra tolerancia). ct-step SÍ pasa por `extractTasks` en cada invocación —
  // incluida `next`, antes de mirar el verbo — y `splitFiles` sólo reconoce
  // rutas entre backticks: sin ellas, TODA llamada muere con
  // PLAN_NOT_EXECUTABLE (exit 6) antes de que el test llegue a ejercitar nada
  // de `e2e`. Es la advertencia del brief de "arreglar el harness antes de
  // implementar" hecha carne.
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

const step = (dir, args) => spawnSync(process.execPath, [STEP, ...args, '--plan', 'docs/superpowers/plans/plan.md', '--issue', '4'], { cwd: dir, encoding: 'utf8' })
const informe = (dir, obj) => { const p = join(dir, 'informe.json'); writeFileSync(p, JSON.stringify(obj)); return 'informe.json' }

const VERDE = { runs: [{ run: A, verdict: 'verde', brought_up: 'cargo run --example serve', evidence: [{ command: 'curl -sS localhost:9115/metrics', output: '# HELP x' }] }] }
const ROJO = { runs: [{ run: A, verdict: 'rojo', brought_up: 'cargo run --example serve', expected: '200', actual: '404', repro: 'curl -i localhost:9115/metrics', refuted_by: 'otro proceso en el puerto' }] }

describe('ct-step e2e', () => {
  it('en verde: exit 0, run delivered y el markdown escrito y COMITEADO', () => {
    const dir = worktreeEnE2e()
    try {
      const r = step(dir, ['e2e', informe(dir, VERDE)])
      expect(r.status).toBe(0)
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.closed).toBe('delivered')
      const md = join(dir, 'docs', 'superpowers', 'e2e', '4.md')
      expect(existsSync(md)).toBe(true)
      expect(readFileSync(md, 'utf8')).toContain(A)
      // Finding 3 de la review de Task 8: DELIVERED comitea el informe, no
      // sólo lo stagea — si se quedara sólo stageado, las commits que la
      // sesión empuja no lo llevarían y la evidencia nunca llegaría a la pull
      // request. `git diff --cached` vacío demuestra que ya no está en el
      // índice (se comiteó); `git show HEAD --name-only` demuestra que SÍ
      // está en el último commit.
      const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' })
      expect(staged).not.toContain('docs/superpowers/e2e/4.md')
      const enElCommit = execFileSync('git', ['show', '--name-only', '--pretty=', 'HEAD'], { cwd: dir, encoding: 'utf8' })
      expect(enElCommit).toContain('docs/superpowers/e2e/4.md')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // El veredicto de cada recorrido se PERSISTE (review final de rama): sin él,
  // la puerta 8 de `dispatch-check --release` no puede distinguir un slice
  // verde de otro cuyos recorridos fueron todos "no-verificado" — y tres
  // textos prometían que --release "lo dice". La forma es la mínima que
  // sostiene ese aviso: recorrido -> veredicto, más `reason` donde lo hay.
  it('el run persiste el veredicto de cada recorrido, con su motivo cuando es no-verificado', () => {
    const dir = worktreeEnE2e()
    try {
      const SIN_VERIFICAR = { runs: [{ run: A, verdict: 'no-verificado', reason: 'la sección de AGENTS.md está sin rellenar', unblock: 'rellenar "Levantar" y "Listo cuando"' }] }
      const r = step(dir, ['e2e', informe(dir, SIN_VERIFICAR)])
      expect(r.status).toBe(0) // el no-verificado ENTREGA
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.closed).toBe('delivered')
      expect(run.e2eResults).toEqual([{ run: A, verdict: 'no-verificado', reason: 'la sección de AGENTS.md está sin rellenar' }])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('en verde, el veredicto persistido no lleva `reason` (no hay motivo que dar)', () => {
    const dir = worktreeEnE2e()
    try {
      expect(step(dir, ['e2e', informe(dir, VERDE)]).status).toBe(0)
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.e2eResults).toEqual([{ run: A, verdict: 'verde' }])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('en rojo: exit 7, run blocked-e2e, NO delivered, y el informe STAGEADO pero NO comiteado', () => {
    const dir = worktreeEnE2e()
    try {
      const r = step(dir, ['e2e', informe(dir, ROJO)])
      expect(r.status).toBe(7)
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.closed).not.toBe('delivered')
      // El rojo NO cierra el run, así que no comitea: comitear aquí subiría
      // `hechos` por encima de `esperados` (= tasksTotal en el paso e2e) y
      // tumbaría el PRÓXIMO intento con PRECONDITION antes de que nadie
      // llegara a arreglar el fallo. El informe se queda stageado como
      // prueba de que está esperando a quien lo arregle.
      const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' })
      expect(staged).toContain('docs/superpowers/e2e/4.md')
      const enElCommit = execFileSync('git', ['show', '--name-only', '--pretty=', 'HEAD'], { cwd: dir, encoding: 'utf8' })
      expect(enElCommit).not.toContain('docs/superpowers/e2e/4.md')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('fuera de su paso: exit 9 y dice cuál toca', () => {
    const dir = worktreeEnE2e()
    try {
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      // `task: 2, tasksTotal: 2` y no `task: 1` (que sería el `task` real de
      // este fixture con `tasksTotal: 1`): hay UN commit desde `baseSha`
      // (worktreeEnE2e comitea una sola vez, la "tarea 1"), así que fuera del
      // paso `e2e` la invariante exige `task - 1 === 1`. `task: 2` sin subir
      // `tasksTotal` cuadraría la cuenta pero describiría "tarea 2 de 1", un
      // estado que `run-machine.js#trasElCommit` nunca produce: `task` no
      // avanza más allá de `tasksTotal` (al comitear la última entra en E2E o
      // cierra DELIVERED). Con `tasksTotal: 2` este es de verdad "trabajando
      // en la segunda de dos tareas" — el estado real que el guard protege.
      // Con `task: 1` (el valor original) el propio guard de PRECONDITION
      // dispara antes de llegar a `exigirPaso` — correcto para ESE control,
      // pero no es lo que este test quiere ejercitar.
      writeFileSync(join(dir, '.agent', 'run-4.json'), JSON.stringify({ ...run, step: 'implement', task: 2, tasksTotal: 2 }))
      const r = step(dir, ['e2e', informe(dir, VERDE)])
      expect(r.status).toBe(9)
      expect(r.stderr).toMatch(/implement/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('el JSON ilegible es un descarte, no un error de uso', () => {
    const dir = worktreeEnE2e()
    try {
      writeFileSync(join(dir, 'roto.json'), '{no es json')
      const r = step(dir, ['e2e', 'roto.json'])
      expect(r.status).toBe(0)
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.discards).toBe(1)
      expect(run.step).toBe('e2e')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('`next` en el paso e2e dice qué se espera y cita el esquema ENTERO (incluidos los campos por veredicto)', () => {
    const dir = worktreeEnE2e()
    try {
      const r = step(dir, ['next'])
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/e2e/)
      expect(r.stdout).toContain(A)
      // La sección de AGENTS.md se nombra, no se alude (§3.3 del diseño).
      expect(r.stdout).toContain('## Cómo se atraviesa este repo (e2e)')
      expect(r.stdout).toMatch(/E2E_SCHEMA/)
      // El contrato condicional, que es el que `readE2eReport` exige de verdad:
      // anunciar sólo "run y verdict" costaba una vuelta de DISCARDED por
      // slice. Se comprueba contra la MISMA tabla que valida, no contra una
      // lista tecleada aquí — dos copias divergen.
      for (const [veredicto, campos] of Object.entries(E2E_REQUIRED_BY_VERDICT)) {
        expect(r.stdout, veredicto).toContain(`${veredicto}: ${campos.join(', ')}`)
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // Este test PASABA por el motivo equivocado, y la review final de rama lo
  // reprodujo: con la tarea ya comiteada, `ct-step commit` moría en
  // PRECONDITION (exit 8, "el estado y git no cuentan lo mismo") porque fuera
  // del paso `e2e` la invariante exige `commits === task - 1` y aquí había uno
  // de más. `run-4.json` no se reescribía nunca, así que `after.step` era el
  // 'commit' que el propio test acababa de escribir y la aserción era
  // trivialmente cierta sobre un fichero que nadie había tocado. El exit code
  // no se comprobaba, y la segunda mitad del título ("y `next` no lo pide") no
  // se ejercitaba en absoluto.
  //
  // Con el trabajo stageado y sin comitear, la cuenta cuadra (`task: 1`, cero
  // commits desde base), el commit ocurre de verdad, y la transición que se
  // prueba es la que interesa: última tarea comiteada + `e2eRuns` vacío NO
  // pasa por `e2e`.
  //
  // Lo que este test afirmaba antes —que ahí mismo el run cerraba en
  // DELIVERED— dejó de ser cierto al converger con la fase GLOBAL/SLICE_JUDGE
  // (§3.7), que se metió entre el último commit y la entrega. La propiedad de
  // ESTA feature no cambia y es la que se sigue clavando: sin recorridos, el
  // paso `e2e` no aparece en ningún punto de la cola, ni en el estado ni en lo
  // que `next` pide. El cierre en DELIVERED lo prueban los tests de la fase
  // global, que es de quien es ahora.
  it('sin recorridos, el run no entra nunca en e2e (y `next` no lo pide)', () => {
    const dir = worktreeEnE2e({ e2eRuns: [], comiteaLaTarea: false })
    try {
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      // Slice 12: `commit` exige el sello que el veredicto deja al aceptarse, y
      // este fixture siembra el estado a mano — así que también siembra el sello.
      // Es el árbol del índice de AHORA, que es lo que ese commit se va a llevar:
      // lo mismo que `verboVerdict` sella tras stagear el veredicto.
      const sealedTree = execFileSync('git', ['write-tree'], { cwd: dir, encoding: 'utf8' }).trim()
      writeFileSync(join(dir, '.agent', 'run-4.json'), JSON.stringify({ ...run, step: 'commit', sealedTree }))
      const r = step(dir, ['commit'])
      expect(r.status).toBe(0)
      const after = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(after.step).not.toBe('e2e')
      // Fase B (Tarea 8): la última tarea comiteada abre RECONCILE, no GLOBAL
      // directamente — la rama tiene que quedar al día con su base antes de
      // que la punta a punta la mida.
      expect(after.step).toBe('reconcile')
      // Y `next` tampoco lo pide: pide reconciliar la base, no una travesía.
      const n = step(dir, ['next'])
      expect(n.status).toBe(0)
      expect(n.stdout).toMatch(/RECONCILIA LA RAMA/)
      expect(n.stdout).not.toMatch(/e2e/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // LA ADICIÓN QUE EL BRIEF NO CUBRE: `newRun` recibe `e2eRuns`, pero nada en
  // el brief prueba que ct-step de verdad los LEA de algún sitio. Los seis
  // tests de arriba siembran `run-<issue>.json` a mano (helper
  // `worktreeEnE2e`), así que ninguno pasa por la rama `else` que crea el run
  // — el único camino que llama a `newRun`. Estos dos sí.
  it('un run nuevo lee los recorridos de .agent/SLICE.md (el único camino que llama a newRun)', () => {
    const dir = worktreeNuevo({ e2eYaml: 'e2e:\n  - uno\n  - dos\n' })
    try {
      const r = step(dir, ['next'])
      expect(r.status).toBe(0)
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.e2eRuns).toEqual(['uno', 'dos'])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('sin campo `e2e` en SLICE.md, el run nuevo nace con e2eRuns: [] (no undefined)', () => {
    const dir = worktreeNuevo()
    try {
      const r = step(dir, ['next'])
      expect(r.status).toBe(0)
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.e2eRuns).toEqual([])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

// Fase B, Tarea 8 — el verbo `reconcile`, idempotente por MERGE_HEAD.
describe('ct-step reconcile', () => {
  it('con la base sin mover, avanza a global sin crear ningún commit', () => {
    const dir = worktreeEnReconcile()
    try {
      const antes = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
      const r = step(dir, ['reconcile'])
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/up-to-date/)
      const despues = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
      expect(despues).toBe(antes) // ninguna ronda de reconcile comitea nada aquí
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.step).toBe('global')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // Ruling 2 del brief: RECONCILE es un paso de la SLICE, no de una tarea —
  // si `PASOS_DE_SLICE` no lo supiera, el estado y git no cuadrarían al
  // cargar el run y CUALQUIER verbo (incluido este `global`) moriría en
  // PRECONDITION antes de llegar siquiera a mirar el paso. Este test también
  // sirve de red para esa regresión (ver Step 5 del brief).
  it('`global` fuera de su paso (el run está en reconcile) sale por 9 nombrando "reconcile"', () => {
    const dir = worktreeEnReconcile()
    try {
      const r = step(dir, ['global'])
      expect(r.status).toBe(9)
      expect(r.stderr).toMatch(/reconcile/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
