#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, writeSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { planDispatch, resolveAccount, buildCmuxArgv } from './dispatch.js'
import { renderKickoff, buildStateSeed, ACCOUNT_MAP } from './kickoff.js'
import { shQuote } from './shquote.js'
import { buildDispatchInput, NO_MILESTONE_KEY } from './gh-issue-map.js'
import { flattenIssuePages, realIssuesOnly } from './gh-issues.js'

// W-C: dispatch-check.mjs implementa el protocolo de claim completo (colisión
// + escritura + claim-then-verify) y ya está testeado en solitario, pero
// hasta ahora nada en el plugin lo invocaba — ningún issue llegaba nunca a
// status:in-progress en el loop real, así que el `runningTouches` del que
// depende W-B (para el cap y la colisión con trabajo en vuelo) estaba siempre
// vacío. Se resuelve la ruta SIEMPRE relativa a la propia ubicación de este
// fichero (import.meta.url, la URL real de ESTE módulo) — nunca una ruta
// absoluta fija ni un string de shell — porque dispatch-check.mjs vive al
// lado de ct-next.mjs dentro del plugin, con independencia de dónde esté
// instalado.
const dispatchCheckPath = join(dirname(fileURLToPath(import.meta.url)), 'dispatch-check.mjs')

// Fix round 1 (review de W-C), finding 2 — IMPORTANT: Node sale con exit 1
// (MODULE_NOT_FOUND) cuando el fichero que se le pide ejecutar no existe —
// el MISMO código que dispatch-check.mjs usa para "colisión/carrera
// perdida" (ver el contrato de exit codes en su cabecera). Sin este guard,
// un dispatch-check.mjs ausente o renombrado (plugin mal instalado o
// incompleto) haría que attemptClaim() lo clasificara como un resultado
// ESPERADO del protocolo: TODOS los slices de la tanda se saltarían
// ("saltando #N...") y el proceso terminaría con exit 0 sin haber
// despachado nada — un no-op silencioso, además de contradecir el propio
// mensaje de "fallo inesperado" de más abajo (que ya afirma cubrir este
// caso). Se comprueba UNA vez al arrancar, antes de tocar `gh` o crear nada.
if (!existsSync(dispatchCheckPath)) {
  console.error(`no se encontró dispatch-check.mjs en ${dispatchCheckPath} — el plugin parece estar incompleto o mal instalado (¿se movió/borró el fichero?). Abortando antes de intentar ningún claim: sin él, cada slice se leería en falso como "colisión" y la tanda entera terminaría en un no-op silencioso.`)
  process.exit(1)
}

// ============================================================================
// Finding 1 (auditoría, ronda de endurecimiento de interrupción/staleness):
// SIGINT/SIGTERM tras un claim confirmado. Antes de este cambio no había NI UN
// SOLO manejador de señal en este fichero — un Ctrl-C durante un `git worktree
// add` lento (repo grande) dejaba el issue reclamado (status:in-progress)
// PARA SIEMPRE: sin revert, sin worktree, sin agente, sin ni un mensaje. La
// reproducción del auditor (dispatch-check real que escribe el label y sale
// 0, `git` fake que se cuelga en `worktree add`, SIGINT a los 3s) confirma
// exactamente esto: EXIT=130 y el claim huérfano.
//
// DOS HALLAZGOS EMPÍRICOS que determinan el diseño (verificados por
// construcción, no asumidos — ver el informe de esta tarea para el
// experimento exacto):
//
//   (a) Un manejador `process.on('SIGINT', fn)` NUNCA se ejecuta mientras el
//       hilo principal está bloqueado dentro de una llamada síncrona a un
//       hijo (execFileSync/spawnSync) — ni durante el bloqueo, ni siquiera
//       DESPUÉS de que ese bloqueo termine (verificado: un hijo colgado que
//       ignora la señal, con la señal enviada solo al proceso node, deja el
//       callback SIN EJECUTAR incluso mucho después de que el propio timeout
//       de spawnSync lo desbloquee). El bucle síncrono de spawn_sync.cc vive
//       fuera del event loop de libuv; el callback de JS solo se procesa
//       cuando el event loop recupera el control.
//   (b) Un script 100% síncrono (sin ningún `await` real) TAMPOCO da nunca esa
//       oportunidad al event loop — verificado con un bucle ocupado puramente
//       en JS de 8s: el manejador jamás corre, ni durante el bucle ni después
//       de que termine, porque el proceso llega a su fin (y a su
//       `process.exit()`) sin haber cedido el control al event loop ni una
//       sola vez. Un `Atomics.wait` síncrono (el patrón que ya usa
//       dispatch-check.mjs para su propio hook de pruebas) tiene EXACTAMENTE
//       el mismo problema — no es un yield real.
//
// Consecuencia directa: instalar un manejador SIN, además, introducir puntos
// de cesión real (un `await` sobre un temporizador de verdad, `setTimeout`,
// NUNCA `Atomics.wait`) sería PEOR que no instalar nada — cambiaría la
// disposición por defecto de "el kernel mata el proceso al instante" (lo que
// hoy produce el EXIT=130 inmediato del auditor, sin limpieza pero sin
// cuelgue) a "la señal se encola y no se procesa nunca", es decir, un cuelgue
// silencioso e indefinido en vez de una muerte instantánea — el escenario que
// el propio encargo advierte explícitamente ("un manejador que se cuelgue él
// mismo sería peor que ninguno").
//
// Verificado también (mismo experimento, con un yield real vía
// `await new Promise(r => setTimeout(r, 0))`): con un punto de cesión real
// colocado justo después de un checkpoint seguro, una señal YA pendiente se
// procesa con una latencia de un puñado de milisegundos — no hay coste
// perceptible en el camino feliz (nada de esto se ejecuta mientras el proceso
// está bloqueado dentro de `git worktree add`/`gh`/dispatch-check: esos
// siguen siendo síncronos, y es ahí donde entra la segunda pata del diseño).
//
// DISEÑO (dos defensas independientes, ninguna basta por sí sola):
//
//   1. Puntos de cesión reales (`await sleep(ms)`, más abajo) en los dos
//      checkpoints seguros del bucle de despacho: justo antes de intentar un
//      nuevo claim (para no arrancar un claim más si ya se pidió parar), y
//      justo DESPUÉS de confirmar un claim y ANTES de crear su worktree (la
//      ventana exacta que describe el hallazgo: "el claim se escribió, el
//      worktree no existe todavía"). Esto atrapa una señal real en el caso
//      común: el proceso no está bloqueado en ESE instante exacto.
//   2. Una cota de tiempo (`timeout`+`killSignal:'SIGKILL'`) en TODA llamada
//      bloqueante a un subproceso que este script podría quedarse esperando
//      indefinidamente (dispatch-check.mjs, `git worktree add/remove`,
//      `git branch -D`, y el propio `gh()`): si un hijo está genuinamente
//      atascado y la señal solo llega a este proceso (nunca al hijo — el
//      caso más adverso, y el que reproduce el auditor), NINGÚN manejador de
//      JS puede rescatarnos (hallazgo (a) de arriba) — la única salida real es que
//      la propia llamada se rinda sola. Cuando expira, el hijo se mata
//      (SIGKILL: un hijo verdaderamente atascado puede estar ignorando
//      SIGTERM) y la excepción resultante cae en el catch YA EXISTENTE de
//      cada sitio (que ya revierte el claim) — sin este cambio, ese catch
//      nunca se alcanzaría.
//
// LÍMITE HONESTO que queda, documentado y no resuelto por este cambio: si la
// señal llega EXACTAMENTE en la microventana entre que el proceso retoma tras
// un `await sleep(...)` y el siguiente `execFileSync` arranca, puede perderse
// la carrera y el proceso entrar en la llamada bloqueante de todos modos —
// en ese caso, la defensa 2 (la cota de tiempo) es la que actúa, no la 1. No
// hay forma de cerrar esa microventana con JS puro contra un hijo que puede
// no cooperar; el objetivo aquí es acotarla (milisegundos, no segundos) y
// garantizar que, en el peor caso, el cuelgue tiene un techo, nunca "para
// siempre".
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// CT_NEXT_CHILD_TIMEOUT_MS: cota de tiempo para dispatch-check.mjs, `git
// worktree add/remove`, `git branch -D` y `gh()` (ver el razonamiento arriba,
// defensa 2). Generosa por defecto (10 minutos): de sobra para un listado de
// miles de issues o un worktree contra un repo grande, sin ser "sin límite"
// de verdad — un cuelgue real (el escenario de este finding) sigue acotado.
// Configurable para tests (necesitan poder ejercer el timeout sin esperar 10
// minutos de verdad); mismo patrón de validación (número finito, > 0, con
// techo para atrapar un typo tipo "1e12") que CT_CLAIM_PRECLAIM_DELAY_MS en
// dispatch-check.mjs.
const DEFAULT_CHILD_TIMEOUT_MS = 10 * 60 * 1000
const CHILD_TIMEOUT_CAP_MS = 24 * 60 * 60 * 1000
let childTimeoutMs = DEFAULT_CHILD_TIMEOUT_MS
const childTimeoutRaw = process.env.CT_NEXT_CHILD_TIMEOUT_MS
if (childTimeoutRaw !== undefined) {
  const n = Number(childTimeoutRaw)
  if (!Number.isFinite(n) || n <= 0 || n > CHILD_TIMEOUT_CAP_MS) {
    console.error(`CT_NEXT_CHILD_TIMEOUT_MS inválido: "${childTimeoutRaw}" — debe ser un número > 0 y <= ${CHILD_TIMEOUT_CAP_MS}`)
    process.exit(2)
  }
  childTimeoutMs = n
}

// CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS — exclusivamente para tests: ensancha de
// forma determinista (en vez de depender del scheduler del SO) la ventana
// real entre "claim confirmado" y "worktree creado" — normalmente solo un
// puñado de instrucciones JS — para poder enviar una señal DENTRO de ella de
// forma reproducible. Con la variable ausente (producción, y todos los tests
// que no la fijan) el valor es 0: el checkpoint sigue existiendo (sigue
// cediendo el control una vez al event loop, ver el razonamiento de arriba),
// pero sin ninguna espera añadida. No cambia qué se decide ni qué se
// escribe — solo ensancha una ventana que de por sí ya existe. Mismo patrón
// y mismo criterio de seguridad que CT_CLAIM_PRECLAIM_DELAY_MS en
// dispatch-check.mjs.
const TEST_DELAY_CAP_MS = 60_000
let testDelayAfterClaimMs = 0
const testDelayRaw = process.env.CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS
if (testDelayRaw !== undefined) {
  const n = Number(testDelayRaw)
  if (!Number.isFinite(n) || n < 0 || n > TEST_DELAY_CAP_MS) {
    console.error(`CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS inválido: "${testDelayRaw}" — debe ser un número entre 0 y ${TEST_DELAY_CAP_MS}`)
    process.exit(2)
  }
  testDelayAfterClaimMs = n
}
// ============================================================================

// `arg()` solo devuelve un string cuando el flag realmente trae un valor: si
// el flag es el último token de argv, o el token siguiente es a su vez otro
// flag (empieza por `--`), devolvemos `true` (presente-sin-valor) en vez de
// colarlo como valor. Mismo patrón que dispatch-check.mjs — ct-groom.mjs
// ahora también lo copia (fix de la review final: tenía el `arg()` sin
// endurecer, ver ct-groom.mjs) — un `--repo` colgante nunca llega a
// `execFileSync` como valor real.
const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}
const has = (f) => process.argv.includes(f)

