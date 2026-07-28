// F13 — ESTADOS QUE FALTABAN EN EL LOOP.
//
// Cuatro agujeros, todos verificados contra el código SIN arreglar antes de
// escribir una línea de fix (la salida observada en cada caso está anotada en
// el test correspondiente):
//
//   H1  `status:in-review` era TERMINAL. `--release` movía in-progress →
//       in-review y no existía ninguna transición de vuelta a `ready` salvo
//       los reverts por fallo del protocolo. Un PR rechazado en el gate
//       sacaba su slice del loop para siempre, y con él todos sus
//       dependientes.
//   H2  el cerrojo se soltaba antes de que acabara el riesgo. `--release` se
//       ejecuta AL ABRIR EL PR, y hasta F13 in-review no retenía tokens: en
//       la ventana [PR abierto, PR mergeado] el siguiente slice del mismo
//       área salía y ramificaba de una base que aún no contenía ese trabajo.
//   H3  un claim muerto que copaba el cap sin compartir tokens era invisible
//       ("sube --cap, o espera a que termine alguno" — a un agente que ya no
//       existe).
//   H4  una dep cuyo issue se cerró como "not planned" nunca se satisface, y
//       el mensaje decía "falta mergear #N" igual que si siguiera en curso.
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectCollisions, holdingStatusOf, CLAIM_HOLDING_STATUSES } from '../scripts/claim.js'
import { collectInFlight, collectTokenHolders, planDispatch } from '../scripts/dispatch.js'
import { closedNotCompleted, buildDispatchInput } from '../scripts/gh-issue-map.js'
import { ACCOUNT_ENV } from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const here = dirname(fileURLToPath(import.meta.url))
const ctNext = join(here, '..', 'scripts', 'ct-next.mjs')
const dispatchCheck = join(here, '..', 'scripts', 'dispatch-check.mjs')
const fixturesDir = join(here, 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  process.env.PATH,
].join(':')

const QUIET = ['ignore', 'pipe', 'pipe']

