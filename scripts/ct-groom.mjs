#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { parseSlices } from './slices.js'
import { groomPlan } from './groom.js'
import { flattenIssuePages, realIssuesOnly, findByMarker } from './gh-issues.js'
import { pickCurrentIteration, hasProjectItem } from './project-fields.js'

// `arg()` solo devuelve un string cuando el flag realmente trae un valor: si
// el flag es el último token de argv, o el token siguiente es a su vez otro
// flag (empieza por `--`), devolvemos `true` (presente-sin-valor) en vez de
// colarlo como valor. Mismo patrón que dispatch-check.mjs/ct-next.mjs — fix de
// la review final (finding 3): la versión anterior de este `arg()` tomaba
// literalmente `process.argv[i + 1]`, sin comprobar que fuera un valor real.
// Verificado en vivo contra el sandbox: `--milestone` como último token de
// argv hacía que `milestone` fuera el booleano `true`, y una corrida real
// entonces CREABA un milestone en GitHub literalmente titulado "true" y le
// enganchaba todos los issues del epic; `--milestone --dry-run` se comía el
// `--dry-run` como si fuera el valor del milestone; `--project` sin valor se
// convertía en `1` en el JSON del dry-run (`Number(true) === 1`). Los
// call-sites de milestone/project de más abajo, además de este endurecimiento
// del propio `arg()`, validan explícitamente que el valor recibido no sea
// `true` (presente-sin-valor) antes de usarlo.
const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}
const has = (flag) => process.argv.includes(flag)

const specFile = process.argv[2]
if (!specFile || specFile.startsWith('--')) { console.error('uso: ct-groom.mjs <spec> --repo <o/r> [--milestone t] [--project n] [--section 9] [--dry-run]'); process.exit(2) }
const repo = arg('--repo')
const milestone = arg('--milestone', 'Epic')
const section = arg('--section', '9')
const project = arg('--project')
const dryRun = has('--dry-run')

// Validación explícita: con el `arg()` endurecido de arriba, un `--milestone`
// colgante (último token, o seguido de otro flag) devuelve `true` en vez de
// colar el flag siguiente como valor — pero sigue siendo responsabilidad del
// call-site rechazarlo en vez de dejarlo fluir hacia `gh` como si fuera un
// título de milestone real.
if (milestone === true || typeof milestone !== 'string' || milestone.length === 0) {
  console.error(`--milestone requiere un valor: recibido "${milestone === true ? '(sin valor)' : milestone}"`)
  process.exit(2)
}
// Mismo criterio para --project: si se pasó el flag pero sin valor numérico
// real, abortamos en vez de dejar que `Number(true) === 1` decida en
// silencio contra qué Project v2 operar.
if (project !== undefined && (project === true || !Number.isFinite(Number(project)) || Number(project) <= 0)) {
  console.error(`--project inválido: "${project === true ? '(sin valor)' : project}" — debe ser un entero positivo`)
  process.exit(2)
}
// --repo: un `--repo` colgante (arg() endurecido) da `true`, no un string —
// `if (!repo)` de más abajo no lo detecta porque `true` es truthy. Menos
// peligroso que milestone/project (acaba en `gh api repos/true/...`, 404,
// aborta antes de mutar nada), pero inconsistente con ct-next.mjs/
// dispatch-check.mjs, que ya validan `typeof !== 'string'` en vez de un
// check solo-falsy. No exigimos --repo aquí (sigue siendo opcional en
// --dry-run, ver más abajo): solo rechazamos el caso "se pasó el flag pero
// sin valor real".
if (repo !== undefined && typeof repo !== 'string') {
  console.error('--repo inválido: "(sin valor)" — usa --repo <owner/repo>')
  process.exit(2)
}

let specMd
try {
  specMd = readFileSync(specFile, 'utf8')
} catch (e) {
  console.error(`no se pudo leer el spec: ${specFile} (${e.code || e.message})`)
  process.exit(2)
}
const slices = parseSlices(specMd)
const plan = groomPlan(slices, { milestone, specPath: specFile, specSection: section })

if (dryRun) {
  console.log(JSON.stringify({ ...plan, repo, project: project ? Number(project) : null }, null, 2))
  process.exit(0)
}

if (!repo) { console.error('--repo requerido fuera de --dry-run'); process.exit(2) }
// maxBuffer explícito (finding 7 de la review final): el default de Node para
// execFileSync es 1 MiB. El `--paginate` de más abajo sobre TODOS los issues y
// PRs de un repo (con bodies completos) puede superar eso con facilidad en un
// repo con unos pocos cientos de issues — Node aborta ruidosamente en vez de
// truncar en silencio (bien), pero eso haría /ct-groom inusable contra un
// repo real. 20 MiB es generoso para miles de issues/PRs con body completo
// sin ser "sin límite" de verdad (un runaway real seguiría abortando).
const GH_MAX_BUFFER = 20 * 1024 * 1024
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: GH_MAX_BUFFER }).trim()

