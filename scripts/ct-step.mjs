#!/usr/bin/env node
// ============================================================================
// ct-step.mjs — LA MÁQUINA DE ESTADOS COMO ORÁCULO, NO COMO CONDUCTOR.
//
// La decisión D-4 del documento de convergencia —"¿el orquestador deja de ser
// una sesión de chat?"— está APLAZADA y su dueño es José: se revisa al cerrar
// F38, con los datos de F38 encima. Este fichero existe para coger lo que se
// puede coger hoy sin tocar esa decisión.
//
// La respuesta a D-4 sigue siendo NO: el orquestador sigue siendo una sesión de
// chat. La sesión despachada por /ct-next sigue conduciendo, sigue despachando
// subagentes y sigue abriendo la pull request. Lo que cambia es que YA NO DECIDE
// LA SECUENCIA: la pregunta.
//
//   ct-step next                    → "toca implementar la tarea 3; el brief está en X"
//   ct-step report informe.json     → valida las rutas, las stagea, transiciona
//   ct-step controls                → ejecuta los comandos del plan y MIDE
//   ct-step verdict veredicto.json  → valida contra el esquema, transiciona
//   ct-step commit                  → valida el mensaje y comitea
//
// Aquí no hay bucle y no hay una sola llamada al modelo. Este programa no
// conduce nada: contesta preguntas y aplica una tabla (`run-machine.js`).
//
// ---------------------------------------------------------------------------
// LO QUE SE GANA IGUAL, SIN PROGRAMA CONDUCTOR
//
// 1. La secuencia deja de ser prosa. La decide la tabla, y **cada verbo rechaza
//    lo que no sea el paso que toca** (código 9). La sesión no puede pedir
//    `commit` estando en `controls`, ni saltarse el juez, ni volver a
//    implementar una tarea ya comiteada. La obediencia de la SECUENCIA pasa a
//    ser estructural aunque el conductor sea un agente.
// 2. El sitio en el que va deja de vivir en la conversación. Está en
//    `.agent/run-<issue>.json`, así que una compactación no lo borra y el
//    ledger de `subagent-driven-development` deja de hacer falta.
// 3. La tarea la mide el programa, no el implementador: `ct-step controls`
//    ejecuta los comandos que el plan declara y comprueba que los tests que la
//    tarea prometió existen de verdad.
// 4. Comitea el programa, no el implementador: un veto no deja rastro que
//    deshacer. Y el mensaje se valida con `closing-keywords.js`, porque el hook
//    `commit-keyword-guard` es un PreToolUse sobre la Bash de una SESIÓN y un
//    `git commit` lanzado por un script no pasa por esa puerta.
//
// LO QUE SE PIERDE, Y HAY QUE DECIRLO
//
// - **El esquema del veredicto ya no lo impone el binario.** `--json-schema`
//   sólo existe en modo `--print` (medido, §2.1 del spec), y aquí no hay
//   llamadas headless. Se recupera casi todo pidiéndole al juez que escriba su
//   veredicto a un JSON y validándolo aquí: si no cumple, es un descarte igual.
//   Pero lo impone una validación posterior, no la herramienta.
// - **No hay presupuesto en dinero.** El coste de una llamada lo devuelve
//   `claude -p` en `total_cost_usd`; un subagente de la sesión no lo reporta. De
//   rebote, esto deja de tocar el alcance de F38, que es de José.
// - El juez no puede ejecutar porque se despacha como `ct-judge`
//   (`agents/ct-judge.md`, declarado sin `Bash`), no porque un flag se lo quite.
// ============================================================================

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, writeSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { after, newRun, STEPS, OUTCOMES, RUN_STATES, DEFAULT_BUDGETS } from './run-machine.js'
import { extractTasks } from './plan-tasks.js'
import {
  readVerdict, readReport, outcomeOfVerdict, commitMessage,
  IMPLEMENTER_TOOLS, JUDGE_TOOLS, PACKAGE_SECTIONS,
} from './step-contracts.js'
import { metricRow, metricLine, metricsPath, planSha256, verdictMeasures } from './run-metrics.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// Uno por DECISIÓN, no uno por excepción: cada fila dice qué hacer después.
const EXIT = {
  OK: 0,                  // el paso se aplicó; `next` dice cuál toca ahora
  VETOED: 1,              // el juez veta y se agotaron los reintentos
  USAGE: 2,               // error de uso
  NO_VERDICT: 3,          // no hay veredicto de fiar tras los descartes
  CONTROLS_RED: 4,        // los controles siguen en rojo tras los reintentos
  CONTROLS_UNMEASURED: 5, // no se pudieron MEDIR
  PLAN_NOT_EXECUTABLE: 6, // el plan no declara comandos ejecutables
  PRECONDITION: 8,        // entorno: no es un worktree de slice, falta el plan
  WRONG_STEP: 9,          // se pidió un paso que no es el que toca
  UNNAMED: 10,            // excepción que el programa no sabe nombrar
}

