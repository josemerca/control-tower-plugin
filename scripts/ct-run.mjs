#!/usr/bin/env node
// ============================================================================
// ct-run.mjs — EL CONDUCTOR DE LA FASE DE IMPLEMENTACIÓN, COMO PROGRAMA.
//
// Lo que hoy conduce una sesión de chat siguiendo `subagent-driven-development`
// en prosa, aquí lo conduce este bucle: por cada tarea del plan, implementar,
// medir, juzgar y commitear. La secuencia la decide `run-machine.js`, que es
// una tabla; este fichero sólo la obedece y hace el I/O.
//
// Sustituye al conductor, NO a las piezas. `/ct-next` sigue abriendo una sesión
// interactiva por slice, esa sesión sigue escribiendo el plan y pasando el gate
// `plan` con un humano delante, y sigue abriendo la pull request al final. El
// programa se ocupa sólo del tramo que hay entre esas dos cosas.
//
// ---------------------------------------------------------------------------
// LAS TRES PROPIEDADES QUE ESTE FICHERO EXISTE PARA SOSTENER
//
// 1. EL PROGRAMA MIDE, NO EL IMPLEMENTADOR. El agente que escribe el código no
//    declara su tarea verde: el programa ejecuta los comandos que el plan
//    declara en su **Verification:** (por eso hizo falta que fueran
//    ejecutables, ver plan-contract.js) y lee el exit code.
//
// 2. EL PROGRAMA COMITEA, NO EL IMPLEMENTADOR. Es lo que hace que un veto no
//    deje rastro que deshacer. Y por eso el mensaje se valida con
//    `closing-keywords.js` antes de commitear: el hook `commit-keyword-guard`
//    es un PreToolUse sobre la herramienta Bash de una SESIÓN, y un `git
//    commit` lanzado por un programa no pasa por esa puerta.
//
// 3. EL SITIO EN EL QUE VA ESTÁ EN DISCO, NO EN UNA CONVERSACIÓN. El ledger de
//    `subagent-driven-development` existe porque la memoria de una sesión no
//    sobrevive a una compactación. Aquí el estado es un fichero y el programa
//    es reanudable, así que esa prótesis desaparece.
//
// ---------------------------------------------------------------------------
// POR QUÉ EN BACKGROUND: una slice de 8 tareas son 16 llamadas al modelo, y una
// llamada de Bash en primer plano topa a 10 minutos. La sesión lo lanza una vez
// y lee después el código de salida y las rutas — nunca los contenidos.
//
// LOS CANALES, como en el resto del repo: stdout es el producto (el resumen del
// run, una línea por turno), stderr es el diagnóstico. La tabla de códigos de
// salida está al final, y cada fila dice si reinvocar sirve.
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, writeSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { after, newRun, STEPS, OUTCOMES, RUN_STATES, DEFAULT_BUDGETS } from './run-machine.js'
import { extractTasks } from './plan-tasks.js'
import {
  buildArgv, readEnvelope, readVerdict, readReport, outcomeOfVerdict, commitMessage,
  VERDICT_SCHEMA, REPORT_SCHEMA, IMPLEMENTER_TOOLS, JUDGE_TOOLS,
} from './harness.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// Códigos de salida — uno por DECISIÓN, no uno por excepción (§9 del spec).
const EXIT = {
  DELIVERED: 0,       // todas las tareas comiteadas con veredicto PASA
  VETOED: 1,          // el juez veta y se agotaron los reintentos
  USAGE: 2,           // error de uso
  NO_VERDICT: 3,      // no hay veredicto de fiar, o claude no se pudo lanzar
  CONTROLS_RED: 4,    // los controles siguen en rojo tras los reintentos
  CONTROLS_UNMEASURED: 5, // no se pudieron MEDIR
  PLAN_NOT_EXECUTABLE: 6, // el plan no declara comandos ejecutables
  OVER_BUDGET: 7,     // tope de dinero agotado con el run abierto
  PRECONDITION: 8,    // entorno: no es un worktree de slice, índice sucio, falta claude
  UNNAMED: 10,        // excepción que el programa no sabe nombrar
}

