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
    if (t === '-m' || t === '--message') { if (i + 1 < tokens.length) out.push(tokens[++i]); continue }
    if (t.startsWith('--message=')) { out.push(t.slice('--message='.length)); continue }
    // Forma pegada `-mTEXTO`. Se excluye `--…` para no tragarse `--mixed` y
    // parecidos: sólo una opción corta puede llevar el valor pegado.
    if (t.startsWith('-m') && t.length > 2 && !t.startsWith('--')) { out.push(t.slice(2)); continue }
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
