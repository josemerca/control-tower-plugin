#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, accessSync, constants as fsConstants, writeSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, delimiter as pathDelimiter } from 'node:path'
import { planDispatch, resolveAccount, resolveAccountLegacy, validateAccountMap, parseRepoSlug, buildCmuxArgv } from './dispatch.js'
import { renderKickoff, buildStateSeed, ACCOUNT_MAP } from './kickoff.js'
import { parseStrictInt } from './argnum.js'
import { shQuote } from './shquote.js'
import { buildDispatchInput, NO_MILESTONE_KEY } from './gh-issue-map.js'
import { flattenIssuePages, realIssuesOnly } from './gh-issues.js'
import { detectConventions, formatFindings } from './conventions.js'
import { readRepoDocs, readAck } from './conventions-io.js'

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

// ============================================================================
// D5, hallazgo F (segunda mitad) — QUE EL DESTINO DE LA SALIDA SE ROMPA NO
// PUEDE CAMBIAR NI LO QUE SE DECIDE NI EL EXIT CODE.
//
// `process.stdout`/`process.stderr` hacia una tubería emiten un evento
// 'error' (EPIPE) cuando el lector cierra — `ct-next | head`, un `/loop` que
// deja de leer, una sesión de cmux que se cierra a media corrida. Sin un
// manejador, ese evento sube como excepción no capturada y MATA el proceso
// en el punto exacto en que se intentó imprimir. Verificado por construcción
// con el extremo de lectura de stdout cerrado: el `console.log` de "lanzado
// #90" —posterior al claim, al worktree y al lanzamiento de cmux, o sea con
// TODO el trabajo ya hecho y bien— lanzaba EPIPE y la corrida terminaba con
// exit 1 y un volcado de pila, como si el despacho hubiera fallado.
//
// El exit code de este script describe qué le pasó al TRABAJO (se despachó,
// no se despachó, quedó algo a medias), nunca si el terminal de quien lo
// llamó seguía escuchando. Perder líneas de log hacia un destino que ya no
// las acepta es un límite real y aceptable —no hay adónde entregarlas— y
// queda escrito aquí; convertirlo en un fallo del despacho, no.
process.stdout.on('error', () => {})
process.stderr.on('error', () => {})
// ============================================================================

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
//
// REGRESIÓN DE UX EXPLÍCITA (revisión externa, IMPORTANTE — no descubierta
// por mí, y no "resuelta": solo declarada con honestidad porque el diseño no
// tiene forma de evitarla del todo sin una reescritura mucho mayor). Antes
// de instalar CUALQUIER manejador, un Ctrl-C contra un `git worktree add`
// genuinamente colgado moría al INSTANTE (disposición por defecto del
// kernel, EXIT=130, sin limpieza pero también sin espera). Con el manejador
// instalado, ese mismo escenario ahora se comporta así: el usuario pulsa
// Ctrl-C (una vez, o varias — mientras el proceso sigue bloqueado dentro de
// la llamada síncrona, CUALQUIER señal es, en la práctica, un no-op: no hay
// manejador que pueda correr, ver el hallazgo (a) de arriba), no pasa NADA
// visible — ni mensaje, ni salida — hasta que se cumple `childTimeoutMs`
// (10 minutos por defecto), momento en el que recién entonces el catch
// existente revierte el claim y el proceso termina. Es decir: se cambia
// "muere al instante, sin limpieza" por "tarda hasta 10 minutos en salir,
// pero limpia bien" — un terminal retenido varios minutos SIN ninguna señal
// de vida es, en sí mismo, el escenario que finding 1 describe (una
// divergencia entre lo que el usuario cree — "esto no responde, algo está
// mal" — y lo que el sistema hace de verdad — "está esperando, y limpiará
// al final"). No hay mitigación de código para la ausencia total de
// feedback mientras el hilo principal está genuinamente bloqueado: eso
// exigiría convertir las llamadas de riesgo (como `git worktree add`) a
// `spawn` asíncrono con el hijo registrado para poder matarlo DIRECTAMENTE
// en cuanto la señal se procese (en vez de esperar su propio timeout) — una
// reestructuración mayor, fuera del alcance acometido en esta ronda. Lo que
// SÍ cambió para mejor, sin ambigüedad: antes, ese mismo Ctrl-C nunca
// revertía el claim (quedaba huérfano para siempre); ahora sí, aunque tarde.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// D5 (hallazgo colateral al C, no estaba en el encargo) — `sleep(0)` NO ES UN
// PUNTO DE CESIÓN FIABLE PARA UNA SEÑAL, y los dos checkpoints del bucle
// dependían solo de él.
//
// El diseño de arriba da por bueno que un `await sleep(ms)` le da al event
// loop "la oportunidad de procesar una señal ya pendiente". Es cierto a
// veces, no siempre: libuv despacha las señales en la fase de POLL (el
// self-pipe del manejador de señal es un watcher de esa fase), y la fase de
// TIMERS —donde se resuelve un `setTimeout`— corre ANTES que poll en la
// misma vuelta del bucle. Si el temporizador ya está vencido cuando el loop
// entra en timers, la continuación del `await` se ejecuta SIN que la señal
// pendiente se haya despachado todavía.
//
// Medido, no supuesto (mismo experimento, 8 rondas, señal enviada al proceso
// mientras estaba bloqueado dentro de un `execFileSync` con un hijo que
// ignora la señal): tras el PRIMER `await sleep(0)` el manejador seguía sin
// ejecutarse en 2 de 8 rondas — y en esas dos sí se había ejecutado tras el
// segundo. Con `setImmediate` (fase de CHECK, inmediatamente DESPUÉS de
// poll) el manejador ya había corrido en 8 de 8. A valor de PRODUCCIÓN
// (CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS ausente, o sea 0) eso significaba que
// ~1 de cada 4 Ctrl-C llegados durante `dispatch-check` se colaba por el
// checkpoint post-claim y el bucle seguía creando el worktree y lanzando el
// agente — justo el hueco que el checkpoint existe para cerrar.
//
// `yieldToSignals()` cruza la fase de poll a propósito. Se usa DESPUÉS del
// `sleep(...)` de cada checkpoint (no en su lugar: el sleep sigue siendo el
// que ensancha la ventana de forma determinista para los tests) y una última
// vez al final del proceso (hallazgo C).
function yieldToSignals() {
  return new Promise((resolve) => setImmediate(resolve))
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

// CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE — exclusivamente para tests: limita a QUÉ
// hijo se le aplica CT_NEXT_CHILD_TIMEOUT_MS. Todos los demás siguen con el
// default de producción (DEFAULT_CHILD_TIMEOUT_MS).
//
// F8 — por qué hizo falta. Dos tests ejercitan la cota de tiempo con un valor
// CORTO (800 ms y 1000 ms) porque nadie va a esperar diez minutos a que
// salte. Con una cota GLOBAL, ese valor tenía que cumplir dos cosas a la vez:
// ser MÁS LARGO que todos los pasos legítimos de la corrida (leer los issues,
// resolver la rama base, reclamar) y MÁS CORTO que el cuelgue simulado. Eso
// no es una propiedad del código: es una propiedad de lo ocupada que esté la
// máquina.
//
// Medido, no supuesto: con otra suite de vitest corriendo a la vez, en 2 de 6
// corridas contra main sin tocar, el `dispatch-check` LEGÍTIMO del test del
// "git worktree add colgado" tardó más de 800 ms, así que la cota saltaba
// sobre el hijo EQUIVOCADO — el test fallaba buscando "no se pudo crear el
// worktree" en una salida que hablaba de dispatch-check, y de paso dejaba
// nietos `gh` huérfanos escribiendo en el directorio temporal que el
// `afterEach` estaba borrando (ENOTEMPTY).
//
// Acotar el ALCANCE elimina la carrera por construcción en vez de ensancharla:
// el único hijo que puede agotar la cota corta es el que el test cuelga a
// propósito. Cero dependencia del reloj de pared.
//
// Se valida con el mismo criterio que los hooks de autoseñal (hallazgo G, más
// abajo): el conjunto de alcances es CERRADO y cualquier otro valor aborta con
// exit 2 antes de tocar nada. Un typo aquí no puede dejar en silencio la cota
// de PRODUCCIÓN (10 min) donde un test creía haber puesto una de 800 ms — el
// test pasaría a esperar diez minutos por un cuelgue simulado, o peor, a
// aprobar sin ejercitar nada.
const CHILD_TIMEOUT_SCOPES = ['dispatch-check', 'worktree-add']
let childTimeoutScope = null
const childTimeoutScopeRaw = process.env.CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE
if (childTimeoutScopeRaw !== undefined && childTimeoutScopeRaw !== '') {
  if (!CHILD_TIMEOUT_SCOPES.includes(childTimeoutScopeRaw)) {
    console.error(`CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE inválido: "${childTimeoutScopeRaw}" — debe ser uno de: ${CHILD_TIMEOUT_SCOPES.join(', ')}. Es un hook exclusivo de tests que restringe CT_NEXT_CHILD_TIMEOUT_MS a un solo subproceso; con un valor que no se reconoce, la cota corta no se aplicaría a NINGUNO y el resto usaría el default de ${DEFAULT_CHILD_TIMEOUT_MS}ms sin decirlo. Abortando antes de tocar nada.`)
    process.exit(2)
  }
  childTimeoutScope = childTimeoutScopeRaw
}
// childTimeoutFor(step): la cota que le toca a cada llamada bloqueante. Sin
// alcance fijado (producción y la inmensa mayoría de los tests) devuelve
// siempre `childTimeoutMs`, exactamente igual que antes de F8. Con alcance
// fijado, solo el paso nombrado recibe la cota configurada. `step` se omite en
// las llamadas que no son escopables.
const childTimeoutFor = (step = null) => (
  childTimeoutScope === null || childTimeoutScope === step ? childTimeoutMs : DEFAULT_CHILD_TIMEOUT_MS
)

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
// D5, hallazgo G — LOS HOOKS DE AUTOSEÑAL SE VALIDAN AQUÍ, ANTES DE TOCAR
// NADA.
//
// `CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM` y
// `CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT` llegan crudos a un
// `process.kill(process.pid, <valor>)` en mitad del bucle. `process.kill`
// LANZA `ERR_UNKNOWN_SIGNAL` con un nombre de señal que no reconoce, y el
// primero de esos dos sitios está DENTRO de la ventana peligrosa: claim ya
// escrito, worktree todavía no. Verificado por construcción con
// `CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM=pepe`: `claimed #90 → in-progress`
// en la salida, ni un solo revert en el log de `gh`, una traza de
// ERR_UNKNOWN_SIGNAL, y el issue huérfano en status:in-progress.
//
// Son hooks de test, sí — pero viven en el script de PRODUCCIÓN y se leen
// del entorno, que es exactamente el sitio del que llega un valor con un
// typo. Se validan con el mismo criterio que las otras dos variables de
// arriba (forma conocida → seguir; cualquier otra cosa → exit 2 antes de
// leer un solo issue), y contra el conjunto EXACTO de señales que este
// script maneja: instalar un hook para una señal sin manejador no probaría
// lo que dice probar.
//
// Esto NO es, ni pretende ser, la red de seguridad completa: cualquier otro
// `throw` inesperado en esa misma ventana dejaría el issue igual de
// huérfano. Esa parte se resuelve de raíz más abajo (ver `bailOutOnCrash`).
const HANDLED_SIGNALS = ['SIGINT', 'SIGTERM']
for (const varName of ['CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM', 'CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT']) {
  const raw = process.env[varName]
  if (raw === undefined || raw === '') continue
  if (!HANDLED_SIGNALS.includes(raw)) {
    console.error(`${varName} inválido: "${raw}" — debe ser una de las señales que este script maneja (${HANDLED_SIGNALS.join(', ')}). Es un hook exclusivo de tests que se autoenvía la señal en mitad del despacho; con un valor que Node no reconoce, "process.kill" lanza ERR_UNKNOWN_SIGNAL justo entre el claim y el worktree y deja el issue huérfano. Abortando antes de tocar nada.`)
    process.exit(2)
  }
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
    // IMPORTANTE (revisión externa): `custom_title`/`current_directory` son
    // los nombres de campo observados contra la versión de cmux instalada
    // en la máquina de desarrollo — no hay ninguna garantía de versión ni
    // de esquema. Si el nombre real cambiara, CADA `ws.custom_title` sería
    // `undefined`, fallaría el `typeof === 'string'` de más abajo, y el
    // resultado se filtraría en silencio a un array vacío — indistinguible,
    // antes de este cambio, de "cmux respondió y de verdad no hay ninguna
    // sesión". Eso degradaba CADA staleness-check a un falso "abandonado" y
    // CADA verificación de lanzamiento a un falso "not-found", ambos
    // ruidosos. `sawAnyWorkspaceEntry`/`sawAnyRecognizedTitle` distinguen
    // las dos causas de "cero resultados": si hubo entradas de verdad
    // (`parsed.workspaces` no vacío) pero NINGUNA tenía el campo esperado,
    // es mucho más probable un cambio de esquema que "cero sesiones de
    // verdad" — se trata como NO CONCLUYENTE. Si nunca hubo ninguna entrada
    // en ninguna ventana (el caso normal y esperado de "no hay nada
    // abierto"), sigue siendo un `[]` con toda confianza.
    //
    // D5, hallazgo B — la guarda de arriba cubría `custom_title` y NADA
    // MÁS: `current_directory` se leía a pelo (`ws.current_directory ??
    // null`) y luego se comparaba con igualdad ESTRICTA contra el worktree
    // esperado. Si cmux renombrara SOLO ese campo (el título seguiría
    // reconociéndose, así que `sawAnyRecognizedTitle` no salvaría nada),
    // cada `cwd` sería `null`, `null !== <worktree>` y CADA lanzamiento
    // correcto se clasificaría como 'wrong-cwd' — es decir, exactamente la
    // falsa alarma que la guarda de `custom_title` existe para evitar, y
    // además con consecuencia de exit code: desde que 'wrong-cwd' dejó de
    // contar como lanzado, un repo entero pasaría de exit 0 a exit 3 sin
    // que nada estuviera mal.
    //
    // Arreglo, aplicado a los DOS campos y no a uno: un campo cuyo esquema
    // no reconocemos degrada a NO CONCLUYENTE, nunca a "verificado que está
    // mal". Para el cwd la degradación es POR ENTRADA (`cwdKnown`), no
    // global como la del título: así también se comporta bien ante una
    // flota mixta (unas entradas con el campo, otras sin él), y ante una
    // sesión que legítimamente no expone directorio. `verifyCmuxLaunch`
    // (más abajo) traduce `cwdKnown: false` a un estado propio
    // ('cwd-unknown'), jamás a 'wrong-cwd'.
    let sawAnyWorkspaceEntry = false
    let sawAnyRecognizedTitle = false
    for (const w of (Array.isArray(windows) ? windows : [])) {
      if (!w || !w.id) continue
      try {
        const wsRaw = execFileSync('cmux', ['workspace', 'list', '--window', w.id, '--json'], {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: CMUX_QUERY_TIMEOUT_MS, killSignal: 'SIGKILL',
        })
        const parsed = JSON.parse(wsRaw)
        const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : []
        for (const ws of workspaces) {
          sawAnyWorkspaceEntry = true
          if (ws && typeof ws.custom_title === 'string') {
            sawAnyRecognizedTitle = true
            const cwdKnown = typeof ws.current_directory === 'string'
            out.push({ title: ws.custom_title, cwd: cwdKnown ? ws.current_directory : null, cwdKnown })
          }
        }
      } catch {
        // Una ventana concreta que no se pueda consultar no invalida las
        // demás — se sigue con el resto; solo una consulta INICIAL fallida
        // (list-windows) marca el resultado global como no concluyente.
      }
    }
    if (sawAnyWorkspaceEntry && !sawAnyRecognizedTitle) return null
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

// `getCmuxTitles` es un THUNK, no el valor ya calculado (F13): la consulta a
// cmux (list-windows + un workspace list por ventana, hasta
// CMUX_QUERY_TIMEOUT_MS) solo se dispara si las DOS señales baratas y locales
// —worktree en disco, rama en este checkout— han fallado ya. Antes el valor
// llegaba precalculado, así que preguntar por la vida de un issue costaba
// siempre la consulta completa aunque su worktree estuviera ahí delante.
//
// Importa desde F13/H3, que amplía la comprobación al caso "cap lleno" — el
// resultado MÁS COMÚN de un /ct-next con algo corriendo. Sin esta inversión,
// cada invocación rutinaria pagaría la consulta a cmux para no decir nada.
// La semántica no cambia en absoluto: basta UNA señal de vida para no emitir
// nota, y el orden en que se comprueban no altera esa conjunción.
function assessLocalLiveness(n, getCmuxTitles) {
  const wt = `${repoRoot}/.worktrees/${n}`
  const hasWorktree = existsSync(wt)
  let hasBranch = false
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/feat/${n}`], {
      cwd: repoRoot, stdio: 'ignore', timeout: childTimeoutFor(), killSignal: 'SIGKILL',
    })
    hasBranch = true
  } catch {
    hasBranch = false
  }
  // Corto aquí: con worktree o rama ya sabemos que NO hay nota que emitir, y
  // `cmuxChecked` es irrelevante en ese camino (stalenessNote sale por el
  // primer `return null`). Afirmar `cmuxChecked: false` sin haber preguntado
  // sería correcto pero engañoso si alguien leyera el struct fuera de aquí,
  // así que se marca explícitamente como no consultado.
  if (hasWorktree || hasBranch) return { hasWorktree, hasBranch, hasCmuxWorkspace: false, cmuxChecked: false }
  const cmuxTitles = getCmuxTitles()
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
  // Memoizado Y perezoso: el thunk se le pasa a assessLocalLiveness, que solo
  // lo invoca si ni el worktree ni la rama existen (ver su comentario). Una
  // sola consulta por corrida como mucho, cero si ningún issue la necesita.
  const getCmuxTitles = () => {
    if (!queried) {
      cmuxTitlesCache = queryCmuxWorkspaceTitles()
      queried = true
    }
    return cmuxTitlesCache
  }
  return {
    stalenessNoteFor(n) {
      return stalenessNote(n, assessLocalLiveness(n, getCmuxTitles))
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
//
// Cuatro estados, no tres (D5, hallazgo B):
//   'confirmed'    → la sesión existe con el título pedido Y su directorio
//                    coincide. Única forma de afirmar "está donde le dijimos".
//   'wrong-cwd'    → la sesión existe y cmux SÍ nos dio un directorio, y NO
//                    es el pedido. Evidencia positiva de un problema.
//   'cwd-unknown'  → la sesión existe con el título pedido, pero cmux no
//                    expuso ningún directorio legible para ella (campo
//                    ausente, renombrado, o de otro tipo). Sabemos MÁS que
//                    con 'unverifiable' (la sesión existe) y MENOS que con
//                    'confirmed' (no se pudo comprobar el directorio) — y
//                    desde luego no es 'wrong-cwd': no hay ninguna evidencia
//                    de que esté en el sitio equivocado.
//   'not-found'    → cmux respondió, con esquema reconocido, y no hay
//                    ninguna sesión con ese título.
//   'unverifiable' → la consulta a cmux no se pudo completar en absoluto.
function verifyCmuxLaunch(expectedTitle, expectedCwd) {
  const all = queryAllCmuxWorkspaces()
  if (all === null) return { status: 'unverifiable' }
  const match = all.find((w) => w.title === expectedTitle)
  if (!match) return { status: 'not-found' }
  if (!match.cwdKnown) return { status: 'cwd-unknown' }
  if (match.cwd === expectedCwd) return { status: 'confirmed' }
  return { status: 'wrong-cwd', actualCwd: match.cwd }
}

// stateReasonLabel (F13/H4): cómo se llama, en el idioma del usuario, el
// motivo de cierre que GitHub devuelve. `null` (issue cerrado antes de que
// GitHub tuviera `state_reason`, o sin él) NO se traduce a "not planned": se
// dice que no consta.
function stateReasonLabel(sr) {
  if (sr === 'NOT_PLANNED') return 'cerrado como "not planned"'
  if (sr === 'REOPENED') return 'cerrado con motivo "reopened"'
  if (sr == null) return 'cerrado sin motivo de cierre registrado'
  return `cerrado con motivo "${sr}"`
}

// ============================================================================
// F16/H1 — LA MEDIDA DE UN MENSAJE DE BLOQUEO NO ES SI ES CIERTO, ES SI LLEVA
// A HACER ALGO QUE SIRVA.
//
// El hallazgo de campo: cinco issues ocupaban el carril serializante global y
// el dispatcher nombró uno. Cada frase era literalmente cierta, y aun así el
// mensaje entero era una instrucción equivocada — un lector razonable deduce
// "quito ese y sale", resuelve, vuelve a correr, y se encuentra igual de
// bloqueado. Cuatro veces seguidas.
//
// La regla que sale de ahí, y que se aplica a TODAS las explicaciones de este
// fichero: si para descubrir los N bloqueantes hubiera que repetir el ciclo N
// veces, hay que decirlos de una vez. Con el cuidado opuesto: cuarenta issues
// listados tampoco son accionables. Cuando la lista crece, lo que hace falta
// para DECIDIR es el recuento (¿es una pared o un guijarro?), no los cuarenta
// nombres — así que se lista una muestra y NUNCA se calla el total.
const MAX_BLOQUEANTES_LISTADOS = 8

// refsAcotadas: "#1, #2, #3" o "#1, …, #8 y 22 más". El total siempre sale.
function refsAcotadas(ns) {
  const shown = ns.slice(0, MAX_BLOQUEANTES_LISTADOS).map((n) => `#${n}`)
  const rest = ns.length - shown.length
  return rest > 0 ? `${shown.join(', ')} y ${rest} más` : shown.join(', ')
}

// detalleDeHolders: el mismo acotado, para los inventarios de --dry-run ("En
// vuelo", "Sin mergear, reteniendo tokens"). Antes se volcaban ENTEROS: con
// treinta slices en revisión al final de un epic, esas dos líneas eran un
// muro que empujaba fuera de pantalla justo el mensaje que explica el
// bloqueo. El recuento va en la propia etiqueta de la línea, así que
// recortar la enumeración no esconde el tamaño del problema.
function detalleDeHolders(holders) {
  const shown = holders
    .slice(0, MAX_BLOQUEANTES_LISTADOS)
    .map((i) => `#${i.n} [${((i.touches || []).length ? i.touches.map((t) => `touches:${t}`).join(', ') : 'sin touches')}]`)
  const rest = holders.length - shown.length
  return rest > 0 ? `${shown.join(', ')} … y ${rest} más` : shown.join(', ')
}

// motivoDeBloqueante: por qué ESTE issue impide despachar al candidato. Los
// dos motivos no son excluyentes (un holder puede compartir token Y ocupar el
// carril con otro token distinto), así que se dicen los dos cuando los dos
// aplican — es exactamente el caso en el que resolver "el token" deja al
// usuario chocando con el carril en la vuelta siguiente.
// La explicación de QUÉ es el carril serializante se dice UNA vez, en la
// nota de cabecera — no pegada a cada línea. Repetida cinco veces (el caso
// real que originó esto) empuja fuera de pantalla lo único que hay que leer:
// los números y el recuento.
function motivoDeBloqueante(b, candN) {
  const partes = []
  if (b.sharedTokens.length) {
    partes.push(`retiene ${b.sharedTokens.map((t) => `'${t}'`).join(', ')}, que #${candN} también toca`)
  }
  if (b.laneTokens.length) {
    partes.push(`ocupa el carril serializante con ${b.laneTokens.map((t) => `touches:${t}`).join(', ')}`)
  }
  const estado = b.status ? `status:${b.status}` : 'estado desconocido'
  return `  - #${b.n} (${estado}) — ${partes.join('; y además ')}`
}

// formatColisionMultiple: el mensaje cuando bloquean DOS O MÁS. No es el
// mensaje de uno repetido N veces: la lista de bloqueantes de un candidato es
// una CONJUNCIÓN (hay que despejarlos todos), y eso hay que decirlo en la
// primera línea, antes que ningún detalle — es la parte que cambia lo que
// alguien va a hacer a continuación.
//
// El remedio se agrupa por ESTADO y no por bloqueante, porque el remedio
// depende del estado y no del issue: los `in-review` se sacan mergeando (no
// hay agente a quien esperar), los `in-progress` se sacan esperando (y ahí sí
// tiene sentido la nota de claim rancio). Un carril con cuatro in-review y un
// in-progress necesita las DOS instrucciones, y el mensaje viejo solo podía
// dar una.
function formatColisionMultiple(reason, ctx) {
  const blockers = reason.blockers
  const candN = reason.issue
  const lineas = blockers.slice(0, MAX_BLOQUEANTES_LISTADOS).map((b) => motivoDeBloqueante(b, candN))
  const ocultos = blockers.length - lineas.length
  if (ocultos > 0) {
    lineas.push(`  … y ${ocultos} más (no se listan todos: para decidir aquí lo que cuenta es que son ${blockers.length}, no cuáles)`)
  }

  const enReview = blockers.filter((b) => b.status === 'in-review').map((b) => b.n)
  const enCurso = blockers.filter((b) => b.status === 'in-progress').map((b) => b.n)
  const sinEstado = blockers.filter((b) => b.status !== 'in-review' && b.status !== 'in-progress').map((b) => b.n)

  const remedios = []
  if (enReview.length) {
    remedios.push(`${enReview.length} en status:in-review (${refsAcotadas(enReview)}): trabajo entregado pero SIN MERGEAR, sin ningún agente detrás — esperar no sirve de nada. Lo único que suelta esos tokens es el MERGE de su PR (o cerrar el issue como completed si el PR ya se mergeó y nadie lo cerró porque le faltaba el "Closes #<n>"). \`--reopen\` NO suelta nada: deja el slice en status:in-progress reteniendo estos mismos tokens hasta que su trabajo se mergee.`)
  }
  if (enCurso.length) {
    remedios.push(`${enCurso.length} en status:in-progress (${refsAcotadas(enCurso)}): ahí sí hay (o debería haber) un agente vivo, y esperar es el remedio correcto.`)
  }
  if (sinEstado.length) {
    remedios.push(`${sinEstado.length} sin estado conocido (${refsAcotadas(sinEstado)}): compruébalos a mano.`)
  }

  // La nota de claim rancio SOLO para los que dicen tener un agente vivo (o
  // no dicen nada): en un in-review, no tener worktree/rama/sesión es lo
  // NORMAL y pedirla convertiría cada PR en revisión en una falsa alarma —
  // el mismo criterio que ya aplicaba el caso de un solo bloqueante. Se
  // acota al mismo número que la lista para no disparar cuarenta consultas
  // a git/cmux por un mensaje.
  const notas = ctx
    ? [...enCurso, ...sinEstado].slice(0, MAX_BLOQUEANTES_LISTADOS).map((n) => ctx.stalenessNoteFor(n)).filter(Boolean)
    : []
  const cola = notas.length ? `\nATENCIÓN, alguno de esos claims puede estar muerto: ${notas.join(' ')}` : ''

  // La nota del carril solo aparece si alguien bloquea POR carril: si todos
  // los bloqueantes comparten token literal, explicar el carril es ruido.
  const hayCarril = blockers.some((b) => b.laneTokens.length)
  const notaCarril = hayCarril
    ? ` El carril serializante (migration/ci/pbxproj) es GLOBAL: basta con que #${candN} toque uno cualquiera de esos tres para chocar con TODO el que tenga otro, sin compartir token con nadie.`
    : ''

  return `#${candN} está ready con deps mergeadas, pero NO basta con desbloquear uno: ${blockers.length} issues retienen a la vez lo que necesita, y hasta que salgan TODOS seguirá sin poder despacharse — resolver uno solo te devolvería justo aquí en la vuelta siguiente, con otro nombre distinto.${notaCarril}\n${lineas.join('\n')}\nQué hace falta, por grupos: ${remedios.join(' ')}${cola}`
}

function formatReason(reason, ctx) {
  switch (reason?.reason) {
    case 'none-ready': {
      // F13: el mensaje callaba los slices parados en `status:in-review`. Al
      // final de un epic ese es el estado NORMAL —todo entregado, nada
      // mergeado— y "no hay nada que despachar todavía" lo pinta como si no
      // se hubiera empezado. Además, desde F13/H2 esos issues RETIENEN sus
      // tokens: son la causa de que lo siguiente no salga, no un detalle.
      // F16/H1, con la misma lente: "no hay nada que despachar TODAVÍA" es
      // una instrucción a ESPERAR, y con todo el epic en `status:backlog` no
      // hay nada que esperar — promover backlog → ready es el gate HUMANO
      // del loop (ct-groom hasta lo recuerda al terminar un groom). Nadie va
      // a abrir ese gate si el dispatcher dice que aún no toca. Verificado
      // sin arreglar: tres issues en backlog y CERO issues abiertos producían
      // el mismo texto palabra por palabra, y sus remedios son opuestos.
      const inReview = reason.inReview || []
      const backlog = reason.backlog || []
      const inProgress = reason.inProgress || []
      const total = reason.total
      // El prefijo se conserva literal en todas las ramas: es lo que hace
      // que la causa siga siendo reconocible de un vistazo (y lo que fijan
      // los tests preexistentes de W-B).
      const cabeza = 'No hay ningún issue en status:ready'
      if (total === 0) {
        return `${cabeza} — de hecho no hay NINGÚN issue abierto en este repo. Eso no es "el loop está al día", es "no hay nada que mirar": o el epic todavía no se ha groomeado (\`/ct-groom <spec> --repo <owner/repo>\`), o --repo apunta a un repo distinto del que crees. Comprueba las dos cosas antes de darlo por terminado.`
      }
      const partes = []
      if (backlog.length) {
        partes.push(`Hay ${backlog.length} en status:backlog (${refsAcotadas(backlog)}): eso NO se desbloquea esperando. Promover backlog → ready es el gate humano del loop —decides tú qué entra en vuelo— y hasta que lo abras no habrá nada que despachar: \`gh issue edit <n> --repo <owner/repo> --add-label status:ready --remove-label status:backlog\`.`)
      }
      if (inReview.length) {
        partes.push(`Hay ${inReview.length} en status:in-review (${refsAcotadas(inReview)}): su trabajo está entregado pero SIN MERGEAR, así que ni desbloquea a sus dependientes (merge-after exige el merge) ni suelta sus tokens de área/touches. Mergea sus PRs (o, si un PR ya se mergeó y el issue sigue abierto, ciérralo como completed) — y si alguno se rechazó en revisión y vas a corregir encima, devuélvelo al banco de trabajo con \`node <plugin>/scripts/dispatch-check.mjs <n> --repo <owner/repo> --reopen\` (queda en status:in-progress: SIGUE reteniendo sus tokens, porque su trabajo sigue sin mergear — reabrir no desbloquea a sus vecinos, solo dice quién lo está rehaciendo).`)
      }
      if (inProgress.length) {
        partes.push(`Hay ${inProgress.length} en status:in-progress (${refsAcotadas(inProgress)}): con agente vivo, ahí sí toca esperar.`)
      }
      if (!partes.length) {
        // Ni backlog, ni in-review, ni in-progress, y sin embargo hay issues
        // abiertos: están fuera del loop. Decirlo, en vez de dejar que la
        // frase corta se lea como "ya no queda trabajo".
        return `${cabeza}, y ninguno de los ${total} issue(s) abiertos está en ningún otro estado del loop (backlog/in-progress/in-review): están FUERA del loop, probablemente sin ninguna label \`status:\` — /ct-next no los ve. Si alguno debería despacharse, etiquétalo; si no, no hay nada que hacer aquí.`
      }
      return `${cabeza}. ${partes.join(' ')}`
    }
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
        //   - F13/H4: una dependencia cuyo issue está CERRADO pero NO como
        //     "completed" (típicamente "not planned", que es lo correcto para
        //     un slice descartado). `filterMergedIssues` solo cuenta
        //     'COMPLETED', así que esa dep NUNCA se va a satisfacer sola —
        //     pero el mensaje decía "falta mergear #7" igual que si el
        //     trabajo siguiera en curso, y el dependiente esperaba para
        //     siempre en silencio. Ahora se nombra el estado real y el
        //     remedio, que aquí NO es esperar sino decidir: quitar la dep, o
        //     reabrir y cerrar como completed si el trabajo sí se hizo.
        const depStates = reason.depStates || {}
        const deps = b.unmetDeps.map((d) => {
          if (d == null) {
            return 'una dependencia declarada contra un orden que no corresponde a ningún issue existente (¿"merge-after" a un slice que no existe, o que aún no se groomeó?) — nunca se resolverá sola con esperar; corrige el "merge-after" o el "ct-order" del issue referenciado'
          }
          if (Object.prototype.hasOwnProperty.call(depStates, d)) {
            return `#${d}, que está ${stateReasonLabel(depStates[d])} — una dep solo cuenta como satisfecha si su issue está cerrado como "completed", así que ESTA NO SE VA A SATISFACER NUNCA por sí sola: quita el "merge-after #<orden>" de la sección "## Dependencias" de #${b.n} si el slice se descartó, o reabre #${d} y ciérralo como completed si su trabajo sí se hizo`
          }
          return `#${d}`
        })
        return `#${b.n} (falta mergear ${deps.join(', ')})`
      }).join('; ')
      // La coletilla final NO puede decir "espera a que se mergeen" cuando
      // NINGUNA de las deps pendientes puede mergearse ya. Observado en una
      // corrida real contra el sandbox: el detalle decía "ESTA NO SE VA A
      // SATISFACER NUNCA" y el cierre, tres palabras después, "espera a que
      // se mergeen esas dependencias" — el mensaje se contradecía a sí mismo
      // y la última frase es la que se queda. `waitable` es cierto solo si
      // queda al menos una dep que de verdad pueda satisfacerse esperando:
      // un issue todavía abierto (ni traducida a null, ni cerrada sin
      // completar, ni con la sección de deps ilegible).
      const depStatesTail = reason.depStates || {}
      const waitable = reason.blocked.some((b) => !b.malformed && (b.unmetDeps || []).some(
        (d) => d != null && !Object.prototype.hasOwnProperty.call(depStatesTail, d)
      ))
      const tail = waitable
        ? 'espera a que se mergeen esas dependencias, o corrige el issue si el bloqueo es por datos, no por trabajo pendiente.'
        : 'esperar NO va a desbloquear nada aquí: ninguna de esas dependencias puede satisfacerse sola. Corrige los issues como se indica arriba.'
      return `Hay slice(s) en status:ready pero con dependencias sin mergear o sin resolver: ${list} — ${tail}`
    }
    case 'collision': {
      // F13/H2 — DOS BLOQUEOS DISTINTOS BAJO EL MISMO NOMBRE. Desde que
      // `status:in-review` retiene tokens (dispatch.js#collectTokenHolders),
      // "colisiona con trabajo en vuelo" puede significar dos cosas con dos
      // remedios opuestos:
      //   - contra un `in-progress`: hay (o debería haber) un agente vivo.
      //     "Espera a que termine" es un consejo correcto, y la nota de
      //     staleness sirve para decir cuándo NO lo es.
      //   - contra un `in-review`: NO hay ningún agente. El trabajo está
      //     entregado y esperando merge. "Espera a que termine" sería
      //     absurdo — lo que hay que hacer es mergear el PR (o cerrar el
      //     issue si el PR ya se mergeó y nadie lo cerró, o reabrir el slice
      //     si la revisión lo rechazó).
      //
      // Y la nota de staleness NO se pide para un `in-review` (ver
      // `holderStatus` abajo): esa comprobación busca worktree/rama/sesión de
      // cmux, y en un slice ya entregado su ausencia es lo NORMAL, no una
      // anomalía. Pedirla ahí convertiría cada PR en revisión en una falsa
      // alarma de "claim huérfano" — exactamente el falso positivo que la
      // detección de staleness se diseñó para no producir.
      //
      // `withIssueStatus` puede ser `null` cuando quien llamó no aportó el
      // estado (llamadas unitarias antiguas): en ese caso se mantiene el
      // comportamiento de antes (nota de staleness incluida) en vez de
      // afirmar un estado que no se conoce.
      // F16/H1: si bloquean DOS O MÁS, ningún mensaje que nombre a uno solo
      // puede ser honesto — se va por la rama que los dice todos. Con UNO,
      // el mensaje de siempre se conserva palabra por palabra: añadir "hay
      // que despejarlos todos" cuando "todos" es uno sería ruido, y los
      // tests de F13/staleness fijan ese texto literal.
      // `blockers` puede faltar en llamadas unitarias antiguas a esta
      // función (que solo conocían la atribución de un issue): en ese caso
      // se mantiene exactamente el comportamiento anterior.
      if ((reason.blockers || []).length > 1) return formatColisionMultiple(reason, ctx)
      const holderStatus = reason.withIssueStatus ?? null
      const inReviewHolder = holderStatus === 'in-review'
      // Finding 2: `ctx?.stalenessNoteFor(reason.withIssue)` solo hace algo
      // cuando `ctx` viene informado (siempre, desde el call site real de
      // más abajo) — se deja opcional para que las pruebas unitarias de esta
      // función sigan pudiendo llamarla sin un contexto, sin reventar.
      const note = (ctx && !inReviewHolder) ? ctx.stalenessNoteFor(reason.withIssue) : null
      // El remedio del caso in-review, en un solo sitio: el mismo texto vale
      // para la colisión por token y para la serializante.
      const reviewHint = `#${reason.withIssue} está en status:in-review: su trabajo está entregado pero SIN MERGEAR, así que retiene sus tokens hasta el merge — ramificar ahora de la base te daría un árbol que todavía no lo contiene. NO hay ningún agente trabajándolo: esperar no sirve de nada. Mergea su PR; si su PR YA se mergeó y el issue sigue abierto (el PR no llevaba "Closes #${reason.withIssue}"), ciérralo como completed; si la revisión lo rechazó, \`node <plugin>/scripts/dispatch-check.mjs ${reason.withIssue} --repo <owner/repo> --reopen\` lo devuelve al banco de trabajo — OJO: eso NO te desbloquea, porque #${reason.withIssue} se queda en status:in-progress reteniendo estos mismos tokens hasta que su trabajo se mergee. Lo único que desbloquea es el merge (o abandonar #${reason.withIssue} del todo: borrar su rama y \`--requeue\`).`
      // "en vuelo" solo se dice del caso `in-progress`, donde es literalmente
      // cierto. Para `in-review` la frase sería falsa (no vuela nada: está
      // parado esperando merge) — se dice "trabajo entregado sin mergear".
      if (reason.kind === 'serializing') {
        if (inReviewHolder) {
          return `#${reason.issue} está ready con deps mergeadas, pero no se puede serializar: su touches:${reason.token} entra en el mismo grupo serializante (migration/ci/pbxproj) que touches:${reason.runningToken}, retenido por #${reason.withIssue} (status:in-review) — ${reviewHint}`
        }
        const base = `#${reason.issue} está ready con deps mergeadas, pero no se puede serializar: su touches:${reason.token} entra en el mismo grupo serializante (migration/ci/pbxproj) que touches:${reason.runningToken}, ya en vuelo en #${reason.withIssue}`
        return note ? `${base} — ${note}` : `${base} — espera a que termine.`
      }
      if (inReviewHolder) {
        return `#${reason.issue} está ready con deps mergeadas, pero colisiona con trabajo entregado sin mergear: comparte el token '${reason.token}' con #${reason.withIssue} (status:in-review) — ${reviewHint}`
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
    // F13/H3 — UN CLAIM MUERTO QUE COPA EL CAP ERA COMPLETAMENTE INVISIBLE.
    // La detección de claims rancios (ronda D3) solo se consultaba desde el
    // caso 'collision': si el issue muerto NO comparte ningún token con el
    // candidato, pero SÍ ocupa el único hueco de cap, el mensaje era "sube
    // --cap, o espera a que termine alguno" — mandando esperar a un agente
    // que ya no existe, sin una sola pista. Verificado contra el código sin
    // arreglar con un fixture de #5 in-progress (sin worktree, sin rama, sin
    // cmux) y #6 ready con touches distintos: la salida no contenía ninguna
    // mención de staleness.
    //
    // Ahora se cruza CADA issue que ocupa el cap contra la misma evidencia
    // local (worktree / rama / sesión de cmux). Mismas cautelas que en el
    // caso 'collision', porque es literalmente la misma función: basta UNA
    // señal de vida para no decir nada, y aun sin ninguna nunca se afirma
    // "abandonado" (la comprobación es solo de esta máquina).
    //
    // Lo que esto NO resuelve, y conviene no fingir que sí: solo se entera
    // quien esté corriendo `/ct-next` en ese momento. No hay demonio, ni
    // heartbeat, ni nada que vigile los claims entre invocaciones — un claim
    // muerto a las 3 AM sigue muerto hasta que alguien invoque el
    // dispatcher. Eso es una limitación del diseño (el claim es un label),
    // no un hueco de este mensaje, y está dicho como tal en el contrato de la
    // §9 que siembra ct-init.
    const notes = ctx
      ? (reason.inFlight || []).map((i) => ({ n: i.n, note: ctx.stalenessNoteFor(i.n) })).filter((x) => x.note)
      : []
    const stale = notes.length
      ? ` ATENCIÓN, el cap puede estar copado por un claim muerto: ${notes.map((x) => x.note).join(' ')}`
      : ''
    if (reason.wouldDispatchIfCapAllowed) {
      return `${base} — sube --cap, o espera a que termine alguno.${stale}`
    }
    return `${base} — aunque subieras --cap no bastaría todavía: ${formatReason(reason.blockedEvenWithCap, ctx)}${stale}`
  }
  return formatReason(reason, ctx)
}

const usage = 'uso: ct-next.mjs --repo <o/r> [--cap N] [--base <rama>] [--dry-run]'
const repo = arg('--repo')
const capArg = arg('--cap', '1')
const baseArg = arg('--base')
const dryRun = has('--dry-run')

if (typeof repo !== 'string' || repo.length === 0) { console.error(usage); process.exit(2) }
// Forma de `--repo` (D4, revisión de los argumentos de valor): el resto del
// script asume `owner/repo` en varios sitios a la vez (la guarda de
// identidad contra el remote, el mapa de cuentas, la URL de `gh api
// repos/<repo>/issues`). Antes, cualquier cadena no vacía pasaba: `--repo
// menoplus` llegaba hasta `gh` y moría con un 404 sin explicar que el
// problema era la forma del argumento, y `repo.split('/').pop()` producía un
// "nombre de repo" que era el slug entero.
if (!parseRepoSlug(repo)) {
  console.error(`--repo inválido: "${repo}" — debe tener la forma owner/repo (p.ej. josemerca/control-tower), con exactamente una barra y ambas mitades no vacías.`)
  process.exit(2)
}
// D4, defecto 2: `parseInt(capArg, 10)` aceptaba en silencio un valor
// DISTINTO del que el usuario escribió — `--cap 1e3` despachaba 1,
// `--cap 3perros` despachaba 3, `--cap 2.9` despachaba 2 (verificado por
// construcción contra el código sin arreglar, los tres sin una sola línea
// de aviso). Ver scripts/argnum.js para el porqué de cada forma rechazada.
// El rango y el "no es un entero" se distinguen en el mensaje a propósito:
// son dos errores distintos con dos correcciones distintas.
const cap = typeof capArg === 'string' ? parseStrictInt(capArg) : null
if (capArg === true || cap === null) {
  console.error(`--cap inválido: "${capArg === true ? '(sin valor)' : capArg}" — debe ser un entero en dígitos decimales a secas (nada de "1e3", "2.9", "3perros", espacios, ni signo "+"/"-": antes se aceptaban en silencio con un valor distinto del pedido, y el signo se aceptaba pese a que este mismo mensaje decía lo contrario).`)
  process.exit(2)
}
if (cap < 1) {
  console.error(`--cap inválido: "${capArg}" — debe ser >= 1 (un cap de ${cap} no despacharía nada).`)
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

// ============================================================================
// F16/H2 — CRITERIO DE CANAL, ÚNICO PARA LOS TRES EJECUTABLES DEL PLUGIN
// (ct-next.mjs, ct-groom.mjs, dispatch-check.mjs).
//
//   STDOUT = el PRODUCTO. Lo que el comando produjo o decidió, y que alguien
//            podría querer capturar, redirigir o parsear: el plan de despacho
//            (`git worktree add …`, el kickoff, la línea de `cmux`), la
//            selección, el motivo de bloqueo, el registro de lo lanzado. En
//            ct-groom, el JSON del plan y el acta de lo creado; en
//            dispatch-check, el resultado del protocolo de claim
//            (`claimed #N → in-progress`).
//   STDERR = el DIAGNÓSTICO. Todo lo dirigido al humano SOBRE la corrida, no
//            el resultado de la corrida: `aviso:`, `recordatorio:`,
//            `ATENCIÓN:`, y cualquier mensaje de aborto.
//
// QUÉ ESTABA ROTO, verificado en campo: `warn()` emitía
// `console.log(\`aviso: …\`)` — a stdout —, mientras los avisos equivalentes de
// ct-groom.mjs van por `console.error`. Una corrida de /ct-next con avisos en
// pantalla dejaba 0 BYTES en stderr. Dos consecuencias reales, no teóricas:
// el diagnóstico se mezclaba con la salida que alguien podría capturar
// (`/ct-next --dry-run > plan.txt` se llevaba los avisos dentro del plan), y
// quien capturara stderr esperando los avisos —porque así funciona /ct-groom—
// no recibía nada.
//
// LO QUE ESTE CAMBIO NO PUEDE ROMPER, y no rompe:
//   - D5: un destino de salida roto (`ct-next | head` → EPIPE) NUNCA decide el
//     resultado del protocolo. `console.error` va al mismo `process.stderr`
//     que ya tiene su manejador `on('error')` instalado al principio de este
//     fichero (junto al de stdout), así que un EPIPE en un aviso se traga
//     igual que antes. El exit code sigue describiendo qué le pasó al
//     TRABAJO. Hay tests que lo fijan (ct-next-exit-code-contract.test.js).
//   - La truncación a 64 KiB: el recap del manejador de 'exit' sigue usando
//     `writeSync(2, …)` — sigue siendo la única escritura que ocurre DENTRO
//     de un 'exit', donde lo asíncrono no llega a salir. Este cambio no la
//     toca; de hecho ahora aviso y recap comparten fd, que es lo coherente.
//
// D4 — avisos acumulados. Un aviso es algo que NO impide seguir pero que el
// humano tiene que ver: se imprime en el momento (para que aparezca en el
// contexto donde ocurre) Y se acumula, para poder cerrar un --dry-run
// diciendo explícitamente que salió 0 A PESAR de N avisos. Sin ese recap,
// tres avisos en medio de cuarenta líneas de plan y un exit 0 al final se
// leen, con toda razón, como "todo bien".
const warnings = []
function warn(msg) {
  warnings.push(msg)
  console.error(`aviso: ${msg}`)
}
// El recap va en un manejador de 'exit' y no al final del fichero a
// propósito: este script termina en MUCHOS `process.exit()` distintos
// (bloqueo sin selección, precondiciones, claim atascado, señal…), y un
// recap colocado "al final" solo se imprimiría en el camino feliz — justo el
// único en el que menos falta hace. `writeSync` y no console.log porque
// dentro de un manejador de 'exit' solo las escrituras SÍNCRONAS llegan a
// salir (mismo motivo, ya documentado en attemptClaim, por el que
// process.stdout es asíncrono hacia una tubería en POSIX).
process.on('exit', (code) => {
  if (!warnings.length) return
  const lines = warnings.map((w, i) => `  ${i + 1}. ${w}`).join('\n')
  const what = dryRun ? 'este --dry-run' : 'esta corrida'
  const nuance = code === 0
    ? 'un exit 0 aquí significa "no se ha roto nada", NO "todo es como esperas" — lee los avisos antes de darlo por bueno'
    : 'los avisos siguen siendo relevantes, además del fallo que provocó ese exit code'
  try {
    writeSync(2, `\n${what} terminó con exit ${code} A PESAR de ${warnings.length} aviso(s); ${nuance}:\n${lines}\n`)
  } catch {
    // stderr cerrado (p.ej. la tubería del caller ya no existe): un recap que
    // no se puede escribir no debe convertir una salida limpia en un crash.
  }
})

// ============================================================================
// D4, defecto 1 — resolución de cuenta, con voz.
//
// Se hace AQUÍ, al arrancar: antes de listar issues, antes de reclamar nada
// y antes de crear ningún worktree. Un mapa mal formado o un directorio de
// cuenta inexistente son cosas que se saben sin tocar la red — descubrirlas
// cuando ya se han lanzado tres agentes (cada uno con su claim escrito en
// GitHub) es exactamente el modo de fallo que este bloque cierra.
const accountMapErrors = validateAccountMap(ACCOUNT_MAP)
if (accountMapErrors.length) {
  console.error(`ACCOUNT_MAP (scripts/kickoff.js) está mal formado — ct-next.mjs no continúa: con un mapa roto, la cuenta de Claude con la que se lanzaría cada agente es indeterminada.\n  - ${accountMapErrors.join('\n  - ')}\nFormato de patrón: <owner>/<repo>, con cada mitad literal, "*", o un prefijo terminado en "*".`)
  process.exit(2)
}

const account = resolveAccount(repo, ACCOUNT_MAP)
const configDir = account.dir
const accountLabel = account.account === 'work' ? 'trabajo' : 'personal'
if (account.matched) {
  console.log(`cuenta resuelta: ${configDir} (${accountLabel}) — por la regla "${account.pattern}" de ACCOUNT_MAP.`)
} else {
  // Requisito explícito: el fallback tiene que TENER VOZ. Antes, un repo que
  // no casaba con ningún patrón acababa en la cuenta personal sin que nada
  // lo dijera — el caso de `mercadona/algun-tool-interno`: código de
  // trabajo, con contexto de trabajo, bajo la cuenta personal, en silencio.
  warn(`ningún patrón de ACCOUNT_MAP casa con "${repo}" — se usa la cuenta POR DEFECTO: ${configDir} (${accountLabel}). Si este repo es de trabajo, añade un patrón (p.ej. "${parseRepoSlug(repo).owner}/*") a ACCOUNT_MAP.work en scripts/kickoff.js antes de lanzar nada; el agente se despachará con la cuenta personal hasta entonces.`)
}
if (account.conflictPattern) {
  warn(`"${repo}" casa a la vez con "${account.pattern}" (work) y con "${account.conflictPattern}" (personal) en ACCOUNT_MAP — gana la cuenta de TRABAJO (${configDir}) por ser el error más caro al revés, pero el mapa es ambiguo: quita o estrecha uno de los dos patrones.`)
}
// Reclasificación respecto del mapa viejo (requisito explícito: "si al
// arreglarlo un repo que hoy funciona pasa a la otra cuenta, eso no puede
// pasar callado"). Solo habla cuando el DIRECTORIO cambia — no cuando lo
// único que cambia es la regla por la que se llegó al mismo sitio.
const legacyAccount = resolveAccountLegacy(repo, ACCOUNT_MAP)
if (legacyAccount && legacyAccount.dir !== configDir) {
  warn(`CAMBIO DE CUENTA respecto del mapa anterior: "${repo}" se despachaba antes con ${legacyAccount.dir} (${legacyAccount.account === 'work' ? 'trabajo' : 'personal'}${legacyAccount.matched ? '' : ', por defecto'}) y ahora se despacha con ${configDir} (${accountLabel})${account.matched ? `, por la regla "${account.pattern}"` : ', por defecto'}. El matching por owner (D4) es el arreglo deliberado — pero si esperabas la cuenta de antes, revísalo AHORA: el agente arrancará con otra sesión de Claude, otro historial y otra autenticación.`)
}

// findInPath: ¿existe un ejecutable con este nombre en el PATH de ESTE
// proceso? Se resuelve LEYENDO el filesystem (existsSync + X_OK), nunca
// ejecutando el binario ni preguntándole su versión: `cmux` en concreto
// NUNCA debe ejecutarse para comprobar su presencia (lanzar un workspace de
// verdad es justo lo que un --dry-run promete no hacer). Devuelve la ruta
// encontrada, o null.
function findInPath(name) {
  const raw = process.env.PATH || ''
  for (const dir of raw.split(pathDelimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    try {
      if (!statSync(candidate).isFile()) continue
      accessSync(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      // no existe, no es fichero, o no es ejecutable: siguiente directorio.
    }
  }
  return null
}
// ============================================================================

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
const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: GH_MAX_BUFFER, timeout: childTimeoutFor(), killSignal: 'SIGKILL' })

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
      // timeout+killSignal (MENOR, revisión externa: "TODA llamada
      // bloqueante" de la cabecera de finding 1 no era del todo cierto —
      // faltaban esta y las otras dos llamadas de git/gh puramente locales
      // de este fichero, sin protección alguna contra un cuelgue real).
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: repoRoot, stdio: 'ignore', timeout: childTimeoutFor(), killSignal: 'SIGKILL' })
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
    originUrl = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', timeout: childTimeoutFor(), killSignal: 'SIGKILL' }).trim()
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
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: childTimeoutFor(), killSignal: 'SIGKILL' }).trim()
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
// depStates (F13/H4): estado de los issues CERRADOS que NO cuentan como
// mergeados. Solo existe en la ruta real (buildDispatchInput); el fixture de
// test trae `issues`/`mergedIssues` ya mapeados, así que `|| {}` lo trata
// como "de ningún cierre consta el motivo" — nunca como "todos completed".
const { issues, mergedIssues } = dispatchInput
const depStates = dispatchInput.depStates || {}
// `orderCollisions` solo existe en la ruta real (buildDispatchInput) — el
// fixture de test (CT_NEXT_FIXTURE) ya trae issues pre-mapeados y no pasa
// por ese cálculo; `|| []` lo trata como "sin colisiones" en ese caso. Nunca
// aborta (ver el comentario de formatOrderCollisions): `issues` ya viene
// filtrado por buildDispatchInput.
//
// F16/H2 — estos cuatro bloques iban por `console.log` con el criterio
// "console.error se reserva para lo que aborta". Ese criterio es el que
// partía el plugin en dos: son `aviso:`, exactamente la misma categoría que
// ct-groom.mjs y ct-init.sh emiten por stderr. El criterio vigente (ver el
// bloque de `warn()`, arriba) es producto/diagnóstico, no aborta/no-aborta —
// y un aviso es diagnóstico aunque no aborte nada.
const orderCollisions = dispatchInput.orderCollisions || []
for (const w of formatOrderCollisions(orderCollisions)) console.error(w)
for (const w of formatStatusAmbiguityWarnings(issues)) console.error(w)
for (const w of formatStrayDepsWarnings(issues)) console.error(w)
// F11, parte B — el mismo hallazgo que hizo que ct-init deje de bootstrapear
// encima de convenciones ajenas en silencio, pero en el momento en que de
// verdad muerde: el DESPACHO. El kickoff que se le da a cada agente le manda
// liberar el claim con el `dispatch-check.mjs` del plugin y trabajar en el
// worktree `.worktrees/<n>` sobre `feat/<n>`. Si el AGENTS.md (o el CLAUDE.md)
// del repo le manda OTRA cosa — su propio `scripts/dispatch-check.sh`, otra
// ruta de worktrees — el agente recibe dos órdenes contradictorias y va a
// obedecer la del repo, que es la que lee al hidratarse. Ese es el camino
// exacto al deadlock que originó esta tanda: /ct-next pone
// `status:in-progress`, el agente arranca, corre el claim del repo, y el
// script del repo se encuentra un claim activo sobre su propio issue.
//
// Se mira SOLO la documentación del repo (no se escanea el árbol como hace
// ct-init): lo que contradice al kickoff es la INSTRUCCIÓN, no la existencia
// de un fichero — y un despacho no puede permitirse un recorrido del disco.
// Sí se sigue UN salto desde AGENTS.md/CLAUDE.md a los `.md` que ellos citan
// (F14): son unos pocos readFileSync, y ahí es donde el repo real tenía viva la
// orden vieja después de haberla quitado de las dos guías.
// Es un aviso más, del mismo tipo que los tres de arriba: nunca bloquea.
// Un fallo de lectura NO se calla como "no hay nada": ver `failures`.
function formatConventionWarnings() {
  if (fx) return [] // modo fixture: repoRoot sintético, no hay nada real que leer
  const out = []
  let docs = []
  let failures = []
  let acks = new Map()
  let ackProblems = []
  let ackUnreadable = null
  let ackProsaSinAcuses = false
  try {
    ;({ docs, failures } = readRepoDocs(repoRoot))
    ;({ acks, problems: ackProblems, unreadable: ackUnreadable, prosaSinAcuses: ackProsaSinAcuses } = readAck(repoRoot))
  } catch (e) {
    // Que la lectura reviente NO puede tumbar un despacho ni pasar por "no hay
    // conflicto": se dice y se sigue.
    out.push(`aviso: no se ha podido leer la documentación del repo para comprobar si contradice al kickoff (${e.message}). NO lo leas como "no hay conflicto": no se ha mirado.`)
  }
  for (const f of failures) {
    out.push(`aviso: no se ha podido leer la documentación del repo para comprobar si contradice al kickoff (${f}). NO lo leas como "no hay conflicto": no se ha mirado.`)
  }
  // `files: []` a propósito — sin recorrido de disco, la regla de directorios
  // de worktrees ajenos y la de ficheros de estado no disparan aquí. Las que sí
  // importan en el despacho (instrucción de claim, `git worktree add <otra
  // ruta>`) salen enteras de los documentos.
  const findings = detectConventions({ docs, files: [], acks }).filter((f) => f.id === 'claim' || f.id === 'worktrees')
  const text = formatFindings(findings, { where: `el repo ${repo}`, ackProblems, ackUnreadable, ackProsaSinAcuses })
  if (text) {
    const live = findings.some((f) => !f.silenced)
    out.push(
      live
        ? `${text}\n  En un DESPACHO esto importa ya: el kickoff manda liberar el claim con el dispatch-check del plugin y trabajar en .worktrees/<n> sobre feat/<n>. El agente va a leer las dos órdenes y obedecer la de tu repo.`
        : text
    )
  }
  return out
}
// F16/H2: por stderr, igual que los avisos de convenciones de ct-init.sh —
// que es literalmente el mismo hallazgo dicho por otro ejecutable del mismo
// plugin (ver __tests__/conventions.test.js, que los busca en `res.stderr`).
for (const w of formatConventionWarnings()) console.error(w)
// planDispatch (dispatch.js) es quien decide TODO lo que antes se hacía aquí
// a medias: antes este wrapper llamaba a selectNext con `runningTouches: []`
// hardcodeado, así que dos invocaciones sucesivas de /ct-next --cap 1 nunca
// se veían entre sí — ni para colisión de touches ni para el cap, que
// contaba solo lo lanzado EN ESTA tanda. planDispatch deriva el trabajo en
// vuelo (status:in-progress) de los mismos `issues` ya cargados, resta ese
// trabajo del cap antes de seleccionar, y explica el motivo exacto cuando no
// selecciona nada (W-B, §8) — este wrapper solo formatea lo que ya decidió.
const { selected, inFlight, tokenHolders, blockReason } = planDispatch(issues, { mergedIssues, cap, depStates })

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
    console.log(`En vuelo (${inFlight.length}/${cap} del cap ocupados): ${detalleDeHolders(inFlight)}`)
  } else {
    console.log(`En vuelo: ninguno (0/${cap} del cap ocupados).`)
  }
  // F13/H2: los slices en `status:in-review` NO ocupan cap (no hay agente
  // vivo) pero SÍ retienen sus tokens hasta el merge. Sin esta línea, un
  // --dry-run que no despacha nada por colisión contra un in-review dejaba al
  // humano mirando "En vuelo: ninguno" y un mensaje de colisión — una
  // contradicción aparente. Se lista aparte, no fundido con "En vuelo",
  // precisamente porque son dos contabilidades distintas.
  const reviewHolders = (tokenHolders || []).filter((i) => i.status === 'in-review')
  if (reviewHolders.length) {
    console.log(`Sin mergear, reteniendo tokens (${reviewHolders.length}, status:in-review, NO ocupan cap): ${detalleDeHolders(reviewHolders)}`)
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
// sliceRef (D4, defecto 5): un slice cuyo `n` no es un número utilizable no
// debe imprimirse como si lo fuera. La versión anterior interpolaba `s.n`
// tal cual — verificado por construcción: un slice sin `n` producía
// "#undefined" en esta línea, en el título del workspace de cmux
// ("repo · #undefined nombre"), en la rama, en el worktree y en el comando
// de claim, y el dry-run salía 0 como si el plan fuera bueno. El
// identificador ilegible ya no se propaga a ningún sitio (ver
// sliceNumberError, más abajo, que ahora lo para en seco); esta función solo
// se ocupa de que, mientras tanto, el texto tampoco mienta.
const sliceRef = (s) => (typeof s.n === 'number' && Number.isSafeInteger(s.n) && s.n >= 1 ? `#${s.n}` : `(slice SIN número de issue utilizable: ${JSON.stringify(s.n) ?? 'undefined'})`)
console.log(`seleccionados para esta tanda (cap ${cap}, ${inFlight.length} en vuelo): ${selected.map((s) => `${sliceRef(s)} (${s.name})`).join(', ')}`)

// repoName conserva el casing original del argumento (parseRepoSlug
// normaliza a minúsculas para COMPARAR, no para mostrar): esto solo alimenta
// el título del workspace de cmux, donde lo que quiere ver el humano es el
// nombre tal y como lo escribió.
const repoName = repo.split('/')[1]

// ============================================================================
// D4, defecto 3 — PRECONDICIONES DEL RUN REAL.
//
// Antes, `--dry-run` imprimía el plan y salía: no comprobaba NADA de lo que
// haría fallar al run real, así que un dry-run limpio no significaba que el
// run real fuera a funcionar — que es exactamente para lo que la gente usa
// un dry-run. Y el run real tampoco las comprobaba: descubría, por ejemplo,
// que `feat/42` ya existía DESPUÉS de haber escrito el claim, y se pasaba el
// resto del camino revirtiéndolo.
//
// Por eso este bloque corre en LOS DOS caminos, con el mismo código y las
// mismas reglas, antes de tocar nada (ni un claim, ni un worktree): que el
// dry-run y el run real puedan divergir en lo que validan es el bug, no un
// detalle de implementación. La única diferencia entre ambos está en qué se
// puede comprobar de verdad en modo fixture (ver más abajo), y eso se dice
// en claro en vez de darse por bueno.
//
// FALLO DURO (exit 1, nada se intenta) vs AVISO (sigue, pero el recap final
// deja claro que se salió 0 A PESAR de los avisos):
//   - duro  → lo que ROMPERÍA el run real con certeza y exige que un humano
//             arregle algo antes: número de slice no utilizable, worktree o
//             rama ya ocupados, `cmux` ausente del PATH (lo ejecuta ESTE
//             proceso, así que su ausencia es un fallo seguro), el
//             CLAUDE_CONFIG_DIR resuelto no existe en disco, o el kickoff no
//             se renderiza.
//   - aviso → lo que NO podemos afirmar con certeza desde aquí. `claude` es
//             el caso claro: no lo ejecuta este proceso sino el shell de
//             LOGIN que abre cmux, con su propio PATH (verificado en esta
//             máquina: `claude` es además una función de zsh definida en el
//             .zshrc, invisible para cualquier búsqueda en PATH). Su
//             ausencia aquí es una señal útil, pero no una prueba — y
//             convertir una sospecha en un fallo duro sería la misma clase
//             de afirmación no verificada que esta tanda de trabajo persigue.
const preflightFailures = []
// D5, hallazgo H — además de la lista plana (que alimenta el resumen final,
// idéntico en los dos caminos), se guarda A QUÉ SLICE pertenece cada fallo,
// indexado por su posición en la tanda. Sirve para dos cosas que antes no se
// podían decir: anotar cada bloque de plan del --dry-run con SU problema, y
// nombrar cuál es el PRIMERO que rompería en una corrida real.
const failuresBySliceIdx = new Map()
function failSlice(idx, msg) {
  preflightFailures.push(msg)
  if (!failuresBySliceIdx.has(idx)) failuresBySliceIdx.set(idx, [])
  failuresBySliceIdx.get(idx).push(msg)
}

function sliceNumberError(s) {
  if (typeof s.n === 'number' && Number.isSafeInteger(s.n) && s.n >= 1) return null
  // D4, defecto 5: sin esta guarda, un slice sin número utilizable no se
  // quedaba en un título feo — se propagaba a TODO: rama `feat/undefined`,
  // worktree `.worktrees/undefined`, `dispatch-check.mjs undefined` (que
  // ahora, con el parseo estricto, moriría con exit 2 a mitad de tanda) y el
  // título de cmux `repo · #undefined nombre`. Verificado por construcción
  // contra el código sin arreglar: un fixture sin `n` imprimía exactamente
  // esas cinco cosas y el dry-run salía 0, como si el plan fuera bueno.
  return `${sliceRef(s)}: ${JSON.stringify(s.n) ?? 'undefined'} no es un número de issue utilizable (se esperaba un entero >= 1). Todo lo que el dispatcher construye para un slice sale de ese número — la rama feat/<n>, el worktree .worktrees/<n>, el claim contra GitHub y el título de la sesión de cmux — así que no hay forma de despacharlo sin inventarse un identificador. Revisa de dónde salió este slice (${JSON.stringify(s.name ?? null)}): en la ruta real, "n" es siempre el número de issue de GitHub.`
}

// branchExistsLocally: 'yes' | 'no' | 'unknown'.
//
// Tres estados, no dos, porque `git rev-parse --verify --quiet <ref>` sale
// con 1 cuando la ref NO existe (el caso normal) pero también puede salir con
// 128 (repo corrupto, .git ilegible) o morir por el SIGKILL de nuestro propio
// timeout. Meterlo todo en un `catch { return false }` convertiría "no pude
// preguntar" en "está libre" — y "está libre" es justo lo que autoriza a
// seguir adelante y reclamar. 'unknown' se trata como aviso (no como fallo
// duro): no sabemos que esté ocupado, pero tampoco podemos afirmar lo
// contrario, y el mensaje del dry-run deja de decir "comprobado".
// En modo fixture es 'unknown' por construcción: ese modo promete no tocar
// ningún subproceso real.
function branchExistsLocally(branch) {
  if (fx) return 'unknown'
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
      cwd: repoRoot, stdio: 'ignore', timeout: childTimeoutFor(), killSignal: 'SIGKILL',
    })
    return 'yes'
  } catch (e) {
    // `--quiet` hace que git salga con 1 (y sin mensaje) exactamente para
    // "la ref no existe". Cualquier otro status, o una muerte por señal, es
    // un fallo de la CONSULTA, no una respuesta.
    if (e.status === 1) return 'no'
    return 'unknown'
  }
}

