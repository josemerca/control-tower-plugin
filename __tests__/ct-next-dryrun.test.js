import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shQuote } from '../scripts/shquote.js'
// D4: entorno hermético (dirs de cuenta + stubs de cmux/claude) — ver fixtures/hermetic-env.js
import { ACCOUNT_ENV, hermeticEnv } from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

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
    // hermeticEnv() (D4): además de los dirs de cuenta, mete los stubs de
    // `cmux`/`claude` por delante del PATH real — el preflight los BUSCA (no
    // los ejecuta), y sin esto la suite dependería de que la máquina que la
    // corre los tenga instalados.
    const out = execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...hermeticEnv(), ...envOverrides } })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}

// El wrapper acepta CT_NEXT_FIXTURE (JSON de {issues, mergedIssues}) para test sin red.
// F13: este fixture describía un estado IMPOSIBLE — #1 aparecía a la vez en
// `mergedIssues` (o sea, cerrado y mergeado) y dentro de `issues`, que es la
// lista de issues ABIERTOS (buildDispatchInput solo mapea `rawOpenIssues`).
// Era inocuo mientras `status:in-review` no hiciera nada; desde F13/H2 un
// in-review retiene sus tokens, así que ese #1 fantasma bloqueaba a #2 por
// `touches:api` y el fixture dejaba de despachar nada. Se corrige la
// contradicción, no el comportamiento: un issue mergeado no está abierto, así
// que desaparece de `issues` y sigue en `mergedIssues` — que es justo lo que
// este fixture quería decir (la dep de #2 está mergeada).
const FIXTURE = JSON.stringify({
  issues: [
    { n: 2, order: 2, status: 'ready', deps: [1], touches: ['api'], name: 'refresh', type: 'backend' },
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
  // W-B (§8): este test existía antes de W-B y esperaba el mensaje genérico
  // "no hay slices despachables". El brief de W-B pide explícitamente que ese
  // mensaje deje de ser genérico y distinga la causa (nada ready / deps sin
  // mergear / colisión con trabajo en vuelo / cap lleno) — este escenario
  // concreto (un #2 ready cuya única dep, #1, no está mergeada) es EXACTAMENTE
  // el caso "deps-unmet", así que la aserción se actualiza para reflejar el
  // mensaje nuevo, más específico, en vez del genérico que este cambio retira
  // a propósito. Los casos restantes (none-ready/collision/cap-full) se
  // cubren en el describe de abajo.
  it('imprime el motivo "deps sin mergear" y exit 0 cuando el único ready tiene una dep sin mergear', () => {
    const fixtureNadaReady = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-review', deps: [], touches: ['api'], name: 'login', type: 'backend' },
        { n: 2, order: 2, status: 'ready', deps: [1], touches: ['api'], name: 'refresh', type: 'backend' },
      ],
      mergedIssues: [], // #1 no mergeado todavía → #2 bloqueado por deps
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fixtureNadaReady })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/dependencias sin mergear/i)
    expect(r.out).toMatch(/#2/)
    expect(r.out).toMatch(/#1/)
  })

  // D1 finding 5: una dependencia de ORDEN no mapeable (ningún issue, abierto
  // o cerrado, lleva ese `<!-- ct-order:N -->`) se traduce a `null` en
  // gh-issue-map.js#buildDispatchInput — correcto (fail-closed: nunca se
  // satisface por accidente), pero el mensaje anterior imprimía literalmente
  // "falta mergear #null", instruyendo a esperar algo que no existe y nunca
  // se va a mergear. El mensaje nuevo tiene que explicar la causa real (un
  // orden que no corresponde a ningún issue) y NUNCA mostrar el string "#null".
  it('dep de orden no mapeable (null) → el mensaje explica la causa real, nunca imprime "#null"', () => {
    const fx = JSON.stringify({
      issues: [{ n: 5, order: 5, status: 'ready', deps: [null], touches: [], name: 'x', type: 'backend' }],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#5/)
    expect(r.out).not.toMatch(/#null/)
    expect(r.out).toMatch(/no (corresponde|existe)/i)
  })

  // D1 finding 2: un issue ready con `depsMalformed: true` (la sección "##
  // Dependencias" existe pero no se reconoció ningún "merge-after #N" —
  // probable reescritura humana) se reporta como bloqueado, con un mensaje
  // que deja claro que el estado es DESCONOCIDO — nunca "sin dependencias"
  // (que es lo que una lista vacía de unmetDeps sugeriría sin este mensaje).
  it('issue con depsMalformed:true → mensaje explica que la sección "## Dependencias" es ilegible, no que no tiene deps', () => {
    const fx = JSON.stringify({
      issues: [{ n: 9, order: 9, status: 'ready', deps: [], depsMalformed: true, touches: [], name: 'x', type: 'backend' }],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#9/)
    expect(r.out).toMatch(/Dependencias/)
    expect(r.out).not.toMatch(/falta mergear\s*$/im)
  })
})

// D1 finding 3: dos labels "status:" en el mismo issue (edición a medias) se
// resuelven de forma conservadora e independiente del orden del array (ver
// gh-issue-map.js#resolveStatus), pero eso NUNCA debe pasar en silencio: un
// aviso explícito, siempre impreso (no solo en --dry-run), es lo que permite
// a un humano corregir las labels antes de que la ambigüedad se repita.
describe('ct-next — aviso de status: ambiguo (D1 finding 3)', () => {
  it('un issue con statusAmbiguous:true produce un aviso explícito, nombrando las labels en conflicto y a qué se resolvió', () => {
    const fx = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-progress', statusAmbiguous: true, statusLabels: ['in-progress', 'ready'], deps: [], touches: ['api'], name: 'x', type: 'backend' },
      ],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#1/)
    expect(r.out).toMatch(/status:in-progress/)
    expect(r.out).toMatch(/status:ready/)
    expect(r.out).toMatch(/avis/i)
  })

  it('sin ningún statusAmbiguous → sin aviso', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/avis/i)
  })
})

// Review de D1, finding 1 (parte "falta el aviso"): estrechar el dominio de
// deps a "## Dependencias" (D1 finding 2) abrió una puerta que `main`
// mantenía cerrada — un `merge-after #N` fuera de la sección ya no gatea el
// dispatch (correcto y deseado), pero antes de este fix nada lo decía. El
// aviso usa la MISMA forma que el de statusAmbiguous (arriba): siempre
// impreso (console.log, no console.error — no aborta nada), listando el
// issue y la referencia ignorada.
describe('ct-next — aviso de deps fuera de la sección "## Dependencias" (D1 finding 1, seguimiento de review)', () => {
  it('un issue con strayDeps:[1] produce un aviso explícito nombrando el issue y la referencia ignorada', () => {
    const fx = JSON.stringify({
      issues: [{ n: 8, order: 2, status: 'ready', deps: [], strayDeps: [1], touches: [], name: 'x', type: 'backend' }],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#8/)
    expect(r.out).toMatch(/#1/)
    expect(r.out).toMatch(/Dependencias/)
    expect(r.out).toMatch(/avis/i)
  })

  it('sin ningún strayDeps → sin aviso', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/avis/i)
  })
})

// W-B (§8): un mensaje único ("nada ready con deps mergeadas y sin colisión")
// obligaba a adivinar entre cuatro causas con remedios distintos. Cada test
// de abajo fija, contra el wrapper real (vía CT_NEXT_FIXTURE), el mensaje
// exacto para una causa — usando planDispatch/explainNoSelection (ya
// probados sin red en dispatch.test.js) por debajo.
describe('ct-next — motivo de bloqueo distinguible (W-B, §8)', () => {
  it('nada en status:ready → mensaje "none-ready"', () => {
    const fx = JSON.stringify({
      issues: [{ n: 1, order: 1, status: 'in-review', deps: [], touches: [], name: 'x', type: 'backend' }],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/no hay ningún issue en status:ready/i)
  })

  it('ready + deps mergeadas pero colisiona con touches en vuelo → nombra el issue en vuelo y el token compartido', () => {
    const fx = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'], name: 'en curso', type: 'backend' },
        { n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'choca', type: 'backend' },
      ],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '9', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#2/)
    expect(r.out).toMatch(/#1/)
    expect(r.out).toMatch(/api/)
    expect(r.out).toMatch(/en vuelo/i)
  })

  it('ready + deps mergeadas pero colisiona con serialización (migration en vuelo vs. ci ready) → nombra ambos tokens', () => {
    const fx = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['migration'], name: 'en curso', type: 'backend' },
        { n: 2, order: 2, status: 'ready', deps: [], touches: ['ci'], name: 'choca', type: 'backend' },
      ],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '9', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#2/)
    expect(r.out).toMatch(/#1/)
    expect(r.out).toMatch(/migration/)
    expect(r.out).toMatch(/ci/)
  })

  it('cap ya copado por trabajo en vuelo → dice cuántos hay en vuelo y cuál es el cap, aunque haya ready sin colisión', () => {
    const fx = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['db'], name: 'en curso', type: 'backend' },
        { n: 2, order: 2, status: 'ready', deps: [], touches: ['ui'], name: 'sin colisión', type: 'backend' },
      ],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/cap.*1/i)
    expect(r.out).toMatch(/#1/)
    expect(r.out).not.toContain('#2 (') // #2 nunca llega a evaluarse/lanzarse: el cap ya está lleno
    // Aquí subir --cap SÍ resolvería algo (#2 no colisiona con nada en
    // vuelo), así que el mensaje sigue sugiriéndolo tal cual (fix Minor 1: no
    // se toca el mensaje para el caso en que subir --cap SÍ ayuda).
    expect(r.out).toMatch(/sube --cap/i)
    expect(r.out).not.toMatch(/no bastaría/i)
  })

  // Fix Minor 1 de la review de W-B: antes, "cap lleno" siempre sugería
  // "sube --cap" — incluso cuando el único candidato que quedaría también
  // estaría bloqueado por otra causa (aquí, deps sin mergear). Subir el cap
  // en ese caso no cambiaría nada; el mensaje ahora lo dice explícitamente en
  // vez de prometer en falso.
  it('cap ya copado Y el ready también tiene deps sin mergear → dice que subir --cap no bastaría, y por qué', () => {
    const fx = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['x'], name: 'en curso', type: 'backend' },
        { n: 2, order: 2, status: 'ready', deps: [1], touches: [], name: 'con dep pendiente', type: 'backend' },
      ],
      mergedIssues: [], // la dep de #2 (orden 1, o sea #1) no está mergeada
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/cap.*1/i)
    expect(r.out).toMatch(/no bastaría/i)
    expect(r.out).toMatch(/dependencias sin mergear/i)
    expect(r.out).not.toMatch(/sube --cap, o espera/i) // no promete que subir el cap resuelva nada
  })
})

