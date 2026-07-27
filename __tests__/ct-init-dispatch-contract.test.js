import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { SERIALIZING_TOUCHES, selectNext, planDispatch } from '../scripts/dispatch.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'ct-init.sh')

// F11, parte A. El criterio de éxito es el mismo que el de la ronda F6 sobre
// el groom: alguien que solo lee el repo tiene que poder predecir lo que
// `/ct-next` va a hacer. El contrato que siembra ct-init cubría el groom (qué
// escribir en la tabla) y casi nada del dispatch (qué pasa después) — todo lo
// que sigue es deducible del código del plugin, pero no llegaba a ningún
// fichero del repo destino.
//
// Cada aserción de aquí se corresponde con un comportamiento REAL verificado
// en el código; los tests que cierran el fichero atan las afirmaciones que
// tienen una fuente de verdad ejecutable (los touches serializantes) para que
// no puedan divergir en silencio.
function seed() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-'))
  execFileSync('bash', [script, dir], { encoding: 'utf8' })
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
  rmSync(dir, { recursive: true, force: true })
  return agents
}

const V1 = readFileSync(join(root, '__tests__', 'fixtures', 'slices-contract-v1.md'), 'utf8')
// V4: el bloque tal cual lo emitía el plugin ANTES de F13 (hash
// 02247741…, ya registrado en SLICES_PRISTINE_HASHES). Es el control negativo
// de los tests de F13: sirve para demostrar que las afirmaciones nuevas no
// estaban ahí antes, igual que V1 lo es para los de F11.
const historicalBlockV4 = () => readFileSync(join(root, '__tests__', 'fixtures', 'slices-contract-v4.md'), 'utf8')

// flat: el bloque sin negritas markdown y con los saltos de línea del wrapping
// colapsados. Las afirmaciones que se comprueban aquí son de PROSA — que el
// contrato lo diga — no de maquetación: sin esto, reflowear un párrafo (o
// poner una palabra en negrita) rompería el test sin que el contrato hubiera
// dejado de decir nada.
const flat = (s) => s.replace(/\*/g, '').replace(/\s+/g, ' ')