// registeredWorktreePaths: rutas que `git worktree list` ya conoce. Hace
// falta además de `existsSync(wt)` porque git falla con "missing but already
// registered worktree" cuando el directorio se borró A MANO sin
// `git worktree remove` — el registro sigue en .git/worktrees. Ese caso pasa
// un existsSync sin problema y luego revienta el `git worktree add`… en el
// run real, con el claim ya escrito, que es justo lo que este bloque existe
// para evitar. Devuelve un Set, o null si no se pudo consultar.
function registeredWorktreePaths() {
  if (fx) return null
  try {
    const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot, encoding: 'utf8', timeout: childTimeoutFor(), killSignal: 'SIGKILL',
    })
    const paths = new Set()
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) paths.add(line.slice('worktree '.length).trim())
    }
    return paths
  } catch {
    return null
  }
}

// Binarios. `cmux` se busca leyendo el PATH, NUNCA ejecutándolo: lanzar un
// workspace de verdad para comprobar que existe sería justo lo que un
// --dry-run promete no hacer.
const cmuxPath = findInPath('cmux')
if (cmuxPath) {
  console.log(`cmux: ${cmuxPath} (encontrado en PATH; no se ejecuta para comprobarlo).`)
} else {
  preflightFailures.push('`cmux` no está en el PATH de este proceso — ct-next.mjs lo invoca directamente (`cmux new-workspace ...`), así que sin él NINGÚN slice puede lanzarse. Instálalo o añádelo al PATH y reintenta.')
}
const claudePath = findInPath('claude')
if (claudePath) {
  console.log(`claude: ${claudePath} (encontrado en el PATH de este proceso).`)
} else {
  warn('`claude` no aparece en el PATH de ESTE proceso. No es concluyente — quien lo ejecuta de verdad es el shell de login que abre cmux, con su propio PATH (y `claude` puede ser incluso una función de shell, invisible desde aquí) — pero si tampoco está allí, cada sesión lanzada morirá nada más arrancar, con el claim ya puesto y sin agente. Compruébalo a mano antes de fiarte de un "lanzado".')
}

