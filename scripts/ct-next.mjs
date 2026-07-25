#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { planDispatch, resolveAccount, buildCmuxArgv } from './dispatch.js'
import { renderKickoff, buildStateSeed, ACCOUNT_MAP } from './kickoff.js'
import { shQuote } from './shquote.js'
import { buildDispatchInput } from './gh-issue-map.js'
import { flattenIssuePages, realIssuesOnly } from './gh-issues.js'

// W-C: dispatch-check.mjs implementa el protocolo de claim completo (colisión
// + escritura + claim-then-verify) y ya está testeado en solitario, pero
// hasta ahora nada en el plugin lo invocaba — ningún issue llegaba nunca a
// status:in-progress en el loop real, así que el `runningTouches` del que
// depende W-B (para el cap y la colisión con trabajo en vuelo) estaba siempre
// vacío. Se resuelve la ruta SIEMPRE relativa a la propia ubicación de este
// fichero (import.meta.url, la URL real de ESTE módulo) — nunca una ruta
// absoluta fija ni un string de shell — porque dispatch-check.mjs vive al
// lado de ct-next.mjs dentro del plugin, con independencia de dónde esté
// instalado.
const dispatchCheckPath = join(dirname(fileURLToPath(import.meta.url)), 'dispatch-check.mjs')

// Fix round 1 (review de W-C), finding 2 — IMPORTANT: Node sale con exit 1
// (MODULE_NOT_FOUND) cuando el fichero que se le pide ejecutar no existe —
// el MISMO código que dispatch-check.mjs usa para "colisión/carrera
// perdida" (ver el contrato de exit codes en su cabecera). Sin este guard,
// un dispatch-check.mjs ausente o renombrado (plugin mal instalado o
// incompleto) haría que attemptClaim() lo clasificara como un resultado
// ESPERADO del protocolo: TODOS los slices de la tanda se saltarían
// ("saltando #N...") y el proceso terminaría con exit 0 sin haber
// despachado nada — un no-op silencioso, además de contradecir el propio
// mensaje de "fallo inesperado" de más abajo (que ya afirma cubrir este
// caso). Se comprueba UNA vez al arrancar, antes de tocar `gh` o crear nada.
if (!existsSync(dispatchCheckPath)) {
  console.error(`no se encontró dispatch-check.mjs en ${dispatchCheckPath} — el plugin parece estar incompleto o mal instalado (¿se movió/borró el fichero?). Abortando antes de intentar ningún claim: sin él, cada slice se leería en falso como "colisión" y la tanda entera terminaría en un no-op silencioso.`)
  process.exit(1)
}

// `arg()` solo devuelve un string cuando el flag realmente trae un valor: si
// el flag es el último token de argv, o el token siguiente es a su vez otro
// flag (empieza por `--`), devolvemos `true` (presente-sin-valor) en vez de
// colarlo como valor. Mismo patrón que dispatch-check.mjs — ct-groom.mjs
// ahora también lo copia (fix de la review final: tenía el `arg()` sin
// endurecer, ver ct-groom.mjs) — un `--repo` colgante nunca llega a
// `execFileSync` como valor real.
const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}
const has = (f) => process.argv.includes(f)

