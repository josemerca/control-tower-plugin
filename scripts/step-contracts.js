// ============================================================================
// STEP-CONTRACTS — lo que cruza la frontera entre la sesión y sus subagentes.
//
// La sesión despacha un implementador y un juez; lo que vuelve de ellos son
// ficheros. Este módulo dice qué se acepta como respuesta y qué escribe el
// plugin, y es PURO: no lanza procesos, no lee disco.
//
// Antes esto construía además el argv de `claude -p` —el conductor-programa que
// hacía las dos llamadas él mismo—, y eso se fue con D-4: la decisión de que el
// orquestador deje de ser una sesión de chat está aplazada y su dueño es José.
// Lo que sobrevive es la parte que vale igual con un subagente al otro lado: el
// ESQUEMA de lo que se acepta.
//
// Y el esquema importa más ahora, no menos. Con `claude -p` lo imponía el
// binario (`--json-schema`, que sólo existe en modo `--print`); con un subagente
// lo impone esta validación, y un veredicto que no cumple es un descarte — se
// vuelve a preguntar en vez de interpretar hacia el lado que convenga.
// ============================================================================

import { findClosingKeywords } from './closing-keywords.js'

export const SEVERITIES = ['high', 'medium', 'low']

// Las ocho reglas de la rúbrica del juez, en el orden en que la recorre (la
// rúbrica en sí se escribe en una tarea posterior de este mismo plan; aquí
// sólo se fija el vocabulario). Enum CERRADO, y no por la validación por la
// validación: la telemetría cuenta hallazgos por regla (`findings_by_rule` en
// run-metrics.js), y una regla inventada por el juez convertiría esa cuenta en
// ruido. Un `rule` que no está aquí descarta el veredicto igual que ya
// descarta un `ruling` inventado — el descarte no es un error, es "vuelve a
// preguntar": un hallazgo que no encaja en ninguna regla es un hallazgo que el
// juez no ha sabido justificar.
export const VERDICT_RULES = [
  'objetivo', 'asercion-tdd', 'contrato', 'decisiones-cerradas',
  'patrones', 'manipulacion-tests', 'fixture-theater', 'alcance',
]

// Lo que un ítem del recorrido pudo hacer. El recorrido ya distinguía "no se
// miró" de "se miró", pero dentro de "se miró" seguía habiendo dos cosas que
// se leían igual, y una de ellas es un agujero:
//
//   `no-aplica` — el ítem no tiene SUJETO. No hay tests previos que debilitar,
//     no hay símbolos que comparar, la tarea es prosa. Es la rúbrica
//     funcionando: no hay nada que mirar y se dice.
//   `sin-vara`  — el ítem tiene sujeto pero le falta el INSUMO con el que
//     medirlo. El plan no nombró ningún patrón, o la sección que tenía que
//     llegar en el brief no llegó. El juez no juzgó: juzgó a ciegas.
//
// Sin este campo las dos salen como un `result` en prosa que nadie agrega, y
// `patrones: N/A` es indistinguible de `patrones: conforme`. Es la mitad de H5
// del informe de la corrida en repo ajeno, y la razón por la que dos personas
// mirando veredictos a mano sospechaban que el juez no miraba: no había forma
// de saberlo. `run-metrics.js` cuenta los `sin-vara` por intento, así que el
// agujero pasa de sospecha a columna.
//
// Enum CERRADO por el mismo motivo que VERDICT_RULES: lo que no se puede contar
// no se puede leer, y un cuarto valor inventado por el juez convierte la cuenta
// en ruido.
export const RUBRIC_OUTCOMES = ['conforme', 'no-aplica', 'sin-vara']