// Project v2 + Sprint (T9): introspección en runtime, no se hardcodean IDs.
// Cada llamada de abajo se probó a mano contra un Project v2 real (sandbox)
// antes de cablearla aquí; ver task-9-report.md para las queries/mutaciones
// verificadas y sus respuestas reales.
const PROJECT_FIELDS_QUERY = `
query($id: ID!) {
  node(id: $id) {
    ... on ProjectV2 {
      fields(first: 50) {
        nodes {
          ... on ProjectV2IterationField {
            id
            name
            configuration {
              iterations { id title startDate duration }
            }
          }
        }
      }
    }
  }
}`

const SET_ITEM_ITERATION_MUTATION = `
mutation($project: ID!, $item: ID!, $field: ID!, $iteration: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $project
    itemId: $item
    fieldId: $field
    value: { iterationId: $iteration }
  }) {
    projectV2Item { id }
  }
}`

// Se resuelve una sola vez por ejecución (no por issue): el owner/projectId/
// fieldId/iterationId vigente son los mismos para todos los slices de esta
// tanda. Si el fetch falla, o el project no tiene un campo de iteración
// llamado "Sprint", o ninguna iteración cubre la fecha de hoy, abortamos —
// mismo criterio que milestones/issues más arriba: no hay caso benigno que
// tratar como "seguir sin Sprint".
let projectMeta = null
function ensureProjectMeta() {
  if (projectMeta) return projectMeta
  // TODO: asume que el Project v2 vive bajo el mismo owner que --repo. Un
  // project de organización sobre un repo de otro owner (o viceversa)
  // necesitaría un --project-owner explícito; no cubierto todavía.
  const owner = repo.split('/')[0]
  let view
  try {
    view = JSON.parse(gh(['project', 'view', String(project), '--owner', owner, '--format', 'json']))
  } catch (e) {
    console.error(`no se pudo leer el project ${project} (owner ${owner}): ${e.message}`)
    process.exit(1)
  }
  const projectId = view.id

  let fieldsRaw
  try {
    fieldsRaw = JSON.parse(gh(['api', 'graphql', '-f', `query=${PROJECT_FIELDS_QUERY}`, '-f', `id=${projectId}`]))
  } catch (e) {
    console.error(`no se pudieron leer los campos del project ${project}: ${e.message}`)
    process.exit(1)
  }
  const nodes = fieldsRaw?.data?.node?.fields?.nodes || []
  const sprintField = nodes.find((n) => n && n.name === 'Sprint')
  if (!sprintField) {
    console.error(`el project ${project} no tiene un campo de iteración llamado "Sprint" — créalo antes de usar --project`)
    process.exit(1)
  }
  const today = new Date().toISOString()
  const current = pickCurrentIteration(sprintField.configuration?.iterations, today)
  if (!current) {
    console.error(`el campo Sprint del project ${project} no tiene una iteración vigente para hoy (${today.slice(0, 10)})`)
    process.exit(1)
  }
  projectMeta = { owner, projectId, fieldId: sprintField.id, iterationId: current.id, iterationTitle: current.title }
  return projectMeta
}

// añade un issue (nuevo o preexistente, identificado por su URL) al Project
// v2 y fija su Sprint a la iteración vigente. Se llama tanto para issues
// creados en esta corrida como, más abajo, para issues preexistentes a los
// que les falte el item de project (ver hasProjectItem): el alta del issue y
// el alta en el project son dos llamadas de red desacopladas (a diferencia
// de las labels, que van dentro de `gh issue create` y no pueden quedar a
// medias), así que una interrupción entre ambas dejaría el issue fuera del
// project para siempre si no se re-comprobara en cada corrida.
function addToProjectWithSprint(issueUrl, order) {
  const meta = ensureProjectMeta()
  let item
  try {
    item = JSON.parse(gh(['project', 'item-add', String(project), '--owner', meta.owner, '--url', issueUrl, '--format', 'json']))
  } catch (e) {
    console.error(`no se pudo añadir el issue orden #${order} al project ${project}: ${e.message}`)
    process.exit(1)
  }
  try {
    gh(['api', 'graphql', '-f', `query=${SET_ITEM_ITERATION_MUTATION}`,
      '-f', `project=${meta.projectId}`, '-f', `item=${item.id}`,
      '-f', `field=${meta.fieldId}`, '-f', `iteration=${meta.iterationId}`])
  } catch (e) {
    console.error(`no se pudo fijar el Sprint del issue orden #${order} en el project ${project}: ${e.message}`)
    process.exit(1)
  }
  console.log(`issue orden #${order} añadido al project ${project}, sprint=${meta.iterationTitle}`)
}