// W-B (§8), punto 4 del brief: "el dry-run tiene que hacer visible el estado
// en vuelo: qué está in-progress y qué tokens tiene retenidos por eso" — sin
// esto, un --dry-run que SÍ selecciona algo podía dar la falsa impresión de
// que no hay nada corriendo ya, cuando en realidad el cap ya estaba parcialmente
// ocupado por invocaciones anteriores.
describe('ct-next --dry-run — visibilidad del trabajo en vuelo (W-B, §8)', () => {
  it('sin nada en vuelo → lo dice explícitamente ("ninguno")', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/en vuelo.*ninguno/is)
  })

  it('con algo en vuelo (y aun así se despacha otro) → lista el issue en vuelo y sus tokens retenidos', () => {
    const fx = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['migration'], name: 'en curso', type: 'backend' },
        { n: 2, order: 2, status: 'ready', deps: [], touches: ['ui'], name: 'nuevo', type: 'backend' },
      ],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '2', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/en vuelo/i)
    expect(r.out).toMatch(/#1/)
    expect(r.out).toMatch(/migration/)
    // y el segundo slice se despacha igual, sin colisión
    expect(r.out).toContain('#2')
    expect(r.out).toContain('git worktree add')
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
    join(fixturesDir, 'fake-claude-bin'),
    process.env.PATH,
  ].join(':')

  const dirs = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSyncBestEffort(d)
  })

  function runReal(args, envOverrides = {}) {
    try {
      const out = execFileSync('node', [script, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'], // finding 11: no ecoar el ruido esperado al padre
        env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...envOverrides },
      })
      return { code: 0, out }
    } catch (e) {
      return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
    }
  }

  // combinedOutputOf (F8): stdout y stderr del hijo van AL MISMO descriptor de
  // fichero, así que lo que queda escrito es la transcripción en el orden REAL
  // de emisión — lo único con lo que se puede afirmar honestamente que una
  // línea salió antes que otra cuando las dos van por streams distintos.
  // Concatenar `e.stdout + e.stderr`, que es lo que hace `runReal`, ordena por
  // stream, no por tiempo.
  function combinedOutputOf(args, envOverrides = {}) {
    const logPath = join(mkdtempSync(join(tmpdir(), 'ct-next-combined-')), 'combined.log')
    dirs.push(dirname(logPath))
    const fd = openSync(logPath, 'w')
    try {
      spawnSync('node', [script, ...args], {
        stdio: ['ignore', fd, fd],
        env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...envOverrides },
      })
    } finally {
      closeSync(fd)
    }
    return readFileSync(logPath, 'utf8')
  }

  function makeRepoRoot() {
    const d = mkdtempSync(join(tmpdir(), 'ct-next-repo-'))
    dirs.push(d)
    return d
  }

  const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }

  // FAKE_GIT_WORKTREE_ADD_AS_FILE (D4): el stub de `git worktree add` crea la
  // ruta del worktree COMO FICHERO, así que el `mkdirSync(`${wt}/.agent`)`
  // posterior de ct-next.mjs revienta con ENOTDIR de forma determinista, sin
  // depender de permisos. Antes, estos tests pre-creaban ese fichero ANTES de
  // arrancar ct-next.mjs; desde D4 (defecto 3) eso ya no sirve — ct-next.mjs
  // comprueba que el destino esté libre ANTES de reclamar, así que un
  // worktree pre-existente se detecta en el preflight y nunca llega al seed
  // (que es exactamente el arreglo). Crear el fichero DURANTE el `worktree
  // add` reproduce el mismo fallo del seed sin desactivar esa comprobación.
  it('el seed de STATE.md falla (el worktree resultó no ser un directorio) → limpia y avisa que se puede reintentar', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_WORKTREE_ADD_AS_FILE: '1',
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
    const counterFile = join(repoRoot, 'gh-list-count')
    const wtPath = join(repoRoot, '.worktrees', '42')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_WORKTREE_ADD_AS_FILE: '1',
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
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_WORKTREE_ADD_AS_FILE: '1',
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
    const counterFile = join(repoRoot, 'gh-list-count')
    const wtPath = join(repoRoot, '.worktrees', '42')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_WORKTREE_ADD_AS_FILE: '1',
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
    //
    // F8 — ESTA COMPROBACIÓN DE ORDEN ANTES NO COMPROBABA NADA. `runReal`
    // devuelve `e.stdout + e.stderr`: dos búferes CONCATENADOS, no una
    // transcripción intercalada. "lanzado #42" sale por console.log (stdout) y
    // "no se pudo lanzar cmux" por console.error (stderr), así que el primero
    // aparecía antes que el segundo en esa concatenación SIEMPRE — aunque el
    // proceso los hubiera emitido en el orden contrario. Una aserción de orden
    // sobre cosas que la propia captura ya ha ordenado por ti es verde por
    // construcción. `combinedOutputOf` corre el mismo comando con stdout y
    // stderr apuntando AL MISMO descriptor de fichero, que es lo único que da
    // el orden real de emisión.
    const idxLanzado42 = r.out.indexOf('lanzado #42')
    const idxFallo43 = r.out.indexOf('no se pudo lanzar cmux')
    expect(idxLanzado42).toBeGreaterThan(-1)
    expect(idxFallo43).toBeGreaterThan(-1)
    const interleaved = combinedOutputOf(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: makeRepoRoot(),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42, openIssue43], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count-2'),
      FAKE_CMUX_FAIL_NAME_SUBSTR: '#43',
    })
    expect(interleaved.indexOf('lanzado #42')).toBeGreaterThan(-1)
    expect(interleaved.indexOf('no se pudo lanzar cmux')).toBeGreaterThan(-1)
    expect(interleaved.indexOf('lanzado #42')).toBeLessThan(interleaved.indexOf('no se pudo lanzar cmux'))
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
    join(fixturesDir, 'fake-claude-bin'),
    process.env.PATH,
  ].join(':')

  const dirs = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSyncBestEffort(d)
  })

  function runReal(args, envOverrides = {}) {
    try {
      const out = execFileSync('node', [script, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...envOverrides },
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
    // W-B: sin issues abiertos, el motivo pasa a ser "none-ready" (el mensaje
    // genérico que este test comprobaba antes ya no se emite).
    expect(r.out).toMatch(/no hay ningún issue en status:ready/i)
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
    join(fixturesDir, 'fake-claude-bin'),
    process.env.PATH,
  ].join(':')
  const dirs = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSyncBestEffort(d)
  })
  function runReal(args, envOverrides = {}) {
    try {
      const out = execFileSync('node', [script, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...envOverrides },
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

  // Re-review: el normalizado `state_reason` (REST, minúsculas) →
  // `stateReason` (lo que espera filterMergedIssues, mayúsculas) no tenía NI
  // UN test — exactamente la superficie de regresión señalada en el finding
  // 2. Sin este normalizado, TODO issue cerrado deja de contar como
  // mergeado, y cualquier slice con dependencias queda permanentemente sin
  // despachar (el bug que esta rama ya tuvo una vez). Escenario: el issue
  // cerrado #1 (orden 1) tiene `state_reason: 'completed'` tal cual lo
  // devuelve el endpoint REST; el issue abierto #2 (orden 2, ready) declara
  // `merge-after #1` (orden). Si el normalizado se rompe (se borra el
  // `.toUpperCase()`, o se vuelve a leer `i.stateReason`), #1 deja de contar
  // como mergeado y #2 nunca se selecciona.
  it('normaliza state_reason (REST, minúsculas) a stateReason (mayúsculas) — un dep mergeada vía state_reason:"completed" desbloquea el slice', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ct-next-statereason-'))
    dirs.push(repoRoot)
    const counterFile = join(repoRoot, 'gh-list-count')
    const openIssue2 = {
      number: 2, title: '#2 endpoint', labels: [{ name: 'status:ready' }],
      body: 'algo\n## Dependencias\n- merge-after #1\n\n<!-- ct-order:2 -->',
    }
    const closedIssue1 = { number: 1, state_reason: 'completed', body: '<!-- ct-order:1 -->' }
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue2], [closedIssue1]]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    expect(r.out).toContain('#2')
    expect(r.out).not.toMatch(/no hay slices despachables/i)
  })
})