// formatReason: traduce el `blockReason` que devuelve planDispatch
// (scripts/dispatch.js, lógica pura y testeada sin red) a un mensaje para el
// humano, para las causas que NO son "cap lleno" (ver formatBlockReason para
// esa). W-B (§8): antes había un único mensaje genérico ("nada ready con
// deps mergeadas y sin colisión") para cuatro causas muy distintas con
// remedios distintos — obligaba a adivinar. Este wrapper solo formatea
// texto; la DECISIÓN de cuál es la causa ya la tomó planDispatch. Extraída
// de formatBlockReason (fix Minor 1 de la review) para poder reutilizarla
// también dentro del mensaje de "cap lleno", cuando subir --cap tampoco
// bastaría (ver más abajo).
// ============================================================================
// Finding 2 (auditoría de interrupción/staleness): sin esto, el mensaje de
// "colisión con trabajo en vuelo" SIEMPRE dice "espera a que termine" — una
// afirmación que solo es cierta si de verdad hay algo corriendo. Nada en el
// dispatch cruzaba nunca un issue en status:in-progress contra evidencia
// local de que ALGO lo está trabajando de verdad — un claim huérfano
// (dejado así por una interrupción, ver finding 1, o por cualquier otra
// causa: un `gh` que falló a medias, un humano que mató el proceso a mano)
// es indistinguible de trabajo real desde la sola lectura de labels, y el
// usuario no tiene forma de saberlo desde la salida de /ct-next.
//
// SEÑALES QUE SE CONFÍAN, y por qué (todas puramente LOCALES — a esta
// máquina y a este checkout — nunca red, salvo la consulta local a cmux por
// su socket Unix):
//   - `<repoRoot>/.worktrees/<n>` existe como directorio.
//   - la rama `feat/<n>` existe en ESTE checkout local.
//   - una sesión cmux VIVA (en cualquier ventana de este cmux, consultada de
//     SOLO LECTURA vía `cmux list-windows` + `cmux workspace list --json` —
//     JAMÁS `new-workspace`: no se lanza nada) cuyo título contiene `#<n>`
//     como token completo (límite de palabra: `#41` no debe casar con
//     `#410`).
//
// CÓMO SE EVITA UN FALSO "esto está abandonado" — el riesgo explícito del
// encargo: llevaría a alguien a romper el claim de un agente que SÍ está
// trabajando, lo cual es peor que el silencio actual: "sin evidencia local"
// es la CONJUNCIÓN de las tres ausencias. Basta con que UNA sola señal
// indique vida (worktree, rama, o sesión cmux con ese número) para que NO
// se diga nada de staleness y el mensaje original quede intacto.
//
// Y aun cuando las tres estén ausentes, el mensaje NUNCA afirma
// "abandonado" sin matices: estas señales son solo de ESTA MÁQUINA — el
// mismo claim pudo hacerse desde otra máquina, o desde otra sesión de este
// mismo cmux que ya se cerró sin liberar el label; esta comprobación no
// puede verlo. El mensaje se limita a decir lo que se sabe (ausencia local)
// y lo que no se sabe (si sigue vivo en otro sitio) — nunca "espera a que
// termine" cuando no hay ninguna base local para afirmarlo.
//
// Si la propia consulta a cmux falla (no instalado, daemon caído, timeout)
// se trata como NO CONCLUYENTE, nunca como "no hay sesión": una consulta
// fallida no es evidencia de ausencia, y afirmar staleness con un tercio de
// la evidencia sin comprobar sería exactamente el tipo de aserción no
// verificada que esta tarea pide dejar de hacer.
const CMUX_QUERY_TIMEOUT_MS = 5000
// queryAllCmuxWorkspaces: consulta de solo lectura compartida por finding 2
// (staleness: ¿hay una sesión viva para un issue en vuelo?) y finding 3
// (¿la sesión que ACABAMOS de lanzar está de verdad en el directorio que le
// pedimos? — ver verifyCmuxLaunch, más abajo). Devuelve un array de
// `{title, cwd}` por CADA workspace, en TODAS las ventanas, o `null` si la
// consulta inicial (`list-windows`) no se pudo completar en absoluto (cmux
// no instalado, daemon caído, timeout).
function queryAllCmuxWorkspaces() {
  // CT_NEXT_FIXTURE (`fx`) promete NUNCA tocar nada real — ver el comentario
  // de cabecera de esa variable, más arriba en este fichero ("no se decide
  // ni se lanza nada real con datos de fixture"). Sin esta guarda, un
  // --dry-run con fixture que colisiona (`formatReason`, caso 'collision')
  // dispararía una llamada real a `cmux list-windows` — de solo lectura,
  // pero real, y exactamente la clase de fuga que ese comentario existe
  // para evitar. Verificado por construcción: dos tests existentes
  // (ct-next-dryrun.test.js, colisión por token y por serialización) usan
  // `run()` — sin PATH con stubs — precisamente porque hasta ahora nada en
  // la ruta de fixture tocaba un subproceso real; sin esta guarda pasarían
  // a invocar el `cmux` DE VERDAD de la máquina que corra los tests. En
  // modo fixture, la consulta se trata como "no concluyente" — igual que
  // cuando cmux no está disponible — nunca como "no hay sesión".
  if (fx) return null
  try {
    const windowsRaw = execFileSync('cmux', ['list-windows', '--json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: CMUX_QUERY_TIMEOUT_MS, killSignal: 'SIGKILL',
    })
    const windows = JSON.parse(windowsRaw)
    const out = []
    for (const w of (Array.isArray(windows) ? windows : [])) {
      if (!w || !w.id) continue
      try {
        const wsRaw = execFileSync('cmux', ['workspace', 'list', '--window', w.id, '--json'], {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: CMUX_QUERY_TIMEOUT_MS, killSignal: 'SIGKILL',
        })
        const parsed = JSON.parse(wsRaw)
        for (const ws of (parsed.workspaces || [])) {
          if (ws && typeof ws.custom_title === 'string') out.push({ title: ws.custom_title, cwd: ws.current_directory ?? null })
        }
      } catch {
        // Una ventana concreta que no se pueda consultar no invalida las
        // demás — se sigue con el resto; solo una consulta INICIAL fallida
        // (list-windows) marca el resultado global como no concluyente.
      }
    }
    return out
  } catch {
    return null // cmux no instalado, daemon caído, o timeout: no concluyente.
  }
}

function queryCmuxWorkspaceTitles() {
  const all = queryAllCmuxWorkspaces()
  if (all === null) return null
  return all.map((w) => w.title)
}

function assessLocalLiveness(n, cmuxTitles) {
  const wt = `${repoRoot}/.worktrees/${n}`
  const hasWorktree = existsSync(wt)
  let hasBranch = false
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/feat/${n}`], {
      cwd: repoRoot, stdio: 'ignore', timeout: childTimeoutMs, killSignal: 'SIGKILL',
    })
    hasBranch = true
  } catch {
    hasBranch = false
  }
  const cmuxChecked = cmuxTitles !== null
  const hasCmuxWorkspace = cmuxChecked && cmuxTitles.some((t) => new RegExp(`#${n}(\\D|$)`).test(t))
  return { hasWorktree, hasBranch, hasCmuxWorkspace, cmuxChecked }
}

function stalenessNote(n, liveness) {
  if (liveness.hasWorktree || liveness.hasBranch || liveness.hasCmuxWorkspace) return null
  if (!liveness.cmuxChecked) {
    return `no se encontró worktree ni rama local para #${n}, y no se pudo consultar cmux para confirmar si sigue habiendo una sesión activa (¿cmux no instalado, o el daemon no responde?) — no se puede descartar que el trabajo siga en curso en otro sitio; verifica a mano antes de asumir nada.`
  }
  return `no se encontró worktree, rama local, ni sesión cmux para #${n} EN ESTA MÁQUINA — el claim puede estar huérfano (interrumpido a medias, o reclamado desde otra máquina/sesión que ya no sigue aquí). Esta comprobación es solo local: no puede confirmar que nadie lo esté trabajando en otro sitio, así que tampoco afirmamos que esté abandonado — pero "espera a que termine" ya no es una afirmación segura con lo que se ve desde aquí. Verifica a mano antes de tocar el label.`
}

// stalenessCtxFor: helper perezoso y memoizado para formatReason/
// formatBlockReason — la consulta a cmux (list-windows + workspace list por
// cada ventana) solo se dispara la PRIMERA vez que de verdad hace falta (un
// motivo de bloqueo por colisión), nunca en los casos 'none-ready'/
// 'deps-unmet'/cap-full-con-hueco, para no pagar ese coste (acotado a
// CMUX_QUERY_TIMEOUT_MS, pero aun así una llamada real a un subproceso) en
// el camino común.
function stalenessCtxFor() {
  let cmuxTitlesCache
  let queried = false
  return {
    stalenessNoteFor(n) {
      if (!queried) {
        cmuxTitlesCache = queryCmuxWorkspaceTitles()
        queried = true
      }
      return stalenessNote(n, assessLocalLiveness(n, cmuxTitlesCache))
    },
  }
}
// ============================================================================

// Finding 3 (auditoría): la forma de comando de cmux es
// `/bin/zsh -lc '{ cd -- '\''<cwd>'\'' 2>/dev/null || [ ! -d '\''<cwd>'\'' ]; }
// && ...'` — TOLERA un cwd inexistente y arranca el agente en el directorio
// por defecto del shell de login de todas formas, saliendo con exit 0.
// ct-next.mjs imprimía "lanzado #N en <wt>" basándose SOLO en que
// `new-workspace` devolviera exit 0 — es decir, infería "está corriendo en
// el sitio correcto" de "el comando no falló", que es exactamente lo que
// este hallazgo dice que NO se puede inferir.
//
// verifyCmuxLaunch reutiliza la MISMA consulta de solo lectura que finding 2
// (queryAllCmuxWorkspaces — `list-windows` + `workspace list --json`, jamás
// `new-workspace`) para comprobar, DESPUÉS de que `new-workspace` ya
// devolvió éxito, si existe una sesión con el título exacto que se pidió y,
// si existe, si su `current_directory` coincide con el worktree esperado.
// Esto es lo MÁXIMO que se puede verificar sin lanzar nada nuevo: no dice
// nada sobre si el agente DENTRO de esa sesión está haciendo algo útil, pero
// sí distingue con evidencia real "está en el directorio correcto" de "cmux
// aceptó el comando pero acabó en otro sitio" — que es precisamente la
// mentira que este hallazgo pide dejar de contar.
function verifyCmuxLaunch(expectedTitle, expectedCwd) {
  const all = queryAllCmuxWorkspaces()
  if (all === null) return { status: 'unverifiable' }
  const match = all.find((w) => w.title === expectedTitle)
  if (!match) return { status: 'not-found' }
  if (match.cwd === expectedCwd) return { status: 'confirmed' }
  return { status: 'wrong-cwd', actualCwd: match.cwd }
}

