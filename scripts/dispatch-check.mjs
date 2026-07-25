#!/usr/bin/env node
// ADVERTENCIA HONESTA (T11, fix round 2 — decisión de José): el claim por
// labels de este script NO tiene compare-and-swap. `claimLost()`
// (scripts/claim.js) solo puede hacer perder al claimant de número MAYOR —
// el de número menor nunca pierde por construcción — así que si dos
// dispatchers concurrentes pasan su comprobación de colisión antes de que
// cualquiera de los dos haya escrito, PUEDEN QUEDAR AMBOS reclamando el
// mismo token compartido. Esto no es hipotético: está reproducido de forma
// determinista en 6/6 rondas con el harness adversarial
// (scripts/experiments/ac6-race2-deterministic.sh), verificado contra el
// estado real de los labels en GitHub, no solo por exit code — ver
// task-11-report.md. La mitigación real HOY, mientras el claim siga viviendo
// en labels, es operativa, no de código: NO lanzar dos dispatchers a la vez
// sobre el mismo repo. Este script no puede garantizar exclusión mutua bajo
// concurrencia real; que quede dicho aquí sin adornos para que quien lo lea
// sepa exactamente qué garantía tiene (ninguna) y no confíe de más en el
// resultado de un exit 0. El plan es migrar el lock a una primitiva atómica
// real (test-and-set vía `git refs`, ya validado en el experimento CAS de T9)
// — hasta que eso aterrice, esta es la garantía real: ninguna bajo
// concurrencia, sí bajo uso secuencial disciplinado.
import { execFileSync } from 'node:child_process'
import { detectCollisions, claimLost } from './claim.js'
import { flattenIssuePages, realIssuesOnly } from './gh-issues.js'

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
if (Number.isNaN(issue) || typeof repo !== 'string' || repo.length === 0) { console.error(usage); process.exit(2) }

// NO HAY ESPERA DE ASENTAMIENTO ("settle wait") EN ESTE SCRIPT — se eliminó a
// propósito (T11, fix round 2). Existió una versión anterior con
// --settle-ms/CT_CLAIM_SETTLE_MS (una espera entre escribir el claim y
// releerlo, con 2000ms de default), vendida como mitigación de la ventana de
// doble claim. Se retiró porque una ventana temporal no CIERRA una condición
// de carrera, solo reduce su probabilidad — y el harness adversarial de T11
// (scripts/experiments/ac6-race2-deterministic.sh) barrió tres valores de
// skew (500, 3000 y 8000ms) contra settle=0 y settle=2000 sin conseguir medir
// que el settle aportara nada: en los tres puntos medidos, ambos valores de
// settle dieron el mismo resultado (ver task-11-report.md §5 para el barrido
// completo y por qué el muestreo era demasiado grueso para resolver un
// posible efecto de ~2s enmascarado por la propia latencia de red de GitHub,
// que en el experimento CAS de T9 se midió entre 650 y 1900ms por request).
// Un mecanismo de protección que no se puede demostrar que protege, con el
// coste que este equipo estaba dispuesto a pagar en medirlo, es peor que no
// tenerlo: invita a confiar en él. La garantía real hoy está en el
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
  console.error('CT_CLAIM_FIXTURE está definido pero falta --dry-run: por seguridad no se decide ni se muta gh real con datos de fixture. Añade --dry-run o limpia la variable de entorno.')
  process.exit(2)
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

if (release) {
  if (!dryRun && !fx) {
    try {
      gh(['issue', 'edit', String(issue), '--repo', repo, '--add-label', 'status:in-review', '--remove-label', 'status:in-progress'])
    } catch (e) {
      console.error(`no se pudo liberar #${issue} a in-review: ${e.message}. Sigue en status:in-progress; reintenta el --release.`)
      process.exit(1)
    }
  }
  console.log(`released #${issue} → in-review`); process.exit(0)
}

// 1) colisión previa. Ningún fallo aquí ha mutado nada todavía: abortar es
// seguro, no deja lock huérfano.
let candLabels, open
if (fx) {
  candLabels = fx.candLabels
  open = fx.openIssues
} else {
  try {
    candLabels = labelsOf(issue)
    open = allOpen().filter((i) => i.n !== issue)
  } catch (e) {
    console.error(`no se pudo leer el estado de #${issue} en ${repo}: ${e.message}`)
    process.exit(1)
  }
}
const collisions = detectCollisions(candLabels, open)
if (collisions.length) {
  console.error(`COLLISION: #${issue} choca con ${collisions.map((c) => `#${c.n}[${c.tokens.join(',')}]`).join(' ')}`)
  process.exit(1)
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
    console.error(`CT_CLAIM_PRECLAIM_DELAY_MS inválido: "${preclaimRaw}" — debe ser un número entre 0 y ${PRECLAIM_DELAY_CAP_MS}`)
    process.exit(2)
  }
  preclaimDelayMs = n
}
if (!dryRun && !fx) sleepSync(preclaimDelayMs)

// 2) claim
if (!dryRun && !fx) {
  try {
    gh(['issue', 'edit', String(issue), '--repo', repo, '--add-label', 'status:in-progress', '--remove-label', 'status:ready'])
  } catch (e) {
    console.error(`no se pudo escribir el claim de #${issue}: ${e.message}`)
    process.exit(1)
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
    // desempate.
    console.error(`no se pudo re-leer el estado tras el claim de #${issue}: ${e.message} — no se puede confirmar la carrera`)
    if (!dryRun) {
      try {
        gh(['issue', 'edit', String(issue), '--repo', repo, '--add-label', 'status:ready', '--remove-label', 'status:in-progress'])
        console.error(`#${issue} revertido a status:ready (carrera no confirmada)`)
      } catch (e2) {
        console.error(`ATENCIÓN: #${issue} puede haber quedado bloqueado en status:in-progress (no se pudo revertir: ${e2.message}). Libéralo a mano con: ${manualReleaseHint()}`)
      }
    }
    process.exit(1)
  }
}

if (claimLost(readback, issue)) {
  console.error(`carrera perdida: #${issue} liberado (otro claim menor con token compartido ganó)`) // lost
  if (!dryRun && !fx) {
    try {
      gh(['issue', 'edit', String(issue), '--repo', repo, '--add-label', 'status:ready', '--remove-label', 'status:in-progress'])
    } catch (e) {
      console.error(`ATENCIÓN: no se pudo revertir el claim de #${issue} tras perder la carrera (${e.message}). Queda bloqueado en status:in-progress — libéralo a mano con: ${manualReleaseHint()}`)
    }
  }
  process.exit(1)
}
console.log(`claimed #${issue} → in-progress`)
process.exit(0)
