import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shQuote } from '../scripts/shquote.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

// stdio explícito (finding 11 de la review final): sin esto, execFileSync
// además de capturar el stderr del hijo en `e.stderr` (lo que ya usan las
// aserciones de abajo) también lo reenvía al proceso padre — es decir, a la
// salida de `npm test`. Todas las líneas que aparecían así son la salida
// ESPERADA de rutas de fallo deliberadas (tests de error de uso, colisión,
// etc.), pero un lector no puede distinguir ese ruido esperado de un fallo
// real sin leer el código. `stdio: ['ignore','pipe','pipe']` mantiene stdout/
// stderr disponibles vía `e.stdout`/`e.stderr` sin ecoarlos al padre.
function run(args, envOverrides = {}) {
  try {
    const out = execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...envOverrides } })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}

// El wrapper acepta CT_NEXT_FIXTURE (JSON de {issues, mergedIssues}) para test sin red.
const FIXTURE = JSON.stringify({
  issues: [
    { n: 1, order: 1, status: 'in-review', deps: [], touches: ['api'], entrega: 'login', type: 'backend' },
    { n: 2, order: 2, status: 'ready', deps: [1], touches: ['api'], entrega: 'refresh', type: 'backend' },
  ],
  mergedIssues: [1],
})

describe('ct-next --dry-run', () => {
  it('elige #2 e imprime worktree + cmux', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).toContain('#2')
    expect(r.out).toContain('git worktree add')
    expect(r.out).toContain('cmux')
    expect(r.out).toContain('new-workspace')
    expect(r.out).toMatch(/\.claude-personal/) // account map: menoplus → personal
    // T10, hallazgo en vivo: CLAUDE_CONFIG_DIR tiene que viajar como --env
    // DENTRO del argv de cmux (protocolo del daemon), no como env local del
    // proceso `cmux` cliente — si no, la sesión queda colgada en el
    // selector interactivo de cuenta en vez de arrancar con la cuenta ya
    // resuelta. Pin end-to-end de que ct-next.mjs realmente lo emite así.
    expect(r.out).toMatch(/cmux .*--env CLAUDE_CONFIG_DIR=\S*\.claude-personal/)
  })

  it('no reproduce la garantía de fixture con un slice sin ac/issue (defensivo: no crashea)', () => {
    // La forma del fixture del brief NO trae `ac`/`issue` — igual que un issue
    // real sin cuerpo de acceptance-criteria reconocible. renderKickoff/
    // buildStateSeed indexan slice.ac como array; si el wrapper no lo
    // normaliza, esto revienta con un TypeError en vez de imprimir el plan.
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '2', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/TypeError/)
  })
})

describe('ct-next — fixture atado a --dry-run', () => {
  it('CT_NEXT_FIXTURE puesto SIN --dry-run → exit 2, no decide ni lanza nada real', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/CT_NEXT_FIXTURE.*--dry-run/is)
  })
})

describe('ct-next — nada despachable', () => {
  it('imprime mensaje claro y exit 0 cuando no hay slices ready con deps mergeadas', () => {
    const fixtureNadaReady = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-review', deps: [], touches: ['api'], entrega: 'login', type: 'backend' },
        { n: 2, order: 2, status: 'ready', deps: [1], touches: ['api'], entrega: 'refresh', type: 'backend' },
      ],
      mergedIssues: [], // #1 no mergeado todavía → #2 bloqueado por deps
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fixtureNadaReady })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/no hay slices despachables/i)
  })
})

