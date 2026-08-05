// ============================================================================
// closing-keywords.js — ¿ESTE COMANDO VA A METER UNA CLOSING KEYWORD EN UN
// MENSAJE DE COMMIT?
//
// Módulo PURO: no lee disco, no lanza procesos, no toca la red. Todo lo que
// necesita viaja en la cadena del comando.
//
// Existe porque GitHub cierra un issue con una closing keyword que aparezca en
// CUALQUIER mensaje de commit que llegue a la rama por defecto, y las comillas
// NO protegen: en un repo real, un commit de documentación cuyo cuerpo
// MENCIONABA la cadena `Closes #451` —dentro de una frase que explicaba que el
// kickoff no la llevaba— cerró ese issue.
//
// EL RIESGO CARO DE ESTE MÓDULO NO ES DETECTAR POCO: ES DETECTAR DE MÁS. El
// contrato del loop manda poner el cierre en el CUERPO DEL PR, así que un
// detector que mirase el comando entero bloquearía `gh pr create --body
// "Closes #42"` — es decir, convertiría la barandilla en un ladrillo sobre el
// camino feliz. De ahí que lo primero que hace este módulo sea CORTAR el
// comando en sub-comandos independientes.
// ============================================================================

/**
 * tokenizeSegments: la línea de shell → un array de tokens por cada
 * sub-comando independiente.
 *
 * Corta por `&&`, `||`, `;`, `|`, `&` y salto de línea. El corte es la razón de
 * ser de la función: sin él, `git commit -m x && gh pr create --body y` sería
 * un solo comando y el `--body` contaminaría el registro del commit.
 *
 * Entiende comillas simples (nada se interpreta dentro), comillas dobles (con
 * escapes) y `\` fuera de comillas. Lo que deliberadamente NO entiende, porque
 * no hace falta para decidir y sí complicaría el módulo: sustitución de
 * comandos (`$(…)`, backticks), subshells `( )`, expansión de variables y
 * redirecciones. Un mensaje construido por sustitución de comandos no es
 * visible aquí, y eso está declarado como límite de la puerta.
 */
export function tokenizeSegments(command) {
  const src = typeof command === 'string' ? command : ''
  const segments = []
  let tokens = []
  let cur = ''
  // `has` distingue "token vacío entrecomillado" de "no hay token en curso":
  // sin él, `-m ""` perdería su argumento y el commit parecería no llevar
  // mensaje.
  let has = false
  const pushTok = () => { if (has) { tokens.push(cur); cur = ''; has = false } }
  const pushSeg = () => { pushTok(); if (tokens.length) segments.push(tokens); tokens = [] }

  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') { cur += src[i + 1] ?? ''; has = true; i += 2; continue }
    if (c === "'") {
      const end = src.indexOf("'", i + 1)
      // Comilla sin cerrar: se consume el resto en vez de lanzar. Un comando
      // mal formado no es asunto de este módulo, y reventar aquí dejaría al
      // hook sin decisión por un motivo que no es el suyo.
      if (end === -1) { cur += src.slice(i + 1); has = true; break }
      cur += src.slice(i + 1, end); has = true; i = end + 1; continue
    }
    if (c === '"') {
      i++
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) { cur += src[i + 1]; i += 2; continue }
        cur += src[i]; i++
      }
      has = true; i++; continue
    }
    if (c === ' ' || c === '\t') { pushTok(); i++; continue }
    if (c === '\n' || c === ';') { pushSeg(); i++; continue }
    if (c === '&' || c === '|') { pushSeg(); i += src[i + 1] === c ? 2 : 1; continue }
    cur += c; has = true; i++
  }
  pushSeg()
  return segments
}

// Opciones GLOBALES de git (las que van ANTES del subcomando) que consumen el
// token siguiente. Sin esta lista, `git -C /tmp/repo commit -m x` leería
// `/tmp/repo` como subcomando y el commit pasaría sin registrar.
const GIT_GLOBAL_TAKES_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

const isGitBinary = (tok) => tok === 'git' || tok.endsWith('/git')

// Letras que, dentro de un cúmulo de un solo guion, se comen TODO lo que
// queda detrás como su propio valor (obligatorio u opcional-pegado):
// ninguna letra posterior —ni una `m`— pertenece ya a otra opción.
const CLUSTER_CONSUMES_REST = new Set(['F', 'C', 'c', 't', 'S', 'u'])

