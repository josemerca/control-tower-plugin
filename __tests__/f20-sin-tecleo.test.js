// ===========================================================================
// F20 — EL ARRANQUE DEL AGENTE DEJA DE DEPENDER DE QUE NADIE ESCRIBA EN EL PTY
// EN EL MOMENTO EQUIVOCADO.
//
// LO QUE SE MIDIÓ (contra el cmux real de la máquina de desarrollo, abriendo y
// cerrando workspaces de prueba — nunca contra un repo de trabajo):
//
//   1. `--layout` NO ejecuta. Era la vía que F19 dejó apuntada como posible
//      exec y no pudo probar porque tenía prohibido lanzar cmux. Con
//      `--layout '{"pane":{"surfaces":[{"type":"terminal","command":"…"}]}}'`
//      el texto sale ECOADO detrás del prompt en la pantalla de la sesión, y
//      el proceso lanzado cuelga de `-/bin/zsh` (login) → `login -flp …
//      exec -l /bin/zsh` → cmux. Es tecleo, igual que `--command`. Y de
//      propina: con `--layout`, el `--cwd` pedido se IGNORA (el `$PWD` medido
//      fue el directorio por defecto).
//   2. No hay ninguna otra vía de exec: `new-surface` no acepta `--command`, y
//      el único tipo que arranca un binario por su cuenta (`agent-session
//      --provider claude`) es la sesión de Claude propia de cmux, sin forma de
//      pasarle argumentos ni prompt.
//   3. `--env` sí llega al shell (`CLAUDE_CONFIG_DIR` visible dentro), pero
//      `ZDOTDIR` NO: cmux/Ghostty lo usa para su propia integración y llega
//      VACÍO — así que tampoco se puede inyectar un rc que arranque el agente.
//   4. Con el mecanismo de F19 tal cual, SEIS lanzamientos consecutivos dieron
//      CERO centinelas. En la pantalla:
//
//          [oh-my-zsh] Would you like to update? [Y/n]
//          … >  '/…/launch.sh'
//          zsh: permission denied: /…/launch.sh
//
//      El `read` de un carácter se comió el `.` de `. '/…/launch.sh'`.
//   5. Un shell de login limpio ejecuta lo tecleado a los ~723 ms; un reenvío,
//      ~250–400 ms después de mandarlo. Los 8000 ms de F19 (que nadie midió)
//      son diez veces el arranque real: esperar más nunca iba a arreglarlo.
//   6. Con reenvío: 5 de 5 arrancaron, todos al segundo intento, y el agente
//      se lanzó UNA sola vez en cada uno.
//
// Estos tests fijan las propiedades, no la implementación: (a) un tecleo que
// se pierde ya no condena el despacho, (b) reenviar NUNCA puede lanzar dos
// agentes, y (c) cuando ni el reenvío basta, se sigue sin mentir.
// ===========================================================================
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCOUNT_ENV } from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { buildLauncherScript } from '../scripts/launch-sentinel.js'
import { buildStateSeed } from '../scripts/kickoff.js'
import { buildCmuxSendArgv, buildCmuxSendKeyArgv, collectFinishedResidue, formatFinishedResidueWarning } from '../scripts/dispatch.js'
import { shQuote } from '../scripts/shquote.js'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'scripts', 'ct-next.mjs')
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
  const d = mkdtempSync(join(tmpdir(), 'ct-f20-'))
  dirs.push(d)
  return d
}

const openIssue90 = { number: 90, title: '#90 algo', labels: [{ name: 'status:ready' }], body: '' }

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...envOverrides },
  })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') }
}

function dispatchOne(repoRoot, envOverrides = {}) {
  return runReal(['--repo', 'o/r', '--cap', '1'], {
    FAKE_GIT_TOPLEVEL: repoRoot,
    FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
    FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    ...envOverrides,
  })
}

function claudeRuns(repoRoot) {
  const f = join(repoRoot, 'claude-runs')
  return existsSync(f) ? readFileSync(f, 'utf8').length : 0
}

