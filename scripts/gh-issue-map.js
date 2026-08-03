// Mapeo puro de issues de GitHub (forma cruda de `gh issue list --json
// number,title,labels,body` / `--json number,stateReason`) a la forma que
// consumen selectNext/renderKickoff/buildStateSeed. Extraído de ct-next.mjs
// (review round 1, Important/Minor 1) para poder testearlo sin red y sin
// pasar por `gh`: antes de este cambio el único camino de test entraba por
// CT_NEXT_FIXTURE, así que este mapeo nunca se ejecutaba en la suite — una
// deriva en el formato de groom.js#buildIssueBody (p.ej. renombrar el
// encabezado "## Acceptance criteria") podía romperlo en silencio hasta el
// dispatch real contra un repo de verdad.
import { gatesFromLabels } from './gates.js'

// detectLineEnding / normalizeToLF (review round 4, menor: CRLF): un issue
// editado en Windows (o pegado desde un editor que usa CRLF) deja un '\r'
// al final de cada línea. Sin normalizar, ese '\r' se cuela en cualquier
// comparación de igualdad (la línea de enlace al spec, una cabecera
// "exact") y en el contenido multi-línea de Descripción/Protegido —
// haciendo que dos textos VISUALMENTE idénticos se reporten como
// divergentes. Y sin denormalizar de vuelta, un splice (que genera su
// propio contenido con '\n' desnudo) deja el body resultante con finales de
// línea mezclados (parte CRLF original, parte LF nuestro).
//
// Estrategia: todo el procesamiento (detección Y aplicación) trabaja SIEMPRE
// sobre texto normalizado a LF puro; quien vaya a devolver un body para
// escribir de vuelta (buildReconcileBody) detecta el final de línea
// DOMINANTE del original con `detectLineEnding` y, si era CRLF, reconvierte
// el resultado entero antes de devolverlo — así el body escrito nunca queda
// con finales mezclados.
export function detectLineEnding(text) {
  return /\r\n/.test(text || '') ? '\r\n' : '\n'
}
export function normalizeToLF(text) {
  return (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '')
}

// FENCE_LINE_RE: delimitador de un bloque de código cercado (CommonMark:
// hasta 3 espacios de indentación, luego 3+ backticks o 3+ tildes). Captura
// la serie completa (grupo 1) para que quien la use pueda comparar carácter
// Y longitud — ver stepFence más abajo.
const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})/

// ATX_HEADING_RE (review round 5, Critical 2 — el reviewer atacó su propio
// terminador del round 4 y encontró que solo reconocía "## " literal a
// columna 0): CommonMark considera cabecera ATX cualquier línea con 1 a 6
// "#", indentada hasta 3 espacios, seguida de un espacio/tabulador o de fin
// de línea. Antes, un "#", "###", "####", un "##" separado por TABULADOR, o
// uno indentado 1-3 espacios — los cinco, cabeceras reales en GitHub — no
// terminaban ninguna sección: todo lo que hubiera debajo (hasta la
// siguiente "## " exacta) se consideraba parte del CONTENIDO de la sección
// anterior. Verificado con el ejemplo del reviewer: un "### Notas de
// implementación" con una advertencia real ("no tocar sin hablar con Ana")
// desaparecía al reconciliar porque quedaba "dentro" de la sección previa,
// y el splice de --reconcile lo sustituía sin más.
const ATX_HEADING_RE = /^ {0,3}#{1,6}([ \t]|$)/

// COMMENT_OPEN_TOKEN / COMMENT_CLOSE_TOKEN: los delimitadores de un
// comentario HTML — ver stepLine más abajo (Critical 1, review round 5).
const COMMENT_OPEN_TOKEN = '<!--'
const COMMENT_CLOSE_TOKEN = '-->'

// stepFence (review round 4, Critical 1 — el reviewer atacó su propio
// escáner del round 3 y encontró que CUALQUIER delimitador conmutaba el
// estado, sin mirar tipo ni longitud): CommonMark solo cierra una valla con
// una serie del MISMO carácter (backtick cierra backtick, tilde cierra
// tilde — nunca cruzado) y de longitud >= la de apertura. La versión
// anterior alternaba `inFence` con CUALQUIER línea que matcheara
// FENCE_LINE_RE — un ``` (3 backticks) dentro de un bloque abierto con
// ```` (4 backticks) "cerraba" el estado en falso, así que el contenido
// posterior (incluido el cierre real ````) se trataba como estructura del
// documento. Reproducido con el ejemplo exacto que este propio proyecto
// documenta de sí mismo: un bloque de 4 backticks mostrando, como ejemplo,
// un bloque de 3 backticks con "## Dependencias" dentro.
//
// Recibe el estado previo `{ inFence, fenceChar, fenceLen }` y la línea
// actual; devuelve `{ state, isFenceDelim }` — `isFenceDelim` es cierto
// cuando la línea EN SÍ es un delimitador real (abre o cierra), y esas
// líneas nunca cuentan como cabecera/terminador por sí mismas,
// independientemente del nuevo valor de `inFence`.
//
// Menor (review round 5): además de carácter y longitud, CommonMark exige
// que una línea de CIERRE no lleve nada detrás salvo espacio en blanco — un
// "info string" (p.ej. el "js" de "```js") solo es válido en la APERTURA.
// Antes, una línea como "```js" dentro de un bloque YA abierto (pensada
// como CONTENIDO de ejemplo — p.ej. mostrando otro fence con lenguaje —, no
// como cierre) se leía igualmente como cierre en falso porque solo se
// miraba el carácter+longitud del delimitador, ignorando el resto de la
// línea. Fallaba seguro (no corrompía nada: como mucho hacía localizable de
// más una cabecera que en realidad seguía "dentro" del ejemplo), pero el
// mensaje de error que dependiera de dónde termina esa sección podía culpar
// a una cabecera que sigue visiblemente presente más abajo, en vez de
// explicar que el cierre nunca fue tal.
function stepFence(line, state) {
  const m = FENCE_LINE_RE.exec(line)
  if (!m) return { state, isFenceDelim: false }
  const char = m[1][0]
  const len = m[1].length
  if (!state.inFence) {
    // Fuera de cualquier valla: esta línea SIEMPRE abre una nueva,
    // recordando su carácter y longitud exactos. Un info string detrás (la
    // apertura SÍ lo tolera) no importa aquí.
    return { state: { inFence: true, fenceChar: char, fenceLen: len }, isFenceDelim: true }
  }
  const rest = line.slice(m[0].length)
  if (char === state.fenceChar && len >= state.fenceLen && /^\s*$/.test(rest)) {
    // Cierra: mismo carácter, longitud igual o mayor que la apertura, y
    // nada más que espacio en blanco detrás del delimitador.
    return { state: { inFence: false, fenceChar: null, fenceLen: 0 }, isFenceDelim: true }
  }
  // Un delimitador de OTRO carácter (p.ej. "~~~" dentro de un bloque abierto
  // con "```"), del mismo carácter pero más corto, o con texto detrás
  // (info string, p.ej. "```js") NO cierra la valla — es contenido normal
  // dentro de ella (`state` no cambia; `isFenceDelim` false porque, a
  // efectos de este escáner, esta línea no delimita nada por sí sola —
  // sigue dentro de la valla ya abierta, que es justo lo que decide si
  // predicate() se evalúa o no en el llamador).
  return { state, isFenceDelim: false }
}