// CLAUDE_CONFIG_DIR resuelto: tiene que existir EN DISCO. Si no existe, la
// sesión arranca con una configuración de Claude vacía (sin autenticar,
// onboarding desde cero) en vez de con la cuenta que el mapa eligió — y eso
// se descubriría con el claim ya escrito y el worktree ya creado.
// `isDirectory()`, no solo `existsSync`: una RUTA que existe pero es un
// fichero (o un enlace a uno) pasaría un existsSync y fallaría igual de tarde
// que si no existiera — y con un error mucho menos legible.
const configDirIsDir = (() => {
  try { return statSync(configDir).isDirectory() } catch { return false }
})()
if (configDirIsDir) {
  console.log(`CLAUDE_CONFIG_DIR: ${configDir} (existe en disco).`)
} else {
  preflightFailures.push(`el CLAUDE_CONFIG_DIR resuelto para la cuenta ${accountLabel} NO existe en disco como directorio: ${configDir}. Cada agente se lanzaría con una configuración de Claude vacía (sin autenticar) en vez de con esa cuenta. Crea el directorio, corrige ACCOUNT_MAP (scripts/kickoff.js), o apunta CT_ACCOUNT_${account.account === 'work' ? 'WORK' : 'PERSONAL'}_DIR al directorio correcto.`)
}

