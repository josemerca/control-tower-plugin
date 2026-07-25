#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { selectNext, resolveAccount, buildCmuxArgv } from './dispatch.js'
import { renderKickoff, buildStateSeed, ACCOUNT_MAP } from './kickoff.js'
import { shQuote } from './shquote.js'

// `arg()` solo devuelve un string cuando el flag realmente trae un valor: si
// el flag es el último token de argv, o el token siguiente es a su vez otro
// flag (empieza por `--`), devolvemos `true` (presente-sin-valor) en vez de
// colarlo como valor. Mismo patrón que dispatch-check.mjs/ct-groom.mjs — un
// `--repo` colgante nunca llega a `execFileSync` como valor real.
const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}
const has = (f) => process.argv.includes(f)

const usage = 'uso: ct-next.mjs --repo <o/r> [--cap N] [--dry-run]'
const repo = arg('--repo')
const capArg = arg('--cap', '1')
const dryRun = has('--dry-run')

if (typeof repo !== 'string' || repo.length === 0) { console.error(usage); process.exit(2) }
const cap = typeof capArg === 'string' ? parseInt(capArg, 10) : NaN
if (!Number.isFinite(cap) || cap < 1) {
  console.error(`--cap inválido: "${capArg === true ? '(sin valor)' : capArg}" — debe ser un entero >= 1`)
  process.exit(2)
}

// CT_NEXT_FIXTURE es exclusivamente para tests (ver
// __tests__/ct-next-dryrun.test.js). Mismo patrón que T7 (dispatch-check.mjs)
// para el mismo peligro: si queda colgada en el entorno SIN --dry-run, el
// script NO debe decidir con datos fabricados ni, sobre todo, crear un
// worktree real / sembrar STATE.md / lanzar cmux con ese estado inventado.
// Se trata como error de uso y abortamos ANTES de tocar gh o el filesystem.
if (process.env.CT_NEXT_FIXTURE && !dryRun) {
  console.error('CT_NEXT_FIXTURE está definido pero falta --dry-run: por seguridad no se decide ni se lanza nada real con datos de fixture. Añade --dry-run o limpia la variable de entorno.')
  process.exit(2)
}
// Atado también en la propia lectura (defensa en profundidad): `fx` solo
// puede ser no-nulo cuando `dryRun` es cierto.
const fx = (dryRun && process.env.CT_NEXT_FIXTURE) ? JSON.parse(process.env.CT_NEXT_FIXTURE) : null

const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

// Extrae la lista de acceptance criteria del body que genera
// groom.js#buildIssueBody bajo "## Acceptance criteria" (líneas "- ..."),
// ignorando el placeholder "(rellenar desde el spec)". Un issue que no venga
// de ct-groom (creado a mano, sin esa sección) cae al array vacío — nunca
// undefined, para que renderKickoff/buildStateSeed (que indexan slice.ac como
// array) no revienten.
function extractAc(body) {
  if (!body) return []
  const m = body.match(/## Acceptance criteria[^\n]*\n([\s\S]*?)(\n##\s|\n<!--|$)/)
  if (!m) return []
  return m[1].split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter((l) => l && l !== '(rellenar desde el spec)')
}

function loadIssues() {
  if (fx) return fx
  // issues open con labels → {n, order, status, deps, touches, entrega, type, ac, issue}.
  // Enumeración directa vía `gh issue list --state open`, NUNCA el índice de
  // búsqueda (`--search`/`gh search issues`): tiene latencia de indexado y
  // podría no reflejar un label recién escrito por otro runner. Filtrado por
  // labels/marcadores enteramente client-side, en JS.
  let raw
  try {
    raw = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'open', '--limit', '200',
      '--json', 'number,title,labels,body']))
  } catch (e) {
    console.error(`no se pudieron listar issues abiertos de ${repo}: ${e.message}`)
    process.exit(1)
  }
  const issues = raw.map((i) => {
    const labels = i.labels.map((l) => l.name)
    const status = (labels.find((l) => l.startsWith('status:')) || 'status:backlog').slice('status:'.length)
    const touches = labels.filter((l) => l.startsWith('touches:')).map((l) => l.slice('touches:'.length))
    const type = (labels.find((l) => l.startsWith('type:')) || 'type:').slice('type:'.length)
    const orderM = i.body && i.body.match(/ct-order:(\d+)/)
    const deps = [...(i.body || '').matchAll(/merge-after #(\d+)/g)].map((m) => parseInt(m[1], 10))
    return {
      n: i.number,
      order: orderM ? parseInt(orderM[1], 10) : i.number,
      status,
      deps,
      touches,
      type,
      entrega: i.title.replace(/^#\d+\s*/, ''),
      ac: extractAc(i.body),
      issue: `#${i.number}`,
    }
  })
  // mergedIssues: issues cerrados cuyo PR se mergeó (aproximación: closed con
  // stateReason COMPLETED). Verificado contra gh 2.86 (`gh issue list --json
  // bogus` lista los campos válidos sin tocar red): el campo se llama
  // `stateReason`, tal cual, y gh lo expone en el casing del enum GraphQL
  // (mayúsculas: "COMPLETED", "NOT_PLANNED", …) — el filtro del brief matchea.
  let closed
  try {
    closed = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'closed', '--limit', '200', '--json', 'number,stateReason']))
  } catch (e) {
    console.error(`no se pudieron listar issues cerrados de ${repo}: ${e.message}`)
    process.exit(1)
  }
  const mergedIssues = closed.filter((i) => i.stateReason === 'COMPLETED' || i.stateReason === 'completed').map((i) => i.number)
  return { issues, mergedIssues }
}

