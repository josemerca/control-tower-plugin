#!/usr/bin/env node
// ADVERTENCIA HONESTA (T11, fix round 2 — decisión de José): el claim por
// labels de este script NO tiene compare-and-swap. `claimLost()`
// (scripts/claim.js) solo puede hacer perder al claimant de número MAYOR —
// el de número menor nunca pierde por construcción — así que si dos
// dispatchers concurrentes pasan su comprobación de colisión antes de que
// cualquiera de los dos haya escrito, PUEDEN QUEDAR AMBOS reclamando el
// mismo token compartido. Esto no es hipotético: está reproducido de forma
// determinista y repetible con el harness adversarial
// (scripts/experiments/ac6-race2-deterministic.sh — 3/3 rondas en su corrida
// más reciente, y sin excepciones en ninguna de las corridas hechas durante
// su desarrollo con otros parámetros), verificado contra el estado real de
// los labels en GitHub, no solo por exit code — ver task-11-report.md §3
// para el detalle completo. La mitigación real HOY, mientras el claim siga viviendo
// en labels, es operativa, no de código: NO lanzar dos dispatchers a la vez
// sobre el mismo repo. Este script no puede garantizar exclusión mutua bajo
// concurrencia real; que quede dicho aquí sin adornos para que quien lo lea
// sepa exactamente qué garantía tiene (ninguna) y no confíe de más en el
// resultado de un exit 0. El plan es migrar el lock a una primitiva atómica
// real (test-and-set vía `git refs`, ya validado en el experimento CAS de T9)
// — hasta que eso aterrice, esta es la garantía real: ninguna bajo
// concurrencia, sí bajo uso secuencial disciplinado.
import { execFileSync } from 'node:child_process'
import { writeSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectCollisions, claimLost } from './claim.js'
import { flattenIssuePages, realIssuesOnly } from './gh-issues.js'
import { parseStrictInt } from './argnum.js'
import { NEVER_IN_A_SLICE_PR, SLICE_REL_PATH } from './state-paths.js'
import { checkPlans } from './plan-contract.js'

// ============================================================================
// Finding 4 (auditoría de interrupción/staleness): dos cambios en este
// fichero, relacionados pero independientes.
//
// (a) Truncado a ~64 KiB. `console.error(grande)` seguido INMEDIATAMENTE de
// `process.exit()` puede perder texto: `process.stdout`/`process.stderr` son
// ASÍNCRONOS hacia una tubería en POSIX (documentado en los propios docs de
// Node — el mismo razonamiento que ya motivó el `writeSync` de
// `attemptClaim` en ct-next.mjs), y `process.exit()` no espera a que un
// `write()` en vuelo termine de vaciarse. El mensaje `COLLISION: ...` (línea
// más abajo) es justo el que más crece — un choque contra muchos issues en
// vuelo a la vez — y los ATENCIÓN de "libéralo a mano" son EXACTAMENTE lo
// que un humano necesita íntegro cuando algo salió mal. `dieErr`/`dieOut`/
// `errLine`/`outLine`, más abajo, sustituyen a `console.error`/`console.log`
// en TODO este fichero (no solo justo antes de salir): dos escrituras
// separadas al MISMO fd conservan su orden aunque una sea síncrona y la
// otra no lo fuera, pero si CUALQUIERA de las escrituras previas a un
// `process.exit()` sigue en vuelo cuando este llega, se pierde igual — así
// que la única forma de estar seguro es que NINGUNA escritura de este
// fichero dependa del flush asíncrono por defecto.
//
// (b) Contrato de exit code ensanchado. Antes, TODO fallo tras el paso de
// colisión (fallo de lectura/escritura, fallo de readback, carrera perdida)
// compartía el mismo exit 1 — el caller (ct-next.mjs#classifyClaimOutcome)
// tenía que DIFERENCIAR cinco causas muy distintas parseando el TEXTO libre
// que este fichero imprime, lo cual es frágil ante un cambio futuro de
// wording. Ahora el exit code por sí solo ya distingue las tres
// consecuencias que de verdad le importan al caller:
//   0 = éxito (claim confirmado, o --release con éxito) — sin cambios.
//   1 = 'skip' — resultado NORMAL del protocolo: colisión detectada ANTES de
//       escribir nada, o carrera perdida con el revert posterior EXITOSO
//       (el issue vuelve limpio a status:ready). Ninguna mutación queda
//       persistida. Saltar este slice y seguir con el resto de la tanda es
//       correcto — sin cambios de comportamiento respecto a antes.
//   2 = error de uso/config (argv inválido, flags retirados, fixture sin
//       --dry-run, hook de prueba malformado) — sin cambios.
//   3 = NUEVO — fallo de INFRAESTRUCTURA sin mutación persistente: no se
//       pudo leer el estado del candidato, no se pudo escribir el claim, o
//       falló el readback pero el revert posterior fue exitoso. El issue
//       queda intacto (o vuelve a status:ready) — no es una colisión real,
//       pero tampoco deja nada huérfano. El caller trata esto como
//       "sigue con el resto de la tanda", igual que antes, solo que ahora
//       lo sabe por el exit code, no por parsear el mensaje.
//   4 = NUEVO — HUÉRFANO: el claim quedó en status:in-progress SIN NADIE
//       trabajándolo (revert fallido tras perder la carrera, o revert
//       fallido tras un fallo de readback). Esto exige que un humano lo
//       mire antes de que ct-next.mjs reintente nada más — el caller aborta
//       la tanda ENTERA con este código, igual que ya hacía antes al ver
//       este mismo texto de ATENCIÓN.
//   5 = NUEVO (F22) — la rama del slice INTRODUCE un fichero de estado
//       (`.agent/STATE.md` o `.agent/SLICE.md`). No se libera nada: el issue
//       se queda en status:in-progress. Este código NO lo ve nunca
//       ct-next.mjs — `--release` lo invoca el agente al entregar, no el
//       bucle de claim, así que no pasa por classifyClaimOutcome.
//   6 = NUEVO (F-jjponz-1) — el plan prescriptivo del slice falta en la rama,
//       no se puede leer, o no cumple el contrato (plan-contract.js). Sale de
//       `--release` (que se niega SIN mutar nada: el issue sigue en
//       status:in-progress) y de `--check-plan` (modo read-only para que el
//       agente valide ANTES de commitear). Igual que el 5, nunca lo ve
//       classifyClaimOutcome.
// El texto que este fichero imprime NO cambia de contenido (los mismos
// detalles, incluido el comando manual de `--release`/revert) — solo deja
// de ser la ÚNICA fuente de verdad para la decisión del caller.
// ============================================================================
//
// D5 (hallazgo colateral, hermano del de ct-next.mjs) — UN DESTINO DE SALIDA
// ROTO NO PUEDE CAMBIAR EL EXIT CODE DE ESTE PROTOCOLO.
//
// `writeSync` garantiza que el dato está escrito CUANDO RETORNA, pero puede
// no retornar nunca (tubería llena y descriptor bloqueante) o lanzar EPIPE
// (el lector cerró). Sin este try/catch, ese EPIPE subía como excepción no
// capturada y mataba el proceso con exit 1. Verificado por construcción
// ejecutando `dispatch-check 90 --repo o/r` con el extremo de LECTURA de
// stdout cerrado (el caso real de `dispatch-check ... | head`, o de un
// agente que lo invoca desde el kickoff y no consume la salida): el claim de
// #90 se escribió CON ÉXITO —`issue edit 90 --add-label status:in-progress`
// y su readback están en el log de gh— y el proceso murió con EPIPE en el
// `dieOut('claimed #90 → in-progress', 0)` final, saliendo con 1.
//
// Y 1 no es un código cualquiera en este fichero: es 'skip', o sea "colisión
// detectada a tiempo o carrera perdida con revert limpio — NADA quedó
// mutado". El caller leería un claim conseguido como un claim que nunca
// ocurrió, sobre el propio contrato de exit codes del protocolo de claim. Un
// mensaje que no se puede entregar es un límite aceptable; que decida el
// resultado del protocolo, no.
// CANAL DE SALIDA (F16/H2) — mismo criterio que ct-next.mjs y ct-groom.mjs,
// escrito entero en ct-next.mjs junto a su `warn()`:
//
//   STDOUT (`outLine`/`dieOut`) = el PRODUCTO. Aquí, el resultado del
//            protocolo de claim: `claimed #N → in-progress`, `released`,
//            `reopened`, `requeued`, y las notas que acompañan a un resultado
//            conseguido.
//   STDERR (`errLine`/`dieErr`) = el DIAGNÓSTICO. `COLLISION:`, `ATENCIÓN:`,
//            errores de uso y todo aborto.
//
// Este fichero YA cumplía el criterio; queda dicho para que el reparto no
// haya que inferirlo. OJO al añadir líneas: `writeSync` (más abajo) NO es un
// detalle de estilo — es lo que impide que un `process.exit()` inmediato se
// coma el mensaje, y lo que impide que un destino roto cambie el exit code.
function safeWrite(fd, text) {
  try {
    writeSync(fd, text)
  } catch {
    // Tubería cerrada o llena: la línea se pierde. Nunca cambia el exit code
    // ni mata el proceso a mitad del protocolo de claim.
  }
}
function errLine(msg) { safeWrite(2, msg + '\n') }
function outLine(msg) { safeWrite(1, msg + '\n') }
function dieErr(msg, code) { errLine(msg); process.exit(code) }
function dieOut(msg, code) { outLine(msg); process.exit(code) }