// El veredicto: el fallo, el RECORRIDO de la rúbrica y los hallazgos. La
// severidad es lo que separa un veto de un refunfuño, y el resto de la prosa
// del juez no la lee ningún programa.
//
// Cada hallazgo lleva además su REGLA: cuál de las ocho de la rúbrica incumple.
// Antes de esto un hallazgo decía severidad, qué y dónde, pero no POR QUÉ es un
// hallazgo — y sin eso, la telemetría no puede contar cuántos vetos vienen de
// cada regla, que es justo el dato que dice si la rúbrica está bien calibrada.
//
// Y `rubric` es el paseo por los ocho ítems, cada uno exactamente una vez con
// lo que dio. La rúbrica ya lo pedía, pero lo pedía en PROSA y para la
// respuesta conversacional del subagente, que nadie captura: lo que se validaba
// y se persistía era sólo `{ruling, findings}`. Medido en
// jjponz/rust-monitoring#10, donde los tres veredictos que viajaron
// commiteados en la pull request eran `{"ruling": "PASS", "findings": []}` —
// exactamente el artefacto que la propia rúbrica declara indistinguible de ocho
// ítems que nadie abrió. Lo peor de aquel caso es que el PASS vacío era
// CORRECTO: cuatro de los ocho ítems no tenían sujeto (un esqueleto sobre un
// repo vacío, sin patrones que citar, sin tests previos, sin contratos), y no
// había forma de saberlo leyendo el fichero. El recorrido es lo que distingue
// "no aplicaba, y por esto" de "no se miró"; por eso entra en el esquema y no
// en una línea que nadie valida.
//
// Y cada hallazgo lleva `evidence`: la CITA literal que lo sostiene — la frase
// del plan que se incumple, o la línea del diff que lo prueba. No es `what`
// (que narra el defecto) ni `where` (que ubica): es el texto que alguien puede
// contrastar sin abrir nada. La rúbrica ya exigía citar antes de bloquear
// ("evidence before blocking"), pero lo exigía en PROSA, en un fichero de
// doscientas cuarenta líneas donde compite con ocho ítems que hay que recorrer
// de verdad. Un campo obligatorio del esquema no se olvida; una frase sí. Y se
// exige en las tres severidades y no sólo en `high`: un campo condicional se
// olvida igual que la prosa, y un `medium` sin cita manda al implementador a
// una vuelta pagada sin decirle qué mirar.
//
// El enum del ítem es el MISMO array VERDICT_RULES, no una copia: dos listas de
// ocho identificadores divergen al primer renombrado, que es el desacople que
// este módulo ya pagó con JUDGE_TOOLS.
export const VERDICT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['ruling', 'rubric', 'findings'],
  properties: {
    ruling: { type: 'string', enum: ['PASS', 'FAIL'] },
    rubric: {
      type: 'array',
      minItems: VERDICT_RULES.length,
      maxItems: VERDICT_RULES.length,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'result', 'outcome'],
        properties: {
          rule: { type: 'string', enum: VERDICT_RULES },
          result: { type: 'string' },
          outcome: { type: 'string', enum: RUBRIC_OUTCOMES },
        },
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'severity', 'what', 'where', 'evidence'],
        properties: {
          rule: { type: 'string', enum: VERDICT_RULES },
          severity: { type: 'string', enum: SEVERITIES },
          what: { type: 'string' },
          where: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
  },
})

// El informe del implementador también lleva esquema, y el spec no lo pedía.
// La razón es la misma que hizo falta un `plan-tasks.js`: el programa necesita
// las RUTAS que se tocaron para stagearlas, y sacar rutas de un informe en
// prosa es la trampa del §2.5 otra vez, en el otro extremo del bucle.
//
// Aquí hubo un KIND por ruta ('production' o 'test'). La idea era que el
// juez —vía `escribirPaquete` en `scripts/ct-step.mjs`— viera de un vistazo si
// un diff con la suite en verde no tocaba ningún fichero de producción. Se
// quitó: el juez tiene el diff delante y distingue un fichero de test de uno
// de producción sin que nadie se lo diga, así que la etiqueta no le aportaba
// nada que no pudiera ver por sí mismo. La producía además el propio agente al
// que se juzga, no la verificaba nadie, y cuando venía mal no degradaba el
// juicio: lo DESACTIVABA — el ítem de la rúbrica que mira los ficheros de test
// dejaba de mirar un test mal etiquetado. Una capa de indirección entre el
// juez y la evidencia que sólo podía introducir error. No se vuelva a añadir
// sin resolver antes ese problema de raíz.
export const REPORT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['paths', 'summary'],
  properties: {
    paths: {
      type: 'array',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
  },
})