describe('ct-next — errores de uso', () => {
  it('sin --repo → exit 2', () => {
    const r = run(['--dry-run'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/uso:/)
  })

  it('--repo colgante (último token, sin valor) → exit 2', () => {
    const r = run(['--cap', '1', '--dry-run', '--repo'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/uso:/)
  })

  it('--repo seguido de otro flag (sin valor real) → exit 2', () => {
    const r = run(['--repo', '--dry-run'])
    expect(r.code).toBe(2)
  })

  it('--cap no numérico → exit 2', () => {
    const r = run(['--repo', 'o/r', '--cap', 'nope', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/--cap/i)
  })
})

describe('shQuote (Override 1: escapado POSIX del prompt de kickoff)', () => {
  // Verifica, contra un shell POSIX real, que el valor que le llega al
  // programa tras el round-trip de parseo de shell es byte-idéntico al
  // original — no una aproximación visual. Usamos `set --` para fijar los
  // argumentos posicionales a partir del valor citado y comprobamos que
  // produce EXACTAMENTE un argumento (si el citado estuviera roto y el shell
  // partiera la palabra, $# sería > 1 y lo detectaríamos aquí en vez de
  // limitarnos a leer $1 y enmascarar el bug).
  function shellRoundTrip(value) {
    const quoted = shQuote(value)
    const script = `set -- ${quoted}\nif [ "$#" -ne 1 ]; then echo "ARGC:$#"; exit 1; fi\nprintf '%s' "$1"`
    return execFileSync('sh', ['-c', script], { encoding: 'utf8' })
  }

  const cases = {
    'cadena vacía': '',
    'texto plano': 'hola mundo',
    'variable de entorno': 'no expandas $HOME por favor',
    backticks: 'esto `no` es un comando',
    'comilla simple literal': "el valor tiene una comilla ' suelta",
    backslash: 'una barra \\ invertida literal',
    'salto de línea': 'primera línea\nsegunda línea',
    'todo junto (caso trampa)': "cd $HOME && echo `whoami` && rm -rf ' \\ \n fin",
  }

  for (const [label, value] of Object.entries(cases)) {
    it(`round-trip byte-idéntico a través de un shell POSIX real: ${label}`, () => {
      expect(shellRoundTrip(value)).toBe(value)
    })
  }
})

// Review round 1, finding Important: si `git worktree add` funciona pero un
// paso posterior (seed de STATE.md o lanzamiento de cmux) falla, el worktree
// y la rama quedan huérfanos. Estos tests ejercitan la ruta REAL (no fixture,
// no --dry-run) con stubs de `git`/`gh`/`cmux` (nunca un repo real, nunca un
// worktree fuera de un directorio temporal, nunca un cmux real) para
// verificar que ct-next.mjs intenta limpiar y distingue "limpiado" de "no
// pude limpiar, hazlo a mano".
describe('ct-next — worktree huérfano en fallo parcial (review round 1, Important)', () => {
  const fakePath = [
    join(fixturesDir, 'fake-git-bin'),
    join(fixturesDir, 'fake-gh-bin'),
    join(fixturesDir, 'fake-cmux-bin'),
    process.env.PATH,
  ].join(':')

  const dirs = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  function runReal(args, envOverrides = {}) {
    try {
      const out = execFileSync('node', [script, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'], // finding 11: no ecoar el ruido esperado al padre
        env: { ...process.env, PATH: fakePath, ...envOverrides },
      })
      return { code: 0, out }
    } catch (e) {
      return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
    }
  }

  function makeRepoRoot() {
    const d = mkdtempSync(join(tmpdir(), 'ct-next-repo-'))
    dirs.push(d)
    return d
  }

  const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }

  it('el seed de STATE.md falla (wt ya existe como fichero, no directorio) → limpia y avisa que se puede reintentar', () => {
    const repoRoot = makeRepoRoot()
    mkdirSync(join(repoRoot, '.worktrees'), { recursive: true })
    // Pre-crea la ruta del worktree COMO FICHERO: `git worktree add` está
    // stubbeado (no toca disco), así que sigue siendo un fichero cuando
    // ct-next.mjs intenta mkdirSync(`${wt}/.agent`, {recursive:true}) — eso
    // revienta con ENOTDIR de forma determinista, sin depender de permisos.
    writeFileSync(join(repoRoot, '.worktrees', '42'), '')
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se pudo sembrar \.agent\/STATE\.md/)
    expect(r.out).toMatch(/limpiados automáticamente/)
    expect(r.out).toMatch(/puedes reintentar/)
    expect(r.out).not.toMatch(/ATENCIÓN/)
  })

  // Finding 10 de la review final: los dos pasos de limpieza se intentan por
  // SEPARADO, así que el hint manual nunca junta ambos comandos con `&&` — si
  // lo hiciera, y solo uno de los dos pasos hubiera fallado de verdad, el
  // hint sería inejecutable tal cual (el paso que sí tuvo éxito volvería a
  // fallar al reintentarlo, y por el `&&` el otro nunca llegaría a correr).
  it('el worktree remove falla pero el branch -D (intentado por separado) sí tiene éxito → ATENCIÓN solo con el comando de worktree, sin && y sin mencionar la rama', () => {
    const repoRoot = makeRepoRoot()
    mkdirSync(join(repoRoot, '.worktrees'), { recursive: true })
    writeFileSync(join(repoRoot, '.worktrees', '42'), '')
    const counterFile = join(repoRoot, 'gh-list-count')
    const wtPath = join(repoRoot, '.worktrees', '42')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_WORKTREE_REMOVE_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATENCIÓN.*no se pudo limpiar automáticamente el worktree/s)
    expect(r.out).toMatch(new RegExp(`git worktree remove --force ${wtPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    expect(r.out).not.toMatch(/&&/) // nunca encadenado
    expect(r.out).not.toMatch(/git branch -D feat\/42/) // la rama ya se borró de verdad, no hace falta el hint
  })

  it('el branch -D falla pero el worktree remove (intentado por separado) sí tiene éxito → ATENCIÓN solo con el comando de rama, sin && y sin mencionar el worktree', () => {
    const repoRoot = makeRepoRoot()
    mkdirSync(join(repoRoot, '.worktrees'), { recursive: true })
    writeFileSync(join(repoRoot, '.worktrees', '42'), '')
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_BRANCH_DELETE_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATENCIÓN.*no se pudo limpiar automáticamente la rama/s)
    expect(r.out).toMatch(/git branch -D feat\/42/)
    expect(r.out).not.toMatch(/&&/)
    expect(r.out).not.toMatch(/git worktree remove --force/) // el worktree ya se borró de verdad, no hace falta el hint
  })

  it('worktree remove Y branch -D fallan los dos → ATENCIÓN con ambos comandos, separados (nunca con &&)', () => {
    const repoRoot = makeRepoRoot()
    mkdirSync(join(repoRoot, '.worktrees'), { recursive: true })
    writeFileSync(join(repoRoot, '.worktrees', '42'), '')
    const counterFile = join(repoRoot, 'gh-list-count')
    const wtPath = join(repoRoot, '.worktrees', '42')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_WORKTREE_REMOVE_FAIL: '1',
      FAKE_GIT_BRANCH_DELETE_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATENCIÓN.*no se pudo limpiar automáticamente el worktree y la rama/s)
    expect(r.out).toMatch(new RegExp(`git worktree remove --force ${wtPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    expect(r.out).toMatch(/git branch -D feat\/42/)
    expect(r.out).not.toMatch(/&&/)
  })

  it('el lanzamiento de cmux falla (seed ya escrito de verdad) → limpia y avisa que se puede reintentar', () => {
    const repoRoot = makeRepoRoot()
    // Aquí el wt es un directorio real y escribible: mkdirSync/writeFileSync
    // (Override 2) escriben de verdad un STATE.md bajo un directorio temporal
    // (permitido — nunca fuera de un tmp dir), y es cmux quien falla.
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_CMUX_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se pudo lanzar cmux/)
    expect(r.out).toMatch(/limpiados automáticamente/)
    expect(r.out).toMatch(/puedes reintentar/)
  })

  it('cap 2, el primer slice se lanza con éxito y el segundo falla en cmux → el mensaje deja claro dónde se paró y qué sigue vivo', () => {
    const repoRoot = makeRepoRoot()
    const openIssue43 = { number: 43, title: '#43 otro', labels: [{ name: 'status:ready' }], body: '' }
    const counterFile = join(repoRoot, 'gh-list-count')
    const logFile = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42, openIssue43], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_CMUX_FAIL_NAME_SUBSTR: '#43', // solo falla el segundo slice
      FAKE_GIT_LOG_FILE: logFile,
    })
    expect(r.code).toBe(1)
    // #42 se lanzó con éxito ANTES del fallo de #43 — su línea de éxito debe
    // aparecer, y el mensaje de #43 debe dejar explícito que lo ya lanzado
    // sigue corriendo sin tocarse.
    const idxLanzado42 = r.out.indexOf('lanzado #42')
    const idxFallo43 = r.out.indexOf('no se pudo lanzar cmux')
    expect(idxLanzado42).toBeGreaterThan(-1)
    expect(idxFallo43).toBeGreaterThan(-1)
    expect(idxLanzado42).toBeLessThan(idxFallo43)
    expect(r.out).toMatch(/ya lanzados con éxito antes de este fallo.*siguen corriendo.*no se han tocado/is)
    // El log de git confirma que SOLO se intentó limpiar el worktree/rama de
    // #43 (el segundo), nunca el de #42 (el primero, que sí tuvo éxito).
    const gitLog = readFileSync(logFile, 'utf8')
    expect(gitLog).toMatch(/worktree remove --force .*\/43/)
    expect(gitLog).not.toMatch(/worktree remove --force .*\/42/)
  })
})

