// ============================================================================
// PLAN-CONTRACT — el contrato del plan prescriptivo de un slice.
//
// El plan que escribe el agente despachado (writing-plans-prescriptive) es el
// artefacto que cruza la frontera hacia los subagentes por task: si miente
// —secciones que faltan, código citado de memoria que no existe en el repo,
// placeholders sin rellenar— los subagentes lo ejecutan igual, porque no
// tienen contexto para dudar. Este módulo convierte ese contrato de prosa en
// comprobación, con la misma doctrina que el resto del plugin: una
// comprobación que solo imprime no es una comprobación.
//
// La pieza que no tiene equivalente en ningún otro sitio del plugin es la
// LITERALIDAD: cada bloque `Current state (path):` del plan debe existir
// verbatim en el fichero que cita. Es el detector de código citado de
// memoria — el modo de fallo número uno de un plan escrito por un agente.
//
// Módulo PURO a propósito (misma razón que gates.js/slices.js): toda la
// lógica es testeable sin harness; el I/O entra por inyección (`readFile`) y
// quien lo cablea (dispatch-check.mjs) aporta el filesystem real.
// ============================================================================

import { extractTasks } from './plan-tasks.js'

const BLOCKQUOTE_MARKER = 'This plan is written to be executed by task-scoped subagents'

export const PLAN_SECTIONS = [
  '## 1. Context and goal',
  '## 2. Closed decisions',
  '## 3. Reference patterns',
  '## 4. Inventory',
  '## 5. Interfaces',
  '## 6. Test strategy',
  '## 7. Tasks',
  '## 8. Global verification',
  '## 9. Assumptions',
]

const SUBSECTIONS = ['### Desired end state', '### Out of scope']

const TASK_MARKERS = ['**Objective:**', '**Files:**', '**TDD:**', '**Tests:**', '**Verification:**']

// Tokens que delatan una decisión abierta o un placeholder. Solo se buscan
// FUERA de los bloques de código: un plan puede citar legítimamente un
// fichero cuyo contenido diga cualquiera de estas cosas.
const FORBIDDEN = [
  [/\bTBD\b/, 'TBD'],
  [/TODO:/, 'TODO:'],
  [/\bFIXME\b/, 'FIXME'],
  [/similar to Task/i, '"similar to Task N" (repite el contenido)'],
  [/to be decided/i, '"to be decided"'],
  [/<!--/, 'comentario HTML sin resolver'],
  [/(^|[^$])\{\{/, 'placeholder {{...}} sin rellenar'],
]

const TASK_HEADING = /^### Task (\d+) — /
const CURRENT_STATE = /^Current state \(([^),]+)(?:,[^)]*)?\):\s*$/

// ============================================================================
// F-jjponz-4 — LA TAXONOMÍA DE BLOQUES.
//
// La primera versión de la skill ordenaba pegar "the complete final content" de
// cada fichero. Medido en campo (slice #2 de repo-pulse): 73.868 caracteres de
// plan, 1.271 líneas de código (65%), publicado partido en DOS comentarios
// porque no cabía en uno; y de sus 14 commits, CINCO arreglaban defectos que
// venían pegados en el plan — una fuga de directorio, un `catch` desnudo que se
// tragaba fallos reales de git, un tipo exportado que filtraba emails, un texto
// de documentación que afirmaba algo falso y cuatro vectores de test que no
// pinchaban el umbral que decían pinchar. Un cuerpo escrito a ciegas, sin
// compilador y sin ejecutar nada, llega con defectos y nadie los ve: el gate
// humano `plan` que debía cazarlos tenía 74k caracteres que revisar.
//
// Por qué el rol y no un límite de líneas: un tope bruto rechazaría un fichero
// de tipos legítimo (el mayor medido, 71 líneas) y aceptaría un cuerpo de 25.
// Lo que se comprueba es QUÉ es cada bloque. Así el rechazo mecánico coincide
// con el criterio semántico —el plan cierra DECISIONES y deja los CUERPOS al
// TDD— y de paso el humano lee el plan como un índice de roles.
// ============================================================================

