// F15 — CABOS SUELTOS QUE SOLO APARECEN USANDO EL PLUGIN DE VERDAD.
//
// Tres hallazgos de campo, cada uno reproducido contra el código SIN arreglar
// antes de escribir una línea de fix (lo observado está anotado en cada test):
//
//   H1  `--reopen` (la arista de vuelta que añadió F13) mandaba el slice a
//       `status:ready`, y `ready` NO retiene tokens. Mientras alguien corrige
//       encima de un PR rechazado, un vecino que comparta `area:`/`touches:`
//       podía despacharse sobre una `main` que no contiene ese trabajo — la
//       ventana que F13 vino a cerrar, reabierta por su propia arista.
//   H2  `/ct-groom --project <n>` valida el Project v2 (campo `Sprint`,
//       iteración vigente) DESPUÉS de crear el milestone y las labels. La
//       deducción que dos lectores independientes hicieron de la
//       documentación —"un abort deja basura a medias"— era la CORRECTA.
//   H3  `.agent/conventions-ack.md` es el fichero donde se deja constancia del
//       PORQUÉ de una decisión, y su parser no admitía ni una línea de prosa.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planDispatch } from '../scripts/dispatch.js'
import { parseAcks, looksLikeAck, formatFindings, detectConventions, ACK_PATH } from '../scripts/conventions.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const here = dirname(fileURLToPath(import.meta.url))
const dispatchCheck = join(here, '..', 'scripts', 'dispatch-check.mjs')
const ctGroom = join(here, '..', 'scripts', 'ct-groom.mjs')
const fixturesDir = join(here, 'fixtures')
const fakePath = [join(fixturesDir, 'fake-git-bin'), join(fixturesDir, 'fake-gh-bin'), process.env.PATH].join(':')
const QUIET = ['ignore', 'pipe', 'pipe']

