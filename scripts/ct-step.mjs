#!/usr/bin/env node
// ============================================================================
// ct-step.mjs — LA MÁQUINA DE ESTADOS COMO ORÁCULO, NO COMO CONDUCTOR.
//
// El orquestador sigue siendo una sesión de chat (la pregunta literal de D-4
// —"¿deja de serlo?"— sigue contestándose NO): la sesión despachada por
// /ct-next sigue conduciendo, sigue despachando subagentes y sigue abriendo la
// pull request. Lo que cambia es que YA NO DECIDE LA SECUENCIA: la pregunta.
//
// Lo que este fork SÍ tomó (commit 3071d8a; en upstream lo reservaba a José el
// test d4-sigue-siendo-de-jose, borrado en ese mismo commit) es el camino por
// defecto: el kickoff de /ct-next manda conducir consultando este fichero, y
// `dispatch-check --release` exige el run entregado (exit 7 si no).
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
import { CONVENTIONS_FILE, seccionDeVara } from './vara.js'
import {
  readVerdict, readReport, outcomeOfVerdict, commitMessage, findingLocation,
  IMPLEMENTER_TOOLS, JUDGE_TOOLS, PACKAGE_SECTIONS,
  readSliceVerdict, outcomeOfSliceVerdict, sliceVerdictCommitMessage,
  SLICE_JUDGE_TOOLS, SLICE_PACKAGE_SECTIONS,
} from './step-contracts.js'
import { metricRow, metricLine, metricsPath, planSha256, verdictMeasures, metricsRepoRelPath } from './run-metrics.js'
// Slice 10: parseStateSafe lee el campo `senal:` del SLICE.md (ver
// senalDelSlice, abajo, para por qué NO vale la regex de `epic:`), y
// SENAL_AUSENTE es la constante ÚNICA con la que los dos escritores del canal
// (buildStateSeed al sembrar, este módulo al empaquetar el fallback) declaran
// que no hay señal — importada, no copiada, para que no diverjan.
import { parseStateSafe } from './state.js'
import { SENAL_AUSENTE } from './kickoff.js'

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
  // §3.7-A: la Global verification en rojo o inmedible cierra el run A LA
  // PRIMERA (sin reintentos — todo está comiteado). Códigos propios y no los
  // de controls (4/5): la acción siguiente no es la de una tarea con trabajo
  // stageado que corregir, es "no abras la pull request".
  GLOBAL_RED: 11,
  GLOBAL_UNMEASURED: 12,
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
  verdict <fichero.json>    el veredicto del juez: ruling + recorrido de la rúbrica + findings
  commit                    comitea la tarea con el mensaje que compone el plugin
  global                    ejecuta los comandos de ## 8. Global verification, tras la última tarea
  slice-verdict <fichero.json>  el veredicto del juez de SLICE: ruling + recorrido + findings

