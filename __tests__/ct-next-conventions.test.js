// F11, parte B — el aviso en el DESPACHO. ct-init avisa al bootstrapear, pero
// el momento en que la contradicción muerde es otro: /ct-next pone
// `status:in-progress`, crea el worktree, y el agente arranca leyendo el
// AGENTS.md del repo. Si ese AGENTS.md le manda usar OTRO claim (o trabajar en
// OTRA ruta de worktrees), el agente obedece esa orden — la que lee al
// hidratarse — y el script del repo se encuentra un claim activo sobre su
// propio issue. Eso es el deadlock que originó esta tanda.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCOUNT_ENV, hermeticEnv } from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'scripts', 'ct-next.mjs')
const initScript = join(here, '..', 'scripts', 'ct-init.sh')
const fixturesDir = join(here, 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  process.env.PATH,
].join(':')

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
})

function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-conv-'))
  dirs.push(d)
  return d
}

const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...envOverrides },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const FIXTURE = JSON.stringify({
  issues: [{ n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'refresh', type: 'backend' }],
  mergedIssues: [],
})

describe('ct-next — avisa cuando el AGENTS.md del repo contradice al kickoff', () => {
  it('AGENTS.md que manda otro dispatch-check → aviso nombrando el conflicto, sin bloquear el despacho', () => {
    const repoRoot = makeRepoRoot()
    writeFileSync(
      join(repoRoot, 'AGENTS.md'),
      '# AGENTS.md\n- **Claim:** `scripts/dispatch-check.sh <issue#>` antes de implementar, `--release` al abrir PR.\n'
    )
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GIT_LOG_FILE: join(repoRoot, 'git-log'),
    })
    // El aviso NO bloquea: la tanda sigue y el slice se lanza.
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/lanzado #42/)
    expect(r.out).toMatch(/\[claim\]/)
    expect(r.out).toContain('AGENTS.md:2')
    expect(r.out).toMatch(/dispatch-check\.sh/)
    // Y dice por qué importa AQUÍ, en un despacho.
    expect(r.out).toMatch(/kickoff/i)
  })

  it('AGENTS.md que manda otra ruta de worktrees → aviso citando .worktrees/<n> y feat/<n>', () => {
    const repoRoot = makeRepoRoot()
    writeFileSync(
      join(repoRoot, 'AGENTS.md'),
      '# AGENTS.md\n- Trabajo nuevo: `git worktree add .claude/worktrees/<slug> -b <rama> main`.\n'
    )
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GIT_LOG_FILE: join(repoRoot, 'git-log'),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/\[worktrees\]/)
    expect(r.out).toContain('.claude/worktrees')
    expect(r.out).toContain('.worktrees/<n>')
    expect(r.out).toContain('feat/<n>')
  })

  it('un AGENTS.md bootstrapeado por ct-init (y nada más) NO dispara el aviso: el bloque propio no cuenta', () => {
    const repoRoot = makeRepoRoot()
    execFileSync('bash', [initScript, repoRoot], { encoding: 'utf8' })
    // Control: el bloque sembrado SÍ habla del terreno que se escanea.
    const agents = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8')
    expect(agents).toMatch(/\.worktrees\/<n>/)
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GIT_LOG_FILE: join(repoRoot, 'git-log'),
    })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/\[claim\]|\[worktrees\]/)
  })

  it('un repo sin AGENTS.md ni CLAUDE.md no dispara nada (ausencia no es señal)', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GIT_LOG_FILE: join(repoRoot, 'git-log'),
    })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/ATENCIÓN: el repo/)
    expect(r.out).not.toMatch(/no se ha podido leer la documentación/)
  })

  it('si AGENTS.md no se puede LEER (no es ENOENT), se dice — no se pasa por "no hay conflicto"', () => {
    const repoRoot = makeRepoRoot()
    // Un directorio llamado AGENTS.md: readFileSync falla con EISDIR, no
    // ENOENT. La distinción importa — "no existe" no dice nada, "no se ha
    // podido leer" sí.
    mkdirSync(join(repoRoot, 'AGENTS.md'))
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GIT_LOG_FILE: join(repoRoot, 'git-log'),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/no se ha podido leer la documentación del repo/)
    expect(r.out).toMatch(/no se ha mirado/)
  })

  it('--dry-run con fixture NO escanea nada (repoRoot sintético): no inventa un aviso sobre un repo que no existe', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1', '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, ...hermeticEnv(), CT_NEXT_FIXTURE: FIXTURE },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    expect(r.status).toBe(0)
    expect(out).not.toMatch(/\[claim\]|\[worktrees\]/)
  })
})
