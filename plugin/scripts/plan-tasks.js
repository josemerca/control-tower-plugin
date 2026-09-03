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
// LA VARA TIENE QUE PODER MEDIR LO QUE DICE MEDIR
//
// `verification-block` cerró "la verificación es prosa". Esto cierra el agujero
// de al lado, medido en jjponz/rust-monitoring#10: la verificación ES un comando
// ejecutable, vive en su bloque, y su código de salida dice lo CONTRARIO de lo
// que su comentario dice medir.
//
//   git diff HEAD -- AGENTS.md | grep -c 'ct-init:slices-contract'   # expected: 0
//
// `ct-step controls` puntúa SOLO por código de salida, y `grep -c` sale con 1
// cuando no encuentra nada y con 0 cuando encuentra. O sea que ese control solo
// podía ponerse verde en el caso MALO —la sección protegida tocada— y fallaba
// siempre en el bueno. Ninguna implementación podía superarlo, y aun así pasó
// `--check-plan` y pasó el gate humano de un humano leyendo 246 líneas en 125
// segundos. El comentario decía la verdad; el exit code decía lo contrario, y el
// exit code es el que manda.
//
// LO QUE ESTA REGLA NO HACE: leer el `# expected:`. Ahí empieza a adivinar —el
// comentario es prosa libre y "exit 0, 1 passed" lleva un número dentro. Lo que
// mira es el ÚLTIMO TRAMO de la tubería, que es lo que decide `$?`, contra una
// lista CERRADA de comandos cuyo código de salida es demostrablemente
// independiente de lo que el plan afirma. Cada entrada trae su prueba y su
// remedio; nada más se toca.
//
// Y CALLA CUANDO NO PUEDE PROBARLO: ante `&&`, `||` o `;` no se pronuncia,
// porque entonces el exit code depende de qué llegó a correr. Un falso positivo
// aquí bloquea un plan correcto en un gate, que es peor que el agujero.

// El último tramo de la tubería, sin su comentario final. `null` = no se analiza
// (hay encadenamiento y el exit code ya no es de un solo comando).
//
// Respeta comillas y `$(...)`: sin lo segundo, el propio ARREGLO del control de
// rust-monitoring —`test "$(… | grep -c …)" -eq 0`— se leería como una tubería
// que acaba en `grep -c` y la regla vetaría la corrección en vez del defecto.
export function lastPipelineStage(command) {
  let stage = ''
  let quote = null
  let depth = 0
  let piped = false
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) { stage += c; if (c === quote) quote = null; continue }
    if (c === "'" || c === '"' || c === '`') { quote = c; stage += c; continue }
    if (c === '$' && command[i + 1] === '(') { depth++; stage += '$('; i++; continue }
    if (c === ')' && depth > 0) { depth--; stage += c; continue }
    if (depth > 0) { stage += c; continue }
    if (c === '#' && (i === 0 || /\s/.test(command[i - 1]))) break
    if (c === ';') return null
    if (c === '&' && command[i + 1] === '&') return null
    if (c === '|') {
      if (command[i + 1] === '|') return null
      piped = true
      stage = ''
      continue
    }
    stage += c
  }
  return { stage: stage.trim(), piped }
}

// Un flag corto que lleve la letra pedida (`-c`, `-rc`, `-ic`), o su forma
// larga. `--color` no cuenta: empieza por dos guiones y no es `--count`.
const shortFlagHas = (arg, letra) => /^-[A-Za-z]+$/.test(arg) && arg.includes(letra)

// «Esto es un `grep -c`» es UNA decisión — qué programas cuentan coincidencias
// y con qué bandera —, y se pregunta desde dos sitios: la regla que rechaza
// `grep -c` a secas, y el auxiliar que cuenta sus ficheros. Vivir en dos
// copias es lo que `conventions/decisions.md` prohíbe: añadir `rg
// --count-matches` a una y no a la otra dejaría a la otra sin enterarse.
const isGrepCountInvocation = (words) => /^(grep|egrep|fgrep|rg)$/.test(words[0]) &&
  words.slice(1).some((a) => a === '--count' || shortFlagHas(a, 'c'))