const dirs = []
afterEach(() => { for (const d of dirs.splice(0)) rmSyncBestEffort(d) })
function tmp(prefix = 'ct-f15-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

function runCheck(args, env = {}) {
  const r = spawnSync('node', [dispatchCheck, ...args], { encoding: 'utf8', stdio: QUIET, env: { ...process.env, PATH: fakePath, ...env } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

// ============================================================================
// H1 — la vuelta de un PR rechazado no puede soltar los tokens.
// ============================================================================
const slice = (n, status, touches, order) => ({ n, status, touches, order, deps: [] })

describe('F15/H1 — `ready` significaba dos cosas incompatibles', () => {
  // LA REPRODUCCIÓN, por construcción, antes de tocar nada. Con #7 en
  // `in-review` y `area:plan`, planDispatch retiene ese token: #8 (que
  // comparte área) se salta y sale #9. Con ese mismo #7 en `ready` —que es
  // donde lo dejaba el --reopen de F13— `runningTouches` sale VACÍO y la
  // protección desaparece por completo.
  it('un slice en `ready` no retiene tokens: ESA es la ventana (comprobación de la premisa)', () => {
    const issues = (st) => [slice(7, st, ['area:plan'], 1), slice(8, 'ready', ['area:plan'], 2), slice(9, 'ready', ['area:ui'], 3)]
    const enReview = planDispatch(issues('in-review'), { cap: 1 })
    expect(enReview.runningTouches).toEqual(['area:plan'])
    expect(enReview.selected.map((i) => i.n)).toEqual([9]) // #8 protegido

    const enReady = planDispatch(issues('ready'), { cap: 1 })
    expect(enReady.runningTouches).toEqual([]) // nadie retiene nada
  })

  // EL FIX. `--reopen` deja el slice en `in-progress`, que retiene tokens Y
  // ocupa cap — las dos cosas ciertas de un slice que alguien está rehaciendo.
  it('tras --reopen el slice retiene sus tokens: el vecino de la misma área NO sale', () => {
    const issues = [slice(7, 'in-progress', ['area:plan'], 1), slice(8, 'ready', ['area:plan'], 2), slice(9, 'ready', ['area:ui'], 3)]
    const plan = planDispatch(issues, { cap: 2 })
    expect(plan.runningTouches).toEqual(['area:plan'])
    expect(plan.selected.map((i) => i.n)).toEqual([9]) // #8 sigue protegido
    // Y consume cap, porque hay alguien trabajándolo de verdad.
    expect(plan.inFlight.map((i) => i.n)).toEqual([7])
    expect(plan.remainingCap).toBe(1)
  })

  it('--reopen anuncia que SIGUE reteniendo tokens (no se vende como "ya puedes despachar")', () => {
    const fixture = JSON.stringify({ candLabels: ['status:in-review'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--reopen', '--dry-run'], { CT_CLAIM_FIXTURE: fixture })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/reopened #9 → in-progress/)
    expect(r.out).toMatch(/SIN MERGEAR/)
    expect(r.out).not.toMatch(/reopened #9 → ready/)
  })
})

// ============================================================================
// H1 (2) — --requeue: la otra mitad de la arista, y su categoría de rechazo.
// ============================================================================
describe('F15/H1 — --requeue: devolver a la cola es una DECLARACIÓN de que no queda trabajo', () => {
  // Contra el código sin arreglar `--requeue` no existía: era un flag
  // desconocido que se ignoraba en silencio y el script seguía hasta el camino
  // de claim (observado: exit 1 con "COLLISION"/exit 3 según el fixture).
  it('sobre un in-progress SIN worktree ni rama: lo devuelve a ready y dice qué NO ha comprobado', () => {
    const repoRoot = tmp()
    const fixture = JSON.stringify({ candLabels: ['status:in-progress'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--requeue', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture,
      FAKE_GIT_TOPLEVEL: repoRoot,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/requeued #9 → ready/)
    expect(r.out).toMatch(/suelta sus tokens/)
    // La mitad que NO puede comprobar, dicha en vez de escondida.
    expect(r.out).toMatch(/NO se ha comprobado/)
    expect(r.out).toMatch(/REMOTO/)
  })

  // LA CATEGORÍA NUEVA DE RECHAZO, con voz propia: `ready` mentiría.
  it('se NIEGA si todavía queda el worktree o la rama, y explica por qué eso importa', () => {
    const repoRoot = tmp()
    mkdirSync(join(repoRoot, '.worktrees', '9'), { recursive: true })
    const fixture = JSON.stringify({ candLabels: ['status:in-progress'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--requeue', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture,
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_STALE_BRANCH_EXISTS: '9',
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/su trabajo sigue vivo sin mergear/)
    expect(r.out).toMatch(/soltaría sus tokens/)
    expect(r.out).toMatch(/No se ha tocado ninguna label/)
    expect(r.out).toContain(`git -C ${repoRoot} worktree remove`)
    expect(r.out).toContain(`git -C ${repoRoot} branch -D feat/9`)
    expect(r.out).not.toMatch(/requeued/)
  })

  // La asimetría deliberada con --reopen: allí "no lo sé" se puede decir y
  // seguir; aquí la mutación ES la afirmación de ausencia.
  it('sin poder consultar git se NIEGA: no se declara ausente lo que no se ha mirado', () => {
    const fixture = JSON.stringify({ candLabels: ['status:in-progress'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--requeue', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture,
      FAKE_GIT_WORKTREE_LIST_FAIL: '1',
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/no se ha podido comprobar/i)
    expect(r.out).toMatch(/No se declara ausente lo que no se ha podido mirar/)
    expect(r.out).not.toMatch(/requeued/)
  })

  it('sobre un in-review se NIEGA y manda al camino correcto (--reopen), sin tocar labels', () => {
    const repoRoot = tmp()
    const fixture = JSON.stringify({ candLabels: ['status:in-review'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--requeue', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture,
      FAKE_GIT_TOPLEVEL: repoRoot,
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/su PR sigue abierto sin mergear/)
    expect(r.out).toMatch(/--reopen/)
    expect(r.out).toMatch(/No se ha tocado ninguna label/)
  })

  it('sobre algo YA ready lo dice como no-op, no como error', () => {
    const repoRoot = tmp()
    const fixture = JSON.stringify({ candLabels: ['status:ready'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--requeue', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture, FAKE_GIT_TOPLEVEL: repoRoot,
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/ya está en status:ready — no hay nada que devolver a la cola/)
  })

  it('con DOS labels de estado se NIEGA sin tocar ninguna (mismo criterio que --reopen)', () => {
    const repoRoot = tmp()
    const fixture = JSON.stringify({ candLabels: ['status:in-progress', 'status:ready'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--requeue', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture, FAKE_GIT_TOPLEVEL: repoRoot,
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/DOS o más labels de estado a la vez/)
    expect(r.out).not.toMatch(/requeued/)
  })

  it('la comprobación de disco ocurre ANTES de mutar, no después de soltar el token', () => {
    // Sin --dry-run y sin fixture el script mutaría de verdad; con el worktree
    // presente tiene que abortar antes de llegar ahí. Se comprueba con el
    // fixture (que ya impide la mutación) mirando que el mensaje de negativa
    // es el de disco y NO el de "no se pudo escribir".
    const repoRoot = tmp()
    mkdirSync(join(repoRoot, '.worktrees', '9'), { recursive: true })
    const fixture = JSON.stringify({ candLabels: ['status:in-progress'], openIssues: [], readback: [] })
    const r = runCheck(['9', '--repo', 'o/r', '--requeue', '--dry-run'], {
      CT_CLAIM_FIXTURE: fixture, FAKE_GIT_TOPLEVEL: repoRoot,
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/todavía tiene el worktree/)
  })

  it('--requeue con --reopen (o con --release) → error de uso, sin adivinar', () => {
    for (const otro of ['--reopen', '--release']) {
      const r = runCheck(['9', '--repo', 'o/r', '--requeue', otro, '--dry-run'])
      expect(r.code).toBe(2)
      expect(r.out).toMatch(/mutuamente excluyentes/)
    }
  })
})

// ============================================================================
// H2 — /ct-groom valida el Project ANTES de crear nada. Ahora sí.
// ============================================================================
const SPEC = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | – | api | db |
`

function groomRun(extraEnv, args = []) {
  const dir = tmp('ct-f15-groom-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, SPEC)
  const argvLog = join(dir, 'argv.log')
  const r = spawnSync('node', [ctGroom, spec, '--repo', 'o/r', '--milestone', 'Epic', '--project', '5', ...args], {
    encoding: 'utf8',
    stdio: QUIET,
    env: {
      ...process.env,
      PATH: fakePath,
      FAKE_GH_MILESTONES_LIST: '[]',          // no existe → se CREARÍA
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      FAKE_GH_LABELS_LIST: '[[]]',            // repo sin labels → se CREARÍAN todas
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      ...extraEnv,
    },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), log: existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : '' }
}

describe('F15/H2 — si /ct-groom aborta validando el Project, no ha creado NADA', () => {
  // LO OBSERVADO CONTRA EL CÓDIGO SIN ARREGLAR (mismo stub, mismo spec): el
  // argv log salía
  //     api repos/o/r/milestones --method GET …
  //     api repos/o/r/milestones -f title=Epic      ← milestone CREADO
  //     label create type:backend …                 ← 4 labels CREADAS
  //     project view 5 --owner o --format json      ← y AQUÍ abortaba
  // con "milestone creado: Epic (#1)" ya impreso en stdout. La "basura a
  // medias" que la documentación no desmentía era real.
  it('sin campo Sprint: aborta sin crear el milestone ni ninguna label', () => {
    const r = groomRun({ FAKE_GH_PROJECT_FIELDS: '[]' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no tiene un campo de iteración llamado "Sprint"/)
    expect(r.log).not.toMatch(/milestones -f title=/)   // ninguna creación
    expect(r.log).not.toMatch(/label create/)
    expect(r.out).not.toMatch(/milestone creado/)
  })

  it('sin iteración vigente: aborta sin crear el milestone ni ninguna label', () => {
    const viejo = JSON.stringify([{ id: 'F', name: 'Sprint', configuration: { iterations: [{ id: 'I', title: 'Sprint 1', startDate: '2020-01-06', duration: 14 }] } }])
    const r = groomRun({ FAKE_GH_PROJECT_FIELDS: viejo })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no tiene una iteración vigente/)
    expect(r.log).not.toMatch(/milestones -f title=/)
    expect(r.log).not.toMatch(/label create/)
  })

  it('si el project ni se puede leer: tampoco crea nada', () => {
    const r = groomRun({ FAKE_GH_PROJECT_VIEW_FAIL: '1' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se pudo leer el project/)
    expect(r.log).not.toMatch(/milestones -f title=/)
    expect(r.log).not.toMatch(/label create/)
  })

  // La otra mitad: con el project sano, el orden sigue siendo el de siempre y
  // todo se crea. Sin esto, "no crea nada" se podría satisfacer no creando
  // nunca nada.
  it('con el project sano sí crea, y toda la validación queda por delante de la primera escritura', () => {
    const r = groomRun({})
    expect(r.code).toBe(0)
    const idx = (re) => r.log.split('\n').findIndex((l) => re.test(l))
    const validacion = idx(/^project view 5/)
    const milestoneCreado = idx(/^api repos\/o\/r\/milestones -f title=/)
    const labelCreada = idx(/^label create /)
    const issueCreado = idx(/^issue create /)
    expect(validacion).toBeGreaterThanOrEqual(0)
    expect(milestoneCreado).toBeGreaterThan(validacion)
    expect(labelCreada).toBeGreaterThan(validacion)
    expect(issueCreado).toBeGreaterThan(validacion)
  })

  // Y la garantía hermana, la que hace recuperable un fallo A MITAD de las
  // escrituras (que sí puede pasar y no se promete evitar): volver a correr no
  // duplica nada.
  it('re-correr con el milestone ya existente no lo duplica (idempotencia, el otro medio camino)', () => {
    const r = groomRun({ FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]) })
    expect(r.code).toBe(0)
    expect(r.log).not.toMatch(/milestones -f title=/)
    expect(r.out).toMatch(/milestone ya existe/)
  })
})

// ============================================================================
// H3 — el fichero del porqué admite el porqué.
// ============================================================================
describe('F15/H3 — el acuse admite explicación humana sin dejar de avisar', () => {
  // LO OBSERVADO CONTRA EL CÓDIGO SIN ARREGLAR: este mismo fichero producía 3
  // avisos de "no silencia nada", uno por cada línea del preámbulo. Meterlo
  // entre <!-- y --> producía 4 (las tres de dentro más la del `-->`), porque
  // solo se saltaba la línea que EMPEZABA por `<!--`.
  const conPreambulo = [
    '# Convenciones acusadas',
    '',
    'Este repo traía su propio protocolo de claim desde 2025, en',
    'scripts/dispatch-check.sh. Se discutió el 2026-07-20 y la decisión es que',
    'manda el claim del plugin; el del repo se queda para trabajo a mano.',
    '',
    'claim: 2026-07-28 — manda el claim del plugin',
    'worktrees: 2026-07-28 — el loop crea los suyos bajo .worktrees/',
  ].join('\n')

  it('un preámbulo en prosa ya no produce ni un aviso, y los acuses siguen valiendo', () => {
    const { acks, problems, prosaSinAcuses } = parseAcks(conPreambulo)
    expect(problems).toEqual([])
    expect([...acks.keys()]).toEqual(['claim', 'worktrees'])
    expect(prosaSinAcuses).toBe(false)
  })

  it('un comentario HTML de varias líneas se salta ENTERO, incluida la del cierre', () => {
    const { acks, problems } = parseAcks('<!--\nrazonamiento\nlargo\n-->\nclaim: 2026-07-28 — motivo\n')
    expect(problems).toEqual([])
    expect([...acks.keys()]).toEqual(['claim'])
  })

  // LA PROPIEDAD QUE NO SE PUEDE PERDER: lo que PRETENDÍA ser un acuse y no
  // parsea sigue avisando. Tres formas distintas de romperlo.
  it('un acuse con la señal mal escrita (typo) sigue avisando', () => {
    const { acks, problems } = parseAcks('Prosa de contexto cualquiera.\nclim: 2026-07-28 — motivo\n')
    expect(acks.size).toBe(0)
    expect(problems).toHaveLength(1)
    expect(problems[0].why).toMatch(/desconocida/)
  })

  it('un acuse sin dos puntos (roto del todo) sigue avisando', () => {
    const { problems } = parseAcks('Prosa de contexto cualquiera.\nclaim - 2026-07-28 — motivo\n')
    expect(problems).toHaveLength(1)
    expect(problems[0].why).toMatch(/forma/)
  })

  it('una señal desconocida con la forma exacta de un acuse sigue avisando', () => {
    const { problems } = parseAcks('worktree: 2026-07-28 — motivo\n')
    expect(problems).toHaveLength(1)
    expect(problems[0].why).toMatch(/desconocida/)
  })

  it('el sesgo ante la duda es AVISAR: una señal conocida sin fecha no pasa por prosa', () => {
    const { problems } = parseAcks('claim: manda el del plugin\n')
    expect(problems).toHaveLength(1)
    expect(problems[0].why).toMatch(/fecha/)
  })

  it('looksLikeAck: la frontera entre prosa y acuse roto', () => {
    for (const prosa of [
      'Contexto: en julio de 2026 se decidió retirar el script del repo.',
      'La decisión fue: seguir con el del plugin.',
      'Ver docs/agentic-workflow.md para el detalle.',
      'Nada que ver con esto.',
    ]) expect(looksLikeAck(prosa), prosa).toBe(false)

    for (const intento of [
      'claim: 2026-01-01 — x',
      '- claim: 2026-01-01 — x',
      'clim: 2026-01-01 — x',      // typo a distancia 1
      'worktree: 2026-01-01 — x',  // señal casi-válida
      'estado',                    // señal a secas, sin nada más
      'cualquiera: 2026-01-01 — x', // huella de fecha
    ]) expect(looksLikeAck(intento), intento).toBe(true)
  })

  // LA VOZ DEL SILENCIO NUEVO. Ignorar prosa crea un estado en que el fichero
  // existe, tiene contenido, y no silencia nada — el único en el que el humano
  // puede creer que ya lo decidió. Se dice.
  it('un fichero ENTERO de prosa no silencia nada, y eso se dice en voz alta', () => {
    const { acks, problems, prosaSinAcuses } = parseAcks('Decidimos retirar el script del repo.\nY ya está.\n')
    expect(acks.size).toBe(0)
    expect(problems).toEqual([])
    expect(prosaSinAcuses).toBe(true)

    const docs = [{ path: 'AGENTS.md', content: '## Claim\nPrimer paso del agente: `./scripts/dispatch-check.sh <issue#>`\n' }]
    const text = formatFindings(detectConventions({ docs, files: [] }), { ackProsaSinAcuses: true })
    expect(text).toContain(ACK_PATH)
    expect(text).toMatch(/NO silencia ninguna señal/)
    expect(text).toMatch(/todo lo que hay dentro se ha leído como prosa/)
  })

  it('un fichero vacío o solo con encabezados NO dispara ese aviso (no hay a quién engañar)', () => {
    expect(parseAcks('').prosaSinAcuses).toBe(false)
    expect(parseAcks('# Acuses\n\n').prosaSinAcuses).toBe(false)
  })

  it('el aviso vivo invita a escribir prosa (si no, nadie sabe que ahora se puede)', () => {
    const docs = [{ path: 'AGENTS.md', content: '## Claim\nPrimer paso del agente: `./scripts/dispatch-check.sh <issue#>`\n' }]
    const text = formatFindings(detectConventions({ docs, files: [] }))
    expect(text).toMatch(/prosa libre/)
  })
})