const MAX_DISCARDS = 6

function safeWrite(fd, text) {
  try { writeSync(fd, text) } catch { /* tubería cerrada: la línea se pierde, el exit code no cambia */ }
}
const out = (msg) => safeWrite(1, msg + '\n')
const err = (msg) => safeWrite(2, msg + '\n')
const die = (msg, code) => { err(msg); process.exit(code) }

const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}

const USAGE = `uso: ct-step <verbo> [args] --plan <fichero> --issue <n>

  next                      dice qué paso toca y prepara lo que ese paso necesita
  report <fichero.json>     el informe del implementador: rutas tocadas + resumen
  controls                  ejecuta los comandos de **Verification:** de la tarea
  verdict <fichero.json>    el veredicto del juez: ruling + findings
  commit                    comitea la tarea con el mensaje que compone el plugin

La secuencia la decide run-machine.js: un verbo que no sea el paso que toca sale
por 9 y dice cuál es. El estado vive en .agent/run-<issue>.json.`

const verbo = process.argv[2]
if (!verbo || verbo.startsWith('--')) die(USAGE, EXIT.USAGE)
if (!['next', 'report', 'controls', 'verdict', 'commit'].includes(verbo)) {
  die(`verbo desconocido: ${verbo}\n\n${USAGE}`, EXIT.USAGE)
}

const planPath = arg('--plan')
const issueRaw = arg('--issue')
if (typeof planPath !== 'string' || !planPath) die(USAGE, EXIT.USAGE)
if (typeof issueRaw !== 'string' || !/^\d+$/.test(issueRaw)) {
  die(`--issue debe ser un número entero: recibí ${JSON.stringify(issueRaw)}`, EXIT.USAGE)
}
const issue = Number(issueRaw)

const GIT_MAX_BUFFER = 64 * 1024 * 1024
const git = (argv, { allowFail = false } = {}) => {
  try {
    return execFileSync('git', argv, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: GIT_MAX_BUFFER, timeout: 120_000, killSignal: 'SIGKILL',
    })
  } catch (e) {
    if (allowFail) return null
    throw new Error(`git ${argv.join(' ')} falló: ${String(e.stderr || e.message).trim()}`)
  }
}

// ---------------------------------------------------------------------------
// Precondiciones
// ---------------------------------------------------------------------------
const repoRoot = (git(['rev-parse', '--show-toplevel'], { allowFail: true }) || '').trim()
if (!repoRoot) die('no estamos dentro de un repositorio git', EXIT.PRECONDITION)
if (!existsSync(join(repoRoot, '.agent', 'SLICE.md'))) {
  die('esto no es el worktree de un slice (falta .agent/SLICE.md). ct-step conduce el tramo interno de una slice.', EXIT.PRECONDITION)
}

let planText
try {
  planText = readFileSync(planPath, 'utf8')
} catch (e) {
  die(`no se puede leer el plan ${planPath}: ${e.message}`, EXIT.PRECONDITION)
}
const { tasks, problems } = extractTasks(planText)
if (problems.length) {
  for (const p of problems) err(`plan no ejecutable: ${p.detail}`)
  process.exit(EXIT.PLAN_NOT_EXECUTABLE)
}

// ---------------------------------------------------------------------------
// El estado del run
// ---------------------------------------------------------------------------
const stateFile = join(repoRoot, '.agent', `run-${issue}.json`)
const workDir = join(repoRoot, '.agent', `run-${issue}`)
mkdirSync(workDir, { recursive: true })

