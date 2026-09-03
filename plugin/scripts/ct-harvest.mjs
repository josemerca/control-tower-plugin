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
//
// LEE ADEMÁS LA TELEMETRÍA DEL JUEZ que la propia slice dejó commiteada en
// docs/superpowers/metrics/issue-<n>.jsonl. Desde 1422c67 cada veredicto emite
// `rubric_sin_vara` (cuántos ítems de la rúbrica se recorrieron sin el insumo
// con el que medirlos) y `findings_by_rule`, y hasta ahora NO LOS LEÍA NADIE:
// la columna existía en disco y la pregunta que motivó todo aquello —«¿está
// llegando la vara?»— se contestaba abriendo ficheros jsonl a mano (§3.4 del
// handoff docs/prompt-juez-lo-que-queda.md).
//
// Se lee de GitHub y no del disco, como todo lo demás de este comando: no hay
// checkout que suponer, y un directorio ausente en el cwd equivocado saldría
// como «cero sin-vara», que es el cero inventado que este fichero prohíbe.
//
// Y LAS DOS LECTURAS TIENEN DISTINTO PESO. El LISTADO del directorio que falla
// NO baja el exit a 1: la causa casi siempre es que ese repo no tiene
// telemetría (todo epic anterior a 1422c67), y un exit 1 permanente en esos
// epics enseña a ignorar el exit code, que es justo la señal que la regla «el 1
// nunca se degrada a 0» protege. Lo que se paga a cambio es no imprimir NI UN
// NÚMERO en ese caso y decir en voz alta que no se sabe. Un FICHERO que el
// listado sí nombraba y no se pudo leer, en cambio, es una cosecha incompleta
// de verdad: motivo y exit 1.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { harvestSlice, formatDuration, closingPrNumbers } from './harvest.js'
import { parseRepoSlug } from './dispatch.js'
import { aggregateVerdictMeasures, aggregateBriefMeasures, METRICS_REPO_DIR, metricsRepoRelPath } from './run-metrics.js'
import { BigQueryLoad, BigQueryTable, LoadOutcome } from './bigquery-load.js'
import { HarvestIdentity, HarvestTable } from './harvest-table.js'

// `arg()` endurecido: el MISMO de ct-next.mjs/ct-groom.mjs/ct-status.mjs,
// palabra por palabra y por el mismo motivo medido — un flag colgante no puede
// colar el siguiente flag como su valor.
const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}

const usage = 'uso: ct-harvest.mjs --repo <owner/repo> --milestone <título> [--json] [--bq <proyecto:dataset.tabla>]'

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

const bqArg = arg('--bq', null)
if (bqArg === true) { console.error(`--bq inválido: "(sin valor)" — ${usage}`); process.exit(2) }
const bqTable = bqArg === null ? null : BigQueryTable.parse(bqArg)
if (bqArg !== null && !bqTable) {
  console.error(`--bq inválido: "${bqArg}" — debe tener la forma proyecto:dataset.tabla (p.ej. mi-proyecto:control_tower.harvest).`)
  process.exit(2)
}

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