// `Skill` está aquí porque la rúbrica del implementador
// (`prompts/task-implementer.md`) ya no lleva el ciclo TDD dentro: manda cargar
// `control-tower-loop:test-driven-development`, la copia que trae el plugin. Sin
// esta herramienta esa primera línea es imposible de cumplir y el implementador
// se queda sin el oficio que la rúbrica delega.
export const IMPLEMENTER_TOOLS = 'Read, Write, Edit, Grep, Glob, Bash, Skill'
// El juez no puede EJECUTAR, y no es una promesa en prosa: se lo quita la
// declaración del agente (`agents/ct-judge.md`), igual que antes se lo quitaba
// el binario. Tampoco ve la SALIDA de los controles —se le pasan rutas— porque
// un lint sucio no debe ensuciarle el criterio al único agente cuyo valor es el
// juicio.
//
// `Write` SÍ, y no debilita lo anterior: el canal por el que entrega su
// veredicto es un fichero, así que sin `Write` el paso `judge` no se puede
// cerrar —medido en la tarea 1 del slice #5 de repo-pulse, la primera vez que
// este agente juzgó algo—. Lo que podría escribir de más no llega a ninguna
// parte: `ct-step commit` comitea las rutas que declaró el IMPLEMENTADOR, no lo
// que haya en el árbol.
//
// `Skill` SÍ, y por la misma razón por la que la tiene el implementador: la
// rúbrica le manda ejercerla. Desde `e473c97`, el `Rules to obey:` de `## 3.
// Reference patterns` admite declarar una skill como vara secundaria, y el ítem
// `patrones` manda abrirla («any skill named there — open them and read the
// rules»). Pero un nombre de skill (`backend-engineering:backend-best-practices`)
// no es una ruta: `Read` no lo abre, y `plan-contract.js` tampoco lo comprueba en
// disco A PROPÓSITO. Sin esta herramienta la vara secundaria era inalcanzable, y
// en silencio: el juez contestaría `conforme` sobre un documento que nunca pudo
// abrir, que es justo el agujero que `sin-vara` existe para cerrar. Es el defecto
// §3.1 de `docs/prompt-juez-lo-que-queda.md`, y es lo que hace `agentic-skills`
// en su `slice_verifier_judge.py`: TOOLS = ("Read", "Grep", "Glob", "Skill").
//
// No debilita el «sin shell»: `Skill` carga instrucciones, no ejecuta procesos.
// Lo que el juez no puede hacer sigue decidiéndolo la ausencia de `Bash` en la
// declaración del agente.
//
// Esta constante es una COPIA del frontmatter de `agents/ct-judge.md`, y quien
// las ata es `step-contracts.test.js`: se duplica porque este módulo es puro y
// no lee disco, no porque dé igual que divergan. Divergieron una vez, y el
// resultado fue que `ct-step next` anunciaba unas herramientas que no eran las
// del juez que se iba a despachar.
export const JUDGE_TOOLS = 'Read, Grep, Glob, Write, Skill'

// Los tres encabezados del paquete de revisión que escribe `escribirPaquete`
// en `scripts/ct-step.mjs`, en el orden en que aparecen en el fichero. La
// rúbrica del juez (`agents/ct-judge.md`) los cita por su nombre entre
// comillas invertidas en "What you are given" para decirle al juez qué trae
// cada sección — y ese cruce es el mismo desacople que ya sufrieron
// JUDGE_TOOLS y VERDICT_RULES: dos copias a mano de la misma cadena, sin nada
// que las ate. Aquí es peor que con JUDGE_TOOLS porque tampoco hay un error
// de ejecución que lo delate — un encabezado renombrado en el script deja a
// la rúbrica señalando una sección que no existe, y el juez sigue
// contestando como si la hubiera leído.
export const PACKAGE_SECTIONS = ['Files changed', 'Rutas tocadas', 'Diff']

const esTexto = (v) => typeof v === 'string' && v.trim() !== ''

