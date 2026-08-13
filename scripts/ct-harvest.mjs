#!/usr/bin/env node
// /ct-harvest — QUÉ PREGUNTA RESPONDE: «¿cuánto costó cada slice de este epic,
// según lo que GitHub ya escribió solo?». Emite una fila por slice con las
// variables dependientes del pre-registro (§6 del handoff F32): ready→claim,
// claim→release, release→merge, reopens, requeues, episodios blocked, tamaño
// del PR y comentarios de review.
//
// SE COSECHA, NO SE CAPTURA. Cero campos manuales. Ni uno. El único dato a mano
// de toda la medida —los minutos de intervención humana— vive en el desenlace
// del epic y NO se le pide aquí: en cuanto un cosechador admite un campo
// manual se convierte en un formulario, y un formulario es exactamente cómo
// murió docs/medicion-slices.md (2 filas, la columna clave en «no medido»).
//
// SE ESCRIBIÓ DESPUÉS DEL DESPACHO 1, a propósito y por orden del handoff. Las
// tres decisiones de scripts/harvest.js salen de haber cosechado a mano el
// epic #602 de menoplus (2026-08-12/13); ninguna se dedujo antes de tener
// datos delante. Lo que este comando automatiza es un trabajo que ya se hizo
// una vez con las manos, no un trabajo que se imagina.
//
// NO MUTA NADA. Ni labels, ni issues, ni PRs: solo lee. Igual que /ct-status, y
// atado por el mismo tipo de test sobre el argv real con el que se llama a
// `gh` — no por la mera ausencia de errores.
//
// EL 1 NUNCA SE DEGRADA A 0, la misma regla dura que /ct-status y /ct-groom:
// 0 = cosecha completa, 1 = no se pudo completar alguna lectura. Una cosecha
// parcial NO es un epic barato, y quien reciba la señal tiene que poder
// distinguirlas: una tabla con huecos que se lea como «este slice no tuvo
// review» cuando lo que pasó es que la lectura falló sería un dato inventado
// entrando por la puerta de atrás en un pre-registro que prohíbe justamente eso.
import { execFileSync } from 'node:child_process'
import { harvestSlice, formatDuration, closingPrNumbers } from './harvest.js'
import { parseRepoSlug } from './dispatch.js'

// `arg()` endurecido: el MISMO de ct-next.mjs/ct-groom.mjs/ct-status.mjs,
// palabra por palabra y por el mismo motivo medido — un flag colgante no puede
// colar el siguiente flag como su valor.
const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}

const usage = 'uso: ct-harvest.mjs --repo <owner/repo> --milestone <título> [--json]'

const repo = arg('--repo')
if (repo === true) { console.error(`--repo inválido: "(sin valor)" — ${usage}`); process.exit(2) }
if (typeof repo !== 'string' || repo.length === 0) { console.error(usage); process.exit(2) }
if (!parseRepoSlug(repo)) {
  console.error(`--repo inválido: "${repo}" — debe tener la forma owner/repo (p.ej. josemerca/control-tower), con exactamente una barra y ambas mitades no vacías.`)
  process.exit(2)
}

const milestone = arg('--milestone')
if (milestone === true) { console.error(`--milestone inválido: "(sin valor)" — ${usage}`); process.exit(2) }
if (typeof milestone !== 'string' || milestone.length === 0) { console.error(usage); process.exit(2) }

const comoJson = process.argv.includes('--json')

const GH_MAX_BUFFER = 20 * 1024 * 1024
const CHILD_TIMEOUT_MS = 10 * 60 * 1000

const gh = (a) => {
  try {
    return execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: GH_MAX_BUFFER, timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' })
  } catch (e) {
    const detalle = (e && e.stderr ? String(e.stderr).trim() : '') || (e && e.message) || 'error desconocido'
    throw new Error(detalle)
  }
}

// motivos: todo lo que NO se pudo cosechar. Es lo único que decide el exit 1.
const motivos = []

// Los issues del epic, abiertos Y cerrados. Vía GraphQL de `gh issue list`
// porque necesitamos filtrar por milestone y traer `closedAt`, que el endpoint
// REST no expone con ese nombre.
//
// SIN `--limit` acotado a un número pequeño: ese endpoint devuelve más nuevo
// primero, así que un tope bajo deja fuera justo los slices VIEJOS — los
// primeros del epic, que son los que más interesa medir. Es el mismo error que
// ya costó un informe falso en este repo (ver la cabecera de ct-status.mjs).
let issues = []
try {
  issues = JSON.parse(gh([
    'issue', 'list', '--repo', repo, '--milestone', milestone, '--state', 'all',
    '--limit', '1000',
    // closedByPullRequestsReferences: es GitHub quien dice qué PR cerró cada
    // issue. Deducirlo del timeline ya produjo una tabla verde y equivocada
    // (ver closingPrNumbers en harvest.js).
    '--json', 'number,title,state,closedAt,labels,milestone,closedByPullRequestsReferences',
  ]))
} catch (e) {
  motivos.push(`no se pudieron listar los issues del milestone "${milestone}" en ${repo}: ${e.message}`)
}

