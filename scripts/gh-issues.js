// Lógica pura para parsear/filtrar el listado paginado de issues de
// `gh api repos/<o>/<r>/issues --paginate --slurp` y buscar el marcador
// ct-order. Extraída de ct-groom.mjs para poder testearla sin red:
//
// 1. Ese endpoint REST de issues devuelve TAMBIÉN los pull requests del repo
//    (comparten namespace en la API v3). Hay que descartar las entradas que
//    traen la clave `pull_request` antes de buscar el marcador, o se puede
//    casar contra el body de un PR.
// 2. `gh api --paginate` sin `--slurp` imprime cada página como un documento
//    JSON separado (varios arrays JSON concatenados en stdout), lo que rompe
//    un `JSON.parse` directo en cuanto hay más de una página. Con `--slurp`,
//    gh envuelve todas las páginas en un array externo — el resultado es un
//    array de arrays (uno por página) que hay que aplanar.

export function flattenIssuePages(parsed) {
  if (!Array.isArray(parsed)) return []
  return parsed.flat()
}

export function isPullRequest(entry) {
  return Object.prototype.hasOwnProperty.call(entry || {}, 'pull_request')
}

export function realIssuesOnly(entries) {
  return (entries || []).filter((e) => !isPullRequest(e))
}

export function findByMarker(issues, marker) {
  return (issues || []).find((i) => (i.body || '').includes(marker))
}