// Validación a mano y no con una librería de esquemas: el spec exige cero
// dependencias nuevas, y lo que hay que comprobar cabe en veinte líneas.
export function readVerdict(structured) {
  if (!structured || typeof structured !== 'object') return { why: 'el juez no devolvió structured_output' }
  const { ruling, rubric, findings } = structured
  if (ruling !== 'PASS' && ruling !== 'FAIL') return { why: `ruling desconocido: ${JSON.stringify(ruling)}` }
  if (!Array.isArray(findings)) return { why: 'findings no es una lista' }
  for (const [i, f] of findings.entries()) {
    if (!f || typeof f !== 'object') return { why: `el hallazgo ${i} no es un objeto` }
    if (!SEVERITIES.includes(f.severity)) return { why: `el hallazgo ${i} tiene una severidad desconocida: ${JSON.stringify(f.severity)}` }
    if (!esTexto(f.what) || !esTexto(f.where)) return { why: `el hallazgo ${i} no dice qué o dónde` }
    // La cita, con el mismo trato que el qué y el dónde: sin ella el hallazgo
    // no se puede contrastar, y un veto que no se puede contrastar es el veto
    // defensivo que la calibración de la rúbrica existe para impedir.
    if (!esTexto(f.evidence)) return { why: `el hallazgo ${i} no cita la evidencia que lo sostiene` }
    // La regla es el enum CERRADO: no se asume ninguna por defecto, porque una
    // regla inventada por el juez ensuciaría el conteo por regla de la
    // telemetría tanto como un `rule` ausente.
    if (!VERDICT_RULES.includes(f.rule)) return { why: `el hallazgo ${i} incumple una regla desconocida: ${JSON.stringify(f.rule)}` }
  }
  // El recorrido de la rúbrica, con el mismo criterio que el `rule` de un
  // hallazgo: enum CERRADO y descarte, no interpretación. Aquí el descarte
  // cubre además la CARDINALIDAD, que en un hallazgo no aplica — la rúbrica son
  // ocho ítems y se contestan los ocho, así que un recorrido corto, uno con un
  // ítem repetido y uno con un identificador que nadie reconoce son el mismo
  // fallo: un veredicto del que no se puede afirmar que la rúbrica se recorrió.
  if (!Array.isArray(rubric)) return { why: 'el veredicto no trae el recorrido de la rúbrica' }
  const recorridos = []
  for (const [i, paso] of rubric.entries()) {
    if (!paso || typeof paso !== 'object') return { why: `el paso ${i} del recorrido no es un objeto` }
    if (!VERDICT_RULES.includes(paso.rule)) return { why: `el recorrido nombra un ítem desconocido de la rúbrica: ${JSON.stringify(paso.rule)}` }
    // Un ítem nombrado sin resultado son los ocho identificadores sin nada
    // detrás: el mismo PASS vacío de rust-monitoring#10, sólo más largo.
    if (!esTexto(paso.result)) return { why: `el ítem ${paso.rule} del recorrido no dice lo que dio` }
    // El resultado en prosa dice lo que dio; `outcome` dice de qué CLASE fue,
    // que es lo único agregable. Sin él, "no había con qué medir" y "medí y
    // está bien" son el mismo dato.
    if (!RUBRIC_OUTCOMES.includes(paso.outcome)) return { why: `el ítem ${paso.rule} del recorrido no dice de qué clase fue su resultado: ${JSON.stringify(paso.outcome)}` }
    if (recorridos.includes(paso.rule)) return { why: `el recorrido repite el ítem ${paso.rule} de la rúbrica` }
    recorridos.push(paso.rule)
  }
  const sinRecorrer = VERDICT_RULES.filter((regla) => !recorridos.includes(regla))
  if (sinRecorrer.length) return { why: `el recorrido no pasa por ${sinRecorrer.join(', ')}: la rúbrica son ocho ítems y se contestan los ocho` }
  // La coherencia que el original comprueba en el propio agregado: un PASA con
  // un hallazgo grave se contradice a sí mismo. No se "interpreta" hacia el
  // lado prudente — se descarta y se vuelve a preguntar, porque un juez que no
  // se entiende a sí mismo no ha juzgado.
  if (ruling === 'PASS' && findings.some((f) => f.severity === 'high')) {
    return { why: 'un PASS con un hallazgo de severidad high contradice la rúbrica: un hallazgo grave es FAIL' }
  }
  return { verdict: { ruling, rubric, findings } }
}

