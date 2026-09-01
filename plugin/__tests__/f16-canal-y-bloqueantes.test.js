// F16 — DOS HALLAZGOS DE CAMPO DE LA PRIMERA CORRIDA REAL DE /ct-next.
//
//   H1  El mensaje de bloqueo nombraba UN bloqueante cuando había cinco, e
//       implicaba un remedio que no desbloquea nada. En la corrida real había
//       cuatro `touches:ci` y un `touches:migration` ocupando el carril
//       serializante GLOBAL, y el dispatcher citó uno solo: quien lo leyera
//       resolvería ese, volvería a correr, y se encontraría igual de
//       bloqueado. Cuatro veces seguidas.
//   H2  Los avisos de ct-next iban por STDOUT; los de ct-groom, por STDERR.
//       Dos comandos del mismo plugin usando canales distintos para lo mismo.
//
// Cada test de este fichero se comprobó ROJO contra el código sin arreglar —
// la salida observada está anotada en el propio test.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planDispatch, selectNext, collisionBlockers, SERIALIZING_TOUCHES } from '../scripts/dispatch.js'
import { hermeticEnv } from './fixtures/hermetic-env.js'

const here = dirname(fileURLToPath(import.meta.url))
const ctNext = join(here, '..', 'scripts', 'ct-next.mjs')
const ctGroom = join(here, '..', 'scripts', 'ct-groom.mjs')
const fixturesDir = join(here, 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
]

// Devuelve stdout y stderr POR SEPARADO — es justo lo que H2 pone en juego,
// así que este helper no puede concatenarlos como hacen los helpers de los
// otros ficheros.
function runNext(args, env = {}) {
  const r = spawnSync('node', [ctNext, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...hermeticEnv(fakePath), ...env },
  })
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') }
}