const { issues, mergedIssues } = loadIssues()
const selected = selectNext(issues, { mergedIssues, runningTouches: [], concurrencyCap: cap })
if (!selected.length) {
  console.log('No hay slices despachables (nada ready con deps mergeadas y sin colisión).')
  process.exit(0)
}

const repoName = repo.split('/').pop()
const configDir = resolveAccount(repoName, ACCOUNT_MAP)

let repoRoot
if (fx) {
  // Solo se usa para construir strings en la rama --dry-run (el fixture está
  // atado a --dry-run más arriba): nunca llega a un `git worktree add` real.
  repoRoot = '/tmp/fake-repo'
} else {
  try {
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  } catch (e) {
    console.error(`no se pudo resolver la raíz del repo git local: ${e.message}`)
    process.exit(1)
  }
}

for (const s of selected) {
  const branch = `feat/${s.n}`
  const wt = `${repoRoot}/.worktrees/${s.n}`
  const name = `${repoName} · #${s.n} ${s.entrega}`
  // Normaliza ac/issue por si el slice viene de un fixture de test (como el
  // del brief) que no los trae: renderKickoff/buildStateSeed indexan
  // slice.ac como array y usan slice.issue con `??`/`||` — sin este default
  // revientan con un TypeError en vez de imprimir el plan.
  const sliceForKickoff = { ...s, ac: s.ac || [], issue: s.issue ?? null }
  const kickoff = renderKickoff(sliceForKickoff, { repo })
  const stateSeed = buildStateSeed(sliceForKickoff, { branch, base: 'main' })
  // Override 1 (shell quoting): --command es UN argv element (buildCmuxArgv
  // ya lo garantiza), pero la STRING dentro de ese argv element es una línea
  // de comando que cmux ejecuta vía shell. `JSON.stringify` es escapado JSON,
  // no de shell — un `$`, un backtick o un `\` en el kickoff seguirían
  // interpretándose dentro de las comillas dobles. shQuote() hace el
  // escapado POSIX real (comillas simples).
  const command = `claude --dangerously-skip-permissions ${shQuote(kickoff)}`
  const cmuxArgv = buildCmuxArgv({ name, cwd: wt, command })

  if (dryRun) {
    console.log(`\n=== slice #${s.n} (${s.entrega}) ===`)
    console.log(`CLAUDE_CONFIG_DIR=${configDir}`)
    console.log(`git worktree add -b ${branch} ${wt} main`)
    console.log(`seed ${wt}/.agent/STATE.md:\n${stateSeed}`)
    console.log(`cmux ${cmuxArgv.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`)
    continue
  }

  try {
    execFileSync('git', ['worktree', 'add', '-b', branch, wt, 'main'], { cwd: repoRoot, stdio: 'inherit' })
  } catch (e) {
    // Si el worktree o la rama ya existen, `git worktree add` falla con
    // exit != 0 — lo dejamos fallar ruidoso en vez de reusar en silencio
    // algo que podría no corresponder a este slice.
    console.error(`no se pudo crear el worktree para #${s.n} en ${wt}: ${e.message}`)
    process.exit(1)
  }
  try {
    mkdirSync(`${wt}/.agent`, { recursive: true })
    writeFileSync(`${wt}/.agent/STATE.md`, stateSeed)
  } catch (e) {
    console.error(`no se pudo sembrar .agent/STATE.md en ${wt}: ${e.message}`)
    process.exit(1)
  }
  try {
    execFileSync('cmux', cmuxArgv, { env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }, stdio: 'inherit' })
  } catch (e) {
    console.error(`no se pudo lanzar cmux para #${s.n}: ${e.message}`)
    process.exit(1)
  }
  console.log(`lanzado #${s.n} en ${wt} (cuenta ${configDir})`)
}
