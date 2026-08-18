// ============================================================================
// HARNESS — las dos llamadas al modelo, en datos: qué argv, qué prompt, qué se
// acepta como respuesta.
//
// Este módulo NO ejecuta nada. Construye el argv y lee la respuesta; quien
// lanza el proceso es `ct-run.mjs`. Es la misma frontera que separa
// `plan-contract.js` de `dispatch-check.mjs`, y es lo que permite testear el
// contrato de las llamadas sin gastar un céntimo.
//
// ---------------------------------------------------------------------------
// EL ARGV NO ES UNA PREFERENCIA: CADA FLAG SALE DE UNA MEDIDA (spec §2.1, §2.2,
// §2.8, medidas el 2026-08-18 contra `claude` 2.1.234)
//
// --setting-sources ""   El hook SessionStart de ESTE plugin hidrata cualquier
//                        llamada lanzada dentro del worktree de un slice: sin
//                        esta flag, el juez nace leyendo el estado del slice
//                        que tiene que juzgar. Medido con un canario en
//                        `.agent/SLICE.md` y `--tools ""`: lo repetía. La
//                        fuente `user` es la que habilita el plugin, así que
//                        quitarla apaga sus hooks — y la autenticación OAuth
//                        sobrevive, que es lo que `--bare` no permitía.
//
// --strict-mcp-config    38 VECES MÁS BARATO. Una llamada headless carga por
//                        defecto todos los servidores MCP de la máquina, y las
//                        definiciones de sus herramientas entran en el contexto
//                        AUNQUE la llamada vaya con `--tools ""`: `--tools`
//                        decide qué puede usar el modelo, no qué se le manda.
//                        Medido: 0,5552 USD contra 0,0145 USD por la misma
//                        llamada. A 16 llamadas por slice, la flag es la
//                        diferencia entre 9 dólares y 23 céntimos.
//
// --output-format json   Trae `structured_output` (la respuesta ya parseada),
//                        `total_cost_usd` (el tope en dinero lo mide el binario,
//                        no lo estima el programa), `session_id` (para poder
//                        abrir LA conversación del juez de la tarea 5) y
//                        `permission_denials`.
//
// --json-schema          Toma el JSON LITERAL, no una ruta: pasarle un fichero
//                        falla con "--json-schema is not valid JSON".
//
// Y el stdin va cerrado: sin eso el binario espera 3 segundos a que le llegue
// algo por la entrada estándar y lo avisa por stderr.
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

export const IMPLEMENTER_TOOLS = 'Read,Write,Edit,Grep,Glob,Bash'
// El juez no puede ejecutar, y no es una promesa en prosa: se lo quita el
// binario. Tampoco ve la salida de los controles — el programa le pasa RUTAS —
// porque un lint sucio no debe ensuciarle el criterio al único agente cuyo
// valor es el juicio.
export const JUDGE_TOOLS = 'Read,Grep,Glob'

export function buildArgv({ tools, schema, prompt, model }) {
  return [
    '-p',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--tools', tools,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    // Sin `--model`, la llamada usa el modelo por defecto de la cuenta. El flag
    // existe porque las dos llamadas no valen lo mismo: el juez es el único
    // paso cuyo valor entero es el juicio, y el implementador de una tarea
    // prescriptiva es el que más tokens quema. Poder separarlos es la palanca
    // de coste que queda después de --strict-mcp-config.
    ...(model ? ['--model', model] : []),
    prompt,
  ]
}

// ============================================================================
// LA RESPUESTA
// ============================================================================

// La envoltura de `--output-format json`. Un stdout que no es JSON no es un
// error del modelo: es que `claude` no llegó a arrancar, y eso se distingue.
export function readEnvelope(stdout) {
  let raw
  try {
    raw = JSON.parse(String(stdout))
  } catch {
    return { ok: false, why: 'la salida de claude no es JSON: la llamada no llegó a completarse' }
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, why: 'la salida de claude no es un objeto' }
  }
  return {
    ok: raw.is_error !== true,
    why: raw.is_error === true ? `claude devolvió is_error (subtype: ${raw.subtype ?? 'sin subtype'})` : null,
    sessionId: raw.session_id ?? null,
    costUsd: Number(raw.total_cost_usd) || 0,
    structured: raw.structured_output ?? null,
    text: typeof raw.result === 'string' ? raw.result : '',
    denials: Array.isArray(raw.permission_denials) ? raw.permission_denials : [],
  }
}

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
    `Tarea ${task} de ${tasksTotal} del plan del slice, implementada y juzgada por ct-run.`,
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