// `arg()` solo devuelve un string cuando el flag realmente trae un valor: si
// el flag es el último token de argv, o el token siguiente es a su vez otro
// flag (empieza por `--`), devolvemos `true` (presente-sin-valor) en vez de
// colarlo como valor. Los call-sites validan explícitamente `typeof === 'string'`
// antes de usarlo — así un `--repo` colgante nunca llega a `execFileSync`.
const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}
const has = (f) => process.argv.includes(f)
// D4, defecto 2 (mismo patrón que `--cap` en ct-next.mjs, y aquí más caro):
// `parseInt(process.argv[2], 10)` es un parser TOLERANTE — `parseInt('42x',
// 10)` es 42, `parseInt('1e3', 10)` es 1. Este número identifica el issue
// que se va a MUTAR (status:ready → status:in-progress) contra un repo real:
// un argumento con basura de cola reclamaba, en silencio, un issue que el
// usuario no había nombrado. parseStrictInt (scripts/argnum.js) solo acepta
// dígitos decimales; cualquier otra cosa es error de uso, nunca un número
// "parecido".
const issue = parseStrictInt(process.argv[2])
const repo = arg('--repo')
const release = has('--release')
const reopen = has('--reopen')
const requeue = has('--requeue')
const checkPlan = has('--check-plan')
const dryRun = has('--dry-run')
const usage = 'uso: dispatch-check.mjs <issue#> --repo <o/r> [--release | --reopen | --requeue | --check-plan] [--dry-run]'
if (issue === null || issue < 1) {
  dieErr(`<issue#> inválido: ${process.argv[2] === undefined ? '(ausente)' : `"${process.argv[2]}"`} — debe ser un entero >= 1 escrito con dígitos a secas (nada de "42x", "1e3", "4.2", espacios, ni signo "+"/"-": un número aproximado aquí reclamaría un issue que no es el que pediste).\n${usage}`, 2)
}
if (typeof repo !== 'string' || repo.length === 0) { dieErr(usage, 2) }
// Los tres flags mueven el MISMO label por aristas distintas del ciclo
// (ready → in-progress → in-review → in-progress → … → ready). Pasar dos
// juntos no tiene una interpretación razonable, y elegir uno en silencio sería
// adivinar cuál quería quien lo escribió sobre una mutación de estado real.
{
  const pedidos = [release && '--release', reopen && '--reopen', requeue && '--requeue', checkPlan && '--check-plan'].filter(Boolean)
  if (pedidos.length > 1) {
    dieErr(`${pedidos.join(' y ')} son mutuamente excluyentes: --release cierra el slice hacia revisión (in-progress → in-review), --reopen lo devuelve al banco de trabajo tras un rechazo (in-review → in-progress) y --requeue lo abandona y lo devuelve a la cola (in-progress → ready). Elige uno.\n${usage}`, 2)
  }
}

// CT_CLAIM_TEST_SELF_KILL_SIGNAL — exclusivamente para tests (revisión
// externa, IMPORTANTE: un Ctrl-C real durante attemptClaim en ct-next.mjs
// mata a ESTE proceso por señal, y el caller necesita distinguirlo de un
// "bug o mala configuración" — ver classifyClaimOutcome/el caller en
// ct-next.mjs). Reproducir esto de forma determinista con una señal EXTERNA
// exigiría coordinar el PID de un subproceso lanzado dentro de OTRO
// subproceso — fràgil y con las mismas carreras de temporización ya vistas
// en finding 1. Autoenviarse la señal (misma syscall subyacente que una
// externa, indistinguible para Node) en un punto determinista es la forma
// fiable de ejercer ese camino. Se comprueba aquí, justo después de la
// validación de uso — antes de tocar `gh` o mutar nada — para que el efecto
// sea idéntico a "el usuario interrumpió justo al principio".
if (process.env.CT_CLAIM_TEST_SELF_KILL_SIGNAL) {
  process.kill(process.pid, process.env.CT_CLAIM_TEST_SELF_KILL_SIGNAL)
  // El propio proceso muere aquí por la señal (disposición por defecto: sin
  // manejador registrado en este fichero) — nada después de esta línea
  // llega a ejecutarse cuando la variable está fijada.
}

// --settle-ms/CT_CLAIM_SETTLE_MS ya NO EXISTEN (T11, fix round 2 — ver el
// comentario de cabecera de este fichero para el porqué). Si el flag
// aparece en argv, se RECHAZA explícitamente con exit 2 en vez de
// ignorarlo en silencio: alguien que lo invoque por costumbre
// (`--settle-ms 2000`, de un script o de memoria muscular) con un exit 0
// limpio se quedaría creyendo que hay una espera de asentamiento activa —
// exactamente el "invita a confiar en él" que motivó eliminarla. Ignorarlo
// en silencio habría reintroducido esa falsa confianza por otra vía.
if (has('--settle-ms') || process.env.CT_CLAIM_SETTLE_MS !== undefined) {
  dieErr('--settle-ms/CT_CLAIM_SETTLE_MS ya no existen: la espera de asentamiento se eliminó a propósito (ver el comentario de cabecera de dispatch-check.mjs y task-11-report.md). Quítalo de la invocación/entorno — no hace nada, y dejarlo puesto invita a creer que sigue activo.', 2)
}

// NO HAY ESPERA DE ASENTAMIENTO ("settle wait") EN ESTE SCRIPT — se eliminó a
// propósito (T11, fix round 2). Existió una versión anterior con
// --settle-ms/CT_CLAIM_SETTLE_MS (una espera entre escribir el claim y
// releerlo, con 2000ms de default), vendida como mitigación de la ventana de
// doble claim.
//
// LA RAZÓN DE ELIMINARLA NO ES "SE DEMOSTRÓ QUE NO SERVÍA DE NADA" — eso no
// está demostrado, y afirmarlo sería tan impreciso como la promesa original.
// La razón es más simple y no depende de esa medición: una ventana temporal
// no CIERRA una condición de carrera, solo reduce su probabilidad, y no
// queremos mitigar una carrera real con un temporizador, mida lo que mida.
// Esa razón se sostiene sola.
//
// Lo que sí se midió (task-11-report.md §5, resumen y detalle): tres
// barridos de skew (500, 3000 y 8000ms) contra settle=0 y settle=2000 dieron
// el mismo resultado en ambos valores de settle. Un cuarto punto, skew=1000,
// SÍ divergió (settle=0 → doble claim 3/3; settle=2000 → sin doble claim
// 3/3) — pero es n=1 (una sola ronda de 3 medida en ese punto, sin repetir
// en puntos vecinos), no concluyente por sí solo. Los datos, en conjunto,
// no permiten afirmar ni que el settle aportaba 0 de margen ni que aportaba
// ~2s: el muestreo no alcanza para resolverlo, y no se ha completado el
// barrido fino que sí lo resolvería. La garantía real hoy está en el
// comentario de cabecera de este fichero: ninguna bajo concurrencia.
//
// Sleep síncrono y bloqueante (sin async/await, para no reestructurar todo el
// script en promesas): Atomics.wait sobre un buffer compartido es la forma
// estándar de bloquear el hilo principal de Node un intervalo fijo.
function sleepSync(ms) {
  if (!(ms > 0)) return
  const sab = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(sab, 0, 0, ms)
}

