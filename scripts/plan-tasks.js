// ============================================================================
// PLAN-TASKS — el plan prescriptivo leído como una LISTA DE TAREAS EJECUTABLE.
//
// `plan-contract.js` ya dice si un plan es un plan: que están las nueve
// secciones, que las tareas van numeradas sin huecos, que cada una lleva sus
// cinco marcadores y que el código que cita existe verbatim. Lo que no dice es
// qué hay que EJECUTAR para saber si una tarea quedó verde — y eso es
// exactamente lo que un conductor que no razona necesita del plan.
//
// Este módulo extrae, por tarea: los comandos de su **Verification:**, los
// nombres de test que la tarea AÑADE y los que RETIRA a propósito, las rutas
// de **Files:**, el nombre del test que declara **TDD:**, la ruta de cada
// bloque con etiqueta de rol y el texto literal de sus bloques `Final text`.
// Con eso, el programa mide la tarea sin preguntarle al implementador si le
// salió bien.
//
// PURO a propósito, como `plan-contract.js`: entra el markdown, sale la lista.
// Ni un import.
//
// ---------------------------------------------------------------------------
// LO QUE ESTE PARSER TIENE MEDIDO (y por qué no vale validarlo con la plantilla)
//
// Todo lo de aquí abajo salió de un plan REAL —el del slice #5 de repo-pulse,
// 534 líneas, 8 tareas, `__tests__/fixtures/plan-real-issue-5.md`— y ninguna de
// las tres trampas aparece en `plan-template.md`. Un parser validado contra la
// plantilla pasa en verde y luego se rompe con el primer plan de verdad.
//
// 1. LOS COMANDOS VAN EN EL BLOQUE CERCADO, NO EN LA LÍNEA. En línea llegan
//    mezclados con prosa ("→ exit 0.", "y después:", un `wc -l AGENTS.md`
//    dentro de un paréntesis explicativo) y no hay forma honrada de separar el
//    comando del comentario. Y tiene que ser el bloque INMEDIATAMENTE
//    posterior, no cualquier bloque de la tarea: las tareas reales llevan sus
//    propios bloques `Contract (path):` y `Current state (path):`, que son
//    código citado, no comandos.
//
//    El párrafo de **Verification:** puede ocupar varias líneas (la tarea 8 del
//    plan real ocupa dos) y puede llevar texto en línea ANTES del bloque (la
//    tarea 1 dice "`npm install` y después:"). Las dos formas se aceptan: lo
//    que se mira es el primer cercado que abre tras el párrafo.
//
// 2. LOS PARÉNTESIS SE BARREN POR PROFUNDIDAD. Los nombres de test viven entre
//    comillas simples, a veces envueltos en backticks, y llevan detrás
//    paréntesis explicativos que CONTIENEN paréntesis:
//
//      'a zero series sits on the baseline' (polylinePoints([0, 0], 1) es
//      '0.0,199.0 600.0,199.0')
//
//    Un barrido de un solo nivel (/\([^()]*\)/g) no casa ese paréntesis, así
//    que `0.0,199.0 600.0,199.0` se cuela como nombre de test, no aparece en
//    ningún fichero y BLOQUEA LA TAREA CON UN FALSO POSITIVO. Con barrido por
//    profundidad, las ocho líneas **Tests:** del plan real extraen sus nombres
//    y ni uno más.
//
// 3. EL MARCADOR DE RETIRADA TIENE TRES FORMAS: "removed on purpose:" (la
//    plantilla, en inglés), "retira a propósito" y "retira" a secas. Exigir la
//    forma larga deja sin partir la tarea que usa la corta y mete su test
//    retirado en la lista de los que DEBEN EXISTIR: exactamente lo contrario de
//    lo correcto.
// ============================================================================

const TASK_HEADING = /^### Task (\d+) — (.*)$/
const VERIFICATION = '**Verification:**'
const TESTS = '**Tests:**'
const FILES = '**Files:**'
const TDD = '**TDD:**'