// Un run que descarta sin parar no lo frena el tope de dinero hasta muy tarde:
// un juez que nunca cumple el esquema son llamadas baratas repetidas cientos de
// veces. El spec dejaba este camino respaldado sólo por el dinero; medido el
// coste por llamada, eso son horas. Seis descartes es holgado y acotado.
const MAX_DISCARDS = 6

// ---------------------------------------------------------------------------
// Canales y muerte
// ---------------------------------------------------------------------------
function safeWrite(fd, text) {
  try { writeSync(fd, text) } catch { /* tubería cerrada: la línea se pierde, el exit code no cambia */ }
}
const out = (msg) => safeWrite(1, msg + '\n')
const err = (msg) => safeWrite(2, msg + '\n')
const die = (msg, code) => { err(msg); process.exit(code) }

// ---------------------------------------------------------------------------
// argv, con el mismo endurecimiento que ct-next.mjs y dispatch-check.mjs: un
// flag colgante nunca llega a `execFileSync` como valor.
// ---------------------------------------------------------------------------
const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}
const has = (f) => process.argv.includes(f)

const USAGE = `uso: ct-run --plan <fichero> --issue <n> [--max-usd 50] [--dry-run]

  --plan                 el plan prescriptivo del slice, ya pasado por el gate
  --issue                el issue del slice (nombra el fichero de estado)
  --max-usd              tope de dinero de la slice entera (defecto: 50)
  --model                modelo de las dos llamadas (defecto: el de la cuenta)
  --model-judge          modelo sólo del juez, si tiene que ser otro
  --allow-default-account  no exigir CLAUDE_CONFIG_DIR (la llamada usa la cuenta por defecto)
  --dry-run              no llama al modelo ni ejecuta los controles: los lee de
                         CT_RUN_HARNESS_FIXTURE y CT_RUN_CONTROLS_FIXTURE`

const dryRun = has('--dry-run')
const planPath = arg('--plan')
const issueRaw = arg('--issue')
const maxUsdRaw = arg('--max-usd', '50')
const modelo = typeof arg('--model') === 'string' ? arg('--model') : null
const modeloJuez = typeof arg('--model-judge') === 'string' ? arg('--model-judge') : modelo

// Las variables de fixture son EXCLUSIVAMENTE para tests. Si quedan colgadas en
// el entorno sin --dry-run, el programa no decide con datos fabricados ni, sobre
// todo, comitea con ellos de fondo: es el idioma de dispatch-check.mjs.
for (const v of ['CT_RUN_HARNESS_FIXTURE', 'CT_RUN_CONTROLS_FIXTURE']) {
  if (process.env[v] && !dryRun) {
    die(`${v} está definida pero falta --dry-run: por seguridad no se conduce una slice real con respuestas de fixture. Añade --dry-run o limpia la variable.`, EXIT.USAGE)
  }
}

if (typeof planPath !== 'string' || !planPath) die(USAGE, EXIT.USAGE)
if (typeof issueRaw !== 'string' || !/^\d+$/.test(issueRaw)) {
  // parseInt es tolerante ('42x' es 42) y este número nombra el fichero de
  // estado del run: un argumento con basura de cola reanudaría otro run.
  die(`--issue debe ser un número entero: recibí ${JSON.stringify(issueRaw)}`, EXIT.USAGE)
}
if (typeof maxUsdRaw !== 'string' || !/^\d+(\.\d+)?$/.test(maxUsdRaw)) {
  die(`--max-usd debe ser un número: recibí ${JSON.stringify(maxUsdRaw)}`, EXIT.USAGE)
}
const issue = Number(issueRaw)
const maxUsd = Number(maxUsdRaw)

// ---------------------------------------------------------------------------
// git, siempre por execFileSync y con los límites explícitos del repo
// (ct-status.mjs:127): un default de 1 MiB de buffer se queda corto con un diff
// de verdad, y un comando sin timeout cuelga el run entero.
// ---------------------------------------------------------------------------
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
// Precondiciones (exit 8). Todas comprueban algo que, de faltar, haría que el
// run gastase dinero para acabar mal.
// ---------------------------------------------------------------------------
const repoRoot = (git(['rev-parse', '--show-toplevel'], { allowFail: true }) || '').trim()
if (!repoRoot) die('no estamos dentro de un repositorio git', EXIT.PRECONDITION)