// ============================================================================
// H1 — el carril serializante GLOBAL con varios ocupantes.
// ============================================================================
describe('F16/H1 — cuando bloquean N, el mensaje no puede nombrar uno solo', () => {
  // Reproducción del caso de campo: 4 × touches:ci + 1 × touches:migration
  // reteniendo el carril, un candidato con touches:pbxproj.
  const CAMPO = {
    issues: [
      { n: 10, order: 1, status: 'in-review', deps: [], touches: ['ci'], name: 'a' },
      { n: 11, order: 2, status: 'in-review', deps: [], touches: ['ci'], name: 'b' },
      { n: 12, order: 3, status: 'in-review', deps: [], touches: ['ci'], name: 'c' },
      { n: 13, order: 4, status: 'in-review', deps: [], touches: ['ci'], name: 'd' },
      { n: 14, order: 5, status: 'in-review', deps: [], touches: ['migration'], name: 'e' },
      { n: 20, order: 6, status: 'ready', deps: [], touches: ['pbxproj'], name: 'f' },
    ],
    mergedIssues: [],
  }

  // OBSERVADO SIN ARREGLAR (dispatch.js:55-56): blockReason era
  //   { reason:'collision', kind:'serializing', issue:20, token:'pbxproj',
  //     runningToken:'ci', withIssue:10, withIssueStatus:'in-review' }
  // — un solo bloqueante, sin ninguna traza de los otros cuatro.
  it('planDispatch expone TODOS los ocupantes del carril, no solo el primero', () => {
    const plan = planDispatch(CAMPO.issues, { mergedIssues: [], cap: 3 })
    expect(plan.selected).toEqual([])
    expect(plan.blockReason.reason).toBe('collision')
    expect(plan.blockReason.blockers.map((b) => b.n)).toEqual([10, 11, 12, 13, 14])
    // Ninguno comparte token literal con #20 (pbxproj): los cinco bloquean
    // por CARRIL, y eso tiene que quedar distinguible en el dato.
    expect(plan.blockReason.blockers.every((b) => b.sharedTokens.length === 0)).toBe(true)
    expect(plan.blockReason.blockers.map((b) => b.laneTokens)).toEqual([['ci'], ['ci'], ['ci'], ['ci'], ['migration']])
    // Y se conserva la forma vieja (primer bloqueante) para no romper a
    // ningún consumidor existente.
    expect(plan.blockReason.withIssue).toBe(10)
  })

  // OBSERVADO SIN ARREGLAR: la línea decía «...que touches:ci, retenido por
  // #10 (status:in-review) — #10 está en status:in-review: ... Mergea su PR;
  // ...». Ni #11, ni #12, ni #13, ni #14 aparecían en ningún sitio del
  // mensaje, y "Mergea su PR" (singular, de #10) no desbloquea nada.
  it('ct-next nombra los cinco y dice que hay que despejarlos TODOS', () => {
    const r = runNext(['--repo', 'o/r', '--cap', '3', '--dry-run'], { CT_NEXT_FIXTURE: JSON.stringify(CAMPO) })
    expect(r.code).toBe(0)
    for (const n of [10, 11, 12, 13, 14]) expect(r.stdout).toMatch(new RegExp(`#${n}\\b`))
    expect(r.stdout).toMatch(/5 issues?/)
    expect(r.stdout).toMatch(/TODOS/)
    // Lo esencial: el mensaje tiene que decir explícitamente que resolver uno
    // no sirve — es la deducción equivocada que el mensaje viejo invitaba a
    // hacer.
    expect(r.stdout).toMatch(/resolver uno solo/i)
  })

  // Un caso que nadie pidió, mismo defecto: el candidato toca DOS tokens y
  // cada uno lo retiene un issue distinto.
  // OBSERVADO SIN ARREGLAR: token:'api', withIssue:1 — #2 (que retiene 'db')
  // no salía por ningún lado.
  it('varios tokens compartidos, cada uno con su dueño → salen todos', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'], name: 'a' },
      { n: 2, order: 2, status: 'in-review', deps: [], touches: ['db'], name: 'b' },
      { n: 3, order: 3, status: 'ready', deps: [], touches: ['api', 'db'], name: 'c' },
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 9 })
    expect(plan.blockReason.blockers.map((b) => [b.n, b.sharedTokens])).toEqual([[1, ['api']], [2, ['db']]])
    const r = runNext(['--repo', 'o/r', '--cap', '9', '--dry-run'], { CT_NEXT_FIXTURE: JSON.stringify({ issues, mergedIssues: [] }) })
    expect(r.stdout).toMatch(/#1\b/)
    expect(r.stdout).toMatch(/#2\b/)
    expect(r.stdout).toMatch(/'api'/)
    expect(r.stdout).toMatch(/'db'/)
  })

  // Otro caso que nadie pidió: el MISMO token retenido por dos issues a la
  // vez (uno in-progress, otro in-review — perfectamente posible con labels
  // puestas a mano o con un --release entre medias).
  // OBSERVADO SIN ARREGLAR: withIssue:1 y nada más; mergear/esperar a #1 no
  // desbloquea porque #2 sigue reteniendo 'api'.
  it('un mismo token retenido por DOS issues → los dos salen', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'], name: 'a' },
      { n: 2, order: 2, status: 'in-review', deps: [], touches: ['api'], name: 'b' },
      { n: 3, order: 3, status: 'ready', deps: [], touches: ['api'], name: 'c' },
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 9 })
    expect(plan.blockReason.blockers.map((b) => b.n)).toEqual([1, 2])
    const r = runNext(['--repo', 'o/r', '--cap', '9', '--dry-run'], { CT_NEXT_FIXTURE: JSON.stringify({ issues, mergedIssues: [] }) })
    expect(r.stdout).toMatch(/#1\b/)
    expect(r.stdout).toMatch(/#2\b/)
    // Estados mezclados: el remedio NO es el mismo para los dos, y el
    // mensaje tiene que decir ambos.
    expect(r.stdout).toMatch(/in-progress/)
    expect(r.stdout).toMatch(/in-review/)
  })

  // El peor de todos, y el que nadie me dio: la colisión por token TAPA una
  // colisión de carril detrás. Resolver el token compartido te deja
  // bloqueado por el carril, con un mensaje nuevo. Dos vueltas para
  // descubrir dos paredes.
  // OBSERVADO SIN ARREGLAR: primero {kind:'token', withIssue:1}; tras
  // mergear #1, {kind:'serializing', withIssue:2}.
  it('un token compartido no puede tapar el carril serializante que hay detrás', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-review', deps: [], touches: ['ci'], name: 'a' },
      { n: 2, order: 2, status: 'in-review', deps: [], touches: ['migration'], name: 'b' },
      { n: 3, order: 3, status: 'ready', deps: [], touches: ['ci'], name: 'c' },
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 9 })
    expect(plan.blockReason.kind).toBe('token') // el kind primario no cambia
    expect(plan.blockReason.blockers.map((b) => b.n)).toEqual([1, 2])
    expect(plan.blockReason.blockers[0].sharedTokens).toEqual(['ci'])
    expect(plan.blockReason.blockers[1].laneTokens).toEqual(['migration'])
    const r = runNext(['--repo', 'o/r', '--cap', '9', '--dry-run'], { CT_NEXT_FIXTURE: JSON.stringify({ issues, mergedIssues: [] }) })
    expect(r.stdout).toMatch(/#2\b/)
    expect(r.stdout).toMatch(/serializante/)
  })

  // El exceso contrario también es un defecto: cuarenta issues listados no
  // son accionables. Se lista una muestra y se dice cuántos hay en total —
  // lo que hace falta para DECIDIR es el número, no los cuarenta nombres.
  it('con muchos bloqueantes se acota la lista pero NUNCA el recuento', () => {
    const issues = []
    for (let n = 1; n <= 30; n++) issues.push({ n, order: n, status: 'in-review', deps: [], touches: ['ci'], name: `s${n}` })
    issues.push({ n: 99, order: 99, status: 'ready', deps: [], touches: ['migration'], name: 'cand' })
    const r = runNext(['--repo', 'o/r', '--cap', '9', '--dry-run'], { CT_NEXT_FIXTURE: JSON.stringify({ issues, mergedIssues: [] }) })
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/30 issues/)
    expect(r.stdout).toMatch(/y \d+ más/)
    // No se vomitan los treinta.
    const citados = new Set((r.stdout.match(/#(\d+)/g) || []).map((s) => s.slice(1)))
    expect(citados.size).toBeLessThan(20)
  })

  // Control negativo: con UN solo bloqueante el mensaje de siempre no cambia
  // (los tests de F13/staleness lo fijan literalmente, y añadir "hay que
  // despejarlos todos" cuando solo hay uno sería ruido).
  it('con un único bloqueante el mensaje sigue siendo el de siempre', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'], name: 'a' },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'b' },
    ]
    const r = runNext(['--repo', 'o/r', '--cap', '9', '--dry-run'], { CT_NEXT_FIXTURE: JSON.stringify({ issues, mergedIssues: [] }) })
    expect(r.stdout).toMatch(/#2 está ready con deps mergeadas, pero colisiona con trabajo en vuelo: comparte el token 'api' con #1 \(status:in-progress\)/)
    expect(r.stdout).not.toMatch(/resolver uno solo/i)
  })
})