// Cualquier otro marcador de tarea corta el párrafo: si tras **Verification:**
// viene **Objective:** en vez de un bloque, es que no hay bloque, y decirlo es
// mejor que seguir buscando hasta el final del fichero.
const OTHER_MARKERS = ['**Objective:**', FILES, TDD, TESTS]

// Las tres formas del §2.5. El orden importa: "retira a propósito" antes que
// "retira", o la corta se come a la larga y parte por el sitio equivocado.
const REMOVAL_MARKERS = ['removed on purpose:', 'retira a propósito', 'retira']

// Mismo parseo de cercados que `plan-contract.js`: un fence abre y cierra con
// una línea que EMPIEZA por tres backticks. Se repite aquí y no se importa
// porque este módulo no depende de aquél y la duplicación son ocho líneas.
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

// El barrido de la trampa 2. Se recorre carácter a carácter contando
// profundidad en vez de aplicar una expresión regular, porque una expresión
// regular sin recursión no sabe contar paréntesis.
export function stripParenthesised(text) {
  let depth = 0
  let out = ''
  for (const ch of String(text)) {
    if (ch === '(') { depth++; continue }
    if (ch === ')') { if (depth > 0) depth--; continue }
    if (depth === 0) out += ch
  }
  return out
}

// Los nombres de test son lo que va entre comillas simples una vez barridos los
// paréntesis. Los backticks se tiran: envuelven tanto nombres de test
// (`'lists the clones'`) como identificadores de código (`window=all`), así que
// no distinguen nada y sí estorban.
function quotedNames(text) {
  const limpio = stripParenthesised(text).replace(/`/g, '')
  const nombres = []
  const re = /'([^']+)'/g
  let m
  while ((m = re.exec(limpio)) !== null) {
    const nombre = m[1].trim()
    if (nombre) nombres.push(nombre)
  }
  return nombres
}

// Parte la línea de **Tests:** en lo que la tarea añade y lo que retira. Sin
// marcador de retirada, todo son añadidos.
function splitTests(text) {
  const bajo = text.toLowerCase()
  let corte = -1
  let marca = ''
  for (const m of REMOVAL_MARKERS) {
    const at = bajo.indexOf(m)
    if (at !== -1 && (corte === -1 || at < corte)) { corte = at; marca = m }
  }
  if (corte === -1) return { added: quotedNames(text), removed: [] }
  return {
    added: quotedNames(text.slice(0, corte)),
    removed: quotedNames(text.slice(corte + marca.length)),
  }
}

// Las únicas dos acciones que el resto del programa sabe interpretar
// (`alcanceDeclarado`, en ct-step.mjs, sólo tiene ramas para éstas). Igual que
// "una ruta sin acción declarada no se comprueba contra git, y no es un
// problema del plan", una acción que no sea ninguna de las dos tampoco lo es:
// mejor no comprobar nada que comprobar con un valor que nadie declaró.
const KNOWN_ACTIONS = ['create', 'modify']

// Parte el párrafo de **Files:** en las rutas que declara, con su acción.
// Formato real, medido en el plan del slice #5:
//   **Files:** `web/package.json` (modify), `web/src/testing/setup.ts` (create)
// Los backticks se tiran; la acción es opcional (una ruta sin paréntesis
// detrás queda con action: null), y lo que no sea "create" ni "modify"
// también queda en null en vez de colarse tal cual.
export function splitFiles(text) {
  const rutas = []
  const re = /`([^`]+)`(?:\s*\(([^)]+)\))?/g
  let m
  while ((m = re.exec(text)) !== null) {
    const path = m[1].trim()
    if (!path) continue
    const cruda = m[2] ? m[2].trim() : null
    const action = KNOWN_ACTIONS.includes(cruda) ? cruda : null
    rutas.push({ path, action })
  }
  return rutas
}

// Las cuatro etiquetas de rol de un bloque del plan, con su ruta. Duplicadas
// de `plan-contract.js` (constante `ROLE_LABELS`), por la misma razón que
// `annotate`: este módulo no depende de aquél.
export const ROLES = ['Current state', 'Contract', 'Call site', 'Final text']

const ROLE_LABELS = [
  ['Current state', /^Current state \(([^),]+)(?:,[^)]*)?\):\s*$/],
  ['Contract', /^Contract \(([^),]+)(?:,[^)]*)?\):\s*$/],
  ['Call site', /^Call site \(([^),]+)(?:,[^)]*)?\):\s*$/],
  ['Final text', /^Final text \(([^),]+)(?:,[^)]*)?\):\s*$/],
]

