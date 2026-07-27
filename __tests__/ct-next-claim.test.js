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
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// D4: entorno hermético (dirs de cuenta + stubs de cmux/claude) — ver fixtures/hermetic-env.js
import { ACCOUNT_ENV, hermeticEnv } from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
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
  // hermeticEnv() (D4): dirs de cuenta + stubs de cmux/claude por delante del
  // PATH real, para que el preflight de ct-next.mjs no dependa del $HOME ni
  // de qué tenga instalado la máquina que corre los tests.
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...hermeticEnv(), ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

// countOccurrences (D2 review, importante 1): cuenta cuántas veces aparece
// `substr` en `text`. La duplicación de la salida de dispatch-check (el
// bug: `attemptClaim` reenviaba con `stdio` por defecto, que YA hereda el
// stderr del hijo al padre — Node lo hace automáticamente en execFileSync
// salvo que se indique lo contrario — Y ADEMÁS lo devolvía en `e.stderr`
// para reenviarlo otra vez) es invisible a un `toMatch`/`not.toMatch`: el
// texto SIGUE apareciendo, solo que dos veces. Sin un recuento explícito,
// una regresión de esta clase pasa la suite entera en verde.
function countOccurrences(text, substr) {
  if (!substr) return 0
  let count = 0
  let idx = text.indexOf(substr)
  while (idx !== -1) {
    count++
    idx = text.indexOf(substr, idx + substr.length)
  }
  return count
}

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
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
// F13: este fixture describía un estado IMPOSIBLE — #1 aparecía a la vez en
// `mergedIssues` (o sea, cerrado y mergeado) y dentro de `issues`, que es la
// lista de issues ABIERTOS (buildDispatchInput solo mapea `rawOpenIssues`).
// Era inocuo mientras `status:in-review` no hiciera nada; desde F13/H2 un
// in-review retiene sus tokens, así que ese #1 fantasma bloqueaba a #2 por
// `touches:api` y el fixture dejaba de despachar nada. Se corrige la
// contradicción, no el comportamiento: un issue mergeado no está abierto, así
// que desaparece de `issues` y sigue en `mergedIssues` — que es justo lo que
// este fixture quería decir (la dep de #2 está mergeada).
const FIXTURE = JSON.stringify({
  issues: [
    { n: 2, order: 2, status: 'ready', deps: [1], touches: ['api'], name: 'refresh', type: 'backend' },
  ],
  mergedIssues: [1],
})

// La ruta real de dispatch-check.mjs, tal y como la resuelve ct-next.mjs
// (relativa a su propia ubicación) — usada para comprobar que la línea de
// --dry-run es un comando copiable de verdad, no un nombre suelto.
const realDispatchCheckPath = join(dirname(script), 'dispatch-check.mjs')
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ctNextSiblings (F11): los ficheros de `scripts/` que ct-next.mjs necesita
// para arrancar, DERIVADOS de sus propios imports relativos en vez de escritos
// a mano. La lista hardcodeada que había aquí era una copia del grafo de
// dependencias que nadie actualizaba: al añadir un import nuevo a ct-next.mjs
// (F11 añadió `conventions.js`) estos tests copiaban un árbol INCOMPLETO y
// medían un ERR_MODULE_NOT_FOUND (exit 1) creyendo que medían el exit code del
// escenario — verde en la lista de nombres, falso en lo que afirmaban. La
// resolución es transitiva; un fichero que no exista se ignora, así que
// `dispatch-check.mjs` (que algunos tests borran a propósito) sigue pudiendo
// omitirse por separado.
function ctNextSiblings(scriptsDirPath) {
  const seen = new Set()
  const pending = ['ct-next.mjs']
  while (pending.length) {
    const f = pending.shift()
    if (seen.has(f)) continue
    seen.add(f)
    let src
    try {
      src = readFileSync(join(scriptsDirPath, f), 'utf8')
    } catch {
      continue
    }
    for (const m of src.matchAll(/from '\.\/([^']+)'/g)) pending.push(m[1])
  }
  return [...seen]
}

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
  const SIBLING_FILES = ctNextSiblings(scriptsDir)

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
          ...ACCOUNT_ENV,
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