// UN FOLIO A4 POR TAREA: a un espacio y con márgenes normales, una página da
// unas 50 líneas y ~3.500 caracteres. La unidad es la TAREA, no el plan, y el
// motivo es una medida de campo (F-jjponz-5).
//
// La primera versión puso el folio al plan entero. Resultado medido sobre los
// transcripts de las sesiones despachadas: el agente invocó `--check-plan` 24
// veces en un slice y 14 en otro, y de esas, 14 y 9 fallaron por `size`. O sea
// que la mayor parte de esas vueltas no fue pensar el slice: fue limar
// caracteres. Y la salida que el diseño asumía —«si no cabe, el slice son
// dos»— el agente NO puede accionarla: viene despachado para un issue
// congelado, así que hizo lo único que podía, colapsar tareas (un slice acabó
// siendo un commit con cuatro endpoints y cuatro módulos, justo lo que «una
// tarea = un commit» quiere evitar).
//
// Una TAREA sí la puede partir el agente. Por eso el techo va donde el remedio
// es accionable, y no hay ningún tope agregado por plan: un plan de doce
// tareas es un slice mal cortado, y eso se arregla en la congelación del spec,
// que es donde hay un humano.
export const ROLE_BUDGETS = { 'Current state': 12, Contract: 25, 'Call site': 10, 'Final text': 12 }
export const COMMAND_BUDGET = 8
export const CODE_BUDGETS = { task: 30, chars: 3500 }

const ROLE_LABELS = [
  ['Current state', CURRENT_STATE],
  ['Contract', /^Contract \(([^),]+)(?:,[^)]*)?\):\s*$/],
  ['Call site', /^Call site \(([^),]+)(?:,[^)]*)?\):\s*$/],
  ['Final text', /^Final text \(([^),]+)(?:,[^)]*)?\):\s*$/],
]

const ROLE_MENU =
  'Todo bloque va precedido por una de estas cuatro etiquetas: "Current state (path):" (el ' +
  'tramo de hoy, que se comprueba verbatim), "Contract (path):" (tipos, firmas, errores ' +
  'tipados y constantes que el implementador no puede deducir), "Call site (path):" (cómo ' +
  'queda la llamada en el consumidor) o "Final text (path.md):" (texto cuyo valor literal ES ' +
  'el entregable). Los comandos van con su lenguaje (```bash) o detrás de **Verification:**. ' +
  'Un cuerpo de módulo no tiene etiqueta porque no va en el plan: lo escribe el implementador, ' +
  'en rojo primero.'

const TEXT_EXTENSIONS = ['.md', '.txt', '.rst', '.adoc']
const CONFIG_EXTENSIONS = ['.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.lock', '.properties', '.env']
const CONFIG_BASENAMES = ['.gitignore', '.dockerignore', '.npmrc', '.editorconfig', 'Dockerfile', 'Makefile']
const TEST_PATH = /(\.|_)(test|spec)\.|(^|\/)(__tests__|tests?)\//
const COMMAND_LANGS = new Set(['bash', 'sh', 'shell', 'console', 'zsh'])
const NO_CODE = /^No code — .+/

const ends = (path, list) => list.some((ext) => path.toLowerCase().endsWith(ext))
const isText = (path) => ends(path, TEXT_EXTENSIONS)

// Si un token entre comillas invertidas de §3 es una ruta del repo que hay que
// comprobar. Ver el porqué largo junto a la regla `reference-paths`, al final de
// validatePlan.
const esRutaCitada = (t) => !t.endsWith('/') && !/\s/.test(t) && (t.includes('/') || isText(t))
const isTest = (path) => TEST_PATH.test(path)
const isConfig = (path) =>
  ends(path, CONFIG_EXTENSIONS) || CONFIG_BASENAMES.includes(path.split('/').pop())