function roleOf(line) {
  for (const [role, re] of ROLE_LABELS) {
    const m = re.exec(line)
    if (m) return { role, path: m[1].trim() }
  }
  return null
}

// El cuerpo del cercado que sigue a una línea, saltando líneas en blanco antes
// de él. Se devuelve tal cual, sin recortar: un bloque `Final text` es
// contenido literal, y lo que hay que comprobar es justo lo que no se toca.
// Duplicada de `plan-contract.js`, por la misma razón que `annotate`.
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

// El nombre de test de **TDD:** vive AL REVÉS que en **Tests:**: la comilla
// está DENTRO del paréntesis de la llamada —`test('nombre')`—, no fuera con
// una aclaración detrás. Medido contra la tarea 1 del plan real: aplicar
// quotedNames al párrafo entero devuelve 'jsdom' (la comilla de
// `environment: 'jsdom'`, más adelante en el mismo párrafo), porque el barrido
// por profundidad se come el nombre real junto con los paréntesis de
// `test(...)`. Por eso primero se aísla el interior del primer paréntesis
// balanceado del párrafo, y SOBRE ESE interior sí vale quotedNames — que sigue
// siendo el barrido correcto si el nombre citado trajera los suyos.
function firstParenBody(text) {
  const start = text.indexOf('(')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') {
      depth--
      if (depth === 0) return text.slice(start + 1, i)
    }
  }
  return null
}

// "No TDD — <razón>" es una declaración legítima: la tarea no lleva
// comportamiento que poner en rojo, y no declara ningún test.
const NO_TDD = /^No TDD\b/i

function tddNameOf(text) {
  if (NO_TDD.test(text)) return null
  const cuerpo = firstParenBody(text)
  const nombres = quotedNames(cuerpo === null ? text : cuerpo)
  return nombres[0] || null
}

// Junta el párrafo que arranca en `from`: la línea del marcador y sus
// continuaciones, hasta la primera línea en blanco, otro marcador, un cercado o
// un encabezado. Devuelve el texto sin el marcador y dónde se quedó.
function paragraphFrom(lines, from, marker) {
  const trozos = [lines[from].line.trim().slice(marker.length).trim()]
  let i = from + 1
  for (; i < lines.length; i++) {
    const l = lines[i]
    const t = l.line.trim()
    if (t === '' || l.fence || t.startsWith('#')) break
    if (OTHER_MARKERS.some((m) => t.startsWith(m)) || t.startsWith(VERIFICATION)) break
    trozos.push(t)
  }
  return { text: trozos.join(' ').trim(), end: i }
}

// El bloque de comandos: el primer cercado que ABRE tras el párrafo de
// **Verification:**, saltando líneas en blanco. Si antes de ese cercado aparece
// cualquier otra cosa, no hay bloque — y eso es un plan que no se puede
// ejecutar, no un detalle de formato.
function commandsAfter(lines, from) {
  let i = from
  while (i < lines.length && lines[i].line.trim() === '') i++
  if (i >= lines.length || !lines[i].fence || !lines[i].opens) return null
  const comandos = []
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].fence) return comandos
    const t = lines[j].line.trim()
    if (t === '' || t.startsWith('#')) continue
    comandos.push(t)
  }
  return null // cercado sin cerrar: no hay bloque que valga
}