// Plan por slice + comprobación de que su destino está libre. Se construye
// TODO aquí (rama, worktree, kickoff, seed, argv de cmux) para que un fallo
// de renderizado del kickoff se vea como una precondición fallida — con su
// mensaje — en vez de como una excepción sin capturar a mitad de tanda.
// Una sola consulta al registro de worktrees para toda la tanda (no una por
// slice): la lista es la misma para todos.
const registeredWorktrees = registeredWorktreePaths()
// D5, hallazgo H: cuántos de los fallos acumulados hasta aquí son de TANDA
// (no de un slice concreto) — `cmux` ausente del PATH y el CLAUDE_CONFIG_DIR
// inexistente. Se distinguen en el resumen final porque su remedio y su
// alcance son distintos: no hay "arregla este slice", afectan a todos.
const batchLevelFailureCount = preflightFailures.length
const plans = []
for (let idx = 0; idx < selected.length; idx++) {
  const s = selected[idx]
  const numErr = sliceNumberError(s)
  if (numErr) { failSlice(idx, numErr); continue }
  const branch = `feat/${s.n}`
  const wt = `${repoRoot}/.worktrees/${s.n}`
  const name = `${repoName} · #${s.n} ${s.name}`
  // Normaliza ac/issue por si el slice viene de un fixture de test (como el
  // del brief) que no los trae: renderKickoff/buildStateSeed indexan
  // slice.ac como array y usan slice.issue con `??`/`||` — sin este default
  // revientan con un TypeError en vez de imprimir el plan.
  const sliceForKickoff = { ...s, ac: s.ac || [], issue: s.issue ?? null }
  let kickoff
  let stateSeed
  try {
    kickoff = renderKickoff(sliceForKickoff, { repo, dispatchCheckPath })
    stateSeed = buildStateSeed(sliceForKickoff, { branch, base: resolvedBase })
  } catch (e) {
    failSlice(idx, `no se pudo renderizar el kickoff/STATE.md de #${s.n}: ${e.message}. El agente se lanzaría sin prompt utilizable — antes, esto solo se descubría en el run real.`)
    continue
  }
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

  // Destino libre. Este es el caso que el encargo nombra explícitamente: si
  // `feat/<n>` ya existe, el run real moría A MITAD, con el claim YA puesto.
  //
  // En modo fixture NO se mira el disco en absoluto (ni siquiera el
  // `existsSync`, que sería la única parte "gratis"): el `repoRoot` de ese
  // modo es sintético (`/tmp/fake-repo`), así que la respuesta no diría nada
  // sobre ningún checkout real — y comprobar la mitad mientras el mensaje
  // dice "NO COMPROBADOS" sería, otra vez, informar de una cosa y hacer otra.
  const destinationChecked = !fx
  const branchExists = branchExistsLocally(branch)
  if (destinationChecked) {
    if (existsSync(wt)) {
      failSlice(idx, `el worktree de #${s.n} ya existe: ${wt}. \`git worktree add\` fallaría — y en el run real eso pasa DESPUÉS de haber reclamado el issue. Limpia con \`git worktree remove --force ${wt}\` (y \`git branch -D ${branch}\` si la rama también sobra) si es basura de una corrida anterior, o revisa si hay trabajo real ahí antes de borrar nada.`)
    } else if (registeredWorktrees && registeredWorktrees.has(wt)) {
      // El directorio NO está, pero git sigue teniéndolo registrado (alguien
      // lo borró a mano sin `git worktree remove`): `git worktree add` falla
      // con "missing but already registered worktree".
      failSlice(idx, `el worktree de #${s.n} (${wt}) no existe en disco pero git SIGUE teniéndolo registrado — \`git worktree add\` fallaría con "missing but already registered worktree" (alguien borró el directorio a mano, sin \`git worktree remove\`). Límpialo con \`git worktree prune\` y reintenta.`)
    }
  }
  if (branchExists === 'yes') {
    failSlice(idx, `la rama ${branch} ya existe en el checkout local. \`git worktree add -b ${branch}\` fallaría — y en el run real eso pasa DESPUÉS de haber reclamado el issue. Bórrala (\`git branch -D ${branch}\`) si es basura de una corrida anterior, o revisa qué hay en ella antes de tocarla.`)
  } else if (branchExists === 'unknown' && !fx) {
    // No sabemos si está libre: aviso, nunca un "libre" por defecto.
    warn(`no se pudo comprobar si la rama ${branch} ya existe (la consulta a git falló, no es que la rama no esté). Si existe, el run real fallará al crear el worktree DESPUÉS de haber reclamado #${s.n} — compruébalo a mano con \`git branch --list ${branch}\` antes de seguir.`)
  }
  // `selIdx` (no `idx` a secas) porque el bucle de despacho de más abajo
  // itera sobre `plans`, que puede ser MÁS CORTO que `selected` (un slice sin
  // número utilizable, o cuyo kickoff no renderiza, no llega a tener plan).
  // Guardar la posición ORIGINAL en la tanda es lo que permite recuperar los
  // fallos de ese slice sin confundir los dos índices.
  // `destinationCheck` con TRES valores, no un booleano (D5, revisión propia
  // — mismo defecto que el resto de esta tanda, encontrado al repasar):
  // antes era `destinationChecked && branchExists !== 'unknown'`, y el
  // mensaje del dry-run para el `false` decía, literalmente, "NO COMPROBADOS
  // (modo fixture: repoRoot sintético, no se toca git). En una corrida real
  // sí se comprueban antes de reclamar". Cierto para el modo fixture, FALSO
  // para el otro caso que caía en el mismo `false`: una consulta a git que
  // se intentó DE VERDAD y falló ('unknown', p.ej. .git ilegible). Ahí el
  // dry-run era real, git sí se tocó, y la frase "en una corrida real sí se
  // comprueban" prometía justo lo que acababa de no poder hacerse.
  // Verificado por construcción con la consulta de rama rota: un --dry-run
  // sin fixture imprimía "modo fixture" y salía 0.
  const destinationCheck = fx ? 'fixture' : (branchExists === 'unknown' ? 'unknown' : 'checked')
  plans.push({ s, selIdx: idx, branch, wt, name, kickoff, stateSeed, cmuxArgv, destinationCheck })
}

