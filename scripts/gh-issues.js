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

// flattenPages: aplana el array-de-páginas que produce `--paginate --slurp`.
// No tiene nada de específico de issues (F6 la reutiliza para el listado de
// labels del repo, que se pagina igual); `flattenIssuePages` se conserva como
// el nombre con el que ya la llaman ct-groom.mjs/ct-next.mjs y sus tests.
export function flattenPages(parsed) {
  if (!Array.isArray(parsed)) return []
  return parsed.flat()
}
export function flattenIssuePages(parsed) {
  return flattenPages(parsed)
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
