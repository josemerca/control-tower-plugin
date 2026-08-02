// W-D: ct-next.mjs hardcodeaba "main" en dos sitios (`git worktree add ...
// main` y `base: 'main'` en el STATE.md sembrado) — en un repo cuya rama por
// defecto real sea distinta (p.ej. "master", o cualquier otra convención)
// esto fallaba de forma confusa (git worktree add contra una rama que no
// existe) o, peor, sembraba un STATE.md con un `base` que miente sobre la
// rama real. Este fichero cubre: (a) la resolución en runtime vía `gh repo
// view --json defaultBranchRef` (fuente autoritativa, no una copia local que
// puede quedar desactualizada), (b) el override explícito `--base <rama>`,
// (c) qué pasa cuando no se puede determinar (abortar con mensaje claro, NUNCA
// asumir "main" en silencio — ese es justo el bug que se arregla), y (d) que
// --dry-run deja ver la rama base resuelta.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// D4: entorno hermético (dirs de cuenta + stubs de cmux/claude) — ver fixtures/hermetic-env.js
import { ACCOUNT_ENV } from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  process.env.PATH,
].join(':')

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
})

function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-base-'))
  dirs.push(d)
  return d
}

const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }

const FIXTURE = JSON.stringify({
  issues: [
    { n: 1, order: 1, status: 'in-review', deps: [], touches: ['api'], name: 'login', type: 'backend' },
    { n: 2, order: 2, status: 'ready', deps: [1], touches: ['api'], name: 'refresh', type: 'backend' },
  ],
  mergedIssues: [1],
})

describe('ct-next — resolución de la rama base por defecto (W-D)', () => {
  it('resuelve vía `gh repo view` (no "main" hardcodeado) y la usa tanto en `git worktree add` como en el SLICE.md sembrado', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_DEFAULT_BRANCH: 'develop',
    })
    expect(r.code).toBe(0)
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    expect(gitLogTxt).toMatch(/worktree add -b feat\/42 \S*\/42 develop/)
    const stateMd = readFileSync(join(repoRoot, '.worktrees', '42', '.agent', 'SLICE.md'), 'utf8')
    expect(stateMd).toMatch(/base: develop/)
  })

  it('sin override y sin poder determinarla (gh repo view falla) → exit 1, mensaje claro, ningún worktree creado, nunca asume "main"', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_REPO_VIEW_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se pudo determinar la rama por defecto/i)
    expect(r.out).toMatch(/--base/)
    const gitLogTxt = existsSyncSafe(gitLog)
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })

  it('--base <rama> explícito gana sobre la detección: nunca invoca `gh repo view`', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--base', 'release/9'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      // Si el override no ganara, la detección fallaría con esto y el test
      // fallaría por una razón distinta a la que se quiere comprobar.
      FAKE_GH_REPO_VIEW_FAIL: '1',
    })
    expect(r.code).toBe(0)
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    expect(gitLogTxt).toMatch(/worktree add -b feat\/42 \S*\/42 release\/9/)
    const stateMd = readFileSync(join(repoRoot, '.worktrees', '42', '.agent', 'SLICE.md'), 'utf8')
    expect(stateMd).toMatch(/base: release\/9/)
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).not.toMatch(/repo view/)
  })

  it('--base colgante (último token, sin valor) → exit 2', () => {
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--base'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/--base/i)
  })

  it('--base seguido de otro flag (sin valor real) → exit 2', () => {
    const r = runReal(['--repo', 'o/r', '--base', '--dry-run'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/--base/i)
  })

  it('--dry-run sin fixture muestra la rama base resuelta (no "main" a ciegas)', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_DEFAULT_BRANCH: 'develop',
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/develop/)
    expect(r.out).toMatch(/git worktree add -b feat\/42 \S*\/42 develop/)
  })

  it('--dry-run con CT_NEXT_FIXTURE nunca llama a `gh repo view` de verdad (fixture atado a --dry-run, sin tocar gh real)', () => {
    const repoRoot = makeRepoRoot()
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], {
      CT_NEXT_FIXTURE: FIXTURE,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(r.code).toBe(0)
    const log = existsSyncSafe(argvLog)
    expect(log).not.toMatch(/repo view/)
  })
})