// ============================================================================
// La ATRIBUCIÓN nueva no puede divergir del GATE que decide de verdad.
//
// `touchesConflict` sigue siendo el único predicate de colisión (lo usa el
// `continue` de selectNext); `collisionBlockers` solo atribuye. Que los dos
// digan lo mismo estaba afirmado en un comentario y en nada más — y una
// divergencia ahí produciría exactamente el fallo que esta tanda persigue: un
// mensaje que nombra bloqueantes cuando no los hay, o que se calla el único
// que hay. Este oráculo lo comprueba por comportamiento, sobre el espacio
// completo de touches relevantes, no sobre un puñado de ejemplos elegidos.
//
// Poder discriminante comprobado con DOS sabotajes reales sobre
// `collisionBlockers`, no supuesto:
//   - `laneActive = false` (ignorar el carril entero) → ROJO, y el primer
//     contraejemplo que escupe es `cand=["migration"] holder=["ci"]`: el gate
//     bloquea y la atribución no encuentra a nadie.
//   - `laneActive = candHasSerializing` (activar el carril sin exigir que
//     haya alguien dentro) → VERDE, y con razón: si no hay ningún holder
//     serializante, tampoco hay ninguno que listar, así que las dos versiones
//     coinciden en TODO el espacio. Ese segundo sabotaje NO es una laguna del
//     test — es una redundancia real del código, y queda dicha aquí en vez de
//     fingir una cobertura que no existe.
describe('F16 — atribución y gate no pueden divergir (oráculo exhaustivo)', () => {
  it('collisionBlockers() no vacío ⟺ selectNext descarta al candidato', () => {
    const universo = [...SERIALIZING_TOUCHES, 'api', 'ui', 'db']
    // Todos los subconjuntos de hasta 2 tokens (incluido el vacío).
    const combos = [[]]
    for (const a of universo) {
      combos.push([a])
      for (const b of universo) if (a !== b) combos.push([a, b])
    }
    let bloqueos = 0
    let libres = 0
    for (const candT of combos) {
      for (const holderT of combos) {
        const cand = { n: 100, order: 1, status: 'ready', deps: [], touches: candT }
        const holders = [{ n: 1, status: 'in-progress', touches: holderT }]
        const blockers = collisionBlockers(cand, holders)
        const seleccionado = selectNext([cand], { mergedIssues: [], runningTouches: holderT, concurrencyCap: 1 })
        const gateBloquea = seleccionado.length === 0
        expect(blockers.length > 0, `cand=${JSON.stringify(candT)} holder=${JSON.stringify(holderT)}`).toBe(gateBloquea)
        if (gateBloquea) bloqueos++
        else libres++
      }
    }
    // Sin esto, un oráculo que nunca viera un bloqueo (o nunca un caso libre)
    // pasaría por casualidad: se exige que el espacio recorrido tenga de los
    // dos.
    expect(bloqueos).toBeGreaterThan(100)
    expect(libres).toBeGreaterThan(100)
  })

  it('un holder que no bloquea NUNCA aparece en la lista (control negativo)', () => {
    const cand = { n: 3, order: 3, status: 'ready', deps: [], touches: ['api'] }
    const holders = [
      { n: 1, status: 'in-progress', touches: ['ui'] },   // nada que ver
      { n: 2, status: 'in-review', touches: ['api'] },    // este sí
      { n: 4, status: 'in-review', touches: [] },         // sin touches
    ]
    expect(collisionBlockers(cand, holders).map((b) => b.n)).toEqual([2])
  })

  it('el carril NO se invoca si el candidato no toca ningún token serializante', () => {
    const cand = { n: 3, order: 3, status: 'ready', deps: [], touches: ['api'] }
    const holders = [{ n: 1, status: 'in-progress', touches: ['migration', 'ci'] }]
    expect(collisionBlockers(cand, holders)).toEqual([])
  })
})

