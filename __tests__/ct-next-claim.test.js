// W-C: /ct-next debe reclamar cada slice (dispatch-check.mjs, status:ready →
// status:in-progress) ANTES de crear su worktree, saltar el slice si el claim
// falla por colisión/carrera perdida (exit 1) pero seguir con el resto de la
// tanda, abortar TODA la tanda ante un fallo inesperado de dispatch-check
// (exit distinto de 0/1), y revertir el claim si el dispatch falla DESPUÉS de
// reclamar (git worktree add, seed de STATE.md, o cmux) — para no dejar el
// issue huérfano en status:in-progress sin nadie trabajándolo. Ver el brief
// de W-C y el comentario de cabecera de scripts/dispatch-check.mjs (T11) para
// la advertencia honesta sobre por qué esto NO cierra el hueco de
// compare-and-swap: solo evita el caso, mucho más común, de que /ct-next
// nunca llame a dispatch-check en absoluto.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  process.env.PATH,
].join(':')

// spawnSync (no execFileSync): execFileSync solo devuelve stdout cuando el
// hijo sale con éxito (exit 0) — su stderr, en ese caso, NUNCA llega a
// `e.stderr` porque no hay excepción que capturarlo. Varios escenarios de
// W-C terminan en exit 0 general (la tanda progresa) pero con un mensaje de
// aviso (p.ej. "saltando #42...") impreso por console.error — con
// execFileSync esas aserciones pasarían en falso por falta de ese texto.
// spawnSync siempre expone stdout/stderr por separado, exista o no excepción.
function run(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, PATH: fakePath, ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-claim-'))
  dirs.push(d)
  return d
}

const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }

// El fixture atado a --dry-run (CT_NEXT_FIXTURE) ya selecciona #2 sin tocar
// red — reutilizado tal cual de ct-next-dryrun.test.js para la parte de
// visibilidad en --dry-run (punto 5 del brief de W-C).
const FIXTURE = JSON.stringify({
  issues: [
    { n: 1, order: 1, status: 'in-review', deps: [], touches: ['api'], name: 'login', type: 'backend' },
    { n: 2, order: 2, status: 'ready', deps: [1], touches: ['api'], name: 'refresh', type: 'backend' },
  ],
  mergedIssues: [1],
})

// La ruta real de dispatch-check.mjs, tal y como la resuelve ct-next.mjs
// (relativa a su propia ubicación) — usada para comprobar que la línea de
// --dry-run es un comando copiable de verdad, no un nombre suelto.
const realDispatchCheckPath = join(dirname(script), 'dispatch-check.mjs')
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('ct-next — --dry-run muestra el claim sin ejecutarlo (W-C, punto 5; fix round 1, minor: línea copiable y guarda real)', () => {
  it('imprime el comando REAL y copiable (node <ruta> <issue> --repo <repo>), y deja claro que no se ejecuta', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(new RegExp(`node ${escapeRegExp(realDispatchCheckPath)} 2 --repo menoplus-app/menoplus`))
    expect(r.out).toMatch(/no se ejecuta/i)
  })

  // Fix round 1, minor: el test de arriba solo comprueba la FORMA del texto
  // impreso — una regresión que SÍ invocara dispatch-check.mjs de verdad en
  // --dry-run seguiría en verde mientras el texto pareciera correcto, aunque
  // esa invocación intentara hablar con `gh` real contra
  // menoplus-app/menoplus. Se pasa por runReal() (PATH con los stubs) +
  // FAKE_GH_ARGV_LOG_FILE y se comprueba que NUNCA se registra un `gh issue
  // edit` — eso es una guarda de comportamiento, no de formato.
  it('NUNCA invoca dispatch-check.mjs de verdad en --dry-run: ningún `gh issue edit` queda registrado', () => {
    const repoRoot = makeRepoRoot()
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], {
      CT_NEXT_FIXTURE: FIXTURE,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(r.code).toBe(0)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/)
  })
})

describe('ct-next — claim exitoso antes de dispatch (W-C, punto 1)', () => {
  it('dispatch-check exit 0 → procede con el dispatch normal, y la orden de invocación es claim → worktree', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/claimed #42/i)
    expect(r.out).toMatch(/lanzado #42/)
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 42 --repo o\/r --add-label status:in-progress --remove-label status:ready/)
    // el claim (gh) sucede ANTES de crear el worktree (git)
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    const claimIdx = argv.indexOf('issue edit 42 --repo o/r --add-label status:in-progress')
    expect(claimIdx).toBeGreaterThan(-1)
    expect(gitLogTxt).toMatch(/worktree add -b feat\/42/)
  })
})