function formatReason(reason, ctx) {
  switch (reason?.reason) {
    case 'none-ready':
      return 'No hay ningún issue en status:ready — no hay nada que despachar todavía.'
    case 'deps-unmet': {
      // D1 finding 2/5: dos causas MUY distintas terminaban antes en el mismo
      // mensaje genérico ("falta mergear #X"), una de ellas imprimiendo
      // directamente el string "#null" — instruyendo a esperar algo que no
      // existe y nunca se va a mergear.
      //   - `malformed` (finding 2): la sección "## Dependencias" del issue
      //     existe pero no se reconoció ningún "merge-after #N" — casi
      //     seguro una reescritura humana. El estado del gate es
      //     DESCONOCIDO, no "sin dependencias" (unmetDeps llega vacío a
      //     propósito desde dispatch.js — ver su comentario).
      //   - una dependencia que tradujo a `null` (finding 5,
      //     gh-issue-map.js#buildDispatchInput): el orden declarado no
      //     corresponde a NINGÚN issue existente (ni abierto ni cerrado, ni
      //     en el propio epic del issue) — nunca se va a resolver solo con
      //     esperar, hace falta corregir el dato.
      const list = reason.blocked.map((b) => {
        if (b.malformed) {
          return `#${b.n} (la sección "## Dependencias" existe pero no se reconoció ningún "merge-after #N" en su contenido — probablemente reescrita a mano; tratado como NO despachable hasta que se corrija el texto, nunca como "sin dependencias")`
        }
        const deps = b.unmetDeps.map((d) => (d == null
          ? 'una dependencia declarada contra un orden que no corresponde a ningún issue existente (¿"merge-after" a un slice que no existe, o que aún no se groomeó?) — nunca se resolverá sola con esperar; corrige el "merge-after" o el "ct-order" del issue referenciado'
          : `#${d}`))
        return `#${b.n} (falta mergear ${deps.join(', ')})`
      }).join('; ')
      return `Hay slice(s) en status:ready pero con dependencias sin mergear o sin resolver: ${list} — espera a que se mergeen esas dependencias, o corrige el issue si el bloqueo es por datos, no por trabajo pendiente.`
    }
    case 'collision': {
      // Finding 2: `ctx?.stalenessNoteFor(reason.withIssue)` solo hace algo
      // cuando `ctx` viene informado (siempre, desde el call site real de
      // más abajo) — se deja opcional para que las pruebas unitarias de esta
      // función sigan pudiendo llamarla sin un contexto, sin reventar.
      const note = ctx ? ctx.stalenessNoteFor(reason.withIssue) : null
      if (reason.kind === 'serializing') {
        const base = `#${reason.issue} está ready con deps mergeadas, pero no se puede serializar: su touches:${reason.token} entra en el mismo grupo serializante (migration/ci/pbxproj) que touches:${reason.runningToken}, ya en vuelo en #${reason.withIssue}`
        return note ? `${base} — ${note}` : `${base} — espera a que termine.`
      }
      const base = `#${reason.issue} está ready con deps mergeadas, pero colisiona con trabajo en vuelo: comparte el token '${reason.token}' con #${reason.withIssue} (status:in-progress)`
      return note ? `${base} — ${note}` : `${base} — espera a que termine, o resuelve el token.`
    }
    default:
      // No debería alcanzarse (ver el razonamiento en dispatch.js#explainNoSelection),
      // pero nunca imprimimos "undefined" en silencio ante una entrada inesperada.
      return 'No hay slices despachables (nada ready con deps mergeadas y sin colisión).'
  }
}

function formatBlockReason(reason, cap, ctx) {
  if (reason?.reason === 'cap-full') {
    // El listado de qué issues concretos están en vuelo ya se ve, en
    // --dry-run, en la línea "En vuelo" impresa justo antes (más abajo); aquí
    // solo hace falta el conteo y el cap para que el mensaje sea
    // autosuficiente también en la corrida real (sin --dry-run).
    const base = `El cap (${cap}) ya está copado por trabajo en vuelo: ${reason.inFlightCount} slice(s) en status:in-progress`
    // Fix Minor 1 de la review: sin `wouldDispatchIfCapAllowed`, este mensaje
    // SIEMPRE sugería "sube --cap", incluso cuando el candidato que quedaría
    // libre seguiría bloqueado por otra causa (deps sin mergear, o colisión
    // con lo ya en vuelo) — subir el cap en ese caso no cambiaría nada, y
    // afirmar que sí es peor que no decir nada.
    if (reason.wouldDispatchIfCapAllowed) {
      return `${base} — sube --cap, o espera a que termine alguno.`
    }
    return `${base} — aunque subieras --cap no bastaría todavía: ${formatReason(reason.blockedEvenWithCap, ctx)}`
  }
  return formatReason(reason, ctx)
}

const usage = 'uso: ct-next.mjs --repo <o/r> [--cap N] [--base <rama>] [--dry-run]'
const repo = arg('--repo')
const capArg = arg('--cap', '1')
const baseArg = arg('--base')
const dryRun = has('--dry-run')

if (typeof repo !== 'string' || repo.length === 0) { console.error(usage); process.exit(2) }
const cap = typeof capArg === 'string' ? parseInt(capArg, 10) : NaN
if (!Number.isFinite(cap) || cap < 1) {
  console.error(`--cap inválido: "${capArg === true ? '(sin valor)' : capArg}" — debe ser un entero >= 1`)
  process.exit(2)
}
// --base <rama>: mismo patrón de validación que --repo/--cap (`arg()` ya
// devuelve `true`, no un string, cuando el flag es el último token o va
// seguido de otro flag) — un `--base` colgante nunca debe colarse hacia
// `git worktree add`/el STATE.md sembrado como el string literal "true".
// Fix round 1, Minor 1 (review de W-D): igual que --repo (`repo.length ===
// 0`), una cadena VACÍA también se rechaza aquí — sin esto, `--base ''` pasa
// la comprobación de `typeof` y se cuela hasta `git worktree add … ''`,
// donde falla tarde con un error interno de git en vez de con el exit 2 y
// mensaje claro que sí tienen los demás casos de flag mal puesto.
if (baseArg !== undefined && (typeof baseArg !== 'string' || baseArg.length === 0)) {
  console.error(`--base inválido: "${baseArg === true ? '(sin valor)' : baseArg}" — falta el nombre de la rama (¿--base al final de la línea, seguido de otro flag, o con un valor vacío?)`)
  process.exit(2)
}

// CT_NEXT_FIXTURE es exclusivamente para tests (ver
// __tests__/ct-next-dryrun.test.js). Mismo patrón que T7 (dispatch-check.mjs)
// para el mismo peligro: si queda colgada en el entorno SIN --dry-run, el
// script NO debe decidir con datos fabricados ni, sobre todo, crear un
// worktree real / sembrar STATE.md / lanzar cmux con ese estado inventado.
// Se trata como error de uso y abortamos ANTES de tocar gh o el filesystem.
if (process.env.CT_NEXT_FIXTURE && !dryRun) {
  console.error('CT_NEXT_FIXTURE está definido pero falta --dry-run: por seguridad no se decide ni se lanza nada real con datos de fixture. Añade --dry-run o limpia la variable de entorno.')
  process.exit(2)
}
// Atado también en la propia lectura (defensa en profundidad): `fx` solo
// puede ser no-nulo cuando `dryRun` es cierto.
const fx = (dryRun && process.env.CT_NEXT_FIXTURE) ? JSON.parse(process.env.CT_NEXT_FIXTURE) : null

// maxBuffer explícito (finding 7 de la review final): el default de Node para
// execFileSync es 1 MiB, y las enumeraciones de abajo ya no llevan `--limit`
// (ver finding 2) — un repo con unos pocos cientos de issues, cada uno con su
// body, puede superar 1 MiB de JSON con facilidad. Node aborta ruidosamente
// si se excede (no trunca en silencio), así que el peligro no es corrupción
// de datos sino que el comando se vuelva inusable contra un repo real. 20 MiB
// es generoso para miles de issues/PRs con body completo sin ser "sin
// límite" de verdad (un runaway real seguiría abortando).
const GH_MAX_BUFFER = 20 * 1024 * 1024
// timeout+killSignal (finding 1): ver el bloque de comentarios grande más
// arriba, defensa 2 — sin esto, un `gh` colgado (red caída a medias, auth que
// no responde) bloquearía este script indefinidamente, y ningún manejador de
// señal podría rescatarlo si la señal solo llega a este proceso.
const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: GH_MAX_BUFFER, timeout: childTimeoutMs, killSignal: 'SIGKILL' })

// detectDefaultBranch (W-D): antes de este cambio, ct-next.mjs asumía "main"
// a ciegas tanto en `git worktree add ... main` como en `base: 'main'` del
// STATE.md sembrado. En un repo cuya rama por defecto real sea distinta
// (p.ej. "master", o cualquier otra convención) eso fallaba de forma
// confusa (worktree add contra una rama que no existe), o peor, sembraba un
// STATE.md con un `base` que miente sobre la rama real.
//
// Se resuelve vía `gh repo view --json defaultBranchRef`: es la fuente
// autoritativa (la rama por defecto tal y como está configurada AHORA en
// GitHub), no una copia local que puede quedar desactualizada si el default
// branch cambió después del clone — el mismo motivo por el que el resto de
// este fichero (y dispatch-check.mjs) prefieren el endpoint REST en vivo a
// un índice/caché local (`gh search`/`gh issue list`). Alternativas
// consideradas y descartadas: `git symbolic-ref refs/remotes/origin/HEAD` es
// puramente local (sin red) pero solo existe si alguien corrió `git remote
// set-head origin -a` (no siempre cierto tras un clone) y puede quedar
// desactualizado sin avisar; `git remote show origin` sí es autoritativo
// pero hace un fetch completo de refs del remoto solo para leer una línea de
// texto a parsear, más lento que una llamada JSON dirigida. ct-next.mjs YA
// requiere red para `gh` en la ruta real (loadIssues), así que esto no
// añade una dependencia nueva.
//
// Si no se puede determinar (gh caído, sin red, repo sin default branch
// legible), abortamos con un mensaje claro que señala `--base` como salida —
// NUNCA asumimos "main" en silencio: eso es exactamente el bug que se está
// arreglando.
function detectDefaultBranch(repoSlug) {
  let out
  try {
    out = gh(['repo', 'view', repoSlug, '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name']).trim()
  } catch (e) {
    console.error(`no se pudo determinar la rama por defecto de ${repoSlug}: ${e.message}. Usa --base <rama> para indicarla explícitamente si ya sabes cuál es.`)
    process.exit(1)
  }
  // Fix round 1, Minor 3 (review de W-D): además de la cadena vacía
  // (`.defaultBranchRef` ausente/nulo en el JSON), rechazamos también el
  // literal "null" — si `.defaultBranchRef.name` no existiera y `-q` (jq)
  // lo emitiera como el string "null" en vez de una cadena vacía, esta
  // guarda lo dejaría colar como si fuera un nombre de rama real.
  if (!out || out === 'null') {
    console.error(`no se pudo determinar la rama por defecto de ${repoSlug}: "gh repo view" no devolvió ningún nombre de rama utilizable (salida: ${JSON.stringify(out)}). Usa --base <rama> para indicarla explícitamente.`)
    process.exit(1)
  }
  return out
}