// CT_CLAIM_FIXTURE es exclusivamente para tests. Si queda colgada en el
// entorno (una variable que un test no limpió, un wrapper que no la borra) SIN
// --dry-run, el script NO debe decidir con datos fabricados ni, sobre todo,
// ejecutar mutaciones reales contra gh con ese estado inventado de fondo:
// se trata como error de uso y abortamos antes de tocar gh.
if (process.env.CT_CLAIM_FIXTURE && !dryRun) {
  dieErr('CT_CLAIM_FIXTURE está definido pero falta --dry-run: por seguridad no se decide ni se muta gh real con datos de fixture. Añade --dry-run o limpia la variable de entorno.', 2)
}
// Atado también en la propia lectura (defensa en profundidad): `fx` solo
// puede ser no-nulo cuando `dryRun` es cierto.
const fx = (dryRun && process.env.CT_CLAIM_FIXTURE) ? JSON.parse(process.env.CT_CLAIM_FIXTURE) : null

// maxBuffer explícito (finding 7 de la review final): el default de Node para
// execFileSync es 1 MiB. `allOpen()` ya no lleva `--limit` (ver más abajo), así
// que en un repo con unos pocos cientos de issues abiertos el JSON puede
// superar 1 MiB con facilidad. Node aborta ruidosamente si se excede (no
// trunca en silencio), pero eso haría inusable el comando contra un repo real.
// 20 MiB es generoso para miles de issues sin ser "sin límite" de verdad.
const GH_MAX_BUFFER = 20 * 1024 * 1024
// timeout+killSignal (MENOR, revisión externa: consistencia con el
// principio de ct-next.mjs de que TODA llamada bloqueante a un subproceso
// debe estar acotada — este fichero también puede invocarse en solitario,
// no solo como subproceso de ct-next.mjs, así que le hace falta su propia
// cota independiente en vez de depender solo del timeout que le impone el
// caller desde fuera). Mismo default (10 min) y mismo tope (24h) que
// CT_NEXT_CHILD_TIMEOUT_MS en ct-next.mjs, con su propia variable de
// entorno — dispatch-check.mjs no importa nada de ct-next.mjs.
const CHILD_TIMEOUT_CAP_MS = 24 * 60 * 60 * 1000
let ghTimeoutMs = 10 * 60 * 1000
const ghTimeoutRaw = process.env.CT_CLAIM_CHILD_TIMEOUT_MS
if (ghTimeoutRaw !== undefined) {
  const n = Number(ghTimeoutRaw)
  if (!Number.isFinite(n) || n <= 0 || n > CHILD_TIMEOUT_CAP_MS) {
    dieErr(`CT_CLAIM_CHILD_TIMEOUT_MS inválido: "${ghTimeoutRaw}" — debe ser un número > 0 y <= ${CHILD_TIMEOUT_CAP_MS}`, 2)
  }
  ghTimeoutMs = n
}
const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: GH_MAX_BUFFER, timeout: ghTimeoutMs, killSignal: 'SIGKILL' })
const labelsOf = (n) => JSON.parse(gh(['issue', 'view', String(n), '--repo', repo, '--json', 'labels', '-q', '[.labels[].name]']))
// Listado directo de issues abiertos vía el endpoint REST `gh api
// repos/<repo>/issues` — NUNCA el índice de búsqueda (`--search` / `gh search
// issues`), que tiene latencia de indexado y podría no reflejar todavía el
// label recién escrito por otro runner. Tampoco `gh issue list --limit 200`
// (finding 2 de la review final): ese endpoint devuelve más nuevo primero, así
// que un `--limit` fijo deja fuera justo los issues VIEJOS — y un
// `in-progress` colisionante que caiga fuera de esta lista hace que
// `detectCollisions`/`claimLost` fallen ABIERTOS (el lock deja de bloquear,
// en vez de fallar cerrado). En su lugar usamos paginación real (`--paginate
// --slurp`, sin tope), reutilizando el mismo helper de aplanado/filtrado de
// PRs que ct-groom.mjs/ct-next.mjs (scripts/gh-issues.js) — ese endpoint
// también devuelve pull requests. Toda la lógica de colisión y desempate
// sigue siendo enteramente client-side en `claim.js`. per_page=100 (re-review):
// el default REST es 30/página; con --paginate igual se traen todas, pero
// `allOpen()` se llama DOS veces por claim (colisión + readback), así que
// menos páginas por llamada recorta ~3x los round-trips totales. 100 es el
// máximo que admite este endpoint.
const allOpen = () => realIssuesOnly(flattenIssuePages(JSON.parse(
  gh(['api', `repos/${repo}/issues`, '--method', 'GET', '-f', 'state=open', '-f', 'per_page=100', '--paginate', '--slurp']))))
  .map((i) => ({ n: i.number, labels: (i.labels || []).map((l) => l.name) }))

const manualReleaseHint = () => `gh issue edit ${issue} --repo ${repo} --add-label status:ready --remove-label status:in-progress`

// setStatus: única función que muta el label `status:` de un issue — el
// claim (status:ready → status:in-progress), el revert por carrera perdida,
// el revert por fallo de readback, y --release (status:in-progress →
// status:in-review) pasan los cuatro por aquí. El plan (decisión ya tomada
// por José) es migrar el lock a una primitiva atómica real — un create de
// `POST /repos/{owner}/{repo}/git/refs`, ya validado en un experimento
// anterior como test-and-set real: 201 para el ganador, 422 "Reference
// already exists" para cada perdedor, en 5 rondas de 8 intentos realmente
// concurrentes — y esta extracción reduce esa migración futura a un solo
// punto de edición en vez de cuatro.
//
// Devuelve { ok: true } o { ok: false, error }, y NO imprime ni sale del
// proceso por su cuenta: qué mensaje mostrar en fallo, si hace falta uno de
// éxito, y si el fallo debe abortar (exit 1) o solo avisar y seguir difieren
// en cada uno de los cuatro call sites (ver más abajo y en el claim-then-
// verify) — esa decisión es de cada caller, no de setStatus. Se eligió
// "devuelve un resultado" en vez de una callback de mensajes porque el
// control de flujo alrededor de cada mutación ya es distinto sitio a sitio
// (dos de los cuatro sitios llaman a process.exit(1) inmediatamente en
// fallo; los otros dos delegan esa decisión a un catch/if exterior que ya
// existía antes de esta extracción) — forzar ese control de flujo dentro de
// setStatus habría sido más complejo que dejarlo donde ya estaba. Mismo
// patrón que `attemptRevertClaim` en ct-next.mjs: una mutación gh que
// reporta éxito/fallo sin decidir qué hacer con ese resultado.
function setStatus(issue, from, to) {
  try {
    gh(['issue', 'edit', String(issue), '--repo', repo, '--add-label', to, '--remove-label', from])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e }
  }
}

