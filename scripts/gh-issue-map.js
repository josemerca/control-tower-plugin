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

export function mapGhIssue(i) {
  const labels = (i.labels || []).map((l) => l.name)
  const status = (labels.find((l) => l.startsWith('status:')) || 'status:backlog').slice('status:'.length)
  const touches = labels.filter((l) => l.startsWith('touches:')).map((l) => l.slice('touches:'.length))
  const type = (labels.find((l) => l.startsWith('type:')) || 'type:').slice('type:'.length)
  const body = i.body || ''
  const orderM = body.match(/ct-order:(\d+)/)
  const deps = [...body.matchAll(/merge-after #(\d+)/g)].map((m) => parseInt(m[1], 10))
  return {
    n: i.number,
    order: orderM ? parseInt(orderM[1], 10) : i.number,
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