const headSha = () => (git(['rev-parse', 'HEAD']) || '').trim()
const commitsDesde = (sha) => {
  const salida = git(['rev-list', '--count', `${sha}..HEAD`], { allowFail: true })
  return salida === null ? null : Number(salida.trim())
}

let run
if (existsSync(stateFile)) {
  run = JSON.parse(readFileSync(stateFile, 'utf8'))
  // No se cree el fichero a solas: cruza la tarea que dice el estado con los
  // commits que hay desde baseSha. Adivinar aquí es reimplementar encima de una
  // tarea ya comiteada.
  const hechos = commitsDesde(run.baseSha)
  if (hechos === null) {
    die(`el estado dice baseSha ${run.baseSha}, que no existe en este worktree. Borra ${stateFile} si el run es de otra rama.`, EXIT.PRECONDITION)
  }
  if (hechos !== run.task - 1) {
    die(`el estado y git no cuentan lo mismo: el fichero va por la tarea ${run.task} (o sea ${run.task - 1} commits) y desde ${run.baseSha.slice(0, 7)} hay ${hechos}. No se sigue a ciegas.`, EXIT.PRECONDITION)
  }
} else {
  if ((git(['diff', '--cached', '--name-only']) || '').trim()) {
    die('el índice tiene cambios stageados y este run es nuevo. ct-step comitea el índice tarea a tarea: vacíalo (git reset) o comitéalo tú.', EXIT.PRECONDITION)
  }
  run = newRun({ plan: planPath, issue, baseSha: headSha(), tasksTotal: tasks.length })
  writeFileSync(stateFile, JSON.stringify(run, null, 2) + '\n')
}

const guardar = () => writeFileSync(stateFile, JSON.stringify(run, null, 2) + '\n')
const tarea = () => tasks.find((t) => t.n === run.task)

// ---------------------------------------------------------------------------
// La telemetría: append-only, fuera del repo, y un fallo suyo NO tumba nada.
// ---------------------------------------------------------------------------
const PLAN_SHA = planSha256(planText)
const repoSlug = (() => {
  const url = (git(['remote', 'get-url', 'origin'], { allowFail: true }) || '').trim()
  const m = /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url)
  return m ? m[1] : null
})()
const epicDelSlice = (() => {
  const m = /^epic:\s*(.+)$/m.exec(readFileSync(join(repoRoot, '.agent', 'SLICE.md'), 'utf8'))
  return m ? m[1].trim() : null
})()
const intento = () => run.controlRetries + run.judgeRetries + run.correctionRetries + 1

function medir(step, measures) {
  try {
    const destino = metricsPath('ct-step', { configDir: process.env.CLAUDE_CONFIG_DIR })
    mkdirSync(dirname(destino), { recursive: true })
    appendFileSync(destino, metricLine(metricRow({
      repo: repoSlug, epic: epicDelSlice, issue, plan: planPath, plan_sha256: PLAN_SHA,
      task: run.task, task_name: tarea()?.name ?? null, tasks_total: run.tasksTotal,
      step, attempt: intento(), session: null,
    }, measures, { now: new Date().toISOString() })))
  } catch (e) {
    err(`aviso: no se pudo escribir la telemetría (${String(e.message).trim()}). Esto sigue: ninguna transición depende de la medida.`)
  }
}

// ---------------------------------------------------------------------------
// LA GUARDIA DEL PASO. Es lo que convierte la secuencia en mecanismo: pedir un
// paso que no toca no se corrige con un aviso, se rechaza.
// ---------------------------------------------------------------------------
const VERBO_DE = { report: STEPS.IMPLEMENT, controls: STEPS.CONTROLS, verdict: STEPS.JUDGE, commit: STEPS.COMMIT }
function exigirPaso(v) {
  if (run.step !== VERBO_DE[v]) {
    die(`"${v}" no es el paso que toca: el run está en "${run.step}" (tarea ${run.task}/${run.tasksTotal}). Pregunta con "ct-step next".`, EXIT.WRONG_STEP)
  }
}

