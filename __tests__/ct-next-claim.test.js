// W-C: /ct-next debe reclamar cada slice (dispatch-check.mjs, status:ready →
// status:in-progress) ANTES de crear su worktree, saltar el slice si el claim
// falla por colisión/carrera perdida (exit 1) pero seguir con el resto de la
// tanda, abortar TODA la tanda ante un fallo inesperado de dispatch-check
// (exit distinto de 0/1), y revertir el claim si el dispatch falla DESPUÉS de
// reclamar (git worktree add, seed de STATE.md, o cmux) — para no dejar el
// issue huérfano en status:in-progress sin nadie trabajándolo. Ver el brief
// de W-C y el comentario de cabecera de scripts/dispatch-check.mjs (T11) para
// la advertencia honesta sobre por qué esto NO cierra el hueco de
// compare-and-swap: solo evita el caso, mucho más común, de que /ct-next
// nunca llame a dispatch-check en absoluto.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  process.env.PATH,
].join(':')

// spawnSync (no execFileSync): execFileSync solo devuelve stdout cuando el
// hijo sale con éxito (exit 0) — su stderr, en ese caso, NUNCA llega a
// `e.stderr` porque no hay excepción que capturarlo. Varios escenarios de
// W-C terminan en exit 0 general (la tanda progresa) pero con un mensaje de
// aviso (p.ej. "saltando #42...") impreso por console.error — con
// execFileSync esas aserciones pasarían en falso por falta de ese texto.
// spawnSync siempre expone stdout/stderr por separado, exista o no excepción.
function run(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, PATH: fakePath, ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-claim-'))
  dirs.push(d)
  return d
}

const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }

// El fixture atado a --dry-run (CT_NEXT_FIXTURE) ya selecciona #2 sin tocar
// red — reutilizado tal cual de ct-next-dryrun.test.js para la parte de
// visibilidad en --dry-run (punto 5 del brief de W-C).
const FIXTURE = JSON.stringify({
  issues: [
    { n: 1, order: 1, status: 'in-review', deps: [], touches: ['api'], entrega: 'login', type: 'backend' },
    { n: 2, order: 2, status: 'ready', deps: [1], touches: ['api'], entrega: 'refresh', type: 'backend' },
  ],
  mergedIssues: [1],
})

describe('ct-next — --dry-run muestra el claim sin ejecutarlo (W-C, punto 5)', () => {
  it('imprime que se reclamaría el issue seleccionado, con su número, y deja claro que no se ejecuta', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/dispatch-check.*\b2\b.*--repo menoplus-app\/menoplus/)
    expect(r.out).toMatch(/no se ejecuta/i)
  })
})

describe('ct-next — claim exitoso antes de dispatch (W-C, punto 1)', () => {
  it('dispatch-check exit 0 → procede con el dispatch normal, y la orden de invocación es claim → worktree', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/claimed #42/i)
    expect(r.out).toMatch(/lanzado #42/)
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 42 --repo o\/r --add-label status:in-progress --remove-label status:ready/)
    // el claim (gh) sucede ANTES de crear el worktree (git)
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    const claimIdx = argv.indexOf('issue edit 42 --repo o/r --add-label status:in-progress')
    expect(claimIdx).toBeGreaterThan(-1)
    expect(gitLogTxt).toMatch(/worktree add -b feat\/42/)
  })
})

describe('ct-next — claim fallido (exit 1) salta el slice y sigue con el resto (W-C, punto 2)', () => {
  it('#42 colisiona (exit 1, se salta) y #43 sí se reclama y se despacha', () => {
    const repoRoot = makeRepoRoot()
    const openIssue43 = { number: 43, title: '#43 otro', labels: [{ name: 'status:ready' }], body: '' }
    const collidingRaw = { number: 99, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] }
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#42)
      // collision-check → colisiona ; idx3: dispatch-check(#43) collision-check
      // → limpio ; idx4: dispatch-check(#43) readback → limpio
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42, openIssue43], [], [collidingRaw], [], []]),
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/COLLISION|colisión/i) // mensaje propio de dispatch-check, surfaced tal cual
    expect(r.out).toMatch(/saltando #42/)
    expect(r.out).toMatch(/lanzado #43/)
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    expect(gitLogTxt).toMatch(/worktree add -b feat\/43/)
    expect(gitLogTxt).not.toMatch(/worktree add -b feat\/42/)
  })
})

describe('ct-next — fallo inesperado de dispatch-check (no exit 0/1) aborta TODA la tanda (W-C, punto 2)', () => {
  it('dispatch-check exit 2 (error de uso/config, simulado vía CT_CLAIM_PRECLAIM_DELAY_MS malformado) → aborta, no sigue con el resto', () => {
    const repoRoot = makeRepoRoot()
    const openIssue43 = { number: 43, title: '#43 otro', labels: [{ name: 'status:ready' }], body: '' }
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42, openIssue43], [], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      CT_CLAIM_PRECLAIM_DELAY_MS: 'not-a-number',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/fallo inesperado/i)
    expect(r.out).toMatch(/exit 2/)
    expect(r.out).toMatch(/abort/i)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/) // ni #42 ni #43 llegaron a crear worktree
  })
})

describe('ct-next — dispatch falla tras un claim exitoso → revierte el claim (W-C, punto 3)', () => {
  it('seed de STATE.md falla tras claim exitoso → limpia worktree/rama Y revierte el claim a status:ready', () => {
    const repoRoot = makeRepoRoot()
    mkdirSync(join(repoRoot, '.worktrees'), { recursive: true })
    writeFileSync(join(repoRoot, '.worktrees', '42'), '') // fuerza ENOTDIR en el seed
    const counterFile = join(repoRoot, 'gh-list-count')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se pudo sembrar \.agent\/STATE\.md/)
    expect(r.out).toMatch(/limpiados automáticamente/)
    expect(r.out).not.toMatch(/ATENCIÓN/)
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 42 --repo o\/r --add-label status:in-progress --remove-label status:ready/)
    expect(argv).toMatch(/issue edit 42 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })

  it('seed de STATE.md falla Y el revert del claim también falla → ATENCIÓN con el comando manual exacto', () => {
    const repoRoot = makeRepoRoot()
    mkdirSync(join(repoRoot, '.worktrees'), { recursive: true })
    writeFileSync(join(repoRoot, '.worktrees', '42'), '')
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready', // el revert falla; el claim inicial (status:in-progress) no
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATENCIÓN.*no se pudo limpiar automáticamente.*claim/is)
    expect(r.out).toMatch(/gh issue edit 42 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })

  it('cmux falla tras claim exitoso (seed sí escrito) → limpia y revierte el claim', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_CMUX_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se pudo lanzar cmux/)
    expect(r.out).toMatch(/limpiados automáticamente/)
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 42 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })

  it('git worktree add falla tras claim exitoso → revierte el claim automáticamente (sin worktree/rama que limpiar)', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_WORKTREE_ADD_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se pudo crear el worktree/)
    expect(r.out).toMatch(/revertido/i)
    expect(r.out).not.toMatch(/ATENCIÓN/)
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 42 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })

  it('git worktree add falla Y el revert del claim también falla → ATENCIÓN con el comando manual exacto', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_WORKTREE_ADD_FAIL: '1',
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATENCIÓN.*no se pudo revertir.*claim/is)
    expect(r.out).toMatch(/gh issue edit 42 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })
})