// Verificación local de que la rama base resuelta EXISTE en el checkout (fix
// round 1, Important): `detectDefaultBranch`/`--base` resuelven un NOMBRE
// (contra GitHub, o a mano), pero `git worktree add -b <branch> <wt>
// <resolvedBase>` necesita que ese nombre resuelva como referencia real EN
// EL CHECKOUT LOCAL. Dos escenarios reales sin esta comprobación: un --base
// con un typo ("mian"), o una rama por defecto que existe en GitHub pero
// nunca se fetcheó en local (`git clone --single-branch`, checkout viejo).
// Sin esta guarda, la secuencia sería: se hace el claim (status:ready →
// status:in-progress) → `git worktree add` falla con un error interno de
// git ("fatal: invalid reference…") → se revierte el claim → exit 1. El
// estado queda consistente (no hay corrupción), pero se quema un ciclo
// entero de claim/revert por algo que se podía saber OFFLINE, sin tocar gh,
// antes de reclamar nada.
//
// Se comprueba con `git rev-parse --verify --quiet <ref>^{commit}` (silencia
// su propio error; el mensaje lo decidimos nosotros) contra DOS referencias:
// la rama local, y `origin/<rama>` (la copia remote-tracking) — para poder
// distinguir "no existe en ningún sitio que este checkout conozca" (typo
// probable) de "existe en origin pero no se ha fetcheado/creado en local"
// (arreglo: `git fetch`), en vez de dar el mismo mensaje genérico para dos
// causas con remedios distintos.
function verifyBaseExistsLocally(base) {
  const existsAsCommit = (ref) => {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: repoRoot, stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
  if (existsAsCommit(base)) return
  if (existsAsCommit(`origin/${base}`)) {
    console.error(`la rama base "${base}" existe en origin pero no en tu checkout local (probablemente falta un \`git fetch\`). Corre \`git fetch origin ${base}\` (o crea la rama local con \`git branch ${base} origin/${base}\`) y reintenta, o pasa --base <otra-rama> que sí tengas en local.`)
    process.exit(1)
  }
  console.error(`la rama base "${base}" no existe ni en tu checkout local ni como origin/${base} — revisa el nombre (¿--base con un typo?), o corre \`git fetch\` si es una rama remota reciente que tu checkout todavía no conoce.`)
  process.exit(1)
}

// Guarda de identidad de repo (finding 1 de la review final, el más grave de
// toda la revisión): `repoRoot` (más abajo) sale de `git rev-parse
// --show-toplevel` en el cwd en el que arrancó la sesión — que puede no
// tener NADA que ver con `--repo`. Sin esta guarda, correr `/ct-next --repo
// otro-org/otro-repo` desde una sesión de control-tower crea `feat/<n>` +
// `.worktrees/<n>` DENTRO de control-tower, siembra un STATE.md ahí y lanza
// un agente con un kickoff que dice estar implementando un slice de
// otro-org/otro-repo. Resolvemos la identidad real del checkout vía `git
// remote get-url origin` — no `gh repo view --json nameWithOwner`: eso
// dispara una llamada de red solo para leer algo que `git remote` ya sabe en
// local, y además `gh repo view` internamente también depende del remote
// para resolver el repo por defecto — y abortamos si no coincide, o si no
// podemos verificarla (repo sin remote `origin`: lo tratamos como "no
// verificable", nunca como "sigue sin comprobar", mismo criterio que el
// resto del script para cualquier fallo de lectura). Se aplica tanto en la
// ruta real como en --dry-run (ver el `else` de más abajo, que cubre ambas):
// un --dry-run ya exige estar dentro de un repo git real para poder resolver
// `repoRoot` (eso no es nuevo, ya lo hacía antes de este fix), así que la
// guarda no añade ningún requisito de entorno nuevo a --dry-run — solo
// cierra el hueco de que un --dry-run imprima, con total confianza, un plan
// (rutas de worktree, kickoff) que en realidad corresponde a un repo
// distinto del que el humano cree estar mirando. Un --dry-run que valida
// MENOS que la corrida real sería exactamente la trampa que esta guarda
// existe para evitar.
function ensureRepoIdentity(root, expectedRepo) {
  let originUrl
  try {
    originUrl = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim()
  } catch (e) {
    console.error(`no se pudo verificar que ${root} es el checkout de ${expectedRepo}: no tiene remote "origin" (${e.message}). Por seguridad, ct-next.mjs NO continúa — podría estar corriendo dentro del repo equivocado (p.ej. una sesión de control-tower en vez de ${expectedRepo}). Añade un remote origin que apunte a ${expectedRepo}, o ejecuta ct-next.mjs desde el checkout correcto.`)
    process.exit(1)
  }
  const m = originUrl.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/)
  if (!m) {
    console.error(`no se pudo interpretar el remote "origin" de ${root} ("${originUrl}") como un repo de GitHub owner/repo. Por seguridad, ct-next.mjs NO continúa.`)
    process.exit(1)
  }
  const actualRepo = `${m[1]}/${m[2]}`
  if (actualRepo.toLowerCase() !== expectedRepo.toLowerCase()) {
    console.error(`--repo ${expectedRepo} no coincide con el checkout local en ${root} (remote origin → ${actualRepo}). Aborta: ejecuta ct-next.mjs desde un checkout de ${expectedRepo}, o corrige --repo.`)
    process.exit(1)
  }
}

let repoRoot
let resolvedBase
// Fix round 1, Minor 2 (review de W-D): distingue "el valor de resolvedBase
// viene del relleno sintético de fixture" (nunca resuelto de verdad, ni
// contra GitHub ni contra el checkout local) de "viene de una resolución
// real" — para que el banner de --dry-run no afirme "resuelta" sobre un
// valor que no se resolvió.
let baseIsFixtureDefault = false
if (fx) {
  // Solo se usa para construir strings en la rama --dry-run (el fixture está
  // atado a --dry-run más arriba): nunca llega a un `git worktree add` real,
  // así que tampoco pasa (ni necesita pasar) la guarda de identidad de arriba
  // ni la verificación local de existencia de la rama base (más abajo) —
  // esta ruta es enteramente sintética por diseño.
  repoRoot = '/tmp/fake-repo'
  // --base sigue ganando aunque haya fixture (mismo orden de precedencia que
  // la ruta real, más abajo). Sin override, "main" es un relleno puramente
  // sintético para tests offline — nunca toca `gh repo view` ni `git`
  // reales, así que no reintroduce el bug que este cambio arregla (asumir
  // "main" contra un repo DE VERDAD). (Fix round 1, Minor 2: se quitó el
  // `fx.base` que había aquí antes — ningún fixture de los tests lo fijaba y
  // ningún test lo cubría, era código muerto.)
  if (typeof baseArg === 'string') {
    resolvedBase = baseArg
  } else {
    resolvedBase = 'main'
    baseIsFixtureDefault = true
  }
} else {
  try {
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  } catch (e) {
    console.error(`no se pudo resolver la raíz del repo git local: ${e.message}`)
    process.exit(1)
  }
  ensureRepoIdentity(repoRoot, repo)
  resolvedBase = typeof baseArg === 'string' ? baseArg : detectDefaultBranch(repo)
  // Fix round 1, Important: verificación local ANTES del bucle de despacho,
  // offline (ni gh ni red) — ver el comentario de verifyBaseExistsLocally.
  verifyBaseExistsLocally(resolvedBase)
}

function loadIssues() {
  if (fx) return fx
  // issues open con labels → {n, order, status, deps, touches, name, type, ac, issue}.
  // Enumeración vía el endpoint REST `gh api repos/<repo>/issues`, NUNCA el
  // índice de búsqueda (`--search`/`gh search issues`): tiene latencia de
  // indexado y podría no reflejar un label recién escrito por otro runner.
  // Tampoco `gh issue list --limit N` con un tope fijo (finding 2 de la
  // review final): ese endpoint devuelve más nuevo primero, así que un
  // `--limit` fijo deja fuera justo los issues VIEJOS — que son los que
  // suelen tener dependientes. Dos consecuencias silenciosas observadas: una
  // dependencia mergeada que cae fuera de `mergedIssues` deja un slice
  // permanentemente indespachable, y (en dispatch-check.mjs) un
  // `in-progress` colisionante que cae fuera de `allOpen()` hace que el lock
  // falle abierto. En su lugar usamos paginación real (`--paginate --slurp`,
  // sin tope) igual que ct-groom.mjs, y reutilizamos su mismo helper de
  // aplanado/filtrado de PRs (scripts/gh-issues.js) — ese endpoint también
  // devuelve pull requests (comparten namespace en la API v3). El mapeo en sí
  // (mapGhIssue/filterMergedIssues) es lógica pura extraída a
  // gh-issue-map.js — ver __tests__/gh-issue-map.test.js — para poder
  // testearla sin red y detectar una deriva de formato con groom.js.
  let raw
  try {
    // per_page=100 (re-review): el default REST es 30/página — con --paginate
    // igual se traen todos, pero a 3x más round-trips de los necesarios. 100
    // es el máximo que admite este endpoint.
    raw = realIssuesOnly(flattenIssuePages(JSON.parse(
      gh(['api', `repos/${repo}/issues`, '--method', 'GET', '-f', 'state=open', '-f', 'per_page=100', '--paginate', '--slurp']))))
  } catch (e) {
    console.error(`no se pudieron listar issues abiertos de ${repo}: ${e.message}`)
    process.exit(1)
  }

  let closed
  try {
    // `body` es imprescindible aquí (no solo number,stateReason): es la única
    // forma de recuperar el marcador <!-- ct-order:N --> de un issue YA
    // CERRADO, y sin ese marcador buildDispatchInput no puede traducir un dep
    // en espacio de orden hacia el número de issue real de una dependencia
    // que ya se mergeó (ver gh-issue-map.js#buildOrderIndex).
    //
    // El campo de estado del endpoint REST es `state_reason`, en minúsculas
    // (p.ej. "completed") — DISTINTO del `stateReason` que expone `gh issue
    // list --json stateReason` vía GraphQL, en mayúsculas ("COMPLETED"), que
    // es lo que espera filterMergedIssues (ver gh-issue-map.js, verificado
    // contra gh 2.86). Normalizamos aquí, en el wrapper, para no tener que
    // enseñarle a la capa pura dos formatos de la misma cosa.
    const rawClosed = realIssuesOnly(flattenIssuePages(JSON.parse(
      gh(['api', `repos/${repo}/issues`, '--method', 'GET', '-f', 'state=closed', '-f', 'per_page=100', '--paginate', '--slurp']))))
    closed = rawClosed.map((i) => ({
      number: i.number,
      body: i.body,
      // milestone (D1 finding 1): buildOrderIndex necesita el milestone de
      // CUALQUIER issue, abierto o cerrado, para poder escanear el orden POR
      // EPIC en vez de globalmente al repo — sin esto, todo issue cerrado
      // caería en el bucket compartido NO_MILESTONE_KEY sin importar su
      // epic real, arriesgando una colisión FALSA entre dos epics distintos
      // que de verdad tienen milestones distintos (uno simplemente no viajó
      // hasta aquí).
      milestone: i.milestone || null,
      stateReason: i.state_reason ? String(i.state_reason).toUpperCase() : null,
    }))
  } catch (e) {
    console.error(`no se pudieron listar issues cerrados de ${repo}: ${e.message}`)
    process.exit(1)
  }
  return buildDispatchInput(raw, closed)
}

// formatOrderCollisions (D1 finding 1, el más grave del hardening del
// dispatch — endurecido en la review, finding 4): `orderCollisions`
// (gh-issue-map.js#buildOrderIndex, vía buildDispatchInput) es no-vacío
// cuando dos issues DISTINTOS comparten el mismo `<!-- ct-order:N -->`
// dentro del MISMO epic (mismo milestone, o ambos sin milestone) — un
// re-groom accidental, o dos epics que comparten milestone por error (p.ej.
// ninguno pasó `--milestone` y los dos cayeron en el título por defecto
// "Epic"). Rehusar a resolver esto en silencio sigue siendo la dirección
// correcta — lo que YA NO hace este wrapper es abortar el batch ENTERO: el
// epic afectado ya viene EXCLUIDO de `issues` (buildDispatchInput, mismo
// motivo documentado ahí — con el orden indexado también sobre cerrados,
// una colisión que viviera solo entre issues mergeados hace tiempo
// ladrillaba el repo COMPLETO para siempre). Aquí solo queda avisar, SIEMPRE
// (nunca en silencio), de qué epic quedó fuera y por qué, mientras el resto
// del repo se despacha con normalidad.
function formatOrderCollisions(collisions) {
  return collisions.map((c) => {
    const epicLabel = c.epicKey === NO_MILESTONE_KEY ? 'issues sin milestone asignado' : `el milestone #${c.epicKey}`
    return `aviso: colisión de orden — el marcador <!-- ct-order:${c.order} --> aparece en más de un issue de ${epicLabel} (${c.issues.map((n) => `#${n}`).join(', ')}). Ese epic queda EXCLUIDO de esta tanda (ni se despacha ni cuenta en vuelo) hasta que se corrija — el resto del repo se despacha con normalidad. ¿Re-groom accidental sobre el mismo milestone, o dos epics compartiendo milestone por no haber pasado --milestone?`
  })
}