// `bqRunner`: calcado de `localRunner` en dispatch-check.mjs. El adaptador
// (BigQueryLoad) recibe el runner con el tope YA puesto — no elige él el
// timeout, lo elige quien lo construye aquí.
const bqRunner = (a) => {
  try {
    return { code: 0, stdout: execFileSync('bq', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' }), stderr: '' }
  } catch (e) {
    return { code: e.status ?? 1, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  }
}

// La versión del plugin que hizo esta cosecha, para poder comparar dos runs
// del propio loop (ver run-metrics.js, mismo argumento con `plugin_version`).
// `null` si el manifiesto no se pudo leer: nunca una versión inventada.
function versionDelPlugin() {
  try {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version ?? null
  } catch {
    return null
  }
}
const PLUGIN_VERSION = versionDelPlugin()

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

// El listado del directorio: UNA llamada que decide qué hay. La ausencia de un
// fichero se deduce de un listado que sí se leyó, nunca de interpretar el
// stderr de un 404 — este repo no parsea códigos HTTP en ningún sitio y no
// empieza aquí.
//
// Los issue-N.jsonl que no son de este milestone se ignoran sin decir nada: el
// directorio acumula TODOS los epics del repo y nombrarlos sería ruido en cada
// cosecha. (La API de contenidos lista hasta 1000 entradas por directorio; por
// encima de eso un slice con fichero se leería como «sin telemetría». Está
// dicho aquí y no resuelto: mil slices en un repo están muy lejos.)
let dirTelemetria = { status: 'ok', why: null }
const ficherosTelemetria = new Set()
try {
  const entradas = JSON.parse(gh(['api', `repos/${repo}/contents/${METRICS_REPO_DIR}`]))
  if (!Array.isArray(entradas)) throw new Error('la respuesta no es un listado de directorio')
  for (const e of entradas) if (e && e.type === 'file' && typeof e.name === 'string') ficherosTelemetria.add(e.name)
} catch (e) {
  dirTelemetria = { status: 'no-leido', why: e.message }
}

// Enum CERRADO, por el mismo motivo que RUBRIC_OUTCOMES: `sin-fichero` (nadie
// midió) y `no-leido` (no se sabe) no son la misma cosa y ninguna de las dos es
// un cero.
const SIN_CUENTAS = {
  rows: null, malformed: null, verdicts: null, measured: null, legacy: null, rubricSinVara: null, findingsByRule: null,
  measuredVaraCtDocs: null, legacyVaraCtDocs: null, varaCtDocs: null,
  measuredFindingsVaraCt: null, legacyFindingsVaraCt: null, findingsVaraCt: null,
  // Los del agregador HERMANO (aggregateBriefMeasures, run-metrics.js): si la
  // vara de ct llegó al brief del paso `implement`, y cuánto pesó. Nombres
  // propios (`brief*`) y no `measured`/`legacy` a secas: ya están ocupados por
  // los de arriba, y fundirlos confundiría dos medidas con fechas de
  // nacimiento distintas en la telemetría.
  briefAttempts: null, briefMeasured: null, briefLegacy: null, briefVaraCtDocs: null, briefBytes: null,
}

function telemetriaDe(n) {
  if (dirTelemetria.status === 'no-leido' || n === null || n === undefined) {
    return { status: dirTelemetria.status === 'no-leido' ? 'no-leido' : 'sin-fichero', path: null, ...SIN_CUENTAS }
  }
  const rel = metricsRepoRelPath(n)
  if (!ficherosTelemetria.has(rel.slice(METRICS_REPO_DIR.length + 1))) {
    return { status: 'sin-fichero', path: null, ...SIN_CUENTAS }
  }
  try {
    const texto = gh(['api', `repos/${repo}/contents/${rel}`, '-H', 'Accept: application/vnd.github.raw'])
    // Los dos agregadores leen el MISMO fichero (todos los pasos de la slice
    // viajan juntos en docs/superpowers/metrics/issue-<n>.jsonl) y no
    // colisionan: sus claves vienen prefijadas a propósito (ver SIN_CUENTAS).
    return { status: 'ok', path: rel, ...aggregateVerdictMeasures(texto), ...aggregateBriefMeasures(texto) }
  } catch (e) {
    motivos.push(`no se pudo leer la telemetría ${rel} (issue #${n}): ${e.message}`)
    return { status: 'no-leido', path: rel, ...SIN_CUENTAS }
  }
}

for (const f of filas) f.telemetry = telemetriaDe(f.issue)

if (bqTable && motivos.length) console.error(`BigQuery: no se carga — la cosecha está incompleta (${motivos.length} lectura(s) sin completar)`)
else if (bqTable && !filas.length) console.error('BigQuery: nada que cargar — el milestone no tiene slices')
else if (bqTable) {
  const directory = mkdtempSync(join(tmpdir(), 'ct-harvest-bq-'))
  const identity = new HarvestIdentity({ harvestId: randomUUID(), harvestedAt: new Date().toISOString(), repo, milestone, pluginVersion: PLUGIN_VERSION, actor: userInfo().username })
  const report = new BigQueryLoad({ bq: bqRunner, directory }).load({ table: bqTable, rows: filas.map((row) => HarvestTable.rowFor({ row, identity })), schemaJson: HarvestTable.schemaJson() })
  // Proyección EXHAUSTIVA del desenlace: un `LoadOutcome` sin clave aquí
  // lanza (llamar a `undefined` como función), nunca cae en un catch-all
  // silencioso.
  const PROYECCION_BQ = {
    [LoadOutcome.LOADED]: () => {
      rmSync(report.directory, { recursive: true, force: true })
      console.error(`BigQuery: ${report.rowCount} filas cargadas en ${report.table.id} (harvest_id ${identity.harvestId})`)
    },
    [LoadOutcome.REJECTED]: () => {
      motivos.push(`no se pudo cargar en BigQuery (${report.table.id}): bq salió con ${report.code}: ${report.detail}. Los ficheros quedan en ${report.directory}; reintenta a mano: ${report.retryCommand}`)
    },
  }
  PROYECCION_BQ[report.outcome]()
}

if (comoJson) {
  console.log(JSON.stringify({ repo, milestone, filas, motivos, telemetry: { dir: METRICS_REPO_DIR, status: dirTelemetria.status, why: dirTelemetria.why } }, null, 2))
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
  console.log('')
  console.log('## Telemetría del juez — sólo lo que el repo trae escrito')
  console.log('')
  if (dirTelemetria.status === 'no-leido') {
    console.log(`no se pudo listar \`${METRICS_REPO_DIR}\` en ${repo} (${dirTelemetria.why}). Puede que este repo no tenga telemetría del juez o que la lectura fallara: **no se cuenta nada**, y el hueco NO es un cero.`)
  } else {
    console.log('| Issue | Slice | Veredictos | sin-vara | Hallazgos por regla | vara ct | brief |')
    console.log('|---|---|---|---|---|---|---|')
    for (const f of filas) {
      const t = f.telemetry
      let veredictos = '—'
      let sinVara = '—'
      let porRegla = '—'
      // LA VARA DE CT, en sus dos mitades y una sola columna: cuántos de sus
      // documentos llegaron a citarse en el recorrido de la rúbrica, y cuántos
      // hallazgos los citan. Combinadas como el `N docs · MB` del brief, porque
      // son dos números de la misma medida y una columna por cada uno ensancharía
      // la tabla sin añadir una pregunta.
      //
      // Se leen JUNTAS y en ese orden: `5 docs` con `0 hallazgos` slice tras
      // slice es el caso que hay que vigilar —o el código conformaba, o la vara
      // se está nombrando de adorno—, y esa lectura es imposible con una sola
      // cifra. Sustituye a `patrones-ct`, que sólo miraba hallazgos del ítem
      // `patrones` y por eso no vio los dos que el slice #7 archivó en
      // `decisiones-cerradas`.
      let varaCt = '—'
      // Si la vara de ct llegó al brief del paso `implement`, y cuánto pesó —
      // sumado sobre TODOS los intentos de `implement` que el slice dejó
      // escritos. Combinado en una sola columna, como el `#pr +a/-d Nf` de la
      // tabla de coste de arriba: son dos números de la misma medida.
      let brief = '—'
      if (t.status === 'sin-fichero') porRegla = '(sin telemetría)'
      else if (t.status === 'no-leido') porRegla = '(no se pudo leer)'
      else {
        veredictos = t.legacy > 0 ? `${t.verdicts} (${t.legacy} sin columna)` : String(t.verdicts)
        // measured === 0 imprime «—» y JAMÁS «0»: ningún veredicto de este slice
        // traía la columna, así que un cero afirmaría una medida que no se hizo.
        sinVara = t.measured > 0 ? String(t.rubricSinVara) : '—'
        const entradas = Object.entries(t.findingsByRule).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        porRegla = t.verdicts === 0 ? '(sin veredictos)' : (entradas.length ? entradas.map(([r, n]) => `${r} ${n}`).join(' · ') : '(ninguno)')
        // Misma regla que `sin-vara`: measured* === 0 imprime «—», nunca «0» —
        // ningún veredicto de este slice traía la columna. Se exigen las DOS
        // medidas para imprimir la celda: media celda con la otra mitad en
        // blanco invitaría a leer el hueco como un cero, que es justo lo que
        // esta regla existe para impedir.
        if (t.measuredVaraCtDocs > 0 && t.measuredFindingsVaraCt > 0) {
          varaCt = `${t.varaCtDocs} docs · ${t.findingsVaraCt} hallazgos`
          if (t.legacyVaraCtDocs > 0) varaCt += ` (${t.legacyVaraCtDocs} sin columna)`
        }
        // Misma regla otra vez: briefMeasured === 0 imprime «—» — ningún
        // intento de `implement` de este slice traía las dos columnas, así
        // que un cero afirmaría un brief sin vara que nadie pudo medir.
        if (t.briefMeasured > 0) {
          brief = `${t.briefVaraCtDocs} docs · ${t.briefBytes}B`
          if (t.briefLegacy > 0) brief += ` (${t.briefLegacy} sin columna)`
        }
      }
      console.log(`| #${f.issue} | ${f.title ?? '—'} | ${veredictos} | ${sinVara} | ${porRegla} | ${varaCt} | ${brief} |`)
    }
    console.log('')
    if (filas.some((f) => f.telemetry.status === 'ok' && f.telemetry.verdicts > 0 && f.telemetry.measured === 0)) {
      console.log('`—` en `sin-vara`: ningún veredicto de ese slice traía la columna (telemetría anterior a `rubric_sin_vara`). No es un cero.')
    }
    if (filas.some((f) => f.telemetry.status === 'ok' && f.telemetry.verdicts > 0 && (f.telemetry.measuredVaraCtDocs === 0 || f.telemetry.measuredFindingsVaraCt === 0))) {
      console.log('`—` en `vara ct`: ningún veredicto de ese slice traía las columnas `rubric_vara_ct_docs`/`findings_vara_ct` (telemetría anterior a esta medida, o de la columna `findings_patrones_vara_ct` que sustituyeron). No es un cero.')
    }
    if (filas.some((f) => f.telemetry.status === 'ok' && f.telemetry.briefAttempts > 0 && f.telemetry.briefMeasured === 0)) {
      console.log('`—` en `brief`: ningún intento de `implement` de ese slice traía `brief_vara_ct_docs`/`brief_bytes` (telemetría anterior a esta medida, o el brief no se pudo leer en su momento). No es un cero.')
    }
    if (filas.some((f) => f.telemetry.status === 'sin-fichero')) {
      console.log(`\`(sin telemetría)\`: el repo no trae \`${METRICS_REPO_DIR}/issue-<n>.jsonl\` para ese slice. Nadie midió — no es un cero.`)
    }
    for (const f of filas.filter((x) => x.telemetry.status === 'ok' && x.telemetry.malformed > 0)) {
      console.log(`\`${f.telemetry.path}\`: ${f.telemetry.malformed} línea(s) ilegibles, no se cuentan (el resto sí).`)
    }
  }
}

if (motivos.length) {
  console.error('')
  console.error(`${motivos.length} lectura(s) sin completar — la cosecha está INCOMPLETA:`)
  for (const m of motivos) console.error(`  - ${m}`)
  process.exit(1)
}
process.exit(0)
