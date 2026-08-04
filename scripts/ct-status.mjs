#!/usr/bin/env node
// /ct-status — QUÉ PREGUNTA RESPONDE: «¿en qué estado está el loop ahora
// mismo?», entera y en una sola llamada. Tres cubos, agrupados por lo que hay
// que hacer con ellos, no por el tipo de dato del que salen:
//
//   EN VUELO             qué slices están reclamados, y si alguien los está
//                        trabajando de verdad (proceso `claude` dentro del
//                        worktree) o sólo lo parece (worktree y rama en disco).
//   ENTREGADO, SIN COSECHAR  qué slices ya cerrados dejan worktree o rama.
//   RESIDUO              labels `status:` vivas sobre issues cerrados, y
//                        worktrees que ningún issue reclama.
//
// Antes de este comando el coordinador se lo componía a mano CADA VEZ,
// cruzando pgrep + lsof + gh issue view + gh pr list + git worktree list + git
// rev-list. Eso ya costó un error medido: una de esas comprobaciones usó `gh
// issue list --state closed --limit 60` sobre 99 issues cerrados y reportó 6
// casos cuando eran 10 — con un fallback que además imprimía «(ninguno —
// limpio)». Por eso aquí NINGUNA lectura lleva `--limit`: todo pagina.
//
// NO MUTA NADA. Ni labels, ni worktrees, ni ramas: sólo lee. Es la propiedad
// que permite invocarlo sin pensárselo —y la que deja que lo invoque un
// vigilante externo en bucle—, así que está atada por un test que mira el
// argv REAL con el que se llamó a `gh` (__tests__/ct-status.test.js), no la
// mera ausencia de errores. Nombrar y no borrar es deliberado y viene de
// `collectFinishedResidue` (dispatch.js): borrar el worktree de alguien que
// sigue trabajando es irreversible.
//
// EL 1 NUNCA SE DEGRADA A 0, y ésta es la regla dura del comando. Los tres
// códigos son los mismos que usa /ct-groom: 0 = nada que revisar, 3 = hay algo
// que revisar, 1 = no se pudo comprobar. La precedencia es 1 > 3 > 0 — nunca
// al revés — porque una lectura incompleta NO es un loop en reposo, y quien
// reciba la señal tiene que poder distinguirlas: el bug que originó todo esto
// fue exactamente un informe que decía «limpio» sobre datos truncados. De ahí
// dos conductas concretas de este fichero: la línea de «loop en reposo» sólo
// se imprime cuando NO hay ninguna lectura pendiente, y un worktree en disco
// no se acusa de huérfano si la lectura de issues falló (sin issues no se
// sabe quién lo reclama; decirlo igual sería inventar el hallazgo).
//
// Un hallazgo parcial tampoco oculta el resto: si falla la lectura de procesos
// pero la de issues va bien, se informa de lo que sí se sabe, se avisa de lo
// que no, y se sale con 1.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { cargarIssues } from './loop-issues.js'
import { liveSliceProcesses } from './liveness.js'
import { construirEstado } from './loop-estado.js'
import { mapGhIssue, filterMergedIssues, closedWithLiveStatus } from './gh-issue-map.js'
import { parseRepoSlug } from './dispatch.js'

// `arg()` endurecido: el MISMO de ct-next.mjs/ct-groom.mjs/dispatch-check.mjs,
// palabra por palabra y por el mismo motivo medido. Sólo devuelve un string
// cuando el flag trae de verdad un valor; si el flag es el último token de
// argv, o el siguiente token es a su vez otro flag (empieza por `--`),
// devuelve `true` (presente-sin-valor) en vez de colarlo como valor. La
// versión ingenua (`process.argv[i + 1]` tal cual) hacía que un `--milestone`
// colgante creara en GitHub un milestone literalmente titulado "true", y que
// `--project` sin valor se convirtiera en `1` (`Number(true) === 1`). Aquí no
// hay mutaciones que corromper, pero un `--repo` colgante sí llegaría a `gh
// api repos/true/issues` y produciría un informe sobre un repo que no existe:
// el call-site de más abajo lo rechaza explícitamente, igual que los hermanos.
const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}

