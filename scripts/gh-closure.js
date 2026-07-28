// ============================================================================
// gh-closure.js — QUIÉN CERRÓ CADA ISSUE, Y QUÉ RAMA SE MERGEÓ DE VERDAD.
//
// F18/H1. Hasta esta ronda, el contrato de la §9 (ct-init.sh) justificaba NO
// comprobar el cierre de un issue así:
//
//   «cerrar a mano como *completed* sin haber mergeado nada SÍ satisface la
//    dep […] Eso no se detecta — haría falta cruzar el grafo de PRs (GraphQL,
//    UNA LLAMADA POR ISSUE CERRADO) para blindar un caso que requiere una
//    ACCIÓN ERRÓNEA DELIBERADA.»
//
// Los dos términos de ese cálculo eran falsos, y los dos se han medido, no
// deducido:
//
//   (a) NO REQUIERE ACCIÓN DELIBERADA. Un commit de DOCUMENTACIÓN cuyo cuerpo
//       contenía la cadena `Closes #451` —dentro de una frase que explicaba
//       precisamente que el kickoff NO llevaba esa keyword— cerró el issue
//       #451 de un repo de producción. GitHub parsea closing keywords en los
//       mensajes de commit que llegan a la rama por defecto, y las comillas
//       NO protegen. Verificado en el timeline del propio issue: el
//       `ClosedEvent` tiene `closer.__typename = "Commit"`, oid c4b0da66,
//       headline «docs(loop): #37-#46 cerrados como completed…». Nadie quiso
//       cerrar nada.
//
//   (b) NO CUESTA UNA LLAMADA POR ISSUE. Una sola query GraphQL con alias
//       resuelve N issues de golpe. Medido contra ese mismo repo el
//       28-jul-2026: 97 issues cerrados en UNA llamada, query de 18,8 KB,
//       2,8 s de reloj (10 issues: 0,87 s). El coste era una suposición.
//
// PERO la misma medición mató la idea obvia (usar el closer como GATE de
// `merge-after`), y esto es lo importante: de esos 97 issues cerrados como
// *completed*, **86 no tienen closer en absoluto** — los cerró una persona a
// mano. Solo 11 los cerró un PR. Cerrar a mano NO es la anomalía: es la
// práctica mayoritaria, y además es un paso PRESCRITO por el propio contrato
// (con `--base <otra-rama>`, el `Closes #N` no cierra nada y el contrato
// manda cerrar a mano con `gh issue close --reason completed`). Un gate sobre
// "cerrado por PR mergeado" habría dejado 86 dependencias sin satisfacer de
// golpe en ese repo: habría ladrillado el epic entero por hacer lo correcto.
//
// LO QUE SÍ SE PUEDE AFIRMAR, y es lo único que se afirma aquí: un issue
// cerrado por un COMMIT que no pertenece a ningún PR mergeado es un cierre
// que NADIE revisó — nadie mergeó nada, no hubo gate humano, y basta con que
// la cadena `Closes #N` aparezca en cualquier mensaje de commit que llegue a
// la rama por defecto. Es exactamente el caso de campo. Discriminante
// verificado sobre datos reales: el commit del accidente tiene
// `associatedPullRequests: []`, mientras que un cierre normal del mismo repo
// (#54) trae `closer.__typename = "PullRequest", merged: true`.
//
// Y ES UN AVISO, NUNCA UN GATE. No cambia ninguna decisión de despacho: si la
// consulta falla, se dice y se sigue. Un detector que puede equivocarse no
// puede tener poder de veto sobre el trabajo.
//
// F18/H4 va en la MISMA llamada, con coste de red marginal CERO: la rama de
// un slice es determinista (`feat/<n>`), así que un alias más por cada issue
// en `status:in-review` convierte la disyuntiva que hoy dice el dispatcher
// («o el PR se mergeó y nadie cerró el issue, o…») en un hecho comprobado.
// Ojo con la dirección: esta comprobación CONFIRMA, no refuta — que no haya
// PR mergeado con head `feat/<n>` no prueba que no se mergeara el trabajo
// (pudo salir por una rama con otro nombre), así que el silencio no se
// reporta como "no se mergeó".
// ============================================================================

// Tope de issues por consulta. La medición real (97 alias, 18,8 KB, 2,8 s)
// dice que 60 va sobrado; el tope existe para que un repo con cientos de
// slices no construya una query desmesurada en el camino crítico del
// dispatcher. Lo que queda fuera se DICE (ver formatClosureCoverageNote):
// nunca se recorta en silencio.
export const CLOSURE_PROBE_MAX = 60

// Prefijos de alias. GraphQL no admite alias que empiecen por dígito.
const DEP_ALIAS = 'dep'
const REVIEW_ALIAS = 'rev'