// De veredicto a resultado de la tabla. Las tres salidas son las tres que
// `run-machine.js` sabe atender desde el paso `judge`.
export function outcomeOfVerdict(verdict) {
  if (verdict.ruling === 'FAIL') return 'failed'
  // Un PASA con hallazgos que no son de severidad baja no bloquea, pero tampoco
  // se ignora: vuelve al implementador con presupuesto propio.
  return verdict.findings.some((f) => f.severity !== 'low') ? 'corrections-ordered' : 'done'
}

export function readReport(structured) {
  if (!structured || typeof structured !== 'object') return { why: 'el implementador no devolvió structured_output' }
  const { paths, summary } = structured
  if (!Array.isArray(paths) || !paths.every(esTexto)) return { why: 'el informe no trae la lista de rutas tocadas' }
  if (!esTexto(summary)) return { why: 'el informe no trae resumen' }
  // Una ruta absoluta o que sube de directorio no se stagea: el programa hace
  // `git add` de lo que diga esta lista, así que la lista es una superficie de
  // ataque, no un dato de confianza.
  const fuera = paths.filter((p) => p.startsWith('/') || p.split('/').includes('..'))
  if (fuera.length) return { why: `el informe declara rutas fuera del worktree: ${fuera.join(', ')}` }
  // La misma ruta dos veces es un informe que no se entiende a sí mismo: no
  // hay forma de decidir cuál de las dos declaraciones vale. Mismo criterio
  // que una ruta fuera del worktree: se descarta el informe entero, no se
  // decide por él.
  const repetidas = [...new Set(paths.filter((ruta, i, todas) => todas.indexOf(ruta) !== i))]
  if (repetidas.length) return { why: `el informe declara la misma ruta más de una vez: ${repetidas.join(', ')}` }
  return { report: { paths, summary } }
}

// ============================================================================
// LO QUE EL PROGRAMA ESCRIBE
//
// EL IMPLEMENTADOR NO COMITEA: COMITEA EL PROGRAMA. Es lo que hace que un veto
// no deje rastro que deshacer, y aquí encaja sin fricción porque en Control
// Tower una tarea ya es un commit.
//
// Y por eso este módulo valida su propio mensaje: el hook `commit-keyword-guard`
// es un PreToolUse sobre la herramienta Bash de una SESIÓN, así que un
// `git commit` lanzado por un programa no pasa por esa puerta. Si el programa no
// se mira el mensaje, la barandilla que el repo construyó en F27 no cubre este
// camino.
// ============================================================================
export function commitMessage({ issue, task, tasksTotal, name }) {
  const titulo = `${sanear(name)} (#${issue}, tarea ${task}/${tasksTotal})`
  const cuerpo = [
    '',
    `Tarea ${task} de ${tasksTotal} del plan del slice, implementada y juzgada paso a paso con ct-step.`,
    '',
    'Co-Authored-By: Claude <noreply@anthropic.com>',
  ].join('\n')
  const mensaje = titulo + '\n' + cuerpo
  const keywords = findClosingKeywords(mensaje)
  if (keywords.length) {
    throw new Error(`el mensaje de commit contiene una closing keyword (${keywords.map((k) => `${k.keyword} ${k.ref}`).join(', ')}) y cerraría un issue sin que nadie lo haya decidido`)
  }
  return mensaje
}

// El nombre de la tarea viene del plan, o sea de un agente. "fixes #12" en el
// título de una tarea es exactamente el accidente de F27, así que la keyword se
// desactiva rompiendo la referencia, no borrando la palabra: el título sigue
// leyéndose igual.
function sanear(name) {
  return String(name || 'tarea sin nombre').replace(/#(\d+)/g, 'issue $1').trim()
}