// formatStatusAmbiguityWarnings (D1 finding 3): un aviso, SIEMPRE impreso
// (no solo en --dry-run: es una señal de datos rotos, no del plan de
// despacho) — nunca en silencio — por cada issue con más de una label
// `status:` a la vez. gh-issue-map.js#mapGhIssue ya resolvió un valor
// determinista e independiente del orden del array (in-progress > in-review
// > ready > backlog); este aviso es SOLO para que un humano corrija las
// labels a mano y la ambigüedad no se repita en la próxima corrida.
function formatStatusAmbiguityWarnings(issues) {
  return issues
    .filter((i) => i.statusAmbiguous)
    .map((i) => `aviso: #${i.n} tiene más de una label "status:" a la vez (${(i.statusLabels || []).map((s) => `status:${s}`).join(', ')}) — probablemente una edición a medias. Resuelto de forma conservadora a "status:${i.status}" (in-progress > in-review > ready > backlog), sin depender del orden en que gh/GitHub devuelve las labels. Corrige las labels a mano para dejar solo una.`)
}

// formatStrayDepsWarnings (D1 finding 1, seguimiento de review): estrechar
// el dominio de deps del dispatcher a "## Dependencias" (D1 finding 2) abrió
// una puerta que `main` mantenía cerrada — verificado por la review con el
// mismo fixture en ambos sentidos: un `merge-after #N` fuera de la sección
// (p.ej. bajo "## Descripción") YA NO gatea el dispatch. Es el estrechamiento
// correcto y deseado, pero antes de este aviso era invisible — un issue se
// despachaba en silencio sin que nadie supiera que su dependencia
// pretendida vive en el sitio equivocado y dejó de contar. gh-issue-map.js#mapGhIssue
// expone `strayDeps` para esto exactamente; este aviso nunca bloquea el
// dispatch (la decisión de estrechar el dominio ya está tomada y es
// correcta) — solo informa.
function formatStrayDepsWarnings(issues) {
  return issues
    .filter((i) => (i.strayDeps || []).length > 0)
    .map((i) => `aviso: #${i.n} tiene "merge-after ${i.strayDeps.map((d) => `#${d}`).join(', ')}" fuera de la sección "## Dependencias" — desde el hardening del dispatch, esto YA NO cuenta como dependencia real (se despacha igual). Si se pretendía como tal, muévelo dentro de la sección "## Dependencias", o bórralo si ya no aplica.`)
}

const dispatchInput = loadIssues()
const { issues, mergedIssues } = dispatchInput
// `orderCollisions` solo existe en la ruta real (buildDispatchInput) — el
// fixture de test (CT_NEXT_FIXTURE) ya trae issues pre-mapeados y no pasa
// por ese cálculo; `|| []` lo trata como "sin colisiones" en ese caso. Nunca
// aborta (ver el comentario de formatOrderCollisions): `issues` ya viene
// filtrado por buildDispatchInput, así que estos avisos son puramente
// informativos — console.log, no console.error, mismo criterio que el
// resto de líneas informativas de este fichero (rama base resuelta, en
// vuelo, motivo de bloqueo): console.error se reserva para lo que aborta
// con exit != 0.
const orderCollisions = dispatchInput.orderCollisions || []
for (const w of formatOrderCollisions(orderCollisions)) console.log(w)
for (const w of formatStatusAmbiguityWarnings(issues)) console.log(w)
for (const w of formatStrayDepsWarnings(issues)) console.log(w)
// planDispatch (dispatch.js) es quien decide TODO lo que antes se hacía aquí
// a medias: antes este wrapper llamaba a selectNext con `runningTouches: []`
// hardcodeado, así que dos invocaciones sucesivas de /ct-next --cap 1 nunca
// se veían entre sí — ni para colisión de touches ni para el cap, que
// contaba solo lo lanzado EN ESTA tanda. planDispatch deriva el trabajo en
// vuelo (status:in-progress) de los mismos `issues` ya cargados, resta ese
// trabajo del cap antes de seleccionar, y explica el motivo exacto cuando no
// selecciona nada (W-B, §8) — este wrapper solo formatea lo que ya decidió.
const { selected, inFlight, blockReason } = planDispatch(issues, { mergedIssues, cap })

// Visibilidad del trabajo en vuelo en --dry-run (punto 4 del brief de W-B):
// sin esto, un --dry-run que SÍ selecciona algo podía dar la falsa
// impresión de que no hay nada corriendo ya, cuando el cap podía estar
// parcialmente ocupado por invocaciones anteriores de /ct-next (o por un
// claim manual). Se imprime ANTES del plan de cada slice, tanto si se
// selecciona algo como si no.
if (dryRun) {
  // W-D: la rama base ya no es un literal "main" fijo — mostrarla explícita
  // en --dry-run (incluso cuando no se seleccione ningún slice) para que el
  // humano vea de qué rama se ramificaría antes de que corra de verdad. Fix
  // round 1, Minor 2: cuando el valor viene del relleno sintético de
  // fixture (`baseIsFixtureDefault`), el banner lo marca como "(fixture)" en
  // vez de afirmar "resuelta" sobre un valor que en realidad nunca se
  // resolvió (ni contra GitHub ni contra el checkout local).
  console.log(`rama base resuelta: ${resolvedBase}${baseIsFixtureDefault ? ' (fixture)' : ''}`)
  if (inFlight.length) {
    const detail = inFlight
      .map((i) => `#${i.n} [${(i.touches.length ? i.touches.map((t) => `touches:${t}`).join(', ') : 'sin touches')}]`)
      .join(', ')
    console.log(`En vuelo (${inFlight.length}/${cap} del cap ocupados): ${detail}`)
  } else {
    console.log(`En vuelo: ninguno (0/${cap} del cap ocupados).`)
  }
}

if (!selected.length) {
  // Finding 2: el contexto de staleness se crea aquí (una sola vez por
  // corrida, memoizado dentro) y solo dispara su consulta a cmux la primera
  // vez que formatReason de verdad necesita explicar una colisión — nunca
  // para 'none-ready'/'deps-unmet'/cap-full-con-hueco.
  console.log(formatBlockReason(blockReason, cap, stalenessCtxFor()))
  process.exit(0)
}

// D2 (auditoría del dispatch), finding 2: en --dry-run, la selección
// completa siempre se ve porque cada slice de `selected` imprime su propio
// bloque `=== slice #N === ` sin que nada aborte a medio camino (no hay
// llamadas reales). En el path REAL eso no está garantizado — si el dispatch
// aborta a mitad de tanda (claim inesperado, worktree, seed, cmux), los
// slices seleccionados que aún no se habían intentado no dejaban NINGUNA
// traza: un humano leyendo el log no podía saber qué se había elegido en
// total, solo lo que llegó a intentarse. Se imprime aquí, ANTES de intentar
// ningún claim, en ambos paths (dry-run y real) — es la única fuente de
// verdad de la selección (`selected`, ya decidido por planDispatch) y no
// depende de que el resto del script llegue a completarse.
console.log(`seleccionados para esta tanda (cap ${cap}, ${inFlight.length} en vuelo): ${selected.map((s) => `#${s.n} (${s.name})`).join(', ')}`)

const repoName = repo.split('/').pop()
const configDir = resolveAccount(repoName, ACCOUNT_MAP)

// Si un paso POSTERIOR a `git worktree add` falla (seed de STATE.md, o el
// lanzamiento de cmux), el worktree y la rama ya existen en disco. Sin
// limpieza, reintentar el mismo slice vuelve a fallar en `git worktree add`
// (ruta y rama ya ocupadas) hasta que un humano limpie a mano — y T10 es
// justo donde esto se encontraría por primera vez contra un repo real
// (review round 1, finding Important). Intentamos deshacerlo automáticamente
// aquí mismo — mismo patrón que dispatch-check.mjs revirtiendo el label de
// claim cuando un paso posterior falla. Sale con exit 1 en cualquier caso:
// fallar el dispatch de ESTE slice nunca debe decidirse en silencio.
//
// Los dos pasos de limpieza (`worktree remove` y `branch -D`) se intentan por
// SEPARADO, cada uno en su propio try/catch (finding 10 de la review final):
// si estuvieran en el mismo try, un fallo en el primero saltaría el segundo
// sin ni siquiera intentarlo, dejando la rama huérfana también. Y el hint
// manual que se imprime cuando algo queda pendiente nunca junta ambos
// comandos con `&&`: si `worktree remove` tuvo éxito pero `branch -D` fue el
// que falló, un hint con `&&` sería inejecutable tal cual — el primer
// comando fallaría (el worktree ya no existe) y por cortocircuito el
// segundo, que es el que de verdad hace falta, nunca llegaría a correr. El
// mensaje solo lista los comandos de los pasos que de verdad quedaron
// pendientes.
// W-C, punto 1: invoca dispatch-check.mjs como subproceso, con un argv array
// (NUNCA un string de shell) — process.execPath en vez de la cadena "node"
// para no depender de que "node" resuelva en PATH al mismo binario que ya
// está ejecutando este propio script. Contrato de exit code de
// dispatch-check.mjs (ver su propia cabecera, T11): 0 = reclamado, 1 = no
// arrancar, 2 = error de uso. El mensaje que imprime dispatch-check (colisión,
// carrera perdida, fallo de lectura/escritura/readback, o "claimed #N →
// in-progress") ya explica el motivo bien — este wrapper lo deja pasar tal
// cual en vez de reformatearlo.
//
// D2 (auditoría del dispatch), finding 3 — YA NO usa `stdio: 'inherit'`: se
// captura stdout/stderr con un `stdio` EXPLÍCITO — `['ignore', 'pipe',
// 'pipe']`, ver más abajo el porqué de "explícito" — y se reenvían tal cual a
// este mismo proceso. La diferencia es que ese texto queda disponible para
// `classifyClaimOutcome` (más abajo): su propio comentario de cabecera llama
// a su exit 1 "colisión o carrera perdida", pero el MISMO exit code también
// cubre un fallo de lectura de labels del candidato, un fallo al escribir el
// claim, y un fallo de readback — cinco causas muy distintas que, sin
// distinguir el TEXTO que dispatch-check ya imprime, son indistinguibles
// desde fuera con solo el exit code. No se modifica dispatch-check.mjs para
// ensanchar su contrato de exit codes (fuera del alcance de este cambio; ver
// el comentario de cabecera de classifyClaimOutcome para qué se haría si se
// pudiera).
//
// D2 review (importante 1) — `stdio` EXPLÍCITO, no solo `{ encoding: 'utf8'
// }`: el default de Node para execFileSync/execSync es 'pipe' para las tres,
// PERO stderr tiene un caso especial documentado (Node docs, execFileSync):
// "stderr by default will be output to the parent process' stderr unless
// stdio is specified" — es decir, sin fijar `stdio`, Node YA reenvía el
// stderr del hijo al padre por su cuenta, en directo, ADEMÁS de devolverlo en
// `e.stderr`. La primera versión de este fix no fijaba `stdio` y volvía a
// escribir `e.stderr` con `process.stderr.write(stderr)` más abajo — el
// resultado, verificado por construcción (un hijo que escribe una línea a
// stderr y sale con 1; con `stdio` sin especificar, la línea aparece DOS
// VECES en la salida del padre): CADA línea de COLLISION, y el bloque entero
// de 4 líneas del ATENCIÓN de un issue huérfano (incluido el comando manual
// `gh issue edit ...`), salían duplicados — un huérfano se leía como DOS
// reverts fallidos distintos. Fijar `stdio: ['ignore', 'pipe', 'pipe']`
// desactiva ese reenvío automático de Node; el ÚNICO reenvío que queda es el
// explícito de más abajo (`writeSync`), una sola vez.
//
// D2 review (menor 4) — `maxBuffer: GH_MAX_BUFFER` explícito: sin esto, el
// default de Node (1 MiB POR STREAM) se aplica también aquí — una colisión
// con muchos issues en vuelo (`COLLISION: #N choca con #A[...] #B[...] ...`,
// uno por cada uno) puede superarlo con facilidad contra un repo real. Por
// encima del límite, Node MATA al hijo (SIGTERM) en vez de truncar en
// silencio — `execFileSync` lanza sin `status` numérico, y el caller (más
// abajo) ya clasifica eso como "fallo inesperado al lanzar el subproceso":
// ruidoso, pero ENGAÑOSO (un mensaje grande y legítimo se reporta como si
// fuera un bug/mala configuración). Mismo valor (20 MiB) que ya usa `gh()`
// en este mismo fichero para exactamente el mismo motivo.
//
// D2 review (menor 4, hallazgo colateral) — el reenvío usa `fs.writeSync`,
// NO `process.stdout.write`/`process.stderr.write`: verificado por
// construcción que ESTOS TAMBIÉN truncan un payload grande si un
// `process.exit()` llega poco después de la escritura (más abajo, en el
// bucle de despacho, SIEMPRE hay un `process.exit()` o un `continue` seguido
// de más iteraciones que eventualmente terminan en uno) — `process.stdout`/
// `process.stderr` son ASÍNCRONOS hacia una tubería en POSIX (documentado en
// los propios docs de Node: "Pipes (and sockets): asynchronous on POSIX"),
// que es exactamente cómo llega la salida de ESTE script a quien lo invoca
// (un test, un `/loop`, cmux). `fs.writeSync(fd, texto)` es una syscall
// SÍNCRONA de verdad, con independencia de si el destino es una tubería — el
// dato queda escrito en el descriptor antes de que la llamada retorne, así
// que un `process.exit()` posterior (inmediato o no) ya no puede truncarlo.
function attemptClaim(s) {
  try {
    // timeout+killSignal (finding 1, defensa 2): si dispatch-check.mjs se
    // cuelga (su propio `gh` colgado a medias), esto acota la espera en vez
    // de bloquear ct-next.mjs para siempre. Si el kill llega a mitad de su
    // propio claim-then-verify, no podemos saber si el label ya se escribió
    // antes del SIGKILL — eso cae, a propósito, en la rama de "fallo
    // inesperado" de más abajo (claim.status no será 1), que ya aborta la
    // tanda entera en vez de asumir nada: el mismo criterio conservador que
    // ya rige cualquier otro exit code inesperado de dispatch-check. El
    // respaldo genérico para un claim que de verdad quedara huérfano por esta
    // vía es la detección de staleness (finding 2), no esto.
    const out = execFileSync(process.execPath, [dispatchCheckPath, String(s.n), '--repo', repo], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: GH_MAX_BUFFER,
      timeout: childTimeoutMs,
      killSignal: 'SIGKILL',
    })
    if (out) writeSync(1, out)
    return { ok: true }
  } catch (e) {
    const stdout = typeof e.stdout === 'string' ? e.stdout : ''
    const stderr = typeof e.stderr === 'string' ? e.stderr : ''
    if (stdout) writeSync(1, stdout)
    if (stderr) writeSync(2, stderr)
    return { ok: false, status: e.status, text: `${stdout}\n${stderr}` }
  }
}

// classifyClaimOutcome (finding 4 — reescrito para usar el CÓDIGO DE SALIDA
// de dispatch-check.mjs, no su texto): antes de este cambio, esta función
// tenía que DIFERENCIAR cinco causas muy distintas parseando el texto libre
// que dispatch-check.mjs imprime, porque su exit 1 las conflacia todas —
// frágil ante cualquier cambio futuro de wording en ese fichero. Ahora
// dispatch-check.mjs (que ya no está fuera de alcance para esta tarea) emite
// un código distinto por cada consecuencia que de verdad le importa al
// caller — ver la cabecera de dispatch-check.mjs para el contrato completo:
//   - 'skip'  (exit 1) → resultado NORMAL del protocolo: colisión detectada
//               a tiempo (nada se escribió), o carrera perdida con el
//               revert posterior EXITOSO (el issue vuelve limpio a
//               status:ready). Saltar este slice y seguir con el resto de
//               la tanda es correcto.
//   - 'infra' (exit 3) → fallo de LECTURA de las labels del candidato,
//               fallo al ESCRIBIR el claim inicial, o fallo de READBACK con
//               revert posterior EXITOSO — en los tres casos no queda
//               ninguna mutación persistente (issue intacto o de vuelta en
//               status:ready), pero la causa es de infraestructura (gh
//               caído, auth, red), no una colisión real.
//   - 'stuck' (exit 4) → carrera perdida O fallo de readback, y el revert
//               posterior TAMBIÉN falló: el issue queda HUÉRFANO en
//               status:in-progress, sin nadie trabajándolo. dispatch-check
//               ya imprime su propio "ATENCIÓN" (con el comando manual) —
//               este código es la señal MÁQUINA de que ese es justo el caso,
//               sin depender de reconocer ese texto.
//
// Tratamiento en el caller (sin cambios respecto a antes — D2 review, menor
// 3): solo 'stuck' aborta la tanda ENTERA con exit 1, igual que el "fallo
// inesperado" que ya existía para un exit no reconocido — un issue de
// verdad huérfano exige que un humano lo mire antes de que ct-next reintente
// nada más contra este repo. 'infra' se trata igual que 'skip' (se sigue con
// el resto de la tanda), con un mensaje que deja explícito que NO es una
// colisión normal — el log no debe mentir sobre qué pasó, aunque el control
// de flujo sea el mismo.
function classifyClaimOutcome(status) {
  if (status === 1) return { kind: 'skip', label: 'colisión o carrera perdida, protocolo normal (detalle arriba, en el texto de dispatch-check)' }
  if (status === 3) return { kind: 'infra', label: 'fallo de infraestructura sin mutación persistente (detalle arriba, en el texto de dispatch-check)' }
  if (status === 4) return { kind: 'stuck', label: 'huérfano — el revert automático de dispatch-check también falló (detalle arriba)' }
  // No debería alcanzarse: el caller solo llama a esta función para
  // status ∈ {1,3,4}. Ante cualquier otro valor, 'infra' (seguir con
  // cautela, nunca 'skip' silencioso) es la opción más segura — mismo
  // criterio que ya rige el resto de este fichero ante una entrada
  // inesperada.
  return { kind: 'infra', label: `código de salida ${status} no reconocido para este contrato` }
}

// W-C, punto 3: revierte un claim ya obtenido cuando el dispatch falla
// DESPUÉS de reclamar (git worktree add, el seed de STATE.md, o cmux) — sin
// esto el issue queda huérfano en status:in-progress sin nadie trabajándolo,
// justo el modo de fallo que dispatch-check.mjs se esfuerza en evitar puertas
// adentro (su propio claim-then-verify). dispatch-check.mjs no tiene un flag
// de "abortar": --release es la transición in-progress → in-review de un PR
// YA abierto, y aquí no hubo nunca trabajo real, así que revertimos con la
// misma mutación de label que dispatch-check usa puertas adentro para sus
// propios revert (carrera perdida, fallo de readback) — reutilizando el
// `gh()` ya definido en este fichero, no una llamada suelta a execFileSync.
function attemptRevertClaim(s) {
  try {
    gh(['issue', 'edit', String(s.n), '--repo', repo, '--add-label', 'status:ready', '--remove-label', 'status:in-progress'])
    return null
  } catch (e) {
    return e
  }
}
const manualRevertClaimHint = (s) => `gh issue edit ${s.n} --repo ${repo} --add-label status:ready --remove-label status:in-progress`

// Igual que el resto de mensajes de este fichero: nunca se listan (ni se
// imprime su comando manual) los pasos que SÍ tuvieron éxito — solo los que
// de verdad quedaron pendientes.
function formatSpanishList(items) {
  if (items.length <= 1) return items[0] || ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

function cleanupOrphanedWorktree(s, wt, branch, reason) {
  console.error(`no se pudo completar el dispatch de #${s.n} tras crear el worktree (${reason}).`)

  const attempts = [
    { label: 'el worktree', cmd: `git worktree remove --force ${wt}`, err: null },
    { label: 'la rama', cmd: `git branch -D ${branch}`, err: null },
    { label: 'el claim (status:in-progress → status:ready)', cmd: manualRevertClaimHint(s), err: null },
  ]

  // timeout+killSignal (finding 1, defensa 2) también aquí: esta MISMA
  // función es la que se ejecutaría si la señal ya provocó el fallo que nos
  // trajo hasta aquí — no queremos que la propia limpieza pueda colgarse
  // igual de indefinida que el paso que falló.
  try {
    execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repoRoot, stdio: 'inherit', timeout: childTimeoutMs, killSignal: 'SIGKILL' })
  } catch (e) {
    attempts[0].err = e
  }

  try {
    execFileSync('git', ['branch', '-D', branch], { cwd: repoRoot, stdio: 'inherit', timeout: childTimeoutMs, killSignal: 'SIGKILL' })
  } catch (e) {
    attempts[1].err = e
  }

  // Los tres pasos se intentan por SEPARADO (mismo motivo que ya regía para
  // worktree/rama antes de W-C): si estuvieran en un único try, un fallo en
  // el primero saltaría los siguientes sin ni siquiera intentarlos, dejando
  // más cosas huérfanas de las necesarias. Un `&&` en el hint manual tendría
  // el mismo problema al revés (si el primer comando de la cadena ya no hace
  // falta porque tuvo éxito, re-ejecutarlo fallaría y el `&&` cortocircuitaría
  // el resto) — por eso el hint de abajo siempre lista los comandos pendientes
  // separados por `;`, nunca encadenados.
  attempts[2].err = attemptRevertClaim(s)
  // finding 1: el destino de ESTE claim ya se decidió (se intentó revertir,
  // con éxito o no — si falló, el ATENCIÓN de abajo ya lo dice) — limpiar
  // aquí evita que un manejador de señal que llegara a correr justo después
  // intente revertirlo una segunda vez.
  activeClaim = null

  const failed = attempts.filter((a) => a.err)
  if (!failed.length) {
    console.error(`worktree y rama de #${s.n} limpiados automáticamente (${wt}, ${branch}); claim revertido automáticamente a status:ready — puedes reintentar el dispatch de este slice.`)
  } else {
    const what = formatSpanishList(failed.map((a) => a.label))
    const errMsg = failed.map((a) => a.err.message).join('; ')
    const pendingCmds = failed.map((a) => a.cmd)
    console.error(`ATENCIÓN: no se pudo limpiar automáticamente ${what} de #${s.n} (${errMsg}). Pendiente a mano — ejecuta cada comando por separado: ${pendingCmds.join(' ; ')}`)
  }
  // Los slices de esta misma tanda ya lanzados con éxito ANTES de este fallo
  // (si cap > 1) siguen corriendo en su propio cmux, independiente de este
  // proceso — no se tocan ni se detienen aquí.
  console.error('Los slices de esta tanda ya lanzados con éxito antes de este fallo (si los hubo) siguen corriendo en su propio cmux — no se han tocado.')
  process.exit(1)
}