/**
 * messagesFromSegment: los mensajes de UN sub-comando, o `[]` si ese
 * sub-comando no es un `git commit` con mensaje en línea.
 *
 * Lo que NO devuelve, y es deliberado: un `git commit` sin `-m` (abre
 * `$EDITOR`), un `-F <fichero>` (el texto está en disco) y un `--amend
 * --no-edit` (reutiliza un mensaje que no viaja en el comando). En esos tres el
 * mensaje no está aquí, así que afirmar cualquier cosa sobre él sería
 * inventarlo.
 */
function messagesFromSegment(tokens) {
  let i = 0
  if (!tokens.length || !isGitBinary(tokens[0])) return []
  i = 1
  while (i < tokens.length && tokens[i].startsWith('-')) {
    const t = tokens[i]
    if (t.includes('=')) { i += 1; continue }
    i += GIT_GLOBAL_TAKES_VALUE.has(t) ? 2 : 1
  }
  if (tokens[i] !== 'commit') return []
  i += 1

  const out = []
  for (; i < tokens.length; i++) {
    const t = tokens[i]
    // Todo lo que va detrás de `--` es pathspec, nunca mensaje.
    if (t === '--') break
    if (t === '--message') { if (i + 1 < tokens.length) out.push(tokens[++i]); continue }
    if (t.startsWith('--message=')) { out.push(t.slice('--message='.length)); continue }
    // Cúmulo de UN SOLO guion (getopt, que es lo que usa git): varias flags
    // cortas pegadas como `-am`. Se recorre carácter a carácter porque una
    // flag anterior a la `m` puede comerse el resto del cúmulo como SU
    // propio valor — `-Fmensaje.txt` no tiene mensaje: la `F` se come
    // `mensaje.txt` entero, y la `m` que aparecería con una búsqueda ciega
    // es sólo la primera letra de ese nombre de fichero, no un mensaje.
    // Ante la duda, no extraer: un falso negativo aquí lo cubre otro
    // detector del plugin; un falso positivo bloquea trabajo legítimo.
    if (t.startsWith('-') && !t.startsWith('--')) {
      const cluster = t.slice(1)
      let valor = null
      for (let j = 0; j < cluster.length; j++) {
        const ch = cluster[j]
        if (ch === 'm') {
          const pegado = cluster.slice(j + 1)
          valor = pegado.length > 0 ? pegado : (i + 1 < tokens.length ? tokens[++i] : null)
          break
        }
        if (CLUSTER_CONSUMES_REST.has(ch)) break // el resto es valor ajeno, no mensaje
        // cualquier otra letra es una flag booleana: se sigue mirando
      }
      if (valor !== null) out.push(valor)
      continue
    }
  }
  return out
}

/**
 * extractCommitMessages: de una línea de shell entera, SOLO los trozos que van
 * a acabar siendo mensaje de commit. Todo lo demás del comando —incluido el
 * `--body` de un `gh pr create`, que el contrato del loop EXIGE que lleve el
 * cierre— queda fuera por construcción.
 */
export function extractCommitMessages(command) {
  return tokenizeSegments(command).flatMap(messagesFromSegment)
}

// Las closing keywords que GitHub reconoce, verbatim de su documentación. No se
// añade ninguna forma que no esté ahí: una keyword de más aquí es un bloqueo de
// un commit legítimo.
export const CLOSING_KEYWORDS = [
  'close', 'closes', 'closed',
  'fix', 'fixes', 'fixed',
  'resolve', 'resolves', 'resolved',
]

// `\b` a los dos lados: sin él, `prefix #42` y `foreclosed #42` dispararían.
// Los dos puntos son opcionales porque GitHub acepta `Closes: #10` igual que
// `Closes #10`. La referencia es `#N` o `owner/repo#N`.
const CLOSING_RE = new RegExp(
  String.raw`\b(${CLOSING_KEYWORDS.join('|')})\b\s*:?\s*(#\d+|[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#\d+)`,
  'gi',
)

/**
 * findClosingKeywords: los pares (keyword, referencia) que GitHub interpretaría
 * como orden de cierre.
 *
 * Devuelve la keyword TAL COMO ESTÁ ESCRITA, no normalizada: el mensaje de la
 * puerta cita el texto del usuario, y «CLOSES» citado como «closes» se lee como
 * si el aviso hablara de otra cosa.
 */
export function findClosingKeywords(text) {
  const src = typeof text === 'string' ? text : ''
  const out = []
  for (const m of src.matchAll(CLOSING_RE)) out.push({ keyword: m[1], ref: m[2] })
  return out
}