// formatReason: traduce el `blockReason` que devuelve planDispatch
// (scripts/dispatch.js, lógica pura y testeada sin red) a un mensaje para el
// humano, para las causas que NO son "cap lleno" (ver formatBlockReason para
// esa). W-B (§8): antes había un único mensaje genérico ("nada ready con
// deps mergeadas y sin colisión") para cuatro causas muy distintas con
// remedios distintos — obligaba a adivinar. Este wrapper solo formatea
// texto; la DECISIÓN de cuál es la causa ya la tomó planDispatch. Extraída
// de formatBlockReason (fix Minor 1 de la review) para poder reutilizarla
// también dentro del mensaje de "cap lleno", cuando subir --cap tampoco
// bastaría (ver más abajo).
function formatReason(reason) {
  switch (reason?.reason) {
    case 'none-ready':
      return 'No hay ningún issue en status:ready — no hay nada que despachar todavía.'
    case 'deps-unmet': {
      const list = reason.blocked
        .map((b) => `#${b.n} (falta mergear ${b.unmetDeps.map((d) => `#${d}`).join(', ')})`)
        .join(', ')
      return `Hay slice(s) en status:ready pero con dependencias sin mergear: ${list} — espera a que se mergeen esas dependencias.`
    }
    case 'collision': {
      if (reason.kind === 'serializing') {
        return `#${reason.issue} está ready con deps mergeadas, pero no se puede serializar: su touches:${reason.token} entra en el mismo grupo serializante (migration/ci/pbxproj) que touches:${reason.runningToken}, ya en vuelo en #${reason.withIssue} — espera a que termine.`
      }
      return `#${reason.issue} está ready con deps mergeadas, pero colisiona con trabajo en vuelo: comparte el token '${reason.token}' con #${reason.withIssue} (status:in-progress) — espera a que termine, o resuelve el token.`
    }
    default:
      // No debería alcanzarse (ver el razonamiento en dispatch.js#explainNoSelection),
      // pero nunca imprimimos "undefined" en silencio ante una entrada inesperada.
      return 'No hay slices despachables (nada ready con deps mergeadas y sin colisión).'
  }
}

function formatBlockReason(reason, cap) {
  if (reason?.reason === 'cap-full') {
    // El listado de qué issues concretos están en vuelo ya se ve, en
    // --dry-run, en la línea "En vuelo" impresa justo antes (más abajo); aquí
    // solo hace falta el conteo y el cap para que el mensaje sea
    // autosuficiente también en la corrida real (sin --dry-run).
    const base = `El cap (${cap}) ya está copado por trabajo en vuelo: ${reason.inFlightCount} slice(s) en status:in-progress`
    // Fix Minor 1 de la review: sin `wouldDispatchIfCapAllowed`, este mensaje
    // SIEMPRE sugería "sube --cap", incluso cuando el candidato que quedaría
    // libre seguiría bloqueado por otra causa (deps sin mergear, o colisión
    // con lo ya en vuelo) — subir el cap en ese caso no cambiaría nada, y
    // afirmar que sí es peor que no decir nada.
    if (reason.wouldDispatchIfCapAllowed) {
      return `${base} — sube --cap, o espera a que termine alguno.`
    }
    return `${base} — aunque subieras --cap no bastaría todavía: ${formatReason(reason.blockedEvenWithCap)}`
  }
  return formatReason(reason)
}

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

// maxBuffer explícito (finding 7 de la review final): el default de Node para
// execFileSync es 1 MiB, y las enumeraciones de abajo ya no llevan `--limit`
// (ver finding 2) — un repo con unos pocos cientos de issues, cada uno con su
// body, puede superar 1 MiB de JSON con facilidad. Node aborta ruidosamente
// si se excede (no trunca en silencio), así que el peligro no es corrupción
// de datos sino que el comando se vuelva inusable contra un repo real. 20 MiB
// es generoso para miles de issues/PRs con body completo sin ser "sin
// límite" de verdad (un runaway real seguiría abortando).
const GH_MAX_BUFFER = 20 * 1024 * 1024
const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: GH_MAX_BUFFER })