if (!existsSync(join(repoRoot, '.agent', 'SLICE.md'))) {
  die('esto no es el worktree de un slice (falta .agent/SLICE.md). ct-run conduce el tramo interno de una slice, no un repo cualquiera.', EXIT.PRECONDITION)
}
// El índice tiene que estar limpio ANTES de empezar: el programa stagea las
// rutas que declara el implementador y comitea el índice, así que algo stageado
// de antes viajaría dentro del primer commit sin que nadie lo haya decidido.
//
// Sólo en un run NUEVO. Un run que se reanuda encuentra el índice lleno por
// construcción —el implementador stagea y el juez vetó, o el programa murió
// entre medias— y esa suciedad es precisamente el trabajo que se está
// retomando. Exigirlo también al reanudar convertía cada veto en un run
// irrecuperable.
const stateFileTemprano = join(repoRoot, '.agent', `run-${issue}.json`)
if (!existsSync(stateFileTemprano) && (git(['diff', '--cached', '--name-only']) || '').trim()) {
  die('el índice tiene cambios stageados. ct-run comitea el índice tarea a tarea: vacíalo antes (git reset) o comitéalo tú.', EXIT.PRECONDITION)
}
if (!dryRun) {
  if (!binarioEnPath('claude')) die('falta `claude` en el PATH', EXIT.PRECONDITION)
  // El wrapper de cuenta sólo exporta CLAUDE_CONFIG_DIR (kickoff.js:73-74) y un
  // proceso hijo la hereda. Sin ella, las llamadas irían a la cuenta por
  // defecto, que puede no ser la del loop — y eso son 16 llamadas cargadas a
  // quien no toca.
  if (!process.env.CLAUDE_CONFIG_DIR && !has('--allow-default-account')) {
    die('CLAUDE_CONFIG_DIR no está definida: no se puede saber con qué cuenta se pagarían las llamadas. Lanza ct-run desde la sesión despachada, o pasa --allow-default-account a conciencia.', EXIT.PRECONDITION)
  }
}

function binarioEnPath(nombre) {
  try {
    execFileSync('sh', ['-c', `command -v ${nombre}`], { stdio: 'ignore' })
    return true
  } catch { return false }
}

// ---------------------------------------------------------------------------
// El plan: la lista de tareas y su vara (exit 6 si no es ejecutable)
// ---------------------------------------------------------------------------
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
// El estado del run. Vive en .agent/run-<issue>.json, ignorado por git: lo que
// vive en GitHub es el estado del SLICE, y durante todo el run el issue sigue en
// status:in-progress sin ninguna transición que publicar.
// ---------------------------------------------------------------------------
const stateFile = join(repoRoot, '.agent', `run-${issue}.json`)
const workDir = join(repoRoot, '.agent', `run-${issue}`)
mkdirSync(workDir, { recursive: true })

const baseShaActual = () => (git(['rev-parse', 'HEAD']) || '').trim()
const commitsDesde = (sha) => {
  const salida = git(['rev-list', '--count', `${sha}..HEAD`], { allowFail: true })
  return salida === null ? null : Number(salida.trim())
}