// ============================================================================
// LA ENTRADA PÚBLICA
//
// Devuelve `{ tasks, problems }`. `problems` no está vacío cuando el plan no es
// ejecutable, y su presencia es lo que el conductor traduce a su código de
// salida 6: "arregla el plan", que no es lo mismo que "el trabajo está mal".
// ============================================================================
export function extractTasks(markdown) {
  const lines = annotate(markdown)
  const problems = []
  const push = (task, rule, detail) => problems.push({ task, rule, detail })

  // Los encabezados de tarea, con el trozo de fichero que le toca a cada una.
  const heads = []
  lines.forEach((l, i) => {
    if (!l.structural) return
    const m = TASK_HEADING.exec(l.line)
    if (m) heads.push({ n: Number(m[1]), name: m[2].trim(), at: i })
  })

  const tasks = heads.map((h, k) => {
    const hasta = k + 1 < heads.length ? heads[k + 1].at : lines.length
    const cuerpo = lines.slice(h.at, hasta)

    let commands = null
    let added = []
    let removed = []
    let testsDeclared = false
    let files = []
    let filesDeclared = false
    let tddDeclared = false
    let tddName = null
    const blockPaths = []
    const finalTexts = []

    cuerpo.forEach((l, i) => {
      if (!l.structural) return
      const t = l.line.trim()
      if (t.startsWith(VERIFICATION) && commands === null) {
        const { end } = paragraphFrom(cuerpo, i, VERIFICATION)
        commands = commandsAfter(cuerpo, end)
      }
      if (t.startsWith(TESTS) && !testsDeclared) {
        testsDeclared = true
        const { text } = paragraphFrom(cuerpo, i, TESTS)
        // "N/A — <razón>" es una declaración legítima: la tarea no añade
        // comportamiento y la suite existente debe seguir verde.
        if (!/^N\/A\b/i.test(text)) {
          const partido = splitTests(text)
          added = partido.added
          removed = partido.removed
        }
      }
      if (t.startsWith(FILES) && !filesDeclared) {
        filesDeclared = true
        const { text } = paragraphFrom(cuerpo, i, FILES)
        files = splitFiles(text)
        // Hay texto y no salió ni una ruta: casi siempre porque las rutas no
        // van entre backticks, que es lo único que `splitFiles` reconoce. Sin
        // este aviso, `alcanceDeclarado` (en ct-step.mjs) ve `files: []` y
        // reporta TODO lo tocado como fuera de alcance, con un mensaje que no
        // menciona el formato — falla del lado seguro, pero a ciegas.
        if (text.trim() !== '' && files.length === 0) {
          push(h.n, 'files-line', `la tarea ${h.n} declara "${FILES}" pero no se extrajo ninguna ruta: las rutas van entre backticks, por ejemplo \`path/to/fichero.ext\` (create).`)
        }
      }
      if (t.startsWith(TDD) && !tddDeclared) {
        tddDeclared = true
        const { text } = paragraphFrom(cuerpo, i, TDD)
        tddName = tddNameOf(text)
      }
      const rol = roleOf(l.line)
      if (rol) {
        blockPaths.push(rol)
        if (rol.role === 'Final text') {
          const body = fenceBodyAfter(cuerpo, i + 1)
          if (body !== null) finalTexts.push({ path: rol.path, text: body })
        }
      }
    })

    if (commands === null) {
      push(h.n, 'verification-block', `la tarea ${h.n} no trae bloque de comandos detrás de "${VERIFICATION}": su verificación es prosa, y un programa no ejecuta prosa.`)
    } else if (commands.length === 0) {
      push(h.n, 'verification-block', `la tarea ${h.n} trae un bloque de comandos vacío detrás de "${VERIFICATION}".`)
    }
    if (!testsDeclared) {
      push(h.n, 'tests-line', `la tarea ${h.n} no declara "${TESTS}".`)
    }

    return {
      n: h.n,
      name: h.name,
      commands: commands || [],
      testsAdded: added,
      testsRemoved: removed,
      files,
      tddName,
      blockPaths,
      finalTexts,
    }
  })

  if (!tasks.length) push(0, 'tasks', 'el plan no declara ninguna tarea ("### Task N — ...").')

  return { tasks, problems }
}
