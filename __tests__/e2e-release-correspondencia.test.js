import { describe, it, expect } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { envDelGo } from './fixtures/go-gate.js'

const SCRIPT = fileURLToPath(new URL('../scripts/dispatch-check.mjs', import.meta.url))
const FAKE_GH = fileURLToPath(new URL('./fixtures/fake-gh-bin', import.meta.url))
const A = 'el server escucha en 9115 por defecto y en el puerto indicado si se pasa'

const cuerpo = (recorridos) => [
  '## Acceptance criteria (EARS, 1:1 con tests)',
  '- un criterio',
  '',
  '## Gates',
  '- **`plan`** — …',
  ...(recorridos.length ? ['', '## E2E', ...recorridos.map((r) => `- ${r}`)] : []),
  '',
].join('\n')

// FENCE/minimalPlanFor (Task 8, plan-contract.js): --release exige un plan
// prescriptivo commiteado en la rama que cumpla el contrato completo.
const FENCE = '```'
const planDeUnaTarea = (issue = 9) => [
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

// Worktree de slice con la tarea comiteada, el plan y el run ENTREGADO. Copiado
// de mkReleaseDryRunRepo (__tests__/dispatch-check-dryrun.test.js:117): los
// tests de este repo no se importan entre sí.
// `closed` NO lleva default por destructuring: `repo({ closed: undefined })`
// (el fixture del run NO entregado) debe producir un run-9.json SIN la clave
// "closed" — pero un default por destructuring se dispara igual quando el
// valor pasado es `undefined` explícito, no solo cuando la clave falta. Con
// `'closed' in opts` se distingue "no me han dado closed" (→ 'delivered',
// el caso feliz) de "me han dado closed: undefined a propósito" (→ se omite
// la clave del JSON, que es como luce un run que ct-step nunca cerró).
function repo(opts = {}) {
  const { e2eRuns = [A], contaminaEstado = false, e2eResults } = opts
  const closed = 'closed' in opts ? opts.closed : 'delivered'
  const dir = mkdtempSync(join(tmpdir(), 'ct-rel-corr-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'f.txt'), 'base\n'); git('add', '-A'); git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feat/9')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', '2026-08-12-issue-9-work.md'), planDeUnaTarea())
  writeFileSync(join(dir, 'work.txt'), 'trabajo\n')
  if (contaminaEstado) {
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\nrole: coordinadora\n---\n')
  }
  git('add', '-A'); git('commit', '-qm', 'work')
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), '---\nissue: 9\nbase: main\n---\n')
  const run = {
    plan: 'docs/superpowers/plans/2026-08-12-issue-9-work.md',
    issue: 9, baseSha: 'HEAD~1', task: 1, tasksTotal: 1, step: 'e2e',
    e2eRuns,
  }
  if (closed !== undefined) run.closed = closed
  // `e2eResults` sólo se escribe si el test lo pide: un run de una versión
  // anterior a la review final de rama no lo lleva, y esa ausencia también hay
  // que poder probarla.
  if (e2eResults !== undefined) run.e2eResults = e2eResults
  writeFileSync(join(dir, '.agent', 'run-9.json'), JSON.stringify(run, null, 2))
  return dir
}