describe('contrato §9: qué hace /ct-next con lo que groomeas', () => {
  it('control: el contrato anterior no decía NADA de esto (los tests de abajo no pasan por casualidad)', () => {
    expect(V1).not.toMatch(/se salta|no se despacha/i)
    expect(V1).not.toMatch(/--cap/)
    expect(V1).not.toMatch(/heartbeat/i)
    // `cmux` aparecía UNA vez, de pasada ("el nombre del workspace cmux"), sin
    // decir nunca qué es ni que hace falta tenerlo.
    expect(V1.match(/cmux/gi) || []).toHaveLength(1)
    expect(V1).not.toMatch(/PATH/)
  })

  it('dice que un token compartido con un claim activo BLOQUEA (no avisa): el slice no se despacha', () => {
    const a = seed()
    // La regla de colisión enunciada, no solo su vocabulario.
    expect(a).toMatch(/status:in-progress/)
    expect(a).toMatch(/no se despacha|se salta/i)
    // Y que basta UN token compartido.
    expect(a).toMatch(/un solo token|un único token|UN token/i)
  })

  it('distingue la colisión por token de la serialización global, que son dos reglas actuando a la vez', () => {
    const a = seed()
    for (const t of SERIALIZING_TOUCHES) expect(a).toContain(t)
    // Lo que la hace DISTINTA: dos slices con touches serializantes distintos
    // no comparten ningún token y aun así no pueden volar a la vez.
    expect(a).toMatch(/no comparten ning[úu]n token|sin compartir ning[úu]n token/i)
  })

  it('dice que `merge-after` significa MERGEADO (issue cerrado como completado), no aprobado ni en review', () => {
    const a = seed()
    expect(a).toMatch(/merge-after/)
    expect(a).toMatch(/cerrado/i)
    expect(a).toMatch(/aprobad|en review|status:in-review/i)
    // Y la consecuencia que cambia decisiones: quién es el cuello de botella.
    expect(a).toMatch(/cuello de botella|bloquea a todos|nada.{0,40}avanza/i)
  })

  it('dice cuántos slices despacha una invocación y qué hace falta para una ventana de paralelismo', () => {
    const a = seed()
    expect(a).toMatch(/--cap/)
    expect(a).toMatch(/por defecto\s*(es\s*)?`?1`?/i)
    // El cap es GLOBAL (cuenta lo ya en vuelo), no un tope por invocación:
    // sin esto, un segundo /ct-next parece que "no hace nada".
    expect(a).toMatch(/en vuelo/i)
  })

  it('dice que /ct-next NO acota por epic: barre todos los epics del repo y elige por el # más bajo', () => {
    const a = seed()
    expect(a).toMatch(/no\s+(hay|tiene)\s+`?--milestone`?/i)
    expect(a).toMatch(/dos epics|dos epic/i)
    // Y cuál es la palanca que sí existe para elegir qué epic avanza.
    expect(a).toMatch(/status:ready/)
  })

  it('y admite que un EMPATE de # entre dos epics no está definido, en vez de callarlo', () => {
    // Caso que nadie pidió, encontrado al leer selectNext: el orden se
    // resuelve con `.sort((a, b) => a.order - b.order)` sobre TODOS los issues
    // abiertos del repo. Con dos epics vivos, dos slices distintos pueden
    // tener el MISMO `#`, y entonces gana el que GitHub haya devuelto primero.
    // El control de abajo lo demuestra contra el código real; el contrato no
    // puede prometer un orden que no existe.
    const mk = (n, order, t) => ({ n, order, status: 'ready', deps: [], touches: [t], name: `s${n}` })
    expect(selectNext([mk(10, 1, 'ui'), mk(20, 1, 'api')], { concurrencyCap: 1 })[0].n).toBe(10)
    expect(selectNext([mk(20, 1, 'api'), mk(10, 1, 'ui')], { concurrencyCap: 1 })[0].n).toBe(20)
    expect(flat(seed())).toMatch(/no est[áa] definido|sin orden garantizado/i)
  })

  it('documenta cmux: qué es, que hace falta, y qué pasa si no está', () => {
    const a = seed()
    expect(a).toMatch(/cmux/)
    expect(a).toMatch(/PATH/)
    expect(flat(a)).toMatch(/ning[úu]n slice|nada se lanza|no puede lanzar/i)
    // No es requisito de groom: distinguirlo evita instalarlo "por si acaso".
    expect(a).toMatch(/\/ct-groom/)
  })

  it('dice qué pasa si interrumpes /ct-next y si re-invocarlo es idempotente', () => {
    const a = seed()
    expect(a).toMatch(/Ctrl-C|SIGINT/)
    expect(a).toMatch(/revierte|revertir/i)
    expect(a).toMatch(/idempotent/i)
    // Worktree/rama huérfanos: se detectan antes de reclamar, no a mitad.
    expect(a).toMatch(/\.worktrees\/<n>/)
    expect(a).toMatch(/feat\/<n>/)
  })

  it('dice que el claim es un label SIN heartbeat: un slice muerto bloquea a los que compartan sus tokens', () => {
    const a = seed()
    expect(a).toMatch(/heartbeat|caduca|expira/i)
    expect(a).toMatch(/a mano/i)
    // El comando exacto de liberación, que es lo que se necesita a las 3 AM.
    expect(a).toMatch(/gh issue edit .*status:ready.*status:in-progress|gh issue edit .*status:in-progress/)
  })

  it('dice que cada slice en vuelo tiene SU .agent/STATE.md, el de su worktree', () => {
    const a = seed()
    expect(a).toMatch(/\.worktrees\/<n>\/\.agent\/STATE\.md|\.agent\/STATE\.md.{0,80}worktree/s)
    expect(a).toMatch(/no se pisan|uno por worktree|no comparten/i)
  })

  it('dice qué contexto recibe el agente despachado — y qué NO recibe', () => {
    const a = seed()
    expect(a).toMatch(/kickoff/i)
    // Se hidrata del ISSUE, no del spec: lo que no esté en el issue no llega.
    expect(flat(a)).toMatch(/no recibe el spec|nunca lee el spec|no lee el spec/i)
    expect(a).toMatch(/Acceptance criteria|criterios de aceptaci/i)
  })

  it('sigue siendo una sección, no un manual: remite a commands/ct-next.md para la referencia de invocación', () => {
    const a = seed()
    expect(a).toMatch(/commands\/ct-next\.md/)
  })
})