// ---------------------------------------------------------------------------
// next — no transiciona: informa, y prepara lo que el paso necesita.
// ---------------------------------------------------------------------------
function verboNext() {
  const t = tarea()
  out(`tarea ${run.task}/${run.tasksTotal} — ${t.name}`)
  out(`paso: ${run.step} (intento ${intento()})`)
  out('')
  switch (run.step) {
    case STEPS.IMPLEMENT: {
      const brief = escribirBrief()
      const informe = join(workDir, `task-${run.task}-report.json`)
      // La lista sale de la constante y no se teclea otra vez: la copia a mano
      // de las del juez ya divergió una vez, y `ct-step next` acabó anunciando
      // unas herramientas que no eran las del agente que se despachaba.
      out(`DESPACHA UN IMPLEMENTADOR (subagente con ${IMPLEMENTER_TOOLS}) con:`)
      out(`  - la rúbrica de ${join(PLUGIN_ROOT, 'prompts', 'task-implementer.md')}`)
      out(`  - el brief de la tarea: ${brief}`)
      out(`  - que escriba su informe en: ${informe}`)
      if (run.lastFindings) {
        out('')
        out('El juez devolvió esta tarea. Lo que hay que arreglar:')
        out(run.lastFindings)
      }
      out('')
      out(`Cuando vuelva:  ct-step report ${informe} --plan ${planPath} --issue ${issue}`)
      out('NO comitees tú, y no le pidas al implementador que comitee: comitea ct-step.')
      break
    }
    case STEPS.CONTROLS:
      out('MIDE LA TAREA (no lo hace el implementador, y su palabra no cuenta):')
      for (const c of t.commands) out(`  $ ${c}`)
      if (t.testsAdded.length) out(`  y que existan los tests que la tarea prometió: ${t.testsAdded.map((n) => `'${n}'`).join(', ')}`)
      out('')
      out(`Ejecútalo con:  ct-step controls --plan ${planPath} --issue ${issue}`)
      break
    case STEPS.JUDGE: {
      const paquete = escribirPaquete()
      const veredicto = join(workDir, `task-${run.task}-verdict.json`)
      out(`DESPACHA EL JUEZ (subagente ct-judge — declarado SIN Bash: ${JUDGE_TOOLS}) con:`)
      out(`  - el paquete de revisión: ${paquete}`)
      out(`  - el brief de la tarea: ${join(workDir, `task-${run.task}-brief.md`)}`)
      out(`  - los logs de los controles, YA en verde, por si los quiere: ${run.lastControlsLog ?? '(ninguno)'}`)
      out(`  - que escriba su veredicto en: ${veredicto}`)
      out('')
      out(`Cuando vuelva:  ct-step verdict ${veredicto} --plan ${planPath} --issue ${issue}`)
      out('No le pases la SALIDA de los controles: un lint sucio no debe ensuciarle el criterio.')
      break
    }
    case STEPS.COMMIT:
      out('COMITEA LA TAREA:')
      out(`  ct-step commit --plan ${planPath} --issue ${issue}`)
      out('El mensaje lo compone el plugin y lo valida contra las closing keywords.')
      break
    default:
      die(`el estado tiene un paso que esta versión no conoce: ${run.step}`, EXIT.UNNAMED)
  }
  process.exit(EXIT.OK)
}