// ---------------------------------------------------------------------------
// H1 — el tecleo perdido deja de condenar el despacho
// ---------------------------------------------------------------------------
describe('F20/H1 — si el pty se come la línea, se reenvía', () => {
  it('el caso de campo (oh-my-zsh se come el primer carácter) YA NO condena el despacho: se reenvía y el agente arranca', () => {
    const repoRoot = makeRepoRoot()
    // Verificado contra el código SIN el arreglo: exit 1, «lanzados 0/1» y
    // «NO se puede confirmar que el comando llegara a ejecutarse» — el
    // dispatcher se comportaba con honestidad, pero el despacho fallaba igual
    // y dejaba claim + rama + worktree para que los limpiara un humano.
    const r = dispatchOne(repoRoot, {
      FAKE_CMUX_EAT_FIRST_CHAR_SUBSTR: '#90',
      FAKE_CMUX_CLAUDE_RUNS_FILE: join(repoRoot, 'claude-runs'),
    })
    expect(r.code).toBe(0)
    expect(r.all).toMatch(/lanzado #90 en .*\.worktrees\/90/)
    expect(r.all).toMatch(/lanzados 1\/1 slice\(s\)/)
    // …y NO se calla que hizo falta: un shell que se come lo que se le teclea
    // sigue siendo un dato del que el humano tiene que enterarse.
    expect(r.all).toMatch(/hizo falta REENVIAR la línea 1 vez/)
    // La propiedad que hace que reenviar sea seguro.
    expect(claudeRuns(repoRoot)).toBe(1)
  })

  it('reenviar NUNCA lanza dos agentes: si el primer tecleo llega tarde, el segundo sourceo es un no-op', () => {
    const repoRoot = makeRepoRoot()
    // El tecleo original tarda 3 s; el reenvío sale a los 2,5 s y arranca al
    // agente. Cuando el original por fin llega, la guarda del launcher lo
    // convierte en un no-op. Sin la guarda serían DOS `claude` sobre el mismo
    // worktree — el daño que un reintento ciego habría introducido.
    const r = dispatchOne(repoRoot, {
      FAKE_CMUX_COMMAND_DELAY_MS: '3000',
      CT_NEXT_LAUNCH_TIMEOUT_MS: '8000',
      FAKE_CMUX_CLAUDE_RUNS_FILE: join(repoRoot, 'claude-runs'),
    })
    expect(r.code).toBe(0)
    expect(r.all).toMatch(/lanzado #90/)
    // Margen para que el tecleo retrasado llegue después del reenvío.
    const t0 = Date.now()
    while (Date.now() - t0 < 2000) { /* espera activa corta: el stub retrasado corre en segundo plano */ }
    expect(claudeRuns(repoRoot)).toBe(1)
  })

  it('cuando ni los reenvíos bastan, se sigue sin mentir — y se dice que se reenvió, no solo que se esperó', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, {
      FAKE_CMUX_EAT_FIRST_CHAR_SUBSTR: '#90',
      FAKE_CMUX_EAT_ALWAYS_SUBSTR: '#90', // un rc que devora TODO lo que se teclee
      CT_NEXT_LAUNCH_TIMEOUT_MS: '5200',
      FAKE_CMUX_CLAUDE_RUNS_FILE: join(repoRoot, 'claude-runs'),
    })
    expect(r.code).toBe(1)
    expect(r.all).toMatch(/lanzados 0\/1 slice\(s\)/)
    expect(r.all).toMatch(/NO se puede confirmar que el comando llegara a ejecutarse/)
    expect(r.all).toMatch(/la línea se reenvió \d+ ve(z|ces) a esa sesión dentro del presupuesto y siguió sin ejecutarse/)
    expect(r.all).toMatch(/quedaron LANZADOS SIN VERIFICAR/)
    expect(claudeRuns(repoRoot)).toBe(0)
  })

  it('sin presupuesto para un segundo intento, se dice que NO hubo reenvío — no se deja creer que se intentó', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, {
      FAKE_CMUX_EAT_FIRST_CHAR_SUBSTR: '#90',
      CT_NEXT_LAUNCH_TIMEOUT_MS: '600',
    })
    expect(r.code).toBe(1)
    expect(r.all).toMatch(/No hubo ningún reenvío automático: el presupuesto \(600 ms\)/)
  })

  it('cmux no expone un handle para la sesión: el reenvío no se puede dirigir, y eso NO pasa en silencio', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, {
      FAKE_CMUX_EAT_FIRST_CHAR_SUBSTR: '#90',
      FAKE_CMUX_NO_REF: '1',
      CT_NEXT_LAUNCH_TIMEOUT_MS: '5200',
    })
    expect(r.code).toBe(1)
    expect(r.all).toMatch(/el reenvío automático de la línea tampoco se pudo hacer/)
    expect(r.all).toMatch(/no expuso un handle/)
  })

  it('el camino feliz sin reenvíos no menciona ninguno: la nota aparece solo cuando hubo algo que contar', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, { FAKE_CMUX_CLAUDE_RUNS_FILE: join(repoRoot, 'claude-runs') })
    expect(r.code).toBe(0)
    expect(r.all).toMatch(/lanzado #90/)
    expect(r.all).not.toMatch(/REENVIAR/)
    expect(claudeRuns(repoRoot)).toBe(1)
  })

  it('el presupuesto por defecto da para varios reenvíos, no para uno justo', () => {
    // La medida que lo fija: idle, 1 reenvío a los ~2,9 s; con la máquina
    // cargada, 2 reenvíos y ~7 s (1 de 3 se pasaba de los 8000 de F19). Un
    // presupuesto que solo diera para dos intentos volvería a fallar bajo
    // carga — y ahora, a diferencia de F19, más presupuesto SÍ compra algo:
    // cada ventana de más es un tecleo más, no una espera más.
    const src = readFileSync(join(here, '..', 'scripts', 'ct-next.mjs'), 'utf8')
    const total = Number(src.match(/^const DEFAULT_LAUNCH_SENTINEL_TIMEOUT_MS = (\d+)$/m)?.[1])
    const attempt = Number(src.match(/^const LAUNCH_ATTEMPT_MS = (\d+)$/m)?.[1])
    expect(total).toBeGreaterThan(0)
    expect(attempt).toBeGreaterThan(0)
    expect(Math.floor(total / attempt)).toBeGreaterThanOrEqual(5)
  })

  it('el --dry-run enseña el reparto en intentos y la medida que lo justifica', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    })
    expect(r.out).toMatch(/se REENVÍA la misma línea/)
    expect(r.out).toMatch(/0 de 6 lanzamientos/)
  })
})

