// Mapeo puro de issues de GitHub (forma cruda de `gh issue list --json
// number,title,labels,body` / `--json number,stateReason`) a la forma que
// consumen selectNext/renderKickoff/buildStateSeed. Extraído de ct-next.mjs
// (review round 1, Important/Minor 1) para poder testearlo sin red y sin
// pasar por `gh`: antes de este cambio el único camino de test entraba por
// CT_NEXT_FIXTURE, así que este mapeo nunca se ejecutaba en la suite — una
// deriva en el formato de groom.js#buildIssueBody (p.ej. renombrar el
// encabezado "## Acceptance criteria") podía romperlo en silencio hasta el
// dispatch real contra un repo de verdad.

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
  const headingRe = new RegExp(`${headingPrefix}[^\\n]*\\n?`)
  const headingMatch = headingRe.exec(src)
  if (!headingMatch) return null
  const headingStart = headingMatch.index
  const headingEnd = headingStart + headingMatch[0].length
  const rest = src.slice(headingEnd)
  const endMatch = /\n##\s|\n<!--|$/.exec(rest)
  const contentEnd = headingEnd + (endMatch ? endMatch.index : rest.length)
  return { headingStart, headingEnd, contentEnd, content: src.slice(headingEnd, contentEnd) }
}

export function extractSectionContent(body, headingPrefix) {
  const loc = locateSection(body, headingPrefix)
  return loc ? loc.content.trim() : null
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

// extractDeps: lee TODAS las referencias `merge-after #N` del body, sin
// anclarse a ninguna sección — groom.js#buildIssueBody las agrupa bajo "##
// Dependencias", pero el dispatcher (mapGhIssue, más abajo) siempre las leyó
// así, de todo el body, y F5 (scripts/reconcile.js) reutiliza esta MISMA
// función para comparar — así "lo que compara F5" y "lo que lee el
// dispatcher" son, por construcción, la misma extracción, no dos
// implementaciones que puedan divergir.
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
  // es la MISMA extracción que usa F5 (scripts/reconcile.js) para comparar
  // — un solo sitio que sabe leer `merge-after #N`, no dos que puedan
  // divergir con el tiempo.
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
