import { parse, stringify } from 'yaml'

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseState(md) {
  const s = (md ?? '').replace(/^﻿/, '').trimStart()
  const m = s.match(FM)
  if (!m) return { meta: {}, body: s.trim() }
  return { meta: parse(m[1]) ?? {}, body: m[2].trim() }
}

// parseStateSafe: `parseState` LANZA si el frontmatter no es YAML válido (lo
// hace `yaml.parse`, y así se queda: quien pida el frontmatter tipado tiene
// derecho a enterarse de que no lo es). Pero los dos hooks corren en el
// arranque/cierre de CADA sesión de un repo bootstrapeado: ahí una excepción
// no es un error informativo, es un hook que revienta con un stack trace por
// stderr en cada turno, del que nadie deduce que el problema es su STATE.md.
// Esta variante nunca lanza y devuelve el error como DATO, para que quien
// hidrata pueda DECIRLO en vez de callarlo (ver composeHydration: un
// frontmatter ilegible es el único caso en que de verdad "no se sabe" si el
// trabajo está bloqueado, y se anuncia como tal).
export function parseStateSafe(md) {
  try {
    return { ...parseState(md), error: null }
  } catch (e) {
    const s = (md ?? '').replace(/^﻿/, '').trimStart()
    return { meta: {}, body: s.trim(), error: e?.message || String(e) }
  }
}

export function renderState({ meta, body }) {
  return `---\n${stringify(meta).trim()}\n---\n\n${(body ?? '').trim()}\n`
}

// ===========================================================================
// `blocked` — el campo que distingue "esto es lo siguiente" de "esto no se
// puede hacer", en un dato que lee un programa y no en prosa dentro de otro
// campo.
//
// EL AGUJERO QUE TAPA (caso real): un repo tenía
// `next_action: "Lanzar la corrida REAL de /ct-groom…"`. Después se descubrió
// que esa corrida escribiría datos falsos y quedó bloqueada. El hook de
// SessionStart inyecta el STATE.md entero en TODA sesión nueva de ese repo (y
// de cualquier worktree suyo), y una sesión fresca lee `next_action` como la
// orden vigente: durante un rato, cualquier sesión nueva habría lanzado el
// groom sin saber nada. La mitigación fue reescribir el campo a mano con la
// palabra "BLOQUEADO" y las razones en prosa — es decir, confiar en que quien
// lo lea interprete bien un texto libre. Eso no es un mecanismo.
//
// POR QUÉ UN CAMPO PROPIO Y NO `status: blocked`:
//   - `status` es el eje de PROGRESO (`not_started` → `in_progress` → …), lo
//     siembra `buildStateSeed` y lo mueve el trabajo. "Bloqueado" es un eje
//     ORTOGONAL: se puede estar bloqueado a medias de un `in_progress`.
//     Fundirlos obliga a destruir el progreso al bloquear y a acordarse de
//     restaurar el valor anterior al desbloquear — un round-trip que nadie
//     hace bien a mano.
//   - un enum no tiene sitio para lo único que hace accionable un bloqueo:
//     POR QUÉ y QUÉ HARÍA FALTA para levantarlo. `blocked` es un mapa
//     (`reason`/`since`/`unblock`) justamente para que esas dos cosas sean
//     campos, no prosa que el lector tenga que adivinar.
//
// SILENCIO = NO BLOQUEADO (decisión deliberada). Un STATE.md sin el campo se
// lee como no bloqueado, no como "no se sabe":
//   - TODOS los STATE.md que existen hoy son anteriores al campo. Con
//     "silencio = no se sabe", cada hidratación de cada repo abriría con un
//     aviso — y un aviso que sale siempre es un aviso que nadie lee (el aviso
//     en prosa de `commands/ct-init.md` ya demostró que la prosa que siempre
//     está se ignora).
//   - el fallo que arreglamos es un POSITIVO CADUCADO (un `next_action` que no
//     debe ejecutarse), no un negativo ausente.
//   - el caso en que de verdad NO SE SABE sí existe y sí grita: un
//     frontmatter que no se puede parsear (ver `parseStateSafe` y
//     `composeHydration`).
// ===========================================================================