/**
 * planClosureProbe: decide QUÉ preguntar, a partir de lo que ya se sabe sin
 * red. Dos conjuntos, ninguno de ellos "todos los issues cerrados":
 *
 *   - `deps`: issues cerrados que AHORA MISMO están satisfaciendo un
 *     `merge-after` de algún issue abierto. Preguntar por un issue cerrado
 *     del que no cuelga nada no cambiaría ninguna decisión de nadie.
 *   - `inReview`: issues abiertos en `status:in-review`, para el backstop de
 *     "PR mergeado, issue abierto" (H4).
 *
 * `dependents` conserva quién depende de cada dep: sin eso, el aviso diría
 * "ojo con #451" sin decir a quién le afecta, que es la mitad que importa.
 */
export function planClosureProbe({ issues, mergedIssues } = {}) {
  const merged = new Set(mergedIssues || [])
  const dependents = new Map()
  for (const i of issues || []) {
    for (const d of i.deps || []) {
      if (d == null || !merged.has(d)) continue
      if (!dependents.has(d)) dependents.set(d, [])
      if (!dependents.get(d).includes(i.n)) dependents.get(d).push(i.n)
    }
  }
  const deps = [...dependents.keys()].sort((a, b) => a - b)
  const inReview = (issues || []).filter((i) => i.status === 'in-review').map((i) => i.n).sort((a, b) => a - b)
  return { deps, inReview, dependents }
}

/**
 * buildClosureQuery: la query, o `null` si no hay nada que preguntar (repo
 * sin deps satisfechas y sin nada en revisión) — en ese caso NO se hace
 * ninguna llamada.
 *
 * `owner`/`name` se interpolan entre comillas: `parseRepoSlug` (dispatch.js)
 * ya ha rechazado cualquier slug que no sea `owner/repo` con ambas mitades no
 * vacías antes de llegar aquí, y ese formato no admite comillas ni barras
 * invertidas. Aun así se escapan, porque una query GraphQL rota por una
 * comilla es un fallo silencioso de red y no un error de uso.
 */
export function buildClosureQuery(repo, plan, limit = CLOSURE_PROBE_MAX) {
  const [owner, name] = String(repo || '').split('/')
  if (!owner || !name) return null
  const deps = (plan?.deps || []).slice(0, limit)
  const inReview = (plan?.inReview || []).slice(0, limit)
  if (!deps.length && !inReview.length) return null
  const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const depFields = deps.map((n) => `${DEP_ALIAS}${n}: issue(number:${n}) { number timelineItems(last:1, itemTypes:[CLOSED_EVENT]) { nodes { ... on ClosedEvent { closer { __typename ... on PullRequest { number merged } ... on Commit { oid messageHeadline associatedPullRequests(first:2) { nodes { number merged } } } } } } } }`)
  const revFields = inReview.map((n) => `${REVIEW_ALIAS}${n}: pullRequests(headRefName:"feat/${n}", states:[MERGED], first:1) { nodes { number mergedAt } }`)
  return `{ repository(owner:"${q(owner)}", name:"${q(name)}") { ${[...depFields, ...revFields].join(' ')} } }`
}

/**
 * parseClosureProbe: la respuesta → dos mapas, sin inventar nada.
 *
 *   closers[n] = { kind, ... } con kind ∈
 *     'pull-request' (+ pr, merged) | 'commit' (+ oid, headline, prs[])
 *     | 'manual'  (hubo ClosedEvent pero sin closer: lo cerró una persona)
 *     | 'unknown' (el alias no vino, o vino sin ClosedEvent: NO se afirma nada)
 *   mergedPr[n] = { number, mergedAt }  — solo si de verdad hay uno.
 *
 * Un alias ausente es 'unknown' y NO 'manual': la diferencia es toda la
 * diferencia entre "consta que lo cerró una persona" y "no lo sabemos".
 */
export function parseClosureProbe(raw, plan) {
  const repoData = raw?.data?.repository ?? null
  const closers = {}
  const mergedPr = {}
  for (const n of plan?.deps || []) {
    const node = repoData ? repoData[`${DEP_ALIAS}${n}`] : undefined
    if (!node) { closers[n] = { kind: 'unknown' }; continue }
    const ev = (node.timelineItems?.nodes || []).filter(Boolean).pop()
    if (!ev) { closers[n] = { kind: 'unknown' }; continue }
    const c = ev.closer
    if (!c) { closers[n] = { kind: 'manual' }; continue }
    if (c.__typename === 'PullRequest') {
      closers[n] = { kind: 'pull-request', pr: c.number ?? null, merged: c.merged === true }
    } else if (c.__typename === 'Commit') {
      const prs = (c.associatedPullRequests?.nodes || []).filter(Boolean)
      closers[n] = {
        kind: 'commit',
        oid: typeof c.oid === 'string' ? c.oid : '',
        headline: typeof c.messageHeadline === 'string' ? c.messageHeadline : '',
        mergedPrs: prs.filter((p) => p.merged === true).map((p) => p.number),
      }
    } else {
      closers[n] = { kind: 'unknown' }
    }
  }
  for (const n of plan?.inReview || []) {
    const node = repoData ? repoData[`${REVIEW_ALIAS}${n}`] : undefined
    const pr = (node?.nodes || []).filter(Boolean)[0]
    if (pr && Number.isInteger(pr.number)) mergedPr[n] = { number: pr.number, mergedAt: pr.mergedAt ?? null }
  }
  return { closers, mergedPr }
}

