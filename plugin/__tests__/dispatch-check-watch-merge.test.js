// EL LANZAMIENTO del vigilante del merge, desde el camino de éxito de
// `--release` (scripts/dispatch-check.mjs).
//
// Lo que este fichero fija es la costura, que es lo único que queda por probar
// aquí: que el vigilante se lanza CUANDO el slice se entrega de verdad, con los
// argumentos correctos, y que ningún fallo suyo puede tumbar el release. La
// lógica de vigilar ya está probada aparte (ct-watch-merge.test.js).
//
// El vigilante de verdad se sustituye por una grabadora vía CT_WATCH_MERGE_BIN:
// sin ella cada test que libera un slice pondría un proceso REAL a sondear
// GitHub cada minuto durante 48 horas. Es el mismo doble, y por el mismo motivo,
// que CT_WATCH_GO_BIN en ct-next-watch-go.test.js.
import { describe, it, expect } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { envDelGo } from './fixtures/go-gate.js'

const SCRIPT = fileURLToPath(new URL('../scripts/dispatch-check.mjs', import.meta.url))
const FAKE_GH = fileURLToPath(new URL('./fixtures/fake-gh-bin', import.meta.url))
const RECORDER = fileURLToPath(new URL('./fixtures/fake-watch-merge-bin/recorder.mjs', import.meta.url))

// Plan mínimo que cumple el contrato de plan-contract.js. Copiado de
// e2e-release-correspondencia.test.js: los tests de este repo no se importan
// entre sí.
const FENCE = '```'
const PLAN = [
  '# #9 — fixture slice',
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

const CUERPO = ['## Acceptance criteria (EARS, 1:1 con tests)', '- un criterio', '', '## Gates', '- **`plan`** — …', ''].join('\n')

// Worktree de slice con la tarea comiteada, el plan y el run ENTREGADO, sobre un
// repo git de VERDAD: `localSliceArtifacts` pregunta por el checkout principal
// con `git worktree list --porcelain`, y el vigilante necesita esa ruta. Un stub
// de git no serviría para probar que la ruta que se le pasa es la real.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-watch-merge-launch-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'f.txt'), 'base\n'); git('add', '-A'); git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feat/9')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', '2026-08-12-issue-9-work.md'), PLAN)
  writeFileSync(join(dir, 'work.txt'), 'trabajo\n')
  git('add', '-A'); git('commit', '-qm', 'work')
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), '---\nissue: 9\nbase: main\n---\n')
  writeFileSync(join(dir, '.agent', 'run-9.json'), JSON.stringify({
    plan: 'docs/superpowers/plans/2026-08-12-issue-9-work.md',
    issue: 9, baseSha: 'HEAD~1', task: 1, tasksTotal: 1, step: 'e2e',
    e2eRuns: [], closed: 'delivered',
  }))
  return dir
}

// El hijo va DESPRENDIDO y con `unref`, así que dispatch-check puede terminar
// antes de que la grabadora escriba. Se sondea el fichero en vez de leerlo una
// vez: si no, el test sería intermitente por construcción. Es la misma espera, y
// por el mismo motivo, que `esperarArgv` en ct-next-watch-go.test.js.
async function esperarArgv(ruta, ms = 5000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    if (existsSync(ruta)) return readFileSync(ruta, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    await new Promise((r) => setTimeout(r, 25))
  }
  return null
}

