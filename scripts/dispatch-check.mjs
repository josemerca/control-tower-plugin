#!/usr/bin/env node
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
const usage = 'uso: dispatch-check.mjs <issue#> --repo <o/r> [--release] [--dry-run] [--settle-ms <n>]'
if (Number.isNaN(issue) || typeof repo !== 'string' || repo.length === 0) { console.error(usage); process.exit(2) }

// Ventana de asentamiento antes del readback, tras nuestra propia escritura de
// label. `claimLost` solo puede hacer perder al claimant de número MAYOR (busca
// un in-progress de número MENOR con token compartido) — por construcción, el
// de número menor nunca pierde. Así que toda la garantía de exclusión mutua
// depende de que el readback del claimant mayor observe la escritura del
// claimant menor. Si ambos reclaman casi al mismo instante y ambos leen de
// inmediato, el mayor podría leer ANTES de que la escritura del otro se
// propague, concluir que ganó, y los dos arrancarían — esta es exactamente la
// ventana de condición de carrera que ejercita el AC6 de T10, no una
// corazonada. Config: --settle-ms > CT_CLAIM_SETTLE_MS > este default.
const DEFAULT_SETTLE_MS = 2000
const settleArg = arg('--settle-ms')
let settleRaw
if (settleArg === undefined) {
  settleRaw = process.env.CT_CLAIM_SETTLE_MS ?? String(DEFAULT_SETTLE_MS)
} else if (typeof settleArg === 'string' && settleArg.length > 0) {
  settleRaw = settleArg
} else {
  console.error('--settle-ms requiere un valor numérico (recibido flag sin valor)')
  process.exit(2)
}
const settleMs = Number(settleRaw)
// Un valor malformado ("2000ms", vacío, etc.) da NaN. Fallar en silencio y
// simplemente saltarse la espera desactivaría en callado justo la protección
// que es el entregable central de esta task, así que fallamos ruidosamente.
// 0 explícito sigue siendo válido (usado por tests para desactivar la espera
// a propósito, de forma visible en el comando).
if (!Number.isFinite(settleMs) || settleMs < 0) {
  console.error(`--settle-ms/CT_CLAIM_SETTLE_MS inválido: "${settleRaw}" — debe ser un número >= 0`)
  process.exit(2)
}

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
// sigue siendo enteramente client-side en `claim.js`.
const allOpen = () => realIssuesOnly(flattenIssuePages(JSON.parse(
  gh(['api', `repos/${repo}/issues`, '--method', 'GET', '-f', 'state=open', '--paginate', '--slurp']))))
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

// 2) claim
if (!dryRun && !fx) {
  try {
    gh(['issue', 'edit', String(issue), '--repo', repo, '--add-label', 'status:in-progress', '--remove-label', 'status:ready'])
  } catch (e) {
    console.error(`no se pudo escribir el claim de #${issue}: ${e.message}`)
    process.exit(1)
  }
}

// 2b) asentamiento — solo en la ruta real. Nunca en --dry-run ni con fixture:
// ambas rutas son de decisión pura sin red y deben quedarse rápidas y
// determinísticas para los tests.
if (!dryRun && !fx) sleepSync(settleMs)

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