// ---------------------------------------------------------------------------
// H1 — unitarios: la guarda y los argv del reenvío
// ---------------------------------------------------------------------------
describe('F20/H1 — la guarda de idempotencia (unitario)', () => {
  it('el launcher NO relanza al agente si su centinela ya existe', () => {
    const d = mkdtempSync(join(tmpdir(), 'ct-f20-guard-'))
    dirs.push(d)
    const sentinelPath = join(d, 'started')
    const marker = join(d, 'ran')
    const s = buildLauncherScript(
      { sentinelPath, agentCommand: `printf 'X' >> ${shQuote(marker)}`, issue: 7, worktree: d },
      shQuote,
    )
    const launcher = join(d, 'launch.sh')
    writeFileSync(launcher, s, { mode: 0o600 })
    const run = () => spawnSync('/bin/sh', ['-c', `. ${shQuote(launcher)}`], { cwd: d, encoding: 'utf8' })
    run()
    expect(existsSync(sentinelPath)).toBe(true)
    expect(readFileSync(marker, 'utf8')).toBe('X')
    // Segundo sourceo: el centinela ya está, así que no se relanza nada.
    const r2 = run()
    expect(readFileSync(marker, 'utf8')).toBe('X')
    expect(r2.stdout).toMatch(/ya arrancó \(centinela presente\)/)
  })

  it('el centinela se sigue escribiendo ANTES del agente: la guarda no invierte el orden', () => {
    const s = buildLauncherScript({ sentinelPath: '/tmp/s', agentCommand: 'claude --x', issue: 7, worktree: '/wt' }, shQuote)
    expect(s.indexOf("> '/tmp/s'")).toBeLessThan(s.indexOf('claude --x'))
  })

  it('`send` y `send-key` van separados: cmux send no manda Enter por su cuenta', () => {
    expect(buildCmuxSendArgv({ workspace: 'workspace:3', text: ". '/tmp/x'" })).toEqual(['send', '--workspace', 'workspace:3', ". '/tmp/x'"])
    expect(buildCmuxSendKeyArgv({ workspace: 'workspace:3' })).toEqual(['send-key', '--workspace', 'workspace:3', 'Enter'])
  })
})