function roleOf(line) {
  for (const [rol, re] of ROLE_LABELS) {
    const m = re.exec(line)
    if (m) return { rol, path: m[1].trim() }
  }
  return null
}

const BUDGET_REMEDY = {
  'Current state': 'cita solo el tramo que cambia y acótalo en la etiqueta: "Current state (path, lines 40-58):".',
  Contract: 'un contrato son declaraciones: tipos, firmas, errores tipados y constantes no deducibles. Si no cabe, lo que estás pegando es un cuerpo: quítalo y deja la firma — el cuerpo lo escribe el implementador con el test delante.',
  'Call site': 'el call site es la llamada, no el consumidor entero: deja las líneas que cambian, antes → después.',
  'Final text': 'parte el reemplazo en tramos, cada uno con su "Current state (path, lines A-B):".',
}

function bodyAtFence(lines, openIdx) {
  const body = []
  for (let j = openIdx + 1; j < lines.length; j++) {
    if (lines[j].fence) return body
    body.push(lines[j].line)
  }
  return null
}

const langAt = (line) => line.slice(3).trim().toLowerCase()

// Anota cada línea con si es estructural (fuera de fence) — el único parseo
// de markdown que este contrato necesita. Un fence abre y cierra con una
// línea que EMPIEZA por tres backticks, como en el resto de parsers del repo.
function annotate(markdown) {
  const out = []
  let inFence = false
  for (const line of String(markdown).split('\n')) {
    if (line.startsWith('```')) {
      out.push({ line, structural: false, fence: true, opens: !inFence })
      inFence = !inFence
      continue
    }
    out.push({ line, structural: !inFence, fence: false, opens: false })
  }
  return out
}

function fenceBodyAfter(lines, from) {
  let i = from
  while (i < lines.length && lines[i].line.trim() === '') i++
  if (i >= lines.length || !lines[i].fence || !lines[i].opens) return null
  const body = []
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].fence) return body.join('\n')
    body.push(lines[j].line)
  }
  return null
}