// Finding 1 de la review final (el más grave de toda la revisión): `repoRoot`
// sale de `git rev-parse --show-toplevel` en el cwd de la sesión, que puede
// no tener nada que ver con `--repo`. Sin guarda, `/ct-next --repo
// otro-org/otro-repo` corrido desde una sesión de control-tower crearía el
// worktree/rama/STATE.md/cmux DENTRO de control-tower. fake-git-bin resuelve
// `git remote get-url origin` a "https://github.com/o/r.git" por defecto (para
// no romper el resto de la suite, que usa `--repo o/r`); estos tests fijan
// FAKE_GIT_REMOTE_ORIGIN/FAKE_GIT_REMOTE_FAIL para ejercitar el mismatch.
describe('ct-next — guarda de identidad de repo (review final, finding 1)', () => {
  const fakePath = [
    join(fixturesDir, 'fake-git-bin'),
    join(fixturesDir, 'fake-gh-bin'),
    join(fixturesDir, 'fake-cmux-bin'),
    process.env.PATH,
  ].join(':')

  const dirs = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  function runReal(args, envOverrides = {}) {
    try {
      const out = execFileSync('node', [script, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: fakePath, ...envOverrides },
      })
      return { code: 0, out }
    } catch (e) {
      return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
    }
  }

  function makeRepoRoot() {
    const d = mkdtempSync(join(tmpdir(), 'ct-next-identity-'))
    dirs.push(d)
    return d
  }

  it('--repo no coincide con el remote origin del checkout local → exit 1, mensaje claro, ningún worktree creado', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'menoplus-app/menoplus', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_REMOTE_ORIGIN: 'https://github.com/control-tower/control-tower.git',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no coincide/i)
    expect(r.out).toMatch(/menoplus-app\/menoplus/)
    expect(r.out).toMatch(/control-tower\/control-tower/)
    expect(existsSync(join(repoRoot, '.worktrees'))).toBe(false)
  })

  it('checkout sin remote "origin" → exit 1, mensaje claro (no crash sin capturar), ningún worktree creado', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_REMOTE_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no tiene remote "origin"/i)
    expect(existsSync(join(repoRoot, '.worktrees'))).toBe(false)
  })

  it('--repo SÍ coincide con el remote origin (distintas formas de URL) → pasa la guarda', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'menoplus-app/menoplus', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_REMOTE_ORIGIN: 'git@github.com:menoplus-app/menoplus.git',
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/no hay slices despachables/i)
  })

  it('la guarda también se aplica en --dry-run sin fixture: un --repo que no coincide aborta igual, no solo en la corrida real', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_REMOTE_ORIGIN: 'https://github.com/control-tower/control-tower.git',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no coincide/i)
  })
})