// D1 finding 1 (el más grave del hardening del dispatch): reproducción
// END-TO-END, contra el CAMINO REAL de ct-next.mjs (gh api repos/.../issues,
// nunca CT_NEXT_FIXTURE), del escenario exacto que verificó el auditor: epic
// A groomeado y mergeado por completo (milestone 100), epic B groomeado
// DESPUÉS en el MISMO repo (milestone 200) — ambos numeran sus slices 1..N
// desde 1. #8 (slice 2 de epic B) declara "merge-after #1" (orden 1 DE SU
// PROPIO epic), que es #7. Antes de este fix, el índice de orden era global
// al repo y `[...open, ...closed]` hacía que el #1 de epic A (ya mergeado)
// ganara el slot — #8 se habría despachado junto a #7 en la misma tanda, sin
// haber esperado nunca a #7 de verdad, y sin que nada se imprimiera.
describe('ct-next — D1 finding 1: alcance del orden por epic (milestone), camino real (gh api)', () => {
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
  function runReal(args, envOverrides = {}) {
    try {
      const out = execFileSync('node', [script, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...envOverrides },
      })
      return { code: 0, out }
    } catch (e) {
      return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
    }
  }

  it('reproducción del auditor: epic A mergeado + epic B en curso, mismos números de orden, milestones DISTINTOS → #8 espera a su hermano real (#7), nunca al #1 ya mergeado de epic A', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ct-next-epics-'))
    dirs.push(repoRoot)
    const counterFile = join(repoRoot, 'gh-list-count')
    const openIssue7 = {
      number: 7, title: '#7 cimiento epicB', labels: [{ name: 'status:ready' }],
      milestone: { number: 200 }, body: '<!-- ct-order:1 -->',
    }
    const openIssue8 = {
      number: 8, title: '#8 encima de epicB', labels: [{ name: 'status:ready' }],
      milestone: { number: 200 },
      body: 'algo\n## Dependencias\n- merge-after #1\n\n<!-- ct-order:2 -->',
    }
    const closedIssue1 = { number: 1, state_reason: 'completed', milestone: { number: 100 }, body: '<!-- ct-order:1 -->' }
    const closedIssue2 = { number: 2, state_reason: 'completed', milestone: { number: 100 }, body: '<!-- ct-order:2 -->' }
    const r = runReal(['--repo', 'o/r', '--cap', '5', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue7, openIssue8], [closedIssue1, closedIssue2]]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    // Solo #7 se despacha. #8 nunca aparece como slice lanzado — el fix hace
    // que su dep resuelva contra #7 (su propio epic), que sigue sin mergear.
    expect(r.out).toContain('slice #7')
    expect(r.out).not.toContain('slice #8')
  })

  // Review de D1, finding 4: el aborto ANTERIOR (exit 1, batch entero) tenía
  // un radio demasiado ancho — una colisión de orden solo hace sospechoso el
  // EPIC en el que vive, pero bloqueaba TODO el repo, incluidos epics sanos
  // y sin ninguna relación. Peor: como buildOrderIndex indexa también los
  // CERRADOS, una colisión que solo exista entre issues mergeados hace
  // tiempo (un epic ya terminado, del que a nadie le importa nada hoy)
  // ladrillaría el repo ENTERO para siempre, sin más remedio que editar
  // GitHub a mano. Abortar en vez de resolver en silencio sigue siendo la
  // dirección correcta — lo que cambia es el RADIO: ahora solo el/los
  // epic(s) cuyo propio orden colisiona quedan excluidos de la selección
  // (ni se despachan ni cuentan en vuelo) — el resto del repo se despacha
  // con normalidad, exit 0, con un aviso explícito de qué epic quedó fuera y
  // por qué.
  it('si dos epics comparten milestone por error → SOLO ese epic queda excluido de la tanda (aviso explícito), un epic sano y sin relación se despacha con normalidad', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ct-next-collision-'))
    dirs.push(repoRoot)
    const counterFile = join(repoRoot, 'gh-list-count')
    const openIssue7 = {
      number: 7, title: '#7 a', labels: [{ name: 'status:ready' }],
      milestone: { number: 100 }, body: '<!-- ct-order:1 -->',
    }
    const openIssue8 = {
      number: 8, title: '#8 b', labels: [{ name: 'status:ready' }],
      milestone: { number: 100 }, body: '<!-- ct-order:1 -->', // MISMO milestone, MISMO orden, issue distinto
    }
    // Epic totalmente sano y sin relación (milestone 300): tiene que
    // despacharse igual, sin que la colisión de otro epic lo bloquee.
    const openIssue20 = {
      number: 20, title: '#20 sano', labels: [{ name: 'status:ready' }],
      milestone: { number: 300 }, body: '<!-- ct-order:1 -->',
    }
    const r = runReal(['--repo', 'o/r', '--cap', '5', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue7, openIssue8, openIssue20], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/colisi[oó]n/i)
    expect(r.out).toMatch(/#7/)
    expect(r.out).toMatch(/#8/)
    expect(r.out).toMatch(/avis/i)
    // #7/#8 (el epic colisionado) nunca se despachan...
    expect(r.out).not.toContain('slice #7')
    expect(r.out).not.toContain('slice #8')
    // ...pero #20 (epic sano, sin ninguna relación) SÍ, sin que la colisión
    // ajena se lo impida.
    expect(r.out).toContain('slice #20')
  })

  // Reproducción del escenario que preocupaba a la review: la colisión vive
  // SOLO entre issues YA CERRADOS de un epic viejo y terminado — nadie tiene
  // trabajo pendiente ahí. Un epic nuevo, sano, sin relación, tiene que
  // despacharse con total normalidad; el aviso de la colisión histórica
  // puede seguir imprimiéndose (información real), pero nunca debe impedir
  // nada del resto del repo.
  it('una colisión que vive SOLO entre issues cerrados hace tiempo no bloquea un epic nuevo y sano', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ct-next-collision-closed-'))
    dirs.push(repoRoot)
    const counterFile = join(repoRoot, 'gh-list-count')
    const closedIssueOld1 = { number: 50, state_reason: 'completed', milestone: { number: 100 }, body: '<!-- ct-order:1 -->' }
    const closedIssueOld2 = { number: 51, state_reason: 'completed', milestone: { number: 100 }, body: '<!-- ct-order:1 -->' } // mismo (epic,orden) que #50 → colisión histórica
    const openIssueNew = {
      number: 60, title: '#60 nuevo y sano', labels: [{ name: 'status:ready' }],
      milestone: { number: 400 }, body: '<!-- ct-order:1 -->',
    }
    const r = runReal(['--repo', 'o/r', '--cap', '5', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssueNew], [closedIssueOld1, closedIssueOld2]]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    expect(r.out).toContain('slice #60')
  })

  // Reproducción EXACTA de la review para el finding 1 (parte "falta el
  // aviso"): #8 depende, por texto, de un `#1` escrito bajo "## Descripción"
  // en vez de "## Dependencias" — el estrechamiento (D1 finding 2) hace que
  // ya no cuente como dependencia real, así que #7 Y #8 se despachan los dos
  // (decisión correcta, sin cambios), pero AHORA se avisa explícitamente de
  // que la referencia de #8 fuera de sección se ignoró.
  it('merge-after fuera de "## Dependencias" (bajo "## Descripción") → ambos #7 y #8 se despachan igual (estrechamiento correcto), pero se avisa de la referencia ignorada', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ct-next-straydeps-'))
    dirs.push(repoRoot)
    const counterFile = join(repoRoot, 'gh-list-count')
    const openIssue7 = {
      number: 7, title: '#7 cimiento', labels: [{ name: 'status:ready' }],
      milestone: { number: 200 }, body: '<!-- ct-order:1 -->',
    }
    const openIssue8 = {
      number: 8, title: '#8 encima', labels: [{ name: 'status:ready' }],
      milestone: { number: 200 },
      body: '## Descripción\nhace referencia a merge-after #1 pero no en la sección correcta\n\n<!-- ct-order:2 -->',
    }
    const r = runReal(['--repo', 'o/r', '--cap', '5', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue7, openIssue8], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    expect(r.out).toContain('slice #7')
    expect(r.out).toContain('slice #8') // el estrechamiento es correcto: NO se bloquea
    expect(r.out).toMatch(/avis/i)
    expect(r.out).toMatch(/#8/)
    expect(r.out).toMatch(/Dependencias/)
  })
})
