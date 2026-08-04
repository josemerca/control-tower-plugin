// cargarIssues: la lectura paginada de issues abiertos y cerrados, extraída
// de loadIssues (ct-next.mjs) para que un módulo compartido no acabe
// paginando distinto según quién lo llame — esa deriva es la clase de bug
// que este módulo existe para matar.
//
// Un módulo compartido no decide por su llamante: /ct-next quiere abortar
// ante una lectura fallida, y otro comando puede querer informar de lo que sí
// sabe y seguir. Por eso esta función no sale del proceso — la decisión de qué
// hacer con el fallo es de cada llamante.
//
// Y por eso tampoco LANZA, que es como estaba y era peor: lanzar al fallar la
// lectura de cerrados TIRABA la de abiertos, que ya estaba entera en memoria.
// Reproducido: el informe de /ct-status salía vacío bajo el epígrafe «exit 1 —
// 2 lectura(s) sin completar: lo de arriba es sólo lo que sí se ha podido
// comprobar»… y arriba no había nada. Contradice el contrato que ese comando
// publica en su cabecera y en commands/ct-status.md: «se informa de lo que sí
// se sabe». Así que las dos lecturas se INTENTAN siempre y se devuelve lo que
// haya salido bien junto con los motivos de lo que no:
//
//   { abiertos, cerrados, motivos }   motivos: [] ⇔ las dos lecturas fueron bien
//
// Cada motivo nombra CUÁL de las dos lecturas falló, igual que hacía el Error.
// Un llamante que quiera abortar ante cualquier fallo mira `motivos.length`
// (así lo hace /ct-next, cuya conducta no cambia); uno que quiera informar de
// lo parcial usa los arrays igualmente.
import { flattenIssuePages, realIssuesOnly } from './gh-issues.js'

export function cargarIssues({ repo, gh }) {
  // Una lectura fallida deja su array VACÍO y su motivo en la lista. Nunca al
  // revés: un array vacío sin motivo significaría "no hay issues", que es la
  // clase de degradación silenciosa que todo este módulo evita.
  const motivos = []
  // issues open con labels → {n, order, status, deps, touches, name, type, ac, issue}.
  // Enumeración vía el endpoint REST `gh api repos/<repo>/issues`, NUNCA el
  // índice de búsqueda (`--search`/`gh search issues`): tiene latencia de
  // indexado y podría no reflejar un label recién escrito por otro runner.
  // Tampoco `gh issue list --limit N` con un tope fijo (finding 2 de la
  // review final): ese endpoint devuelve más nuevo primero, así que un
  // `--limit` fijo deja fuera justo los issues VIEJOS — que son los que
  // suelen tener dependientes. Dos consecuencias silenciosas observadas: una
  // dependencia mergeada que cae fuera de `mergedIssues` deja un slice
  // permanentemente indespachable, y (en dispatch-check.mjs) un
  // `in-progress` colisionante que cae fuera de `allOpen()` hace que el lock
  // falle abierto. En su lugar usamos paginación real (`--paginate --slurp`,
  // sin tope) igual que ct-groom.mjs, y reutilizamos su mismo helper de
  // aplanado/filtrado de PRs (scripts/gh-issues.js) — ese endpoint también
  // devuelve pull requests (comparten namespace en la API v3). El mapeo en sí
  // (mapGhIssue/filterMergedIssues) es lógica pura extraída a
  // gh-issue-map.js — ver __tests__/gh-issue-map.test.js — para poder
  // testearla sin red y detectar una deriva de formato con groom.js.
  let abiertos = []
  try {
    // per_page=100 (re-review): el default REST es 30/página — con --paginate
    // igual se traen todos, pero a 3x más round-trips de los necesarios. 100
    // es el máximo que admite este endpoint.
    abiertos = realIssuesOnly(flattenIssuePages(JSON.parse(
      gh(['api', `repos/${repo}/issues`, '--method', 'GET', '-f', 'state=open', '-f', 'per_page=100', '--paginate', '--slurp']))))
  } catch (e) {
    motivos.push(`no se pudieron listar issues abiertos de ${repo}: ${e.message}`)
  }

  let cerrados = []
  try {
    // `body` es imprescindible aquí (no solo number,stateReason): es la única
    // forma de recuperar el marcador <!-- ct-order:N --> de un issue YA
    // CERRADO, y sin ese marcador buildDispatchInput no puede traducir un dep
    // en espacio de orden hacia el número de issue real de una dependencia
    // que ya se mergeó (ver gh-issue-map.js#buildOrderIndex).
    //
    // El campo de estado del endpoint REST es `state_reason`, en minúsculas
    // (p.ej. "completed") — DISTINTO del `stateReason` que expone `gh issue
    // list --json stateReason` vía GraphQL, en mayúsculas ("COMPLETED"), que
    // es lo que espera filterMergedIssues (ver gh-issue-map.js, verificado
    // contra gh 2.86). Normalizamos aquí, en el wrapper, para no tener que
    // enseñarle a la capa pura dos formatos de la misma cosa.
    const rawCerrados = realIssuesOnly(flattenIssuePages(JSON.parse(
      gh(['api', `repos/${repo}/issues`, '--method', 'GET', '-f', 'state=closed', '-f', 'per_page=100', '--paginate', '--slurp']))))
    cerrados = rawCerrados.map((i) => ({
      number: i.number,
      body: i.body,
      // milestone (D1 finding 1): buildOrderIndex necesita el milestone de
      // CUALQUIER issue, abierto o cerrado, para poder escanear el orden POR
      // EPIC en vez de globalmente al repo — sin esto, todo issue cerrado
      // caería en el bucket compartido NO_MILESTONE_KEY sin importar su
      // epic real, arriesgando una colisión FALSA entre dos epics distintos
      // que de verdad tienen milestones distintos (uno simplemente no viajó
      // hasta aquí).
      milestone: i.milestone || null,
      // labels (F18/H2): las labels de un issue CERRADO no se usaban para
      // nada y se tiraban aquí. Son las que revelan el estado contradictorio
      // "cerrado + `status:` viva" — el issue que se cayó de la cola de
      // despacho sin que nadie lo dijera. Viajan en esta MISMA respuesta REST:
      // conservarlas no cuesta ni una llamada más.
      labels: i.labels || [],
      stateReason: i.state_reason ? String(i.state_reason).toUpperCase() : null,
    }))
  } catch (e) {
    motivos.push(`no se pudieron listar issues cerrados de ${repo}: ${e.message}`)
  }

  return { abiertos, cerrados, motivos }
}