// La lista cerrada. `words` son las palabras del último tramo.
// EL PREDICADO QUE NO PUEDE MEDIR PORQUE `grep -c` CAMBIA DE FORMA CON DOS
// FICHEROS. Medido en el slice #35 de repo-pulse, que se bloqueó por esto.
//
// `test "$(… | grep -c …)" -eq N` es la forma que este mismo vocabulario
// RECOMIENDA, y con un solo flujo es correcta: `grep -c` imprime un número. Con
// DOS O MÁS ficheros como argumentos imprime `fichero:cuenta` por cada uno, así
// que la sustitución devuelve varias líneas, `test` recibe un no-entero y sale
// con 2 —«integer expression expected»— diga lo que diga el código. Rojo
// siempre, y ningún implementador puede arreglarlo desde el código: lo que está
// roto es la vara.
//
// Por qué hacía falta una regla y no bastaba la de `grep -c`: aquélla mira la
// CABEZA del tramo, y en cuanto la cuenta se envuelve en `test` la cabeza es
// `test`. O sea que la forma recomendada era también la que dejaba de
// inspeccionarse.
//
// SE DECIDE EN FALSO ANTES QUE EN FALSO POSITIVO. Un falso negativo deja pasar
// un control que se bloqueará —lo que pasa hoy—; un falso positivo tumba un plan
// válido y no hay forma de que su autor lo arregle. Así que sólo se acusa cuando
// se han contado dos operandos con certeza: se respetan las comillas, se consume
// el argumento de `-e`/`--regexp`, y cualquier cosa que no se sepa trocear
// devuelve `null` y no se acusa a nadie.
function splitRespectingQuotes(text) {
  const out = []
  let current = ''
  let quote = null
  for (const c of text) {
    if (quote) { current += c; if (c === quote) quote = null; continue }
    if (c === "'" || c === '"') { quote = c; current += c; continue }
    if (/\s/.test(c)) { if (current !== '') { out.push(current); current = '' } continue }
    current += c
  }
  if (current !== '') out.push(current)

  return out
}

// `-e`/`--regexp` es la única bandera cuyo argumento ES el patrón: consumirlo
// cierra `patternTaken` a propósito.
const PATTERN_FLAGS = new Set(['-e', '--regexp'])

// El resto de banderas que se llevan un argumento propio detrás no aportan ni
// el patrón ni un fichero — contar ese argumento como fichero es el falso
// positivo medido en `-m 1`: sin distinguirla de `-e`, el «1» de `-m 1` cerraba
// `patternTaken` y el patrón de verdad, que venía justo después, se contaba
// como el primer fichero. Se consume igual, pero SIN tocar `patternTaken`.
const VALUE_TAKING_FLAGS = new Set(['-m', '--max-count'])

// Una redirección de shell (`>`, `>>`, `<`, `2>`, `2>&1`…) no es un operando
// de grep — es lo que viene DESPUÉS de la llamada. Medido: `grep -c 'x' a.ts
// 2>/dev/null` tiene un solo fichero de verdad y `2>/dev/null` se colaba como
// el segundo. En cuanto aparece, deja de haber certeza sobre lo que sigue, así
// que se corta ahí — coherente con "sólo se acusa con dos operandos con
// certeza": aquí ni siquiera se afirma que no haya dos, se deja de contar.
const looksLikeRedirection = (word) => /^\d*&?[<>]/.test(word)

function grepCountFileOperands(stage) {
  const words = splitRespectingQuotes(stage)
  if (!isGrepCountInvocation(words)) return null
  const operands = []
  let patternTaken = false
  for (let i = 1; i < words.length; i++) {
    const w = words[i]
    if (looksLikeRedirection(w)) break
    if (PATTERN_FLAGS.has(w)) { patternTaken = true; i++; continue }
    if (VALUE_TAKING_FLAGS.has(w)) { i++; continue }
    if (w.startsWith('-')) continue
    if (!patternTaken) { patternTaken = true; continue }
    operands.push(w)
  }

  return operands.length
}

// Dentro de comillas SIMPLES el shell no expande nada: `'$(grep -c a b)'` es
// el texto literal ocho caracteres, no una sustitución. Medido: `grep -Fq
// '$(grep -c mark a.ts b.ts)' incidencias.md` es un grep legítimo buscando esa
// cadena, y sin este barrido exterior se leía como una sustitución real con
// dos ficheros. Dentro de comillas DOBLES el shell SÍ expande `$(...)`, así
// que ahí se sigue buscando.
function substitutionsIn(stage) {
  const out = []
  let outerQuote = null
  for (let i = 0; i < stage.length; i++) {
    const c = stage[i]
    if (outerQuote === "'") { if (c === "'") outerQuote = null; continue }
    if (outerQuote === '"') {
      if (c === '"') outerQuote = null
      if (c !== '$' || stage[i + 1] !== '(') continue
    } else if (c === "'" || c === '"') {
      outerQuote = c; continue
    } else if (c !== '$' || stage[i + 1] !== '(') {
      continue
    }
    let depth = 1
    let j = i + 2
    let quote = null
    let inner = ''
    for (; j < stage.length && depth > 0; j++) {
      const cc = stage[j]
      if (quote) { inner += cc; if (cc === quote) quote = null; continue }
      if (cc === "'" || cc === '"') { quote = cc; inner += cc; continue }
      if (cc === '(') depth++
      if (cc === ')') { depth--; if (depth === 0) break }
      inner += cc
    }
    if (depth === 0) out.push(inner)
  }

  return out
}