// milestone idempotente — el filtrado por título se hace en JS, no dentro de un
// filtro jq: un título con `"` o `\` rompería el programa jq si se interpolara
// ahí. Traemos la lista completa (paginada, todos los estados: el endpoint
// filtra a "open" por defecto y un milestone cerrado con el mismo título
// causaría un duplicado) y comparamos en memoria. Si el fetch falla (auth,
// red, rate limit) abortamos — NO lo tratamos como "no existe", o
// terminaríamos creando un milestone duplicado.
let allMilestones
try {
  allMilestones = JSON.parse(gh(['api', `repos/${repo}/milestones`, '--method', 'GET', '-f', 'state=all', '--paginate']))
} catch (e) {
  console.error(`no se pudo listar milestones de ${repo}: ${e.message}`)
  process.exit(1)
}
let msNumber = allMilestones.find((m) => m.title === milestone)?.number
if (!msNumber) {
  const created = JSON.parse(gh(['api', `repos/${repo}/milestones`, '-f', `title=${milestone}`]))
  msNumber = created.number
  console.log(`milestone creado: ${milestone} (#${msNumber})`)
} else console.log(`milestone ya existe: ${milestone} (#${msNumber})`)

// labels que falten. Con --force, "ya existe" no es un error para gh (lo
// actualiza), así que no hay caso benigno que capturar aquí: cualquier fallo
// es real (auth, red, rate limit) y debe abortar el script en vez de dejar
// issues sin sus labels.
const wantedLabels = [...new Set(plan.issues.flatMap((i) => i.labels))]
for (const l of wantedLabels) {
  gh(['label', 'create', l, '--repo', repo, '--force'])
}

// issues idempotentes por marcador ct-order. NO usamos `gh issue list --search`:
// la búsqueda de GitHub tokeniza por espacios y trata un `-` inicial como
// cualificador de exclusión, así que el marcador `<!-- ct-order:N -->` no hace
// matching de substring fiable, y el índice de búsqueda tiene latencia para
// issues recién creados (falso negativo → duplicado; falso positivo → un
// slice que debía crearse se salta en silencio). En su lugar, enumeramos TODOS
// los issues, con paginación real (`--paginate`, sin tope de `--limit`) sobre
// el endpoint REST — un `--limit` fijo dejaría fuera issues antiguos con
// marcador en un repo grande, reintroduciendo el mismo fallo por truncado en
// vez de por latencia. Ese endpoint también devuelve pull requests y, sin
// `--slurp`, `--paginate` concatenaría varios documentos JSON sueltos que
// romperían el `JSON.parse`; ver scripts/gh-issues.js para el detalle y los
// tests puros de ese filtrado/aplanado. Comparamos el marcador como substring
// literal del body en JS — mismo patrón que el fix de milestones. Un fallo
// del fetch aborta.
let existingIssues
try {
  const raw = JSON.parse(gh(['api', `repos/${repo}/issues`, '--method', 'GET', '-f', 'state=all', '--paginate', '--slurp']))
  existingIssues = realIssuesOnly(flattenIssuePages(raw))
} catch (e) {
  console.error(`no se pudo listar issues de ${repo}: ${e.message}`)
  process.exit(1)
}

// Items ya presentes en el Project v2 — se listan una sola vez por corrida
// (igual que milestones/existingIssues arriba) para poder detectar issues
// preexistentes a los que, por una interrupción previa, les falte el item
// de project (ver hasProjectItem en project-fields.js). --limit alto: el
// default de `gh project item-list` es 30, insuficiente en un sandbox/epic
// con más slices que eso.
let existingProjectItems = []
if (project) {
  ensureProjectMeta()
  try {
    const itemsRaw = JSON.parse(gh(['project', 'item-list', String(project), '--owner', projectMeta.owner, '--limit', '200', '--format', 'json']))
    existingProjectItems = itemsRaw.items || []
  } catch (e) {
    console.error(`no se pudieron listar los items del project ${project}: ${e.message}`)
    process.exit(1)
  }
}

for (const iss of plan.issues) {
  const marker = `<!-- ct-order:${iss.order} -->`
  const found = findByMarker(existingIssues, marker)
  if (found) {
    console.log(`issue orden #${iss.order} ya existe (#${found.number}), no se duplica`)
    if (project && !hasProjectItem(existingProjectItems, repo, found.number)) {
      console.log(`issue #${found.number} no estaba en el project ${project} (hueco de una corrida anterior interrumpida) — añadiéndolo ahora`)
      addToProjectWithSprint(`https://github.com/${repo}/issues/${found.number}`, iss.order)
    }
    continue
  }
  const num = gh(['issue', 'create', '--repo', repo, '--title', iss.title, '--body', iss.body,
    '--milestone', milestone, ...iss.labels.flatMap((l) => ['--label', l])])
  console.log(`issue creado orden #${iss.order}: ${num}`)
  // registra el issue recién creado en la lista en memoria: si dos slices de
  // esta misma ejecución compartieran marcador (no debería pasar, pero así la
  // comprobación de arriba sigue siendo correcta dentro de la misma corrida)
  existingIssues.push({ number: null, body: iss.body })
  if (project) addToProjectWithSprint(num, iss.order)
}