function initLineState() {
  return { inFence: false, fenceChar: null, fenceLen: 0, inComment: false }
}

// stepLine (review round 5, Critical 1 — "endureciste las vallas a fondo y
// dejaste intactas las otras dos cosas con forma de delimitador que viven
// en el mismo body"): un comentario HTML multilínea es EXACTAMENTE el mismo
// tipo de riesgo que una valla de código sin cerrar — nada rastreaba su
// INTERIOR, así que una cabecera conocida "comentada" dentro de un
// `<!-- ... -->` que abre en una línea y cierra varias líneas después (p.ej.
// unas deps viejas comentadas "mientras decidimos") se leía como si fuera
// estructura real del documento. Con eso, `locateSection` devolvía la copia
// comentada, `--reconcile` escribía DENTRO del comentario, y como el fin de
// contenido llega hasta la siguiente cabecera real, el splice se comía el
// propio `-->` de cierre — en GitHub, un comentario sin cerrar se traga
// todo hasta EOF.
//
// La distinción que importa: el marcador `<!-- ct-order:N -->` (y
// cualquier comentario que ABRE y CIERRA en la MISMA línea) es una línea
// real y autocontenida — SIGUE siendo válida como terminador de sección,
// igual que antes. Lo que NO puede seguir pasando es que la mera presencia
// de "<!--" en una línea (sin "-->" detrás, EN ESA MISMA línea) se trate
// como el marcador: eso es la APERTURA de un comentario multilínea, cuyo
// interior (hasta la línea que por fin trae "-->") queda tan invisible para
// el escáner como el interior de una valla.
//
// Devuelve `{ state, wasHidden }` — `wasHidden` es cierto cuando, ANTES de
// procesar esta línea, el escáner ya estaba dentro de una valla o de un
// comentario multilínea abiertos por una línea ANTERIOR: es lo que decide,
// en cada llamador, si esta línea es candidata a heading/terminador. La
// propia línea que ABRE la valla/el comentario nunca es `wasHidden` (era
// visible cuando se alcanzó), pero tampoco necesita serlo a propósito: ni
// un delimitador de valla ni un "<!--" se parecen nunca a una cabecera ATX
// o a un marcador autocontenido, así que da igual si se evalúan o no contra
// esos predicados — nunca matchean por accidente.
function stepLine(line, state) {
  const wasHidden = state.inFence || state.inComment
  if (state.inComment) {
    if (line.includes(COMMENT_CLOSE_TOKEN)) return { state: { ...state, inComment: false }, wasHidden }
    return { state, wasHidden }
  }
  if (state.inFence) {
    const step = stepFence(line, state)
    return { state: step.state, wasHidden }
  }
  const fenceStep = stepFence(line, state)
  if (fenceStep.isFenceDelim) return { state: fenceStep.state, wasHidden }
  const openIdx = line.indexOf(COMMENT_OPEN_TOKEN)
  if (openIdx !== -1) {
    const closesSameLine = line.indexOf(COMMENT_CLOSE_TOKEN, openIdx + COMMENT_OPEN_TOKEN.length) !== -1
    if (!closesSameLine) return { state: { ...state, inComment: true }, wasHidden }
  }
  return { state, wasHidden }
}

// scanLines: recorre `body` línea a línea, llevando el estado combinado de
// valla+comentario con `stepLine`, y devuelve la primera línea (índice +
// offset absoluto en la cadena) que satisface `predicate`, IGNORANDO por
// completo las líneas ocultas dentro de una valla o de un comentario
// multilínea. Es el mecanismo compartido detrás de locateSection/locateLine
// — review round 3 (Critical 1): antes, tanto la cabecera como el
// terminador de sección se buscaban con una regex sobre la cadena COMPLETA,
// sin distinguir "dentro de una valla de código" (y, desde la ronda 5,
// "dentro de un comentario HTML") de "estructura real del documento".
function scanLines(body, predicate) {
  const src = body || ''
  const lines = src.split('\n')
  let offset = 0
  let state = initLineState()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const step = stepLine(line, state)
    state = step.state
    if (!step.wasHidden && predicate(line, i)) {
      return { index: i, offset, line }
    }
    offset += line.length + 1
  }
  return null
}

// headingMatcher: `headings` es un string (la cabecera exacta) o un array
// de strings (un conjunto CERRADO de cabeceras aceptables — ver AC_HEADING_FORMS
// más abajo, review round 5, Importante 4). Siempre igualdad exacta módulo
// espacios finales (`trimEnd()`, que también absorbe un `\r` de CRLF ya que
// `trim`/`trimEnd` lo tratan como whitespace) contra CUALQUIERA de las
// alternativas — nunca prefijo abierto (ver el porqué en locateSection).
function headingMatcher(headings) {
  const list = Array.isArray(headings) ? headings : [headings]
  return (line) => list.includes(line.trimEnd())
}

