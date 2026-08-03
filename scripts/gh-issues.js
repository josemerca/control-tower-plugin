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

// F23 — el alcance por epic de /ct-groom. Contrapartida de epicKeyOf/
// buildOrderIndex (scripts/gh-issue-map.js), que resuelven lo mismo para
// /ct-next, pero con OTRA llave y por un motivo concreto: /ct-next indexa por
// `milestone.number`, y /ct-groom no puede, porque enumera los issues del
// repo ANTES de haber resuelto (o creado) el milestone de la corrida — ese
// orden es deliberado, no accidental: el listado se colocó por delante de la
// creación del milestone precisamente para que un abort de validación no
// dejara un milestone y unas labels ya creados en GitHub (ver el comentario
// largo de ct-groom.mjs sobre el orden de las lecturas). En ese punto lo
// único que se conoce del epic es su TÍTULO, que es el argumento
// `--milestone`; y el título ya es la llave con la que el propio script hace
// idempotente la creación del milestone, así que no se introduce ninguna
// noción de identidad nueva.
//
// Un issue SIN milestone no se le atribuye a nadie: cae en `sinMilestone`,
// su propio cubo. Mismo criterio que NO_MILESTONE_KEY — compartido y con
// aviso, nunca invisible. Quien decide qué hacer con ese cubo es el caller
// (ct-groom.mjs), no esta función: aquí solo se reparte.
export function epicTitleOf(rawIssue) {
  const title = rawIssue?.milestone?.title
  return (typeof title === 'string' && title.length > 0) ? title : null
}

// partitionByEpic: tres cubos DISJUNTOS que suman siempre la entrada entera —
// ninguna llamada puede perder un issue por el camino, que es justo el modo
// de fallo que produciría duplicados (un issue que existe pero que el groom
// no ve se vuelve a crear). El orden de entrada se preserva dentro de cada
// cubo para que los mensajes al humano salgan en el orden en que GitHub los
// devolvió, no en uno arbitrario.
//
// El título se compara EXACTO, sin normalizar mayúsculas ni espacios: es la
// misma comparación que hace la resolución del milestone más abajo en
// ct-groom.mjs (`allMilestones.find((m) => m.title === milestone)`). Aflojar
// la comparación aquí y no allí haría que este reparto creyera estar viendo
// un epic que la creación del milestone consideraría distinto — y esa
// discrepancia es exactamente lo que produce duplicados.
export function partitionByEpic(issues, milestoneTitle) {
  const inEpic = []
  const sinMilestone = []
  const otrosEpics = []
  for (const issue of (issues || [])) {
    const title = epicTitleOf(issue)
    if (title === null) sinMilestone.push(issue)
    else if (title === milestoneTitle) inEpic.push(issue)
    else otrosEpics.push(issue)
  }
  return { inEpic, sinMilestone, otrosEpics }
}