function runNext(args, env = {}) {
  const r = spawnSync('node', [ctNext, ...args], { encoding: 'utf8', stdio: QUIET, env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...env } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
function runCheck(args, env = {}) {
  const r = spawnSync('node', [dispatchCheck, ...args], { encoding: 'utf8', stdio: QUIET, env: { ...process.env, PATH: fakePath, ...env } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const dirs = []
afterEach(() => { for (const d of dirs.splice(0)) rmSyncBestEffort(d) })
function tmpRepo() {
  const d = mkdtempSync(join(tmpdir(), 'ct-f13-'))
  dirs.push(d)
  return d
}

const rawIssue = ({ number, order, status = 'status:ready', touches = [], body = '' }) => ({
  number,
  title: `#${number} slice`,
  labels: [{ name: status }, ...touches.map((t) => ({ name: `touches:${t}` }))],
  body: `<!-- ct-order:${order} -->\n${body}`,
})

// ============================================================================
// H2 — in-review retiene TOKENS, pero no CAP.
// ============================================================================
describe('F13/H2 — la ventana del cerrojo llega hasta el merge, no hasta el PR', () => {
  it('detectCollisions ve un status:in-review como poseedor del token (antes devolvía [])', () => {
    // Contra el código sin arreglar, esta MISMA llamada devolvía `[]`:
    // detectCollisions hacía `if (!labels.includes('status:in-progress'))
    // continue`. Ejecutado y observado antes de tocar nada.
    const c = detectCollisions(['touches:db'], [{ n: 5, labels: ['status:in-review', 'touches:db'] }])
    expect(c).toEqual([{ n: 5, tokens: ['touches:db'], status: 'status:in-review' }])
  })

  it('holdingStatusOf distingue los dos estados que retienen, y solo esos', () => {
    expect(holdingStatusOf(['status:in-progress'])).toBe('status:in-progress')
    expect(holdingStatusOf(['status:in-review'])).toBe('status:in-review')
    expect(holdingStatusOf(['status:ready'])).toBeNull()
    expect(holdingStatusOf(['status:backlog'])).toBeNull()
    expect(holdingStatusOf([])).toBeNull()
    // Un issue con las dos a la vez (edición de label a medias) se lee por el
    // estado MÁS retentivo, igual que hace resolveStatus: nunca por el orden
    // en que GitHub devuelva el array.
    expect(holdingStatusOf(['status:in-review', 'status:in-progress'])).toBe('status:in-progress')
    expect(CLAIM_HOLDING_STATUSES).toEqual(['status:in-progress', 'status:in-review'])
  })

  it('planDispatch NO despacha un ready que comparte token con un in-review (antes sí lo hacía)', () => {
    const issues = [
      { n: 5, order: 1, status: 'in-review', deps: [], touches: ['db'] },
      { n: 6, order: 2, status: 'ready', deps: [], touches: ['db'] },
    ]
    // Observado contra el código sin arreglar: selected === [6].
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 })
    expect(plan.selected).toEqual([])
    expect(plan.blockReason.reason).toBe('collision')
    expect(plan.blockReason.withIssue).toBe(5)
    expect(plan.blockReason.withIssueStatus).toBe('in-review')
  })

  it('pero un in-review NO consume cap: con cap 1 y un in-review de tokens ajenos, el ready SÍ sale', () => {
    // Es la mitad que hace que este arreglo no sea "bloquear más": el cap
    // mide AGENTES VIVOS y en un in-review no hay ninguno. Si in-review
    // contara para el cap, un PR de tres días congelaría el repo entero.
    const issues = [
      { n: 5, order: 1, status: 'in-review', deps: [], touches: ['db'] },
      { n: 6, order: 2, status: 'ready', deps: [], touches: ['ui'] },
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 })
    expect(plan.selected.map((i) => i.n)).toEqual([6])
    expect(plan.inFlight).toEqual([])              // cap: solo in-progress
    expect(plan.remainingCap).toBe(1)
    expect(collectTokenHolders(issues).map((i) => i.n)).toEqual([5]) // tokens: también in-review
    expect(collectInFlight(issues)).toEqual([])
  })

  it('la serialización migration/ci/pbxproj también alcanza a un in-review', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-review', deps: [], touches: ['migration'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['ci'] },
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 5 })
    expect(plan.selected).toEqual([])
    expect(plan.blockReason).toMatchObject({ reason: 'collision', kind: 'serializing', withIssue: 1, withIssueStatus: 'in-review' })
  })

  it('ct-next explica la colisión contra un in-review SIN mandar esperar y SIN nota de claim rancio', () => {
    // La nota de staleness (worktree/rama/sesión cmux) NO debe dispararse
    // aquí: en un slice ya entregado, no tener sesión abierta es lo normal.
    // Pedirla convertiría cada PR en revisión en una falsa alarma.
    const fx = JSON.stringify({
      issues: [
        { n: 5, order: 1, status: 'in-review', deps: [], touches: ['db'], name: 'modelo' },
        { n: 6, order: 2, status: 'ready', deps: [], touches: ['db'], name: 'api' },
      ],
      mergedIssues: [],
    })
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#6 está ready con deps mergeadas, pero colisiona con trabajo entregado sin mergear/)
    expect(r.out).toMatch(/status:in-review/)
    expect(r.out).toMatch(/esperar no sirve de nada/i)
    expect(r.out).not.toMatch(/espera a que termine/)
    expect(r.out).not.toMatch(/no se encontró worktree/)
    // Y da las tres salidas reales, incluida la que nadie ve venir: PR ya
    // mergeado cuyo issue nadie cerró porque al PR le faltaba "Closes #N".
    expect(r.out).toMatch(/Closes #5/)
    expect(r.out).toMatch(/--reopen/)
  })

  it('--dry-run lista aparte los que retienen tokens sin ocupar cap (si no, "En vuelo: ninguno" + colisión se contradicen)', () => {
    const fx = JSON.stringify({
      issues: [
        { n: 5, order: 1, status: 'in-review', deps: [], touches: ['db'], name: 'modelo' },
        { n: 6, order: 2, status: 'ready', deps: [], touches: ['db'], name: 'api' },
      ],
      mergedIssues: [],
    })
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.out).toMatch(/En vuelo: ninguno/)
    expect(r.out).toMatch(/Sin mergear, reteniendo tokens \(status:in-review, NO ocupan cap\): #5 \[touches:db\]/)
  })

  it('dispatch-check aborta el claim contra un in-review, y lo dice con su estado', () => {
    const fixture = JSON.stringify({
      candLabels: ['touches:db'],
      openIssues: [{ n: 5, labels: ['status:in-review', 'touches:db'] }],
      readback: [],
    })
    // Contra el código sin arreglar esto salía 0 ("claimed #7 → in-progress"):
    // el in-review no contaba como colisión.
    const r = runCheck(['7', '--repo', 'o/r', '--dry-run'], { CT_CLAIM_FIXTURE: fixture })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/COLLISION: #7 choca con #5\[touches:db status:in-review\]/)
    expect(r.out).toMatch(/retienen sus tokens hasta el merge/)
  })
})