// ---------------------------------------------------------------------------
// H2 — la cosecha
// ---------------------------------------------------------------------------
describe('F20/H2 — el residuo de un slice TERMINADO se nombra', () => {
  it('un issue ya mergeado con su worktree y su rama todavía en disco sale nombrado, con los comandos exactos', () => {
    const repoRoot = makeRepoRoot()
    mkdirSync(join(repoRoot, '.worktrees', '451'), { recursive: true })
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_BRANCH_LIST: 'feat/451',
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], [{ number: 451, state_reason: 'completed', body: '' }]]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    })
    // Verificado contra el código SIN arreglar: ni una sola mención de #451,
    // de `.worktrees/451` ni de `feat/451` en toda la salida.
    expect(r.all).toMatch(/cosecha pendiente: 1 slice\(s\)/)
    expect(r.all).toMatch(/#451: worktree .*\.worktrees\/451, rama feat\/451/)
    expect(r.all).toMatch(/git worktree remove --force .*\.worktrees\/451 && git branch -D feat\/451/)
    // El filo añadido: ese residuo bloquea el redespacho del MISMO número.
    expect(r.all).toMatch(/se NEGARÁ a redespachar/)
  })

  it('un repo sin residuo no dice nada (y no se inventa una cosecha)', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], [{ number: 451, state_reason: 'completed', body: '' }]]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    })
    expect(r.all).not.toMatch(/cosecha pendiente/)
  })

  it('la sesión de cmux que sigue abierta sobre un slice ya mergeado se nombra aparte: ese `claude` lleva horas vivo', () => {
    const residue = collectFinishedResidue([451], {
      worktreeDirs: ['451'],
      branchNames: ['feat/451'],
      cmuxTitles: ['menoplus · #451 Segmented control', 'otra cosa'],
    })
    expect(residue).toHaveLength(1)
    expect(residue[0].cmuxTitle).toBe('menoplus · #451 Segmented control')
    const w = formatFinishedResidueWarning(residue, { repo: 'o/r' })
    expect(w).toMatch(/sesión de cmux .* todavía abierta/)
    expect(w).toMatch(/sigue vivo con el trabajo YA entregado/)
  })

  it('#45 no casa dentro de #451: el número se busca como token entero', () => {
    const residue = collectFinishedResidue([45], {
      worktreeDirs: ['45'],
      branchNames: [],
      cmuxTitles: ['repo · #451 otro slice'],
    })
    expect(residue[0].cmuxTitle).toBe(null)
  })

  it('un issue mergeado SIN residuo no entra en la lista', () => {
    expect(collectFinishedResidue([451, 452], { worktreeDirs: ['451'], branchNames: [] })).toHaveLength(1)
    expect(formatFinishedResidueWarning([], { repo: 'o/r' })).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// H3 — quién es quién
// ---------------------------------------------------------------------------
describe('F20/H3 — el reparto de roles vive en el estado, no solo en un kickoff', () => {
  it('el STATE.md sembrado en el worktree declara que esa sesión es la DESPACHADA y que para', () => {
    // Verificado contra el código SIN arreglar: el frontmatter sembrado no
    // tenía ningún campo `role`, así que una sesión despachada que se
    // re-hidratara de su STATE.md no tenía forma de saber que no le toca
    // mergear ni despachar el siguiente slice.
    const seed = buildStateSeed(
      { name: 'algo', issue: '#90', n: 90, ac: ['ac1'], order: 1 },
      { branch: 'feat/90', base: 'main' },
    )
    expect(seed).toMatch(/^role: /m)
    expect(seed).toMatch(/DESPACHADA/)
    expect(seed).toMatch(/No groomeas, no mergeas/)
  })

  it('la plantilla del checkout principal declara el rol OPUESTO: coordinador', () => {
    const tpl = readFileSync(join(here, '..', 'skills', 'state-template', 'STATE.template.md'), 'utf8')
    expect(tpl).toMatch(/^role: "coordinador/m)
    expect(tpl).toMatch(/NO implementas slices aquí/)
  })

  it('el contrato §9 que siembra /ct-init nombra las dos sesiones y dónde vive cada rol', () => {
    const src = readFileSync(join(here, '..', 'scripts', 'ct-init.sh'), 'utf8')
    expect(src).toMatch(/Dos sesiones por repo, con papeles OPUESTOS/)
    expect(src).toMatch(/SLICES_CONTRACT_VERSION=9/)
  })
})