// locateSection: encuentra dónde vive una sección del body (buildIssueBody
// en groom.js genera un puñado de secciones con cabecera fija: "##
// Acceptance criteria…", "## Dependencias", "## Out of scope / Protected",
// "## Descripción") — delimitada por su propia cabecera y por el mismo
// criterio de "fin de sección" que ya usaba extractAc: la siguiente
// cabecera ATX, el marcador autocontenido `<!-- ct-order -->`, o el fin del
// body. Devuelve `null` si la cabecera no aparece en absoluto.
//
// `headingText` acepta un string o un array de strings (ver headingMatcher)
// — review round 5, Importante 4: hasta ahora "## Acceptance criteria" era
// el ÚNICO caso con `{ exact: false }` (prefijo abierto), porque es la única
// de las cuatro cabeceras con un sufijo legítimo ("(EARS, 1:1 con tests)").
// Pero buildIssueBody (groom.js) SOLO emite dos cadenas fijas para esa
// cabecera (la actual y, en bodies más antiguos, la de antes de que EARS se
// añadiera) — el hueco legítimo es un CONJUNTO CERRADO de dos elementos, no
// un prefijo abierto. Con prefijo abierto, un "## Acceptance criteria
// propuestos por QA (borrador)" escrito por un humano POR ENCIMA de la
// sección real se reclamaba como si fuera ella: el dispatcher inyectaba
// CERO criterios reales en el prompt del agente, y --reconcile habría
// sustituido la prosa de QA. Ver AC_HEADING_FORMS más abajo.
//
// Las OTRAS tres cabeceras (Descripción/Dependencias/Out of scope) siguen
// exigiendo igualdad exacta con un ÚNICO string: con `startsWith` genérico
// (round 3), un humano escribiendo `## Dependencias externas (notas del
// equipo)` — una sección propia, sobre OTRA cosa — se reclamaba como SI
// FUERA la sección de dependencias real: --reconcile sustituía esa prosa
// humana por `- merge-after #N` y dejaba la sección real (si la había, en
// otro punto del body) obsoleta e invisible, exit 0 estable para siempre.
//
// Se usa tanto para EXTRAER contenido (comparar spec vs. issue — F5) como
// para REEMPLAZARLO quirúrgicamente (F5 --reconcile, ver
// scripts/reconcile.js#buildReconcileBody): las posiciones `headingStart`/
// `headingEnd`/`contentEnd` permiten hacer un `body.slice(...)` que toca
// SOLO esa sección, dejando intacto cualquier contenido humano antes,
// después, o en cualquier sección nueva que el humano haya añadido en otro
// punto del body.
export function locateSection(body, headingText) {
  const src = body || ''
  const matches = headingMatcher(headingText)
  const heading = scanLines(src, matches)
  if (!heading) return null
  const headingStart = heading.offset
  // headingEnd: justo después del '\n' que cierra la línea de cabecera (si
  // el body termina justo ahí, sin más líneas, headingEnd es src.length).
  const headingEnd = Math.min(headingStart + heading.line.length + 1, src.length)

  // Terminador: primera línea (a partir de la siguiente a la cabecera),
  // ignorando líneas ocultas (dentro de una valla O de un comentario
  // multilínea — ver stepLine, review round 5, Critical 1), que sea otra
  // cabecera ATX (review round 5, Critical 2: cualquier nivel "#" a
  // "######", no solo "## " literal — ver ATX_HEADING_RE) o un comentario
  // AUTOCONTENIDO (abre Y cierra en la misma línea — el marcador
  // `<!-- ct-order:N -->` real). La apertura de un comentario MULTILÍNEA
  // (un "<!--" sin "-->" en esa misma línea) NUNCA termina la sección por sí
  // sola: en vez de eso, hace que las líneas siguientes queden ocultas
  // (`wasHidden`) hasta que el propio comentario cierre — el terminador
  // real sigue siendo lo que venga DESPUÉS de ese cierre. `consumed`
  // acumula, línea a línea, la posición (relativa a headingEnd) de INICIO
  // de la línea que se está evaluando — al encontrar el terminador en la
  // línea `i`, `consumed` todavía NO incluye esa línea, así que apunta al
  // carácter '\n' que la precede inmediatamente (o a headingEnd si no hay
  // ninguna línea de contenido en medio), para que el formato de "línea en
  // blanco antes de la siguiente cabecera" que genera buildIssueBody se
  // preserve al reconstruir el empalme (ver buildReconcileBody).
  const restLines = src.slice(headingEnd).split('\n')
  let state = initLineState()
  let consumed = 0
  let contentEnd = src.length
  for (let i = 0; i < restLines.length; i++) {
    const line = restLines[i]
    const step = stepLine(line, state)
    state = step.state
    const isSelfContainedComment = line.startsWith(COMMENT_OPEN_TOKEN) && line.includes(COMMENT_CLOSE_TOKEN)
    if (!step.wasHidden && (ATX_HEADING_RE.test(line) || isSelfContainedComment)) {
      contentEnd = headingEnd + Math.max(consumed - 1, 0)
      break
    }
    consumed += line.length + 1
  }
  return { headingStart, headingEnd, contentEnd, content: src.slice(headingEnd, contentEnd) }
}

export function extractSectionContent(body, headingText) {
  const loc = locateSection(body, headingText)
  return loc ? loc.content.trim() : null
}

// locateLine / extractLine: como locateSection, pero para una entidad de
// UNA SOLA línea (sin cabecera + contenido delimitado) — usado para la
// línea de enlace al spec que buildIssueBody escribe como primera línea del
// body (`> Slice #N del epic. Spec: […]`). Mismo criterio de anclaje a
// columna 0 y de ignorar líneas ocultas dentro de una valla de código o de
// un comentario HTML multilínea (scanLines/stepLine, review round 5).
// `prefix` acepta un string o un array de strings (F6): la línea de enlace al
// spec tiene DOS formas válidas — la de siempre ("> Slice #N …") y la que
// evita el autoenlace falso ("> Slice `#N` …", ver SPEC_LINK_PREFIXES). Un
// array es un conjunto CERRADO de alternativas, nunca un prefijo más corto
// que las englobe a las dos ("> Slice ", que también reclamaría una línea
// citada cualquiera que empiece por esas palabras) — mismo criterio que
// headingMatcher/AC_HEADING_FORMS.
export function locateLine(body, prefix) {
  const prefixes = Array.isArray(prefix) ? prefix : [prefix]
  const found = scanLines(body, (line) => prefixes.some((p) => line.startsWith(p)))
  if (!found) return null
  return { start: found.offset, end: found.offset + found.line.length, line: found.line }
}
export function extractLine(body, prefix) {
  const loc = locateLine(body, prefix)
  return loc ? loc.line : null
}

// extractSpecLink: la línea `> Slice #N del epic. Spec: […]` que
// buildIssueBody (groom.js) escribe siempre como primera línea del body —
// review round 3, importante 5: es contenido que el spec posee de verdad
// (F10: deriva de la ruta del propio spec dentro de su repo y del encabezado
// bajo el que vive la tabla §9), no bookkeeping como el marcador `ct-order` —
// así que F5 la compara igual que el título.
// SPEC_LINK_PREFIXES: las dos formas que buildIssueBody ha emitido para esa
// línea — con el orden entre backticks (F6, la actual: evita que GitHub
// enlace el ORDEN de slice al ISSUE con ese número) y sin ellos (los issues
// ya creados, que no se migran). Conjunto CERRADO, igual que AC_HEADING_FORMS
// y por el mismo motivo: el prefijo "> Slice " a secas reclamaría como enlace
// al spec cualquier línea citada que empiece por esas dos palabras.
export const SPEC_LINK_PREFIXES = ['> Slice `#', '> Slice #']
export function extractSpecLink(body) {
  return extractLine(body, SPEC_LINK_PREFIXES)
}

// normalizeSpecLink (F10, sustituye a specLinkAnchor): la forma canónica de
// una línea de enlace al spec, para compararla contra otra.
//
// specLinkAnchor extraía SOLO el ancla "#sección" y descartaba la ruta a
// propósito (review round 4, importante 4): hasta F10, ct-groom.mjs componía
// la línea con `process.argv[2]` tal cual, así que la MISMA §9 producía
// "docs/spec.md#9" desde un slash command y "/Users/.../docs/spec.md#9" desde
// un cron — comparar la línea entera habría hecho que cada invocación
// reescribiera la de la otra, para siempre. El precio era no detectar que el
// spec se hubiera movido de fichero.
//
// F10 quita la causa: la línea se compone ahora de la ruta relativa a la raíz
// del repo + el remoto + la rama por defecto (scripts/spec-link.js), tres
// propiedades del REPOSITORIO, no de quien invoca. Ya no hay dos notaciones
// posibles de la misma cosa, así que se compara la línea completa y se gana
// lo que antes no se detectaba: spec movido de fichero, enlace apuntando a
// otro repo, y (lo más inmediato) los issues creados antes de F10, cuyo
// enlace relativo roto ahora sale reportado como divergencia en vez de pasar
// por bueno porque el "9" coincidía.
//
// Lo único que se normaliza es el espacio de los extremos: un editor que
// añade o quita un espacio al final de la línea no es un cambio de contenido.
export function normalizeSpecLink(specLinkLine) {
  if (specLinkLine === null || specLinkLine === undefined) return null
  return String(specLinkLine).trim()
}

