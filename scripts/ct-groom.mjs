#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { parseSlices } from './slices.js'
import { groomPlan } from './groom.js'

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

const specMd = readFileSync(specFile, 'utf8')
const slices = parseSlices(specMd)
const plan = groomPlan(slices, { milestone, specPath: specFile, specSection: section })

if (dryRun) {
  console.log(JSON.stringify({ ...plan, repo, project: project || null }, null, 2))
  process.exit(0)
}

if (!repo) { console.error('--repo requerido fuera de --dry-run'); process.exit(2) }
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

// milestone idempotente — el filtrado por título se hace en JS, no dentro de un
// filtro jq: un título con `"` o `\` rompería el programa jq si se interpolara
// ahí. Traemos la lista completa (paginada) y comparamos en memoria.
let msNumber
try {
  const all = JSON.parse(gh(['api', `repos/${repo}/milestones`, '--paginate']))
  msNumber = all.find((m) => m.title === milestone)?.number
} catch { /* ninguno */ }
if (!msNumber) {
  const created = JSON.parse(gh(['api', `repos/${repo}/milestones`, '-f', `title=${milestone}`]))
  msNumber = created.number
  console.log(`milestone creado: ${milestone} (#${msNumber})`)
} else console.log(`milestone ya existe: ${milestone} (#${msNumber})`)

// labels que falten (idempotente: gh label create ignora si existe con || true)
const wantedLabels = [...new Set(plan.issues.flatMap((i) => i.labels))]
for (const l of wantedLabels) {
  try { gh(['label', 'create', l, '--repo', repo, '--force']) } catch { /* existe */ }
}

// issues idempotentes por marcador ct-order
for (const iss of plan.issues) {
  const marker = `<!-- ct-order:${iss.order} -->`
  const found = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'all', '--search', marker, '--json', 'number', '--limit', '5']))
  if (found.length) { console.log(`issue orden #${iss.order} ya existe (#${found[0].number}), no se duplica`); continue }
  const num = gh(['issue', 'create', '--repo', repo, '--title', iss.title, '--body', iss.body,
    '--milestone', milestone, ...iss.labels.flatMap((l) => ['--label', l])])
  console.log(`issue creado orden #${iss.order}: ${num}`)
  if (project) {
    // Project v2 + Sprint: se implementa en T9 (requiere introspección graphql
    // contra un Project v2 real para descubrir field/iteration IDs en runtime;
    // ver NOTA de introspección en el brief de T5, §7).
  }
}