function release(dir, { args = [], env = {} } = {}) {
  const watchLog = join(dir, 'watch-merge.log')
  const r = spawnSync(process.execPath, [SCRIPT, '9', '--repo', 'o/r', '--release', ...args], {
    cwd: dir, encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${FAKE_GH}:${process.env.PATH}`,
      FAKE_GH_VIEW_BODY: CUERPO,
      FAKE_GH_VIEW_LABELS: JSON.stringify(['status:in-progress', 'gate:plan']),
      // El gate `plan` con su nonce (F38): sin un compromiso registrado y un
      // comentario que lo satisfaga, `--release` se niega con exit 9 mucho antes
      // de llegar al lanzamiento del vigilante. No es el objeto de este fichero,
      // así que se usa la fixture compartida en vez de recrear el registro.
      ...envDelGo({ repo: 'o/r', issue: 9 }),
      CT_WATCH_MERGE_BIN: RECORDER,
      FAKE_WATCH_MERGE_LOG: watchLog,
      ...env,
    },
  })
  return { ...r, watchLog }
}

describe('--release lanza el vigilante del merge', () => {
  it('un release con éxito lo lanza con el issue, el repo y el cwd de la coordinadora', async () => {
    const dir = repo()
    try {
      const r = release(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/released #9/)
      const lanzamientos = await esperarArgv(r.watchLog)
      expect(lanzamientos).toHaveLength(1)
      const argv = lanzamientos[0]
      expect(argv).toContain('--issue')
      expect(argv[argv.indexOf('--issue') + 1]).toBe('9')
      expect(argv[argv.indexOf('--repo') + 1]).toBe('o/r')
      // El cwd de la coordinadora es el checkout PRINCIPAL, no el cwd desde el
      // que se invoca. En esta fixture coinciden (no hay un `.worktrees/9` de
      // verdad), pero lo que se comprueba es que sale de `git worktree list` y
      // no de `process.cwd()` a ciegas: la ruta tiene que resolver al mismo
      // sitio que git dice, symlinks de /var incluidos.
      const cwd = argv[argv.indexOf('--coordinator-cwd') + 1]
      expect(cwd).toBe(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: dir, encoding: 'utf8' }).split('\n')[0].slice('worktree '.length).trim())
      // El log va FUERA del repo, junto a la telemetría y al del vigilante del
      // `-OK`, para que ningún `git add` de la slice lo meta en la PR.
      const log = argv[argv.indexOf('--log') + 1]
      expect(log).toMatch(/control-tower[/\\]log[/\\]watch-merge-9\.log$/)
      expect(log.startsWith(dir)).toBe(false)
      // Y se anuncia: un proceso que corre cuando no estás mirando y del que no
      // se dice ni el pid ni dónde deja rastro es indepurable.
      expect(r.stdout + r.stderr).toMatch(/vigilante del merge/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('con --no-watch-merge no lanza nada, y el release sigue siendo un éxito', async () => {
    const dir = repo()
    try {
      const r = release(dir, { args: ['--no-watch-merge'] })
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/released #9/)
      expect(await esperarArgv(r.watchLog, 600)).toBe(null)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('con --no-watch-merge se dice que la cosecha queda sin avisar, para que el silencio no se lea como entregado', async () => {
    const dir = repo()
    try {
      const r = release(dir, { args: ['--no-watch-merge'] })

      expect(r.stdout + r.stderr).toMatch(/--no-watch-merge/)
      expect(r.stdout).not.toMatch(/vigilante del merge de #9 lanzado/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('con --dry-run no lanza nada: nada se ha movido, así que no hay merge que esperar', async () => {
    const dir = repo()
    try {
      const r = release(dir, { args: ['--dry-run'] })
      expect(r.status).toBe(0)
      expect(r.stdout).not.toMatch(/vigilante del merge/)
      expect(await esperarArgv(r.watchLog, 600)).toBe(null)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('un release que NO libera (gate sin cumplir) no lanza nada', async () => {
    // El run sin `closed` es un slice que ct-step nunca cerró: exit 7. Un
    // vigilante lanzado aquí sondearía 48 h un PR que nadie va a abrir.
    const dir = repo()
    try {
      writeFileSync(join(dir, '.agent', 'run-9.json'), JSON.stringify({
        plan: 'docs/superpowers/plans/2026-08-12-issue-9-work.md',
        issue: 9, baseSha: 'HEAD~1', task: 1, tasksTotal: 1, step: 'e2e', e2eRuns: [],
      }))
      const r = release(dir)
      expect(r.status).toBe(7)
      expect(r.stdout + r.stderr).not.toMatch(/vigilante del merge/)
      expect(await esperarArgv(r.watchLog, 600)).toBe(null)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('un release retenido por el gate del go (exit 9) tampoco lanza nada', async () => {
    // La puerta más nueva de la escalera (F38): sin un `-OK <nonce>` en el issue
    // el release se niega. Va aquí y no solo en los tests de F38 porque lo que
    // este fichero fija es "el vigilante nace SI Y SOLO SI el slice se entregó
    // de verdad", y esa propiedad tiene que valer contra CADA puerta, no contra
    // las que existían el día que se escribió. Un vigilante lanzado aquí
    // sondearía 48 h un PR que nadie ha abierto.
    const dir = repo()
    try {
      const r = release(dir, { env: envDelGo({ repo: 'o/r', issue: 9, dado: false }) })
      expect(r.status).toBe(9)
      expect(r.stdout + r.stderr).not.toMatch(/vigilante del merge/)
      expect(await esperarArgv(r.watchLog, 600)).toBe(null)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('si el vigilante no se puede lanzar, el release SIGUE siendo un éxito', async () => {
    // El termómetro no es parte del motor: el trabajo ya está entregado y el
    // issue ya está en `in-review`. No poder vigilar el merge significa volver
    // al modo de antes —avisar a mano—, no perder la entrega. Y se dice.
    const dir = repo()
    try {
      const r = release(dir, { env: { CT_WATCH_MERGE_BIN: join(dir, 'no-existe', 'ni-de-broma.mjs') } })
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/released #9/)
      expect(r.stderr).toMatch(/aviso:/)
      expect(r.stderr).toMatch(/a mano/)
      expect(r.stdout).not.toMatch(/vigilante del merge de #9 lanzado \(pid/)
      expect(await esperarArgv(r.watchLog, 600)).toBe(null)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