const shortOid = (oid) => (typeof oid === 'string' ? oid.slice(0, 8) : '')

/**
 * formatSuspectClosureWarnings: SOLO los cierres que nadie revisó.
 *
 * Qué NO sale por aquí, y por qué:
 *   - `manual` (86 de 97 en el repo medido): cerrar a mano es la práctica
 *     mayoritaria Y un paso prescrito por el contrato cuando la base no es la
 *     rama por defecto. Avisar de eso sería avisar de lo normal, y un aviso
 *     que sale 86 veces no lo lee nadie;
 *   - `pull-request` con `merged: true`: el camino feliz;
 *   - `unknown`: no se afirma lo que no se ha visto. La cobertura incompleta
 *     se dice aparte (formatClosureCoverageNote), no como sospecha.
 */
export function formatSuspectClosureWarnings(closers, dependents) {
  const out = []
  for (const [key, c] of Object.entries(closers || {})) {
    const n = Number(key)
    const deps = (dependents instanceof Map ? dependents.get(n) : (dependents || {})[n]) || []
    const quien = deps.length ? `${deps.map((d) => `#${d}`).join(', ')}` : 'algún slice'
    if (c.kind === 'commit' && c.mergedPrs.length === 0) {
      out.push(`#${n} consta cerrado como *completed* por el COMMIT ${shortOid(c.oid)}${c.headline ? ` («${c.headline}»)` : ''}, que no pertenece a ningún PR mergeado — nadie revisó ni mergeó nada para cerrarlo. GitHub cierra un issue con una closing keyword en CUALQUIER mensaje de commit que llegue a la rama por defecto, incluido un commit que solo la MENCIONA (las comillas no protegen; ocurrió así en un repo real con un commit de documentación). Y ${quien} depende de #${n} con "merge-after": esa dependencia se está dando por satisfecha sobre un trabajo que puede no existir. Comprueba #${n} ANTES de despachar a quien depende de él; si el trabajo no está, reabre #${n} (\`gh issue reopen ${n}\`).`)
    } else if (c.kind === 'pull-request' && c.merged === false) {
      out.push(`#${n} consta cerrado como *completed* por el PR #${c.pr}, pero ese PR NO está mergeado — la dependencia de ${quien} se da por satisfecha sobre trabajo que no ha entrado en ninguna rama. Comprueba #${n} antes de despachar a quien depende de él.`)
    }
  }
  return out
}

/**
 * formatMergedButOpenWarnings (H4): la disyuntiva convertida en hecho.
 *
 * Los mensajes de bloqueo de ct-next.mjs dicen «mergea su PR — o, si el PR ya
 * se mergeó y el issue sigue abierto, ciérralo». Cuál de las dos es cierta lo
 * tenía que averiguar el humano mirando GitHub. Cuando la rama determinista
 * `feat/<n>` SÍ tiene un PR mergeado, aquí se dice cuál y desde cuándo.
 */
export function formatMergedButOpenWarnings(mergedPr, repo) {
  return Object.entries(mergedPr || {}).map(([key, pr]) => {
    const n = Number(key)
    const cuando = pr.mergedAt ? ` (mergeado el ${String(pr.mergedAt).slice(0, 10)})` : ''
    return `#${n} sigue en status:in-review, pero su rama feat/${n} YA está mergeada en el PR #${pr.number}${cuando}: su trabajo está en la base y el issue se quedó abierto —el \`Closes #${n}\` no llegó a aplicarse (o el PR se mergeó en una rama que no es la por defecto)—. Mientras siga abierto retiene sus tokens de área/touches y ningún "merge-after" sobre él cuenta como satisfecho. Ciérralo: \`gh issue close ${n} --repo ${repo} --reason completed\`.`
  })
}

/**
 * formatClosureCoverageNote: si el tope recortó la consulta, se dice qué
 * quedó SIN mirar. Un detector que calla su propia cobertura se lee como
 * "todo comprobado, nada que reportar", que es justo la mentira que esta
 * ronda persigue.
 */
export function formatClosureCoverageNote(plan, limit = CLOSURE_PROBE_MAX) {
  const fuera = Math.max(0, (plan?.deps || []).length - limit) + Math.max(0, (plan?.inReview || []).length - limit)
  if (fuera === 0) return null
  return `la comprobación de cómo se cerró cada dependencia (y de si la rama de un slice en revisión ya está mergeada) se ha limitado a ${limit} issues por consulta: ${fuera} han quedado SIN mirar en esta corrida. No es "están bien": es "no se han comprobado".`
}