// ============================================================================
// D5, hallazgo H — UN --DRY-RUN EXISTE PARA ENSEÑAR TODA LA TANDA DE UNA VEZ.
//
// D4 dejó esto abierto a propósito y preguntó: con `--cap 3`, si un solo
// slice tiene el destino ocupado, ¿debe caerse la tanda entera? La respuesta
// es no. Comprobado antes de tocar nada: las precondiciones de TODOS los
// slices seleccionados ya se evaluaban (con `--cap 3` y las ramas de dos de
// ellos ocupadas, el resumen listaba los dos), así que ESA parte no había
// que arreglarla. Lo que sí faltaba, y es lo que hace que el usuario tenga
// que arreglar y volver a correr para ver el resto:
//
//   1. el --dry-run salía por aquí ANTES de imprimir el plan de NINGÚN
//      slice — ni siquiera el de los sanos. Un dry-run con un problema en el
//      segundo de tres no enseñaba ni el kickoff, ni el STATE.md sembrado,
//      ni la línea de `cmux` de ninguno: exactamente lo que se fue a mirar.
//   2. el resumen daba el CONTEO de fallos pero no decía cuál rompería
//      primero, ni cuáles de los slices estaban listos.
//
// A partir de aquí, el --dry-run SIGUE adelante e imprime la tanda entera,
// con el problema de cada slice anotado en su propio bloque, y cierra con el
// resumen completo y un exit 1 (nunca 0: un dry-run con precondiciones sin
// cumplir no es luz verde). La corrida REAL no cambia en absoluto: aborta
// aquí mismo, antes de escribir un solo claim. Esa asimetría no es una
// divergencia de lo que se VALIDA (que era el bug que D4 cerró): las dos
// comprueban exactamente lo mismo y las dos fallan. Lo único que cambia es
// cuánto se IMPRIME después de haber fallado.
function preflightSummary() {
  const failedIdxs = [...failuresBySliceIdx.keys()].sort((a, b) => a - b)
  const label = (i) => sliceRef(selected[i])
  const parts = [`\nprecondiciones NO cumplidas (${preflightFailures.length}) — no se reclama ni se lanza NADA${dryRun ? '' : ' (ni un solo claim escrito: se comprueba antes de tocar GitHub)'}:\n  - ${preflightFailures.join('\n  - ')}`]
  if (batchLevelFailureCount > 0) {
    parts.push(`De esos, ${batchLevelFailureCount} afecta(n) a TODA la tanda (no a un slice concreto): con eso sin arreglar no se lanzaría ninguno de los ${selected.length} seleccionados.`)
  }
  if (failedIdxs.length) {
    const okIdxs = selected.map((_, i) => i).filter((i) => !failuresBySliceIdx.has(i))
    const okPart = okIdxs.length
      ? `; ${okIdxs.length} sin problemas propios (${okIdxs.map(label).join(', ')})`
      : '; ninguno queda sin problemas propios'
    parts.push(`De los ${selected.length} slice(s) seleccionados, ${failedIdxs.length} tienen precondiciones sin cumplir (${failedIdxs.map(label).join(', ')})${okPart}. En una corrida real, el primero que rompería es ${label(failedIdxs[0])} — pero se listan TODOS a propósito, para que puedas arreglarlos de una vez en vez de descubrirlos de uno en uno.`)
  }
  return parts.join('\n')
}