describe('ct-next — claim fallido (exit 1) salta el slice y sigue con el resto (W-C, punto 2)', () => {
  it('#42 colisiona (exit 1, se salta) y #43 sí se reclama y se despacha', () => {
    const repoRoot = makeRepoRoot()
    const openIssue43 = { number: 43, title: '#43 otro', labels: [{ name: 'status:ready' }], body: '' }
    const collidingRaw = { number: 99, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] }
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#42)
      // collision-check → colisiona ; idx3: dispatch-check(#43) collision-check
      // → limpio ; idx4: dispatch-check(#43) readback → limpio
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42, openIssue43], [], [collidingRaw], [], []]),
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/COLLISION|colisión/i) // mensaje propio de dispatch-check, surfaced tal cual
    expect(r.out).toMatch(/saltando #42/)
    expect(r.out).toMatch(/lanzado #43/)
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    expect(gitLogTxt).toMatch(/worktree add -b feat\/43/)
    expect(gitLogTxt).not.toMatch(/worktree add -b feat\/42/)
  })
})

describe('ct-next — fallo inesperado de dispatch-check (no exit 0/1) aborta TODA la tanda (W-C, punto 2)', () => {
  it('dispatch-check exit 2 (error de uso/config, simulado vía CT_CLAIM_PRECLAIM_DELAY_MS malformado) → aborta, no sigue con el resto', () => {
    const repoRoot = makeRepoRoot()
    const openIssue43 = { number: 43, title: '#43 otro', labels: [{ name: 'status:ready' }], body: '' }
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42, openIssue43], [], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      CT_CLAIM_PRECLAIM_DELAY_MS: 'not-a-number',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/fallo inesperado/i)
    expect(r.out).toMatch(/exit 2/)
    expect(r.out).toMatch(/abort/i)
    // Fix round 1, minor: el aborto puede dispararse DESPUÉS de haber
    // lanzado con éxito algún slice anterior de la misma tanda (cap > 1) —
    // igual que ya hace cleanupOrphanedWorktree, el mensaje de aborto tiene
    // que dejar explícito que esos slices siguen corriendo sin tocarse.
    expect(r.out).toMatch(/ya lanzados.*siguen corriendo.*no se han tocado/is)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/) // ni #42 ni #43 llegaron a crear worktree
  })
})

// Fix round 1 (review de W-C), finding 2 — IMPORTANT: si dispatch-check.mjs
// falta o se renombra, Node sale con exit 1 (MODULE_NOT_FOUND) — el MISMO
// exit code que dispatch-check.mjs usa para "colisión/carrera perdida". Sin
// una guarda dedicada, attemptClaim clasificaría esto como un resultado
// ESPERADO del protocolo: se saltarían TODOS los slices de la tanda
// ("saltando #N...") y el proceso terminaría con exit 0 sin haber
// despachado nada — un no-op silencioso que además contradice el propio
// mensaje de aborto de "fallo inesperado" (que dice cubrir justo este caso).
describe('ct-next — dispatch-check.mjs ausente (W-C, fix round 1, finding 2)', () => {
  // No se toca el scripts/dispatch-check.mjs REAL del repo (renombrarlo
  // temporalmente arriesgaría a cualquier otro fichero de test que lo
  // invoque directamente y que vitest pudiera correr en paralelo, en otro
  // worker). En su lugar se copian ct-next.mjs y SOLO los módulos hermanos
  // que de verdad importa (ninguno de ellos importa dispatch-check.mjs) a
  // un directorio temporal DENTRO del propio repo — para que la resolución
  // de "yaml" (que usa scripts/state.js) siga encontrando node_modules
  // subiendo directorios — y deliberadamente NO se copia dispatch-check.mjs:
  // así `dispatchCheckPath`, resuelto relativo a la nueva ubicación del
  // ct-next.mjs copiado, apunta a un fichero que de verdad no existe.
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const scriptsDir = join(projectRoot, 'scripts')
  const SIBLING_FILES = ['ct-next.mjs', 'dispatch.js', 'kickoff.js', 'shquote.js', 'gh-issue-map.js', 'gh-issues.js', 'state.js']

  it('dispatch-check.mjs no existe en la ruta resuelta → aborta al arrancar con esa ruta, ANTES de tratarlo como colisión', () => {
    const copyDir = mkdtempSync(join(projectRoot, 'tmp-missing-dispatch-check-'))
    try {
      for (const f of SIBLING_FILES) cpSync(join(scriptsDir, f), join(copyDir, f))
      const copiedScript = join(copyDir, 'ct-next.mjs')
      const expectedMissingPath = join(copyDir, 'dispatch-check.mjs')
      expect(existsSync(expectedMissingPath)).toBe(false) // precondición: de verdad no está

      const repoRoot = makeRepoRoot()
      const r = spawnSync('node', [copiedScript, '--repo', 'o/r', '--cap', '1'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: fakePath,
          FAKE_GIT_TOPLEVEL: repoRoot,
          FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
        },
      })
      const out = (r.stdout || '') + (r.stderr || '')
      expect(r.status).toBe(1)
      expect(out).toMatch(/no se encontró dispatch-check\.mjs/i)
      expect(out).toContain(expectedMissingPath)
      // Nunca debe leerse como "colisión" ni intentar saltar el slice: el
      // guard de arranque tiene que cortar ANTES de llegar ahí.
      expect(out).not.toMatch(/saltando #42/)
      expect(out).not.toMatch(/COLLISION/)
    } finally {
      rmSync(copyDir, { recursive: true, force: true })
    }
  })
})

