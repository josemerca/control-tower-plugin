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

// El veredicto. `ruling` y `findings` bastan: la severidad es lo que separa un
// veto de un refunfuño, y el resto de la prosa del juez no la lee ningún
// programa.
export const VERDICT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['ruling', 'findings'],
  properties: {
    ruling: { type: 'string', enum: ['PASS', 'FAIL'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'what', 'where'],
        properties: {
          severity: { type: 'string', enum: SEVERITIES },
          what: { type: 'string' },
          where: { type: 'string' },
        },
      },
    },
  },
})

// El informe del implementador también lleva esquema, y el spec no lo pedía.
// La razón es la misma que hizo falta un `plan-tasks.js`: el programa necesita
// las RUTAS que se tocaron para stagearlas, y sacar rutas de un informe en
// prosa es la trampa del §2.5 otra vez, en el otro extremo del bucle.
export const REPORT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['paths', 'summary'],
  properties: {
    paths: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
})

export const IMPLEMENTER_TOOLS = 'Read, Write, Edit, Grep, Glob, Bash'
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
// Esta constante es una COPIA del frontmatter de `agents/ct-judge.md`, y quien
// las ata es `step-contracts.test.js`: se duplica porque este módulo es puro y
// no lee disco, no porque dé igual que divergan. Divergieron una vez, y el
// resultado fue que `ct-step next` anunciaba unas herramientas que no eran las
// del juez que se iba a despachar.
export const JUDGE_TOOLS = 'Read, Grep, Glob, Write'

const esTexto = (v) => typeof v === 'string' && v.trim() !== ''

// Validación a mano y no con una librería de esquemas: el spec exige cero
// dependencias nuevas, y lo que hay que comprobar cabe en veinte líneas.
export function readVerdict(structured) {
  if (!structured || typeof structured !== 'object') return { why: 'el juez no devolvió structured_output' }
  const { ruling, findings } = structured
  if (ruling !== 'PASS' && ruling !== 'FAIL') return { why: `ruling desconocido: ${JSON.stringify(ruling)}` }
  if (!Array.isArray(findings)) return { why: 'findings no es una lista' }
  for (const [i, f] of findings.entries()) {
    if (!f || typeof f !== 'object') return { why: `el hallazgo ${i} no es un objeto` }
    if (!SEVERITIES.includes(f.severity)) return { why: `el hallazgo ${i} tiene una severidad desconocida: ${JSON.stringify(f.severity)}` }
    if (!esTexto(f.what) || !esTexto(f.where)) return { why: `el hallazgo ${i} no dice qué o dónde` }
  }
  // La coherencia que el original comprueba en el propio agregado: un PASA con
  // un hallazgo grave se contradice a sí mismo. No se "interpreta" hacia el
  // lado prudente — se descarta y se vuelve a preguntar, porque un juez que no
  // se entiende a sí mismo no ha juzgado.
  if (ruling === 'PASS' && findings.some((f) => f.severity === 'high')) {
    return { why: 'un PASS con un hallazgo de severidad high contradice la rúbrica: un hallazgo grave es FAIL' }
  }
  return { verdict: { ruling, findings } }
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