// specTarget (F23): el DESTINO del enlace al spec — lo que renderSpecLink
// (scripts/groom.js) escribe después de "Spec: ". Responde a una pregunta
// distinta de la de diffIssue, y por eso no reutiliza su comparación:
//
//   diffIssue pregunta "¿la línea del enlace de ESTE issue ha cambiado
//   respecto a lo que el spec produce hoy?" — es contenido del spec, su
//   divergencia es reportable, y desde F10 se compara ENTERA a propósito
//   (detecta que el spec se ha movido de fichero o de repo).
//
//   specTarget pregunta "¿estos dos issues apuntan al MISMO documento?",
//   para decidir si un issue de otro milestone es en realidad este mismo
//   epic bajo otro título. Ahí el prefijo estorba: la línea empieza por
//   "> Slice `#N` del epic. " y ese prefijo (a) lleva el orden del slice y
//   (b) cambió de formato en F6 (`#N` con backticks, ver
//   SPEC_LINK_PREFIXES), así que comparar la línea entera daría un falso
//   negativo sobre cualquier issue creado antes de F6.
//
// Falla en ABIERTO por diseño: si dos costumbres de invocación producen dos
// destinos distintos para el mismo fichero (relativa vs. absoluta — el
// ping-pong que F10 documenta en reconcile.js), esta función los ve como
// specs distintos, el caller no dispara su puerta, y el comportamiento es el
// que había antes de F23. Un falso NEGATIVO devuelve el statu quo; un falso
// positivo pararía una corrida legítima. La dirección segura es ésta.
const SPEC_TARGET_SEPARATOR = 'Spec: '
export function specTarget(specLinkLine) {
  const line = normalizeSpecLink(specLinkLine)
  if (line === null) return null
  const at = line.indexOf(SPEC_TARGET_SEPARATOR)
  if (at === -1) return null
  const target = line.slice(at + SPEC_TARGET_SEPARATOR.length).trim()
  return target.length > 0 ? target : null
}

// countHeadingLines: cuántas veces aparece una cabecera (mismo criterio de
// igualdad exacta/conjunto y de líneas ocultas — valla o comentario — que
// locateSection) en todo el body — no solo si aparece, sino CUÁNTAS veces.
// Review round 3 (menor): locateSection siempre encuentra/empalma la
// PRIMERA aparición; si un humano duplicó una sección a mano (copiar-pegar,
// un merge conflictivo mal resuelto…), la segunda copia queda invisible
// tanto para la comparación como para --reconcile. Se usa para avisar de
// esa situación, no para decidir qué se aplica (eso sigue siendo, a
// propósito, "la primera"). `headingText` acepta array (ver headingMatcher)
// — para AC, las dos formas de AC_HEADING_FORMS cuentan como la MISMA
// sección conceptual: una de cada forma también es "duplicado".
export function countHeadingLines(body, headingText) {
  const src = body || ''
  const matches = headingMatcher(headingText)
  const lines = src.split('\n')
  let state = initLineState()
  let count = 0
  for (const line of lines) {
    const step = stepLine(line, state)
    state = step.state
    if (!step.wasHidden && matches(line)) count++
  }
  return count
}

// AC_HEADING_FORMS (review round 5, Importante 4): buildIssueBody
// (groom.js) emite una ÚNICA cadena fija para la cabecera de AC — pero esa
// cadena cambió una vez en la historia del proyecto (se le añadió el
// sufijo "(EARS, 1:1 con tests)"), así que un issue creado con la versión
// vieja del generador sigue trayendo la forma anterior. El hueco legítimo
// es, por tanto, un CONJUNTO CERRADO de exactamente dos cadenas — nunca un
// prefijo abierto (`{ exact: false }`, la versión de antes de esta ronda):
// con prefijo, un "## Acceptance criteria propuestos por QA (borrador)"
// escrito por un humano por encima de la sección real se reclamaba como si
// fuera ella — el dispatcher inyectaba CERO criterios reales en el prompt
// del agente, y --reconcile habría sustituido la prosa de QA.
export const AC_HEADING_FORMS = ['## Acceptance criteria', '## Acceptance criteria (EARS, 1:1 con tests)']

// extractAc: localiza la sección de AC contra el conjunto cerrado
// AC_HEADING_FORMS (ver arriba) — nunca por prefijo.
export function extractAc(body) {
  const section = extractSectionContent(body, AC_HEADING_FORMS)
  if (section == null) return []
  return section.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter((l) => l && l !== '(rellenar desde el spec)')
}