La secuencia la decide run-machine.js: un verbo que no sea el paso que toca sale
por 9 y dice cuál es. El estado vive en .agent/run-<issue>.json.`

const verbo = process.argv[2]
if (!verbo || verbo.startsWith('--')) die(USAGE, EXIT.USAGE)
if (!['next', 'report', 'controls', 'verdict', 'commit', 'global', 'slice-verdict'].includes(verbo)) {
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
const { tasks, problems, global: globalVerification } = extractTasks(planText)
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
  // Un run entregado no tiene paso siguiente, y se sabe SIN reconstruir la
  // tabla: el cierre bueno se persiste como `closed` (es lo que lee el gate
  // de `dispatch-check --release`). `next` contesta "ya está" y sale bien;
  // cualquier verbo que transicione es el error de secuencia de siempre.
  if (run.closed === RUN_STATES.DELIVERED) {
    if (verbo === 'next') {
      out(`run delivered: las ${run.tasksTotal} tareas del issue ${issue} están comiteadas con veredicto, la Global verification en verde y el slice juzgado. No queda paso — abre la pull request y libera con dispatch-check --release.`)
      process.exit(EXIT.OK)
    }
    die(`el run del issue ${issue} ya está entregado: no queda paso que dar`, EXIT.WRONG_STEP)
  }
  // No se cree el fichero a solas: cruza la tarea que dice el estado con los
  // commits que hay desde baseSha. Adivinar aquí es reimplementar encima de una
  // tarea ya comiteada.
  const hechos = commitsDesde(run.baseSha)
  if (hechos === null) {
    die(`el estado dice baseSha ${run.baseSha}, que no existe en este worktree. Borra ${stateFile} si el run es de otra rama.`, EXIT.PRECONDITION)
  }
  // En `global`/`slice-judge` las `tasksTotal` tareas YA están comiteadas —
  // `run.task` se queda en la última y no en `tasksTotal + 1`, así que la
  // cuenta que toca no es `run.task - 1` sino `tasksTotal` commits enteros.
  // Sin esta rama, cada verbo de las fases nuevas (proceso nuevo, sin estado
  // en memoria) muere aquí antes de llegar a ejecutar nada.
  const esperados = (run.step === STEPS.GLOBAL || run.step === STEPS.SLICE_JUDGE) ? run.tasksTotal : run.task - 1
  if (hechos !== esperados) {
    die(`el estado y git no cuentan lo mismo: el fichero espera ${esperados} commit(s) (tarea ${run.task}, paso ${run.step}) y desde ${run.baseSha.slice(0, 7)} hay ${hechos}. No se sigue a ciegas.`, EXIT.PRECONDITION)
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
// La telemetría: append-only, DOS destinos, y un fallo suyo NO tumba nada.
//
// El diseño la puso solo fuera del repo, con el motivo de `agentic-skills`
// copiado tal cual: "para que ningún `git add` de la slice se lleve la
// telemetría dentro de la pull request". La primera corrida en un repo ajeno
// (jjponz/rust-monitoring#10) refutó la conclusión sin tocar el motivo: las doce
// filas de aquel run existen en `~/.claude/control-tower/log/ct-step.jsonl` DE
// LA MÁQUINA DE QUIEN DESPACHÓ, y en ningún otro sitio. El veredicto del juez
// viajó y se puede leer; las métricas del mismo run, no. Para un loop que se
// evalúa entre dos personas y dos repositorios, unas métricas que solo existen
// en el portátil del que implementó son unas métricas que no existen.
//
// El motivo original era evitar que la telemetría entrara en el diff POR
// ACCIDENTE, arrastrada por un `git add` del implementador. Eso ya tiene
// respuesta, la misma que se le dio al veredicto: la escribe y la stagea el
// PROGRAMA, en una ruta que decide el programa, y se stagea en `commit` —
// después de los controles y del juez. Si estuviera en el índice cuando corren
// los controles, `alcanceDeclarado` la vería como una ruta que el plan no
// declara y vetaría la tarea.
//
// El fichero local sigue siendo el acumulado de la máquina (todos los repos,
// todos los epics); el del repo es el de este slice, y es el que se lee en la
// pull request.
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
// Slice 10: la señal de observabilidad que el despacho sembró en el SLICE.md
// (campo `senal:`, buildStateSeed). Se parsea con `parseStateSafe` y NO con
// la regex de `epic:` porque el YAML de `renderState` pliega y entrecomilla
// los valores largos —y una señal es una frase, no un token— así que una
// regex de línea única la truncaría: la vara del ítem `observabilidad`
// llegaría a medias al juez de slice sin que nadie lo viera. `parseStateSafe`
// ya existe en state.js y nunca lanza; un SLICE.md sin el campo (sembrado por
// un plugin anterior a la columna) sale null y el paquete declara la ausencia
// con SENAL_AUSENTE.
const senalDelSlice = (() => {
  const { meta } = parseStateSafe(readFileSync(join(repoRoot, '.agent', 'SLICE.md'), 'utf8'))
  return typeof meta.senal === 'string' && meta.senal.trim() ? meta.senal.trim() : null
})()
const intento = () => run.controlRetries + run.judgeRetries + run.correctionRetries + 1
// Los dos campos de identidad que el módulo de la fila NO puede ir a buscar (es
// puro): los aporta quien escribe. La versión sale del manifiesto del plugin —un
// `ct-step` reescrito hace incomparables dos runs, igual que un plan reescrito— y
// el actor de la configuración local de git, que es de quien es el coste en
// cuanto las filas de dos máquinas se mezclen en la misma pull request. Los dos
// degradan a su centinela si no se pueden leer: la fila sale igual, con la
// ausencia declarada.
const PLUGIN_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8')).version || null
  } catch {
    return null
  }
})()
const ACTOR = (git(['config', 'user.email'], { allowFail: true }) || '').trim() || null

// La ruta la dicta run-metrics.js, que es quien también se la enseña a
// /ct-harvest: el escritor y el lector no pueden divergir.
const METRICS_REL = metricsRepoRelPath(issue)

function medir(step, measures) {
  // `global` y `slice-judge` no son de ninguna tarea: un `task: 3` en esa fila
  // sería un hueco leído como una afirmación (la misma doctrina que ya impide
  // rellenar con `null` disfrazado de cero en el resto de este fichero).
  const esDeSlice = step === 'global' || step === 'slice-judge'
  const linea = metricLine(metricRow({
    repo: repoSlug, epic: epicDelSlice, issue, plan: planPath, plan_sha256: PLAN_SHA,
    task: esDeSlice ? null : run.task, task_name: esDeSlice ? null : (tarea()?.name ?? null), tasks_total: run.tasksTotal,
    step, attempt: intento(), plugin_version: PLUGIN_VERSION, actor: ACTOR,
  }, measures, { now: new Date().toISOString() }))
  // Los dos destinos se intentan por separado: que el disco de la cuenta esté
  // lleno no puede costarle al repo la fila que viaja, ni al revés.
  for (const destino of [metricsPath('ct-step', { configDir: process.env.CLAUDE_CONFIG_DIR }), join(repoRoot, METRICS_REL)]) {
    try {
      mkdirSync(dirname(destino), { recursive: true })
      appendFileSync(destino, linea)
    } catch (e) {
      err(`aviso: no se pudo escribir la telemetría en ${destino} (${String(e.message).trim()}). Esto sigue: ninguna transición depende de la medida.`)
    }
  }
}

// ---------------------------------------------------------------------------
// LA GUARDIA DEL PASO. Es lo que convierte la secuencia en mecanismo: pedir un
// paso que no toca no se corrige con un aviso, se rechaza.
// ---------------------------------------------------------------------------
const VERBO_DE = {
  report: STEPS.IMPLEMENT, controls: STEPS.CONTROLS, verdict: STEPS.JUDGE, commit: STEPS.COMMIT,
  global: STEPS.GLOBAL, 'slice-verdict': STEPS.SLICE_JUDGE,
}
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
  // §3.7: `global` y `slice-judge` corren DESPUÉS de la última tarea — no hay
  // "tarea N/M" que anunciar, sino el slice entero con sus tareas ya comiteadas.
  if (run.step === STEPS.GLOBAL || run.step === STEPS.SLICE_JUDGE) {
    out(`slice del issue ${issue} — las ${run.tasksTotal} tareas comiteadas`)
  } else {
    out(`tarea ${run.task}/${run.tasksTotal} — ${t.name}`)
  }
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
      // Se repite aquí y no solo en `report` porque este es el momento en el que
      // la sesión escribe la pull request: un aviso dado veinte minutos antes,
      // dos subagentes atrás, ya se ha ido de su contexto.
      if (run.lastSummary) {
        out('')
        out(`Lo que dijo el implementador de esta tarea, por si va en la pull request: ${run.lastSummary}`)
      }
      break
    // §3.7-A: la punta a punta del plan, tras el último commit. La ejecuta el
    // PROGRAMA — nunca un agente que se autoevalúe.
    case STEPS.GLOBAL:
      out('EJECUTA LA GLOBAL VERIFICATION DEL PLAN (no la corre ningún agente, la corre el programa):')
      if (globalVerification.commands.length) {
        for (const c of globalVerification.commands) out(`  $ ${c}`)
      } else {
        out('  el plan declara N/A: ct-step global lo registra y avanza sin ejecutar nada.')
      }
      out('')
      out(`Ejecútalo con:  ct-step global --plan ${planPath} --issue ${issue}`)
      break
    // §3.7-B: la coherencia entre tareas, y si juntas entregan el fin del
    // slice — lo que ningún juez de tarea mira.
    case STEPS.SLICE_JUDGE: {
      const paquete = escribirPaqueteDeSlice()
      const veredicto = join(workDir, 'slice-verdict.json')
      out(`DESPACHA EL JUEZ DE SLICE (subagente ct-slice-judge — declarado SIN Bash: ${SLICE_JUDGE_TOOLS}) con:`)
      out(`  - el paquete de revisión del slice: ${paquete}`)
      out(`  - el plan: ${planPath}`)
      out(`  - el log de la Global verification, YA en verde, por si lo quiere: ${run.lastGlobalLog ?? '(N/A declarado)'}`)
      out(`  - los veredictos de cada tarea, ya comiteados: docs/superpowers/verdicts/issue-${issue}-task-*.json`)
      out(`  - que escriba su veredicto en: ${veredicto}`)
      out('')
      out(`Cuando vuelva:  ct-step slice-verdict ${veredicto} --plan ${planPath} --issue ${issue}`)
      break
    }
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
  // §3.3: la vara del repo cruza el embudo AQUÍ, leída directo del disco y sin
  // ningún agente en medio. Su ausencia no avisa: es el estado normal de casi
  // todo repo hoy, y el juez lo mide como `sin-vara`, no como un error.
  try {
    const ruta = join(repoRoot, CONVENTIONS_FILE)
    if (existsSync(ruta)) {
      const seccion = seccionDeVara(readFileSync(ruta, 'utf8'))
      if (seccion) appendFileSync(brief, seccion)
    }
  } catch (e) {
    err(`aviso: ${CONVENTIONS_FILE} existe y no se ha podido leer (${String(e.message).trim()}): el brief sale sin la vara del repo.`)
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

// El paquete del SLICE entero sale de un RANGO DE COMMITS y no del índice: a
// diferencia de una tarea, aquí todo está ya comiteado — no hay nada stageado
// que juzgar, y el "índice" de la última tarea comiteada está vacío. `##
// Commits` es la pieza que el paquete por tarea no tiene ni necesita (una
// tarea es UN commit sin historia propia que mostrar): la secuencia importa
// para juzgar `coherencia` — una tarea posterior deshaciendo la anterior sólo
// se ve en el orden de los commits, no en el diff acumulado por sí solo.
function escribirPaqueteDeSlice() {
  const paquete = join(workDir, 'slice-review.diff')
  const [SECCION_SENAL, SECCION_COMMITS, SECCION_FILES, SECCION_DIFF] = SLICE_PACKAGE_SECTIONS
  // Slice 10: la señal cruza el embudo AQUÍ, leída del disco (el campo
  // `senal:` que el despacho sembró en el SLICE.md) y sin agente en medio —
  // la misma doctrina del §3.3 con la que la vara del repo viaja en el brief.
  // PRIMERA sección porque es la vara del ítem `observabilidad`: detrás del
  // diff -U10 quedaría enterrada. El fallback SENAL_AUSENTE cubre un SLICE.md
  // sembrado por un plugin anterior a la columna: la ausencia se declara, no
  // se omite, y su texto es exactamente lo que la rúbrica lee como sin-vara.
  writeFileSync(paquete, [
    `# Slice review package: issue #${issue} — ${run.tasksTotal} tasks committed since ${run.baseSha.slice(0, 7)}`,
    '', `## ${SECCION_SENAL}`, senalDelSlice ?? SENAL_AUSENTE,
    '', `## ${SECCION_COMMITS}`, git(['log', '--reverse', '--format=%h %s', `${run.baseSha}..HEAD`]) || '',
    '', `## ${SECCION_FILES}`, git(['diff', '--stat', run.baseSha, 'HEAD']) || '',
    '', `## ${SECCION_DIFF}`, git(['diff', '-U10', run.baseSha, 'HEAD']) || '',
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
  // nuevo sin stagear. Y ANTES de stagear, el índice se VACÍA (reset mixto:
  // el worktree no se toca) — entre intentos el índice acumula: el intento 1
  // pudo stagear una ruta fuera de alcance que el veto devolvió, y sin este
  // reset esa versión viajaría dentro del commit del intento 2 sin que
  // ningún control volviera a verla. Tras reset+add, el índice es
  // EXACTAMENTE lo que el último informe declara — que es lo que se comitea.
  const rutas = report.paths
  git(['reset', '-q'])
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
  // El resumen se IMPRIME. Es el canal por el que el implementador avisa de una
  // skill que no cargó, de una decisión cerrada que obedeció a disgusto o de un
  // problema que vio y no tocó — y hasta aquí no lo leía nadie: no lo imprimía
  // ningún verbo, el juez tiene orden de ignorarlo, y `run.lastSummary` no lo
  // consultaba nadie. Medido en campo (jjponz/rust-monitoring#10): el aviso de
  // que el lockfile commiteado "para CI reproducible" no se hace valer en la
  // integración continua llegó a la pull request solo porque aquella sesión
  // abrió el fichero del informe por iniciativa propia.
  if (report.summary) out(`el implementador dice: ${report.summary}`)
  return OUTCOMES.DONE
}

function verboControls() {
  const t = tarea()
  // El único tiempo que este programa puede medir de verdad: las dos llamadas
  // al modelo las hace la sesión, así que de ellas no hay ni coste ni turnos ni
  // duración. Y es el único que no se puede reconstruir restando `written_at`
  // consecutivos, porque entre dos filas hay latencia de sesión mezclada con
  // trabajo.
  const arranque = Date.now()
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
  medir('controls', { outcome: resultado, controls_log: log, commands: t.commands.length, duration_ms: Date.now() - arranque })
  run = { ...run, lastControlsLog: log }
  out(`controles: ${resultado} (log en ${log})`)
  return resultado
}

// Lo que de verdad se comitea es el ÍNDICE, no la lista que declaró el
// informe: las comprobaciones de alcance miden `git diff --cached` en vez de
// `run.lastPaths`, para que nada stageado —lo declare el informe o no— escape
// al control. Es la segunda mitad del reset de `report`: aquel garantiza que
// el índice sea lo declarado, y esto lo VERIFICA en vez de suponerlo.
const stagedPaths = () => (git(['diff', '--cached', '--name-only']) || '').split('\n').map((l) => l.trim()).filter(Boolean)

// El alcance de la tarea lo decide el PLAN, no el implementador: esta
// comprobación cruza el ÍNDICE (lo que de verdad se va a commitear)
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
  const tocadas = stagedPaths()
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

// Comprueba si `nombre` aparece en el ÍNDICE, acotado a lo stageado (no al
// índice entero del repo). Un plan prescriptivo CITA el
// código verbatim y vive comiteado en docs/, así que buscar en todo el índice
// encuentra siempre el nombre: el retirado "sigue estando" (falso positivo,
// medido en la tarea 1 del slice #5 de repo-pulse) y el prometido "ya está"
// aunque nadie lo escribiera (falso negativo, que es justo el fallo que esta
// comprobación existe para cazar). Sin ficheros stageados no hay dónde mirar,
// y eso es un NO. Compartida por `testsDeclarados` y `bloquesDeclarados`:
// misma pregunta, mismo ámbito, mismo mecanismo.
function enElIndice(nombre) {
  const ambito = stagedPaths()
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
// todas acotadas a lo stageado por la misma razón que `testsDeclarados`:
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
  const tocadas = stagedPaths()

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

// §3.7-A: la punta a punta del plan, ejecutada POR EL PROGRAMA tras la última
// tarea comiteada. Misma maquinaria que los comandos de `controls`
// (`ejecutarControl`: exit code manda, `unmeasured` es una clase distinta de
// rojo), pero sin las comprobaciones de índice — aquí no hay nada stageado:
// el sujeto es el árbol comiteado entero. Un §8 declarado "N/A" llega aquí
// como lista vacía de comandos (plan-tasks.js acepta el N/A con la misma
// tolerancia que el de **Tests:** de una tarea — la razón se pide en la
// plantilla, no la valida ningún programa), se registra y se avanza:
// exigirle un comando sería el guard imposible de F14 aplicado a §8.
function verboGlobal() {
  const arranque = Date.now()
  if (!globalVerification.commands.length) {
    medir('global', { outcome: OUTCOMES.DONE, global_log: null, commands: 0, duration_ms: Date.now() - arranque })
    out('global: done (el plan declara N/A — no hay punta a punta que correr)')
    return OUTCOMES.DONE
  }
  const log = join(workDir, 'global-verification.log')
  const lineas = []
  let resultado = OUTCOMES.DONE
  for (const comando of globalVerification.commands) {
    const medido = ejecutarControl(comando)
    lineas.push(`$ ${comando}`, medido.output ?? '', `-> exit ${medido.code}`, '')
    if (medido.code === 'unmeasured') { resultado = OUTCOMES.INDETERMINATE; break }
    if (medido.code !== 0) { resultado = OUTCOMES.FAILED; break }
  }
  writeFileSync(log, lineas.join('\n'))
  medir('global', { outcome: resultado, global_log: log, commands: globalVerification.commands.length, duration_ms: Date.now() - arranque })
  // `lastGlobalLog` es lo que `next` le enseña al juez de slice: la prueba de
  // que la punta a punta ya corrió, para que no la re-derive del diff.
  run = { ...run, lastGlobalLog: log }
  out(`global: ${resultado} (log en ${log})`)
  return resultado
}

// §3.7-B: el veredicto del slice entero. A diferencia del de tarea, un PASS
// no espera a ningún `commit` — la última tarea ya está comiteada, así que el
// veredicto estrena su propio commit aquí mismo, con la telemetría de las dos
// fases nuevas dentro (las filas de `global` y `slice-judge` se escriben
// después del último commit de tarea, y sin este add no viajarían nunca).
// Un FAIL no deja veredicto trackeado, igual que en el juez de tarea: solo
// viaja el que aprueba — el FAIL cierra el run y lo lee el humano en la
// carpeta del run.
function verboSliceVerdict() {
  // EL INSUMO ANTES QUE EL VEREDICTO, y por el mismo motivo que en
  // `verboVerdict` (ver el comentario largo de ahí, que es donde está el caso
  // de campo): `escribirPaqueteDeSlice` lo invoca SÓLO `next`, así que sin el
  // fichero en disco el juez de slice no tuvo diff acumulado que juzgar.
  const paquete = join(workDir, 'slice-review.diff')
  if (!existsSync(paquete)) {
    const why = `el paquete de revisión del slice no existe (${paquete}): el juez de slice juzgó a ciegas — vuelve a "ct-step next", que es el único paso que lo genera`
    medir('slice-judge', { outcome: 'discarded', why })
    out(`veredicto de slice descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  const { valor, why: porLeer } = leerJson(process.argv[3], 'del veredicto de slice')
  const { verdict, why } = porLeer ? { why: porLeer } : readSliceVerdict(valor)
  if (!verdict) {
    medir('slice-judge', { outcome: 'discarded', why })
    out(`veredicto de slice descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  const outcome = outcomeOfSliceVerdict(verdict)
  medir('slice-judge', { outcome, review_package: paquete, ...verdictMeasures(verdict) })
  if (verdict.ruling === 'PASS') {
    const ruta = join('docs', 'superpowers', 'verdicts', `issue-${issue}-slice.json`)
    mkdirSync(join(repoRoot, 'docs', 'superpowers', 'verdicts'), { recursive: true })
    writeFileSync(join(repoRoot, ruta), JSON.stringify({ issue, tasks_total: run.tasksTotal, verdict }, null, 2) + '\n')
    // Los dos `add` con `allowFail` por la misma doctrina que en `verdict` y
    // `commit`: la evidencia que no puede viajar se avisa, nunca bloquea una
    // entrega cuyo trabajo ya está comiteado entero.
    if (git(['add', '--', ruta], { allowFail: true }) === null) {
      err(`aviso: el veredicto del slice se escribió en ${ruta} pero NO se pudo stagear, así que no viajará en la pull request (¿la ruta está gitignoreada en este repo?). La entrega sigue.`)
    }
    if (existsSync(join(repoRoot, METRICS_REL)) && git(['add', '--', METRICS_REL], { allowFail: true }) === null) {
      err(`aviso: no se pudo stagear la telemetría (${METRICS_REL}) — el veredicto del slice viaja sin ella. ¿La ruta está gitignoreada en este repo?`)
    }
    if ((git(['diff', '--cached', '--name-only']) || '').trim()) {
      let mensaje = null
      try {
        mensaje = sliceVerdictCommitMessage({ issue, tasksTotal: run.tasksTotal })
      } catch (e) {
        err(`aviso: ${String(e.message)} — el veredicto del slice se queda sin commitear. La entrega sigue.`)
      }
      if (mensaje !== null) {
        if (git(['commit', '-m', mensaje], { allowFail: true }) === null) {
          err('aviso: no se pudo commitear el veredicto del slice — la entrega no depende de la evidencia, pero revisa el índice antes de abrir la pull request.')
        } else {
          out(`veredicto del slice comiteado: ${headSha().slice(0, 7)}`)
        }
      }
    } else {
      err('aviso: nada que commitear del veredicto del slice (¿las dos rutas gitignoreadas?) — la entrega sigue.')
    }
  }
  out(`veredicto de slice ${verdict.ruling} con ${verdict.findings.length} hallazgo(s) → ${outcome}`)
  return outcome
}

function verboVerdict() {
  // EL INSUMO ANTES QUE EL VEREDICTO. `next` es el ÚNICO verbo que escribe el
  // paquete de revisión (`escribirPaquete`, arriba; se invoca sólo en el caso
  // JUDGE de `verboNext`), así que si no está en disco el juez no tuvo qué
  // juzgar: juzgó a ciegas. Medido en campo — un agente encadenó
  // report→controls→verdict sin volver a pasar por `next`, y aquel PASS sólo no
  // entró porque el propio juez confesó que no encontraba el paquete. Sin esa
  // confesión, el PASS entraba y la fila de telemetría quedaba nombrando un
  // fichero inexistente. Un paso que exige un insumo y no comprueba que llegó
  // delega su garantía en la honestidad del agente, que es justo lo que este
  // pipeline no hace en ningún otro sitio (los controles no se creen al
  // implementador; el commit no lo hace el implementador; el índice se verifica
  // en vez de suponerse).
  //
  // Y va ANTES de `leerJson` a propósito. Con las dos cosas mal —paquete
  // ausente y JSON ilegible— la fila que hay que escribir es la del paquete:
  // volver a preguntarle al juez arregla un JSON roto, pero no hace aparecer un
  // paquete que nadie generó, así que medir "no se pudo leer el veredicto"
  // mandaría al loop a gastarse los seis descartes contestando al problema que
  // no era, y la telemetría contaría un juez que escribe mal en vez de un
  // conductor que se saltó un paso. La causa manda sobre el síntoma.
  const paquete = join(workDir, `task-${run.task}-review.diff`)
  if (!existsSync(paquete)) {
    const why = `el paquete de revisión no existe (${paquete}): el juez juzgó a ciegas — vuelve a "ct-step next", que es el único paso que lo genera`
    // La fila lleva `outcome` y `why`, y ninguna medida más: exactamente la
    // forma de los otros descartes de este fichero. Sin `ruling` —para
    // `aggregateVerdictMeasures` una fila con `ruling` ES un veredicto, y esto
    // es su ausencia: contarla inflaría el denominador de `rubric_sin_vara`— y
    // sin `review_package`, porque nombrar en la telemetría el fichero que
    // falta es escribir precisamente la fila que apunta a un inexistente que
    // esta guarda existe para no dejar entrar.
    medir('judge', { outcome: 'discarded', why })
    out(`veredicto descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  const { valor, why: porLeer } = leerJson(process.argv[3], 'del veredicto')
  const { verdict, why } = porLeer ? { why: porLeer } : readVerdict(valor)
  if (!verdict) {
    medir('judge', { outcome: 'discarded', why })
    out(`veredicto descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  const outcome = outcomeOfVerdict(verdict)
  const graves = verdict.findings.filter((f) => f.severity !== 'low')
  medir('judge', { outcome, review_package: paquete, ...verdictMeasures(verdict) })
  run = {
    ...run,
    lastVerdict: verdict,
    lastFindings: graves.length ? graves.map((f) => `- [${f.severity}] ${findingLocation(f)}: ${f.what}`).join('\n') : null,
  }
  if (verdict.ruling === 'PASS') {
    // El veredicto VIAJA en la pull request (criterio de cierre de F37: "el
    // PR de un slice trae un veredicto emitido por un agente que no ejecutó
    // nada"): el que aprueba la tarea se escribe en una ruta trackeada y se
    // stagea, así `commit` lo lleva dentro del commit de su tarea. Lo que
    // llega al PR es el JSON del juez, no una frase del mensaje de commit
    // afirmándolo. Con `ruling` y no con el outcome a propósito: un PASS con
    // hallazgos medios ordena correcciones, y si el presupuesto se agota la
    // tarea entrega igual — ese PASS es el veredicto que la aprueba y tiene
    // que viajar (el reset de `report` lo desstagea entre intentos y el PASS
    // siguiente lo reescribe, así al commit llega siempre el último). Se
    // stagea DESPUÉS de los controles a propósito: es un artefacto de la
    // maquinaria, como el plan, no alcance del implementador.
    const ruta = join('docs', 'superpowers', 'verdicts', `issue-${issue}-task-${run.task}.json`)
    mkdirSync(join(repoRoot, 'docs', 'superpowers', 'verdicts'), { recursive: true })
    writeFileSync(join(repoRoot, ruta), JSON.stringify({ issue, task: run.task, task_name: tarea()?.name ?? null, verdict }, null, 2) + '\n')
    // `allowFail`, por la misma razón que el `git add` de la telemetría en
    // `commit`: sin él, un repo que ignore esta ruta hace que la excepción suba
    // y deje la tarea SIN COMITEAR con el run atascado en el paso del juez.
    // Medido. Un veredicto que no puede viajar degrada el criterio de cierre de
    // F37 y hay que verlo —de ahí el aviso, no un silencio—, pero pararlo no lo
    // arregla: el veredicto sigue escrito en la carpeta del run, y quien revisa
    // la pull request ve que no está. El trabajo se comitea; la evidencia de que
    // no viajó se cuenta.
    if (git(['add', '--', ruta], { allowFail: true }) === null) {
      err(`aviso: el veredicto se escribió en ${ruta} pero NO se pudo stagear, así que no viajará en la pull request (¿la ruta está gitignoreada en este repo?). La tarea se comitea igual.`)
    } else {
      out(`veredicto guardado y stageado: ${ruta}`)
    }
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
  // La telemetría entra AQUÍ, con todas las filas de esta tarea ya escritas —
  // incluidas las de los intentos que el juez vetó, que es el dato que dice lo
  // que costaron las vueltas. El `git reset` que `report` hace al empezar cada
  // intento desstagea, no borra contenido, así que siguen en el fichero.
  //
  // Y NO hay fila de `commit`: era la única que se escribía DESPUÉS del commit,
  // así que viajaba dentro del commit de la tarea siguiente y la de la última no
  // viajaba nunca. Lo que llevaba —el sha y el hecho de que la tarea se
  // comiteó— está entero en `git log`. Sin ella, el fichero que se stagea aquí
  // contiene exactamente las filas de esta tarea y de las anteriores, y no queda
  // ninguna fuera de la pull request.
  // `allowFail`, y no por prudencia genérica: sin él este `git add` es el primer
  // camino por el que la telemetría podría tumbar un run, que es justo lo que el
  // diseño prohíbe ("ninguna transición depende de la medida"). Medido: con
  // `docs/` en el .gitignore del repo, `git add` sale con 1, la excepción sube y
  // la tarea se queda SIN COMITEAR con el run atascado. La medida se pierde y el
  // trabajo se comitea, nunca al revés.
  if (existsSync(join(repoRoot, METRICS_REL)) && git(['add', '--', METRICS_REL], { allowFail: true }) === null) {
    err(`aviso: no se pudo stagear la telemetría (${METRICS_REL}) — la tarea se comitea sin ella. ¿La ruta está gitignoreada en este repo?`)
  }
  if (git(['commit', '-m', mensaje], { allowFail: true }) === null) return OUTCOMES.FAILED
  const sha = headSha()
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
  const outcome = {
    report: verboReport, controls: verboControls, verdict: verboVerdict, commit: verboCommit,
    global: verboGlobal, 'slice-verdict': verboSliceVerdict,
  }[verbo]()

  if (run.discards >= MAX_DISCARDS && outcome === OUTCOMES.DISCARDED) {
    guardar()
    die(`${run.discards} descartes en este run: se para en vez de seguir pidiendo respuestas que no se pueden leer`, EXIT.NO_VERDICT)
  }

  const antes = run.step
  const transicion = after(run, outcome, DEFAULT_BUDGETS)
  run = transicion.run
  // El cierre bueno se PERSISTE: "entregado" tiene que poder leerse del
  // fichero sin reconstruir la tabla, porque `dispatch-check --release` lo
  // exige antes de liberar. Un prompt no es un gate; esto es la mitad
  // ct-step del gate.
  if (transicion.state === RUN_STATES.DELIVERED) run = { ...run, closed: RUN_STATES.DELIVERED }
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
      out('las tareas comiteadas, la Global verification en verde y el slice con veredicto PASS: la rama está lista para la pull request.')
      return EXIT.OK
    case RUN_STATES.BLOCKED_COMMIT: return EXIT.PRECONDITION
    case RUN_STATES.BLOCKED_CONTROLS:
      return outcome === OUTCOMES.INDETERMINATE ? EXIT.CONTROLS_UNMEASURED : EXIT.CONTROLS_RED
    case RUN_STATES.BLOCKED_JUDGE:
      // El veto del juez y "no hubo veredicto" cierran por el mismo sitio y
      // significan cosas distintas: uno es un juicio y el otro su ausencia.
      return outcome === OUTCOMES.DISCARDED ? EXIT.NO_VERDICT : EXIT.VETOED
    // §3.7-A: el mismo par que controls (rojo / inmedible), con códigos
    // propios porque la acción siguiente es otra — no hay tarea que corregir,
    // hay una pull request que NO se abre.
    case RUN_STATES.BLOCKED_GLOBAL:
      return outcome === OUTCOMES.INDETERMINATE ? EXIT.GLOBAL_UNMEASURED : EXIT.GLOBAL_RED
    // §3.7-B: el veto del juez de slice es un veto, el mismo código que el del
    // juez de tarea — el descarte nunca cierra por aquí (vuelve a preguntar).
    case RUN_STATES.BLOCKED_SLICE_JUDGE: return EXIT.VETOED
    case RUN_STATES.ABORTED_BUDGET: return EXIT.UNNAMED // aquí nadie mide dinero
    default: return EXIT.UNNAMED
  }
}
