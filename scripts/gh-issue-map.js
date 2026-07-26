// Mapeo puro de issues de GitHub (forma cruda de `gh issue list --json
// number,title,labels,body` / `--json number,stateReason`) a la forma que
// consumen selectNext/renderKickoff/buildStateSeed. Extraído de ct-next.mjs
// (review round 1, Important/Minor 1) para poder testearlo sin red y sin
// pasar por `gh`: antes de este cambio el único camino de test entraba por
// CT_NEXT_FIXTURE, así que este mapeo nunca se ejecutaba en la suite — una
// deriva en el formato de groom.js#buildIssueBody (p.ej. renombrar el
// encabezado "## Acceptance criteria") podía romperlo en silencio hasta el
// dispatch real contra un repo de verdad.

// FENCE_LINE_RE: delimitador de un bloque de código cercado (CommonMark:
// hasta 3 espacios de indentación, luego 3+ backticks o 3+ tildes). Una
// línea que abre o cierra una valla de este tipo NUNCA cuenta como
// cabecera ni como terminador de sección, sea cual sea su contenido — ver
// scanLines más abajo.
const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})/

// scanLines: recorre `body` línea a línea, llevando la cuenta de si la
// línea actual cae DENTRO de un bloque de código cercado (una línea de
// valla, dentro o fuera de la cuenta, siempre alterna el estado), y
// devuelve la primera línea (índice + offset absoluto en la cadena) que
// satisface `predicate`, IGNORANDO por completo las líneas dentro de una
// valla. Es el mecanismo compartido detrás de locateSection/locateLine —
// review round 3 (Critical 1): antes, tanto la cabecera como el
// terminador de sección se buscaban con una regex sobre la cadena
// COMPLETA, sin distinguir "dentro de una valla de código" de "estructura
// real del documento" — un `## Dependencias` mencionado dentro de un
// bloque de código cercado (documentación, ejemplo…) se confundía con una
// cabecera real, y el empalme posterior se comía el cierre de la valla.
function scanLines(body, predicate) {
  const src = body || ''
  const lines = src.split('\n')
  let offset = 0
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (FENCE_LINE_RE.test(line)) {
      inFence = !inFence
    } else if (!inFence && predicate(line, i)) {
      return { index: i, offset, line }
    }
    offset += line.length + 1
  }
  return null
}