// `go` (F38): el gate `plan` de la puerta 9 va CERRADO por defecto en este
// fichero, porque lo que aquí se prueba es la correspondencia del e2e y no el
// go. Los tests del go están en f38-el-go-del-gate-plan.test.js.
function release(dir, { body, viewFail = false, labels, go = true } = {}) {
  const log = join(dir, 'gh-argv.log')
  const r = spawnSync(process.execPath, [SCRIPT, '9', '--repo', 'o/r', '--release'], {
    cwd: dir, encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${FAKE_GH}:${process.env.PATH}`,
      FAKE_GH_ARGV_LOG_FILE: log,
      ...(body !== undefined ? { FAKE_GH_VIEW_BODY: body } : {}),
      ...(viewFail ? { FAKE_GH_VIEW_FAIL: '1' } : {}),
      FAKE_GH_VIEW_LABELS: JSON.stringify(labels || ['status:in-progress', 'gate:plan', 'gate:e2e']),
      ...(go ? envDelGo({ repo: 'o/r', issue: 9 }) : {}),
    },
  })
  return { ...r, argv: existsSync(log) ? readFileSync(log, 'utf8') : '' }
}

describe('--release: correspondencia entre el run y el issue', () => {
  it('run entregado que cubre los recorridos del issue → libera', () => {
    const dir = repo()
    try {
      const r = release(dir, { body: cuerpo([A]) })
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/released #9/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('issue con recorridos y run que NO los declara → exit 8, sin tocar labels', () => {
    const dir = repo({ e2eRuns: [] })
    try {
      const r = release(dir, { body: cuerpo([A]) })
      expect(r.status).toBe(8)
      expect(r.stderr).toContain(A)
      // La aserción que de verdad importa: NADA se mutó en GitHub.
      expect(r.argv).not.toMatch(/issue edit/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('cuerpo del issue ilegible → exit 8, y NO afirma que no haya recorridos', () => {
    const dir = repo()
    try {
      const r = release(dir, { viewFail: true })
      expect(r.status).toBe(8)
      expect(r.stderr).toMatch(/no se (ha podido|pudo)/i)
      expect(r.stderr).not.toMatch(/no declara recorridos/)
      expect(r.argv).not.toMatch(/issue edit/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('issue sin sección ## E2E → libera sin mirar el run', () => {
    const dir = repo({ e2eRuns: [] })
    try {
      expect(release(dir, { body: cuerpo([]) }).status).toBe(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('label gate:e2e sin sección → libera, con aviso por stderr', () => {
    const dir = repo({ e2eRuns: [] })
    try {
      const r = release(dir, { body: cuerpo([]) })
      expect(r.status).toBe(0)
      expect(r.stderr).toMatch(/aviso:/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // Las dos anteriores comparten la MISMA fixture de labels (siempre trae
  // "gate:e2e"), así que "sin label Y sin sección" nunca se ejercitaba solo
  // — el caso realmente silencioso: nada que verificar y nada que avisar.
  it('sin label gate:e2e y sin sección → libera, sin aviso', () => {
    const dir = repo({ e2eRuns: [] })
    try {
      const r = release(dir, { body: cuerpo([]), labels: ['status:in-progress', 'gate:plan'] })
      expect(r.status).toBe(0)
      expect(r.stderr).not.toMatch(/aviso:/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('el orden manda: una rama que introduce .agent/STATE.md sale 5, no 8', () => {
    const dir = repo({ e2eRuns: [], contaminaEstado: true })
    try {
      expect(release(dir, { body: cuerpo([A]) }).status).toBe(5)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // ==========================================================================
  // LOS *NO-VERIFICADOS*, DICHOS (review final de rama, Importante 3).
  //
  // Hasta esta ronda el run persistía sólo los NOMBRES de los recorridos, así
  // que esta puerta no distinguía un slice verde de otro cuyos recorridos
  // fueron todos "no-verificado" — y tres textos (run-machine.js#trasElE2e,
  // gates.js#GATES.e2e.issue y el §3.7 del diseño) prometían que --release "lo
  // dice". Es el estado que libera un slice SIN haberlo verificado: que sea
  // silencioso en la puerta es lo contrario de "un límite dicho es operable".
  // ==========================================================================
  it('un recorrido "no-verificado" en el run entregado → libera, y el aviso lo nombra con su motivo', () => {
    const dir = repo({ e2eResults: [{ run: A, verdict: 'no-verificado', reason: 'el docker de staging no arranca en esta máquina' }] })
    try {
      const r = release(dir, { body: cuerpo([A]) })
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/released #9/)
      expect(r.stderr).toMatch(/aviso:/)
      expect(r.stderr).toContain(A)
      expect(r.stderr).toContain('el docker de staging no arranca en esta máquina')
      expect(r.stderr).toMatch(/NO se pudieron comprobar/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('todos los recorridos en verde → libera sin ningún aviso de no-verificado', () => {
    const dir = repo({ e2eResults: [{ run: A, verdict: 'verde' }] })
    try {
      const r = release(dir, { body: cuerpo([A]) })
      expect(r.status).toBe(0)
      expect(r.stderr).not.toMatch(/NO se pudieron comprobar/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('un run sin `e2eResults` (versión anterior) → libera y no se inventa ningún veredicto', () => {
    const dir = repo()
    try {
      const r = release(dir, { body: cuerpo([A]) })
      expect(r.status).toBe(0)
      expect(r.stderr).not.toMatch(/NO se pudieron comprobar/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('run NO entregado → sale 7, la puerta que ya existía, no 8', () => {
    const dir = repo({ closed: undefined })
    try {
      expect(release(dir, { body: cuerpo([A]) }).status).toBe(7)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