// ============================================================================
// H1, misma lente sobre 'none-ready': un caso que nadie me dio.
// ============================================================================
describe('F16/H1 — "no hay nada que despachar TODAVÍA" mandaba esperar algo que no llega solo', () => {
  // OBSERVADO SIN ARREGLAR, con tres issues en status:backlog:
  //   "No hay ningún issue en status:ready — no hay nada que despachar todavía."
  // "todavía" invita a esperar; promover backlog → ready es un gate HUMANO
  // deliberado (ct-groom hasta imprime un recordatorio sobre ello). Nadie va
  // a hacerlo si el dispatcher dice que aún no toca.
  it('con issues en backlog, dice que el gate es humano y cómo se abre', () => {
    const issues = [
      { n: 1, order: 1, status: 'backlog', deps: [], touches: ['api'], name: 'a' },
      { n: 2, order: 2, status: 'backlog', deps: [], touches: ['ui'], name: 'b' },
      { n: 3, order: 3, status: 'backlog', deps: [], touches: ['db'], name: 'c' },
    ]
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: JSON.stringify({ issues, mergedIssues: [] }) })
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/3 .*status:backlog/)
    expect(r.stdout).toMatch(/--add-label status:ready/)
    expect(r.stdout).not.toMatch(/no hay nada que despachar todavía/)
  })

  // OBSERVADO SIN ARREGLAR: con CERO issues abiertos salía exactamente el
  // mismo texto que con tres en backlog — dos situaciones con remedios
  // opuestos (promover vs. groomear / revisar --repo) indistinguibles.
  it('con CERO issues abiertos no dice lo mismo que con issues en backlog', () => {
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: JSON.stringify({ issues: [], mergedIssues: [] }) })
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/ning[uú]n issue abierto/i)
    expect(r.stdout).toMatch(/ct-groom|--repo/)
  })
})

