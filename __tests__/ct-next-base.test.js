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

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  process.env.PATH,
].join(':')

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, PATH: fakePath, ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-base-'))
  dirs.push(d)
  return d
}

const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }

const FIXTURE = JSON.stringify({
  issues: [
    { n: 1, order: 1, status: 'in-review', deps: [], touches: ['api'], entrega: 'login', type: 'backend' },
    { n: 2, order: 2, status: 'ready', deps: [1], touches: ['api'], entrega: 'refresh', type: 'backend' },
  ],
  mergedIssues: [1],
})

describe('ct-next — resolución de la rama base por defecto (W-D)', () => {
  it('resuelve vía `gh repo view` (no "main" hardcodeado) y la usa tanto en `git worktree add` como en el STATE.md sembrado', () => {
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
    const stateMd = readFileSync(join(repoRoot, '.worktrees', '42', '.agent', 'STATE.md'), 'utf8')
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
    const stateMd = readFileSync(join(repoRoot, '.worktrees', '42', '.agent', 'STATE.md'), 'utf8')
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