// Valores que un humano escribe queriendo decir "no bloqueado" y que un
// truthy-check ingenuo leería como bloqueo. Comparación exacta (trim +
// minúsculas) sobre la cadena ENTERA, nunca por prefijo: `blocked: "no puedo
// seguir hasta que…"` empieza por "no" y es un bloqueo de verdad. Los guiones
// son los mismos marcadores de "sin valor" que ya acepta el contrato de la
// tabla §9 (ct-init.sh), por coherencia de vocabulario.
const NOT_BLOCKED_WORDS = new Set([
  'no', 'false', 'none', 'null', 'nil', 'n', 'ninguno', 'ninguna', 'nada', 'n/a', 'na',
  '-', '–', '—', '―', '−', '--',
])

// Las claves del mapa `blocked` que se leen. Cualquier otra se ANUNCIA con su
// valor (ver readBlocked): un `blocked: {razon: "…"}` no puede acabar
// presentado como "bloqueado y no dice por qué" mientras el fichero sí lo
// dice.
const BLOCK_KEYS = ['reason', 'since', 'unblock']

// `status: blocked` — el error de escritura más probable, y el que NO puede
// salir gratis. Decidir que el bloqueo vive en un campo propio (y no en
// `status`) crea justo esta categoría de rechazados: alguien que quiere
// bloquear escribe lo primero que suena razonable, `status: blocked`, y con
// una lectura estricta se quedaría sin ningún efecto — un bloqueo escrito de
// buena fe y tragado en silencio, que es peor que el problema original.
// Se resuelve en la dirección segura: se trata como BLOQUEADO igual, y se
// dice que el campo canónico es otro (y por qué importa: `status` no tiene
// dónde poner el motivo ni el desbloqueo).
const STATUS_BLOCKED_WORDS = new Set([
  'blocked', 'blocked_on', 'bloqueado', 'bloqueada', 'on_hold', 'on-hold', 'parado', 'parada',
])

const str = (v) => (v == null ? '' : String(v).trim())

/**
 * Lee el campo `blocked` de un frontmatter ya parseado.
 * Devuelve uno de:
 *   { state: 'none' }                       → no bloqueado
 *   { state: 'blocked', reason, since, unblock, notes[] }
 *   { state: 'unreadable', why }            → el frontmatter no es un mapa
 * En la duda se elige SIEMPRE 'blocked': un falso positivo cuesta una
 * pregunta; un falso negativo es exactamente el incidente que originó esto.
 */
export function readBlocked(meta) {
  if (meta == null || typeof meta !== 'object' || Array.isArray(meta)) {
    return { state: 'unreadable', why: 'el frontmatter de STATE.md no es un mapa de campos' }
  }
  const statusWord = str(meta.status).toLowerCase()
  const statusSaysBlocked = STATUS_BLOCKED_WORDS.has(statusWord)
  const declared = Object.prototype.hasOwnProperty.call(meta, 'blocked')

  // `blocked` ausente o explícitamente vacío. Es el camino de TODOS los
  // STATE.md anteriores a este campo: silencio = no bloqueado (ver la cabecera
  // de esta sección). La única excepción es que `status` diga lo contrario.
  const v = declared ? meta.blocked : null
  if (!declared || v == null || v === false || v === 0 || (typeof v === 'string' && (!v.trim() || NOT_BLOCKED_WORDS.has(v.trim().toLowerCase())))) {
    if (!statusSaysBlocked) return { state: 'none' }
    return {
      state: 'blocked',
      reason: '',
      since: '',
      unblock: '',
      notes: [declared
        ? `contradicción en el STATE.md: el campo \`blocked\` está vacío/\`null\` pero \`status: ${statusWord}\` dice que el trabajo está bloqueado. Se trata como BLOQUEADO por seguridad. Resuélvela: el bloqueo se declara en \`blocked: {reason: "…", unblock: "…"}\`.`
        : `\`status: ${statusWord}\` dice que el trabajo está bloqueado, pero el bloqueo NO se declara ahí: \`status\` es el eje de PROGRESO y no tiene dónde poner el motivo ni qué haría falta para levantarlo. Se trata como BLOQUEADO por seguridad; pásalo a \`blocked: {reason: "…", unblock: "…"}\` para que la próxima sesión sepa por qué.`],
    }
  }

  // Cadena no vacía y que no es una negación (las dos cosas ya filtradas
  // arriba): se toma como el MOTIVO. Es lo que escribe quien bloquea con
  // prisa, y rechazarla por "forma incorrecta" tiraría justo la información
  // que hace accionable el bloqueo.
  if (typeof v === 'string') return { state: 'blocked', reason: v.trim(), since: '', unblock: '', notes: [] }

  if (v === true) {
    return { state: 'blocked', reason: '', since: '', unblock: '', notes: [] }
  }

  if (typeof v === 'object' && !Array.isArray(v)) {
    const notes = []
    const unknown = Object.keys(v).filter((k) => !BLOCK_KEYS.includes(k))
    if (unknown.length) {
      notes.push(
        `el campo \`blocked\` trae claves que no se leen (${unknown.map((k) => `\`${k}\``).join(', ')}); las que se leen son ` +
        `${BLOCK_KEYS.map((k) => `\`${k}\``).join(', ')}. Contenido de las que no se leen, para que no se pierda: ` +
        unknown.map((k) => `${k}: ${JSON.stringify(v[k])}`).join(' | '),
      )
    }
    return { state: 'blocked', reason: str(v.reason), since: str(v.since), unblock: str(v.unblock), notes }
  }

  // Array, número no-cero, o cualquier otra forma: se trata como BLOQUEADO
  // (dirección segura) y se dice que la forma no se reconoce, con el valor
  // crudo delante para que no se pierda nada.
  return {
    state: 'blocked',
    reason: '',
    since: '',
    unblock: '',
    notes: [`el campo \`blocked\` tiene una forma que no se reconoce (${Array.isArray(v) ? 'lista' : typeof v}): ${JSON.stringify(v)}. Se trata como BLOQUEADO por seguridad. La forma esperada es \`blocked: {reason: "…", unblock: "…", since: "…"}\`.`],
  }
}