let run
if (existsSync(stateFile)) {
  const guardado = JSON.parse(readFileSync(stateFile, 'utf8'))
  // AL REANUDAR, EL PROGRAMA NO SE CREE EL FICHERO A SOLAS. Cruza la tarea que
  // dice el estado con los commits que hay desde baseSha: si discrepan, para.
  // Adivinar aquí significa reimplementar encima de una tarea ya comiteada.
  const hechos = commitsDesde(guardado.baseSha)
  if (hechos === null) {
    die(`el estado en ${stateFile} dice baseSha ${guardado.baseSha}, que no existe en este worktree. Borra el fichero si el run es de otra rama.`, EXIT.PRECONDITION)
  }
  const esperados = guardado.task - 1
  if (hechos !== esperados) {
    die(`el estado y git no cuentan lo mismo: el fichero va por la tarea ${guardado.task} (o sea ${esperados} commits) y desde ${guardado.baseSha.slice(0, 7)} hay ${hechos}. No se reanuda a ciegas.`, EXIT.PRECONDITION)
  }
  run = guardado
  out(`reanudando el run del issue #${issue} en la tarea ${run.task}/${run.tasksTotal}, paso ${run.step}`)
} else {
  run = newRun({ plan: planPath, issue, baseSha: baseShaActual(), tasksTotal: tasks.length })
  out(`run nuevo: issue #${issue}, ${tasks.length} tareas, base ${run.baseSha.slice(0, 7)}, tope ${maxUsd} USD`)
}

const guardar = () => writeFileSync(stateFile, JSON.stringify(run, null, 2) + '\n')

// ---------------------------------------------------------------------------
// El arnés: la única puerta por la que se llama al modelo.
// ---------------------------------------------------------------------------
const fixtureCalls = dryRun && process.env.CT_RUN_HARNESS_FIXTURE
  ? JSON.parse(process.env.CT_RUN_HARNESS_FIXTURE)
  : null
let fixtureCall = 0

function llamar({ paso, tools, schema, prompt, model }) {
  if (fixtureCalls) {
    const siguiente = fixtureCalls[fixtureCall++]
    if (!siguiente) return { ok: false, why: 'la fixture del arnés se quedó sin respuestas' }
    return readEnvelope(typeof siguiente === 'string' ? siguiente : JSON.stringify(siguiente))
  }
  const argv = buildArgv({ tools, schema, prompt, model })
  try {
    const stdout = execFileSync('claude', argv, {
      encoding: 'utf8',
      // stdin CERRADO: sin esto el binario espera 3 segundos a la entrada
      // estándar en cada llamada, medido.
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: repoRoot,
      maxBuffer: GIT_MAX_BUFFER,
      timeout: 30 * 60_000,
      killSignal: 'SIGKILL',
    })
    return readEnvelope(stdout)
  } catch (e) {
    return { ok: false, why: `no se pudo lanzar claude para el paso ${paso}: ${String(e.stderr || e.message).trim().slice(0, 400)}` }
  }
}

// El gasto se acumula con lo que dice el binario (total_cost_usd), no con una
// estimación del programa. El tope se comprueba ANTES de la llamada siguiente.
const hayPresupuesto = () => run.spendUsd < maxUsd

const tarea = () => tasks.find((t) => t.n === run.task)
const turno = (texto) => out(`[tarea ${run.task}/${run.tasksTotal}] ${texto}`)