function existsSyncSafe(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

// Fix round 1 de la review de W-D: un Important (la rama base se resolvía
// contra GitHub pero nunca se comprobaba que existiera EN EL CHECKOUT
// LOCAL — `git worktree add` fallaba tarde, ya después del claim, quemando
// un ciclo de claim/revert por algo que se podía saber offline) y tres
// Minor (--base '' se colaba; el banner de --dry-run mentía "resuelta" en
// modo fixture; la guarda de respuesta vacía de gh era intestable con el
// fixture, y no rechazaba el literal "null").
describe('ct-next — rama base: fix round 1 de la review (Important + Minor 1/2/3)', () => {
  it('Important: la rama base existe en origin pero no en el checkout local → exit 1, sugiere `git fetch`, no crea worktree ni intenta el claim', () => {
    const repoRoot = makeRepoRoot()
    const argvLog = join(repoRoot, 'gh-argv-log')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_BASE_NOT_LOCAL: '1',
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/existe en origin pero no en tu checkout local/i)
    expect(r.out).toMatch(/git fetch/i)
    expect(existsSyncSafe(gitLog)).not.toMatch(/worktree add/)
    expect(existsSyncSafe(argvLog)).not.toMatch(/issue edit/) // el claim nunca se intenta
  })

  it('Important: la rama base no existe ni en local ni en origin → exit 1, mensaje distinto (typo probable), no crea worktree', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--base', 'mian'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_BASE_NOT_LOCAL: '1',
      FAKE_GIT_BASE_NOT_REMOTE: '1',
      FAKE_GIT_LOG_FILE: gitLog,
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no existe ni en tu checkout local ni como origin\/mian/i)
    expect(r.out).toMatch(/typo/i)
    expect(existsSyncSafe(gitLog)).not.toMatch(/worktree add/)
  })

  it('Important: la rama base SÍ existe localmente (caso feliz, por defecto en el stub) → sigue funcionando igual que antes de este fix', () => {
    // No fija FAKE_GIT_BASE_NOT_LOCAL/FAKE_GIT_BASE_NOT_REMOTE: el stub
    // considera "existe" cualquier ref por defecto — mismo comportamiento
    // que ya cubre el describe de arriba, repetido aquí explícitamente junto
    // al resto de los tests de este fix round para dejar constancia de que
    // el caso feliz no se rompió al añadir la verificación.
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/lanzado #42/)
  })

  it('Minor 1: --base vacío ("") → exit 2, igual que --base sin valor', () => {
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--base', ''])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/--base/i)
  })

  it('Minor 2: --dry-run con fixture y SIN --base → el banner marca "(fixture)" (el valor no se resolvió de verdad)', () => {
    const r = runReal(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/rama base resuelta: main \(fixture\)/)
  })

  it('Minor 2: --dry-run con fixture Y --base explícito → el banner NO marca "(fixture)" (sí se dio un valor real)', () => {
    const r = runReal(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run', '--base', 'develop'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/rama base resuelta: develop\n/)
    expect(r.out).not.toMatch(/\(fixture\)/)
  })

  it('Minor 3: `gh repo view` devuelve la cadena vacía → exit 1, "no devolvió ningún nombre de rama utilizable" (alcanzable gracias a `??` en el stub)', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_DEFAULT_BRANCH: '',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no devolvió ningún nombre de rama utilizable/i)
  })

  it('Minor 3: `gh repo view` devuelve el literal "null" → se rechaza igual que la cadena vacía', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_DEFAULT_BRANCH: 'null',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no devolvió ningún nombre de rama utilizable/i)
  })
})