// ============================================================================
// F22 — LA PUERTA: UN SLICE NO ENTREGA CON UN FICHERO DE ESTADO DENTRO.
//
// `.agent/STATE.md` es de la sesión COORDINADORA. Si la rama del slice lo
// introduce, el squash del PR deja main con el estado de un slice: `task:` con
// el nombre del slice, `role: slice-agent` y un gate pendiente de un PR ya
// mergeado. Cualquier sesión nueva del repo se hidrata creyendo que ES ese
// agente. Pasó tres veces en un periodo de 9 slices, y una llegó a main.
//
// SE NIEGA, no avisa. Una comprobación que sólo imprime no es una
// comprobación: si su resultado no puede detener la acción siguiente, es
// decoración — y fue exactamente así como se coló la que llegó a main (imprimió
// `1` y el merge siguió adelante).
//
// LÍMITE, dicho: `--release` lo invoca el agente porque el kickoff se lo pide,
// y el kickoff es un prompt, no un gate. Un agente que no lo llame se salta
// esta puerta — pero entonces su issue se queda en status:in-progress, que sí
// se ve. Esto mueve el caso normal de la retina del humano al loop; no lo
// vuelve hermético.
// ============================================================================
function sliceBaseRef() {
  // El `base` de la semilla es la respuesta correcta: es la referencia real
  // desde la que se cortó este worktree, `--base` incluido. La cadena de
  // fallback cubre los worktrees del esquema anterior (sin SLICE.md).
  try {
    const m = readFileSync(join(process.cwd(), SLICE_REL_PATH), 'utf8').match(/^base:[ \t]*(.+)$/m)
    if (m) {
      const v = m[1].trim().replace(/^['"]|['"]$/g, '')
      if (v) return v
    }
  } catch { /* sin SLICE.md: worktree del esquema anterior, o cwd que no es el worktree */ }
  for (const ref of ['origin/HEAD', 'origin/main', 'main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { stdio: 'ignore' })
      return ref
    } catch { /* siguiente */ }
  }
  return ''
}

// F22, fix round 1 (Important + Minor elevado) — TRES formas de que esta
// función informe "limpia" sin haber comprobado nada de verdad:
//
//   (a) `diff.relative=true` en la config de git de quien invoca, combinado
//       con un cwd en un subdirectorio: `git diff --name-only` sin más omite
//       los paths FUERA del subárbol del cwd, así que el `includes(p)` de
//       abajo nunca encontraría `.agent/STATE.md` aunque esté en el diff
//       real. `--no-relative` lo desactiva explícitamente sin importar la
//       config de quien invoque.
//   (b) detección de renombres activada (el default de `git diff` con
//       heurística de similitud): una rama que RENOMBRA `.agent/STATE.md` a
//       otra cosa imprime solo el destino — el borrado del origen queda
//       oculto dentro del par de rename, y `includes('.agent/STATE.md')`
//       no lo ve. `--no-renames` fuerza que el borrado y la creación salgan
//       como dos líneas independientes, una de ellas el path exacto que se
//       busca.
//   (c) un `base:` en la semilla IGUAL a HEAD. `SLICE.md` no está trackeado
//       y lo escribe el propio agente del slice — es agent-reachable. Con
//       `base === HEAD`, `git diff base...HEAD` es SIEMPRE vacío por
//       construcción: no es que la rama esté limpia, es que no se comparó
//       nada. Tratarlo como "limpia" dejaría que un agente (a propósito o
//       por un bug) neutralizara la puerta reescribiendo su propio `base:`
//       al commit en el que ya cometió la contaminación. Se trata igual que
//       "no se pudo determinar la base": known:false, nunca known:true con
//       hits vacíos.
function stateFilesIntroducedByBranch() {
  const base = sliceBaseRef()
  if (!base) {
    return { known: false, why: 'no se pudo determinar la base de esta rama (ni `base:` en la semilla, ni origin/HEAD, ni main, ni master)' }
  }
  let baseSha, headSha
  try {
    baseSha = execFileSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { encoding: 'utf8' }).trim()
    headSha = execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { encoding: 'utf8' }).trim()
  } catch (e) {
    return { known: false, why: `no se pudo resolver \`${base}\` o HEAD a un commit: ${e.message}` }
  }
  if (baseSha === headSha) {
    return { known: false, why: `la base resuelta (\`${base}\`) es EL MISMO commit que HEAD (${headSha.slice(0, 12)}) — un diff contra sí mismo sale vacío por construcción, así que eso no es "limpia", es "no comparada"` }
  }
  let out = ''
  try {
    out = execFileSync('git', ['diff', '--no-relative', '--no-renames', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
  } catch (e) {
    return { known: false, why: `\`git diff ${base}...HEAD\` falló: ${e.message}` }
  }
  const touched = out.split('\n').map((l) => l.trim()).filter(Boolean)
  return { known: true, base, hits: NEVER_IN_A_SLICE_PR.filter((p) => touched.includes(p)) }
}

// F-jjponz-1 — EL PLAN DEL SLICE ES UN ENTREGABLE, NO UNA COSTUMBRE.
//
// El kickoff pide el plan desde F32, pero un kickoff es un prompt, no un
// gate (el LÍMITE de arriba lo dice para --release entero). Desde esta ronda
// el plan tiene contrato (plan-contract.js) y el release lo comprueba con la
// misma doctrina que el check de ficheros de estado: SE NIEGA, no avisa.
// Mismo git diff de base (y las mismas tres trampas: --no-relative,
// --no-renames, base === HEAD) que stateFilesIntroducedByBranch — pero sin
// el filtro NEVER_IN_A_SLICE_PR, porque aquí buscamos lo que la rama APORTA.
function branchIntroducedFiles() {
  const base = sliceBaseRef()
  if (!base) {
    return { known: false, why: 'no se pudo determinar la base de esta rama (ni `base:` en la semilla, ni origin/HEAD, ni main, ni master)' }
  }
  let baseSha, headSha
  try {
    baseSha = execFileSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { encoding: 'utf8' }).trim()
    headSha = execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { encoding: 'utf8' }).trim()
  } catch (e) {
    return { known: false, why: `no se pudo resolver \`${base}\` o HEAD a un commit: ${e.message}` }
  }
  if (baseSha === headSha) {
    return { known: false, why: `la base resuelta (\`${base}\`) es EL MISMO commit que HEAD (${headSha.slice(0, 12)}) — un diff contra sí mismo sale vacío por construcción` }
  }
  let out = ''
  try {
    out = execFileSync('git', ['diff', '--no-relative', '--no-renames', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
  } catch (e) {
    return { known: false, why: `\`git diff ${base}...HEAD\` falló: ${e.message}` }
  }
  return { known: true, base: baseSha, files: out.split('\n').map((l) => l.trim()).filter(Boolean) }
}

const readRepoFile = (p) => readFileSync(p, 'utf8')

// F-jjponz-3 — lector de los ficheros CITADOS por el plan en --release: la
// base de la rama, no el árbol. `git show <sha>:<path>` resuelve el path
// desde la raíz del repo (a diferencia de readFileSync, que lo resuelve desde
// el cwd), así que de propina esto no depende del directorio desde el que se
// invoque. Si el fichero no está en la base, se LANZA: el validador lo
// convierte en una violación que dice dónde se miró, en vez de afirmar "cita
// de memoria" — un fichero que el slice crea se cita con "Current state: does
// not exist.", y confundir los dos casos manda a buscar el error donde no
// está. maxBuffer explícito porque el default de execFileSync (1 MiB) haría
// fallar la lectura de un fichero citado grande, y eso se leería como un plan
// inválido cuando lo que pasa es que no se pudo comprobar.
const readFileAtBase = (base) => (p) => {
  try {
    return execFileSync('git', ['show', `${base}:${p}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  } catch {
    throw new Error(`no existe en la base de la rama (${String(base).slice(0, 12)})`)
  }
}

if (checkPlan) {
  // Modo read-only: candidatos = el árbol de trabajo, commiteado o no — es
  // el modo de ANTES de commitear. No toca GitHub, no mira labels.
  let candidates = []
  try {
    candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'docs/superpowers/plans'], { encoding: 'utf8' })
      .split('\n').map((l) => l.trim()).filter(Boolean)
  } catch (e) {
    dieErr(`--check-plan: no se pudo listar docs/superpowers/plans (${e.message}). Corre esto desde la raíz del worktree del slice.`, 6)
  }
  const result = checkPlans({ issue, candidates, readFile: readRepoFile })
  if (!result.ok) dieErr(`--check-plan: ${result.message}`, result.code)
  dieOut(result.message, 0)
}

if (release) {
  const check = stateFilesIntroducedByBranch()
  if (!check.known) {
    dieErr(`no se puede liberar #${issue}: ${check.why}, así que NO se ha podido comprobar si esta rama introduce un fichero de estado (${NEVER_IN_A_SLICE_PR.join(' o ')}). No se afirma que esté limpia — un fichero de estado en el PR deja main con el estado de un slice tras el squash. Comprueba a mano con \`git diff --name-only <base>...HEAD\` y, si está limpio, vuelve a intentarlo desde un cwd donde la base se resuelva.`, 5)
  }
  if (check.hits.length) {
    const lista = check.hits.join(', ')
    // `pathspec` va SEPARADO de `lista` a propósito: la prosa enumera con
    // comas, pero un `git checkout <base> -- a.md, b.md` mete la coma DENTRO
    // del pathspec y falla ("did not match any file"). El comando que se
    // emite tiene que poder pegarse tal cual, y con los dos ficheros a la vez
    // es justo cuando más falta hace.
    const pathspec = check.hits.join(' ')
    dieErr(`no se libera #${issue}: esta rama INTRODUCE ${lista} respecto a ${check.base}. Ese fichero es el estado de la sesión coordinadora, no producto de este slice: al mergear con squash, main se quedaría con el estado de este slice y cualquier sesión nueva del repo se hidrataría creyendo que es este agente. Restáuralo y vuelve a intentarlo: \`git checkout ${check.base} -- ${pathspec}\` y commitea (o \`git rm --cached\` si lo añadiste nuevo). El issue sigue en status:in-progress: no se ha movido nada.`, 5)
  }
  // F-jjponz-1 — el plan, DESPUÉS del check de ficheros de estado a propósito:
  // la contaminación de main (exit 5) es la avería más cara y su mensaje debe
  // ganar. Un plan ausente (exit 6) solo retrasa a ESTE slice.
  const plan = branchIntroducedFiles()
  if (!plan.known) {
    dieErr(`no se puede liberar #${issue}: ${plan.why}, así que NO se ha podido comprobar si la rama trae el plan prescriptivo del slice. No se afirma que falte — comprueba a mano con \`git diff --name-only <base>...HEAD | grep docs/superpowers/plans\` y reintenta desde un cwd donde la base se resuelva.`, 6)
  }
  const planCheck = checkPlans({
    issue,
    candidates: plan.files,
    readFile: readRepoFile,
    readCitedFile: readFileAtBase(plan.base),
  })
  if (!planCheck.ok) {
    dieErr(`no se libera #${issue}: ${planCheck.message} El issue sigue en status:in-progress: no se ha movido nada.`, planCheck.code)
  }
  if (!dryRun && !fx) {
    const result = setStatus(issue, 'status:in-progress', 'status:in-review')
    if (!result.ok) {
      // --release nunca pasa por classifyClaimOutcome en ct-next.mjs (es un
      // paso posterior, invocado por el propio agente al terminar el
      // slice, no por el bucle de claim) — su exit 1 queda fuera del
      // contrato ensanchado de arriba, sin cambios.
      dieErr(`no se pudo liberar #${issue} a in-review: ${result.error.message}. Sigue en status:in-progress; reintenta el --release.`, 1)
    }
  }
  dieOut(`released #${issue} → in-review`, 0)
}

// ============================================================================
// F15/H1 — `--reopen` REABRÍA LA VENTANA QUE F13 CERRÓ.
//
// F13 separó dos contabilidades que vivían en un solo label: el CAP mide
// agentes vivos (`in-progress`), los TOKENS miden trabajo SIN MERGEAR
// (`in-progress` + `in-review`). Y en la misma ronda añadió `--reopen` para
// que un PR rechazado pudiera volver al loop… mandándolo a `status:ready`.
//
// `ready` NO retiene tokens. Pero el trabajo sin mergear del slice rechazado
// sigue existiendo en su rama y en su PR: mientras alguien corrige encima, un
// vecino que comparta `area:`/`touches:` podía despacharse ramificando de una
// `main` que no lo contiene — exactamente la ventana que F13 vino a cerrar,
// reabierta por su propia arista de vuelta. Reproducido por construcción con
// `planDispatch` antes de tocar nada: con #7 en `in-review` y `area:plan`, el
// candidato #8 que comparte esa área se salta y sale #9; con ese mismo #7 en
// `ready`, `runningTouches` sale VACÍO y la protección desaparece.
//
// LA RAÍZ: `ready` significaba dos cosas incompatibles. "Nunca se empezó — no
// hay nada en ninguna rama" y "se empezó, se rechazó, hay trabajo sin mergear
// y se está rehaciendo encima". La primera no debe bloquear a nadie; la
// segunda tiene que bloquear a sus vecinos. Un solo label no puede ser las
// dos.
//
// LA SOLUCIÓN: `--reopen` deja de ir a `ready`. Va a `status:in-progress`, que
// es el INVERSO EXACTO de `--release`. No es un apaño para retener tokens: es
// que `in-progress` describe la verdad de ese slice tras un rechazo, en las
// DOS contabilidades a la vez y sin tocar ni una línea de dispatch.js:
//   - TOKENS: hay trabajo sin mergear en `feat/<n>`. Debe retenerlos. Lo hace.
//   - CAP: hay alguien trabajándolo (corregir encima es el camino normal tras
//     un rechazo, y es lo que el propio mensaje de abajo recomienda). Ocupar
//     una plaza de concurrencia es correcto, no un efecto colateral.
//   - CLAIM RANCIO: `stalenessNote` marca un `in-progress` sin worktree, ni
//     rama, ni sesión. Tras un `--reopen` el worktree y la rama SIGUEN AHÍ
//     (reabrir no toca el disco), así que no salta ninguna falsa alarma.
//
// POR QUÉ NO LAS OTRAS DOS VÍAS:
//   - "que `ready` retenga tokens": rompe el caso normal — un slice que nunca
//     se empezó pasaría a bloquear a todos sus vecinos de área para siempre.
//   - "un estado nuevo, `status:rejected`": el argumento de F13 sigue en pie
//     (hay que enseñárselo a todo lo que lee labels), y aquí además sobra: el
//     estado que hacía falta ya existía y se llama `in-progress`.
// Y NO reintroduce lo que F13 descartó a conciencia (mantener el claim desde
// el PR hasta el merge): ahí el slice pasaba días en `in-progress` SIN NADIE
// trabajándolo, congelando una plaza y disparando una falsa alarma de claim
// huérfano en cada PR en revisión. Aquí el `in-progress` se pone en el momento
// exacto en que alguien vuelve a ponerse con él, y no antes.
//
// LO QUE ESTO ESTRECHA, DICHO EN VOZ ALTA. Antes, `--reopen` dejaba el slice
// despachable por `/ct-next`. Ya no: sale del comando ya reclamado. Eso es
// deliberado (era despachable en falso — `/ct-next` se negaba igual, porque el
// worktree y la rama existían), pero deja huérfano el otro camino, el de
// "empezar de cero", que sí necesitaba `ready`. Ese camino tiene ahora su
// propia arista comprobada: `--requeue` (más abajo), que exige que no quede
// nada del slice en esta máquina antes de declararlo listo para volver a la
// cola. La alternativa era dejar ese caso en manos de un `gh issue edit` a
// mano, que es justo lo que `--reopen` existe para no tener que hacer.
// ============================================================================

// ============================================================================
// --reopen (F13/H1) — `status:in-review` ERA UN ESTADO TERMINAL.
//
// EL AGUJERO. `--release` movía `in-progress → in-review` y NO EXISTÍA
// NINGUNA transición de vuelta a `status:ready`. Los únicos caminos que
// devolvían un issue a `ready` eran los reverts (carrera perdida, fallo de
// readback, interrupción) — todos por FALLOS DEL PROTOCOLO, ninguno por una
// revisión rechazada. Y `/ct-next` solo despacha `ready`. Consecuencia: si
// rechazas un PR en el gate, ese slice sale del loop PARA SIEMPRE, y con él
// todo lo que dependa de él. El caso no es exótico: en un epic típico, el
// slice con más papeletas de ser rechazado en el gate visual suele ser
// justamente uno del que cuelgan varios.
//
// POR QUÉ UNA TRANSICIÓN EXPLÍCITA Y NO UN ESTADO NUEVO ('status:rejected').
// Un estado nuevo obliga a enseñárselo a TODO lo que lee labels
// (resolveStatus y su precedencia, computeReadyCandidates, la detección de
// colisión, ct-groom, el contrato de la §9…) y multiplica las combinaciones
// que hay que razonar, a cambio de información que el propio issue ya
// conserva mejor que un label: el hilo de la review dice por qué se rechazó.
// Lo que faltaba no era un estado, era una ARISTA.
//
// POR QUÉ AQUÍ Y NO EN /ct-next. `dispatch-check.mjs` ya es el único fichero
// que muta labels `status:` (ver el comentario de `setStatus`), y reabrir es
// una decisión HUMANA del gate — igual que promover de backlog a ready. El
// dispatcher no debe poder deshacer un veredicto de revisión por su cuenta.
//
// CÓMO SE EVITA REABRIR ALGO POR ACCIDENTE (el requisito explícito):
//   1. Flag propio y explícito, nunca invocado por ningún camino automático:
//      ni /ct-next, ni el kickoff del agente, lo ejecutan jamás.
//   2. PRECONDICIÓN LEÍDA, no supuesta: se lee el estado real del issue y se
//      exige `status:in-review`. Un `gh issue edit --add-label ready
//      --remove-label in-review` a pelo (lo que haría cualquiera a mano)
//      NO comprueba nada: sobre un issue en `in-progress` añadiría `ready`
//      dejando DOS labels de status a la vez, que es justo el estado
//      ambiguo que resolveStatus existe para sobrevivir. Aquí se rechaza.
//   3. Y se rechaza distinguiendo el caso: reabrir algo que ya está `ready`
//      no es un error del usuario que haya que castigar, es un no-op que hay
//      que nombrar.
// ============================================================================

// localSliceArtifacts: qué queda EN ESTA MÁQUINA de la vuelta anterior del
// slice — el worktree `.worktrees/<n>` y la rama `feat/<n>`. Se mira desde el
// checkout PRINCIPAL, no desde el cwd: este script puede invocarse desde
// dentro del propio worktree del slice (el kickoff lo hace), y ahí
// `--show-toplevel` devolvería el worktree en vez del checkout donde vive
// `.worktrees/`. `git worktree list --porcelain` empieza SIEMPRE por el
// worktree principal, y es portable a git viejos (a diferencia de
// `--path-format=absolute --git-common-dir`).
//
// Devuelve `{ known: false }` si no se ha podido mirar (no hay git, no
// estamos dentro de un repo, el comando falla). Nunca se traduce "no se pudo
// comprobar" a "no hay nada": el mensaje de abajo dice explícitamente cuál de
// las dos cosas sabe.
function localSliceArtifacts(n) {
  // `cwd` en vez de `-C <root>` a propósito: el argv queda idéntico al que
  // usa ct-next.mjs para la misma pregunta (`rev-parse --verify --quiet
  // refs/heads/feat/<n>`), que es lo que permite razonar sobre los dos sitios
  // como una sola consulta — y lo que hace que el stub de git de los tests
  // reconozca esta llamada sin tener que enseñarle una segunda forma.
  const git = (a, cwd) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000, killSignal: 'SIGKILL', ...(cwd ? { cwd } : {}) })
  let mainRoot
  try {
    const line = git(['worktree', 'list', '--porcelain']).split('\n').find((l) => l.startsWith('worktree '))
    if (!line) return { known: false }
    mainRoot = line.slice('worktree '.length).trim()
    if (!mainRoot) return { known: false }
  } catch {
    return { known: false }
  }
  const worktree = `${mainRoot}/.worktrees/${n}`
  let hasWorktree = false
  try {
    hasWorktree = statSync(worktree).isDirectory()
  } catch {
    hasWorktree = false
  }
  let hasBranch = false
  try {
    // Si `mainRoot` ya no existe en disco (worktree list respondió desde otro
    // sitio, o el directorio se borró entre las dos llamadas), spawn falla y
    // caemos a `false` — que es lo correcto: no hay evidencia de rama.
    git(['rev-parse', '--verify', '--quiet', `refs/heads/feat/${n}`], mainRoot)
    hasBranch = true
  } catch {
    hasBranch = false
  }
  return { known: true, mainRoot, worktree, branch: `feat/${n}`, hasWorktree, hasBranch }
}

// reopenDiskNote: qué hacer con el worktree y la rama que ya existen de la
// vuelta anterior. Reabrir un slice NO los borra —y no debe: normalmente el
// trabajo rechazado se corrige ENCIMA de lo que ya hay, no desde cero— pero
// tampoco puede callarlo, porque `/ct-next` SE NIEGA a despachar un slice
// cuyo worktree o rama ya existen (precondición, antes de reclamar nada). Sin
// esta nota, reabrir "funcionaría" y el siguiente `/ct-next` fallaría con un
// mensaje que no menciona la reapertura.
function reopenDiskNote(n) {
  const a = localSliceArtifacts(n)
  const requeueCmd = `node <plugin>/scripts/dispatch-check.mjs ${n} --repo ${repo} --requeue`
  if (!a.known) {
    return `No se ha podido comprobar qué queda de la vuelta anterior en esta máquina (no se pudo consultar git desde aquí) — NO lo leas como "no hay nada". Si el worktree .worktrees/${n} o la rama feat/${n} siguen existiendo, sigue trabajando ahí encima; si de verdad quieres empezar de cero, bórralos y devuélvelo a la cola con: ${requeueCmd}`
  }
  if (!a.hasWorktree && !a.hasBranch) {
    return [
      `De la vuelta anterior no queda nada en ${a.mainRoot} (ni worktree .worktrees/${n} ni rama feat/${n}), pero #${n} ha quedado en status:in-progress: retiene sus tokens de área/touches porque su PR sigue sin mergear, y ocupa una plaza de --cap.`,
      `  - Si vas a rehacerlo tú, el estado ya es el correcto: crea el worktree y sigue.`,
      `  - Si lo que quieres es que /ct-next lo despache de cero, devuélvelo a la cola con: ${requeueCmd}`,
      `  OJO: si la rama solo existe en el remoto, el trabajo anterior sigue ahí — recupéralo (o cierra su PR) antes de rehacerlo.`,
    ].join('\n')
  }
  const quedan = [a.hasWorktree ? `el worktree ${a.worktree}` : null, a.hasBranch ? `la rama ${a.branch}` : null].filter(Boolean).join(' y ')
  return [
    `De la vuelta anterior queda ${quedan} en ${a.mainRoot}. NO se ha tocado nada de eso: reabrir mueve el label, no el disco. Tienes dos caminos, y son excluyentes:`,
    `  (a) CORREGIR ENCIMA (lo normal tras un rechazo de revisión, y para lo que #${n} acaba de quedar en status:in-progress): sigue trabajando en ese mismo worktree y esa misma rama, sobre el PR que ya existe. NO invoques /ct-next para #${n}: se negaría a despachar precisamente porque el worktree/la rama ya existen. Cuando vuelvas a dejarlo listo, repite el --release.`,
    `  (b) EMPEZAR DE CERO: borra primero lo anterior (te llevas por delante el trabajo que hubiera, comprueba que está pusheado) y DESPUÉS devuélvelo a la cola, que es lo que hace que /ct-next vuelva a considerarlo:`,
    a.hasWorktree ? `      git -C ${a.mainRoot} worktree remove ${a.worktree}` : null,
    a.hasBranch ? `      git -C ${a.mainRoot} branch -D ${a.branch}` : null,
    `      ${requeueCmd}`,
  ].filter(Boolean).join('\n')
}

if (reopen) {
  // Precondición LEÍDA. En dry-run con fixture se usa el fixture; en dry-run
  // SIN fixture no hay estado que leer y no se muta nada, así que se admite
  // como ensayo del mensaje. `labelsOf` es la misma lectura que usa el paso
  // de colisión, y su fallo se clasifica igual: exit 3 (infraestructura, sin
  // mutación).
  let labels = null
  if (fx) {
    labels = fx.candLabels
  } else if (!dryRun) {
    try {
      labels = labelsOf(issue)
    } catch (e) {
      dieErr(`no se pudo leer el estado de #${issue} en ${repo}: ${e.message} — no se reabre nada sin haber comprobado que está en status:in-review.`, 3)
    }
  }
  // La precondición es que el estado sea EXACTAMENTE `status:in-review`, no
  // que in-review esté ENTRE sus labels. Hallazgo al atacar esta misma
  // implementación: con `labels.includes(...)`, un issue que arrastrara
  // `status:in-progress` Y `status:in-review` a la vez (una edición de label
  // que se quedó a medias — el caso que resolveStatus existe para sobrevivir)
  // pasaba la comprobación, y el `--add-label ready --remove-label in-review`
  // lo dejaba en `[status:in-progress, status:ready]`: exactamente el estado
  // ambiguo del que avisa el mensaje de abajo, creado por la herramienta que
  // existe para no crearlo. Verificado contra esa primera versión: exit 0 y
  // "reopened #9 → ready" sobre un issue con las dos labels.
  if (labels !== null) {
    const actuales = labels.filter((l) => l.startsWith('status:'))
    const soloInReview = actuales.length === 1 && actuales[0] === 'status:in-review'
    if (!soloInReview) {
      const enQue = actuales.length ? actuales.join(', ') : 'ninguna label status: (o sea, backlog)'
      const yaReady = actuales.length === 1 && actuales[0] === 'status:ready'
      const ambiguo = actuales.length > 1
      const yaInProgress = actuales.length === 1 && actuales[0] === 'status:in-progress'
      dieErr(
        yaReady
          ? `#${issue} ya está en status:ready — no hay nada que reabrir, /ct-next puede despacharlo tal cual. (No se ha tocado ninguna label.)`
          : ambiguo
            ? `#${issue} tiene DOS o más labels de estado a la vez (${enQue}) — probablemente una edición que se quedó a medias. No se ha tocado ninguna: reabrir desde aquí solo quitaría status:in-review y dejaría el resto puesto junto a status:in-progress, o sea el mismo lío con una label más. Arréglalo primero dejando UNA sola, y vuelve a intentarlo.`
            : yaInProgress
              ? `#${issue} ya está en status:in-progress — que es justo donde --reopen lo dejaría: en el banco de trabajo, reteniendo sus tokens. No hay nada que reabrir. (No se ha tocado ninguna label.) Si lo que querías era devolverlo a la cola para que /ct-next lo despache de cero, eso es --requeue, y exige que no quede nada del slice en esta máquina.`
              : `--reopen solo devuelve al banco de trabajo un slice en status:in-review, y #${issue} está en: ${enQue}. No se ha tocado ninguna label — añadir status:in-progress sin quitar el status: que ya tiene dejaría el issue con DOS estados a la vez, que es exactamente el estado ambiguo que el dispatcher tiene que adivinar después. Si de verdad quieres moverlo desde ${enQue}, hazlo a mano y a conciencia: gh issue edit ${issue} --repo ${repo} --add-label status:in-progress --remove-label <la que tenga>.`,
        2
      )
    }
  }
  if (!dryRun && !fx) {
    const result = setStatus(issue, 'status:in-review', 'status:in-progress')
    if (!result.ok) {
      dieErr(`no se pudo reabrir #${issue} a status:in-progress: ${result.error.message}. Sigue en status:in-review; reintenta el --reopen.`, 1)
    }
  }
  outLine(`reopened #${issue} → in-progress (rechazado en revisión: vuelve al banco de trabajo, y sigue reteniendo sus tokens de área/touches porque su trabajo sigue SIN MERGEAR)`)
  outLine(reopenDiskNote(issue))
  process.exit(0)
}

// ============================================================================
// --requeue (F15/H1) — LA OTRA MITAD DE LA ARISTA DE VUELTA.
//
// `--reopen` deja el slice en `in-progress` porque su trabajo sigue existiendo
// sin mergear. El camino contrario —"abandono este intento, que /ct-next lo
// despache de cero"— necesita `ready`, y `ready` solo es verdad cuando NO
// queda trabajo sin mergear de ese slice en ninguna parte. Eso no se puede
// suponer: se comprueba.
//
// QUÉ EXIGE, Y QUÉ NO PUEDE EXIGIR (dicho, no escondido):
//   - estado EXACTAMENTE `status:in-progress` (misma precondición leída que
//     --reopen, mismo trato para el caso ambiguo de dos labels);
//   - que en ESTA MÁQUINA no queden ni el worktree `.worktrees/<n>` ni la rama
//     `feat/<n>`. Si quedan, se niega: devolverlo a la cola soltaría sus
//     tokens mientras su trabajo sigue vivo, y encima /ct-next se negaría
//     igual a re-despacharlo por esos mismos artefactos;
//   - si NO SE PUDO MIRAR, se niega también. Es la diferencia entre `--reopen`
//     y este: allí la nota de disco es informativa y "no lo sé" se puede
//     decir; aquí la mutación ES una declaración de ausencia, y no se declara
//     ausente lo que no se ha podido mirar.
// Lo que NO puede comprobar, y por eso lo IMPRIME siempre en vez de dejarlo
// implícito: la rama en el REMOTO y el PR abierto. Un slice cuya rama sigue
// pusheada y cuyo PR sigue abierto tiene trabajo sin mergear aunque esta
// máquina esté limpia; ahí `ready` vuelve a mentir. Cerrar el PR es parte del
// abandono, y el mensaje lo dice con el comando.
// ============================================================================
if (requeue) {
  let labels = null
  if (fx) {
    labels = fx.candLabels
  } else if (!dryRun) {
    try {
      labels = labelsOf(issue)
    } catch (e) {
      dieErr(`no se pudo leer el estado de #${issue} en ${repo}: ${e.message} — no se devuelve nada a la cola sin haber comprobado que está en status:in-progress.`, 3)
    }
  }
  if (labels !== null) {
    const actuales = labels.filter((l) => l.startsWith('status:'))
    const soloInProgress = actuales.length === 1 && actuales[0] === 'status:in-progress'
    if (!soloInProgress) {
      const enQue = actuales.length ? actuales.join(', ') : 'ninguna label status: (o sea, backlog)'
      const yaReady = actuales.length === 1 && actuales[0] === 'status:ready'
      const ambiguo = actuales.length > 1
      const enReview = actuales.length === 1 && actuales[0] === 'status:in-review'
      dieErr(
        yaReady
          ? `#${issue} ya está en status:ready — no hay nada que devolver a la cola, /ct-next puede despacharlo tal cual. (No se ha tocado ninguna label.)`
          : ambiguo
            ? `#${issue} tiene DOS o más labels de estado a la vez (${enQue}) — probablemente una edición que se quedó a medias. No se ha tocado ninguna: arréglalo primero dejando UNA sola, y vuelve a intentarlo.`
            : enReview
              ? `#${issue} está en status:in-review: su PR sigue abierto sin mergear, así que devolverlo a la cola soltaría sus tokens mientras ese trabajo sigue vivo. No se ha tocado ninguna label. Si la revisión lo rechazó y vas a corregir encima, usa --reopen; si de verdad lo abandonas, cierra antes su PR y reabre primero con --reopen.`
              : `--requeue solo devuelve a la cola un slice en status:in-progress, y #${issue} está en: ${enQue}. No se ha tocado ninguna label — añadir status:ready sin quitar el status: que ya tiene dejaría el issue con DOS estados a la vez, que es exactamente el estado ambiguo que el dispatcher tiene que adivinar después.`,
        2
      )
    }
  }
  // La comprobación de disco va ANTES de mutar. Un --requeue que suelta los
  // tokens y LUEGO descubre que la rama sigue ahí ya ha abierto la ventana.
  const a = localSliceArtifacts(issue)
  if (!a.known) {
    dieErr(`no se ha podido comprobar si queda algo de #${issue} en esta máquina (no se pudo consultar git desde aquí), y --requeue DECLARA que no queda trabajo sin mergear de este slice. No se declara ausente lo que no se ha podido mirar: no se ha tocado ninguna label. Corre esto desde dentro del checkout del repo, o comprueba a mano que ni .worktrees/${issue} ni feat/${issue} existen y haz la edición tú.`, 2)
  }
  if (a.hasWorktree || a.hasBranch) {
    const quedan = [a.hasWorktree ? `el worktree ${a.worktree}` : null, a.hasBranch ? `la rama ${a.branch}` : null].filter(Boolean).join(' y ')
    dieErr([
      `#${issue} todavía tiene ${quedan} en ${a.mainRoot}: su trabajo sigue vivo sin mergear, así que devolverlo a status:ready soltaría sus tokens de área/touches y dejaría que un vecino se despachara sobre una base que no lo contiene. No se ha tocado ninguna label.`,
      `Si de verdad lo abandonas, bórralo primero (comprueba antes que no pierdes nada sin pushear) y repite:`,
      a.hasWorktree ? `      git -C ${a.mainRoot} worktree remove ${a.worktree}` : null,
      a.hasBranch ? `      git -C ${a.mainRoot} branch -D ${a.branch}` : null,
      `Si lo que quieres es seguir trabajándolo, no hace falta nada: status:in-progress ya es el estado correcto.`,
    ].filter(Boolean).join('\n'), 2)
  }
  if (!dryRun && !fx) {
    const result = setStatus(issue, 'status:in-progress', 'status:ready')
    if (!result.ok) {
      dieErr(`no se pudo devolver #${issue} a status:ready: ${result.error.message}. Sigue en status:in-progress; reintenta el --requeue.`, 1)
    }
  }
  outLine(`requeued #${issue} → ready (abandonado: suelta sus tokens y vuelve a ser despachable por /ct-next)`)
  outLine(`Comprobado que en ${a.mainRoot} no queda ni el worktree .worktrees/${issue} ni la rama feat/${issue}. Lo que NO se ha comprobado —y no se puede desde aquí— es el REMOTO: si feat/${issue} sigue pusheada o su PR sigue abierto, ese trabajo sigue sin mergear y #${issue} ya no lo está reteniendo. Cierra el PR (\`gh pr close --delete-branch\`) si de verdad lo abandonas.`)
  process.exit(0)
}

// 1) colisión previa. Ningún fallo aquí ha mutado nada todavía: abortar es
// seguro, no deja lock huérfano. Finding 4: exit 3 (fallo de lectura, no
// mutación, no colisión real) — antes exit 1, indistinguible por código de
// la COLLISION real de más abajo.
let candLabels, open
if (fx) {
  candLabels = fx.candLabels
  open = fx.openIssues
} else {
  try {
    candLabels = labelsOf(issue)
    open = allOpen().filter((i) => i.n !== issue)
  } catch (e) {
    dieErr(`no se pudo leer el estado de #${issue} en ${repo}: ${e.message}`, 3)
  }
}
const collisions = detectCollisions(candLabels, open)
if (collisions.length) {
  // Finding 4: exit 1 — 'skip', resultado NORMAL del protocolo (ninguna
  // mutación se llegó a escribir). Sin cambios de comportamiento.
  // F13/H2: el estado de cada colisionante viaja en el mensaje. Desde que
  // `in-review` también retiene tokens, "choca con #7" ya no implica que haya
  // un agente vivo en #7 — y el remedio es distinto (mergear el PR, no
  // esperar). Sin el estado, los dos casos son indistinguibles en la salida.
  const detalle = collisions.map((c) => `#${c.n}[${c.tokens.join(',')}${c.status ? ` ${c.status}` : ''}]`).join(' ')
  const hayReview = collisions.some((c) => c.status === 'status:in-review')
  const nota = hayReview
    ? ' — los marcados status:in-review tienen su trabajo entregado pero SIN MERGEAR: retienen sus tokens hasta el merge (ramificar ahora daría una base sin ese trabajo) y no hay ningún agente en ellos, así que esperar no sirve: mergea su PR, ciérralo como completed si el PR ya se mergeó, o reábrelo con --reopen si la revisión lo rechazó.'
    : ''
  dieErr(`COLLISION: #${issue} choca con ${detalle}${nota}`, 1)
}

// HOOK DE PRUEBA — CT_CLAIM_PRECLAIM_DELAY_MS.
//
// Qué hace: si está definida, inserta una espera síncrona justo DESPUÉS de
// que la comprobación de colisión (paso 1, arriba) haya pasado limpia, y
// ANTES de escribir el label de claim `status:in-progress` (paso 2, abajo).
// Ningún otro punto del script se ve afectado.
//
// Por qué existe: el AC6 original (T10) solo pudo observar la mitad
// falsificable de la garantía de exclusión mutua — `claimLost()` únicamente
// puede hacer perder al claimant de número MAYOR, así que el de número menor
// nunca pierde por construcción. Para ejercer de verdad la ventana de doble
// claim (T11) hace falta poder pausar un claimant justo entre su
// comprobación de colisión y su escritura, de forma determinista — sin este
// hook esa ventana depende del scheduler del SO y catorce rondas de
// `--settle-ms 0` no la alcanzaron ni una vez, lo cual es ausencia de
// evidencia, no evidencia de ausencia.
//
// Por qué es seguro que exista fuera de tests, sin atarlo a --dry-run como
// CT_CLAIM_FIXTURE: a diferencia del fixture (que sustituye datos reales por
// datos fabricados y por tanto SÍ podría hacer decidir con información
// falsa), este hook SOLO puede añadir una espera. No cambia qué se decide
// (colisión/no colisión, gana/pierde la carrera), no cambia qué se escribe
// en GitHub, no salta ningún paso ni reordena nada. Con la variable ausente
// (el caso de producción real, y el de todos los tests existentes que no la
// fijan) el valor es exactamente 0 y `sleepSync(0)` es un no-op — el camino
// de código es IDÉNTICO al de antes de este cambio. Que quede activa por
// accidente en producción degradaría latencia, nunca corrección.
//
// No hace falta un segundo hook simétrico entre la escritura y el readback
// para construir la interleaving del harness: basta con este hook aplicado
// SOLO al claimant de número menor (skew grande) y ninguno en el de número
// mayor — mientras el skew supere el ciclo completo (escritura + readback)
// del mayor, el mayor completa su decisión antes de que el menor escriba en
// absoluto. (Existió una versión anterior de este comentario que apuntaba a
// --settle-ms/CT_CLAIM_SETTLE_MS como ese segundo control; esa mitigación se
// retiró en T11 fix round 2 por no poder demostrarse que aportaba nada — ver
// el comentario más arriba, junto a `sleepSync`.)
//
// Colocación (fix round 1, T11 review): esta validación vive AQUÍ, después
// del `if (release) { ...; process.exit(0) }` de arriba, a propósito — no
// junto a la definición de `sleepSync`. Un `--release` no pasa nunca por
// este punto del script, así que un CT_CLAIM_PRECLAIM_DELAY_MS malformado
// (p.ej. dejado colgado en el entorno por una sesión de pruebas anterior)
// nunca puede bloquear un `--release` con exit 2 y dejar un issue atascado
// en `status:in-progress` — el único efecto posible de una variable de
// entorno cuyo propósito es "solo esperar" sería justo ese, si viviera antes
// del guard de `release`.
//
// Tope superior (60000ms = 1 minuto): sin él, un valor como "1e12" (~31
// años) se acepta como "número >= 0" válido y es indistinguible en la
// práctica de un cuelgue — el harness que usa este hook nunca necesita más
// de unos pocos segundos de skew, así que un valor por encima del tope es,
// con altísima probabilidad, un error de quien lo invoca, no una necesidad
// real.
const PRECLAIM_DELAY_CAP_MS = 60_000
let preclaimDelayMs = 0
const preclaimRaw = process.env.CT_CLAIM_PRECLAIM_DELAY_MS
if (preclaimRaw !== undefined) {
  const n = Number(preclaimRaw)
  if (!Number.isFinite(n) || n < 0 || n > PRECLAIM_DELAY_CAP_MS) {
    dieErr(`CT_CLAIM_PRECLAIM_DELAY_MS inválido: "${preclaimRaw}" — debe ser un número entre 0 y ${PRECLAIM_DELAY_CAP_MS}`, 2)
  }
  preclaimDelayMs = n
}
if (!dryRun && !fx) sleepSync(preclaimDelayMs)

// 2) claim. Finding 4: exit 3 — fallo de infraestructura, ninguna mutación
// llegó a persistir (el intento de escritura falló, el issue sigue en
// status:ready). Antes exit 1, indistinguible de una COLLISION real.
if (!dryRun && !fx) {
  const result = setStatus(issue, 'status:ready', 'status:in-progress')
  if (!result.ok) {
    dieErr(`no se pudo escribir el claim de #${issue}: ${result.error.message}`, 3)
  }
}

// 3) claim-then-verify (re-lee — nunca el índice de búsqueda — y desempata por número menor)
let readback
if (fx) {
  readback = fx.readback
} else {
  try {
    readback = allOpen()
  } catch (e) {
    // Ya escribimos el claim en el paso 2: si ahora no podemos releer, no
    // sabemos si ganamos la carrera. Dejar el label puesto sería un lock
    // huérfano silencioso, así que intentamos revertir antes de salir con
    // error — y lo decimos distinto de una carrera perdida normal, porque un
    // humano necesita saber que esto es un fallo de infraestructura, no un
    // desempate. Finding 4: el exit code final depende de si ESE revert
    // tuvo éxito (3 — infra, sin mutación persistente) o falló (4 —
    // huérfano de verdad, exige intervención humana).
    errLine(`no se pudo re-leer el estado tras el claim de #${issue}: ${e.message} — no se puede confirmar la carrera`)
    let revertOk = true
    if (!dryRun) {
      const result = setStatus(issue, 'status:in-progress', 'status:ready')
      if (result.ok) {
        errLine(`#${issue} revertido a status:ready (carrera no confirmada)`)
      } else {
        revertOk = false
        errLine(`ATENCIÓN: #${issue} puede haber quedado bloqueado en status:in-progress (no se pudo revertir: ${result.error.message}). Libéralo a mano con: ${manualReleaseHint()}`)
      }
    }
    process.exit(revertOk ? 3 : 4)
  }
}

if (claimLost(readback, issue)) {
  errLine(`carrera perdida: #${issue} liberado (otro claim menor con token compartido ganó)`) // lost
  // Finding 4: 'skip' (exit 1) si el revert tuvo éxito — carrera perdida
  // LIMPIA, resultado normal del protocolo (ninguna mutación persiste).
  // 'stuck' (exit 4) si el revert TAMBIÉN falló — huérfano de verdad.
  let revertOk = true
  if (!dryRun && !fx) {
    const result = setStatus(issue, 'status:in-progress', 'status:ready')
    if (!result.ok) {
      revertOk = false
      errLine(`ATENCIÓN: no se pudo revertir el claim de #${issue} tras perder la carrera (${result.error.message}). Queda bloqueado en status:in-progress — libéralo a mano con: ${manualReleaseHint()}`)
    }
  }
  process.exit(revertOk ? 1 : 4)
}
dieOut(`claimed #${issue} → in-progress`, 0)