// Finding 1 — estado de interrupción. `activeClaim` es no-nulo EXACTAMENTE
// durante la ventana peligrosa: un claim ya confirmado (status:in-progress)
// para el que el worktree todavía no se ha creado (o su fallo todavía no se
// ha gestionado). Se limpia a null en los tres únicos sitios donde su
// destino queda resuelto por el camino normal: worktree creado con éxito,
// el catch de `git worktree add` (tras intentar el revert), y dentro de
// cleanupOrphanedWorktree (tras su propio intento de revert) — nunca antes
// de que el revert automático se haya intentado, para que si el manejador de
// señal llegara a correr justo en medio (JS es de un solo hilo: en la
// práctica no puede, ver el bloque de comentarios de más arriba — esto es
// defensa en profundidad, no algo que se pueda disparar hoy) encuentre el
// estado ya resuelto en vez de intentar un segundo revert solapado.
// `activeWorktree` es solo informativo: si `git worktree add` estaba en
// curso cuando llegó la señal, no podemos saber si alcanzó a crear algo en
// disco (esa llamada no es interrumpible desde un manejador — ver arriba),
// así que el manejador solo puede avisar de dónde mirar, nunca limpiarlo con
// confianza.
let activeClaim = null
let activeWorktree = null
// `interrupting`: cerrojo de reentrada. Una segunda señal mientras ya
// estamos gestionando la primera (p.ej. el propio revert de la primera
// señal, si tardara) no debe disparar un segundo revert solapado del MISMO
// claim — fuerza la salida ya, sin reintentar limpieza.
let interrupting = false
const SIGNAL_EXIT_CODE = { SIGINT: 130, SIGTERM: 143 }
// `async` a propósito (fix tras un ataque adversarial contra el propio
// diseño, ver el informe de esta tarea): sin el `await sleep(0)` del final,
// el cerrojo `interrupting` de arriba era código MUERTO en la práctica — una
// segunda señal que llegara mientras esta función hacía su PROPIO revert
// (una llamada bloqueante, `attemptRevertClaim` → `gh()`) queda pendiente
// (ver el bloque de comentarios grande más arriba: ninguna señal se procesa
// mientras el hilo principal está bloqueado en una llamada síncrona), pero
// si esta función termina en un `process.exit()` inmediato y SÍNCRONO tras
// esa llamada, el proceso muere antes de que el event loop tenga ocasión de
// procesar esa segunda señal pendiente y volver a invocar este mismo
// manejador — el cerrojo nunca llegaría a comprobarse una segunda vez. El
// `await sleep(0)` final le da esa oportunidad ANTES de salir.
async function handleInterrupt(sig) {
  if (interrupting) {
    console.error(`\n${sig} recibido de nuevo mientras ya se estaba limpiando de una interrupción anterior — no reintento el revert (podría solaparse con el que ya está en curso); salgo ya.`)
    process.exit(SIGNAL_EXIT_CODE[sig] || 130)
  }
  interrupting = true
  console.error(`\n${sig} recibido — interrumpiendo de forma segura antes de salir.`)
  if (activeWorktree) {
    console.error(`"git worktree add" para ${activeWorktree.wt} (rama ${activeWorktree.branch}) puede haber quedado a medio crear en disco — esa llamada no es interrumpible desde aquí (ver el comentario de cabecera de este bloque), así que no se puede saber su estado. Revisa \`git worktree list\` / \`git branch\` antes de reintentar este slice, y límpialo a mano (\`git worktree remove --force ${activeWorktree.wt}\` / \`git branch -D ${activeWorktree.branch}\`) si quedó algo huérfano.`)
  }
  if (activeClaim) {
    const claimant = { n: activeClaim.n }
    console.error(`#${claimant.n} tiene un claim (status:in-progress) sin worktree completado — revirtiendo a status:ready antes de salir.`)
    const err = attemptRevertClaim(claimant)
    if (!err) {
      console.error(`claim de #${claimant.n} revertido automáticamente a status:ready.`)
    } else {
      console.error(`ATENCIÓN: no se pudo revertir automáticamente el claim de #${claimant.n} (${err.message}). Puede haber quedado bloqueado en status:in-progress sin nadie trabajándolo — libéralo a mano con: ${manualRevertClaimHint(claimant)}`)
    }
    activeClaim = null
  } else {
    console.error('no había ningún claim propio pendiente de revertir en este instante.')
  }
  console.error('Los slices de esta tanda ya lanzados con éxito antes de esta interrupción (si los hubo) siguen corriendo en su propio cmux — no se han tocado.')
  await sleep(0)
  process.exit(SIGNAL_EXIT_CODE[sig] || 130)
}
process.on('SIGINT', () => { handleInterrupt('SIGINT') })
process.on('SIGTERM', () => { handleInterrupt('SIGTERM') })