export function validatePlan(markdown, { readFile } = {}) {
  const violations = []
  const push = (rule, detail) => violations.push({ rule, detail })
  const lines = annotate(markdown)

  if (!lines.length || !lines[0].line.startsWith('# ')) {
    push('title', 'la primera línea debe ser el título: "# <issue> — <qué>"')
  }
  if (!lines.some((l) => l.structural && l.line.includes(BLOCKQUOTE_MARKER))) {
    push('header', `falta el blockquote de cabecera (debe contener: "${BLOCKQUOTE_MARKER}")`)
  }

  let prev = -1
  for (const section of PLAN_SECTIONS) {
    const at = lines.findIndex((l) => l.structural && l.line.startsWith(section))
    if (at === -1) { push('sections', `falta la sección "${section}" (si no aplica: "N/A — <reason>")`); continue }
    if (at < prev) push('sections', `sección fuera de orden: "${section}"`)
    prev = at
  }
  for (const sub of SUBSECTIONS) {
    if (!lines.some((l) => l.structural && l.line.startsWith(sub))) {
      push('sections', `falta la subsección "${sub}" dentro de "## 1. Context and goal"`)
    }
  }

  const decisionsAt = lines.findIndex((l) => l.structural && l.line.startsWith('## 2. Closed decisions'))
  if (decisionsAt !== -1) {
    let rows = 0
    for (let i = decisionsAt + 1; i < lines.length; i++) {
      if (lines[i].structural && lines[i].line.startsWith('## ')) break
      if (lines[i].structural && lines[i].line.startsWith('|')) rows++
    }
    if (rows < 3) push('decisions', 'la tabla de "Closed decisions" está vacía (cabecera + separador + al menos 1 fila)')
  }

  const tasks = []
  lines.forEach((l, i) => {
    if (!l.structural) return
    const m = TASK_HEADING.exec(l.line)
    if (m) tasks.push({ n: parseInt(m[1], 10), name: l.line, at: i })
  })
  if (!tasks.length) push('tasks', 'no hay ninguna "### Task N — <name>"')
  tasks.forEach((t, idx) => {
    if (t.n !== idx + 1) push('tasks', `numeración no consecutiva: esperaba Task ${idx + 1} y encontré "${t.name}"`)
    const end = idx + 1 < tasks.length ? tasks[idx + 1].at : lines.length
    let boundary = end
    for (let i = t.at + 1; i < end; i++) {
      if (lines[i].structural && lines[i].line.startsWith('## ')) { boundary = i; break }
    }
    t.boundary = boundary
    const block = lines.slice(t.at + 1, boundary)
    for (const marker of TASK_MARKERS) {
      if (!block.some((l) => l.structural && l.line.includes(marker))) {
        push('tasks', `${t.name}: falta ${marker}`)
      }
    }
  })

  // D-4 — LA VARA DE LA TAREA TIENE QUE SER EJECUTABLE.
  //
  // Hasta aquí el contrato comprobaba que **Verification:** ESTÁ (es uno de los
  // cinco TASK_MARKERS), no que diga algo que se pueda correr. La diferencia no
  // era teórica: medido contra el plan real del slice #5 de repo-pulse, SIETE
  // de sus ocho tareas verificaban con prosa en línea — "`npm test -w web` →
  // exit 0. `npm run build && npm run lint` → exit 0." — y el plan validaba sin
  // una sola queja. Es fiel a plan-template.md, que pedía "{{exact command and
  // expected output}}" sin decir dónde; el agujero era de la plantilla.
  //
  // Un humano lee esa prosa y sabe qué correr. Un programa no: entre los
  // comandos hay flechas, puntos, "y después:" y paréntesis explicativos con
  // un `wc -l AGENTS.md` dentro. Separar comando de comentario a base de
  // heurísticas es adivinar, y adivinar aquí significa dar por verde una tarea
  // que nadie midió.
  //
  // Por eso los comandos van en el bloque cercado que sigue al párrafo de
  // **Verification:** — el mismo bloque que las reglas de rol ya eximían por su
  // etiqueta y al que COMMAND_BUDGET ya le pone tope. La regla no inventa
  // formato: hace obligatorio el que ya estaba exento.
  //
  // El detalle vive en plan-tasks.js, que es quien luego los ejecuta: un
  // contrato que aceptara planes que su propio ejecutor no sabe leer no sería
  // un contrato.
  // Dos reglas, una violación: `verification-block` (la verificación es prosa
  // que nadie puede ejecutar) y `verification-predicate` (la verificación ES un
  // comando y su código de salida dice lo contrario de lo que su comentario dice
  // medir — el control invertido de jjponz/rust-monitoring#10, que atravesó
  // justamente esta puerta). Las dos salen por `verification` porque para quien
  // arregla el plan son el mismo trabajo: hacer que la vara mida.
  //
  // §3.7-A del handoff añade el mismo par para "## 8. Global verification":
  // `global-verification-block` (prosa donde nadie ejecuta) y
  // `global-verification-predicate` (mide al revés). Un contrato que aceptara
  // un §8 que su propio ejecutor (`ct-step global`, en plan-tasks.js) no sabe
  // leer no sería un contrato — la misma frase que ya justifica que esta lista
  // se lea de `extractTasks().problems` en vez de reinventar el parseo aquí.
  const VERIFICATION_RULES = [
    'verification-block', 'verification-predicate',
    'global-verification-block', 'global-verification-predicate',
  ]
  for (const problema of extractTasks(markdown).problems) {
    if (!VERIFICATION_RULES.includes(problema.rule)) continue
    push('verification', problema.detail)
  }

  // F-jjponz-4, pasada A — los bloques CON rol. Comprueba dónde vive cada uno,
  // sobre qué fichero, y cuánto ocupa.
  const taskOf = (i) => tasks.find((t) => i > t.at && i < t.boundary)
  const roleBlocks = []
  lines.forEach((l, i) => {
    if (!l.structural) return
    const found = roleOf(l.line)
    if (!found) return
    const { rol, path } = found
    const body = fenceBodyAfter(lines, i + 1)
    if (body === null) {
      // Para "Current state" ese aviso ya lo emite la pasada de literalidad,
      // que es su dueña desde F-jjponz-1: no se duplica.
      if (rol !== 'Current state') {
        push('roles', `línea ${i + 1}: "${l.line.trim()}" no lleva bloque de código a continuación.`)
      }
      return
    }
    const len = body === '' ? 0 : body.split('\n').length
    const task = taskOf(i)
    if (!task) {
      push('roles', `línea ${i + 1}: "${l.line.trim()}" está fuera de una "### Task N". Los bloques viven DENTRO de la tarea que los usa: subagent-driven-development entrega al implementador su task brief (scripts/task-brief extrae la tarea, no el plan entero), así que un bloque escrito fuera no le llega nunca. Nombra las firmas en prosa aquí y pon el bloque en la tarea.`)
    }
    if (isConfig(path)) {
      push('config', `línea ${i + 1}: "${l.line.trim()}" apunta a configuración (${path}). Las configuraciones NO llevan bloque: describe el cambio en prosa con el valor inline — p.ej. «el script \`build\` pasa a \`tsc -p tsconfig.build.json\`». Solo el código lleva bloque.`)
    } else if (rol !== 'Current state' && isTest(path)) {
      push('tests', `línea ${i + 1}: "${l.line.trim()}" apunta a un fichero de test (${path}). El cuerpo del test lo escribe el implementador en rojo primero: en el plan van el NOMBRE literal del test y su aserción clave, en **TDD:** y **Tests:**. Si lo que citas es una aserción que YA existe y hay que cambiar, cítala con "Current state (${path}, lines A-B):".`)
    }
    if (rol === 'Final text' && !isText(path)) {
      push('roles', `línea ${i + 1}: "Final text (${path})" solo vale para texto cuyo valor literal es el entregable (${TEXT_EXTENSIONS.join(', ')}). Para código, el plan lleva su contrato y el cuerpo lo escribe el implementador con TDD.`)
    }
    if (len > ROLE_BUDGETS[rol]) {
      push('budget', `línea ${i + 1}: el bloque "${l.line.trim()}" tiene ${len} líneas y su presupuesto son ${ROLE_BUDGETS[rol]}. ${BUDGET_REMEDY[rol]}`)
    }
    roleBlocks.push({ rol, path, at: i, len, task })
  })

  for (const rol of ['Contract', 'Call site']) {
    const vistos = new Map()
    for (const b of roleBlocks) {
      if (b.rol !== rol || !b.task) continue
      const clave = `${b.task.name}::${b.path}`
      if (vistos.has(clave)) {
        push('roles', `${b.task.name}: dos bloques "${rol} (${b.path})" (líneas ${vistos.get(clave) + 1} y ${b.at + 1}). El contrato de un fichero se escribe UNA vez por tarea: junta las declaraciones en un solo bloque — trocearlo no compra presupuesto.`)
        continue
      }
      vistos.set(clave, b.at)
    }
  }

  // F-jjponz-4, pasada B — los bloques SIN rol. Es la que mata el idiom
  // "Final content:"/"Current state: does not exist." que producía los
  // volcados. Un bloque de comandos queda exento: se delata por su lenguaje o
  // por venir detrás de **Verification:**.
  let menuPendiente = true
  lines.forEach((l, i) => {
    if (!l.fence || !l.opens) return
    let prev = i - 1
    while (prev >= 0 && lines[prev].line.trim() === '') prev--
    const etiqueta = prev >= 0 ? lines[prev].line.trim() : ''
    if (prev >= 0 && lines[prev].structural && roleOf(lines[prev].line)) return
    const lang = langAt(l.line)
    const esComando = COMMAND_LANGS.has(lang) || etiqueta.includes('**Verification:**')
    const body = bodyAtFence(lines, i)
    if (!esComando) {
      // El menú de roles va UNA vez: un plan con veinte volcados producía
      // veinte copias del mismo párrafo, y un mensaje que no se puede leer no
      // es un remedio.
      push('roles', `línea ${i + 1}: bloque de código sin etiqueta de rol${etiqueta ? ` (lo precede "${etiqueta}")` : ''}.${menuPendiente ? ` ${ROLE_MENU}` : ''}`)
      menuPendiente = false
      return
    }
    if (body === null) return
    if (body.some((linea) => linea.includes('<<'))) {
      push('commands', `línea ${i + 1}: el bloque de comandos lleva un heredoc (<<). Un heredoc es un fichero entero colado por la puerta de atrás: si su contenido importa, va como "Contract (path):"; si no, no va.`)
    }
    if (body.length > COMMAND_BUDGET) {
      push('commands', `línea ${i + 1}: el bloque de comandos tiene ${body.length} líneas y su presupuesto son ${COMMAND_BUDGET}. Un bloque de comandos son los comandos y su salida esperada, no un script: si hace falta un script, va al repo y el plan lo invoca.`)
    }
    // EL TOTAL DE LA SUITE CLAVADO. Medido en el slice #7 de rust-monitoring: el
    // plan clavaba `52 passed` en cuatro controles, el juez exigió con razón un
    // test más, y el número caducado hubo que corregirlo en siete sitios del
    // plan —dos briefs se generaron ya con el valor viejo—. El daño mayor no es
    // ése: con el total clavado no queda hueco para la aserción que
    // `conventions/testing.md` manda conducir en rojo, así que dos ramas se
    // entregaron sin un solo test para que un control siguiera verde. Es la vara
    // de ct peleando contra un control de ct, y el único sitio donde se puede
    // impedir es aquí, antes de que el plan exista: el juez ya sólo puede
    // declarar el choque, y el implementador no puede satisfacer los dos.
    //
    // Se mide sobre el LITERAL del comando y no sobre su intención: un total de
    // la suite se escribe con el número pegado a `passed`/`passing`, que es la
    // forma que imprimen cargo, pytest, jest y mocha. Un recuento acotado al
    // módulo de la tarea —`grep -c '^test log_timestamp::'`— no la tiene, y es
    // exactamente la alternativa que el mensaje ofrece.
    for (const [j, linea] of body.entries()) {
      const total = /\b\d+\s+pass(?:ed|ing)\b/i.exec(linea)
      if (!total) continue
      push('commands', `línea ${i + 2 + j}: el control clava el número de tests de la suite ("${total[0]}"). Es un proxy: el juez puede exigir con razón una aserción más, y entonces el número caduca en todos los controles que lo repiten; y mientras esté clavado no queda hueco para conducir en rojo la aserción que conventions/testing.md exige, así que una rama se entrega sin test para que el control siga verde. Cuenta los tests DE ESTA TAREA por su prefijo de módulo (por ejemplo: grep -c '^test <modulo>::'), no el total.`)
    }
  })

  // F-jjponz-4 — sustituye la regla vieja ("cada tarea contiene al menos un
  // bloque de código"): con **Verification:** obligatorio y su bloque de
  // comandos, aquella quedaba satisfecha siempre y no comprobaba nada.
  for (const t of tasks) {
    if (roleBlocks.some((b) => b.task === t)) continue
    const declara = lines
      .slice(t.at + 1, t.boundary)
      .some((l) => l.structural && NO_CODE.test(l.line.trim()))
    if (!declara) {
      push('tasks', `${t.name}: no lleva ningún bloque con etiqueta de rol (Current state / Contract / Call site / Final text), y un bloque de comandos no cuenta. Si la tarea de verdad no lleva código —configuración descrita en prosa, o documentación—, dilo con la línea exacta: "No code — <razón>".`)
    }
  }

  for (const t of tasks) {
    const total = roleBlocks.filter((b) => b.task === t).reduce((n, b) => n + b.len, 0)
    if (total > CODE_BUDGETS.task) {
      push('budget', `${t.name}: acumula ${total} líneas de código en sus bloques y el presupuesto de una tarea son ${CODE_BUDGETS.task}. Una tarea es UN commit: si de verdad necesita más contrato que esto, o el commit son dos, o estás volcando cuerpos que escribe el implementador.`)
    }
  }
  for (const t of tasks) {
    const largo = lines.slice(t.at, t.boundary).map((l) => l.line).join('\n').length
    if (largo > CODE_BUDGETS.chars) {
      const folios = (largo / CODE_BUDGETS.chars).toFixed(1)
      push('size', `${t.name}: la tarea mide ${largo} caracteres — ${folios} folios — y el máximo es UN folio A4 (${CODE_BUDGETS.chars} caracteres, unas 50 líneas). Es lo que un humano lee de una sentada en el gate \`plan\`, y es también lo que el implementador recibe como task brief. Recorta a las decisiones (contrato, call site y el tramo que cambia) y, si aun así no cabe, la tarea son dos: una tarea es un commit, y partir un commit sí está en tu mano.`)
    }
  }

  lines.forEach((l, i) => {
    if (!l.structural) return
    for (const [re, label] of FORBIDDEN) {
      if (re.test(l.line)) push('placeholders', `línea ${i + 1}: token prohibido (${label})`)
    }
  })

  lines.forEach((l, i) => {
    if (!l.structural) return
    const m = CURRENT_STATE.exec(l.line)
    if (!m) return
    const path = m[1].trim()
    const body = fenceBodyAfter(lines, i + 1)
    if (body === null) { push('literality', `"Current state (${path})" sin bloque de código a continuación`); return }
    if (!readFile) return
    let real
    try {
      real = readFile(path)
    } catch (e) {
      push('literality', `no se pudo leer "${path}" para comprobar la cita: ${e.message}`)
      return
    }
    if (!String(real).includes(body)) {
      push('literality', `el bloque "Current state (${path})" NO existe verbatim en ese fichero — cita de memoria`)
    }
  })

  // ---------------------------------------------------------------------------
  // §3 ES LA VARA DEL REPO, Y UNA VARA QUE NO EXISTE NO MIDE.
  //
  // `## 3. Reference patterns` dejó de ser sólo "ficheros a los que parecerse":
  // es lo único del plan que le dice al implementador cómo se escribe en este
  // repo y al juez contra qué bloquear. Y lo escribe un AGENTE, así que puede
  // citar `docs/conventions/domain.md` porque le suena a que un repo así lo
  // tendría. Entonces el implementador no lo abre (no está), el juez no lo abre
  // (no está), y los dos siguen adelante como si hubieran medido.
  //
  // Es la MISMA regla que la literalidad de `Current state`, aplicada a la otra
  // clase de cita del plan: allí se comprueba que el texto citado existe verbatim
  // en el fichero, aquí que el fichero citado existe. Tercera de la serie —
  // `5b97fdd` cerró "la vara es prosa", `verification-predicate` cerró "la vara
  // mide al revés", y ésta cierra "la vara no existe".
  //
  // ACOTADA A §3 a propósito: en el resto del plan hay rutas que la slice va a
  // CREAR, y exigir que existan ahí vetaría todos los planes.
  //
  // QUÉ SE TRATA COMO RUTA. Un token entre comillas invertidas, sólo si no lleva
  // espacios y (lleva una barra o acaba en una extensión de texto). Así
  // `docs/conventions/infra.md` y `AGENTS.md` se comprueban, mientras que
  // `test(...)`, `describe` y la skill `backend-engineering:backend-best-practices`
  // no se miran — una skill no es un fichero del repo y su existencia no se
  // comprueba en disco.
  //
  // Y un token que acaba en `/` se salta: es un directorio, y el único puerto de
  // lectura que este módulo recibe es de ficheros. Comprobar directorios pedía
  // una costura de IO nueva por todo el camino de `checkPlans`, y el agujero que
  // deja (un directorio inventado pasa) es más pequeño que la costura.
  // ---------------------------------------------------------------------------
  if (readFile) {
    const desde = lines.findIndex((l) => l.structural && l.line.startsWith('## 3. Reference patterns'))
    if (desde !== -1) {
      let hasta = lines.findIndex((l, i) => i > desde && l.structural && /^## /.test(l.line))
      if (hasta === -1) hasta = lines.length
      for (let i = desde + 1; i < hasta; i++) {
        if (!lines[i].structural) continue
        for (const cita of lines[i].line.match(/`[^`]+`/g) || []) {
          const ruta = cita.slice(1, -1).trim()
          if (!esRutaCitada(ruta)) continue
          try {
            readFile(ruta)
          } catch {
            push('reference-paths', `línea ${i + 1}: §3 nombra "${ruta}" y no se puede leer en el repo. §3 es la vara con la que el implementador escribe y el juez bloquea: una ruta citada de memoria deja a los dos midiendo contra un fichero que no está. Cita una ruta real, o quítala.`)
          }
        }
      }
    }
  }

  return { ok: violations.length === 0, violations }
}

export function planFilesForIssue(issue, paths) {
  const needle = `issue-${issue}-`
  return (paths || []).filter(
    (p) => p.startsWith('docs/superpowers/plans/') && p.endsWith('.md') && p.includes(needle),
  )
}

// checkPlans: la decisión entera del gate, pura. `candidates` es la lista de
// rutas donde buscar el plan (en --release, los ficheros que la rama
// INTRODUCE; en --check-plan, el contenido del directorio de planes). El
// mensaje devuelto es prosa terminada, con remedio — quien lo recibe solo lo
// imprime por stderr y sale con `code`.
//
// F-jjponz-3 — DOS lecturas distintas, y confundirlas hacía el gate
// insatisfacible. El PLAN se lee siempre donde está ahora (`readFile`): lo
// introduce esta rama, así que en la base no existe. Los ficheros que el plan
// CITA se leen con `readCitedFile`, que en --release apunta a la base de la
// rama: para entonces las tareas ya reescribieron esos ficheros, y compararlos
// con el árbol solo demostraría que el slice hizo su trabajo. Por defecto es
// el mismo lector, que es lo correcto en --check-plan (el plan se escribe
// antes de implementar y cita el árbol tal y como está).
export function checkPlans({ issue, candidates, readFile, readCitedFile }) {
  const files = planFilesForIssue(issue, candidates)
  if (!files.length) {
    return {
      ok: false,
      code: 6,
      files,
      message:
        `no hay ningún plan prescriptivo para #${issue} entre los candidatos: falta un ` +
        `docs/superpowers/plans/YYYY-MM-DD-issue-${issue}-<slug>.md. Escríbelo con ` +
        `control-tower-loop:writing-plans-prescriptive, valídalo con --check-plan y commitéalo ` +
        `(viaja en el PR). Si ya existe en tu árbol de trabajo pero no está commiteado, commitéalo.`,
    }
  }
  for (const file of files) {
    let content
    try {
      content = readFile(file)
    } catch (e) {
      return {
        ok: false,
        code: 6,
        files,
        message: `no se ha podido leer ${file} (${e.message}) — no se afirma que el plan sea inválido, pero tampoco se puede comprobar. Arregla la lectura y reintenta.`,
      }
    }
    const result = validatePlan(content, { readFile: readCitedFile ?? readFile })
    if (!result.ok) {
      const detail = result.violations.map((v) => `  - [${v.rule}] ${v.detail}`).join('\n')
      return {
        ok: false,
        code: 6,
        files,
        message: `${file} no cumple el contrato del plan (plan-contract.js):\n${detail}\nCorrige el plan, re-valida con --check-plan y vuelve a intentarlo.`,
      }
    }
  }
  return { ok: true, code: 0, files, message: `plan ok: ${files.join(', ')} cumple el contrato` }
}