// Recorte defensivo del `next_action` que se cita dentro del aviso: ahí se
// cita para NEUTRALIZARLO (el texto íntegro sigue estando más abajo, en el
// STATE.md inyectado tal cual). Un next_action kilométrico no debe empujar el
// resto del aviso fuera de la vista.
function quoteForNotice(s, max = 300) {
  const one = String(s).replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

const NOTICE_TOP = '=========== TRABAJO BLOQUEADO — LEE ESTO ANTES DE HACER NADA ==========='
const NOTICE_BOTTOM = '=========== fin del aviso de bloqueo ==========='

/**
 * El aviso que el hook de SessionStart pone ANTES del STATE.md, para que la
 * sesión no pueda leer `next_action` como una orden vigente.
 */
export function blockNotice(blocked, { nextAction = '' } = {}) {
  if (!blocked || blocked.state !== 'blocked') return ''
  const lines = [NOTICE_TOP, '']
  lines.push('`.agent/STATE.md` declara este trabajo BLOQUEADO (campo `blocked`). Bloqueado NO es "pendiente": alguien decidió que esto no puede continuar tal cual.')
  lines.push('')
  lines.push(blocked.reason
    ? `Motivo: ${blocked.reason}`
    // "el bloqueo está declarado", no "`blocked` está puesto": este mismo
    // aviso lo dispara también un `status: blocked` sin campo `blocked`, y
    // decir que el campo está puesto sería falso justo en ese caso.
    : 'Motivo: NO CONSTA — el bloqueo está declarado pero sin `reason`. No supongas cuál es ni lo deduzcas del resto del estado: pregunta antes de tocar nada.')
  if (blocked.since) lines.push(`Bloqueado desde: ${blocked.since}`)
  lines.push(blocked.unblock
    ? `Para desbloquear haría falta: ${blocked.unblock}`
    : 'Para desbloquear: NO CONSTA — el STATE.md no dice qué haría falta. Averígualo y escríbelo en `blocked.unblock` antes de que otra sesión se encuentre con lo mismo.')
  for (const n of blocked.notes || []) lines.push(`Nota sobre cómo está escrito este bloqueo: ${n}`)
  lines.push('')
  if (nextAction) {
    lines.push(`\`next_action\` está SUSPENDIDO y NO es una orden vigente: «${quoteForNotice(nextAction)}». No lo ejecutes, no lo trates como "lo siguiente que había que hacer" y no lo uses para deducir qué se esperaba de esta sesión — aparece más abajo solo como contexto de lo que quedó a medias.`)
  } else {
    lines.push('`next_action` no dice nada, y con el trabajo bloqueado tampoco debes deducir uno del resto del estado.')
  }
  lines.push('Levantar el bloqueo es una decisión humana y explícita: se borra el campo `blocked` de `.agent/STATE.md` (o se pone a `null`). Si crees que ya no aplica, dilo y pídelo — no lo levantes por tu cuenta ni "de paso".')
  lines.push(NOTICE_BOTTOM)
  return lines.join('\n')
}

/**
 * El aviso para el único caso en que de verdad NO SE SABE si hay bloqueo: el
 * frontmatter no se puede leer. Un STATE.md ilegible no es "no bloqueado".
 */
export function unreadableNotice(why) {
  return [
    '=========== AVISO: `.agent/STATE.md` NO SE PUDO LEER ENTERO ===========',
    '',
    `No se ha podido interpretar el frontmatter YAML de \`.agent/STATE.md\` (${why}).`,
    'Eso significa que NO se puede saber si el trabajo está BLOQUEADO (campo `blocked`): trátalo como posiblemente bloqueado.',
    'No ejecutes nada de lo que diga el estado de abajo sin confirmarlo antes, y arregla el frontmatter lo primero — mientras siga así, ninguna sesión de este repo podrá hidratarse bien.',
    '=========== fin del aviso ===========',
  ].join('\n')
}

// Guía de lectura de los campos que se leen mal en frío. Solo se emiten las
// líneas que APLICAN (campo no vacío): una guía que sale siempre es ruido que
// se aprende a saltar.
//
// El caso de `verify` es real y del mismo incidente: decía «`gh issue list …
// --milestone 'Plan vs Propuestas'` devuelve 6 issues» cuando no había ni
// milestone ni issues. Estaba escrito como la comprobación PARA DESPUÉS, pero
// leído en frío es indistinguible de la afirmación de un hecho. El campo no
// puede llevar el tiempo verbal dentro (es texto libre que escribe cada
// sesión), así que lo pone quien lo presenta.
export function fieldReadingGuide(meta, { blocked = false } = {}) {
  if (meta == null || typeof meta !== 'object' || Array.isArray(meta)) return ''
  const lines = []
  if (str(meta.verify)) {
    lines.push('- `verify` es la comprobación PENDIENTE que valida este trabajo AL TERMINAR, no un hecho ya comprobado — aunque esté redactada en presente («… devuelve 6 issues»). Ejecútala antes de afirmar su resultado; si falla o no se puede ejecutar, dilo en vez de darla por buena.')
  }
  if (!blocked && str(meta.next_action)) {
    lines.push('- `next_action` es lo que apuntó la sesión ANTERIOR al cerrar, no una orden verificada hoy: puede haber caducado (ya hecho, revertido, descartado o bloqueado desde entonces). Contrástalo con el repo antes de ejecutarlo. Si ves que ya no aplica, dilo — y si el trabajo está bloqueado de verdad, se marca en el campo `blocked`, no reescribiendo este texto.')
  }
  if (!lines.length) return ''
  return `## Cómo leer estos campos\n${lines.join('\n')}`
}

export function composeHydration(stateText, gitLog) {
  if (!stateText || !stateText.trim()) return ''
  const { meta, error } = parseStateSafe(stateText)
  const blocked = error ? { state: 'unreadable', why: error } : readBlocked(meta)

  const parts = []
  if (blocked.state === 'unreadable') parts.push(unreadableNotice(error || blocked.why))
  else if (blocked.state === 'blocked') parts.push(blockNotice(blocked, { nextAction: meta?.next_action }))

  parts.push(`# Estado del slice (hidratación automática)\n\n${stateText.trim()}`)

  const guide = fieldReadingGuide(meta, { blocked: blocked.state === 'blocked' })
  if (guide) parts.push(guide)

  const log = (gitLog || '').trim()
  if (log) parts.push(`## Últimos commits\n${log}`)
  return parts.join('\n\n')
}

export function shouldBlockStop({ headSha, stateSha, stopHookActive }) {
  if (stopHookActive) return false
  if (!stateSha) return false
  return headSha !== stateSha
}