// D2 (auditoría del dispatch), finding 2: en el path REAL (sin --dry-run) no
// se imprimía en ningún sitio la lista completa de slices seleccionados para
// esta tanda ANTES de intentar reclamarlos — si el proceso abortaba a medio
// camino, no había forma de saber, a posteriori, qué se había elegido en
// total (solo lo que se llegó a intentar). --dry-run sí lo deja ver de forma
// implícita (imprime un bloque por cada slice de `selected`, sin abortar
// nunca) — el fix imprime la selección completa explícitamente, up front, en
// AMBos paths.
describe('ct-next — la selección de la tanda se imprime up front también en el path real (D2, finding 2)', () => {
  it('antes de intentar ningún claim, ya se ve qué se seleccionó para esta tanda', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/seleccion.*#42/i)
    // Y aparece ANTES de que se intente el claim de verdad.
    const selIdx = r.out.search(/seleccion.*#42/i)
    const claimIdx = r.out.indexOf('claimed #42')
    expect(selIdx).toBeGreaterThan(-1)
    expect(claimIdx).toBeGreaterThan(-1)
    expect(selIdx).toBeLessThan(claimIdx)
  })
})

// D2, finding 1: cuando TODOS los slices seleccionados de la tanda se saltan
// a la hora de reclamar (cada uno choca de verdad, en vivo, contra trabajo
// que otro proceso reclamó justo después de que ct-next cargara su propia
// foto de issues — la misma advertencia honesta de "sin compare-and-swap"
// documentada en dispatch-check.mjs), el proceso terminaba en exit 0 sin
// ninguna traza de que cero agentes se lanzaron, y la última línea
// ("sigo con el resto de esta tanda") prometía continuar cuando ya no
// quedaba ningún candidato. Reproducción: cap=2, #41 y #42 no chocan ENTRE
// SÍ (así que ct-next los selecciona a los dos con su propia foto, que no ve
// a #99 en vuelo todavía) pero cada uno, por separado, choca de verdad
// contra #99 cuando dispatch-check hace su propia lectura en vivo.
describe('ct-next — TODOS los slices seleccionados se saltan al reclamar → no silencioso (D2, finding 1)', () => {
  it('cero lanzados de dos seleccionados → línea de conteo, wording sin promesa falsa, y exit distinto de 0', () => {
    const repoRoot = makeRepoRoot()
    const openIssue41x = { number: 41, title: '#41 x', labels: [{ name: 'status:ready' }, { name: 'touches:x' }], body: '' }
    const openIssue42y = { number: 42, title: '#42 y', labels: [{ name: 'status:ready' }, { name: 'touches:y' }], body: '' }
    const inFlight99 = { number: 99, labels: [{ name: 'status:in-progress' }, { name: 'touches:x' }, { name: 'touches:y' }] }
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open (sin #99 en vuelo todavía — la carrera es
      // exactamente que otro proceso lo reclama DESPUÉS de esta foto) ;
      // idx1: ct-next closed ; idx2: dispatch-check(#41) collision-check
      // (#99 YA en vuelo, comparte 'x') ; idx3: dispatch-check(#42)
      // collision-check (#99, comparte 'y').
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue41x, openIssue42y], [], [inFlight99], [inFlight99]]),
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:x', 'touches:y']),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
    })
    // Ningún worktree debió crearse: los dos candidatos se saltaron.
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
    expect(r.out).not.toMatch(/lanzado #/)
    // Conteo terminal explícito de cuántos de cuántos se lanzaron.
    expect(r.out).toMatch(/lanzad[oa]s? 0.*2/i)
    // #41 (no es el último) sigue diciendo que continúa con el resto.
    expect(r.out).toMatch(/saltando #41:.*sigo con el resto/i)
    // #42 (el ÚLTIMO candidato) YA NO promete "sigo con el resto" — no
    // queda nada con lo que seguir.
    expect(r.out).toMatch(/saltando #42:.*no quedan más candidatos/i)
    expect(r.out).not.toMatch(/saltando #42:.*sigo con el resto/i)
    // Exit code distinto de 0 (y de los ya usados para error de uso/aborto):
    // hubo una tanda seleccionada pero cero progreso real.
    expect(r.code).not.toBe(0)
    expect(r.code).not.toBe(2)
  })
})

