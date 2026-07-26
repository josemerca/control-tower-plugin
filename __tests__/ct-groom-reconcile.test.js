import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// F5 — el groom detecta divergencia, no solo existencia. Este fichero cubre
// la CORRIDA REAL (mutadora, sin --dry-run) contra un `gh` de mentira: el
// comportamiento por defecto (detecta y reporta, no toca nada) y el opt-in
// --reconcile (aplica lo detectado vía `gh issue edit`, con la misma
// convención de abort-fuerte-ante-fallo-de-gh que ya usa el resto de este
// fichero para milestones/labels/project). Los tests de --dry-run (mismo
// reporte, cero mutación) viven en ct-groom-dryrun.test.js.

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')

const ONE_SLICE_SPEC = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema | api | db |
`

// El plan que ONE_SLICE_SPEC produce hoy (verificado contra groom.js):
// title "#1 login", labels ['type:backend','area:api','touches:db','status:backlog'],
// milestone "Epic" (--milestone por defecto).

function writeSpec(content) {
  const dir = mkdtempSync(join(tmpdir(), 'ctg-reconcile-'))
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, content)
  return { dir, spec }
}

function run(args, envOverrides = {}) {
  return spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...envOverrides },
  })
}

// Issue existente que diverge en título, milestone Y labels a la vez (missing
// area:/touches:, milestone distinto, título distinto) — un solo fixture que
// ejercita las tres clases de campo en la misma corrida, más status:in-progress
// (nunca debe reportarse ni tocarse).
const EXISTING_ISSUE_DRIFT = {
  number: 501,
  title: '#1 iniciar sesión',
  state: 'open',
  milestone: { title: 'Sprint 1' },
  labels: [{ name: 'type:backend' }, { name: 'status:in-progress' }],
  body: 'cuerpo cualquiera del issue\n<!-- ct-order:1 -->',
}

const BASE_ENV = {
  FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
  FAKE_GH_LIST_SEQUENCE: JSON.stringify([[EXISTING_ISSUE_DRIFT]]),
}

describe('ct-groom (corrida real) — detecta divergencia por defecto, no la aplica (F5)', () => {
  it('reporta título/milestone/labels divergentes por stderr, NUNCA llama a `gh issue edit`, exit 3', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], { ...BASE_ENV, FAKE_GH_ARGV_LOG_FILE: argvLog })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/divergencia.*slice #1.*issue #501/)
    expect(res.stderr).toMatch(/t.tulo difiere/i)
    expect(res.stderr).toMatch(/"#1 iniciar sesión"/)
    expect(res.stderr).toMatch(/"#1 login"/)
    expect(res.stderr).toMatch(/milestone difiere/)
    expect(res.stderr).toMatch(/"Sprint 1"/)
    expect(res.stderr).toMatch(/falta la label "area:api"/)
    expect(res.stderr).toMatch(/falta la label "touches:db"/)
    expect(res.stderr).not.toMatch(/status:in-progress/) // label ajena al namespace que el spec compara
    expect(res.stdout).toMatch(/ya existe \(#501\), no se duplica/) // el mensaje de idempotencia de siempre sigue ahí
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/) // sin --reconcile, jamás se muta el issue
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin ninguna divergencia (issue existente ya coincide) → exit 0, sin líneas de "divergencia"', () => {
    const MATCHING_ISSUE = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'status:in-progress' }],
      body: '<!-- ct-order:1 -->',
    }
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[MATCHING_ISSUE]]),
    })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/divergencia/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('issue cerrado sin ninguna otra divergencia → silencio total sobre el cierre, exit 0', () => {
    const CLOSED_MATCHING = {
      number: 501,
      title: '#1 login',
      state: 'closed',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      body: '<!-- ct-order:1 -->',
    }
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[CLOSED_MATCHING]]),
    })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/cerrad/i)
    rmSync(dir, { recursive: true, force: true })
  })

  it('issue cerrado CON divergencia → añade la nota de "cerrado" avisando antes de --reconcile, exit 3', () => {
    const CLOSED_DRIFT = { ...EXISTING_ISSUE_DRIFT, state: 'closed', milestone: { title: 'Epic' }, labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }] }
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[CLOSED_DRIFT]]),
    })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/t.tulo difiere/i)
    expect(res.stderr).toMatch(/cerrad.*reconcile/is)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom (corrida real) --reconcile — aplica lo detectado vía `gh issue edit` (F5)', () => {
  it('aplica título + milestone + labels en una sola llamada a `gh issue edit`, exit 0', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], { ...BASE_ENV, FAKE_GH_ARGV_LOG_FILE: argvLog })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/reconciliado/)
    const log = readFileSync(argvLog, 'utf8')
    const editLine = log.split('\n').find((l) => l.startsWith('issue edit 501'))
    expect(editLine).toBeTruthy()
    expect(editLine).toMatch(/--repo o\/r/)
    expect(editLine).toMatch(/--title #1 login/)
    expect(editLine).toMatch(/--milestone Epic/)
    expect(editLine).toMatch(/--add-label area:api/)
    expect(editLine).toMatch(/--add-label touches:db/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--reconcile sobre un slice SIN divergencia no llama a `gh issue edit` para ese slice (nada que aplicar)', () => {
    const MATCHING_ISSUE = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      body: '<!-- ct-order:1 -->',
    }
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[MATCHING_ISSUE]]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.status).toBe(0)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('issue cerrado + --reconcile: igual se aplica el edit (gh issue edit no reabre el issue)', () => {
    const CLOSED_DRIFT = { ...EXISTING_ISSUE_DRIFT, state: 'closed' }
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[CLOSED_DRIFT]]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.status).toBe(0)
    const log = readFileSync(argvLog, 'utf8')
    expect(log).toMatch(/issue edit 501/)
    rmSync(dir, { recursive: true, force: true })
  })

  // Convención ya establecida en este fichero (milestones/labels/project): un
  // fallo de `gh` nunca es benigno — abortamos con mensaje claro en vez de
  // seguir a ciegas. FAKE_GH_EDIT_FAIL_SUBSTR simula que el `gh issue edit`
  // de este issue concreto falla (auth, red, rate limit...).
  it('--reconcile: si `gh issue edit` falla, aborta con exit 1 y mensaje claro — nunca sigue a ciegas', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], { ...BASE_ENV, FAKE_GH_EDIT_FAIL_SUBSTR: 'issue edit 501' })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/no se pudo reconciliar el issue #501/)
    expect(res.stdout).not.toMatch(/reconciliado/) // nunca se reporta éxito tras el fallo
    rmSync(dir, { recursive: true, force: true })
  })
})