// extractDeps: lee TODAS las referencias `merge-after #N` de la cadena que
// se le pase, sin anclarse a ninguna sección por sí misma — el ALCANCE (todo
// el body, o solo el contenido de una sección) lo decide el llamador. Sigue
// siendo una regex desnuda a propósito: `extractDepsInSection` (más abajo)
// es la única fuente de verdad de "qué sección mirar", compartida entre
// mapGhIssue (el dispatcher real) y reconcile.js.
//
// D1 finding 2 (hardening del dispatch — historial de esta decisión): hasta
// esta ronda, mapGhIssue llamaba a extractDeps sobre el body ENTERO
// (dispatch.js necesitaba ver cualquier `merge-after`, viviera donde
// viviera), mientras scripts/reconcile.js (F5, review round 3, Critical 3)
// ya la llamaba SOLO sobre el contenido de "## Dependencias" — la única
// sección que --reconcile puede tocar con seguridad vía splice. Esa
// divergencia deliberada tenía un coste real: un "merge-after #N" citado en
// la prosa de un Acceptance Criteria (nunca pensado como dependencia) SÍ
// bloqueaba al dispatcher, pero --reconcile jamás podía "resolverlo" (no
// hay splice seguro fuera de la sección reconocida) — mismo dato, dos
// comportamientos irreconciliables entre sí. El auditor además encontró que
// la ausencia de anclaje a sección escondía una segunda clase de bug: una
// reescritura humana de la línea de dependencia ("Depende de #1 (merge
// primero)", o un simple guion perdido en "merge after #1") no matchea la
// regex — cero deps extraídas, indistinguible de "este slice no tiene
// dependencias". El gate se abre en silencio.
//
// D1 unifica el dominio: mapGhIssue ahora usa `extractDepsInSection`, EXACTAMENTE
// la misma función (y por tanto el mismo alcance) que reconcile.js. Coste
// aceptado explícitamente: un issue creado/editado a mano con un
// "merge-after" en texto libre, fuera de "## Dependencias", deja de ser
// honrado por el dispatcher — igual que ya dejaba de serlo por --reconcile.
// Ganancia: el mismo body produce la MISMA lectura para cualquiera que lo
// lea, y la sección presente-pero-sin-matches deja de ser un `[]` silencioso
// (ver `malformed` en extractDepsInSection) — dispatch.js ya no la trata
// como "sin dependencias".
//
// F6 (grave 1) — el formato EMITIDO cambia a código inline (``merge-after
// `#N` ``) para que GitHub deje de autoenlazar el orden de slice al issue con
// ese número (ver groom.js#DEPS_ORDER_NOTE). El LECTOR acepta las dos formas,
// para siempre: los issues ya creados en repos reales llevan el formato viejo
// y NO se migran (nadie reescribe un body existente solo por esto; un body
// viejo solo adopta el formato nuevo si `--reconcile` ya iba a reescribir esa
// sección por una divergencia real). El backtick de cierre no se exige: lo
// que identifica la referencia es el número que sigue a "merge-after".
export function extractDeps(body) {
  return [...(body || '').matchAll(/merge-after `?#(\d+)/g)].map((m) => parseInt(m[1], 10))
}

// DEPS_HEADING / extractDepsInSection: fuente ÚNICA de "qué deps ve
// cualquiera que lea este body" — mapGhIssue (dispatcher real) y
// reconcile.js#depsInSection la comparten (D1 finding 2). `malformed: true`
// es la señal que antes se desperdiciaba: la sección existe (algo se
// intentó declarar) pero ningún "merge-after #N" matcheó dentro de ella —
// nunca puede pasar con un body que buildIssueBody generó de verdad (solo
// emite la cabecera cuando `deps.length > 0`, y siempre como
// "merge-after #N"), así que si pasa es porque un humano reescribió la
// línea a mano de una forma que la regex ya no reconoce. Quien consuma esto
// (mapGhIssue) trata `malformed` como "el estado real de este gate es
// DESCONOCIDO" — nunca como "sin dependencias" (fail-closed, igual que un
// orden no mapeable se traduce a `null` en vez de a "satisfecho").
export const DEPS_HEADING = '## Dependencias'
export function extractDepsInSection(body) {
  const content = extractSectionContent(body, DEPS_HEADING)
  if (content == null) return { deps: [], malformed: false }
  const deps = extractDeps(content)
  // `malformed` (round 2 de la review de D1 — el primer heurístico, contar
  // viñetas "- " contra deps extraídas, NO era el eje correcto): lo derrota
  // cualquier línea BUENA con dos "merge-after" en una sola viñeta (infla
  // deps sin inflar viñetas → falso negativo) y cualquier línea ROTA que no
  // use "- " (viñeta "*", una lista numerada, o ninguna viñeta en absoluto →
  // falso negativo también), y dispara en falso ante una NOTA sin ninguna
  // relación con dependencias que solo casualmente comparte hueco con una
  // real ya leída bien (falso positivo).
  //
  // La señal que de verdad distingue "esta línea pretendía declarar una
  // dependencia y está mal escrita" de "esta línea es una nota" es otra:
  // CUALQUIER referencia "#N" en el contenido de la sección — sea o no parte
  // de un "merge-after #N" reconocido — que mencione un número que
  // `merge-after` NUNCA capturó. Una nota real ("ojo: revisar con Ana") no
  // menciona ningún "#N" en absoluto, así que nunca dispara esto. Comparación
  // por VALOR (el número), no por posición ni por forma de viñeta: da igual
  // si la línea rota usa "-", "*", numeración o ninguna viñeta, y una MISMA
  // referencia repetida en prosa (p.ej. "ver también #1 en el spec", con #1
  // YA reconocido como dependencia) no cuenta como problema — solo un NÚMERO
  // que no aparece entre las deps ya extraídas señala una reescritura humana
  // real.
  //
  // `deps.length === 0` se mantiene como caso base aparte: buildIssueBody
  // NUNCA emite la cabecera sin al menos un "merge-after #N" real, así que
  // CERO deps extraídas (incluida una sección completamente vacía, sin
  // ninguna referencia "#N" siquiera) ya es, por sí sola, una divergencia
  // del invariante — independientemente de si hay o no un "#N" suelto que
  // lo confirme.
  const hashRefs = [...content.matchAll(/#(\d+)/g)].map((m) => parseInt(m[1], 10))
  const depsSet = new Set(deps)
  const hasUncoveredRef = hashRefs.some((n) => !depsSet.has(n))
  return { deps, malformed: deps.length === 0 || hasUncoveredRef }
}

// extractStrayDeps (D1 finding 1, seguimiento de review): estrechar el
// dominio de deps del dispatcher a "## Dependencias" (D1 finding 2) abrió
// una puerta que `main` mantenía cerrada — un `merge-after #N` que vive
// FUERA de la sección reconocida (p.ej. bajo "## Descripción", o en la
// prosa de un AC) ya NO cuenta como dependencia real para nadie (ni el
// dispatcher ni --reconcile, ver el historial en reconcile.js). Ese
// estrechamiento es correcto y deseado — pero es invisible si nada lo dice:
// un issue cuyo autor escribió su dependencia en el sitio equivocado se
// despacha en silencio, sin que nadie sepa que su intento de bloqueo dejó
// de aplicar. `extractStrayDeps` expone esas referencias ignoradas — MISMA
// función que usan tanto mapGhIssue (para que ct-next.mjs pueda avisar)
// como reconcile.js#diffIssue (que ya calculaba exactamente esto para su
// propio reporte de "nota" — una sola implementación compartida, no dos que
// puedan divergir).
export function extractStrayDeps(body, sectionDeps) {
  const wholeBodyDeps = extractDeps(body || '')
  const sectionDepsSet = new Set(sectionDeps || [])
  return [...new Set(wholeBodyDeps)].filter((d) => !sectionDepsSet.has(d)).sort((a, b) => a - b)
}

// extractOrder: lee el marcador `<!-- ct-order:N -->` que groom.js#buildIssueBody
// escribe en TODO issue, usando el número de ORDEN del slice (slice.n, la
// posición en la tabla §9 del spec) — no el número de issue de GitHub. Es el
// único puente fiable entre los dos espacios de IDs: el número de issue lo
// asigna GitHub al crear el issue (no se controla), el orden lo decide el
// spec. Ver buildOrderIndex/buildDispatchInput más abajo para la traducción.
export function extractOrder(body) {
  const m = (body || '').match(/ct-order:(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

// STATUS_PRECEDENCE / resolveStatus (D1 finding 3): una edición de label a
// medias (se añade `status:X` nuevo sin quitar el `status:Y` viejo) deja DOS
// labels `status:` en el mismo issue. El código anterior usaba
// `Array.prototype.find`, que se queda con la PRIMERA del array que `gh`
// devuelve — el auditor verificó que el orden de ESE array cambia el
// resultado (`['status:in-progress','status:ready']` resuelve distinto que
// el mismo array invertido) y no pudo determinar offline qué orden usa
// GitHub de verdad. La instrucción explícita es no adivinarlo: el criterio
// tiene que ser independiente del orden del array.
//
// En vez de intentar averiguar CUÁL de las dos labels es "la real" (hay dos
// consecuencias observadas si se elige mal: en el sentido "ready gana", un
// issue ya reclamado (in-progress de verdad) se trata como despachable Y no
// cuenta en el cómputo de in-flight contra el cap — las dos peores
// consecuencias posibles a la vez), se aplica SIEMPRE la lectura más
// conservadora: in-progress > in-review > ready > backlog. Es la que menos
// probabilidad tiene de re-despachar dos veces el mismo trabajo o de
// dejarlo fuera del cap — no es "adivinar cuál label es correcta", es
// "asumir el estado que menos daño hace si nos equivocamos". `statusLabels`
// se expone para que quien detecte `statusAmbiguous` pueda avisar con el
// detalle exacto de qué labels chocaban (ver ct-next.mjs).
// Exportada (F6): ct-groom.mjs la necesita para decir, al terminar, cuántos
// issues del epic siguen sin ser despachables — con EXACTAMENTE el mismo
// criterio que aplica el dispatcher, no con una segunda lectura de labels
// que pudiera discrepar de él.
const STATUS_PRECEDENCE = ['in-progress', 'in-review', 'ready', 'backlog']
export function resolveStatus(labels) {
  const statusLabels = labels.filter((l) => l.startsWith('status:')).map((l) => l.slice('status:'.length))
  if (statusLabels.length === 0) return { status: 'backlog', statusAmbiguous: false, statusLabels }
  if (statusLabels.length === 1) return { status: statusLabels[0], statusAmbiguous: false, statusLabels }
  // Menor (review de D1): si NINGUNA de las labels en conflicto es una de
  // las cuatro conocidas (p.ej. dos labels custom como "status:blocked" y
  // "status:paused" — ninguna gatea nada en dispatch.js, así que la
  // DECISIÓN de despacho no cambia pase lo que pase aquí), el `?? statusLabels[0]`
  // de antes seguía devolviendo la PRIMERA del array tal cual llega de
  // GitHub — el mismo orden no verificable que esta función existe para no
  // depender. El TEXTO del aviso (ct-next.mjs) sí depende de este valor, y
  // era justo la garantía que se pidió que fuera independiente del orden:
  // se ordena alfabéticamente antes de tomar la primera como fallback
  // determinista.
  const resolved = STATUS_PRECEDENCE.find((s) => statusLabels.includes(s)) ?? [...statusLabels].sort()[0]
  return { status: resolved, statusAmbiguous: true, statusLabels }
}

export function mapGhIssue(i) {
  const labels = (i.labels || []).map((l) => l.name)
  const { status, statusAmbiguous, statusLabels } = resolveStatus(labels)
  // touches: incluye TANTO `touches:` como `area:` (fix de la review final,
  // finding 5): claim.js#tokensOf ya trataba ambos prefijos como
  // igual-de-relevantes para colisión (y el spec §14 define el conflicto como
  // un token `area:` O `touches:` compartido), pero este mapeo solo miraba
  // `touches:` — así que `selectNext` (selección/co-dispatch en ct-next.mjs)
  // podía lanzar dos slices que comparten SOLO un `area:` (p.ej. `area:api`
  // en ambos) sin detectar la colisión, y solo dispatch-check.mjs la
  // detectaba después, con los worktrees y agentes ya lanzados. Se despoja el
  // prefijo (el que sea) igual que antes para no romper la convención ya
  // testeada de tokens "pelados" que usan SERIALIZING_TOUCHES/runningTouches
  // en dispatch.js.
  //
  // D1 finding 4: una label "area:"/"touches:" SIN VALOR (el colon presente,
  // nada detrás — p.ej. creada por accidente en el editor de GitHub) pela a
  // la cadena VACÍA. Sin filtrar, dos issues con esa label rota "colisionan"
  // sobre '' en dispatch.js#touchesConflict aunque no compartan ningún
  // área/touch real — un token vacío no representa nada, se descarta antes
  // de entrar en la maquinaria de colisión. `.trim()` ANTES de filtrar por
  // longitud (ataque adversarial: "area: ", colon seguido de un espacio en
  // blanco sin contenido real, pela a ' ' — no la cadena vacía — y un filtro
  // que solo mirara `.length > 0` dejaría pasar el MISMO bug con un
  // carácter distinto).
  const touches = labels
    .filter((l) => l.startsWith('touches:') || l.startsWith('area:'))
    .map((l) => l.slice(l.indexOf(':') + 1).trim())
    .filter((t) => t.length > 0)
  const type = (labels.find((l) => l.startsWith('type:')) || 'type:').slice('type:'.length)
  // gates (F21): el gate humano vuelve del ISSUE, no del spec — que es lo que
  // hace que sobreviva a un redespacho, a un `--reopen` y a cualquier sesión
  // que se re-hidrate. `gatesDeclared` distingue "este slice no tiene gates"
  // (label `gate:none`) de "este issue es anterior a los gates" (ninguna label
  // `gate:`), y esa distinción no es cosmética: en el segundo caso
  // kickoff.js cae al `Tipo`, de modo que los issues `type:ui` ya groomeados
  // no pierden su gate de screenshot el día que esto se despliega. Los
  // `gate:` que no estén en el vocabulario se descartan (gates.js) — nunca se
  // le anuncia al agente un gate cuyo texto nadie sabe escribir.
  const { gates, declared: gatesDeclared } = gatesFromLabels(labels)
  const body = i.body || ''
  const order = extractOrder(body)
  // deps aquí quedan en ESPACIO DE ORDEN (groom.js#buildIssueBody escribe
  // `merge-after #<orden>`, no `#<issue>`) — ver buildDispatchInput para la
  // traducción a espacio de número-de-issue antes de comparar con
  // mergedIssues (que sí son números de issue reales).
  //
  // D1 finding 2: extractDepsInSection (arriba) — no extractDeps sobre el
  // body entero — es quien decide el alcance ahora: solo "## Dependencias".
  // `depsMalformed` viaja tal cual hasta dispatch.js#computeReadyCandidates,
  // que trata un issue así como NO listo para despachar (nunca como "sin
  // dependencias" — ver el comentario de extractDepsInSection).
  const { deps, malformed: depsMalformed } = extractDepsInSection(body)
  // strayDeps (D1 finding 1, seguimiento de review): referencias
  // "merge-after #N" que existen en el body pero FUERA de la sección
  // reconocida — el estrechamiento de finding 2 hace que ya NO cuenten como
  // dependencia real, así que se exponen aparte para que ct-next.mjs pueda
  // avisar en vez de despachar en silencio un issue cuya dependencia
  // pretendida vive en el sitio equivocado.
  const strayDeps = extractStrayDeps(body, deps)
  return {
    n: i.number,
    order: order ?? i.number,
    status,
    statusAmbiguous,
    statusLabels,
    deps,
    depsMalformed,
    strayDeps,
    touches,
    type,
    gates,
    gatesDeclared,
    // name: viene del TÍTULO del issue (columna Slice del spec, F3) — no
    // confundir con `slice.entrega` (columna Entrega) que usa slices.js/
    // groom.js para la sección "Descripción" del cuerpo. Mismo nombre de
    // campo que slices.js#name (la columna Slice) a propósito: ambos
    // structs representan el mismo concepto, así que usan la misma palabra.
    name: (i.title || '').replace(/^#\d+\s*/, ''),
    ac: extractAc(body),
    issue: `#${i.number}`,
  }
}

// mergedIssues: issues cerrados cuyo PR se mergeó (aproximación explícita del
// brief: "cerrado" no es lo mismo que "mergeado", pero es lo único observable
// sin cruzar con el grafo de PRs). Verificado contra gh 2.86 (`gh issue list
// --json bogusField` lista los campos válidos sin tocar red): el campo se
// llama `stateReason`, tal cual, y gh expone el valor en el casing del enum
// GraphQL `IssueStateReason` (mayúsculas: "COMPLETED", "NOT_PLANNED",
// "REOPENED"). No existe una variante real en minúsculas — no la toleramos
// aquí a propósito (review round 1, Minor 3: rama muerta eliminada).
export function filterMergedIssues(closedIssues) {
  return (closedIssues || []).filter((i) => i.stateReason === 'COMPLETED').map((i) => i.number)
}

// ============================================================================
// F13/H4 — LA APROXIMACIÓN "CERRADO = MERGEADO" TIENE DOS TRAMPAS OPUESTAS, Y
// NINGUNA ERA VISIBLE DESDE FUERA.
//
// El comentario de `filterMergedIssues` (arriba) ya reconocía que "cerrado no
// es lo mismo que mergeado, pero es lo único observable sin cruzar con el
// grafo de PRs". Eso era honesto cuando se escribió; lo que faltaba era
// enumerar las CONSECUENCIAS, que son dos y van en direcciones contrarias:
//
//   (1) FALSO NEGATIVO, silencioso y permanente. Cerrar un slice descartado
//       como **not planned** —lo semánticamente correcto— deja `stateReason
//       = 'NOT_PLANNED'`, así que NO entra en `mergedIssues` y TODOS sus
//       dependientes quedan esperando para siempre. Verificado contra el
//       código sin arreglar: `/ct-next` respondía "falta mergear #7", con
//       #7 cerrado — una instrucción a esperar algo que ya no va a ocurrir,
//       indistinguible de "#7 sigue en curso".
//
//   (2) FALSO POSITIVO. Cerrar a mano como **completed** sin haber mergeado
//       nada satisface la dep igualmente, y el dependiente se despacha sobre
//       trabajo que no existe.
//
// QUÉ SE ARREGLA Y QUÉ NO, Y POR QUÉ. Se arregla (1): es el caso que deja al
// loop atascado en silencio, y es DETECTABLE con datos que ya se traen (el
// `state_reason` de cada issue cerrado viaja en la misma llamada REST que ya
// se hace, coste de red CERO). `closedNotCompleted` lo expone y ct-next.mjs
// lo nombra en el mensaje de deps sin satisfacer, con el remedio exacto.
//
// NO se arregla (2) cruzando el grafo de PRs, y es una decisión, no un
// olvido: distinguir "cerrado como completed por un merge" de "cerrado como
// completed a mano" exige el timeline del issue (GraphQL, una llamada por
// issue cerrado) para blindar un caso que requiere que alguien cierre a mano
// como completed un slice sin mergear — mientras que (1) ocurre al hacer LO
// CORRECTO. El coste no se justifica; lo que sí se hace es dejar de PROMETER
// lo que no se comprueba: el contrato de la §9 (ct-init.sh) decía
// "`merge-after` significa MERGEADO" y ahora dice qué se mira de verdad y
// qué no. Una promesa retirada vale más que una comprobación cara a medias.
//
// 'REOPENED' aparece aquí por completitud del enum `IssueStateReason`: un
// issue reabierto normalmente vuelve a estar ABIERTO (y entonces ni siquiera
// llega a esta lista), pero si apareciera cerrado con ese motivo tampoco
// cuenta como mergeado, y el mismo mensaje sirve. `null`/ausente (issues
// cerrados antes de que GitHub tuviera `state_reason`) también entra: no
// consta que se completara, y afirmar lo contrario sería inventarlo.
export function closedNotCompleted(closedIssues) {
  const out = {}
  for (const i of (closedIssues || [])) {
    if (i.stateReason === 'COMPLETED') continue
    out[i.number] = i.stateReason ?? null
  }
  return out
}

// ============================================================================
// F18/H2 — UN ISSUE CERRADO QUE CONSERVA SU LABEL `status:` DESAPARECE DEL
// DISPATCHER SIN UNA PALABRA.
//
// `/ct-next` solo enumera issues ABIERTOS (state=open). Un issue cerrado con
// `status:ready` todavía puesta deja de existir para el dispatcher: no se
// selecciona, no cuenta en vuelo, y —lo grave— no se NOMBRA en ninguna parte.
//
// Lo que pasó en campo: el único slice despachable se cerró por accidente, y
// la corrida siguiente cayó al siguiente `status:ready` del repo (otro epic,
// sin milestone) y explicó con detalle por qué ÉSE no era despachable. El
// operador leyó una explicación cuidadosa de algo irrelevante, sin una sola
// pista de que su trabajo se había caído de la cola.
//
// LA TASA, medida (28-jul-2026, repo de producción, consulta paginada
// COMPLETA — no una lista escrita a mano): 10 de 99 issues cerrados conservan
// una label `status:` viva. Uno de cada diez. No es un accidente puntual:
// cerrar el issue y quitarle su label son dos actos separados y NADA comprueba
// el segundo, así que el residuo se acumula solo.
//
//   53, 54, 58, 63   COMPLETED  status:in-review
//   155, 245         COMPLETED  status:in-progress
//   156, 157, 161    COMPLETED  status:ready
//   158              COMPLETED  status:blocked
//
// Esta función devuelve TODOS (incluidos los `in-review`) y no clasifica: la
// separación entre "contradicción" y "final normal de un slice" es una
// decisión de PRESENTACIÓN y vive en ct-next.mjs, donde está el mensaje. Aquí
// solo se mira el dato, que además viaja YA en la misma llamada REST de
// issues cerrados que `filterMergedIssues`/`closedNotCompleted` ya consumen:
// coste de red CERO.
//
// Una label `status:` SIN valor (`status:` a secas, o `status: ` con espacio)
// se descarta, con el mismo criterio y por el mismo motivo que `area:`/
// `touches:` vacías en mapGhIssue: un token vacío no representa ningún estado.
export function closedWithLiveStatus(closedIssues) {
  const out = []
  for (const i of (closedIssues || [])) {
    const labels = (i.labels || [])
      .map((l) => (typeof l === 'string' ? l : l?.name))
      .filter((s) => typeof s === 'string')
    const statusLabels = labels
      .filter((l) => l.startsWith('status:'))
      .map((l) => l.slice('status:'.length).trim())
      .filter((s) => s.length > 0)
    if (!statusLabels.length) continue
    out.push({ n: i.number, statusLabels: [...new Set(statusLabels)].sort(), stateReason: i.stateReason ?? null })
  }
  return out
}
// ============================================================================

// NO_MILESTONE_KEY / epicKeyOf (D1 finding 1): /ct-groom numera slices 1..N
// POR EPIC (una invocación = un `--milestone` = un epic — ver
// groom.js#groomPlan) y escribe ESE número en `<!-- ct-order:N -->`. El
// número de orden por tanto NO es único en el repo — solo dentro de su
// propio epic. `epicKeyOf` deriva el ALCANCE del epic del número de
// milestone real que GitHub ya asigna a cada issue (abierto o cerrado)
// desde que ct-groom.mjs existe: coste de compatibilidad CERO para
// cualquier issue ya groomeado — no hace falta tocar ni un solo marcador
// `ct-order` existente, el milestone ya viaja en el JSON crudo de `gh api
// repos/<o>/<r>/issues`. Se descarta codificar el identificador de epic
// DENTRO del propio marcador (la otra opción que se consideró): sería la
// MISMA información que el milestone ya provee, pero exigiría reescribir
// issues ya groomeados o mantener dos formatos de marcador en paralelo
// indefinidamente para lo que el campo `milestone` resuelve gratis.
//
// Un issue sin milestone (creado a mano, o de un repo de antes de que
// ct-groom empezara a asignarlo) cae en el bucket compartido
// `NO_MILESTONE_KEY` — mejor que reventar, pero ese bucket puede volver a
// colisionar si dos epics sin milestone reutilizan números de orden; la
// detección de colisión de buildOrderIndex (más abajo) cubre justo ese
// caso, así que el bucket compartido nunca falla en SILENCIO — como mucho,
// los issues implicados quedan excluidos de la selección con un aviso
// claro (ver buildDispatchInput/ct-next.mjs), nunca resueltos a ciegas.
export const NO_MILESTONE_KEY = '(sin milestone)'
export function epicKeyOf(rawIssue) {
  const ms = rawIssue?.milestone
  return (ms && Number.isFinite(ms.number)) ? String(ms.number) : NO_MILESTONE_KEY
}

// buildOrderIndex: Map(epicKey -> Map(orden -> número de issue)), construido
// a partir de TODOS los issues (abiertos + cerrados) de la enumeración cruda
// de gh. Tiene que incluir los cerrados: la dependencia típica que queremos
// reconocer como satisfecha es precisamente la de un issue YA MERGEADO (por
// tanto cerrado), y su marcador ct-order (y su milestone) solo viven en su
// propio body/metadata — si solo indexáramos los abiertos, toda dependencia
// sobre un issue ya cerrado desaparecería del índice en cuanto se mergeara.
//
// D1 finding 1 — DETECCIÓN: antes de este fix, el índice era un único Map
// GLOBAL AL REPO y `index.set` se quedaba con el ÚLTIMO issue visto para un
// orden repetido — con `[...open, ...closed]`, un issue YA MERGEADO de OTRO
// epic ganaba en silencio el slot que un `merge-after` de un epic en curso
// necesitaba resolver contra su propio hermano. El escaneo por epic (arriba)
// cierra la INMENSA mayoría de esos casos (epics distintos = milestones
// distintos = mapas distintos), pero una colisión DENTRO del mismo epic
// sigue siendo posible (dos epics que comparten milestone por error — p.ej.
// ambos con el título por defecto "Epic" sin que nadie pasara `--milestone`
// — o un re-groom accidental que dejó dos issues con el mismo marcador). Esa
// colisión NUNCA se resuelve en silencio quedándose con "el último" (ni con
// "el primero"): se acumula en `collisions` para que buildDispatchInput
// excluya el epic afectado de la selección (ver su propio comentario) en
// vez de arriesgarse a despachar contra la dependencia equivocada —
// exactamente el bug que este finding describe.
//
// Cada hueco (epicKey, orden) acumula TODOS los números de issue distintos
// vistos para él (no solo "el primero" y "el que choca") — review de D1:
// con tres issues en el mismo hueco, comparar solo contra "el primero visto"
// producía DOS entradas de colisión solapadas ([primero,segundo] y
// [primero,tercero]), repitiendo el primero y sin dejar ver de un vistazo
// que son TRES los que compiten por el mismo hueco, no dos pares distintos.
// Una única entrada por hueco, con la lista completa de issues implicados,
// es más fácil de leer y de actuar.
export function buildOrderIndex(rawIssues) {
  // seen: epicKey -> Map(orden -> [números de issue, en el orden en que se
  // vieron, sin duplicados]) — se acumula TODO antes de decidir qué es
  // colisión, para poder emitir una sola entrada por hueco al final.
  const seen = new Map()
  for (const i of (rawIssues || [])) {
    const order = extractOrder(i.body)
    if (order == null) continue
    const epicKey = epicKeyOf(i)
    if (!seen.has(epicKey)) seen.set(epicKey, new Map())
    const orderMap = seen.get(epicKey)
    if (!orderMap.has(order)) orderMap.set(order, [])
    const issuesHere = orderMap.get(order)
    if (!issuesHere.includes(i.number)) issuesHere.push(i.number)
  }
  const perEpic = new Map()
  const collisions = []
  for (const [epicKey, orderMap] of seen) {
    const outOrderMap = new Map()
    for (const [order, issuesHere] of orderMap) {
      outOrderMap.set(order, issuesHere[0]) // el primero visto conserva el slot; ver comentario de arriba sobre por qué el valor exacto ya no importa cuando hay colisión.
      if (issuesHere.length > 1) {
        collisions.push({ epicKey, order, issues: [...issuesHere].sort((a, b) => a - b) })
      }
    }
    perEpic.set(epicKey, outOrderMap)
  }
  return { perEpic, collisions }
}

// buildDispatchInput: compone mapGhIssue + filterMergedIssues + la
// traducción orden→issue de `deps` (ya con alcance por epic, ver
// buildOrderIndex) en un único punto, para que ct-next.mjs nunca tenga que
// decidir en qué espacio de IDs está comparando. Root cause del bug
// encontrado en T10: `deps` sale de mapGhIssue en espacio de ORDEN
// (groom.js escribe `merge-after #<orden>`), pero `mergedIssues` son números
// de ISSUE reales (filterMergedIssues lee `i.number`) — comparar uno contra
// otro sin traducir deja bloqueado para siempre cualquier slice con
// dependencias, salvo que orden e issue coincidan por casualidad. Una
// dependencia cuyo orden no aparece en el epic del propio issue (ni abierto
// ni cerrado) se traduce a `null`: `mergedIssues` (números de issue) nunca
// contiene `null`, así que esa dependencia queda permanentemente sin
// satisfacer en vez de lanzar o, peor, colapsar por casualidad con un número
// de issue real.
//
// `orderCollisions` (D1 finding 1) viaja tal cual desde buildOrderIndex —
// ct-next.mjs lo usa SOLO para avisar (nunca para abortar nada, ver más
// abajo). `issues` YA EXCLUYE, aquí mismo, cualquier issue abierto cuyo
// PROPIO epicKey esté implicado en una colisión (review de D1, finding 4):
// el "refuse" original abortaba el BATCH ENTERO — con el orden indexado
// también sobre issues cerrados, una colisión que viviera solo entre
// issues mergeados hace tiempo (un epic ya terminado, sin relación con
// nada de lo que hay abierto hoy) ladrillaba el repo COMPLETO para
// siempre, sin más remedio que editar GitHub a mano. Seguir rehusando a
// resolver en silencio sigue siendo la dirección correcta — lo que cambia
// es el RADIO: solo el/los epic(s) cuyo propio orden colisiona quedan
// fuera de `issues` (ni se seleccionan ni cuentan en vuelo, porque su
// propia traducción orden→issue no es de fiar), un epic sin relación
// (epicKey distinto, sin colisión) se ve con total normalidad. Excluir
// tanto de la selección COMO del cómputo de en-vuelo es deliberado: no hay
// forma segura de confiar en NINGÚN dato de un epic cuyo propio índice de
// orden está corrompido, ni siquiera "está en progreso".
export function buildDispatchInput(rawOpenIssues, rawClosedIssues) {
  const allRaw = [...(rawOpenIssues || []), ...(rawClosedIssues || [])]
  const { perEpic, collisions } = buildOrderIndex(allRaw)
  const collidingEpics = new Set(collisions.map((c) => c.epicKey))
  const issues = (rawOpenIssues || [])
    .filter((raw) => !collidingEpics.has(epicKeyOf(raw)))
    .map((raw) => {
      const issue = mapGhIssue(raw)
      const orderMap = perEpic.get(epicKeyOf(raw))
      return {
        ...issue,
        deps: (issue.deps || []).map((d) => (orderMap && orderMap.has(d) ? orderMap.get(d) : null)),
      }
    })
  const mergedIssues = filterMergedIssues(rawClosedIssues)
  // depStates (F13/H4): el estado de los issues CERRADOS que NO cuentan como
  // mergeados, para que quien no pueda salir pueda saber POR QUÉ. Viaja junto
  // a `mergedIssues` (y no se recalcula en ct-next.mjs) porque las dos cosas
  // se derivan de la MISMA lista de issues cerrados: separarlas invitaría a
  // que una se filtrara y la otra no.
  // closedStatusResidue (F18/H2): viaja aquí por el mismo motivo que
  // `depStates` — se deriva de la MISMA lista de issues cerrados, y separarlo
  // invitaría a que una de las dos derivaciones se filtrara y la otra no.
  return {
    issues,
    mergedIssues,
    depStates: closedNotCompleted(rawClosedIssues),
    closedStatusResidue: closedWithLiveStatus(rawClosedIssues),
    orderCollisions: collisions,
  }
}