// D2, finding 3: el comentario de dispatch-check.mjs llama a su exit 1
// "colisión o carrera perdida", pero el MISMO exit 1 también cubre un fallo
// de lectura de labels del candidato, un fallo al escribir el claim, y un
// fallo de readback — ct-next trataba los cinco exactamente igual ("saltando
// ... sigo con el resto"), incluso cuando el issue quedaba HUÉRFANO en
// status:in-progress (readback Y el revert posterior fallan a la vez, la
// peor combinación reproducida por el auditor). Estos tests fuerzan esa
// distinción desde el lado del caller, sin tocar dispatch-check.mjs.
describe('ct-next — exit 1 de dispatch-check NO siempre es un resultado normal del protocolo (D2, finding 3)', () => {
  it('readback falla Y el revert también falla (issue huérfano) → ct-next aborta la tanda, no lo trata como salto normal', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#42)
      // collision-check (limpio) ; idx3: dispatch-check(#42) readback → FALLA.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], [], []]),
      FAKE_GH_LIST_FAIL_AT: '3',
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      // El claim inicial (status:ready→in-progress) SÍ escribe con éxito; es
      // el revert POSTERIOR (in-progress→ready, tras el fallo de readback) el
      // que también falla — así el issue queda de verdad bloqueado.
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready --remove-label status:in-progress',
    })
    expect(r.code).not.toBe(0)
    expect(r.out).toMatch(/ATENCIÓN.*bloqueado en status:in-progress/is)
    // NUNCA se reporta como si fuera el salto normal de colisión/carrera.
    expect(r.out).not.toMatch(/sigo con el resto de esta tanda/i)
    expect(r.out).not.toMatch(/lanzado #42/)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })

  it('fallo al leer las labels del candidato (labelsOf) → ct-next lo trata como fallo, no como colisión normal', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_VIEW_FAIL: '1',
    })
    expect(r.code).not.toBe(0)
    expect(r.out).toMatch(/no se pudo leer el estado de #42/i)
    expect(r.out).not.toMatch(/sigo con el resto de esta tanda/i)
    expect(r.out).not.toMatch(/lanzado #42/)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })
})

describe('ct-next — dispatch falla tras un claim exitoso → revierte el claim (W-C, punto 3)', () => {
  it('seed de STATE.md falla tras claim exitoso → limpia worktree/rama Y revierte el claim a status:ready', () => {
    const repoRoot = makeRepoRoot()
    mkdirSync(join(repoRoot, '.worktrees'), { recursive: true })
    writeFileSync(join(repoRoot, '.worktrees', '42'), '') // fuerza ENOTDIR en el seed
    const counterFile = join(repoRoot, 'gh-list-count')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se pudo sembrar \.agent\/STATE\.md/)
    expect(r.out).toMatch(/limpiados automáticamente/)
    expect(r.out).not.toMatch(/ATENCIÓN/)
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 42 --repo o\/r --add-label status:in-progress --remove-label status:ready/)
    expect(argv).toMatch(/issue edit 42 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })

  it('seed de STATE.md falla Y el revert del claim también falla → ATENCIÓN con el comando manual exacto', () => {
    const repoRoot = makeRepoRoot()
    mkdirSync(join(repoRoot, '.worktrees'), { recursive: true })
    writeFileSync(join(repoRoot, '.worktrees', '42'), '')
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready', // el revert falla; el claim inicial (status:in-progress) no
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATENCIÓN.*no se pudo limpiar automáticamente.*claim/is)
    expect(r.out).toMatch(/gh issue edit 42 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })

  it('cmux falla tras claim exitoso (seed sí escrito) → limpia y revierte el claim', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_CMUX_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se pudo lanzar cmux/)
    expect(r.out).toMatch(/limpiados automáticamente/)
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 42 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })

  it('git worktree add falla tras claim exitoso → revierte el claim automáticamente (sin worktree/rama que limpiar)', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_WORKTREE_ADD_FAIL: '1',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se pudo crear el worktree/)
    expect(r.out).toMatch(/revertido/i)
    expect(r.out).not.toMatch(/ATENCIÓN/)
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 42 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })

  it('git worktree add falla Y el revert del claim también falla → ATENCIÓN con el comando manual exacto', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_WORKTREE_ADD_FAIL: '1',
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATENCIÓN.*no se pudo revertir.*claim/is)
    expect(r.out).toMatch(/gh issue edit 42 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })
})
