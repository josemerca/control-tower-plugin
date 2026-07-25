// Mapeo puro de issues de GitHub (forma cruda de `gh issue list --json
// number,title,labels,body` / `--json number,stateReason`) a la forma que
// consumen selectNext/renderKickoff/buildStateSeed. Extraído de ct-next.mjs
// (review round 1, Important/Minor 1) para poder testearlo sin red y sin
// pasar por `gh`: antes de este cambio el único camino de test entraba por
// CT_NEXT_FIXTURE, así que este mapeo nunca se ejecutaba en la suite — una
// deriva en el formato de groom.js#buildIssueBody (p.ej. renombrar el
// encabezado "## Acceptance criteria") podía romperlo en silencio hasta el
// dispatch real contra un repo de verdad.

export function extractAc(body) {
  if (!body) return []
  const m = body.match(/## Acceptance criteria[^\n]*\n([\s\S]*?)(\n##\s|\n<!--|$)/)
  if (!m) return []
  return m[1].split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter((l) => l && l !== '(rellenar desde el spec)')
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
  const touches = labels.filter((l) => l.startsWith('touches:')).map((l) => l.slice('touches:'.length))
  const type = (labels.find((l) => l.startsWith('type:')) || 'type:').slice('type:'.length)
  const body = i.body || ''
  const order = extractOrder(body)
  // deps aquí quedan en ESPACIO DE ORDEN (groom.js#buildIssueBody escribe
  // `merge-after #<orden>`, no `#<issue>`) — ver buildDispatchInput para la
  // traducción a espacio de número-de-issue antes de comparar con
  // mergedIssues (que sí son números de issue reales).
  const deps = [...body.matchAll(/merge-after #(\d+)/g)].map((m) => parseInt(m[1], 10))
  return {
    n: i.number,
    order: order ?? i.number,
    status,
    deps,
    touches,
    type,
    entrega: (i.title || '').replace(/^#\d+\s*/, ''),
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