// ============================================================================
// F13 — el contrato v4 PROMETÍA garantías que el código no da. Esto no es
// redacción: son cuatro afirmaciones que un lector usaba para tomar decisiones
// (qué tokens poner, en qué orden mergear, qué hacer con un slice descartado)
// y que eran falsas o incompletas. Cada test de aquí ata una corrección
// contra una fuente ejecutable cuando la hay.
// ============================================================================
describe('contrato §9 (F13): lo que promete coincide con lo que el código hace', () => {
  it('control: el contrato v4 no decía NADA de esto (los tests de abajo no pasan por casualidad)', () => {
    const v4 = historicalBlockV4()
    // La promesa vieja, tal cual: "serializan globalmente… en todo el repo",
    // sin decir nunca de qué conjunto sale ese "todo".
    expect(v4).toMatch(/serializan\s+\*\*globalmente\*\*/)
    expect(v4).toMatch(/en todo el repo/)
    expect(flat(v4)).not.toMatch(/solo mira issues de ESTE repo/i)
    // No había ninguna salida de in-review: era un estado terminal.
    expect(v4).not.toMatch(/--reopen/)
    // La trampa de "not planned" SÍ estaba (F11 la escribió); la OPUESTA —
    // cerrar como completed sin mergear satisface la dep igualmente, y eso no
    // se detecta — no estaba, y además el texto sugería lo contrario
    // ("cerrado como completado (lo que ocurre al mergear su PR)").
    expect(v4).toMatch(/not planned/)
    expect(v4).not.toMatch(/no se detecta/i)
    expect(flat(v4)).toMatch(/lo que ocurre al mergear su PR/)
    // Y la regla de colisión hablaba SOLO de in-progress.
    expect(flat(v4)).not.toMatch(/in-progress o status:in-review/i)
    expect(v4).not.toMatch(/compare-and-swap/)
  })

  it('dice el ALCANCE REAL de la serialización: los issues de este repo, no "todo el repo"', () => {
    // El código (dispatch.js#collectTokenHolders + ct-next.mjs#loadIssues)
    // solo mira issues de ESTE repo con status in-progress/in-review. Otra
    // rama, otro track, o un humano a mano son invisibles — el contrato lo
    // vendía como una garantía global.
    const a = flat(seed())
    expect(a).toMatch(/solo mira issues de ESTE repo/i)
    expect(a).toMatch(/status:in-progress/)
    expect(a).toMatch(/INVISIBLE|invisible/)
    expect(a).toMatch(/global al flujo de issues de este repo/i)
  })

  it('dice que un token se retiene hasta el MERGE, y que in-review también bloquea', () => {
    const a = flat(seed())
    expect(a).toMatch(/status:in-review/)
    expect(a).toMatch(/hasta que el PR se mergea|retiene.{0,60}hasta el merge/i)
    // Y la consecuencia práctica que cambia cómo diseñas la tabla.
    expect(a).toMatch(/un PR sin mergear frena a sus vecinos de área/i)
    // Control contra el código: un ready que comparte token con un in-review
    // NO se selecciona. Si esto dejara de ser cierto, el contrato mentiría.
    const holder = { n: 1, order: 1, status: 'in-review', deps: [], touches: ['api'] }
    const cand = { n: 2, order: 2, status: 'ready', deps: [], touches: ['api'] }
    expect(planDispatch([holder, cand], { mergedIssues: [], cap: 5 }).selected).toEqual([])
  })

  it('dice que in-review NO ocupa cap, que es la otra mitad de la regla', () => {
    const a = flat(seed())
    expect(a).toMatch(/`?status:in-review`? \*?\*?no\*?\*? ocupa cap|no.{0,20}ocupa cap/i)
    // Control contra el código: con cap 1 y un in-review de tokens ajenos, el
    // ready SÍ sale.
    const holder = { n: 1, order: 1, status: 'in-review', deps: [], touches: ['api'] }
    const cand = { n: 2, order: 2, status: 'ready', deps: [], touches: ['ui'] }
    expect(planDispatch([holder, cand], { mergedIssues: [], cap: 1 }).selected.map((i) => i.n)).toEqual([2])
  })

  it('enumera las DOS trampas de "cerrado ≠ mergeado", incluida la que no se detecta', () => {
    const a = flat(seed())
    expect(a).toMatch(/not planned/)
    expect(a).toMatch(/para siempre/i)
    // La dirección opuesta, que es la que el plugin NO puede detectar: hay
    // que decirlo, no callarlo.
    expect(a).toMatch(/no se detecta/i)
    expect(a).toMatch(/completed.{0,120}sin haber mergeado|sin haber mergeado.{0,120}completed/i)
  })

  it('documenta la salida de in-review para un PR rechazado, con el comando', () => {
    const a = seed()
    expect(a).toMatch(/--reopen/)
    expect(flat(a)).toMatch(/no es un estado terminal|NO\*?\*? es un estado terminal/i)
    // Los dos caminos con el worktree/rama que ya existen — sin esto, reabrir
    // "funciona" y el siguiente /ct-next se niega sin explicar por qué.
    expect(a).toMatch(/\.worktrees\/<n>/)
    expect(a).toMatch(/feat\/<n>/)
    expect(flat(a)).toMatch(/corregir encima/i)
    expect(flat(a)).toMatch(/empezar de cero/i)
  })

  it('admite que la colisión y el cap solo valen para UN dispatcher a la vez', () => {
    // El claim es un label sin compare-and-swap: dos /ct-next concurrentes
    // pueden reclamar el mismo token. Estaba dicho en commands/ct-next.md
    // pero NO en el contrato, que es el fichero que lee quien escribe la
    // tabla y decide los tokens.
    const a = flat(seed())
    expect(a).toMatch(/compare-and-swap/i)
    expect(a).toMatch(/no lances dos dispatchers a la vez/i)
  })

  it('la nota de pie declara la MISMA versión que el marcador del bloque', () => {
    // El v4 declaraba `<!-- ct-init:slices-contract-version: 4 -->` y su nota
    // de pie decía "contrato v3": el número que ve un humano y el que lee el
    // script llevaban desincronizados una versión entera.
    const a = seed()
    const marker = a.match(/<!-- ct-init:slices-contract-version: (\d+) -->/)
    const footer = a.match(/Esta sección la mantiene `\/ct-init` \(contrato v(\d+)\)/)
    expect(marker).not.toBeNull()
    expect(footer).not.toBeNull()
    expect(footer[1]).toBe(marker[1])
  })
})