// ============================================================================
// H2 — un solo criterio de canal para los tres ejecutables.
// ============================================================================
describe('F16/H2 — los avisos de los tres ejecutables van por el mismo canal', () => {
  // OBSERVADO SIN ARREGLAR: una corrida de /ct-next con avisos dejaba 0 bytes
  // en stderr (ct-next.mjs:888 emitía `console.log(\`aviso: ...\`)`), mientras
  // ct-groom.mjs emite los suyos por console.error.
  it('ct-next manda los avisos a STDERR, no a stdout', () => {
    // F35: el vehículo era el aviso de "cuenta por defecto" de ACCOUNT_MAP,
    // que ya no existe. Se usa `--base`, que avisa por lo mismo de siempre
    // (una base que no sea la rama por defecto rompe las closing keywords) y
    // no depende de nada del entorno.
    const fx = JSON.stringify({ issues: [], mergedIssues: [] })
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--base', 'otra-rama', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.stderr).toMatch(/aviso: --base otra-rama/)
    expect(r.stdout).not.toMatch(/^aviso:/m)
  })

  it('ct-groom sigue mandando los suyos a STDERR (el canal de referencia)', () => {
    const r = spawnSync('node', [ctGroom, '/no/existe/spec.md', '--repo', 'o/r', '--dry-run'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env },
    })
    expect(r.stderr).toMatch(/no se pudo leer el spec/)
    expect(r.stdout).toBe('')
  })

  // El plan (lo que alguien podría querer capturar o parsear) sigue saliendo
  // por stdout, sin mezclarse con el diagnóstico.
  it('el plan de despacho sigue siendo stdout limpio, sin avisos dentro', () => {
    const fx = JSON.stringify({
      issues: [{ n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'refresh', type: 'backend' }],
      mergedIssues: [],
    })
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--base', 'otra-rama', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.stdout).toMatch(/git worktree add/)
    expect(r.stdout).not.toMatch(/aviso:/)
    expect(r.stderr).toMatch(/aviso:/)
  })

  // El recap de avisos del manejador de 'exit' ya iba por stderr (writeSync 2)
  // y sigue ahí: sin él, un exit 0 con avisos se lee como "todo bien".
  it('el recap final de avisos sigue en stderr y cuenta los mismos avisos', () => {
    const fx = JSON.stringify({ issues: [], mergedIssues: [] })
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--base', 'otra-rama', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.stderr).toMatch(/A PESAR de \d+ aviso\(s\)/)
  })
})