function countsOverManyFiles(stage) {
  return substitutionsIn(stage).some((inner) => {
    const tramo = lastPipelineStage(inner)
    if (!tramo || !tramo.stage) return false

    return grepCountFileOperands(tramo.stage) > 1
  })
}

const NOT_A_PREDICATE = [
  {
    matches: (words) => isGrepCountInvocation(words),
    why: '`grep -c` sale con 0 si encuentra AL MENOS UNA coincidencia y con 1 si no encuentra ninguna: su código de salida nunca dice cuántas. Un control que afirma una cuenta se escribe como predicado — `test "$(… | grep -c …)" -eq N` — y entonces el exit code ES la afirmación. (`grep -q`, o el `grep` pelado, sí valen: ahí el exit code ya es la aserción.)',
  },
  {
    matches: (words, piped, stage) => countsOverManyFiles(stage),
    why: '`grep -c` con dos o más ficheros imprime `fichero:cuenta` por cada uno, así que la sustitución devuelve varias líneas y `test` sale con 2 ("integer expression expected") diga lo que diga el código: el control es rojo siempre y ningún implementador puede arreglarlo desde el código. Con un solo fichero (o con una tubería) `grep -c` sí imprime un número. Para "no queda ninguna aparición en estos ficheros" el predicado es `test -z "$(grep -l ... fichero1 fichero2)"`, que enumera nombres y cuya lista vacía ES la afirmación.',
  },
  {
    matches: (words) => words[0] === 'wc',
    why: '`wc` sale con 0 con doce líneas y con doce mil: lo que el plan afirma es el número, y el número va por la salida estándar, no por el código de salida. Envuélvelo en un predicado: `test "$(wc -l < fichero)" -le 150`.',
  },
  {
    matches: (words, piped) => piped && /^(tail|head)$/.test(words[0]),
    why: 'cerrar una tubería con `tail` o `head` tira el código de salida del comando que importa y deja el de `tail`, que es 0 casi siempre — `make check 2>&1 | tail -80` sale por 0 aunque `make check` haya fallado. Deja el comando solo, o captura su código sin tubería (`cmd > fichero 2>&1; echo $?`).',
  },
  {
    matches: (words) => words[0] === 'git' && words[1] === 'status',
    why: '`git status` sale con 0 con el árbol sucio y con el árbol limpio, así que como control no mide nada. Para "no queda nada sin commitear" el predicado es `test -z "$(git status --porcelain)"`.',
  },
]

// ============================================================================
// `## 8. Global verification` ES DEL PROGRAMA, NO DE PROSA (§3.7-A del handoff
// docs/prompt-juez-lo-que-queda.md).
//
// El plan declara la validación de punta a punta para cuando todas las tareas
// estén comiteadas, y hasta este slice ningún programa la ejecutaba: `ct-step
// controls` sólo mide el bloque **Verification:** DE CADA TAREA — cero
// referencias a §8 en todo el fichero. Es la misma trampa del §2.5 que ya
// cerró `verification-block` para las tareas —prosa no es ejecutable— y el
// mismo remedio: los comandos van en un bloque cercado, con el escape
// declarable "N/A — <razón>" para el slice que de verdad no tiene punta a
// punta que correr (documentación, configuración pura). Exigir un comando a
// ese slice sería el guard imposible de F14 otra vez, sólo que aplicado a §8.
//
// A diferencia del bloque por tarea, aquí SÍ se admite prosa antes Y DESPUÉS
// del fence: §8 lleva también el "qué mirar" para el gate humano `visual`
// (arrancar los servidores, abrir la URL, comprobar tres cosas a ojo), y esa
// prosa no es el objeto de esta regla — sólo el bloque de comandos lo es. Por
// eso la búsqueda del fence no exige que sea el primero tras el encabezado
// (como sí exige `commandsAfter` para **Verification:**): recorre todo el
// tramo de §8 y se queda con el PRIMERO que abre.
//
// Reusa `lastPipelineStage` y `NOT_A_PREDICATE`: la vara que impide que un
// control mida al revés es la misma para el bloque por tarea y para el bloque
// de §8 — el `grep -c` invertido de rust-monitoring#10 es el mismo defecto
// aquí que allí.
// ============================================================================
const GLOBAL_HEADING = /^## 8\. Global verification\b/
const GLOBAL_NA = /^N\/A\b/i