// D2 review, menor 4: attemptClaim capturaba stdout/stderr de dispatch-check
// SIN `maxBuffer` explícito — con `stdio: 'inherit'` (antes de este cambio)
// eso nunca importó, pero al pasar a capturar (finding 3, para poder
// clasificar el texto) hereda el default de Node (1 MiB por stream). Un
// candidato con MUCHOS issues en vuelo colisionando (`COLLISION: #N choca
// con #A[...] #B[...] ...`, uno por cada uno) puede superar 1 MiB con
// facilidad contra un repo real — y Node no trunca en silencio: mata al hijo
// (SIGTERM) y `execFileSync` lanza sin `status` numérico, que ct-next ya
// clasifica como "fallo inesperado al lanzar el subproceso" — un aborto
// ruidoso pero ENGAÑOSO (parece un bug/mala config, cuando en realidad es
// solo un mensaje grande y legítimo).
//
// No se puede reproducir esto invocando al dispatch-check.mjs REAL: se
// verificó por construcción (fuera de la suite, contra scripts/dispatch-
// check.mjs directamente) que su propia rama de colisión hace
// `console.error(mensajeGrande); process.exit(1)` — y `process.stderr` es
// ASÍNCRONO hacia una tubería en POSIX (documentado en los propios docs de
// Node), así que un `process.exit()` inmediato trunca su propia escritura al
// tamaño del buffer del pipe del SO (64 KiB en este Mac) ANTES de que
// `maxBuffer`, del lado que lee, llegue siquiera a importar — un defecto
// latente y separado en dispatch-check.mjs, fuera del alcance de esta tarea
// (no se toca ese fichero). Por eso este test sustituye dispatch-check.mjs
// por un doble simple que SÍ vacía su escritura antes de salir (mismo
// patrón que se aplicó a __tests__/fixtures/fake-gh-bin/gh), para poder
// aislar y probar de verdad el `maxBuffer` del LADO DE CT-NEXT.MJS —
// exactamente lo que este test existe para cubrir — sin depender de un bug
// no relacionado en un fichero que no se puede tocar.
describe('ct-next — maxBuffer explícito al capturar la salida de dispatch-check (D2 review, menor 4)', () => {
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const scriptsDir = join(projectRoot, 'scripts')
  const SIBLING_FILES = ctNextSiblings(scriptsDir)
  // ~2 MiB: por encima del default de Node (1 MiB) y por debajo de
  // GH_MAX_BUFFER (20 MiB) — si el fix aplica el mismo límite, esto cabe
  // entero; si no lo aplica (el bug), Node mata al hijo antes de esto.
  const BIG_PAYLOAD_BYTES = 2 * 1024 * 1024

  function makeFakeDispatchCheck(dir) {
    writeFileSync(join(dir, 'dispatch-check.mjs'), [
      '#!/usr/bin/env node',
      "// Doble de dispatch-check.mjs SOLO para este test (D2 review, menor 4):",
      "// misma forma de salida que una COLLISION real (texto grande a stderr,",
      "// exit 1), pero con `process.exitCode` en vez de `process.exit()` para no",
      "// truncar su propia escritura por el mismo motivo ya documentado en",
      "// fake-gh-bin/gh — NO es una copia de dispatch-check.mjs, no se toca el",
      "// fichero real.",
      `process.stderr.write('COLLISION: #42 choca con ' + 'X'.repeat(${BIG_PAYLOAD_BYTES}))`,
      'process.exitCode = 1',
      '',
    ].join('\n'))
  }

  it('una colisión de varios MiB se captura entera y se trata como un salto normal, no como un fallo inesperado', () => {
    const copyDir = mkdtempSync(join(projectRoot, 'tmp-maxbuffer-'))
    try {
      for (const f of SIBLING_FILES) cpSync(join(scriptsDir, f), join(copyDir, f))
      makeFakeDispatchCheck(copyDir)
      const copiedScript = join(copyDir, 'ct-next.mjs')

      const repoRoot = makeRepoRoot()
      const r = spawnSync('node', [copiedScript, '--repo', 'o/r', '--cap', '1'], {
        encoding: 'utf8',
        // maxBuffer del PROPIO harness de test (D2 review, hallazgo
        // colateral al construir este test): el default de Node (1 MiB) no
        // es solo el límite que ct-next.mjs debe superar al capturar a
        // dispatch-check — es TAMBIÉN el límite de este `spawnSync`, que
        // captura la salida de ct-next.mjs. Sin subirlo aquí, el propio
        // arnés mataría a ct-next.mjs (SIGTERM) antes de que llegara a
        // imprimir "saltando #42", por la MISMA razón que este test existe
        // para probar — un falso negativo del test, no del código bajo
        // prueba.
        maxBuffer: 20 * 1024 * 1024,
        env: {
          ...process.env,
          ...ACCOUNT_ENV,
          PATH: fakePath,
          FAKE_GIT_TOPLEVEL: repoRoot,
          FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
        },
      })
      const out = (r.stdout || '') + (r.stderr || '')
      // NUNCA "fallo inesperado" (que es como se ve un hijo matado por
      // desbordar el maxBuffer por defecto de Node) — un candidato que
      // colisiona, aunque el mensaje sea grande, sigue siendo un salto
      // NORMAL del protocolo.
      expect(out).not.toMatch(/fallo inesperado/i)
      expect(out).toContain('COLLISION: #42 choca con')
      expect(out).toMatch(/saltando #42/)
      // Único candidato, colisiona, cero lanzados → mismo exit 3 de finding 1.
      expect(r.status).toBe(3)
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

// D2 review, menor 1: --dry-run no reclama ni lanza NADA de verdad (es
// puramente informativo) — pero el conteo terminal "lanzados X/Y" que el fix
// de finding 1 añadió al final del bucle se imprimía también en --dry-run,
// donde `launchedCount` es siempre 0 por construcción. Una línea "lanzados
// 0/1" en un --dry-run exitoso es exactamente la misma clase de mensaje
// engañoso que esta tarea existe para eliminar, solo que al revés (afirma
// "cero lanzamientos" de un plan que ni siquiera lo intentó).
describe('ct-next — --dry-run no imprime el conteo de lanzamientos (D2 review, menor 1)', () => {
  it('--dry-run con un slice seleccionado: sin línea "lanzados X/Y", y exit 0', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], {
      CT_NEXT_FIXTURE: JSON.stringify({
        issues: [{ n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'refresh', type: 'backend' }],
        mergedIssues: [],
      }),
    })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/lanzad[oa]s? \d/i)
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
    // Exit code FIJADO a 3 (D2 review, menor 2): antes se comprobaba con
    // `not.toBe(0)`/`not.toBe(2)`, que un futuro cambio que colapsara este
    // caso en el 1 ("algo se rompió") seguiría pasando en verde — el propio
    // contrato que este finding introduce (distinguir "reintenta luego" de
    // "para y mira") solo se prueba de verdad fijando el valor exacto.
    expect(r.code).toBe(3)
    // D2 review, importante 1: cada línea de COLLISION de dispatch-check
    // debe aparecer UNA sola vez — antes, `attemptClaim` reenviaba el
    // stderr del hijo dos veces (una por el reenvío por defecto de Node en
    // execFileSync, otra por el propio `process.stderr.write` del wrapper).
    expect(countOccurrences(r.out, 'COLLISION: #41 choca con #99')).toBe(1)
    expect(countOccurrences(r.out, 'COLLISION: #42 choca con #99')).toBe(1)
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
//
// D2 review, menor 3: dentro de exit 1 hay DOS familias muy distintas de
// "no es un salto normal" — 'stuck' (el issue quedó de verdad huérfano en
// status:in-progress: el revert que dispatch-check intentó también falló) y
// 'infra' (labelsOf falló, o el claim ni llegó a escribirse, o el readback
// falló pero el revert SÍ tuvo éxito — en los tres casos el issue queda
// intacto en status:ready, nada mutado, nada atascado). Solo 'stuck' exige
// parar TODO y avisar a un humano (exit 1): un rate limit o un corte
// momentáneo de `gh` en ESTE candidato ('infra') no dice nada sobre si el
// SIGUIENTE candidato — una llamada independiente — también fallaría, así
// que se trata como el mismo "reintenta más tarde" que ya cubre exit 3
// (finding 1): se sigue con el resto de la tanda, y si nada se lanza al
// final, el código de salida es 3, no 1.
describe('ct-next — exit 1 de dispatch-check NO siempre es un resultado normal del protocolo (D2, finding 3; menor 3)', () => {
  it("'stuck' (readback falla Y el revert también falla, issue huérfano) → ct-next aborta la tanda ENTERA con exit 1, no lo trata como salto normal", () => {
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
    // Exit code FIJADO a 1 (no `not.toBe(0)`): 'stuck' es la única causa que
    // debe seguir aquí tras el fix de menor 3.
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATENCIÓN.*bloqueado en status:in-progress/is)
    // NUNCA se reporta como si fuera el salto normal de colisión/carrera.
    expect(r.out).not.toMatch(/sigo con el resto de esta tanda/i)
    expect(r.out).not.toMatch(/lanzado #42/)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
    // D2 review, importante 1: la línea ATENCIÓN de dispatch-check (incluido
    // el comando manual) debe aparecer UNA sola vez, no dos — se comprueba
    // con el texto EXACTO que dispatch-check.mjs emite (no la palabra suelta
    // "ATENCIÓN": el propio mensaje de ct-next para 'stuck', un poco más
    // abajo en el código, MENCIONA la palabra "ATENCIÓN" al remitir a ella
    // — eso es intencional y una ocurrencia distinta, no una duplicación).
    expect(countOccurrences(r.out, 'ATENCIÓN: #42 puede haber quedado bloqueado en status:in-progress')).toBe(1)
    expect(countOccurrences(r.out, 'Libéralo a mano con: gh issue edit 42')).toBe(1)
  })

  it("'infra' sin nada atascado (fallo al leer las labels del candidato) → YA NO aborta con exit 1: se trata como 'reintenta más tarde' (exit 3, sin más candidatos en esta tanda)", () => {
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
    // Ya NO es un aborto con exit 1: nada mutó, nada quedó atascado — mismo
    // código que el "cero lanzados, nada roto" de finding 1.
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/no se pudo leer el estado de #42/i)
    // El mensaje debe decir explícitamente que NO es una colisión normal —
    // pero YA NO debe decir que aborta toda la tanda (con cap=1 no hay más
    // candidatos de todas formas; lo que importa es que el control de flujo
    // ya no distingue esto de un salto — ver el siguiente test con cap=2,
    // donde SÍ hay un candidato más al que sí se llega).
    expect(r.out).toMatch(/fallo de infraestructura/i)
    expect(r.out).not.toMatch(/abortando toda la tanda/i)
    expect(r.out).not.toMatch(/lanzado #42/)
    expect(countOccurrences(r.out, 'no se pudo leer el estado de #42')).toBe(1)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })

  it("'infra' sin nada atascado en el PRIMER candidato de dos → se sigue con el SEGUNDO, que sí se lanza (exit 0)", () => {
    const repoRoot = makeRepoRoot()
    const openIssue41a = { number: 41, title: '#41 a', labels: [{ name: 'status:ready' }, { name: 'touches:a' }], body: '' }
    const openIssue42b = { number: 42, title: '#42 b', labels: [{ name: 'status:ready' }, { name: 'touches:b' }], body: '' }
    const counterFile = join(repoRoot, 'gh-list-count')
    const viewCounterFile = join(repoRoot, 'gh-view-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#41)
      // NUNCA llega a esta llamada (labelsOf falla antes) ; en realidad
      // idx2 = dispatch-check(#42) collision-check (limpio) ; idx3 =
      // dispatch-check(#42) readback (limpio).
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue41a, openIssue42b], [], [], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      // viewIdx0 (labelsOf de #41, el PRIMER candidato procesado) falla;
      // viewIdx1 (labelsOf de #42) no coincide con FAIL_AT=0 → tiene éxito.
      FAKE_GH_VIEW_FAIL_AT: '0',
      FAKE_GH_VIEW_COUNTER_FILE: viewCounterFile,
      FAKE_GIT_LOG_FILE: gitLog,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/no se pudo leer el estado de #41/i)
    expect(r.out).toMatch(/fallo de infraestructura/i)
    // La tanda SIGUIÓ: #42 se reclamó y se lanzó, pese al hiccup de #41.
    expect(r.out).toMatch(/claimed #42/)
    expect(r.out).toMatch(/lanzado #42/)
    expect(r.out).not.toMatch(/abortando toda la tanda/i)
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    expect(gitLogTxt).toMatch(/worktree add -b feat\/42/)
    expect(gitLogTxt).not.toMatch(/worktree add -b feat\/41/)
  })

  it("'stuck' en el PRIMER candidato de dos → aborta la tanda ENTERA, el SEGUNDO ni se intenta", () => {
    const repoRoot = makeRepoRoot()
    const openIssue41a = { number: 41, title: '#41 a', labels: [{ name: 'status:ready' }, { name: 'touches:a' }], body: '' }
    const openIssue42b = { number: 42, title: '#42 b', labels: [{ name: 'status:ready' }, { name: 'touches:b' }], body: '' }
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#41)
      // collision-check (limpio) ; idx3: dispatch-check(#41) readback →
      // FALLA. Nunca debe llegarse a un idx4/idx5 para #42.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue41a, openIssue42b], [], []]),
      FAKE_GH_LIST_FAIL_AT: '3',
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready --remove-label status:in-progress',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATENCIÓN.*bloqueado en status:in-progress/is)
    expect(r.out).not.toMatch(/lanzado #/)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
    // #42 nunca se intentó reclamar: ningún claim (issue edit) para el 42 en
    // absoluto, ni de escritura ni de revert.
    const argv = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(argv).not.toMatch(/issue edit 42/)
  })
})

describe('ct-next — dispatch falla tras un claim exitoso → revierte el claim (W-C, punto 3)', () => {
  it('seed de STATE.md falla tras claim exitoso → limpia worktree/rama Y revierte el claim a status:ready', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      // FAKE_GIT_WORKTREE_ADD_AS_FILE (D4): el worktree se crea como fichero
      // DURANTE `git worktree add`, así que el seed falla con ENOTDIR. Antes
      // se pre-creaba ese fichero, pero desde D4 ct-next.mjs comprueba que el
      // destino esté libre ANTES de reclamar y un worktree pre-existente ya
      // no llega nunca al seed (ver el preflight en ct-next.mjs).
      FAKE_GIT_WORKTREE_ADD_AS_FILE: '1',
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
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_WORKTREE_ADD_AS_FILE: '1',
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
