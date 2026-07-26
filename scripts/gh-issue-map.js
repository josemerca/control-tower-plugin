// Mapeo puro de issues de GitHub (forma cruda de `gh issue list --json
// number,title,labels,body` / `--json number,stateReason`) a la forma que
// consumen selectNext/renderKickoff/buildStateSeed. Extraído de ct-next.mjs
// (review round 1, Important/Minor 1) para poder testearlo sin red y sin
// pasar por `gh`: antes de este cambio el único camino de test entraba por
// CT_NEXT_FIXTURE, así que este mapeo nunca se ejecutaba en la suite — una
// deriva en el formato de groom.js#buildIssueBody (p.ej. renombrar el
// encabezado "## Acceptance criteria") podía romperlo en silencio hasta el
// dispatch real contra un repo de verdad.

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
export function locateLine(body, prefix) {
  const found = scanLines(body, (line) => line.startsWith(prefix))
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
// (deriva de `--section`/la ruta del propio spec), no bookkeeping como el
// marcador `ct-order` — así que F5 la compara igual que el título.
export function extractSpecLink(body) {
  return extractLine(body, '> Slice #')
}

// specLinkAnchor (review round 4, importante 4): extrae SOLO el ancla
// "#sección" de una línea de enlace al spec — no la ruta. `ct-groom.mjs`
// renderiza el enlace con `process.argv[2]` tal cual lo haya escrito quien
// invoque el comando: una vez como "docs/spec.md", otra vez con ruta
// absoluta (un slash command frente a un cron, p.ej.) — comparar la línea
// ENTERA haría que --reconcile viera "divergencia" en TODOS los issues cada
// vez que cambia la notación de la ruta, y la reescribiría de vuelta en la
// siguiente corrida con la otra costumbre: dos invocaciones haciendo
// ping-pong sobre issues reales para siempre. F5 compara SOLO el ancla — la
// ruta puede variar en cómo se escribe sin que eso cuente como divergencia
// (a cambio, si el spec se MUEVE a otro fichero pero la sección numérica no
// cambia, F5 ya no lo detecta — límite conocido, documentado en
// commands/ct-groom.md, preferible al ping-pong).
//
// Formato esperado: "> Slice #N del epic. Spec: [ruta#sección](ruta#sección)"
// — el PRIMER '#' que aparece dentro de un par de corchetes "[...]" (el "#N"
// del principio de la línea, antes de "Spec:", queda fuera porque no está
// dentro de ningún corchete).
export function specLinkAnchor(specLinkLine) {
  if (!specLinkLine) return null
  const m = specLinkLine.match(/\[[^\]]*#([^\]]+)\]/)
  return m ? m[1] : null
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
// se le pase, sin anclarse a ninguna sección por sí misma — quien decide el
// ALCANCE (todo el body, o solo el contenido de una sección) es el
// llamador:
//   - mapGhIssue (más abajo), el DISPATCHER real, la llama sobre el body
//     ENTERO a propósito: dispatch.js necesita ver cualquier `merge-after`
//     que el issue traiga, viva donde viva.
//   - scripts/reconcile.js, en cambio, la llama SOLO sobre el contenido de
//     "## Dependencias" (vía locateSection/extractSectionContent) — review
//     round 3 (Critical 3): el dominio de detección de F5 tiene que
//     coincidir con su dominio de APLICACIÓN (el splice de --reconcile,
//     que solo puede tocar esa sección sin arriesgar corromper contenido
//     humano en otra parte del body) — si F5 comparara todo el body como
//     hace el dispatcher, un "merge-after" suelto fuera de la sección
//     reconocida se reportaría como divergencia que --reconcile nunca
//     podría resolver de verdad, dejando el proceso en 3 para siempre.
export function extractDeps(body) {
  return [...(body || '').matchAll(/merge-after #(\d+)/g)].map((m) => parseInt(m[1], 10))
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

export function mapGhIssue(i) {
  const labels = (i.labels || []).map((l) => l.name)
  const status = (labels.find((l) => l.startsWith('status:')) || 'status:backlog').slice('status:'.length)
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
  const touches = labels
    .filter((l) => l.startsWith('touches:') || l.startsWith('area:'))
    .map((l) => l.slice(l.indexOf(':') + 1))
  const type = (labels.find((l) => l.startsWith('type:')) || 'type:').slice('type:'.length)
  const body = i.body || ''
  const order = extractOrder(body)
  // deps aquí quedan en ESPACIO DE ORDEN (groom.js#buildIssueBody escribe
  // `merge-after #<orden>`, no `#<issue>`) — ver buildDispatchInput para la
  // traducción a espacio de número-de-issue antes de comparar con
  // mergedIssues (que sí son números de issue reales). extractDeps (arriba)
  // es el ÚNICO sitio que sabe leer `merge-after #N` — F5 (scripts/reconcile.js)
  // reutiliza esta misma función, solo que sobre el contenido de "##
  // Dependencias" en vez de sobre el body entero (ver el comentario de
  // extractDeps para el porqué de esa diferencia de alcance).
  const deps = extractDeps(body)
  return {
    n: i.number,
    order: order ?? i.number,
    status,
    deps,
    touches,
    type,
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

// buildOrderIndex: Map(orden -> número de issue), construido a partir de
// TODOS los issues (abiertos + cerrados) de la enumeración cruda de gh
// (forma {number, body}). Tiene que incluir los cerrados: la dependencia
// típica que queremos reconocer como satisfecha es precisamente la de un
// issue YA MERGEADO (por tanto cerrado), y su marcador ct-order solo vive en
// su propio body — si solo indexáramos los abiertos, toda dependencia sobre
// un issue ya cerrado desaparecería del índice en cuanto se mergeara.
export function buildOrderIndex(rawIssues) {
  const index = new Map()
  for (const i of (rawIssues || [])) {
    const order = extractOrder(i.body)
    if (order != null) index.set(order, i.number)
  }
  return index
}

// buildDispatchInput: compone mapGhIssue + filterMergedIssues + la
// traducción orden→issue de `deps` en un único punto, para que ct-next.mjs
// nunca tenga que decidir en qué espacio de IDs está comparando. Root cause
// del bug encontrado en T10: `deps` sale de mapGhIssue en espacio de ORDEN
// (groom.js escribe `merge-after #<orden>`), pero `mergedIssues` son números
// de ISSUE reales (filterMergedIssues lee `i.number`) — comparar uno contra
// otro sin traducir deja bloqueado para siempre cualquier slice con
// dependencias, salvo que orden e issue coincidan por casualidad (que es
// justo lo que ocurre en TODA la suite existente, porque sus fixtures usan
// `n`/`deps` con los mismos valores en ambos roles y por eso el bug nunca se
// vio en tests). Una dependencia cuyo orden no aparece en ningún issue
// (abierto o cerrado) se traduce a `null`: `mergedIssues` (números de issue)
// nunca contiene `null`, así que esa dependencia queda permanentemente sin
// satisfacer en vez de lanzar o, peor, colapsar por casualidad con un número
// de issue real.
export function buildDispatchInput(rawOpenIssues, rawClosedIssues) {
  const orderIndex = buildOrderIndex([...(rawOpenIssues || []), ...(rawClosedIssues || [])])
  const issues = (rawOpenIssues || []).map(mapGhIssue).map((issue) => ({
    ...issue,
    deps: (issue.deps || []).map((d) => (orderIndex.has(d) ? orderIndex.get(d) : null)),
  }))
  const mergedIssues = filterMergedIssues(rawClosedIssues)
  return { issues, mergedIssues }
}
