#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { detectCollisions, claimLost } from './claim.js'

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? (process.argv[i + 1] ?? true) : d }
const has = (f) => process.argv.includes(f)
const issue = parseInt(process.argv[2], 10)
const repo = arg('--repo')
const release = has('--release')
const dryRun = has('--dry-run')
if (Number.isNaN(issue) || !repo) { console.error('uso: dispatch-check.mjs <issue#> --repo <o/r> [--release] [--dry-run] [--settle-ms <n>]'); process.exit(2) }

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
const settleMs = Number(settleArg ?? process.env.CT_CLAIM_SETTLE_MS ?? DEFAULT_SETTLE_MS)

// Sleep síncrono y bloqueante (sin async/await, para no reestructurar todo el
// script en promesas): Atomics.wait sobre un buffer compartido es la forma
// estándar de bloquear el hilo principal de Node un intervalo fijo.
function sleepSync(ms) {
  if (!(ms > 0)) return
  const sab = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(sab, 0, 0, ms)
}

const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
const labelsOf = (n) => JSON.parse(gh(['issue', 'view', String(n), '--repo', repo, '--json', 'labels', '-q', '[.labels[].name]']))
// Listado directo de issues abiertos vía `gh issue list` — NUNCA el índice de
// búsqueda (`--search` / `gh search issues`), que tiene latencia de indexado y
// podría no reflejar todavía el label recién escrito por otro runner. Solo se
// filtra por `--state open` (estado, no label); toda la lógica de colisión y
// desempate sigue siendo enteramente client-side en `claim.js`.
const allOpen = () => JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'open', '--limit', '200', '--json', 'number,labels']))
  .map((i) => ({ n: i.number, labels: i.labels.map((l) => l.name) }))

const fx = process.env.CT_CLAIM_FIXTURE ? JSON.parse(process.env.CT_CLAIM_FIXTURE) : null

if (release) {
  if (!dryRun) gh(['issue', 'edit', String(issue), '--repo', repo, '--add-label', 'status:in-review', '--remove-label', 'status:in-progress'])
  console.log(`released #${issue} → in-review`); process.exit(0)
}

// 1) colisión previa
const candLabels = fx ? fx.candLabels : labelsOf(issue)
const open = fx ? fx.openIssues : allOpen().filter((i) => i.n !== issue)
const collisions = detectCollisions(candLabels, open)
if (collisions.length) {
  console.error(`COLLISION: #${issue} choca con ${collisions.map((c) => `#${c.n}[${c.tokens.join(',')}]`).join(' ')}`)
  process.exit(1)
}
// 2) claim
if (!dryRun) gh(['issue', 'edit', String(issue), '--repo', repo, '--add-label', 'status:in-progress', '--remove-label', 'status:ready'])
// 2b) asentamiento — solo en la ruta real. Nunca en --dry-run ni con fixture:
// ambas rutas son de decisión pura sin red y deben quedarse rápidas y
// determinísticas para los tests.
if (!dryRun && !fx) sleepSync(settleMs)
// 3) claim-then-verify (re-lee — nunca el índice de búsqueda — y desempata por número menor)
const readback = fx ? fx.readback : allOpen()
if (claimLost(readback, issue)) {
  if (!dryRun) gh(['issue', 'edit', String(issue), '--repo', repo, '--add-label', 'status:ready', '--remove-label', 'status:in-progress'])
  console.error(`carrera perdida: #${issue} liberado (otro claim menor con token compartido ganó)`) // lost
  process.exit(1)
}
console.log(`claimed #${issue} → in-progress`)
process.exit(0)