function extractGlobal(lines, push) {
  const desde = lines.findIndex((l) => l.structural && GLOBAL_HEADING.test(l.line))
  if (desde === -1) {
    push(0, 'global-verification-block', 'el plan no declara "## 8. Global verification": la validación de punta a punta no puede ejecutarla un programa que no sabe dónde buscarla.')
    return { commands: [] }
  }
  let hasta = lines.findIndex((l, i) => i > desde && l.structural && /^## /.test(l.line))
  if (hasta === -1) hasta = lines.length
  const cuerpo = lines.slice(desde + 1, hasta)

  // El escape: "N/A — <razón>" como primera línea no vacía del tramo declara
  // que este slice no tiene punta a punta que correr, y no es un problema.
  const primeraNoVacia = cuerpo.find((l) => l.structural && l.line.trim() !== '')
  if (primeraNoVacia && GLOBAL_NA.test(primeraNoVacia.line.trim())) return { commands: [] }

  const abre = cuerpo.findIndex((l) => l.fence && l.opens)
  let comandos = null
  if (abre !== -1) {
    comandos = []
    for (let j = abre + 1; j < cuerpo.length; j++) {
      if (cuerpo[j].fence) break
      const t = cuerpo[j].line.trim()
      if (t === '' || t.startsWith('#')) continue
      comandos.push(t)
    }
    // Cercado sin cerrar: no hay bloque que valga, igual que en `commandsAfter`.
    if (!cuerpo.slice(abre + 1).some((l) => l.fence)) comandos = null
  }

  if (comandos === null || comandos.length === 0) {
    push(0, 'global-verification-block', 'la "## 8. Global verification" del plan declara la validación de punta a punta en prosa, y un programa no ejecuta prosa. Los comandos van en un bloque cercado bajo "## 8. Global verification", o la línea exacta "N/A — <razón>".')
    return { commands: [] }
  }

  for (const comando of comandos) {
    const tramo = lastPipelineStage(comando)
    if (!tramo || !tramo.stage) continue
    const words = splitRespectingQuotes(tramo.stage)
    const roto = NOT_A_PREDICATE.find((r) => r.matches(words, tramo.piped, tramo.stage))
    if (roto) {
      push(0, 'global-verification-predicate', `la "## 8. Global verification" verifica con \`${comando}\`, y su código de salida no puede afirmar lo que el control dice medir: ${roto.why}`)
    }
  }

  return { commands: comandos }
}

// ============================================================================
// LA ENTRADA PÚBLICA
//
// Devuelve `{ tasks, problems, global }`. `problems` no está vacío cuando el
// plan no es ejecutable, y su presencia es lo que el conductor traduce a su
// código de salida 6: "arregla el plan", que no es lo mismo que "el trabajo
// está mal". `global` es lo que hay que ejecutar tras la última tarea
// comiteada (§3.7-A): `{ commands }`, vacío cuando §8 declara "N/A" o cuando
// el plan no la trae ejecutable (y entonces hay un `problem` que lo explica).
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
    } else {
      for (const comando of commands) {
        const tramo = lastPipelineStage(comando)
        if (!tramo || !tramo.stage) continue
        const words = splitRespectingQuotes(tramo.stage)
        const roto = NOT_A_PREDICATE.find((r) => r.matches(words, tramo.piped, tramo.stage))
        if (roto) {
          push(h.n, 'verification-predicate', `la tarea ${h.n} verifica con \`${comando}\`, y su código de salida no puede afirmar lo que el control dice medir: ${roto.why}`)
        }
      }
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

  // La extracción de §8 corre sobre `lines` COMPLETO, no sobre el `cuerpo` de
  // ninguna tarea: sin tareas siguientes, el §8 de un plan real cae dentro del
  // tramo de la ÚLTIMA tarea (es inocuo para el bucle de arriba, que sólo
  // reacciona a marcadores), pero aquí hace falta el fichero entero para
  // encontrar su propio encabezado "## 8.".
  const global = extractGlobal(lines, push)

  return { tasks, problems, global }
}