// D2, finding 1: conteo de cuántos slices de `selected` se lanzaron de
// verdad — se usa tanto para la línea de conteo final como para decidir el
// exit code cuando la tanda entera termina sin lanzar nada.
let launchedCount = 0

for (let idx = 0; idx < selected.length; idx++) {
  const s = selected[idx]
  const branch = `feat/${s.n}`
  const wt = `${repoRoot}/.worktrees/${s.n}`
  const name = `${repoName} · #${s.n} ${s.name}`
  // Normaliza ac/issue por si el slice viene de un fixture de test (como el
  // del brief) que no los trae: renderKickoff/buildStateSeed indexan
  // slice.ac como array y usan slice.issue con `??`/`||` — sin este default
  // revientan con un TypeError en vez de imprimir el plan.
  const sliceForKickoff = { ...s, ac: s.ac || [], issue: s.issue ?? null }
  const kickoff = renderKickoff(sliceForKickoff, { repo, dispatchCheckPath })
  const stateSeed = buildStateSeed(sliceForKickoff, { branch, base: resolvedBase })
  // Override 1 (shell quoting): --command es UN argv element (buildCmuxArgv
  // ya lo garantiza), pero la STRING dentro de ese argv element es una línea
  // de comando que cmux ejecuta vía shell. `JSON.stringify` es escapado JSON,
  // no de shell — un `$`, un backtick o un `\` en el kickoff seguirían
  // interpretándose dentro de las comillas dobles. shQuote() hace el
  // escapado POSIX real (comillas simples).
  const command = `claude --dangerously-skip-permissions ${shQuote(kickoff)}`
  // CLAUDE_CONFIG_DIR viaja como --env de cmux, NUNCA como env local del
  // proceso `cmux` cliente (ver dispatch.js#buildCmuxArgv): `cmux` es un
  // cliente que habla con un daemon ya en marcha por socket Unix, y es el
  // daemon —no este proceso— quien crea el pty real. Un env var puesto en
  // el `execFileSync('cmux', ...)` local muere con ese proceso cliente sin
  // llegar nunca al pty; verificado en vivo contra el sandbox (T10): sin
  // --env, la sesión se queda colgada en el selector interactivo de cuenta.
  const cmuxArgv = buildCmuxArgv({ name, cwd: wt, command, env: { CLAUDE_CONFIG_DIR: configDir } })

  if (dryRun) {
    console.log(`\n=== slice #${s.n} (${s.name}) ===`)
    // W-C, punto 5: el plan tiene que dejar claro que se INTENTARÍA un claim
    // (dispatch-check.mjs, status:ready → status:in-progress) para este issue
    // concreto ANTES de crear el worktree — sin invocar dispatch-check de
    // verdad. dispatch-check.mjs, incluso en su propio --dry-run sin fixture,
    // hace lecturas reales contra gh (solo la escritura del claim se salta);
    // invocarlo aquí rompería la garantía de "sin red" de --dry-run con
    // CT_NEXT_FIXTURE, así que en --dry-run ct-next.mjs directamente NO llama
    // a dispatch-check.mjs — ningún gh real se toca.
    // Fix round 1, minor: `node ${dispatchCheckPath} ...` (no un nombre
    // suelto "dispatch-check ...") para que la línea sea copiable y
    // ejecutable tal cual, igual que sus vecinas (`git worktree add ...`,
    // `cmux ...`).
    console.log(`node ${dispatchCheckPath} ${s.n} --repo ${repo}   # se reclamaría #${s.n} (status:ready → status:in-progress) antes de crear el worktree; en --dry-run no se ejecuta, ningún gh real se toca`)
    console.log(`CLAUDE_CONFIG_DIR=${configDir}`)
    console.log(`git worktree add -b ${branch} ${wt} ${resolvedBase}`)
    console.log(`seed ${wt}/.agent/STATE.md:\n${stateSeed}`)
    console.log(`cmux ${cmuxArgv.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`)
    continue
  }

  // W-C, punto 1/2: el claim se hace ANTES de crear el worktree. Exit 1 de
  // dispatch-check puede significar un resultado ESPERADO del protocolo
  // (colisión detectada a tiempo, carrera perdida con revert limpio, o un
  // fallo de infraestructura puntual que no mutó ni dejó nada atascado — D2
  // review, menor 3) — se salta este slice y se sigue con el resto de la
  // tanda, si queda alguno — o puede significar que un issue quedó HUÉRFANO
  // en status:in-progress porque el revert posterior también falló
  // ('stuck'). `classifyClaimOutcome`, más arriba, es quien distingue estos
  // casos a partir del texto que dispatch-check ya imprimió, porque su exit 1
  // por sí solo conflacia las cinco causas (D2, finding 3). Un exit distinto
  // de 0/1 (exit 2, o un fallo al lanzar el subproceso en absoluto) NUNCA es
  // un resultado esperado del protocolo — sería un bug o una mala
  // configuración que fallaría igual para todos los slices restantes de esta
  // misma tanda.
  //
  // Solo 'stuck' (y el exit inesperado de más abajo) abortan la tanda ENTERA
  // — 'skip' e 'infra' siguen con el resto (ver el comentario de cabecera de
  // classifyClaimOutcome para el porqué de tratar 'infra' así).
  //
  // Finding 1 — checkpoint de cesión: si llegó una SIGINT/SIGTERM mientras
  // este proceso no estaba bloqueado en ninguna llamada síncrona (p.ej.
  // idle entre dos slices de esta misma tanda), este `await` le da al event
  // loop la oportunidad de procesarla y llamar a `handleInterrupt` ANTES de
  // arrancar un claim más. Con la señal ausente (producción, y la mayoría de
  // los tests), esto es un yield de coste ~0 (ver el bloque de comentarios
  // grande más arriba para el porqué es real y no un `Atomics.wait`).
  // Reutiliza CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS (mismo valor que el
  // checkpoint post-claim, más abajo) para poder ensanchar TAMBIÉN esta
  // ventana de forma determinista en un test — no hace falta una variable
  // nueva por checkpoint, ambos existen exclusivamente para dar tiempo a
  // enviar una señal real durante el hueco.
  await sleep(testDelayAfterClaimMs)
  const claim = attemptClaim(s)
  if (!claim.ok) {
    // Finding 4: el contrato de exit codes de dispatch-check.mjs se
    // ensanchó (1='skip', 3='infra', 4='stuck' — ver la cabecera de
    // dispatch-check.mjs) precisamente para que ESTE caller ya no tenga que
    // parsear el texto libre que imprime para decidir qué hacer — el texto
    // de dispatch-check.mjs (COLLISION, carrera perdida, ATENCIÓN, etc.) se
    // reenvía tal cual más arriba (attemptClaim) y sigue siendo la fuente
    // de DETALLE para un humano; el código de salida es ahora la única
    // fuente de la DECISIÓN.
    if (claim.status === 1 || claim.status === 3 || claim.status === 4) {
      const outcome = classifyClaimOutcome(claim.status)
      const isLast = idx === selected.length - 1
      // D2, finding 1: en el último candidato de la tanda ya no queda
      // "resto" con el que seguir — decirlo de todas formas es la promesa
      // falsa que reprodujo la auditoría (el propio "si queda algún
      // candidato" no bastaba: el wording debe reflejar la realidad de ESTE
      // momento, no cubrirse con una condicional).
      const continuation = isLast ? 'no quedan más candidatos en esta tanda.' : 'sigo con el resto de esta tanda.'
      if (outcome.kind === 'skip') {
        console.error(`saltando #${s.n}: no se pudo reclamar (${outcome.label}, motivo arriba de dispatch-check) — ${continuation}`)
        continue
      }
      if (outcome.kind === 'infra') {
        // D2 review, menor 3: un fallo de infraestructura SIN nada mutado ni
        // atascado (issue intacto en status:ready) no dice nada sobre si el
        // SIGUIENTE candidato — una llamada independiente de dispatch-check
        // — también fallaría. Se sigue con la tanda igual que 'skip', pero
        // el mensaje deja explícito que NO es una colisión normal — el log
        // no debe mentir sobre qué pasó, aunque el control de flujo sea el
        // mismo.
        console.error(`saltando #${s.n}: no se pudo reclamar — fallo de infraestructura (${outcome.label}), no una colisión normal (motivo arriba de dispatch-check) — ${continuation}`)
        continue
      }
      // 'stuck': el issue quedó HUÉRFANO en status:in-progress, sin nadie
      // trabajándolo (dispatch-check ya imprimió su propio ATENCIÓN con el
      // comando manual). Esto SÍ para la tanda entera con exit 1: un humano
      // tiene que mirarlo antes de que ct-next reintente nada más contra
      // este repo — seguir a ciegas aquí es el escenario más grave
      // reproducido por la auditoría.
      console.error(`dispatch-check devolvió exit ${claim.status} para #${s.n}, y el issue puede haber quedado bloqueado en status:in-progress sin nadie trabajándolo (${outcome.label}) — revisa el ATENCIÓN de dispatch-check (arriba) antes de reintentar cualquier cosa. Abortando toda la tanda: no sigo con el resto de candidatos a ciegas.`)
      console.error('Los slices de esta tanda ya lanzados con éxito antes de este fallo (si los hubo) siguen corriendo en su propio cmux — no se han tocado.')
      process.exit(1)
    }
    const statusDesc = typeof claim.status === 'number' ? `exit ${claim.status}` : 'sin exit code numérico (fallo inesperado al lanzar el subproceso)'
    console.error(`dispatch-check devolvió un fallo inesperado (${statusDesc}) al intentar reclamar #${s.n} — no es un resultado reconocido del protocolo (1/3/4), así que probablemente es un bug o una mala configuración (p.ej. --repo mal formado, o dispatch-check.mjs no encontrado en ${dispatchCheckPath}). Abortando toda la tanda: no sigo con el resto de candidatos a ciegas.`)
    // Fix round 1, minor: este aborto puede dispararse DESPUÉS de haber
    // lanzado con éxito algún slice anterior de la misma tanda (cap > 1) —
    // igual que ya hace cleanupOrphanedWorktree más abajo, hay que dejar
    // explícito que esos slices siguen corriendo en su propio cmux, sin
    // tocarse.
    console.error('Los slices de esta tanda ya lanzados con éxito antes de este fallo (si los hubo) siguen corriendo en su propio cmux — no se han tocado.')
    process.exit(1)
  }

  // Finding 1 — LA ventana peligrosa: el claim de #${s.n} ya está escrito
  // (status:in-progress) y el worktree todavía no existe. `activeClaim`
  // queda no-nulo desde aquí hasta que su destino se resuelva (éxito
  // completo, o el catch de más abajo tras intentar el revert). El
  // `await sleep(testDelayAfterClaimMs)` es el checkpoint real: en
  // producción (testDelayAfterClaimMs === 0) es un yield de coste ~0 que le
  // da al event loop la oportunidad de procesar una señal ya pendiente antes
  // de arrancar `git worktree add`; en tests, ensancha esa misma ventana de
  // forma determinista (ver el bloque de comentarios grande más arriba).
  activeClaim = { n: s.n }
  await sleep(testDelayAfterClaimMs)

  try {
    activeWorktree = { wt, branch }
    // timeout+killSignal (finding 1, defensa 2): ver el bloque de
    // comentarios grande más arriba. Si `git worktree add` se cuelga de
    // verdad (repo remoto lento, o algo peor) y la señal solo llega a este
    // proceso, esta es la única forma de que el catch de abajo (que YA
    // revierte el claim) llegue alguna vez a ejecutarse.
    execFileSync('git', ['worktree', 'add', '-b', branch, wt, resolvedBase], { cwd: repoRoot, stdio: 'inherit', timeout: childTimeoutMs, killSignal: 'SIGKILL' })
    activeWorktree = null
  } catch (e) {
    activeWorktree = null
    // Si el worktree o la rama ya existen, `git worktree add` falla con
    // exit != 0 — lo dejamos fallar ruidoso en vez de reusar en silencio
    // algo que podría no corresponder a este slice. El claim YA se obtuvo
    // (paso de arriba): sin revertirlo aquí, este issue quedaría huérfano en
    // status:in-progress con nada corriendo — mismo motivo que
    // cleanupOrphanedWorktree más abajo, pero aquí no hay worktree/rama que
    // limpiar (git worktree add falló antes de crear nada).
    console.error(`no se pudo crear el worktree para #${s.n} en ${wt}: ${e.message}`)
    const claimErr = attemptRevertClaim(s)
    activeClaim = null
    if (!claimErr) {
      console.error(`claim de #${s.n} revertido automáticamente a status:ready — puedes reintentar el dispatch de este slice.`)
    } else {
      console.error(`ATENCIÓN: no se pudo revertir automáticamente el claim de #${s.n} (${claimErr.message}). Queda bloqueado en status:in-progress — revierte a mano con: ${manualRevertClaimHint(s)}`)
    }
    process.exit(1)
  }
  try {
    mkdirSync(`${wt}/.agent`, { recursive: true })
    writeFileSync(`${wt}/.agent/STATE.md`, stateSeed)
  } catch (e) {
    cleanupOrphanedWorktree(s, wt, branch, `no se pudo sembrar .agent/STATE.md: ${e.message}`)
  }
  try {
    execFileSync('cmux', cmuxArgv, { stdio: 'inherit', timeout: childTimeoutMs, killSignal: 'SIGKILL' })
  } catch (e) {
    cleanupOrphanedWorktree(s, wt, branch, `no se pudo lanzar cmux: ${e.message}`)
  }
  // Finding 3: `new-workspace` ya devolvió éxito (si no, la línea de arriba
  // habría abortado) — pero eso, por sí solo, NUNCA implica que la sesión
  // haya arrancado en `wt` (cmux tolera un cwd inexistente y sigue adelante
  // en el shell de login por defecto). verifyCmuxLaunch consulta de solo
  // lectura (jamás lanza nada) para distinguir los tres casos posibles antes
  // de decidir qué decir.
  const launchCheck = verifyCmuxLaunch(name, wt)
  if (launchCheck.status === 'confirmed') {
    console.log(`lanzado #${s.n} en ${wt} (cuenta ${configDir}) — verificado: la sesión cmux está corriendo en ese directorio.`)
  } else if (launchCheck.status === 'wrong-cwd') {
    console.error(`ATENCIÓN: cmux aceptó el lanzamiento de #${s.n} (exit 0), pero la sesión NO está en ${wt} — está en "${launchCheck.actualCwd}" en su lugar (cmux tolera un cwd inexistente y arranca en el shell de login por defecto en vez de fallar; ¿el worktree no llegó a existir a tiempo, o se borró justo antes?). El agente puede estar corriendo en el directorio equivocado — revisa la sesión a mano antes de asumir que está trabajando #${s.n}.`)
  } else if (launchCheck.status === 'not-found') {
    console.error(`ATENCIÓN: cmux devolvió éxito (exit 0) al lanzar #${s.n}, pero no se encontró ninguna sesión con el nombre "${name}" al consultarlo — no se puede confirmar que el agente esté corriendo en absoluto, y mucho menos en ${wt}. Revisa cmux a mano.`)
  } else {
    console.log(`lanzado #${s.n} en ${wt} (cuenta ${configDir}) — cmux devolvió éxito (exit 0), pero no se pudo verificar la sesión (no se pudo consultar cmux): "lanzado" aquí refleja solo que el comando no falló, no que el agente esté corriendo en ${wt}.`)
  }
  // finding 1: el slice se lanzó completo — ya no hay claim "en la ventana
  // peligrosa" que un manejador de señal futuro (para el SIGUIENTE slice de
  // esta misma tanda) deba tocar.
  activeClaim = null
  launchedCount++
}