// ---------------------------------------------------------------------------
// Paso IMPLEMENT
// ---------------------------------------------------------------------------
function implementar() {
  const brief = join(workDir, `task-${run.task}-brief.md`)
  try {
    execFileSync(join(PLUGIN_ROOT, 'skills', 'subagent-driven-development', 'scripts', 'task-brief'),
      [planPath, String(run.task), brief], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    throw new Error(`no se pudo extraer el brief de la tarea ${run.task}: ${String(e.stderr || e.message).trim()}`)
  }

  const prompt = [
    readFileSync(join(PLUGIN_ROOT, 'prompts', 'task-implementer.md'), 'utf8'),
    '',
    '---',
    '',
    '## This call',
    '',
    `- Task brief: \`${brief}\` — read it first.`,
    `- Task ${run.task} of ${run.tasksTotal} of the plan at \`${planPath}\`.`,
    ...(run.lastFindings ? ['', '### The judge sent this back', '', run.lastFindings] : []),
  ].join('\n')

  const env = llamar({ paso: 'implement', tools: IMPLEMENTER_TOOLS, schema: REPORT_SCHEMA, prompt, model: modelo })
  run = { ...run, spendUsd: run.spendUsd + (env.costUsd || 0) }
  if (!env.ok) { turno(`implementador: ${env.why}`); return { outcome: OUTCOMES.DISCARDED, fatal: env.why } }

  const { report, why } = readReport(env.structured)
  if (!report) { turno(`informe descartado: ${why}`); return { outcome: OUTCOMES.DISCARDED } }

  turno(`implementado (${report.paths.length} ficheros, sesión ${env.sessionId ?? 'sin id'}, ${env.costUsd.toFixed(4)} USD)`)
  // Se stagea ANTES de medir: un control que lee el índice —o que compila lo
  // que git le dice que hay— no ve un fichero nuevo sin stagear.
  git(['add', '--', ...report.paths])
  run = { ...run, lastPaths: report.paths, lastSummary: report.summary }
  return { outcome: OUTCOMES.DONE }
}

// ---------------------------------------------------------------------------
// Paso CONTROLS — aquí no hay modelo: los comandos del plan y su exit code.
// ---------------------------------------------------------------------------
const controlsFixture = dryRun && process.env.CT_RUN_CONTROLS_FIXTURE
  ? JSON.parse(process.env.CT_RUN_CONTROLS_FIXTURE)
  : null
let controlsRonda = 0

// LOS TESTS QUE LA TAREA DIJO QUE AÑADÍA TIENEN QUE EXISTIR.
//
// Esto no estaba, y la primera corrida real del conductor enseñó por qué hace
// falta: la tarea 2 pedía `mul()` y su test, el implementador escribió `mul()`
// y NO escribió el test, y `node --test` volvió verde — porque la suite del
// commit anterior seguía pasando. La vara del plan mide que nada se rompió, no
// que se haya añadido lo que la tarea prometía. Sin esta comprobación, lo único
// que separaba esa tarea de entrar en un commit era el juicio de un modelo.
//
// Se busca en el ÍNDICE (`--cached`) y no en el worktree, porque el índice es
// exactamente lo que se va a commitear: un test que existe en un fichero sin
// stagear no está en la tarea.
function testsDeclarados(t) {
  const fallos = []
  const enElIndice = (nombre) => {
    try {
      execFileSync('git', ['grep', '--cached', '--quiet', '-F', '--', nombre], {
        cwd: repoRoot, stdio: 'ignore', timeout: 60_000,
      })
      return true
    } catch { return false }
  }
  for (const nombre of t.testsAdded) {
    if (!enElIndice(nombre)) fallos.push(`la tarea dijo que añadía el test '${nombre}' y no está en lo stageado`)
  }
  // Y el que la tarea retira a propósito no puede seguir ahí: si sigue, o no se
  // retiró, o se retiró otro.
  for (const nombre of t.testsRemoved) {
    if (enElIndice(nombre)) fallos.push(`la tarea dijo que retiraba el test '${nombre}' y sigue estando`)
  }
  return fallos
}

function controlar() {
  const t = tarea()
  const log = join(workDir, `task-${run.task}-controls-${++controlsRonda}.log`)
  const lineas = []
  let resultado = OUTCOMES.DONE

  // Primero los nombres, que son gratis: si la tarea no trajo lo que prometía,
  // no hace falta pagar una suite entera para saberlo.
  if (!controlsFixture) {
    const fallos = testsDeclarados(t)
    if (fallos.length) {
      lineas.push('# tests declarados por la tarea', ...fallos.map((f) => `- ${f}`), '')
      resultado = OUTCOMES.FAILED
    }
  }

  for (const comando of resultado === OUTCOMES.FAILED ? [] : t.commands) {
    const medido = controlsFixture
      ? (controlsFixture[controlsRonda - 1] ?? { code: 0, output: 'fixture sin ronda' })
      : ejecutarControl(comando)
    lineas.push(`$ ${comando}`, medido.output ?? '', `-> exit ${medido.code}`, '')
    if (medido.code === 'unmeasured') { resultado = OUTCOMES.INDETERMINATE; break }
    if (medido.code !== 0) { resultado = OUTCOMES.FAILED; break }
  }

  writeFileSync(log, lineas.join('\n'))
  run = { ...run, lastControlsLog: log }
  turno(`controles: ${resultado} (log en ${log})`)
  return { outcome: resultado }
}

function ejecutarControl(comando) {
  try {
    const stdout = execFileSync('sh', ['-c', comando], {
      encoding: 'utf8', cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: GIT_MAX_BUFFER, timeout: 20 * 60_000, killSignal: 'SIGKILL',
    })
    return { code: 0, output: stdout }
  } catch (e) {
    // La distinción que la tabla necesita: un comando que corrió y dijo que no
    // (código numérico) es ROJO y se reintenta; uno que no se pudo ejecutar o
    // que se colgó no se pudo MEDIR, y reintentarlo a ciegas repite el coste.
    const seColgo = e.killed || e.signal === 'SIGKILL' || e.code === 'ETIMEDOUT'
    const noExiste = e.status === 127 || e.code === 'ENOENT'
    const code = (seColgo || noExiste) ? 'unmeasured' : (typeof e.status === 'number' ? e.status : 'unmeasured')
    return { code, output: String(e.stdout || '') + String(e.stderr || '') }
  }
}

// ---------------------------------------------------------------------------
// Paso JUDGE
// ---------------------------------------------------------------------------
function juzgar() {
  // El paquete de revisión se compone aquí y no con
  // skills/subagent-driven-development/scripts/review-package porque aquél
  // diffea un rango de COMMITS y en este diseño el implementador no comitea: lo
  // que hay que juzgar está en el índice.
  const paquete = join(workDir, `task-${run.task}-review-${Date.now()}.diff`)
  writeFileSync(paquete, [
    `# Review package: task ${run.task}/${run.tasksTotal} of issue #${issue} (staged, not yet committed)`,
    '', '## Files changed', git(['diff', '--cached', '--stat']) || '',
    '', '## Diff', git(['diff', '--cached', '-U10']) || '',
  ].join('\n'))

  const prompt = [
    readFileSync(join(PLUGIN_ROOT, 'prompts', 'task-judge.md'), 'utf8'),
    '',
    '---',
    '',
    '## This call',
    '',
    `- Review package (the diff): \`${paquete}\``,
    `- Task brief: \`${join(workDir, `task-${run.task}-brief.md`)}\``,
    `- Control logs (already green; you are not expected to read them): \`${run.lastControlsLog}\``,
    `- The implementer's own summary, for context only: ${JSON.stringify(run.lastSummary ?? '')}`,
  ].join('\n')

  const env = llamar({ paso: 'judge', tools: JUDGE_TOOLS, schema: VERDICT_SCHEMA, prompt, model: modeloJuez })
  run = { ...run, spendUsd: run.spendUsd + (env.costUsd || 0) }
  if (!env.ok) { turno(`juez: ${env.why}`); return { outcome: OUTCOMES.DISCARDED, fatal: env.why } }

  const { verdict, why } = readVerdict(env.structured)
  if (!verdict) { turno(`veredicto descartado: ${why}`); return { outcome: OUTCOMES.DISCARDED } }

  const outcome = outcomeOfVerdict(verdict)
  const graves = verdict.findings.filter((f) => f.severity !== 'low')
  run = {
    ...run,
    lastVerdict: verdict,
    lastFindings: graves.length
      ? graves.map((f) => `- [${f.severity}] ${f.where}: ${f.what}`).join('\n')
      : null,
  }
  turno(`veredicto ${verdict.ruling} con ${verdict.findings.length} hallazgo(s) → ${outcome} (${env.costUsd.toFixed(4)} USD)`)
  return { outcome }
}

// ---------------------------------------------------------------------------
// Paso COMMIT — lo hace el programa, con su mensaje validado.
// ---------------------------------------------------------------------------
function commitear() {
  const t = tarea()
  let mensaje
  try {
    mensaje = commitMessage({ issue, task: run.task, tasksTotal: run.tasksTotal, name: t.name })
  } catch (e) {
    err(String(e.message))
    return { outcome: OUTCOMES.FAILED }
  }
  if (!(git(['diff', '--cached', '--name-only']) || '').trim()) {
    err(`la tarea ${run.task} no dejó nada stageado: no hay nada que commitear`)
    return { outcome: OUTCOMES.FAILED }
  }
  const hecho = git(['commit', '-m', mensaje], { allowFail: true })
  if (hecho === null) return { outcome: OUTCOMES.FAILED }
  turno(`commiteada: ${baseShaActual().slice(0, 7)}`)
  run = { ...run, lastFindings: null, lastPaths: null, lastSummary: null }
  return { outcome: OUTCOMES.DONE }
}

// ---------------------------------------------------------------------------
// EL BUCLE
// ---------------------------------------------------------------------------
// Los dos pasos que llaman al modelo. Los otros dos —medir y commitear— son
// locales y gratis.
const PAGAN = { [STEPS.IMPLEMENT]: true, [STEPS.JUDGE]: true }

const PASOS = {
  [STEPS.IMPLEMENT]: implementar,
  [STEPS.CONTROLS]: controlar,
  [STEPS.JUDGE]: juzgar,
  [STEPS.COMMIT]: commitear,
}

let cierre = null
let ultimoOutcome = null
let fatal = null

try {
  while (!cierre) {
    // El tope se mira antes de una LLAMADA AL MODELO, que es lo que cuesta
    // dinero — nunca antes de medir o de commitear. Medido con el test del
    // tope: cortar antes del commit tira a la basura una tarea implementada y
    // juzgada, o sea el trabajo ya pagado, y deja el worktree con el índice
    // lleno para que lo recoja un humano.
    if (PAGAN[run.step] && !hayPresupuesto()) {
      const t = after(run, OUTCOMES.OVER_BUDGET, DEFAULT_BUDGETS)
      run = t.run; cierre = t.state
      err(`tope de dinero agotado: ${run.spendUsd.toFixed(4)} de ${maxUsd} USD`)
      break
    }
    if (run.discards > MAX_DISCARDS) {
      cierre = RUN_STATES.BLOCKED_JUDGE
      ultimoOutcome = OUTCOMES.DISCARDED
      err(`${run.discards} descartes en este run: se para en vez de seguir pagando llamadas que no se pueden leer`)
      break
    }

    const paso = run.step
    const resultado = PASOS[paso]()
    ultimoOutcome = resultado.outcome
    if (resultado.fatal) fatal = resultado.fatal

    const transicion = after(run, resultado.outcome, DEFAULT_BUDGETS)
    run = transicion.run
    if (transicion.state !== RUN_STATES.OPEN) cierre = transicion.state
    guardar()
  }
} catch (e) {
  guardar()
  err(`excepción no prevista: ${e.stack || e.message}`)
  process.exit(EXIT.UNNAMED)
}

guardar()
out(`run ${cierre}: tarea ${run.task}/${run.tasksTotal}, ${run.discards} descarte(s), ${run.spendUsd.toFixed(4)} USD`)
process.exit(codigoDe(cierre))

// La traducción del §9: cada código dice si reinvocar sirve, y `1` (un veto) no
// es lo mismo que `3` (no hay veredicto). Un booleano perdería esa distinción.
function codigoDe(estado) {
  switch (estado) {
    case RUN_STATES.DELIVERED: return EXIT.DELIVERED
    case RUN_STATES.ABORTED_BUDGET: return EXIT.OVER_BUDGET
    case RUN_STATES.BLOCKED_COMMIT: return EXIT.PRECONDITION
    case RUN_STATES.BLOCKED_CONTROLS:
      return ultimoOutcome === OUTCOMES.INDETERMINATE ? EXIT.CONTROLS_UNMEASURED : EXIT.CONTROLS_RED
    case RUN_STATES.BLOCKED_JUDGE:
      // El veto del juez y "no hubo veredicto" cierran por el mismo sitio y
      // significan cosas distintas: uno es un juicio y el otro es su ausencia.
      return (ultimoOutcome === OUTCOMES.DISCARDED || fatal) ? EXIT.NO_VERDICT : EXIT.VETOED
    default: return EXIT.UNNAMED
  }
}