function escribirBrief() {
  const brief = join(workDir, `task-${run.task}-brief.md`)
  try {
    execFileSync(join(PLUGIN_ROOT, 'skills', 'subagent-driven-development', 'scripts', 'task-brief'),
      ['--with-plan-context', planPath, String(run.task), brief], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    die(`no se pudo extraer el brief de la tarea ${run.task}: ${String(e.stderr || e.message).trim()}`, EXIT.PRECONDITION)
  }
  return brief
}

// El paquete sale del ÍNDICE y no de un rango de commits: el implementador no
// comitea, así que lo que hay que juzgar todavía no es un commit.
function escribirPaquete() {
  const paquete = join(workDir, `task-${run.task}-review.diff`)
  // Esta sección llevaba, junto a cada ruta, si era código de producción o de
  // test (el `kind` que declaraba el informe del implementador). Se quitó: el
  // juez tiene el diff delante y distingue un test de un fichero de
  // producción sin que nadie se lo diga, así que la etiqueta no le aportaba
  // nada que no pudiera ver por sí mismo. La producía además el propio agente
  // al que se juzga, no la verificaba nadie, y cuando venía mal no degradaba
  // el juicio: lo desactivaba. No se vuelva a añadir.
  const rutas = (run.lastPaths || []).map((p) => `- ${p}`).join('\n') || '(ninguna)'
  const [SECCION_FILES, SECCION_RUTAS, SECCION_DIFF] = PACKAGE_SECTIONS
  writeFileSync(paquete, [
    `# Review package: task ${run.task}/${run.tasksTotal} of issue #${issue} (staged, not yet committed)`,
    '', `## ${SECCION_FILES}`, git(['diff', '--cached', '--stat']) || '',
    '', `## ${SECCION_RUTAS}`, rutas,
    '', `## ${SECCION_DIFF}`, git(['diff', '--cached', '-U10']) || '',
  ].join('\n'))
  return paquete
}

// ---------------------------------------------------------------------------
// Los verbos que transicionan
// ---------------------------------------------------------------------------
function leerJson(ruta, quien) {
  if (typeof ruta !== 'string' || !ruta || ruta.startsWith('--')) {
    die(`falta la ruta del JSON ${quien}\n\n${USAGE}`, EXIT.USAGE)
  }
  try {
    return { valor: JSON.parse(readFileSync(ruta, 'utf8')) }
  } catch (e) {
    // Un JSON que no se puede leer es un DESCARTE, no un error de uso: el
    // subagente contestó, y lo que contestó no vale.
    return { why: `no se pudo leer el ${quien} en ${ruta}: ${e.message}` }
  }
}

function verboReport() {
  const { valor, why: porLeer } = leerJson(process.argv[3], 'del informe')
  const { report, why } = porLeer ? { why: porLeer } : readReport(valor)
  // El resumen entra en la telemetría sólo cuando hay informe válido: un
  // informe descartado no tiene resumen que contar, igual que `why` sólo
  // lleva valor cuando se descarta.
  medir('implement', {
    outcome: report ? 'done' : 'discarded',
    paths: report ? report.paths.length : 0,
    why: report ? null : why,
    summary: report ? report.summary : null,
  })
  if (!report) {
    out(`informe descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  // Se stagea ANTES de medir: un control que lee el índice no ve un fichero
  // nuevo sin stagear.
  const rutas = report.paths
  git(['add', '--', ...rutas])
  // `lastPaths` alimenta el `--` de un `git grep` en `testsDeclarados`, que
  // acota el ámbito de esa comprobación a lo que la tarea stageó — la
  // propiedad más frágil de todo esto (ver el commit que la arregló, e4cc3dc).
  run = {
    ...run,
    lastPaths: rutas,
    lastSummary: report.summary,
  }
  out(`stageados ${report.paths.length} fichero(s): ${rutas.join(', ')}`)
  return OUTCOMES.DONE
}

function verboControls() {
  const t = tarea()
  const log = join(workDir, `task-${run.task}-controls-${intento()}.log`)
  const lineas = []
  let resultado = OUTCOMES.DONE

  // Delante de todo el alcance, que es lo más gratis: comparar dos listas de
  // rutas y mirar el árbol del commit anterior no cuesta nada, así que corre
  // incluso antes que los nombres de test.
  const fueraDeAlcance = alcanceDeclarado(t)
  if (fueraDeAlcance.length) {
    lineas.push('# alcance declarado por la tarea', ...fueraDeAlcance.map((f) => `- ${f}`), '')
    resultado = OUTCOMES.FAILED
  }

  // Después los nombres, que también son gratis. La vara de un plan mide que
  // nada se rompió, no que se haya añadido lo prometido — medido en campo: una
  // tarea pidió una función y su test, llegó la función sin el test, y la
  // suite siguió verde porque la del commit anterior pasaba.
  const fallos = testsDeclarados(t)
  if (fallos.length) {
    lineas.push('# tests declarados por la tarea', ...fallos.map((f) => `- ${f}`), '')
    resultado = OUTCOMES.FAILED
  }

  // Y por último lo que los BLOQUES del plan prometen, que sigue siendo
  // gratis: nada de esto ejecuta un comando.
  const bloques = bloquesDeclarados(t)
  if (bloques.length) {
    lineas.push('# bloques declarados por la tarea', ...bloques.map((f) => `- ${f}`), '')
    resultado = OUTCOMES.FAILED
  }

  for (const comando of resultado === OUTCOMES.FAILED ? [] : t.commands) {
    const medido = ejecutarControl(comando)
    lineas.push(`$ ${comando}`, medido.output ?? '', `-> exit ${medido.code}`, '')
    if (medido.code === 'unmeasured') { resultado = OUTCOMES.INDETERMINATE; break }
    if (medido.code !== 0) { resultado = OUTCOMES.FAILED; break }
  }

  writeFileSync(log, lineas.join('\n'))
  medir('controls', { outcome: resultado, controls_log: log, commands: t.commands.length })
  run = { ...run, lastControlsLog: log }
  out(`controles: ${resultado} (log en ${log})`)
  return resultado
}

// El alcance de la tarea lo decide el PLAN, no el implementador: esta
// comprobación cruza `run.lastPaths` (lo que la tarea stageó, en `report`)
// contra `t.files` (lo que la tarea declara en **Files:**). Una ruta a un lado y
// no al otro es un fallo, y también lo es una acción que no cuadra con el
// árbol del commit anterior — `git cat-file -e HEAD:<path>`, no el disco,
// porque el implementador ya creó el fichero cuando esto corre. Una ruta con
// `action: null` no se comprueba contra git: es una decisión del plan, no un
// olvido (tarea 1, `splitFiles`).
//
// El mensaje de cada fallo dice si se arregla el PLAN o el CÓDIGO, porque un
// plan que se dejó una ruta en **Files:** es tan probable como un
// implementador que tocó de más, y confundirlas cuesta un ciclo entero.
function alcanceDeclarado(t) {
  const fallos = []
  const tocadas = run.lastPaths || []
  const declaradas = t.files

  for (const ruta of tocadas) {
    if (!declaradas.some((f) => f.path === ruta)) {
      fallos.push(`la tarea ${t.n} tocó '${ruta}' y el plan no la declara en sus **Files:** — dos explicaciones son igual de plausibles y este control no puede arbitrar entre ellas: sobra en el CÓDIGO, o hace falta añadirla al PLAN`)
    }
  }

  for (const f of declaradas) {
    if (!tocadas.includes(f.path)) {
      fallos.push(`el plan declara '${f.path}' en las **Files:** de la tarea ${t.n} y no está entre lo que tocó — dos explicaciones son igual de plausibles y este control no puede arbitrar entre ellas: falta en el CÓDIGO, o sobra en el PLAN`)
      continue
    }
    if (f.action === null) continue
    const existiaAntes = git(['cat-file', '-e', `HEAD:${f.path}`], { allowFail: true }) !== null
    if (f.action === 'create' && existiaAntes) {
      fallos.push(`el plan declara '${f.path}' como (create) y ya existía en el commit anterior — revisa el PLAN, la acción debería ser (modify)`)
    }
    if (f.action === 'modify' && !existiaAntes) {
      fallos.push(`el plan declara '${f.path}' como (modify) y no existía en el commit anterior — revisa el PLAN, la acción debería ser (create)`)
    }
  }

  return fallos
}

// Comprueba si `nombre` aparece en el ÍNDICE, acotado a `run.lastPaths` (lo
// que la tarea stageó, no el índice entero). Un plan prescriptivo CITA el
// código verbatim y vive comiteado en docs/, así que buscar en todo el índice
// encuentra siempre el nombre: el retirado "sigue estando" (falso positivo,
// medido en la tarea 1 del slice #5 de repo-pulse) y el prometido "ya está"
// aunque nadie lo escribiera (falso negativo, que es justo el fallo que esta
// comprobación existe para cazar). Sin ficheros stageados no hay dónde mirar,
// y eso es un NO. Compartida por `testsDeclarados` y `bloquesDeclarados`:
// misma pregunta, mismo ámbito, mismo mecanismo.
function enElIndice(nombre) {
  const ambito = run.lastPaths || []
  if (!ambito.length) return false
  try {
    execFileSync('git', ['grep', '--cached', '--quiet', '-F', '-e', nombre, '--', ...ambito], { cwd: repoRoot, stdio: 'ignore', timeout: 60_000 })
    return true
  } catch { return false }
}

function testsDeclarados(t) {
  const fallos = []
  for (const n of t.testsAdded) if (!enElIndice(n)) fallos.push(`la tarea dijo que añadía el test '${n}' y no está en lo stageado`)
  for (const n of t.testsRemoved) if (enElIndice(n)) fallos.push(`la tarea dijo que retiraba el test '${n}' y sigue estando`)
  return fallos
}

// Lo que los BLOQUES del plan prometen tiene que estar, igual que
// `alcanceDeclarado` mide lo que **Files:** promete. Tres comprobaciones,
// todas acotadas a `run.lastPaths` por la misma razón que `testsDeclarados`:
// el plan vive comiteado dentro del repo, así que buscar en el repo es
// buscar en el plan.
//
//  - `blockPaths`: cada `{role, path}` exige que `path` esté entre las rutas
//    tocadas. Un Contract o un Call site que nadie tocó es andamiaje
//    declarado y nunca escrito.
//  - `tddName`: mismo `enElIndice` que `testsDeclarados`, y el mismo
//    mensaje — el test que la tarea prometió en su **TDD:** es tan exigible
//    como los de **Tests:**.
//  - `finalTexts`: el texto tiene que aparecer verbatim en el ÍNDICE de su
//    ruta. Se compara contra `git show :<path>` y no con `git grep`, porque
//    es un bloque MULTILÍNEA y `git grep` trabaja línea a línea; comparar el
//    contenido stageado entero es lo que permite decir QUÉ línea falta, que
//    es la mitad del valor de esta comprobación.
//
// El mensaje de cada fallo dice si se arregla el PLAN o el CÓDIGO, igual que
// en `alcanceDeclarado`: confundir las dos cuesta un ciclo entero.
function bloquesDeclarados(t) {
  const fallos = []
  const tocadas = run.lastPaths || []

  for (const { role, path } of t.blockPaths) {
    if (!tocadas.includes(path)) {
      fallos.push(`la tarea ${t.n} declara un bloque ${role} (${path}) y no está entre lo que tocó — falta en el CÓDIGO, o el bloque sobra en el PLAN`)
    }
  }

  if (t.tddName && !enElIndice(t.tddName)) {
    fallos.push(`la tarea dijo que añadía el test '${t.tddName}' y no está en lo stageado`)
  }

  for (const { path, text } of t.finalTexts) {
    const indexado = git(['show', `:${path}`], { allowFail: true })
    if (indexado === null) {
      fallos.push(`la tarea ${t.n} declara un Final text (${path}) y ese fichero no está entre lo que tocó — falta en el CÓDIGO, o el bloque sobra en el PLAN`)
      continue
    }
    for (const linea of text.split('\n')) {
      if (linea.trim() !== '' && !indexado.includes(linea)) {
        fallos.push(`la tarea ${t.n} declara Final text (${path}) y la línea '${linea}' no está verbatim en lo stageado — falta en el CÓDIGO, o el PLAN cita mal el texto`)
      }
    }
  }

  return fallos
}

function ejecutarControl(comando) {
  try {
    return { code: 0, output: execFileSync('sh', ['-c', comando], {
      encoding: 'utf8', cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: GIT_MAX_BUFFER, timeout: 20 * 60_000, killSignal: 'SIGKILL',
    }) }
  } catch (e) {
    // Un comando que corrió y dijo que no es ROJO y se reintenta; uno que no se
    // pudo ejecutar o se colgó no se pudo MEDIR, y reintentarlo a ciegas repite
    // el coste sin cambiar nada.
    const seColgo = e.killed || e.signal === 'SIGKILL' || e.code === 'ETIMEDOUT'
    const noExiste = e.status === 127 || e.code === 'ENOENT'
    const code = (seColgo || noExiste) ? 'unmeasured' : (typeof e.status === 'number' ? e.status : 'unmeasured')
    return { code, output: String(e.stdout || '') + String(e.stderr || '') }
  }
}

function verboVerdict() {
  const { valor, why: porLeer } = leerJson(process.argv[3], 'del veredicto')
  const { verdict, why } = porLeer ? { why: porLeer } : readVerdict(valor)
  if (!verdict) {
    medir('judge', { outcome: 'discarded', why })
    out(`veredicto descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  const outcome = outcomeOfVerdict(verdict)
  const graves = verdict.findings.filter((f) => f.severity !== 'low')
  medir('judge', { outcome, review_package: join(workDir, `task-${run.task}-review.diff`), ...verdictMeasures(verdict) })
  run = {
    ...run,
    lastVerdict: verdict,
    lastFindings: graves.length ? graves.map((f) => `- [${f.severity}] ${f.where}: ${f.what}`).join('\n') : null,
  }
  out(`veredicto ${verdict.ruling} con ${verdict.findings.length} hallazgo(s) → ${outcome}`)
  return outcome
}

function verboCommit() {
  const t = tarea()
  let mensaje
  try {
    mensaje = commitMessage({ issue, task: run.task, tasksTotal: run.tasksTotal, name: t.name })
  } catch (e) {
    err(String(e.message))
    return OUTCOMES.FAILED
  }
  if (!(git(['diff', '--cached', '--name-only']) || '').trim()) {
    err(`la tarea ${run.task} no dejó nada stageado: no hay nada que commitear`)
    return OUTCOMES.FAILED
  }
  if (git(['commit', '-m', mensaje], { allowFail: true }) === null) return OUTCOMES.FAILED
  const sha = headSha()
  medir('commit', { outcome: 'done', commit: sha })
  run = { ...run, lastFindings: null, lastPaths: null, lastSummary: null }
  out(`commiteada la tarea ${run.task}/${run.tasksTotal}: ${sha.slice(0, 7)}`)
  return OUTCOMES.DONE
}

// ---------------------------------------------------------------------------
// Aplicar el resultado a la tabla, y decir qué toca ahora.
// ---------------------------------------------------------------------------
try {
  if (verbo === 'next') verboNext()

  exigirPaso(verbo)
  const outcome = { report: verboReport, controls: verboControls, verdict: verboVerdict, commit: verboCommit }[verbo]()

  if (run.discards >= MAX_DISCARDS && outcome === OUTCOMES.DISCARDED) {
    guardar()
    die(`${run.discards} descartes en este run: se para en vez de seguir pidiendo respuestas que no se pueden leer`, EXIT.NO_VERDICT)
  }

  const antes = run.step
  const transicion = after(run, outcome, DEFAULT_BUDGETS)
  run = transicion.run
  guardar()

  if (transicion.state === RUN_STATES.OPEN) {
    out('')
    out(`siguiente: tarea ${run.task}/${run.tasksTotal}, paso ${run.step} — pregunta con "ct-step next"`)
    process.exit(EXIT.OK)
  }

  out('')
  out(`run ${transicion.state}: tarea ${run.task}/${run.tasksTotal}, ${run.discards} descarte(s)`)
  process.exit(codigoDe(transicion.state, antes, outcome))
} catch (e) {
  guardar()
  err(`excepción no prevista: ${e.stack || e.message}`)
  process.exit(EXIT.UNNAMED)
}

function codigoDe(estado, paso, outcome) {
  switch (estado) {
    case RUN_STATES.DELIVERED:
      out('todas las tareas comiteadas con veredicto PASA: la rama está lista para la pull request.')
      return EXIT.OK
    case RUN_STATES.BLOCKED_COMMIT: return EXIT.PRECONDITION
    case RUN_STATES.BLOCKED_CONTROLS:
      return outcome === OUTCOMES.INDETERMINATE ? EXIT.CONTROLS_UNMEASURED : EXIT.CONTROLS_RED
    case RUN_STATES.BLOCKED_JUDGE:
      // El veto del juez y "no hubo veredicto" cierran por el mismo sitio y
      // significan cosas distintas: uno es un juicio y el otro su ausencia.
      return outcome === OUTCOMES.DISCARDED ? EXIT.NO_VERDICT : EXIT.VETOED
    case RUN_STATES.ABORTED_BUDGET: return EXIT.UNNAMED // aquí nadie mide dinero
    default: return EXIT.UNNAMED
  }
}