// El timeline de un issue: la fuente de TODAS las transiciones. Pagina siempre
// —un epic largo con muchos movimientos de label pasa de una página sin avisar,
// y una página perdida no da error: da un slice que parece no haber sido nunca
// reclamado.
function timelineDe(n) {
  return JSON.parse(gh(['api', `repos/${repo}/issues/${n}/timeline`, '--paginate', '--slurp']))
    // `--slurp` devuelve un array de páginas (arrays); aplanarlo aquí evita que
    // la capa pura tenga que saber nada de paginación.
    .flat()
}

// Los datos del PR que cerró el issue. QUIÉN es ese PR no se deduce aquí: lo
// dice GitHub (closingPrNumbers, harvest.js). Este trozo solo va a buscar sus
// números.
function datosDelPr(n) {
  const pr = JSON.parse(gh(['pr', 'view', String(n), '--repo', repo, '--json', 'number,mergedAt,additions,deletions,changedFiles,reviews,comments']))
  return {
    number: pr.number,
    mergedAt: pr.mergedAt,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    reviews: (pr.reviews || []).length,
    reviewComments: (pr.comments || []).length,
  }
}

const filas = []
for (const issue of issues) {
  let eventos
  try {
    eventos = timelineDe(issue.number)
  } catch (e) {
    // Un timeline que no se pudo leer NO produce una fila con ceros: produce un
    // motivo y ninguna fila. Una fila de ceros aquí sería un slice inventado.
    motivos.push(`no se pudo leer el timeline del issue #${issue.number}: ${e.message}`)
    continue
  }
  let pr = null
  const cerradores = closingPrNumbers(issue, repo)
  // Dos PRs cerrando el mismo issue es raro: se dice en voz alta y se cosecha
  // el primero, en vez de elegir en silencio y perder el hallazgo.
  if (cerradores.length > 1) {
    motivos.push(`el issue #${issue.number} lo cierran ${cerradores.length} PRs (${cerradores.map((n) => `#${n}`).join(', ')}); la fila cosecha solo el #${cerradores[0]}`)
  }
  if (cerradores.length) {
    try {
      pr = datosDelPr(cerradores[0])
    } catch (e) {
      motivos.push(`no se pudieron leer los datos del PR #${cerradores[0]} (issue #${issue.number}): ${e.message}`)
    }
  }
  filas.push(harvestSlice({ events: eventos, issue, pr }))
}

filas.sort((a, b) => (a.issue ?? 0) - (b.issue ?? 0))

if (comoJson) {
  console.log(JSON.stringify({ repo, milestone, filas, motivos }, null, 2))
} else {
  console.log(`# Cosecha — ${milestone}`)
  console.log(`# repo: ${repo} · slices: ${filas.length}`)
  console.log('')
  console.log('| Issue | Slice | Tipo | Gate | ready→claim | claim→release | release→merge | reopens | requeues | blocked | PR |')
  console.log('|---|---|---|---|---|---|---|---|---|---|---|')
  for (const f of filas) {
    // El `*` marca que release→merge se midió contra el CIERRE DEL ISSUE y no
    // contra el merge de un PR. Se marca en la propia celda, no en una nota al
    // pie: una nota al pie no viaja cuando alguien copia la tabla.
    const marca = f.mergeSource === 'issue-closed' ? '*' : ''
    const pr = f.pr ? `#${f.pr} +${f.additions}/−${f.deletions} ${f.changedFiles}f` : '—'
    console.log(`| #${f.issue} | ${f.title ?? '—'} | ${f.type ?? '—'} | ${f.gate ?? '—'} | ${formatDuration(f.readyToClaim)} | ${formatDuration(f.claimToRelease)} | ${formatDuration(f.releaseToMerge)}${marca} | ${f.reopens} | ${f.requeues} | ${f.blocked.length} | ${pr} |`)
  }
  console.log('')
  // Se reporta POR FAMILIA (`Tipo`), nunca agregado — regla de honestidad del
  // §6, tomada de la lección del FDR 0,08–0,31 de POSTCONDBENCH. Y con la N de
  // cada familia a la vista: una familia de 1 no es una media, y quien lea esto
  // tiene que verlo sin preguntar.
  const familias = new Map()
  for (const f of filas) {
    const k = f.type ?? '(sin type:)'
    if (!familias.has(k)) familias.set(k, [])
    familias.get(k).push(f)
  }
  console.log('## Por familia (Tipo) — nunca agregado')
  for (const [tipo, fs] of familias) {
    const medibles = fs.filter((f) => f.claimToRelease !== null)
    const media = medibles.length ? Math.round(medibles.reduce((a, f) => a + f.claimToRelease, 0) / medibles.length) : null
    const aviso = fs.length < 3 ? '  ← N insuficiente: describe, no promedia' : ''
    console.log(`- **${tipo}** · N=${fs.length} · claim→release ${formatDuration(media)}${aviso}`)
  }
  if (filas.some((f) => f.mergeSource === 'issue-closed')) {
    console.log('')
    console.log('`*` release→merge medido contra el cierre del issue, no contra el merge de un PR.')
  }
}

if (motivos.length) {
  console.error('')
  console.error(`${motivos.length} lectura(s) sin completar — la cosecha está INCOMPLETA:`)
  for (const m of motivos) console.error(`  - ${m}`)
  process.exit(1)
}
process.exit(0)
