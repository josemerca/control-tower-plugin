#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { parseSlices } from './slices.js'
import { groomPlan } from './groom.js'
import { flattenIssuePages, realIssuesOnly, findByMarker } from './gh-issues.js'

function arg(flag, def = undefined) {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? (process.argv[i + 1] ?? true) : def
}
const has = (flag) => process.argv.includes(flag)

const specFile = process.argv[2]
if (!specFile || specFile.startsWith('--')) { console.error('uso: ct-groom.mjs <spec> --repo <o/r> [--milestone t] [--project n] [--section 9] [--dry-run]'); process.exit(2) }
const repo = arg('--repo')
const milestone = arg('--milestone', 'Epic')
const section = arg('--section', '9')
const project = arg('--project')
const dryRun = has('--dry-run')

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
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

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

for (const iss of plan.issues) {
  const marker = `<!-- ct-order:${iss.order} -->`
  const found = findByMarker(existingIssues, marker)
  if (found) { console.log(`issue orden #${iss.order} ya existe (#${found.number}), no se duplica`); continue }
  const num = gh(['issue', 'create', '--repo', repo, '--title', iss.title, '--body', iss.body,
    '--milestone', milestone, ...iss.labels.flatMap((l) => ['--label', l])])
  console.log(`issue creado orden #${iss.order}: ${num}`)
  // registra el issue recién creado en la lista en memoria: si dos slices de
  // esta misma ejecución compartieran marcador (no debería pasar, pero así la
  // comprobación de arriba sigue siendo correcta dentro de la misma corrida)
  existingIssues.push({ number: null, body: iss.body })
  if (project) {
    // Project v2 + Sprint: se implementa en T9 (requiere introspección graphql
    // contra un Project v2 real para descubrir field/iteration IDs en runtime;
    // ver NOTA de introspección en el brief de T5, §7).
  }
}