// Guarda de identidad de repo (finding 1 de la review final, el más grave de
// toda la revisión): `repoRoot` (más abajo) sale de `git rev-parse
// --show-toplevel` en el cwd en el que arrancó la sesión — que puede no
// tener NADA que ver con `--repo`. Sin esta guarda, correr `/ct-next --repo
// otro-org/otro-repo` desde una sesión de control-tower crea `feat/<n>` +
// `.worktrees/<n>` DENTRO de control-tower, siembra un STATE.md ahí y lanza
// un agente con un kickoff que dice estar implementando un slice de
// otro-org/otro-repo. Resolvemos la identidad real del checkout vía `git
// remote get-url origin` — no `gh repo view --json nameWithOwner`: eso
// dispara una llamada de red solo para leer algo que `git remote` ya sabe en
// local, y además `gh repo view` internamente también depende del remote
// para resolver el repo por defecto — y abortamos si no coincide, o si no
// podemos verificarla (repo sin remote `origin`: lo tratamos como "no
// verificable", nunca como "sigue sin comprobar", mismo criterio que el
// resto del script para cualquier fallo de lectura). Se aplica tanto en la
// ruta real como en --dry-run (ver el `else` de más abajo, que cubre ambas):
// un --dry-run ya exige estar dentro de un repo git real para poder resolver
// `repoRoot` (eso no es nuevo, ya lo hacía antes de este fix), así que la
// guarda no añade ningún requisito de entorno nuevo a --dry-run — solo
// cierra el hueco de que un --dry-run imprima, con total confianza, un plan
// (rutas de worktree, kickoff) que en realidad corresponde a un repo
// distinto del que el humano cree estar mirando. Un --dry-run que valida
// MENOS que la corrida real sería exactamente la trampa que esta guarda
// existe para evitar.
function ensureRepoIdentity(root, expectedRepo) {
  let originUrl
  try {
    originUrl = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim()
  } catch (e) {
    console.error(`no se pudo verificar que ${root} es el checkout de ${expectedRepo}: no tiene remote "origin" (${e.message}). Por seguridad, ct-next.mjs NO continúa — podría estar corriendo dentro del repo equivocado (p.ej. una sesión de control-tower en vez de ${expectedRepo}). Añade un remote origin que apunte a ${expectedRepo}, o ejecuta ct-next.mjs desde el checkout correcto.`)
    process.exit(1)
  }
  const m = originUrl.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/)
  if (!m) {
    console.error(`no se pudo interpretar el remote "origin" de ${root} ("${originUrl}") como un repo de GitHub owner/repo. Por seguridad, ct-next.mjs NO continúa.`)
    process.exit(1)
  }
  const actualRepo = `${m[1]}/${m[2]}`
  if (actualRepo.toLowerCase() !== expectedRepo.toLowerCase()) {
    console.error(`--repo ${expectedRepo} no coincide con el checkout local en ${root} (remote origin → ${actualRepo}). Aborta: ejecuta ct-next.mjs desde un checkout de ${expectedRepo}, o corrige --repo.`)
    process.exit(1)
  }
}

let repoRoot
if (fx) {
  // Solo se usa para construir strings en la rama --dry-run (el fixture está
  // atado a --dry-run más arriba): nunca llega a un `git worktree add` real,
  // así que tampoco pasa (ni necesita pasar) la guarda de identidad de arriba.
  repoRoot = '/tmp/fake-repo'
} else {
  try {
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  } catch (e) {
    console.error(`no se pudo resolver la raíz del repo git local: ${e.message}`)
    process.exit(1)
  }
  ensureRepoIdentity(repoRoot, repo)
}

function loadIssues() {
  if (fx) return fx
  // issues open con labels → {n, order, status, deps, touches, entrega, type, ac, issue}.
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
  let raw
  try {
    // per_page=100 (re-review): el default REST es 30/página — con --paginate
    // igual se traen todos, pero a 3x más round-trips de los necesarios. 100
    // es el máximo que admite este endpoint.
    raw = realIssuesOnly(flattenIssuePages(JSON.parse(
      gh(['api', `repos/${repo}/issues`, '--method', 'GET', '-f', 'state=open', '-f', 'per_page=100', '--paginate', '--slurp']))))
  } catch (e) {
    console.error(`no se pudieron listar issues abiertos de ${repo}: ${e.message}`)
    process.exit(1)
  }

  let closed
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
    const rawClosed = realIssuesOnly(flattenIssuePages(JSON.parse(
      gh(['api', `repos/${repo}/issues`, '--method', 'GET', '-f', 'state=closed', '-f', 'per_page=100', '--paginate', '--slurp']))))
    closed = rawClosed.map((i) => ({
      number: i.number,
      body: i.body,
      stateReason: i.state_reason ? String(i.state_reason).toUpperCase() : null,
    }))
  } catch (e) {
    console.error(`no se pudieron listar issues cerrados de ${repo}: ${e.message}`)
    process.exit(1)
  }
  return buildDispatchInput(raw, closed)
}