// ============================================================================
// H1 — --reopen: la arista que faltaba para salir de in-review.
// ============================================================================
describe('F13/H1 — un PR rechazado puede volver al loop', () => {
  // F15/H1: el destino de --reopen ya NO es `ready`, es `in-progress`. `ready`
  // no retiene tokens, así que la arista de vuelta de F13 reabría la ventana
  // que F13 vino a cerrar. Ver el bloque F15/H1 más abajo para el porqué.
  it('--reopen sobre un status:in-review lo devuelve a in-progress', () => {
    // Contra el código sin arreglar, `--reopen` era un flag DESCONOCIDO: se
    // ignoraba en silencio y el script seguía hasta el camino de claim
    // (observado: intentaba `gh issue view` y salía 3).
    const fixture = JSON.stringify({ candLabels: ['status:in-review'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--reopen', '--dry-run'], { CT_CLAIM_FIXTURE: fixture })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/reopened #9 → in-progress/)
    expect(r.out).toMatch(/SIN MERGEAR/)
  })

  // F15/H1: `in-progress` pasa de "estado desde el que no se puede reabrir" a
  // "estado en el que --reopen ya te habría dejado", así que el mensaje cambia
  // de sitio pero la propiedad no: NO se toca ninguna label.
  it('--reopen sobre un status:in-progress se NIEGA sin tocar ninguna label (ya está donde iría)', () => {
    const fixture = JSON.stringify({ candLabels: ['status:in-progress', 'touches:db'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--reopen', '--dry-run'], { CT_CLAIM_FIXTURE: fixture })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/ya está en status:in-progress/)
    expect(r.out).toMatch(/No se ha tocado ninguna label/)
    // Y nombra la salida real para el otro camino, que ya no es --reopen.
    expect(r.out).toMatch(/--requeue/)
  })

  it('--reopen desde backlog (sin ninguna label status:) se NIEGA sin tocar nada', () => {
    const fixture = JSON.stringify({ candLabels: ['touches:db'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--reopen', '--dry-run'], { CT_CLAIM_FIXTURE: fixture })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/solo devuelve al banco de trabajo un slice en status:in-review/)
    expect(r.out).toMatch(/No se ha tocado ninguna label/)
    expect(r.out).toMatch(/DOS estados a la vez/)
  })

  it('--reopen sobre algo YA ready lo dice como no-op, no como error del usuario', () => {
    const fixture = JSON.stringify({ candLabels: ['status:ready'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--reopen', '--dry-run'], { CT_CLAIM_FIXTURE: fixture })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/ya está en status:ready — no hay nada que reabrir/)
  })

  it('--reopen NO reabre un issue con DOS labels de estado, aunque una de ellas sea in-review', () => {
    // Hallazgo al atacar la propia implementación de F13: la primera versión
    // comprobaba `labels.includes('status:in-review')`, así que un issue con
    // in-progress E in-review a la vez pasaba, y el add ready / remove
    // in-review lo dejaba en [in-progress, ready] — el mismo estado ambiguo
    // del que avisa su propio mensaje de error. Observado: exit 0 y
    // "reopened #9 → ready".
    const fixture = JSON.stringify({ candLabels: ['status:in-review', 'status:in-progress', 'touches:db'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--reopen', '--dry-run'], { CT_CLAIM_FIXTURE: fixture })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/DOS o más labels de estado a la vez/)
    expect(r.out).toMatch(/status:in-progress/)
    expect(r.out).toMatch(/status:in-review/)
    expect(r.out).not.toMatch(/reopened/)
  })

  it('--release y --reopen juntos → error de uso, sin adivinar cuál quería quien lo escribió', () => {
    const r = runCheck(['9', '--repo', 'o/r', '--release', '--reopen', '--dry-run'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/mutuamente excluyentes/)
  })

  it('con worktree y rama de la vuelta anterior: dice qué queda y da los DOS caminos con sus comandos', () => {
    // Reabrir mueve el label, no el disco — y /ct-next se NIEGA a despachar
    // un slice cuyo worktree o rama ya existen. Sin decirlo aquí, reabrir
    // "funciona" y el siguiente /ct-next falla con un mensaje que no
    // menciona la reapertura.
    const repoRoot = tmpRepo()
    mkdirSync(join(repoRoot, '.worktrees', '9'), { recursive: true })
    const fixture = JSON.stringify({ candLabels: ['status:in-review'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--reopen', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture,
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_STALE_BRANCH_EXISTS: '9',
    })
    expect(r.code).toBe(0)
    expect(r.out).toContain(join(repoRoot, '.worktrees', '9'))
    expect(r.out).toMatch(/feat\/9/)
    expect(r.out).toMatch(/NO se ha tocado nada de eso: reabrir mueve el label, no el disco/)
    expect(r.out).toMatch(/\(a\) CORREGIR ENCIMA/)
    expect(r.out).toMatch(/NO invoques \/ct-next/)
    expect(r.out).toMatch(/\(b\) EMPEZAR DE CERO/)
    expect(r.out).toContain(`git -C ${repoRoot} worktree remove`)
    expect(r.out).toContain(`git -C ${repoRoot} branch -D feat/9`)
    // F15/H1: el camino (b) ya no termina en "y /ct-next lo despacha": tras
    // borrar hay que devolverlo a la cola explícitamente, porque --reopen lo
    // dejó reclamado.
    expect(r.out).toMatch(/--requeue/)
  })

  it('sin poder consultar git, NO afirma que no quede nada', () => {
    const fixture = JSON.stringify({ candLabels: ['status:in-review'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--reopen', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture,
      FAKE_GIT_WORKTREE_LIST_FAIL: '1',
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/No se ha podido comprobar qué queda/)
    expect(r.out).toMatch(/NO lo leas como "no hay nada"/)
  })

  it('la línea de uso anuncia --reopen (si no, nadie que lea el error se entera de que existe)', () => {
    const r = runCheck(['9', '--dry-run'])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/\[--release \| --reopen \| --requeue\]/)
  })
})

// ============================================================================
// H3 — un claim muerto que copa el cap.
// ============================================================================
describe('F13/H3 — el claim rancio también se cruza cuando lo único que bloquea es el cap', () => {
  const issue41Stuck = rawIssue({ number: 41, order: 1, status: 'status:in-progress', touches: ['api'] })
  const issue42Ready = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['ui'] })

  it('in-progress sin worktree/rama/sesión que solo ocupa cap → ATENCIÓN, no "espera a que termine alguno" a secas', () => {
    // Observado contra el código sin arreglar, con este mismo escenario:
    //   "El cap (1) ya está copado por trabajo en vuelo: 1 slice(s) en
    //    status:in-progress — sube --cap, o espera a que termine alguno."
    // y ni una palabra de staleness: la detección de D3 solo se consultaba
    // desde el caso 'collision', y aquí los tokens (api / ui) NO chocan.
    const repoRoot = tmpRepo()
    const r = runNext(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify([]),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/El cap \(1\) ya está copado/)
    expect(r.out).toMatch(/ATENCIÓN, el cap puede estar copado por un claim muerto/)
    expect(r.out).toMatch(/no se encontró worktree, rama local, ni sesión cmux para #41 EN ESTA MÁQUINA/)
    // Y sigue sin afirmar el abandono como un hecho: la evidencia es local.
    expect(r.out).toMatch(/tampoco afirmamos que esté abandonado/)
  })

  it('con evidencia local de vida (worktree presente) NO se dice nada de claim muerto — y NI SIQUIERA se consulta a cmux', () => {
    // La segunda mitad es un hallazgo al atacar la propia implementación:
    // ampliar la comprobación al caso "cap lleno" (el resultado MÁS COMÚN de
    // un /ct-next con algo corriendo) hacía que CADA invocación rutinaria
    // pagara la consulta a cmux —list-windows + un workspace list por
    // ventana, hasta 5s de timeout— solo para no decir nada. Ahora las dos
    // señales baratas (worktree, rama) se miran primero y cmux solo se
    // consulta si las dos fallan. La semántica no cambia: basta UNA señal.
    const repoRoot = tmpRepo()
    mkdirSync(join(repoRoot, '.worktrees', '41'), { recursive: true })
    const cmuxLog = join(repoRoot, 'cmux-invocations.log')
    const r = runNext(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify([]),
      FAKE_CMUX_INVOKED_LOG_FILE: cmuxLog,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/sube --cap, o espera a que termine alguno\./)
    expect(r.out).not.toMatch(/claim muerto/)
    expect(existsSync(cmuxLog)).toBe(false) // ni una sola invocación de cmux
  })

  it('un in-review que retiene tokens NO se acusa de claim muerto por no tener sesión', () => {
    // Categoría nueva creada por H2: si el cruce de staleness se aplicara a
    // los poseedores in-review, CADA PR en revisión sería una falsa alarma.
    const issue50Review = rawIssue({ number: 50, order: 1, status: 'status:in-review', touches: ['api'] })
    const issue51Ready = rawIssue({ number: 51, order: 2, status: 'status:ready', touches: ['api'] })
    const repoRoot = tmpRepo()
    const r = runNext(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue50Review, issue51Ready], []]),
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify([]),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/colisiona con trabajo entregado sin mergear/)
    expect(r.out).not.toMatch(/no se encontró worktree/)
    expect(r.out).not.toMatch(/claim muerto/)
  })
})

// ============================================================================
// H4 — una dep que no se va a satisfacer nunca tiene que poder decirlo.
// ============================================================================
describe('F13/H4 — "cerrado" no es "mergeado", y ahora se nota', () => {
  it('closedNotCompleted recoge los cierres que NO satisfacen una dep, y solo esos', () => {
    expect(closedNotCompleted([
      { number: 1, stateReason: 'COMPLETED' },
      { number: 2, stateReason: 'NOT_PLANNED' },
      { number: 3, stateReason: 'REOPENED' },
      { number: 4, stateReason: null },
      { number: 5 },
    ])).toEqual({ 2: 'NOT_PLANNED', 3: 'REOPENED', 4: null, 5: null })
  })

  it('buildDispatchInput expone depStates junto a mergedIssues (misma fuente, para que no se filtre una y la otra no)', () => {
    const closed = [{ number: 7, body: '<!-- ct-order:1 -->', milestone: { number: 1 }, stateReason: 'NOT_PLANNED' }]
    const open = [{ number: 8, body: '<!-- ct-order:2 -->\n## Dependencias\nmerge-after `#1`\n', milestone: { number: 1 }, labels: [{ name: 'status:ready' }], title: 'x' }]
    const di = buildDispatchInput(open, closed)
    expect(di.mergedIssues).toEqual([])
    expect(di.depStates).toEqual({ 7: 'NOT_PLANNED' })
    expect(di.issues[0].deps).toEqual([7]) // el orden #1 sí resuelve al issue #7
  })

  it('ct-next nombra el cierre "not planned" y dice que esa dep NO se va a satisfacer nunca', () => {
    // Contra el código sin arreglar, este mismo escenario producía:
    //   "...#8 (falta mergear #7) — espera a que se mergeen esas dependencias"
    // con #7 CERRADO. Una instrucción a esperar algo que nunca va a pasar.
    const repoRoot = tmpRepo()
    const open = [rawIssue({ number: 8, order: 2, status: 'status:ready', body: '## Dependencias\nmerge-after `#1`\n' })]
    const closed = [{ number: 7, title: '#7 descartado', labels: [], body: '<!-- ct-order:1 -->\n', state_reason: 'not_planned' }]
    // FAKE_GH_COUNTER_FILE es imprescindible: sin él, el stub de gh sirve
    // SIEMPRE el elemento 0 de la secuencia, así que la llamada de issues
    // CERRADOS devolvería la lista de abiertos y este test no probaría nada.
    const r = runNext(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-counter'),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([open, closed]),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#7, que está cerrado como "not planned"/)
    expect(r.out).toMatch(/NO SE VA A SATISFACER NUNCA/)
    // Los dos remedios reales, porque "espera" no es uno de ellos.
    expect(r.out).toMatch(/quita el "merge-after/)
    expect(r.out).toMatch(/reabre #7 y ciérralo como completed/)
    // Y la coletilla final no puede contradecir al detalle. Observado en una
    // corrida real contra josemerca/ct-loop-sandbox con la primera versión de
    // este mensaje: "...ESTA NO SE VA A SATISFACER NUNCA... — espera a que se
    // mergeen esas dependencias". La última frase es la que se queda.
    expect(r.out).toMatch(/esperar NO va a desbloquear nada aquí/)
    expect(r.out).not.toMatch(/espera a que se mergeen esas dependencias/)
  })

  it('una dep simplemente sin mergear (issue abierto) sigue diciendo "falta mergear", sin ruido nuevo', () => {
    // Control negativo: el mensaje nuevo NO debe aparecer cuando esperar SÍ
    // es el consejo correcto.
    const repoRoot = tmpRepo()
    const open = [
      rawIssue({ number: 7, order: 1, status: 'status:backlog' }),
      rawIssue({ number: 8, order: 2, status: 'status:ready', body: '## Dependencias\nmerge-after `#1`\n' }),
    ]
    const r = runNext(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-counter'),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([open, []]),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/#8 \(falta mergear #7\)/)
    expect(r.out).not.toMatch(/NO SE VA A SATISFACER NUNCA/)
    // Control de la coletilla en la otra dirección: aquí esperar SÍ es el
    // consejo correcto, y hay que seguir dándolo.
    expect(r.out).toMatch(/espera a que se mergeen esas dependencias/)
    expect(r.out).not.toMatch(/esperar NO va a desbloquear nada/)
  })

  it('"no hay nada ready" ya no se calla los slices parados en revisión', () => {
    // Al final de un epic, "todo entregado, nada mergeado" es el estado
    // NORMAL — y el mensaje lo pintaba como si no se hubiera empezado.
    const fx = JSON.stringify({
      issues: [
        { n: 5, order: 1, status: 'in-review', deps: [], touches: ['db'], name: 'a' },
        { n: 6, order: 2, status: 'in-review', deps: [], touches: ['ui'], name: 'b' },
      ],
      mergedIssues: [],
    })
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/Sí hay 2 en status:in-review \(#5, #6\)/)
    expect(r.out).toMatch(/entregado pero SIN MERGEAR/)
    expect(r.out).toMatch(/--reopen/)
    expect(r.out).not.toMatch(/no hay nada que despachar todavía/)
  })

  it('sin ningún in-review, "no hay nada ready" sigue siendo la frase corta de siempre', () => {
    const fx = JSON.stringify({ issues: [{ n: 5, order: 1, status: 'backlog', deps: [], touches: [], name: 'a' }], mergedIssues: [] })
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/No hay ningún issue en status:ready — no hay nada que despachar todavía\./)
  })
})
