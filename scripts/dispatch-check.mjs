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
import { writeSync } from 'node:fs'
import { detectCollisions, claimLost } from './claim.js'
import { flattenIssuePages, realIssuesOnly } from './gh-issues.js'

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
// El texto que este fichero imprime NO cambia de contenido (los mismos
// detalles, incluido el comando manual de `--release`/revert) — solo deja
// de ser la ÚNICA fuente de verdad para la decisión del caller.
// ============================================================================
function errLine(msg) { writeSync(2, msg + '\n') }
function outLine(msg) { writeSync(1, msg + '\n') }
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
const issue = parseInt(process.argv[2], 10)
const repo = arg('--repo')
const release = has('--release')
const dryRun = has('--dry-run')
const usage = 'uso: dispatch-check.mjs <issue#> --repo <o/r> [--release] [--dry-run]'
if (Number.isNaN(issue) || typeof repo !== 'string' || repo.length === 0) { dieErr(usage, 2) }

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
const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: GH_MAX_BUFFER })
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

if (release) {
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
  dieErr(`COLLISION: #${issue} choca con ${collisions.map((c) => `#${c.n}[${c.tokens.join(',')}]`).join(' ')}`, 1)
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