const { issues, mergedIssues } = loadIssues()
// planDispatch (dispatch.js) es quien decide TODO lo que antes se hacía aquí
// a medias: antes este wrapper llamaba a selectNext con `runningTouches: []`
// hardcodeado, así que dos invocaciones sucesivas de /ct-next --cap 1 nunca
// se veían entre sí — ni para colisión de touches ni para el cap, que
// contaba solo lo lanzado EN ESTA tanda. planDispatch deriva el trabajo en
// vuelo (status:in-progress) de los mismos `issues` ya cargados, resta ese
// trabajo del cap antes de seleccionar, y explica el motivo exacto cuando no
// selecciona nada (W-B, §8) — este wrapper solo formatea lo que ya decidió.
const { selected, inFlight, blockReason } = planDispatch(issues, { mergedIssues, cap })

// Visibilidad del trabajo en vuelo en --dry-run (punto 4 del brief de W-B):
// sin esto, un --dry-run que SÍ selecciona algo podía dar la falsa
// impresión de que no hay nada corriendo ya, cuando el cap podía estar
// parcialmente ocupado por invocaciones anteriores de /ct-next (o por un
// claim manual). Se imprime ANTES del plan de cada slice, tanto si se
// selecciona algo como si no.
if (dryRun) {
  if (inFlight.length) {
    const detail = inFlight
      .map((i) => `#${i.n} [${(i.touches.length ? i.touches.map((t) => `touches:${t}`).join(', ') : 'sin touches')}]`)
      .join(', ')
    console.log(`En vuelo (${inFlight.length}/${cap} del cap ocupados): ${detail}`)
  } else {
    console.log(`En vuelo: ninguno (0/${cap} del cap ocupados).`)
  }
}

if (!selected.length) {
  console.log(formatBlockReason(blockReason, cap))
  process.exit(0)
}

const repoName = repo.split('/').pop()
const configDir = resolveAccount(repoName, ACCOUNT_MAP)

// Si un paso POSTERIOR a `git worktree add` falla (seed de STATE.md, o el
// lanzamiento de cmux), el worktree y la rama ya existen en disco. Sin
// limpieza, reintentar el mismo slice vuelve a fallar en `git worktree add`
// (ruta y rama ya ocupadas) hasta que un humano limpie a mano — y T10 es
// justo donde esto se encontraría por primera vez contra un repo real
// (review round 1, finding Important). Intentamos deshacerlo automáticamente
// aquí mismo — mismo patrón que dispatch-check.mjs revirtiendo el label de
// claim cuando un paso posterior falla. Sale con exit 1 en cualquier caso:
// fallar el dispatch de ESTE slice nunca debe decidirse en silencio.
//
// Los dos pasos de limpieza (`worktree remove` y `branch -D`) se intentan por
// SEPARADO, cada uno en su propio try/catch (finding 10 de la review final):
// si estuvieran en el mismo try, un fallo en el primero saltaría el segundo
// sin ni siquiera intentarlo, dejando la rama huérfana también. Y el hint
// manual que se imprime cuando algo queda pendiente nunca junta ambos
// comandos con `&&`: si `worktree remove` tuvo éxito pero `branch -D` fue el
// que falló, un hint con `&&` sería inejecutable tal cual — el primer
// comando fallaría (el worktree ya no existe) y por cortocircuito el
// segundo, que es el que de verdad hace falta, nunca llegaría a correr. El
// mensaje solo lista los comandos de los pasos que de verdad quedaron
// pendientes.
// W-C, punto 1: invoca dispatch-check.mjs como subproceso, con un argv array
// (NUNCA un string de shell) — process.execPath en vez de la cadena "node"
// para no depender de que "node" resuelva en PATH al mismo binario que ya
// está ejecutando este propio script. Contrato de exit code de
// dispatch-check.mjs (ver su propia cabecera, T11): 0 = reclamado, 1 = no
// arrancar (colisión o carrera perdida), 2 = error de uso. stdio heredado a
// propósito: el mensaje que imprime dispatch-check (colisión, carrera
// perdida, o "claimed #N → in-progress") ya explica el motivo bien — este
// wrapper lo deja pasar tal cual en vez de parsearlo y reformatearlo.
function attemptClaim(s) {
  try {
    execFileSync(process.execPath, [dispatchCheckPath, String(s.n), '--repo', repo], { stdio: 'inherit' })
    return { ok: true }
  } catch (e) {
    return { ok: false, status: e.status }
  }
}