const usage = 'uso: ct-status.mjs --repo <owner/repo>'
const repo = arg('--repo')
if (repo === true) {
  console.error(`--repo inválido: "(sin valor)" — ${usage}`)
  process.exit(2)
}
if (typeof repo !== 'string' || repo.length === 0) { console.error(usage); process.exit(2) }
// Forma de `--repo`: el mismo criterio (y la misma función) que /ct-next, para
// que `--repo menoplus` no muera con un 404 sin explicar que el problema era
// la forma del argumento.
if (!parseRepoSlug(repo)) {
  console.error(`--repo inválido: "${repo}" — debe tener la forma owner/repo (p.ej. josemerca/control-tower), con exactamente una barra y ambas mitades no vacías.`)
  process.exit(2)
}

// VENTANA_ARRANQUE_MS: por debajo de esta edad de claim, un slice sin proceso
// se informa como «arrancando», no como «sin señal de vida». Justo después de
// un despacho, cmux está tecleando el comando y `claude` todavía no ha
// arrancado; sin esta ventana, mirar el estado en ese hueco acusaría de
// abandono a un slice perfectamente sano. El valor es el presupuesto del
// centinela de arranque de /ct-next (DEFAULT_LAUNCH_SENTINEL_TIMEOUT_MS,
// ct-next.mjs) y se lee de la MISMA variable de entorno, con el mismo tope: si
// alguien se lo sube al dispatcher, este informe tiene que moverse con él o
// diría «muerto» sobre slices que el dispatcher todavía está esperando. La
// diferencia con /ct-next es qué se hace ante un valor que no se entiende: el
// dispatcher aborta con exit 2 (va a mutar cosas), y aquí, que sólo se lee, se
// avisa y se sigue con el default — cerrar el informe por una variable mal
// puesta sería peor que informarlo.
const VENTANA_ARRANQUE_DEFECTO_MS = 15000
const VENTANA_ARRANQUE_TOPE_MS = 600_000
let ventanaArranqueMs = VENTANA_ARRANQUE_DEFECTO_MS
const ventanaRaw = process.env.CT_NEXT_LAUNCH_TIMEOUT_MS
if (ventanaRaw !== undefined && ventanaRaw !== '') {
  const n = Number(ventanaRaw)
  if (!Number.isFinite(n) || n < 0 || n > VENTANA_ARRANQUE_TOPE_MS) {
    console.error(`aviso: CT_NEXT_LAUNCH_TIMEOUT_MS inválido ("${ventanaRaw}", debe ser un número entre 0 y ${VENTANA_ARRANQUE_TOPE_MS}) — se usa el valor por defecto de ${VENTANA_ARRANQUE_DEFECTO_MS} ms para decidir qué claim es demasiado reciente como para esperar un proceso.`)
  } else {
    ventanaArranqueMs = n
  }
}

// maxBuffer: el default de execFileSync es 1 MiB y aquí no hay ningún
// `--limit` que acote la respuesta (a propósito) — un repo con unos cientos de
// issues con body completo lo supera con facilidad. Mismo valor que
// ct-next.mjs/ct-groom.mjs. timeout+killSignal: un `gh` colgado (red a medias,
// auth que no responde) no puede dejar este comando esperando para siempre.
const GH_MAX_BUFFER = 20 * 1024 * 1024
const CHILD_TIMEOUT_MS = 10 * 60 * 1000