// locateSection: encuentra dónde vive una sección del body (buildIssueBody
// en groom.js genera un puñado de secciones con cabecera fija: "##
// Acceptance criteria…", "## Dependencias", "## Out of scope / Protected",
// "## Descripción") — delimitada por su propia cabecera (headingPrefix, el
// texto fijo; buildIssueBody añade texto libre detrás en algún caso, p.ej.
// "(EARS, 1:1 con tests)", por eso `headingPrefix` solo ancla el prefijo, no
// la línea completa) y por el mismo criterio de "fin de sección" que ya usaba
// extractAc: la siguiente cabecera "## …", el marcador `<!-- ct-order -->`, o
// el fin del body. Devuelve `null` si la cabecera no aparece en absoluto.
//
// Review round 3 (Critical 1) — reescrita por completo, línea a línea en vez
// de con una regex sobre la cadena entera: la versión anterior buscaba
// `headingPrefix` con `.exec(src)` SIN anclar a inicio de línea y SIN
// escapar el prefijo, mientras el terminador SÍ estaba anclado (`\n##\s`) —
// las dos mitades usaban criterios distintos, y el empalme se fiaba de la
// que no anclaba. Verificado por construcción (tests explícitos): una
// mención de `## Dependencias` a mitad de línea (p.ej. un AC que dice
// "el body debe traer ## Dependencias cuando hay deps") o citada
// (`> ## Dependencias`) matcheaba igual que una cabecera real, y el empalme
// escribía dentro de la sección equivocada. Esta versión exige que la
// cabecera empiece la línea EXACTAMENTE en la columna 0 (`line.startsWith`,
// sin construir ninguna regex a partir de `headingPrefix` — ni escapar hace
// falta, ya no es una regex) y, además, IGNORA cualquier línea dentro de un
// bloque de código cercado (scanLines) — así ni una mención inline, ni una
// cita, ni un ejemplo dentro de una valla de código se confunden con la
// cabecera real, y el terminador usa el MISMO criterio (línea a línea,
// consciente de vallas) en vez de una regex con otro criterio de anclaje.
//
// Se usa tanto para EXTRAER contenido (comparar spec vs. issue — F5) como
// para REEMPLAZARLO quirúrgicamente (F5 --reconcile, ver
// scripts/reconcile.js#buildReconcileBody): las posiciones `headingStart`/
// `headingEnd`/`contentEnd` permiten hacer un `body.slice(...)` que toca
// SOLO esa sección, dejando intacto cualquier contenido humano antes,
// después, o en cualquier sección nueva que el humano haya añadido en otro
// punto del body (esas secciones tienen su propia cabecera "## …", así que
// nunca caen dentro del rango de una sección que buildIssueBody sí conoce).
export function locateSection(body, headingPrefix) {
  const src = body || ''
  const heading = scanLines(src, (line) => line.startsWith(headingPrefix))
  if (!heading) return null
  const headingStart = heading.offset
  // headingEnd: justo después del '\n' que cierra la línea de cabecera (si
  // el body termina justo ahí, sin más líneas, headingEnd es src.length).
  const headingEnd = Math.min(headingStart + heading.line.length + 1, src.length)

  // Terminador: primera línea (a partir de la siguiente a la cabecera),
  // ignorando vallas, que sea otra cabecera "## " o el marcador "<!--".
  // `consumed` acumula, línea a línea, la posición (relativa a headingEnd)
  // de INICIO de la línea que se está evaluando — al encontrar el
  // terminador en la línea `i`, `consumed` todavía NO incluye esa línea, así
  // que apunta al carácter '\n' que la precede inmediatamente (o a
  // headingEnd si no hay ninguna línea de contenido en medio) — mismo punto
  // de corte que usaba la regex original (`\n##…` ancla EN ese '\n', no
  // después), para que el formato de "línea en blanco antes de la siguiente
  // cabecera" que genera buildIssueBody se preserve al reconstruir el
  // empalme (ver buildReconcileBody).
  const restLines = src.slice(headingEnd).split('\n')
  let inFence = false
  let consumed = 0
  let contentEnd = src.length
  for (let i = 0; i < restLines.length; i++) {
    const line = restLines[i]
    if (FENCE_LINE_RE.test(line)) {
      inFence = !inFence
    } else if (!inFence && (line.startsWith('## ') || line.startsWith('<!--'))) {
      contentEnd = headingEnd + Math.max(consumed - 1, 0)
      break
    }
    consumed += line.length + 1
  }
  return { headingStart, headingEnd, contentEnd, content: src.slice(headingEnd, contentEnd) }
}

export function extractSectionContent(body, headingPrefix) {
  const loc = locateSection(body, headingPrefix)
  return loc ? loc.content.trim() : null
}

// locateLine / extractLine: como locateSection, pero para una entidad de
// UNA SOLA línea (sin cabecera + contenido delimitado) — usado para la
// línea de enlace al spec que buildIssueBody escribe como primera línea del
// body (`> Slice #N del epic. Spec: […]`). Mismo criterio de anclaje a
// columna 0 y de ignorar líneas dentro de una valla de código.
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

// countHeadingLines: cuántas veces aparece una cabecera (anclada a columna
// 0, ignorando vallas de código — mismo criterio que locateSection) en todo
// el body — no solo si aparece, sino CUÁNTAS veces. Review round 3
// (menor): locateSection siempre encuentra/empalma la PRIMERA aparición;
// si un humano duplicó una sección a mano (copiar-pegar, un merge
// conflictivo mal resuelto…), la segunda copia queda invisible tanto para
// la comparación como para --reconcile — un "reconcile con éxito" no
// avisa de que dejó una sección vieja huérfana por ahí. Se usa para
// avisar de esa situación, no para decidir qué se aplica (eso sigue
// siendo, a propósito, "la primera").
export function countHeadingLines(body, headingPrefix) {
  const src = body || ''
  const lines = src.split('\n')
  let inFence = false
  let count = 0
  for (const line of lines) {
    if (FENCE_LINE_RE.test(line)) {
      inFence = !inFence
    } else if (!inFence && line.startsWith(headingPrefix)) {
      count++
    }
  }
  return count
}

export function extractAc(body) {
  const section = extractSectionContent(body, '## Acceptance criteria')
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