if (preflightFailures.length && !dryRun) {
  console.error(preflightSummary())
  process.exit(1)
}
if (preflightFailures.length) {
  console.error(`\nATENCIÓN: ${preflightFailures.length} precondición(es) sin cumplir en esta tanda. Este --dry-run NO es luz verde y terminará con exit 1 — pero el plan de abajo se imprime IGUAL, entero, para que veas de una sola pasada todos los problemas y todos los slices. El detalle va al final.`)
}
// ============================================================================

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
// SÍNCRONA de verdad: cuando RETORNA SIN LANZAR, el dato ya está en el
// descriptor y ningún `process.exit()` posterior puede truncarlo.
//
// D5, hallazgo F — LO QUE ESE PÁRRAFO AFIRMABA DE MÁS. Decía que el dato
// "queda escrito en el descriptor antes de que la llamada retorne" a secas,
// como si `writeSync` no pudiera fallar. Sí puede, y de dos formas
// distintas, ambas medidas:
//   - Con el destino a una tubería LLENA cuyo lector no consume: si el
//     descriptor es bloqueante, `writeSync` NO retorna — se queda esperando
//     sitio (verificado: un hijo con stdout a una tubería sin lector se
//     quedó dentro del primer `writeSync` de 64 KiB indefinidamente). Si el
//     descriptor es no bloqueante, lanza EAGAIN al instante y NO escribe
//     nada (medido por la re-revisión externa: con >= 64 KiB atascados no
//     llega ni un byte; con 0-32 KiB sí).
//   - Con el lector CERRADO (`ct-next | head`, un caller que dejó de leer),
//     lanza EPIPE y tampoco escribe nada.
// O sea: la garantía real es "si retorna, está escrito", no "siempre
// escribe". Ese límite es aceptable —no hay forma de entregar un mensaje a
// un destino que no lo acepta— pero tiene que estar escrito, y tiene que
// estar CONTENIDO, que es lo que hace `relay()` aquí abajo.
//
// D5 (hallazgo colateral, el más grave de los que encontré fuera del
// encargo): los `writeSync` de reenvío estaban DESNUDOS, y el de la rama de
// éxito estaba DENTRO del mismo `try` que el `execFileSync`. Consecuencia
// verificada por construcción, lanzando ct-next.mjs con el extremo de
// lectura de stdout cerrado: dispatch-check reclamaba #90 CON ÉXITO (el
// `issue edit ... --add-label status:in-progress` aparece en el log de gh, y
// su readback también), el `writeSync(1, out)` posterior lanzaba EPIPE, el
// `catch` lo recogía como si fuera el fallo del SUBPROCESO — `e.status`
// undefined — y ct-next imprimía "dispatch-check devolvió un fallo
// inesperado […] probablemente es un bug o una mala configuración", abortaba
// la tanda entera con exit 1 y NO revertía nada: el issue quedaba huérfano
// en status:in-progress por no haber podido imprimir una línea. Un claim
// exitoso reportado como fallo, con el mismo texto que culpa al usuario de
// una mala configuración: la familia entera de esta tanda de trabajo en un
// solo defecto.
//
// `relay()` aísla cada escritura de reenvío: un destino que no acepta el
// texto NUNCA puede cambiar lo que ct-next decide ni lo que informa sobre el
// claim. No hay adónde reportar el fallo del reenvío (si stderr es el roto,
// tampoco se podría), así que se traga en silencio a propósito — lo que NO
// se traga es el resultado del claim.
function relay(fd, text) {
  if (!text) return
  try {
    writeSync(fd, text)
  } catch {
    // Tubería llena/cerrada, descriptor no válido: el reenvío se pierde. Es
    // un límite conocido y documentado arriba, nunca una razón para
    // clasificar mal el claim ni para tumbar el proceso.
  }
}