// Finding 2 de la review final: `gh issue list --limit 200` devuelve más
// nuevo primero, así que un tope fijo deja fuera justo los issues VIEJOS de
// los que dependen otros. fake-gh-bin no simula HTTP-pagination de verdad,
// pero SÍ registra el argv exacto que ct-next.mjs le pasa — la forma correcta
// de comprobar, sin red, que el comando ya no lleva el tope fijo.
describe('ct-next — enumeración de issues sin --limit fijo (review final, finding 2)', () => {
  const fakePath = [
    join(fixturesDir, 'fake-git-bin'),
    join(fixturesDir, 'fake-gh-bin'),
    join(fixturesDir, 'fake-cmux-bin'),
    process.env.PATH,
  ].join(':')
  const dirs = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  function runReal(args, envOverrides = {}) {
    try {
      const out = execFileSync('node', [script, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: fakePath, ...envOverrides },
      })
      return { code: 0, out }
    } catch (e) {
      return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
    }
  }

  it('la enumeración de issues abiertos y cerrados usa --paginate y nunca --limit', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ct-next-nolimit-'))
    dirs.push(repoRoot)
    const counterFile = join(repoRoot, 'gh-list-count')
    const logFile = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: logFile,
    })
    expect(r.code).toBe(0)
    const log = readFileSync(logFile, 'utf8')
    expect(log).toMatch(/--paginate/)
    expect(log).not.toMatch(/--limit/)
    expect(log).toMatch(/state=open/)
    expect(log).toMatch(/state=closed/)
  })
})