// W-C, punto 3: revierte un claim ya obtenido cuando el dispatch falla
// DESPUÉS de reclamar (git worktree add, el seed de STATE.md, o cmux) — sin
// esto el issue queda huérfano en status:in-progress sin nadie trabajándolo,
// justo el modo de fallo que dispatch-check.mjs se esfuerza en evitar puertas
// adentro (su propio claim-then-verify). dispatch-check.mjs no tiene un flag
// de "abortar": --release es la transición in-progress → in-review de un PR
// YA abierto, y aquí no hubo nunca trabajo real, así que revertimos con la
// misma mutación de label que dispatch-check usa puertas adentro para sus
// propios revert (carrera perdida, fallo de readback) — reutilizando el
// `gh()` ya definido en este fichero, no una llamada suelta a execFileSync.
function attemptRevertClaim(s) {
  try {
    gh(['issue', 'edit', String(s.n), '--repo', repo, '--add-label', 'status:ready', '--remove-label', 'status:in-progress'])
    return null
  } catch (e) {
    return e
  }
}
const manualRevertClaimHint = (s) => `gh issue edit ${s.n} --repo ${repo} --add-label status:ready --remove-label status:in-progress`

// Igual que el resto de mensajes de este fichero: nunca se listan (ni se
// imprime su comando manual) los pasos que SÍ tuvieron éxito — solo los que
// de verdad quedaron pendientes.
function formatSpanishList(items) {
  if (items.length <= 1) return items[0] || ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

function cleanupOrphanedWorktree(s, wt, branch, reason) {
  console.error(`no se pudo completar el dispatch de #${s.n} tras crear el worktree (${reason}).`)

  const attempts = [
    { label: 'el worktree', cmd: `git worktree remove --force ${wt}`, err: null },
    { label: 'la rama', cmd: `git branch -D ${branch}`, err: null },
    { label: 'el claim (status:in-progress → status:ready)', cmd: manualRevertClaimHint(s), err: null },
  ]

  try {
    execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repoRoot, stdio: 'inherit' })
  } catch (e) {
    attempts[0].err = e
  }

  try {
    execFileSync('git', ['branch', '-D', branch], { cwd: repoRoot, stdio: 'inherit' })
  } catch (e) {
    attempts[1].err = e
  }

  // Los tres pasos se intentan por SEPARADO (mismo motivo que ya regía para
  // worktree/rama antes de W-C): si estuvieran en un único try, un fallo en
  // el primero saltaría los siguientes sin ni siquiera intentarlos, dejando
  // más cosas huérfanas de las necesarias. Un `&&` en el hint manual tendría
  // el mismo problema al revés (si el primer comando de la cadena ya no hace
  // falta porque tuvo éxito, re-ejecutarlo fallaría y el `&&` cortocircuitaría
  // el resto) — por eso el hint de abajo siempre lista los comandos pendientes
  // separados por `;`, nunca encadenados.
  attempts[2].err = attemptRevertClaim(s)

  const failed = attempts.filter((a) => a.err)
  if (!failed.length) {
    console.error(`worktree y rama de #${s.n} limpiados automáticamente (${wt}, ${branch}); claim revertido automáticamente a status:ready — puedes reintentar el dispatch de este slice.`)
  } else {
    const what = formatSpanishList(failed.map((a) => a.label))
    const errMsg = failed.map((a) => a.err.message).join('; ')
    const pendingCmds = failed.map((a) => a.cmd)
    console.error(`ATENCIÓN: no se pudo limpiar automáticamente ${what} de #${s.n} (${errMsg}). Pendiente a mano — ejecuta cada comando por separado: ${pendingCmds.join(' ; ')}`)
  }
  // Los slices de esta misma tanda ya lanzados con éxito ANTES de este fallo
  // (si cap > 1) siguen corriendo en su propio cmux, independiente de este
  // proceso — no se tocan ni se detienen aquí.
  console.error('Los slices de esta tanda ya lanzados con éxito antes de este fallo (si los hubo) siguen corriendo en su propio cmux — no se han tocado.')
  process.exit(1)
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
  const kickoff = renderKickoff(sliceForKickoff, { repo, dispatchCheckPath })
  const stateSeed = buildStateSeed(sliceForKickoff, { branch, base: 'main' })
  // Override 1 (shell quoting): --command es UN argv element (buildCmuxArgv
  // ya lo garantiza), pero la STRING dentro de ese argv element es una línea
  // de comando que cmux ejecuta vía shell. `JSON.stringify` es escapado JSON,
  // no de shell — un `$`, un backtick o un `\` en el kickoff seguirían
  // interpretándose dentro de las comillas dobles. shQuote() hace el
  // escapado POSIX real (comillas simples).
  const command = `claude --dangerously-skip-permissions ${shQuote(kickoff)}`
  // CLAUDE_CONFIG_DIR viaja como --env de cmux, NUNCA como env local del
  // proceso `cmux` cliente (ver dispatch.js#buildCmuxArgv): `cmux` es un
  // cliente que habla con un daemon ya en marcha por socket Unix, y es el
  // daemon —no este proceso— quien crea el pty real. Un env var puesto en
  // el `execFileSync('cmux', ...)` local muere con ese proceso cliente sin
  // llegar nunca al pty; verificado en vivo contra el sandbox (T10): sin
  // --env, la sesión se queda colgada en el selector interactivo de cuenta.
  const cmuxArgv = buildCmuxArgv({ name, cwd: wt, command, env: { CLAUDE_CONFIG_DIR: configDir } })

  if (dryRun) {
    console.log(`\n=== slice #${s.n} (${s.entrega}) ===`)
    // W-C, punto 5: el plan tiene que dejar claro que se INTENTARÍA un claim
    // (dispatch-check.mjs, status:ready → status:in-progress) para este issue
    // concreto ANTES de crear el worktree — sin invocar dispatch-check de
    // verdad. dispatch-check.mjs, incluso en su propio --dry-run sin fixture,
    // hace lecturas reales contra gh (solo la escritura del claim se salta);
    // invocarlo aquí rompería la garantía de "sin red" de --dry-run con
    // CT_NEXT_FIXTURE, así que en --dry-run ct-next.mjs directamente NO llama
    // a dispatch-check.mjs — ningún gh real se toca.
    // Fix round 1, minor: `node ${dispatchCheckPath} ...` (no un nombre
    // suelto "dispatch-check ...") para que la línea sea copiable y
    // ejecutable tal cual, igual que sus vecinas (`git worktree add ...`,
    // `cmux ...`).
    console.log(`node ${dispatchCheckPath} ${s.n} --repo ${repo}   # se reclamaría #${s.n} (status:ready → status:in-progress) antes de crear el worktree; en --dry-run no se ejecuta, ningún gh real se toca`)
    console.log(`CLAUDE_CONFIG_DIR=${configDir}`)
    console.log(`git worktree add -b ${branch} ${wt} main`)
    console.log(`seed ${wt}/.agent/STATE.md:\n${stateSeed}`)
    console.log(`cmux ${cmuxArgv.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`)
    continue
  }

  // W-C, punto 1/2: el claim se hace ANTES de crear el worktree. Exit 1
  // (colisión o carrera perdida) es un resultado ESPERADO del protocolo — se
  // salta este slice y se sigue con el resto de la tanda, si queda alguno.
  // Cualquier otro resultado (exit 2, o un fallo al lanzar el subproceso en
  // absoluto) NO es un resultado esperado del protocolo — sería un bug o una
  // mala configuración que fallaría igual para todos los slices restantes de
  // esta misma tanda, así que abortamos la tanda entera en vez de reintentar
  // a ciegas slice a slice.
  const claim = attemptClaim(s)
  if (!claim.ok) {
    if (claim.status === 1) {
      console.error(`saltando #${s.n}: no se pudo reclamar (motivo arriba, de dispatch-check) — sigo con el resto de esta tanda, si queda algún candidato.`)
      continue
    }
    const statusDesc = typeof claim.status === 'number' ? `exit ${claim.status}` : 'sin exit code numérico (fallo inesperado al lanzar el subproceso)'
    console.error(`dispatch-check devolvió un fallo inesperado (${statusDesc}) al intentar reclamar #${s.n} — no es una colisión ni una carrera perdida (eso sale con exit 1), así que probablemente es un bug o una mala configuración (p.ej. --repo mal formado, o dispatch-check.mjs no encontrado en ${dispatchCheckPath}). Abortando toda la tanda: no sigo con el resto de candidatos a ciegas.`)
    // Fix round 1, minor: este aborto puede dispararse DESPUÉS de haber
    // lanzado con éxito algún slice anterior de la misma tanda (cap > 1) —
    // igual que ya hace cleanupOrphanedWorktree más abajo, hay que dejar
    // explícito que esos slices siguen corriendo en su propio cmux, sin
    // tocarse.
    console.error('Los slices de esta tanda ya lanzados con éxito antes de este fallo (si los hubo) siguen corriendo en su propio cmux — no se han tocado.')
    process.exit(1)
  }

  try {
    execFileSync('git', ['worktree', 'add', '-b', branch, wt, 'main'], { cwd: repoRoot, stdio: 'inherit' })
  } catch (e) {
    // Si el worktree o la rama ya existen, `git worktree add` falla con
    // exit != 0 — lo dejamos fallar ruidoso en vez de reusar en silencio
    // algo que podría no corresponder a este slice. El claim YA se obtuvo
    // (paso de arriba): sin revertirlo aquí, este issue quedaría huérfano en
    // status:in-progress con nada corriendo — mismo motivo que
    // cleanupOrphanedWorktree más abajo, pero aquí no hay worktree/rama que
    // limpiar (git worktree add falló antes de crear nada).
    console.error(`no se pudo crear el worktree para #${s.n} en ${wt}: ${e.message}`)
    const claimErr = attemptRevertClaim(s)
    if (!claimErr) {
      console.error(`claim de #${s.n} revertido automáticamente a status:ready — puedes reintentar el dispatch de este slice.`)
    } else {
      console.error(`ATENCIÓN: no se pudo revertir automáticamente el claim de #${s.n} (${claimErr.message}). Queda bloqueado en status:in-progress — revierte a mano con: ${manualRevertClaimHint(s)}`)
    }
    process.exit(1)
  }
  try {
    mkdirSync(`${wt}/.agent`, { recursive: true })
    writeFileSync(`${wt}/.agent/STATE.md`, stateSeed)
  } catch (e) {
    cleanupOrphanedWorktree(s, wt, branch, `no se pudo sembrar .agent/STATE.md: ${e.message}`)
  }
  try {
    execFileSync('cmux', cmuxArgv, { stdio: 'inherit' })
  } catch (e) {
    cleanupOrphanedWorktree(s, wt, branch, `no se pudo lanzar cmux: ${e.message}`)
  }
  console.log(`lanzado #${s.n} en ${wt} (cuenta ${configDir})`)
}