// D2 review, menor 1: TODO este bloque de conteo/exit-code es exclusivo del
// path REAL — un --dry-run no reclama ni lanza NADA de verdad (es puramente
// informativo, `launchedCount` es siempre 0 ahí por construcción). Una línea
// "lanzados 0/N" al final de un --dry-run exitoso sería exactamente la misma
// clase de mensaje engañoso que esta tarea existe para eliminar, solo que al
// revés (afirmar "cero lanzamientos" de un plan que ni siquiera lo intentó).
if (!dryRun) {
  // D2, finding 1: si el bucle llega hasta aquí (no abortó con process.exit
  // en ninguna iteración), la tanda terminó de procesarse por completo —
  // pero eso no significa que se haya lanzado algo. Antes de este fix, una
  // tanda entera donde CADA slice seleccionado colisionaba (o perdía la
  // carrera, limpio, o tropezaba con un hiccup de infraestructura — D2
  // review, menor 3) al reclamar terminaba en silencio: cero agentes, cero
  // worktrees, exit 0, sin ninguna línea que dijera "de los N
  // seleccionados, se lanzaron 0".
  console.log(`lanzados ${launchedCount}/${selected.length} slice(s) seleccionados de esta tanda.`)

  // Exit code deliberado, no 0/1/2 reutilizado: cuando /ct-next corre dentro
  // de un /loop, quien lo invoca (un humano, u otro agente) necesita
  // distinguir tres situaciones muy distintas por el exit code, sin tener
  // que parsear el texto:
  //   0 = progreso (algo se lanzó — total o parcialmente — o no había nada
  //       que lanzar y ya se explicó por qué con formatBlockReason). Un
  //       caller en /loop puede seguir su ritmo normal.
  //   1 = algo se ROMPIÓ (bug, mala configuración, o un issue que quedó
  //       huérfano en status:in-progress) — YA estaba así antes de este
  //       cambio para los abortos de mitad de tanda; un caller en /loop debe
  //       parar y avisar a un humano, no reintentar a ciegas.
  //   2 = error de uso (flags mal puestos) — sin cambios.
  //   3 = NUEVO: la tanda se seleccionó (selected.length > 0) pero terminó
  //       de procesarse con CERO lanzamientos, y nada se rompió — cada
  //       candidato colisionó, perdió una carrera de forma limpia, o tropezó
  //       con un fallo de infraestructura puntual (D2 review, menor 3),
  //       contra trabajo que otro proceso reclamó entre la foto de ct-next y
  //       el claim en vivo de dispatch-check (la advertencia honesta de "sin
  //       compare-and-swap" ya documentada), o simplemente contra un `gh`
  //       inestable. No es un bug ni requiere intervención manual, pero
  //       tampoco es "nada que hacer" (formatBlockReason ya cubre ESE caso
  //       con exit 0): hubo selección, hubo intento, no hubo progreso. Un
  //       caller en /loop debe verlo como "reintenta más tarde", distinto
  //       tanto de 0 (todo bien) como de 1 (para y mira qué pasó).
  if (selected.length > 0 && launchedCount === 0) {
    console.error(`ninguno de los ${selected.length} slice(s) seleccionados se lanzó esta vez — todos se saltaron, por colisión, carrera perdida, o un fallo de infraestructura puntual al reclamar (detalle arriba). No es necesariamente un fallo de configuración: puede ser otro dispatcher (u otra invocación concurrente) adelantándose entre la foto de esta tanda y el claim en vivo, o un gh inestable. Nada quedó a medias ni bloqueado — reintenta más tarde, o en la próxima vuelta del /loop.`)
    process.exit(3)
  }
}