function attemptClaim(s) {
  try {
    // timeout+killSignal (finding 1, defensa 2): si dispatch-check.mjs se
    // cuelga (su propio `gh` colgado a medias), esto acota la espera en vez
    // de bloquear ct-next.mjs para siempre. Si el kill llega a mitad de su
    // propio claim-then-verify, no podemos saber si el label ya se escribió
    // antes del SIGKILL — se aborta la tanda entera en vez de asumir nada,
    // el mismo criterio conservador que ya rige cualquier otro resultado
    // inesperado de dispatch-check. El respaldo genérico para un claim que
    // de verdad quedara huérfano por esta vía es la detección de staleness
    // (finding 2), no esto.
    //
    // D5, hallazgo D — CORRECCIÓN DE ESTE COMENTARIO: decía que este caso
    // caía "a propósito" en la rama de FALLO INESPERADO de más abajo. Dejó
    // de ser cierto cuando la ronda anterior añadió la rama de `signal`:
    // matar al hijo con SIGKILL deja `status` a null y `signal` a
    // 'SIGKILL', así que desde entonces cae en la rama de SEÑAL, no en la
    // de fallo inesperado. El comentario describía el código de antes del
    // cambio que él mismo acompañaba. Ahora la rama de señal distingue
    // explícitamente nuestro propio timeout (`timedOut`, abajo) de una
    // señal ajena.
    const out = execFileSync(process.execPath, [dispatchCheckPath, String(s.n), '--repo', repo], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: GH_MAX_BUFFER,
      timeout: childTimeoutFor('dispatch-check'),
      killSignal: 'SIGKILL',
    })
    relay(1, out)
    return { ok: true }
  } catch (e) {
    const stdout = typeof e.stdout === 'string' ? e.stdout : ''
    const stderr = typeof e.stderr === 'string' ? e.stderr : ''
    relay(1, stdout)
    relay(2, stderr)
    // `signal` (revisión externa, finding minor): cuando el subproceso
    // termina por una señal (un Ctrl-C de terminal normal que SÍ llega
    // también al hijo, o el SIGKILL de nuestro propio timeout de arriba),
    // Node deja `status` a `null` y rellena `signal` con el nombre — antes
    // esto caía sin distinción en el mismo "fallo inesperado, probablemente
    // mala configuración" que un --repo mal formado, culpando al usuario de
    // un problema de configuración que nunca existió. `text` (el
    // stdout+stderr concatenado) se retiró: classifyClaimOutcome ya no lo
    // consume desde que el contrato de dispatch-check.mjs se ensanchó a
    // exit codes (finding 4) — el texto de dispatch-check ya se reenvió
    // arriba para que el humano lo vea, no hace falta duplicarlo aquí.
    // `timedOut` (D5, hallazgo D): MISMA detección que ya usaba el catch de
    // `git worktree add` — Node mata al hijo con `killSignal` y rellena el
    // mensaje con ETIMEDOUT cuando el que expiró fue NUESTRO `timeout`.
    // Sirve para no presentar nuestro propio límite como una interrupción
    // del usuario.
    const timedOut = e.signal === 'SIGKILL' && /ETIMEDOUT/.test(e.message || '')
    return { ok: false, status: e.status, signal: e.signal, timedOut }
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
    execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repoRoot, stdio: 'inherit', timeout: childTimeoutFor(), killSignal: 'SIGKILL' })
  } catch (e) {
    attempts[0].err = e
  }

  try {
    execFileSync('git', ['branch', '-D', branch], { cwd: repoRoot, stdio: 'inherit', timeout: childTimeoutFor(), killSignal: 'SIGKILL' })
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
//
// D5, hallazgo E — SE RETIRÓ `activeWorktree` Y SU MENSAJE EN EL MANEJADOR.
// Había una variable `activeWorktree` que se ponía a `{wt, branch}` justo
// antes del `execFileSync` de `git worktree add` y se devolvía a `null`
// inmediatamente después (tanto en el `try` como en el `catch`), y un
// `if (activeWorktree)` dentro de `handleInterrupt` que avisaba de que el
// worktree podía haber quedado a medio crear. Ese guard era INALCANZABLE
// por construcción: entre la asignación y el `execFileSync` no hay ningún
// `await`, así que el event loop no puede recuperar el control (y por tanto
// ningún manejador de señal puede correr); durante el `execFileSync` tampoco
// (hallazgo (a) de la cabecera); y en cuanto la llamada retorna, la
// variable vuelve a `null` de forma síncrona antes de cualquier otro yield.
// Un guard que finge cubrir un caso que no cubre es peor que no tenerlo: le
// dice al lector que ese escenario está atendido.
//
// No se pierde nada al quitarlo, y esto es lo importante: el escenario que
// ese mensaje describía —un `git worktree add` interrumpido a media
// creación— SÍ tiene voz, en la rama de timeout del `catch` de `git worktree
// add` (el único camino por el que ese escenario se alcanza de verdad: la
// llamada se mata con SIGKILL al agotarse CT_NEXT_CHILD_TIMEOUT_MS), cuyo
// mensaje ya dice literalmente "puede haber quedado un directorio y/o una
// rama a MEDIO crear" con los comandos de limpieza.
let activeClaim = null
// `batchFinished` (D5, hallazgo C): true en cuanto el bucle de despacho
// terminó del todo. Solo lo usa `handleInterrupt` para decir la verdad
// sobre QUÉ llega tarde — una señal recibida con la tanda ya procesada no
// deshace nada, y decir "interrumpiendo de forma segura antes de salir"
// sugeriría lo contrario.
let batchFinished = false
// `interrupting`: cerrojo de reentrada Y bandera de "para en el próximo
// checkpoint" para el bucle principal (ver el uso de `interrupting` en los
// dos checkpoints del bucle, más abajo). Una segunda señal mientras ya
// estamos gestionando la primera no debe disparar un segundo revert
// solapado del MISMO claim — fuerza la salida ya, sin reintentar limpieza.
let interrupting = false
const SIGNAL_EXIT_CODE = { SIGINT: 130, SIGTERM: 143 }
// CRÍTICO — hallazgo de una revisión externa, reproducido 3/3 y 2/2 de
// forma determinista: la versión anterior de esta función era `async` y
// terminaba en `await sleep(0)` ANTES de `process.exit()`, con el
// razonamiento (correcto en aislamiento, pero incompleto) de darle al
// cerrojo `interrupting` una oportunidad de ser realmente reentrante. Ese
// `await` adicional REABRÍA exactamente el hueco que finding 1 vino a
// cerrar: el bucle principal, suspendido en su PROPIO `await
// sleep(testDelayAfterClaimMs)` (registrado ANTES de que la señal se
// procesara), tiene un temporizador que YA estaba en la cola de libuv. El
// `sleep(0)` de este manejador registra un temporizador NUEVO, por detrás
// del anterior — y Node procesa los temporizadores vencidos en el orden en
// que se registraron. Resultado, verificado por construcción (a
// configuración de PRODUCCIÓN, testDelayAfterClaimMs=0, no en el valor que
// usan los tests): el temporizador del bucle principal vence ANTES que el
// de este manejador, así que el bucle RETOMA — crea el worktree, lanza cmux
// e imprime "lanzado" — TODO ESO DESPUÉS de que este manejador ya hubiera
// impreso "revertido automáticamente a status:ready". El claim queda
// revertido en GitHub mientras un agente real sigue corriendo sobre él: el
// finding 1 exacto, causado por el propio arreglo de finding 1.
//
// Corolario sobre mi propio hallazgo empírico original (también señalado
// por la revisión, y confirmado cierto): "ni siquiera después de que la
// llamada se desbloquee" es válido para UNA llamada síncrona bloqueada,
// pero NO significa que un `await` cualquiera sea un punto de cesión
// "seguro y sin efectos secundarios" — cada `await` reintroduce una carrera
// real contra CUALQUIER otro temporizador/callback ya pendiente. Un
// `sleep(0)` no es una entrega garantizada de nada; es una vuelta más al
// event loop, con el mismo riesgo de que otro código avance mientras tanto.
//
// Arreglo: esta función ahora es 100% SÍNCRONA — ni un solo `await` — desde
// que se invoca hasta `process.exit()`. Con eso, en cuanto el event loop la
// invoca, se ejecuta de un tirón (revert incluido: `attemptRevertClaim` ya
// era síncrona) hasta terminar el proceso, sin ceder el control ni una sola
// vez — nada más puede ejecutarse mientras tanto (JS es de un solo hilo, y
// sin ningún `await` no hay ningún punto en el que el bucle principal
// pudiera colarse). El cerrojo `interrupting` vuelve a ser, en la práctica,
// código muerto para el caso de reentrada real (una segunda señal no puede
// interrumpir una función 100% síncrona) — pero un guard muerto es
// inofensivo; el `await` que lo hacía "vivo" no lo era. Como defensa en
// profundidad adicional (no como solución al hueco de arriba, que ya está
// cerrado por construcción): el bucle principal TAMBIÉN comprueba
// `interrupting` inmediatamente al retomar de cada uno de sus dos
// checkpoints, antes de cualquier mutación — ver esos dos sitios.
function handleInterrupt(sig) {
  if (interrupting) {
    console.error(`\n${sig} recibido de nuevo mientras ya se estaba limpiando de una interrupción anterior — no reintento el revert (podría solaparse con el que ya está en curso); salgo ya.`)
    process.exit(SIGNAL_EXIT_CODE[sig] || 130)
  }
  interrupting = true
  // D5, hallazgo C: una señal que llega con la tanda YA procesada (el caso
  // que antes se descartaba en silencio) no interrumpe nada — decir
  // "interrumpiendo de forma segura antes de salir" ahí sería sugerir que
  // algo se está deteniendo o deshaciendo, y no es cierto.
  if (batchFinished) {
    console.error(`\n${sig} recibido, pero la tanda YA había terminado de procesarse cuando llegó: no se interrumpe ni se deshace nada de lo ya hecho (el resumen de arriba es el resultado real de esta corrida). Se sale con el código de la señal para que quien invocó a ct-next sepa que se pulsó.`)
  } else {
    console.error(`\n${sig} recibido — interrumpiendo de forma segura antes de salir.`)
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
  process.exit(SIGNAL_EXIT_CODE[sig] || 130)
}
process.on('SIGINT', () => handleInterrupt('SIGINT'))
process.on('SIGTERM', () => handleInterrupt('SIGTERM'))

// ============================================================================
// D5, hallazgo G (la mitad de raíz) — HABÍA RED PARA SEÑALES, PERO NO PARA
// EXCEPCIONES.
//
// `handleInterrupt` revierte el claim de la ventana peligrosa cuando llega
// una SEÑAL. Un `throw` cualquiera en esa misma ventana —claim escrito,
// worktree todavía no— no tenía absolutamente nada: el proceso moría con su
// traza y el issue se quedaba en status:in-progress para siempre. El hook de
// test sin validar (arriba) era solo UN ejemplo de ese agujero, y arreglar
// solo el hook habría dejado el agujero intacto: un `mkdirSync` que lanza un
// error no previsto, un `JSON.parse` de una respuesta rara, un
// `renderKickoff` que revienta con un slice mal formado, un OOM de V8 en
// medio del bucle… todos caen igual.
//
// `bailOutOnCrash` es el equivalente exacto de `handleInterrupt` para ese
// caso, con las MISMAS reglas de diseño y por los mismos motivos:
//   - 100% SÍNCRONA, de la primera línea a `process.exit()`. Ni un `await`.
//     Ver la cabecera de `handleInterrupt` para la regresión concreta (y
//     reproducida) que provocó un solo `await sleep(0)` de más ahí dentro.
//   - Cerrojo de reentrada propio (`crashing`) para no encadenar un segundo
//     revert solapado si el propio manejo del fallo vuelve a fallar.
//   - Imprime la traza COMPLETA, siempre. Instalar un manejador de
//     `uncaughtException` sustituye el comportamiento por defecto de Node
//     (que la imprime él), así que callarla convertiría esta red en una
//     forma de esconder bugs — justo lo contrario de lo que se busca.
//
// Se registran los DOS manejadores globales, no uno: todo el código de este
// fichero es síncrono salvo los `await` de los checkpoints, y verificado por
// construcción (un módulo ES con la misma forma: `await` en el top-level y
// después un `process.kill` con una señal inválida) el fallo llega como
// `uncaughtException` — pero apostar por uno solo sería exactamente la clase
// de suposición sin comprobar que este trabajo persigue, y cubrir ambos no
// cuesta nada. Se prefirió esto a un `try/catch` alrededor del cuerpo del
// bucle: cubre estrictamente MÁS (cualquier `throw` en cualquier punto del
// script, no solo dentro del bucle) y no depende de acertar dónde poner el
// try.
let crashing = false
function bailOutOnCrash(err, kind) {
  if (crashing) process.exit(1)
  crashing = true
  const detail = (err && err.stack) || String(err)
  console.error(`\n${kind} en ct-next.mjs — esto es un bug, no un resultado esperado del protocolo:\n${detail}`)
  if (activeClaim) {
    const claimant = { n: activeClaim.n }
    activeClaim = null
    console.error(`#${claimant.n} tenía un claim (status:in-progress) sin worktree completado cuando ocurrió el fallo — revirtiendo a status:ready antes de salir, para no dejarlo huérfano.`)
    const revertErr = attemptRevertClaim(claimant)
    if (!revertErr) {
      console.error(`claim de #${claimant.n} revertido automáticamente a status:ready.`)
    } else {
      console.error(`ATENCIÓN: no se pudo revertir automáticamente el claim de #${claimant.n} (${revertErr.message}). Puede haber quedado bloqueado en status:in-progress sin nadie trabajándolo — libéralo a mano con: ${manualRevertClaimHint(claimant)}`)
    }
  } else {
    console.error('no había ningún claim propio pendiente de revertir en ese instante.')
  }
  console.error('Los slices de esta tanda ya lanzados con éxito antes de este fallo (si los hubo) siguen corriendo en su propio cmux — no se han tocado.')
  process.exit(1)
}
process.on('uncaughtException', (err) => bailOutOnCrash(err, 'excepción no capturada'))
process.on('unhandledRejection', (err) => bailOutOnCrash(err, 'promesa rechazada sin manejar'))

// D2, finding 1: conteo de cuántos slices de `selected` se lanzaron de
// verdad — se usa tanto para la línea de conteo final como para decidir el
// exit code cuando la tanda entera termina sin lanzar nada.
let launchedCount = 0
// D5, hallazgo A — slices que llegaron hasta el final del bucle DEJANDO
// ESTADO detrás sin poder confirmar que hay un agente trabajándolos:
// 'wrong-cwd' y 'not-found'. Es la ÚNICA forma de terminar el bucle con
// residuo (todos los demás caminos, o no mutan nada, o abortan con
// process.exit tras intentar su limpieza — ver el comentario del verdicto
// final, más abajo, para la enumeración completa).
const unverifiedLaunches = []

for (let idx = 0; idx < plans.length; idx++) {
  const { s, selIdx, branch, wt, name, kickoff, stateSeed, cmuxArgv, destinationCheck } = plans[idx]

  if (dryRun) {
    console.log(`\n=== slice #${s.n} (${s.name}) ===`)
    // D5, hallazgo H: el problema de ESTE slice, en SU bloque — para no
    // obligar a cruzar el resumen del final con el plan de arriba.
    const own = failuresBySliceIdx.get(selIdx)
    if (own) {
      console.log(`PRECONDICIÓN NO CUMPLIDA (${own.length}) para este slice — con esto sin arreglar, este slice NO se despacharía:\n  - ${own.join('\n  - ')}`)
    }
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
    // D4, defecto 3: qué se pudo comprobar DE VERDAD del destino. En modo
    // fixture (`CT_NEXT_FIXTURE`) el repoRoot es sintético y la comprobación
    // de rama exigiría un `git` real, que ese modo promete no tocar — así
    // que se dice, en vez de dejar que la ausencia de queja se lea como
    // "comprobado y libre".
    // D5, hallazgo H: "destino libre" solo se dice cuando de verdad lo está.
    // Con el bloque de precondiciones ya impreso arriba para este slice,
    // repetir "destino libre" sería una contradicción dentro del mismo
    // bloque — el defecto exacto que esta tanda de trabajo persigue.
    if (own) {
      console.log(`destino: ${wt} / rama ${branch} — NO LIBRE (ver la precondición de arriba).`)
    } else if (destinationCheck === 'checked') {
      console.log(`destino libre: ${wt} no existe y la rama ${branch} tampoco (comprobado en este checkout).`)
    } else if (destinationCheck === 'fixture') {
      console.log(`destino: ${wt} / rama ${branch} — NO COMPROBADOS (modo fixture: repoRoot sintético, no se toca git). En una corrida real sí se comprueban antes de reclamar.`)
    } else {
      // 'unknown': se intentó de verdad y la consulta falló. Ni "libre" ni
      // "no se miró" — se miró y no se pudo saber. El aviso con el detalle y
      // el comando manual ya se imprimió al hacer la comprobación.
      // F16/H2: ese aviso sale por STDERR (criterio de canal), así que la
      // referencia dice DÓNDE está y no solo "más arriba" — quien haya
      // redirigido stdout a un fichero no lo tiene "arriba" en ningún sitio.
      console.log(`destino: ${wt} / rama ${branch} — SIN CONFIRMAR: la consulta a git se intentó y FALLÓ (el detalle y el comando manual están en el aviso correspondiente, por stderr), así que no se puede afirmar que estén libres. Esto NO es modo fixture: la corrida real hará exactamente esta misma comprobación, y si vuelve a fallar tampoco lo sabrá.`)
    }
    console.log(`CLAUDE_CONFIG_DIR=${configDir}`)
    console.log(`git worktree add -b ${branch} ${wt} ${resolvedBase}`)
    console.log(`seed ${wt}/.agent/STATE.md:\n${stateSeed}`)
    // D4, defecto 3: el kickoff, en PROSA. La línea `cmux ...` de abajo lo
    // lleva dentro, pero doblemente escapado (comillas POSIX + el
    // JSON.stringify de la propia línea): un blob de una sola línea con
    // `\n` literales que nadie puede leer — y juzgar si el prompt que va a
    // recibir el agente es el correcto es la única razón por la que un
    // humano mira un dry-run. Se imprime tal cual lo verá el agente, ANTES
    // del comando literal (que se conserva íntegro, sin recortar: sigue
    // siendo la fuente de verdad de qué se ejecutaría exactamente).
    console.log(`--- kickoff que recibiría el agente de #${s.n} (prosa, tal cual) ---\n${kickoff}\n--- fin del kickoff ---`)
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
  //
  // CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT — exclusivamente para
  // tests (hallazgo de una revisión externa): enviar una señal EXTERNA de
  // forma que llegue de forma fiable justo en este checkpoint concreto es
  // una carrera de temporización real (verificado por construcción: a
  // CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS=0 — el único valor en el que el fallo
  // original se manifestaba — entre un 10% y un 20% de los intentos de un
  // arnés de test externo nunca llegaban a procesarse en absoluto, porque
  // la tubería entera de subprocesos falsos podía terminar antes de que el
  // proceso externo reaccionara). Esta variable, en cambio, hace que el
  // propio proceso se envíe la señal a sí mismo (`process.kill(pid, sig)`)
  // de forma SÍNCRONA justo aquí — indistinguible para Node de una señal
  // externa (misma syscall subyacente), pero sin ninguna carrera de
  // temporización entre procesos: el punto exacto donde queda pendiente es
  // determinista. Solo se dispara desde la SEGUNDA iteración en adelante
  // (`idx > 0`), para simular "la señal llegó en algún momento de la vida
  // de un slice anterior" en vez de interrumpir antes de que exista ningún
  // slice que revertir.
  if (process.env.CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT && idx > 0) {
    process.kill(process.pid, process.env.CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT)
  }
  await sleep(testDelayAfterClaimMs)
  // D5: el `sleep` de arriba se resuelve en la fase de TIMERS, que corre
  // ANTES de la de POLL — donde libuv despacha las señales. Sin este
  // segundo yield (fase de CHECK, después de poll), una señal ya pendiente
  // podía no haberse despachado todavía al llegar aquí — medido, 2 de 8
  // rondas. Ver el comentario de cabecera de `yieldToSignals`.
  await yieldToSignals()
  // Defensa en profundidad (no la única defensa — ver el comentario de
  // cabecera de handleInterrupt para por qué ya es 100% síncrona): si el
  // manejador ya arrancó y puso `interrupting` a true en el instante en que
  // este `await` cede el control, process.exit() ya habrá terminado el
  // proceso antes de que este punto se alcance. Esta comprobación cubre el
  // caso — mucho más improbable, pero no descartable sin más — de que
  // alguna vía futura reintroduzca un yield dentro de handleInterrupt.
  // `break` (no `return`: este bucle vive en el top-level del módulo, no
  // dentro de una función) — pero en la práctica, si `interrupting` es
  // cierto aquí, `handleInterrupt` ya llamó a `process.exit()` de forma
  // síncrona, así que ni siquiera este `break` llega a ejecutarse de
  // verdad; es cinturón y tirantes, no la defensa principal.
  if (interrupting) break
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
      // `plans.length`, no `selected.length` (D5, revisión propia): este
      // bucle itera sobre `plans`, y `plans` puede ser MÁS CORTO que
      // `selected` (un slice sin número utilizable, o cuyo kickoff no
      // renderiza, no llega a tener plan). Hoy los dos coinciden siempre en
      // el camino real —cualquier fallo de precondición aborta antes del
      // bucle— así que no cambia ningún comportamiento; pero comparar `idx`
      // con la longitud del OTRO array es justo la clase de trampa que un
      // cambio futuro despierta, y el mensaje que decide ("no quedan más
      // candidatos" vs "sigo con el resto") tiene que reflejar la realidad
      // de este bucle.
      const isLast = idx === plans.length - 1
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
    // IMPORTANTE (revisión externa): un Ctrl-C de terminal normal (que SÍ
    // llega también al hijo, a diferencia del escenario adversarial de
    // finding 1) durante attemptClaim mata a dispatch-check.mjs por señal
    // — `status` queda `null` y `signal` lleva el nombre. Antes esto se
    // culpaba, sin distinción, de "probablemente un bug o una mala
    // configuración (p.ej. --repo mal formado)" — un mensaje activamente
    // engañoso justo cuando el usuario sabe perfectamente lo que pasó (él
    // mismo interrumpió), y que además omitía la información más
    // importante: dispatch-check.mjs pudo haber escrito el claim (status:
    // ready → status:in-progress) ANTES de morir por la señal, y no hay
    // forma de saberlo desde aquí.
    if (claim.signal) {
      // D5, hallazgo D: el SIGKILL que mandamos NOSOTROS al agotarse
      // CT_NEXT_CHILD_TIMEOUT_MS entra por esta misma rama y, antes de este
      // arreglo, se presentaba como una señal ajena ("terminó por la señal
      // SIGKILL", "antes de esta interrupción") sin nombrar el límite ni la
      // variable — culpando de una interrupción a un usuario que no
      // interrumpió nada. Es exactamente la distinción que la ronda
      // anterior ya había añadido para `git worktree add` (ver `timedOut`
      // más abajo, misma detección) y que aquí faltaba.
      if (claim.timedOut) {
        console.error(`dispatch-check para #${s.n} no terminó dentro del límite de ${childTimeoutFor('dispatch-check')}ms (CT_NEXT_CHILD_TIMEOUT_MS) y lo matamos NOSOTROS con SIGKILL — no fue una interrupción tuya. Al matarlo a mitad de su propio claim-then-verify, no se puede saber si el claim llegó a escribirse: si #${s.n} queda en status:in-progress sin nadie trabajándolo, revierte a mano con ${manualRevertClaimHint(s)}. Si esto pasa contra un repo legítimamente grande/lento (o un \`gh\` que responde despacio), sube CT_NEXT_CHILD_TIMEOUT_MS. Abortando toda la tanda: no sigo con el resto de candidatos a ciegas.`)
        console.error('Los slices de esta tanda ya lanzados con éxito antes de este fallo (si los hubo) siguen corriendo en su propio cmux — no se han tocado.')
        process.exit(1)
      }
      console.error(`dispatch-check para #${s.n} terminó por la señal ${claim.signal} mientras intentaba reclamar — no se puede saber si el claim llegó a escribirse antes de morir. Si #${s.n} queda en status:in-progress sin nadie trabajándolo, revisa y revierte a mano: ${manualRevertClaimHint(s)}. Abortando toda la tanda: no sigo con el resto de candidatos a ciegas.`)
      console.error('Los slices de esta tanda ya lanzados con éxito antes de esta interrupción (si los hubo) siguen corriendo en su propio cmux — no se han tocado.')
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
  // CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM — exclusivamente para tests: mismo
  // mecanismo y mismo motivo que CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT
  // más arriba (autoenvío determinista de la señal, sin la carrera de
  // temporización de un proceso externo) — aquí para la ventana peligrosa
  // exacta que describe finding 1: claim ya confirmado, worktree todavía no
  // creado.
  if (process.env.CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM) {
    process.kill(process.pid, process.env.CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM)
  }
  // CT_NEXT_TEST_THROW_AFTER_CLAIM — exclusivamente para tests (D5, hallazgo
  // G): lanza una excepción cualquiera EXACTAMENTE en la ventana peligrosa
  // (claim escrito, worktree todavía no) para poder ejercer la red de
  // `bailOutOnCrash`. Es el mismo mecanismo que el hook de autoseñal de
  // arriba y existe por el mismo motivo: reproducir un `throw` inesperado en
  // ese punto exacto desde fuera no es posible de forma determinista, y el
  // hallazgo que esta red cierra es precisamente que CUALQUIER throw ahí
  // dejaba el issue huérfano. A diferencia del hook de señal, este no
  // necesita validación de forma: cualquier cadena es un mensaje de error
  // válido, y su único efecto es entrar en la red que se está probando.
  if (process.env.CT_NEXT_TEST_THROW_AFTER_CLAIM) {
    throw new Error(process.env.CT_NEXT_TEST_THROW_AFTER_CLAIM)
  }
  await sleep(testDelayAfterClaimMs)
  // D5: igual que el checkpoint anterior — cruzar la fase de POLL es lo que
  // de verdad garantiza que una señal ya pendiente se haya despachado antes
  // de comprobar `interrupting`. Este es EL checkpoint de la ventana
  // peligrosa (claim escrito, worktree todavía no), así que es justo donde
  // ese ~25% de señales que se colaban hacía más daño.
  await yieldToSignals()
  // Defensa en profundidad — mismo razonamiento que el checkpoint anterior:
  // si `interrupting` es cierto aquí, `handleInterrupt` (100% síncrona) ya
  // revirtió este mismo claim y llamó a `process.exit()`, así que este
  // `break` en la práctica nunca se alcanza — pero si algo cambiara eso en
  // el futuro, esto evita crear el worktree sobre un claim ya revertido.
  if (interrupting) break

  try {
    // timeout+killSignal (finding 1, defensa 2): ver el bloque de
    // comentarios grande más arriba. Si `git worktree add` se cuelga de
    // verdad (repo remoto lento, o algo peor) y la señal solo llega a este
    // proceso, esta es la única forma de que el catch de abajo (que YA
    // revierte el claim) llegue alguna vez a ejecutarse.
    // (D5, hallazgo E: aquí había un `activeWorktree = {wt, branch}` /
    // `= null` cuyo único consumidor era un guard inalcanzable dentro de
    // `handleInterrupt` — ver el comentario de `activeClaim` para el porqué
    // de retirarlo.)
    execFileSync('git', ['worktree', 'add', '-b', branch, wt, resolvedBase], { cwd: repoRoot, stdio: 'inherit', timeout: childTimeoutFor('worktree-add'), killSignal: 'SIGKILL' })
  } catch (e) {
    // Si el worktree o la rama ya existen, `git worktree add` falla con
    // exit != 0 — lo dejamos fallar ruidoso en vez de reusar en silencio
    // algo que podría no corresponder a este slice. El claim YA se obtuvo
    // (paso de arriba): sin revertirlo aquí, este issue quedaría huérfano en
    // status:in-progress con nada corriendo — mismo motivo que
    // cleanupOrphanedWorktree más abajo, pero aquí no hay worktree/rama que
    // limpiar (git worktree add falló antes de crear nada).
    // MENOR (revisión externa): el mensaje antes no distinguía "git
    // worktree add falló rápido" (rama/ruta ya ocupada, etc.) de "acabamos
    // de matarlo nosotros mismos porque se agotó el timeout" — en este
    // segundo caso, el usuario necesita saber el límite exacto, la
    // variable con la que se ajusta, y que un `git worktree add` matado a
    // mitad de camino (SIGKILL, no un cierre limpio) puede haber dejado un
    // directorio/rama a medio crear en disco, algo que ni `git worktree
    // list` refleja siempre con fiabilidad.
    const timedOut = e.signal === 'SIGKILL' && /ETIMEDOUT/.test(e.message || '')
    if (timedOut) {
      console.error(`no se pudo crear el worktree para #${s.n} en ${wt}: se agotó el límite de ${childTimeoutFor('worktree-add')}ms (CT_NEXT_CHILD_TIMEOUT_MS) esperando a "git worktree add" y se mató el proceso (SIGKILL). Al matarse a mitad de camino (no un fallo limpio), puede haber quedado un directorio y/o una rama a MEDIO crear en ${wt} / ${branch} — revísalo a mano (\`git worktree list\`, \`git branch\`) antes de reintentar este slice; si sigue ahí, límpialo con \`git worktree remove --force ${wt}\` / \`git branch -D ${branch}\`. Si esto pasa contra un repo legítimamente grande/lento, sube CT_NEXT_CHILD_TIMEOUT_MS.`)
    } else {
      console.error(`no se pudo crear el worktree para #${s.n} en ${wt}: ${e.message}`)
    }
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
    execFileSync('cmux', cmuxArgv, { stdio: 'inherit', timeout: childTimeoutFor(), killSignal: 'SIGKILL' })
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
  // IMPORTANTE (revisión externa): antes, 'wrong-cwd' y 'not-found'
  // imprimían su propio ATENCIÓN pero de todas formas incrementaban
  // `launchedCount` — con lo que la tanda terminaba en "lanzados 1/1" y
  // exit 0, que un `/loop` lee como progreso normal. Y como el issue queda
  // en status:in-progress con un worktree presente, la propia detección de
  // staleness (finding 2) tampoco lo marcaría nunca — un slice sin agente
  // confirmado se volvía invisible para siempre. Solo cuentan como
  // "lanzado" los dos casos donde no hay evidencia POSITIVA de un problema:
  // 'confirmed' (verificado de verdad) y 'unverifiable' (no se pudo
  // consultar cmux — el mismo criterio de "beneficio de la duda" que ya
  // usa 'infra' en classifyClaimOutcome, porque una consulta fallida no
  // dice nada sobre si el lanzamiento fue bueno o malo). 'wrong-cwd' y
  // 'not-found' SÍ son evidencia positiva de que algo fue mal, así que NO
  // cuentan — si esta fuera la única selección de la tanda, el exit code
  // final cae solo, sin más cambios, en el 3 ya existente ("seleccionado
  // pero cero lanzados confirmados, reintenta más tarde"), en vez de un
  // exit 0 que afirma más de lo que se sabe.
  if (launchCheck.status === 'confirmed') {
    console.log(`lanzado #${s.n} en ${wt} (cuenta ${configDir}) — verificado: la sesión cmux está corriendo en ese directorio.`)
    launchedCount++
  } else if (launchCheck.status === 'wrong-cwd') {
    // D5, hallazgo A: además del ATENCIÓN, se APUNTA el slice en
    // `unverifiedLaunches` — porque este caso deja estado real detrás
    // (claim escrito, rama y worktree creados, y un `cmux new-workspace`
    // que devolvió 0, o sea posiblemente un agente corriendo) y el resumen
    // final tiene que poder decirlo en vez de afirmar "nada quedó a medias".
    console.error(`ATENCIÓN: cmux aceptó el lanzamiento de #${s.n} (exit 0), pero la sesión NO está en ${wt} — está en "${launchCheck.actualCwd}" en su lugar (cmux tolera un cwd inexistente y arranca en el shell de login por defecto en vez de fallar; ¿el worktree no llegó a existir a tiempo, o se borró justo antes?). El agente puede estar corriendo en el directorio equivocado — revisa la sesión a mano antes de asumir que está trabajando #${s.n}. NO se cuenta como lanzado con éxito.`)
    unverifiedLaunches.push({ n: s.n, wt, branch, name, why: `la sesión de cmux existe pero está en "${launchCheck.actualCwd}", no en ${wt}` })
  } else if (launchCheck.status === 'not-found') {
    console.error(`ATENCIÓN: cmux devolvió éxito (exit 0) al lanzar #${s.n}, pero no se encontró ninguna sesión con el nombre "${name}" al consultarlo — no se puede confirmar que el agente esté corriendo en absoluto, y mucho menos en ${wt}. Revisa cmux a mano. NO se cuenta como lanzado con éxito.`)
    unverifiedLaunches.push({ n: s.n, wt, branch, name, why: `cmux respondió y no hay ninguna sesión con el título "${name}"` })
  } else if (launchCheck.status === 'cwd-unknown') {
    // D5, hallazgo B: la sesión SÍ existe con el título exacto que pedimos
    // — eso es evidencia positiva de que el lanzamiento ocurrió. Lo único
    // que falta es el directorio, y falta porque cmux no nos dio un campo
    // legible, no porque esté en otro sitio. Cuenta como lanzado (mismo
    // criterio de "beneficio de la duda ante una consulta incompleta" que
    // 'unverifiable'), pero el mensaje no afirma "verificado".
    console.log(`lanzado #${s.n} en ${wt} (cuenta ${configDir}) — la sesión de cmux con el título esperado EXISTE, pero cmux no expuso un directorio legible para ella (¿esquema/versión distinta de la esperada?), así que NO se pudo comprobar que esté corriendo en ${wt}. No se afirma "verificado"; si te importa, compruébalo a mano.`)
    launchedCount++
  } else {
    console.log(`lanzado #${s.n} en ${wt} (cuenta ${configDir}) — cmux devolvió éxito (exit 0), pero no se pudo verificar la sesión (no se pudo consultar cmux): "lanzado" aquí refleja solo que el comando no falló, no que el agente esté corriendo en ${wt}.`)
    launchedCount++
  }
  // finding 1: el slice se lanzó completo — ya no hay claim "en la ventana
  // peligrosa" que un manejador de señal futuro (para el SIGUIENTE slice de
  // esta misma tanda) deba tocar. Esto es cierto SIN IMPORTAR el resultado
  // de verifyCmuxLaunch: el claim en sí ya está resuelto (in-progress,
  // deliberadamente — no se revierte solo por no poder verificar la
  // sesión, eso sería sobrerreaccionar a una incertidumbre distinta).
  activeClaim = null
}

// D2 review, menor 1: TODO este bloque de conteo/exit-code es exclusivo del
// path REAL — un --dry-run no reclama ni lanza NADA de verdad (es puramente
// informativo, `launchedCount` es siempre 0 ahí por construcción). Una línea
// "lanzados 0/N" al final de un --dry-run exitoso sería exactamente la misma
// clase de mensaje engañoso que esta tarea existe para eliminar, solo que al
// revés (afirmar "cero lanzamientos" de un plan que ni siquiera lo intentó).
//
// D5, hallazgo C: el verdicto se CALCULA aquí y se aplica al final del
// fichero, tras el último punto de cesión — ver el bloque grande de más
// abajo. Antes cada rama llamaba a `process.exit()` directamente, lo que
// hacía imposible darle a una señal ya pendiente su oportunidad de ser
// reconocida sin duplicar el yield en cada salida.
let finalExitCode = 0
// D5, hallazgo H: en --dry-run el resumen de precondiciones va AL FINAL,
// después de haber impreso la tanda entera — es lo último que se lee, y lo
// que fija el exit 1. En la corrida real este bloque no se alcanza: aborta
// mucho antes, al detectar las mismas precondiciones.
if (dryRun && preflightFailures.length) {
  console.error(preflightSummary())
  console.error('Este --dry-run NO es luz verde: la corrida real se pararía en las precondiciones de arriba, sin escribir ningún claim. Arréglalas TODAS y vuelve a pasar el dry-run.')
  finalExitCode = 1
}
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
  //       parar y avisar a un humano, no reintentar a ciegas. D4 AMPLÍA este
  //       código, deliberadamente y sin inventar uno nuevo, a las
  //       PRECONDICIONES no cumplidas (worktree/rama ya ocupados, `cmux`
  //       ausente del PATH, CLAUDE_CONFIG_DIR inexistente, kickoff que no
  //       renderiza, slice sin número utilizable) — en --dry-run y en la
  //       corrida real por igual: encajan exactamente en la semántica que ya
  //       tenía ("algo requiere que un humano lo arregle, reintentar a ciegas
  //       no ayuda"), y no son "reintenta más tarde" (3) porque no se
  //       resuelven solas con el tiempo. La diferencia con antes es CUÁNDO se
  //       detectan: ahora antes de escribir ningún claim, no a mitad de tanda.
  //   2 = error de uso o de CONFIGURACIÓN ESTÁTICA: flags mal puestos, y (D4)
  //       un ACCOUNT_MAP malformado en scripts/kickoff.js — ambos se conocen
  //       sin tocar red ni disco, antes de decidir nada.
  //   3 = la tanda se seleccionó (selected.length > 0) pero terminó
  //       de procesarse con CERO lanzamientos, y nada se rompió NI QUEDÓ A
  //       MEDIAS — cada candidato colisionó, perdió una carrera de forma
  //       limpia, o tropezó con un fallo de infraestructura puntual (D2
  //       review, menor 3), contra trabajo que otro proceso reclamó entre la
  //       foto de ct-next y el claim en vivo de dispatch-check (la
  //       advertencia honesta de "sin compare-and-swap" ya documentada), o
  //       simplemente contra un `gh` inestable. No es un bug ni requiere
  //       intervención manual, pero tampoco es "nada que hacer"
  //       (formatBlockReason ya cubre ESE caso con exit 0): hubo selección,
  //       hubo intento, no hubo progreso. Un caller en /loop debe verlo como
  //       "reintenta más tarde", distinto tanto de 0 (todo bien) como de 1
  //       (para y mira qué pasó).
  //
  // ============================================================================
  // D5, hallazgo A — EL EXIT 3 SIGNIFICABA DOS COSAS Y SU MENSAJE SOLO
  // DESCRIBÍA UNA.
  //
  // El texto del exit 3 ("Nada quedó a medias ni bloqueado — reintenta más
  // tarde") se escribió cuando `launchedCount === 0` SOLO podía significar
  // "no llegamos a reclamar nada". La ronda anterior lo cambió sin darse
  // cuenta: al dejar de contar como lanzado un slice cuya verificación de
  // lanzamiento NO casa ('wrong-cwd'/'not-found'), abrió un camino nuevo
  // hasta el mismo exit 3 — uno en el que el claim SÍ está escrito, la rama
  // y el worktree SÍ existen, y `cmux new-workspace` devolvió 0 (o sea,
  // puede haber un agente corriendo). Verificado por construcción antes de
  // este arreglo: con un solo slice y cmux respondiendo con otro cwd, la
  // salida traía `claimed #90 → in-progress` y un `worktree add -b feat/90`
  // en el log de git TRES LÍNEAS por encima de un mensaje que afirmaba que
  // nada había quedado a medias. Y "reintenta más tarde" era además
  // IMPOSIBLE en ese estado: el issue ya no está en status:ready y tanto la
  // rama como el directorio existen, así que el siguiente intento ni
  // seleccionaría el slice ni podría crear su worktree.
  //
  // Los dos casos se separan aquí de verdad, no suavizando el texto:
  // `unverifiedLaunches` (poblado en el bucle) es la lista EXACTA de slices
  // que dejaron estado detrás. Que esa lista sea la única fuente de residuo
  // posible al llegar hasta aquí es comprobable enumerando las salidas del
  // bucle: 'skip'/'infra' hacen `continue` sin mutar nada; 'stuck', el exit
  // inesperado, la muerte por señal, el fallo de `git worktree add`, el del
  // seed y el de `cmux` terminan todos en `process.exit()` tras intentar su
  // propia limpieza (nunca llegan aquí); 'confirmed', 'cwd-unknown' y
  // 'unverifiable' cuentan como lanzados. Queda 'wrong-cwd'/'not-found'.
  //
  // Se AMPLÍA el exit 1 (no se inventa un código nuevo) porque su semántica
  // ya es exactamente esta: "hay algo que un humano tiene que mirar y
  // limpiar; reintentar a ciegas no ayuda". Y se aplica AUNQUE la tanda
  // haya lanzado otros slices con éxito (`launchedCount > 0`): con cap 2,
  // uno confirmado y otro sin confirmar, el exit 0 de antes anunciaba
  // "progreso" mientras un issue quedaba en status:in-progress con un
  // worktree, una rama y ningún agente confirmado — la misma mentira, solo
  // que más difícil de ver.
  if (unverifiedLaunches.length > 0) {
    const detail = unverifiedLaunches
      .map((u) => `  - #${u.n}: ${u.why}. Quedan en disco/GitHub: el claim (status:in-progress), la rama ${u.branch} y el worktree ${u.wt}. Si NO hay agente trabajándolo, límpialo con: git worktree remove --force ${u.wt} ; git branch -D ${u.branch} ; ${manualRevertClaimHint({ n: u.n })}`)
      .join('\n')
    console.error(`\nATENCIÓN: ${unverifiedLaunches.length} de los ${selected.length} slice(s) seleccionados quedaron LANZADOS SIN VERIFICAR — no es "reintenta más tarde": hay estado a medias que solo un humano puede resolver, porque no se puede saber desde aquí si hay un agente corriendo o no (mirar la sesión de cmux a mano es la única forma).\n${detail}\nNO borres nada sin comprobar antes que no hay un agente trabajando ahí: un revert del claim con el agente vivo es peor que dejarlo como está.`)
    finalExitCode = 1
  } else if (selected.length > 0 && launchedCount === 0) {
    // A partir de D5 esta rama ya solo se alcanza cuando NO hay residuo (el
    // caso de arriba se lo lleva antes), así que "nada quedó a medias" es
    // por fin una afirmación cierta y no una suposición heredada.
    console.error(`ninguno de los ${selected.length} slice(s) seleccionados se lanzó esta vez — todos se saltaron AL RECLAMAR, por colisión, carrera perdida, o un fallo de infraestructura puntual (detalle arriba). No es necesariamente un fallo de configuración: puede ser otro dispatcher (u otra invocación concurrente) adelantándose entre la foto de esta tanda y el claim en vivo, o un gh inestable. Ningún claim quedó escrito, ninguna rama ni worktree se creó, y no hay nada que limpiar a mano — reintenta más tarde, o en la próxima vuelta del /loop.`)
    finalExitCode = 3
  }
}

// ============================================================================
// D5, hallazgo C — ÚLTIMO PUNTO DE CESIÓN, PARA QUE UN Ctrl-C NUNCA SE
// DESCARTE EN SILENCIO.
//
// Observado antes de este arreglo, con `--cap 1` (la invocación de portada
// de la propia documentación): un SIGINT externo que llega mientras el
// proceso está dentro de una llamada bloqueante POSTERIOR al segundo
// checkpoint (p.ej. el propio `git worktree add`) daba EXIT=0, "lanzados
// 1/1", y NI RASTRO de que se hubiera pulsado nada. El manejador solo puede
// correr cuando el event loop recupera el control, y con cap 1 no queda
// ningún `await` por delante: el proceso llega a su `process.exit()` sin
// haber cedido nunca, y el handle de señal está unref'd (no mantiene vivo el
// loop), así que la señal muere con el proceso.
//
// La decisión aquí es RECONOCER la señal, no solo documentarla: el resumen
// de la tanda ("lanzados X/Y" y el verdicto) ya se imprimió ARRIBA, así que
// ceder el control en este punto no puede ocultar información — solo puede
// añadir el acuse de recibo que faltaba. Y no puede deshacer nada: cuando se
// llega hasta aquí, todo el trabajo mutante del bucle ya terminó y
// `activeClaim` es null, así que `handleInterrupt` no revierte ningún claim;
// se limita a decir que la señal llegó tarde y que lo hecho, hecho está.
//
// POR QUÉ `setImmediate` Y NO `sleep(0)` (medido, no supuesto): una señal
// pendiente se despacha en la fase de POLL de libuv, que corre DESPUÉS de la
// fase de TIMERS. Un `await sleep(0)` (un `setTimeout`) puede resolverse en
// la fase de timers de la MISMA vuelta en la que la señal todavía no se ha
// despachado — verificado por construcción con una señal enviada durante un
// `execFileSync` bloqueante: en 2 de 8 rondas, el manejador seguía SIN
// ejecutarse tras el primer `await sleep(0)` (y sí tras el segundo). Un
// `setImmediate` corre en la fase de CHECK, inmediatamente DESPUÉS de poll:
// 8/8 rondas del mismo experimento con la señal ya despachada. Por eso este
// yield —y los dos checkpoints del bucle, ver `yieldToSignals`— cruzan la
// fase de poll en vez de confiar en un temporizador.
batchFinished = true
await yieldToSignals()
// Si `handleInterrupt` corrió durante el yield de arriba, ya llamó a
// `process.exit()` (es 100% síncrona) y esta línea no se alcanza. Si no
// corrió, no había ninguna señal pendiente y no hay nada que anunciar.
//
// `process.exitCode` y NO `process.exit(code)`: este es el único punto de
// salida que se alcanza tras haber imprimido mucho texto (el --dry-run
// vuelca el kickoff en prosa y la línea entera de `cmux` por cada slice), y
// `process.stdout` es ASÍNCRONO hacia una tubería en POSIX — un
// `process.exit()` aquí no espera a que esas escrituras se vacíen y podría
// truncar justo el final del plan. Fijar el código y dejar que el proceso
// termine solo conserva el mismo exit code y además vacía la salida; nada
// mantiene vivo el event loop a estas alturas (los handles de señal están
// unref'd). Los demás puntos de salida del fichero sí usan `process.exit()`
// a propósito: son abortos, y sus mensajes van por `console.error`/
// `writeSync` justo antes.
process.exitCode = finalExitCode

