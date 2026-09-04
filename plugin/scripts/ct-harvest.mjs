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
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatDuration } from './harvest.js'
import { parseRepoSlug } from './dispatch.js'
import { METRICS_REPO_DIR } from './run-metrics.js'
import { BigQueryTable, LoadOutcome } from './bigquery-load.js'
import { HarvestLedger, LedgerIdentity } from './harvest-ledger.js'
import { IndexOutcome, SliceHarvest, SliceRead, TelemetryIndex } from './slice-harvest.js'

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

// `ghRunner`: el mismo `gh` de arriba pero con la forma `{ code, stdout,
// stderr }` que SliceHarvest y TelemetryIndex esperan de su dependencia
// inyectada — el adaptador no sabe que detrás hay un `execFileSync` que
// lanza.
const ghRunner = (a) => {
  try {
    return { code: 0, stdout: gh(a), stderr: '' }
  } catch (e) {
    return { code: 1, stdout: '', stderr: e.message }
  }
}

// El listado del directorio: UNA llamada que decide qué hay, ANTES de cosechar
// ningún slice. La ausencia de un fichero se deduce de un listado que sí se
// leyó, nunca de interpretar el stderr de un 404 — este repo no parsea
// códigos HTTP en ningún sitio y no empieza aquí. El listado que falla NO
// baja el exit a 1: la causa casi siempre es que este repo no tiene
// telemetría (todo epic anterior a 1422c67).
const indice = TelemetryIndex.read({ gh: ghRunner, repo })
const dirTelemetria = indice.outcome === IndexOutcome.NOT_READ
  ? { status: 'no-leido', why: indice.detail }
  : { status: 'ok', why: null }

// motivoDe: reproduce los tres textos de siempre según qué lectura falló. Un
// `read` que este comando no espera lanza en vez de perderse en un texto
// genérico.
function motivoDe(n, f) {
  if (f.read === SliceRead.TIMELINE) return `no se pudo leer el timeline del issue #${n}: ${f.detail}`
  if (f.read === SliceRead.PULL_REQUEST) return `no se pudieron leer los datos del ${f.subject} (issue #${n}): ${f.detail}`
  if (f.read === SliceRead.TELEMETRY_FILE) return `no se pudo leer la telemetría ${f.subject} (issue #${n}): ${f.detail}`
  throw new Error(`ct-harvest.mjs no sabe redactar un motivo para la lectura "${f.read}"`)
}

const filas = []
const cosechador = new SliceHarvest({ gh: ghRunner })
for (const issue of issues) {
  const informe = cosechador.harvest({ repo, issue, index: indice })
  // Dos PRs cerrando el mismo issue es raro: se dice en voz alta y se cosecha
  // el primero, en vez de elegir en silencio y perder el hallazgo.
  if (informe.closers.length > 1) motivos.push(`el issue #${issue.number} lo cierran ${informe.closers.length} PRs (${informe.closers.map((n) => `#${n}`).join(', ')}); la fila cosecha solo el #${informe.closers[0]}`)
  for (const f of informe.failures) motivos.push(motivoDe(issue.number, f))
  if (informe.row) filas.push(informe.row)
}

filas.sort((a, b) => (a.issue ?? 0) - (b.issue ?? 0))

if (bqTable && motivos.length) console.error(`BigQuery: no se carga — la cosecha está incompleta (${motivos.length} lectura(s) sin completar)`)
else if (bqTable && !filas.length) console.error('BigQuery: nada que cargar — el milestone no tiene slices')
else if (bqTable) {
  const ledger = new HarvestLedger({ table: bqTable, bq: bqRunner, workspace: { create: () => mkdtempSync(join(tmpdir(), 'ct-harvest-bq-')), remove: (d) => rmSync(d, { recursive: true, force: true }) }, identity: LedgerIdentity.fromEnvironment() })
  const informe = ledger.record({ repo, milestone, rows: filas })
  // Proyección EXHAUSTIVA del desenlace: un `LoadOutcome` sin clave aquí
  // lanza (llamar a `undefined` como función), nunca cae en un catch-all
  // silencioso.
  const PROYECCION_BQ = {
    [LoadOutcome.LOADED]: () => console.error(`BigQuery: ${informe.rowCount} filas cargadas en ${informe.table.id} (harvest_id ${informe.harvestId})`),
    [LoadOutcome.REJECTED]: () => motivos.push(`no se pudo cargar en BigQuery (${informe.table.id}): bq salió con ${informe.code}: ${informe.detail}. Los ficheros quedan en ${informe.directory}; reintenta a mano: ${informe.retryCommand}`),
  }
  PROYECCION_BQ[informe.outcome]()
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
    console.log('| Issue | Slice | Veredictos | sin-vara | Hallazgos por regla | alta/media/baja | vara ct | brief |')
    console.log('|---|---|---|---|---|---|---|---|')
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
      // LA SEVERIDAD, en una celda y en el orden en que se decide: una alta VETA
      // —el contrato del veredicto no admite un PASS con una alta—, una media
      // compra una vuelta pagada al implementador, una baja sólo se anota. Las
      // tres juntas por lo mismo que `vara ct`: son el mismo reparto y una
      // columna por severidad ensancharía la tabla sin añadir una pregunta.
      let severidades = '—'
      if (t.status === 'sin-fichero') porRegla = '(sin telemetría)'
      else if (t.status === 'no-leido') porRegla = '(no se pudo leer)'
      else {
        // Las dos notas de la celda caben juntas y separadas por coma: cuántos
        // de esos veredictos fueron un VETO, y cuántos son de telemetría vieja.
        // Sólo se anotan si hay algo que anotar — un slice limpio se lee de un
        // golpe, que es para lo que sirve la columna.
        const notas = []
        if (t.fails > 0) notas.push(`${t.fails} ${t.fails === 1 ? 'veto' : 'vetos'}`)
        if (t.legacy > 0) notas.push(`${t.legacy} sin columna`)
        veredictos = notas.length ? `${t.verdicts} (${notas.join(', ')})` : String(t.verdicts)
        // Misma regla que todo lo demás de esta tabla: measuredSeverities === 0
        // imprime «—» y jamás `0/0/0`, que afirmaría un reparto que nadie midió.
        if (t.measuredSeverities > 0) {
          severidades = `${t.findingsHigh}/${t.findingsMedium}/${t.findingsLow}`
          if (t.legacySeverities > 0) severidades += ` (${t.legacySeverities} sin columna)`
        }
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
      console.log(`| #${f.issue} | ${f.title ?? '—'} | ${veredictos} | ${sinVara} | ${porRegla} | ${severidades} | ${varaCt} | ${brief} |`)
    }
    console.log('')
    if (filas.some((f) => f.telemetry.status === 'ok' && f.telemetry.verdicts > 0 && f.telemetry.measured === 0)) {
      console.log('`—` en `sin-vara`: ningún veredicto de ese slice traía la columna (telemetría anterior a `rubric_sin_vara`). No es un cero.')
    }
    if (filas.some((f) => f.telemetry.status === 'ok' && f.telemetry.verdicts > 0 && f.telemetry.measuredSeverities === 0)) {
      console.log('`—` en `alta/media/baja`: ningún veredicto de ese slice traía las severidades `findings_high`/`findings_medium`/`findings_low` (telemetría anterior a esta medida). No es un cero.')
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