// El stderr del hijo va a `pipe`, no a `inherit` como en ct-next.mjs: aquí el
// mensaje de `gh` no es sólo diagnóstico suelto, es el MOTIVO que viaja dentro
// de `sinComprobar` hasta el informe. Y se prefiere ese texto al `e.message`
// de Node ("Command failed: gh api repos/…" con el argv entero dentro), que
// entierra la razón real bajo doscientos caracteres de línea de comandos.
const gh = (a) => {
  try {
    return execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: GH_MAX_BUFFER, timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' })
  } catch (e) {
    const detalle = (e && e.stderr ? String(e.stderr).trim() : '') || (e && e.message) || 'error desconocido'
    throw new Error(detalle)
  }
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' })

// motivos: todo lo que NO se pudo comprobar. Es lo único que decide el exit 1,
// así que nada que llegue aquí puede acabar en un informe que se lea como
// «nada que revisar».
const motivos = []

// ---------------------------------------------------------------- issues ---
// La lectura de issues va dentro de un try porque `cargarIssues` LANZA en vez
// de salir del proceso: un módulo compartido no decide por su llamante, y este
// llamante quiere informar de lo que sí sabe en vez de abortar. El Error que
// lanza ya nombra cuál de las dos lecturas falló (abiertos o cerrados).
let abiertos = []
let cerrados = []
let issuesLeidos = true
try {
  ;({ abiertos, cerrados } = cargarIssues({ repo, gh }))
} catch (e) {
  issuesLeidos = false
  motivos.push(e.message)
}

const mapeados = abiertos.map(mapGhIssue)
const enProgreso = mapeados.filter((i) => i.status === 'in-progress').map((i) => ({ n: i.n, nombre: i.name }))
const mergeados = filterMergedIssues(cerrados)
const cerradosConStatus = closedWithLiveStatus(cerrados)
// statusAbiertoPorNumero: para poder decir la VERDAD sobre un worktree que
// ningún issue en vuelo ni entregado explica — ver el bloque de residuo del
// render. No cuesta ninguna llamada más: sale de los issues ya leídos.
const statusAbiertoPorNumero = new Map(mapeados.map((i) => [String(i.n), i.status]))

// ------------------------------------------------------------ el checkout ---
// La raíz del repo local. Ojo con lo que este comando NO comprueba: que el
// checkout desde el que se invoca sea el de `--repo`. /ct-next sí lo exige,
// porque va a crear ramas y worktrees dentro; aquí no se escribe nada, así que
// la única consecuencia de invocarlo desde otro sitio es un informe que cruza
// los issues de un repo con los worktrees de otro. Queda dicho en
// commands/ct-status.md, donde lo lee quien usa el comando.
let repoRoot = null
try {
  repoRoot = git(['rev-parse', '--show-toplevel']).trim()
} catch (e) {
  motivos.push(`no se pudo resolver la raíz del repo git local (${(e.stderr ? String(e.stderr).trim() : '') || e.message}): no se han podido mirar ni los worktrees, ni las ramas, ni los procesos`)
}

// worktreesEnDisco / ramasEnDisco: un fallo de lectura NUNCA se traduce a «no
// hay». Que `.worktrees/` no exista sí es una respuesta legítima (ningún
// dispatch ha creado nada todavía); cualquier otro error es una lectura que no
// se pudo hacer, y va a `motivos`.
let worktreesEnDisco = []
let ramasEnDisco = []
if (repoRoot) {
  try {
    worktreesEnDisco = readdirSync(join(repoRoot, '.worktrees'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch (e) {
    if (e && e.code === 'ENOENT') worktreesEnDisco = []
    else motivos.push(`no se pudo listar ${join(repoRoot, '.worktrees')} (${e.code || e.message}): este informe no dice nada sobre worktrees en disco`)
  }
  try {
    // --format en vez de parsear la salida decorada de `git branch`: sin él,
    // la rama actual llega con un "* " delante y ninguna casaría con `feat/N`.
    ramasEnDisco = git(['-C', repoRoot, 'branch', '--list', 'feat/*', '--format=%(refname:short)'])
      .split('\n').map((s) => s.trim()).filter(Boolean)
  } catch (e) {
    motivos.push(`no se pudieron listar las ramas feat/* (${(e.stderr ? String(e.stderr).trim() : '') || e.message}): este informe no dice nada sobre ramas en disco`)
  }
}

// ---------------------------------------------------------- señal de vida ---
// La única señal que responde «¿alguien está trabajando AHORA?» en vez de
// «¿queda rastro?». Devuelve `comprobado: false` con su motivo cuando pgrep o
// lsof no están o fallan; el compositor lo convierte en `vivo: null` para todo
// el mundo, nunca en «muerto».
const procesos = repoRoot
  ? liveSliceProcesses(repoRoot)
  : { porSlice: new Map(), comprobado: false, motivo: 'no se pudo comprobar qué procesos trabajan en cada worktree: no se resolvió la raíz del repo local' }

// ---------------------------------------------------- la edad de cada claim ---
// Del TIMELINE del issue: el evento `labeled` más reciente para
// `status:in-progress`. No vale el `updated_at` del issue (que vendría gratis
// en el payload ya leído): cambia con cualquier edición —un comentario, otra
// label—, así que un comentario reciente haría pasar por «arrancando» un claim
// de hace tres horas. Y las labels no llevan fecha en el payload REST.
//
// Una llamada por issue EN VUELO, y «en vuelo» está acotado por el cap del
// dispatcher. `--paginate` sin `--slurp`: sobre un endpoint que devuelve un
// array, gh fusiona las páginas en un único array.
const edadClaimMs = new Map()
// motivosEdad: por qué no se pudo leer la edad de un claim concreto. Se guarda
// aparte porque el compositor sabe QUE falta, pero sólo aquí se sabe POR QUÉ —
// ver la sustitución de más abajo.
const motivosEdad = new Map()
const ahora = Date.now()
for (const { n } of enProgreso) {
  let eventos
  try {
    eventos = JSON.parse(gh(['api', `repos/${repo}/issues/${n}/timeline`, '--paginate']))
  } catch (e) {
    edadClaimMs.set(n, null)
    motivosEdad.set(n, `#${n}: no se pudo leer el timeline del issue, así que no se sabe cuánto lleva puesto su claim (${e.message})`)
    continue
  }
  const marcas = (Array.isArray(eventos) ? eventos : [])
    .filter((ev) => ev && ev.event === 'labeled' && ev.label && ev.label.name === 'status:in-progress')
    .map((ev) => Date.parse(ev.created_at))
    .filter((t) => Number.isFinite(t))
  // El ÚLTIMO `labeled`, no el primero: un slice reabierto con `--reopen`
  // vuelve a `status:in-progress`, y la edad que importa es la del claim
  // vigente, no la del primero de su historia.
  edadClaimMs.set(n, marcas.length ? ahora - Math.max(...marcas) : null)
}

// ------------------------------------------------------------ composición ---
// `worktreesEnDisco` sólo entra si los issues se leyeron: sin ellos, ni
// `enProgreso` ni `mergeados` pueden explicar nada, así que TODO worktree en
// disco saldría como huérfano. Ese hallazgo sería fabricado — exactamente la
// clase de afirmación confiada sobre datos incompletos que este comando
// existe para eliminar. Se dice que no se ha mirado y se sigue.
if (!issuesLeidos && worktreesEnDisco.length) {
  motivos.push(`hay ${worktreesEnDisco.length} directorio(s) en .worktrees/ (${worktreesEnDisco.join(', ')}) que no se han cruzado con nada: sin la lista de issues no se puede saber quién los reclama`)
}
const estado = construirEstado({
  enProgreso,
  mergeados,
  cerradosConStatus,
  worktreesEnDisco: issuesLeidos ? worktreesEnDisco : [],
  ramasEnDisco,
  procesos,
  edadClaimMs,
  ventanaArranqueMs,
})

// El compositor emite un motivo genérico («#N: no se pudo determinar la
// antigüedad del claim») para cada slice sin vida y sin edad. Cuando el fallo
// fue de LECTURA, aquí se conoce la causa exacta, así que su motivo se
// SUSTITUYE por el concreto en vez de acumularse: dos líneas en stderr sobre
// el mismo issue por una sola causa se leen como dos problemas distintos.
const numeroCitado = (m) => {
  const x = /^#(\d+):/.exec(m)
  return x ? Number(x[1]) : null
}
const sinComprobar = [
  ...motivos,
  ...estado.sinComprobar.filter((m) => !motivosEdad.has(numeroCitado(m))),
  ...motivosEdad.values(),
]

// ---------------------------------------------------------------- informe ---
const VIVO = { true: '✓', false: '✗', null: '?' }
function formatearEdad(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 90) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 90) return `${m} min`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h`
  return `${Math.round(h / 24)} d`
}

const lineas = []
// Bloques vacíos NO se imprimen: un loop en reposo produce un informe corto,
// no tres encabezados con «(ninguno)». El fallback que imprimía «(ninguno —
// limpio)» sobre datos truncados es el bug que da nombre a todo esto.
if (estado.enVuelo.length) {
  lineas.push(`EN VUELO (${estado.enVuelo.length})`)
  for (const s of estado.enVuelo) {
    lineas.push(`  #${s.n}  ${s.nombre}`)
    const señales = [`worktree ${s.hasWorktree ? '✓' : '✗'}`, `rama ${s.hasBranch ? '✓' : '✗'}`, `proceso ${VIVO[String(s.vivo)]}`]
    if (s.pid) señales.push(`pid ${s.pid}`)
    let nota = ''
    if (s.vivo === null) nota = '  ← no se pudo comprobar si hay alguien trabajando (ver los avisos)'
    else if (s.arrancando) nota = '  ← arrancando: el claim es más reciente que la ventana de arranque, todavía no hay proceso que esperar'
    else if (s.vivo === false && s.edadMs !== null) nota = '  ← SIN SEÑAL DE VIDA'
    else if (s.vivo === false) nota = '  ← sin proceso, y sin saber de cuándo es el claim: no se acusa (ver los avisos)'
    lineas.push(`        ${señales.join('  ')}${nota}`)
    if (s.edadMs !== null) lineas.push(`        claim puesto hace ${formatearEdad(s.edadMs)}`)
  }
}

if (estado.cosecha.length) {
  if (lineas.length) lineas.push('')
  lineas.push(`ENTREGADO, SIN COSECHAR (${estado.cosecha.length})`)
  for (const c of estado.cosecha) {
    const queda = [c.hasWorktree ? `worktree .worktrees/${c.n}` : null, c.hasBranch ? `rama feat/${c.n}` : null].filter(Boolean)
    // «cerrado como completado», no «mergeado»: lo único observable sin cruzar
    // con el grafo de PRs es el `stateReason` del issue (ver filterMergedIssues
    // en gh-issue-map.js). Cerrar a mano como completed cuenta igual, y decir
    // «mergeado» sería afirmar algo que no se ha comprobado.
    lineas.push(`  #${c.n}  cerrado como completado, y todavía queda en disco: ${queda.join(' y ')}`)
  }
}

const residuoTotal = estado.residuo.labels.length + estado.residuo.worktreesHuerfanos.length
if (residuoTotal) {
  if (lineas.length) lineas.push('')
  lineas.push(`RESIDUO (${residuoTotal})`)
  for (const r of estado.residuo.labels) {
    lineas.push(`  #${r.n}  cerrado, pero conserva ${r.statusLabels.map((l) => `status:${l}`).join(' y ')}`)
  }
  for (const w of estado.residuo.worktreesHuerfanos) {
    // LA FRASE. El §6 del spec proponía «sin issue vivo que lo reclame», y esa
    // frase es FALSA en el caso más común de todos: un issue ABIERTO que no
    // está en `status:in-progress` (típicamente `status:in-review`, esperando
    // merge) no lo explica ni `enProgreso` ni `mergeados`, así que cae aquí —
    // con su issue perfectamente vivo. Son dos situaciones con dos remedios
    // distintos y el informe las distingue, porque cruzar el nombre del
    // directorio con los issues abiertos ya leídos no cuesta ninguna llamada.
    const status = statusAbiertoPorNumero.get(w)
    if (status) lineas.push(`  .worktrees/${w}  su issue #${w} sigue abierto (status:${status}) pero no está en vuelo: nadie lo está trabajando ahora`)
    else if (/^\d+$/.test(w)) lineas.push(`  .worktrees/${w}  ningún issue lo reclama: no hay ninguno abierto con ese número, ni ninguno entregado que lo dejara atrás`)
    else lineas.push(`  .worktrees/${w}  no corresponde al número de ningún issue`)
  }
  // La nota es sobre worktrees, así que sólo aparece cuando hay alguno: con
  // residuo de labels a secas hablaría de algo que no está en el informe.
  // Detectado corriendo el comando de verdad contra un repo con residuo real.
  if (estado.residuo.worktreesHuerfanos.length) {
    lineas.push('  (mientras un .worktrees/<n> exista, /ct-next se niega a despachar #<n> — este comando lo nombra, nunca lo borra)')
  }
}

// La línea de reposo SÓLO cuando no hay nada pendiente de comprobar. Afirmar
// que no hay nada, habiendo dejado una lectura a medias, es literalmente el
// bug del §3.2 del feedback de campo.
if (!lineas.length && !sinComprobar.length) {
  lineas.push('loop en reposo: nada en vuelo, nada por cosechar, nada de residuo.')
}

// Canal: el informe es el PRODUCTO y va por stdout; los motivos de lo que no
// se pudo comprobar son diagnóstico y van por stderr como el resto de
// `aviso:` del plugin. Los avisos se escriben ANTES del informe a propósito:
// matizan todo lo que viene debajo.
for (const m of sinComprobar) console.error(`aviso: ${m}`)

// El exit code lo decide `hayHallazgos` del compositor, no este recuento: el
// número es sólo para el humano, y calcularlo aquí no puede cambiar la señal
// que recibe un vigilante externo.
const cuantos = estado.enVuelo.filter((s) => s.vivo === false && !s.arrancando && s.edadMs !== null).length
  + estado.cosecha.length + residuoTotal
if (sinComprobar.length) {
  lineas.push(`exit 1 — ${sinComprobar.length} lectura(s) sin completar: lo de arriba es sólo lo que sí se ha podido comprobar`)
} else if (estado.hayHallazgos) {
  lineas.push(`exit 3 — hay ${cuantos} cosa(s) que revisar`)
} else {
  lineas.push('exit 0 — nada que revisar')
}
console.log(lineas.join('\n'))

process.exit(sinComprobar.length ? 1 : (estado.hayHallazgos ? 3 : 0))
