// D5 — "mensajes que afirman lo contrario de lo ocurrido".
//
// Todos los casos de este fichero se REPRODUJERON primero contra el código
// sin arreglar (main @ ab2d697) antes de tocar nada, y cada test se comprobó
// EN ROJO contra ese mismo código: si no falla ahí, no prueba nada. El
// detalle de cada reproducción está en el informe de la tarea.
//
// Familia común: algo diverge de lo que el usuario cree y el sistema informa
// de éxito, o el mensaje afirma algo que no es cierto.
import { describe, it, expect, afterEach } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
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

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
})
function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-d5-'))
  dirs.push(d)
  return d
}

function runReal(args, envOverrides = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: fakePath, ...envOverrides },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const openIssue90 = { number: 90, title: '#90 algo', labels: [{ name: 'status:ready' }], body: '' }
const openIssue91 = { number: 91, title: '#91 otro', labels: [{ name: 'status:ready' }], body: '' }

function baseEnv(repoRoot, issues = [openIssue90]) {
  return {
    FAKE_GIT_TOPLEVEL: repoRoot,
    FAKE_GH_LIST_SEQUENCE: JSON.stringify([issues, []]),
    FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    FAKE_GH_ARGV_LOG_FILE: join(repoRoot, 'gh-argv'),
    FAKE_GIT_LOG_FILE: join(repoRoot, 'git-log'),
  }
}
const readOrEmpty = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

// ---------------------------------------------------------------------------
// Hallazgo B — un campo de esquema no reconocido no puede degradar a
// "verificado que está mal"
// ---------------------------------------------------------------------------
describe('D5/B — cmux renombra SOLO `current_directory`', () => {
  // Reproducido contra el código sin arreglar con este mismo fixture: la
  // salida decía `está en "null" en su lugar` (un falso 'wrong-cwd' en CADA
  // lanzamiento correcto) y la corrida salía con EXIT=3 en vez de 0. La
  // guarda de esquema anterior solo cubría `custom_title`, que aquí se sigue
  // reconociendo, así que no salvaba nada.
  it('no lo trata como cwd equivocado: la sesión existe, el directorio es lo único que no se pudo comprobar', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      ...baseEnv(repoRoot),
      FAKE_CMUX_CWD_FIELD_RENAMED: '1',
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/lanzados 1\/1 slice\(s\) seleccionados de esta tanda/)
    expect(r.out).toMatch(/la sesión de cmux con el título esperado EXISTE, pero cmux no expuso un directorio legible/)
    // Nunca la falsa alarma, ni el "verificado" que tampoco se puede afirmar.
    expect(r.out).not.toMatch(/la sesión NO está en/)
    expect(r.out).not.toMatch(/NO se cuenta como lanzado con éxito/)
    expect(r.out).not.toMatch(/verificado: la sesión cmux está corriendo/)
    expect(r.out).not.toMatch(/LANZADOS SIN VERIFICAR/)
  })

  it('con un cwd REALMENTE distinto (campo presente y legible) sí se sigue detectando el wrong-cwd', () => {
    // Control del test anterior: el arreglo relaja SOLO el caso de esquema
    // desconocido; la detección real no puede haberse perdido por el camino.
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      ...baseEnv(repoRoot),
      FAKE_CMUX_WRONG_CWD_SUBSTR: '#90',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/la sesión NO está en/)
  })
})

// ---------------------------------------------------------------------------
// Hallazgo A — el exit 3 significaba dos cosas y su mensaje solo describía una
// ---------------------------------------------------------------------------
describe('D5/A — exit 3 solo cuando de verdad no quedó nada a medias', () => {
  // Reproducido sin arreglar: con TODOS los candidatos saltados al reclamar
  // el exit ya era 3, y el mensaje ("Nada quedó a medias ni bloqueado") era
  // cierto. Este test fija ese caso para que el estrechamiento del exit 3 no
  // se lo lleve por delante.
  it('todos los candidatos colisionan al reclamar → exit 3, y el mensaje puede afirmar que no hay nada que limpiar', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      ...baseEnv(repoRoot),
      // El collision-check de dispatch-check ve otro issue en vuelo con el
      // mismo token → colisión, exit 1 ('skip'), sin escribir nada.
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:zzz']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([
        [openIssue90],
        [],
        [{ number: 5, labels: [{ name: 'status:in-progress' }, { name: 'touches:zzz' }] }],
      ]),
    })
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/lanzados 0\/1 slice\(s\) seleccionados de esta tanda/)
    expect(r.out).toMatch(/Ningún claim quedó escrito, ninguna rama ni worktree se creó, y no hay nada que limpiar a mano/)
    expect(r.out).not.toMatch(/LANZADOS SIN VERIFICAR/)
    // Y de verdad no quedó nada: ni claim escrito ni worktree creado.
    expect(readOrEmpty(join(repoRoot, 'gh-argv'))).not.toMatch(/issue edit 90 .*--add-label status:in-progress/)
    expect(readOrEmpty(join(repoRoot, 'git-log'))).not.toMatch(/worktree add/)
  })
})

// ---------------------------------------------------------------------------
// Hallazgo D — nuestro propio timeout no puede presentarse como una
// interrupción ajena
// ---------------------------------------------------------------------------
describe('D5/D — SIGKILL propio por CT_NEXT_CHILD_TIMEOUT_MS sobre dispatch-check', () => {
  // Reproducido sin arreglar: "dispatch-check para #90 terminó por la señal
  // SIGKILL mientras intentaba reclamar" + "antes de esta interrupción", sin
  // nombrar ni el límite ni la variable — culpando de una interrupción a
  // quien no interrumpió nada.
  it('nombra el límite, la variable, y dice explícitamente que no fue una interrupción del usuario', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      ...baseEnv(repoRoot),
      FAKE_GH_EDIT_DELAY_MS: '5000', // dispatch-check se queda dentro de su `gh issue edit`
      CT_NEXT_CHILD_TIMEOUT_MS: '1000',
      // F8 — misma corrección que en ct-next-signal-interrupt.test.js: la
      // cota corta se aplica SOLO al hijo que este test bloquea a propósito.
      // Con la cota global, los 1000ms se aplicaban también a los `gh api
      // .../issues` y `git rev-parse` legítimos que ct-next hace ANTES de
      // llegar a dispatch-check, y bajo carga cualquiera de ellos podía
      // agotarlos primero: el mensaje que este test comprueba nunca llegaría
      // a imprimirse. Aquí el resultado es determinista por construcción —
      // dispatch-check se queda 5000ms dentro de su `gh issue edit`, o sea
      // cinco veces la cota, pase lo que pase con la máquina.
      CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE: 'dispatch-check',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no terminó dentro del límite de 1000ms \(CT_NEXT_CHILD_TIMEOUT_MS\)/)
    expect(r.out).toMatch(/lo matamos NOSOTROS con SIGKILL — no fue una interrupción tuya/)
    expect(r.out).toMatch(/sube CT_NEXT_CHILD_TIMEOUT_MS/)
    expect(r.out).toMatch(/gh issue edit 90 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
    // El texto ya no llama "interrupción" a lo que hicimos nosotros.
    expect(r.out).not.toMatch(/antes de esta interrupción/)
  })
})

// ---------------------------------------------------------------------------
// Hallazgo G — hooks de test validados, y red para CUALQUIER excepción en la
// ventana peligrosa
// ---------------------------------------------------------------------------
describe('D5/G — la ventana entre el claim y el worktree ya no deja huérfanos por una excepción', () => {
  // Reproducido sin arreglar: `claimed #90 → in-progress` en la salida,
  // ERR_UNKNOWN_SIGNAL en ct-next.mjs, NINGÚN revert en el log de gh, issue
  // huérfano.
  it('un valor inválido en CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM aborta con exit 2 ANTES de tocar gh', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      ...baseEnv(repoRoot),
      CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM: 'pepe',
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM inválido: "pepe"/)
    expect(r.out).toMatch(/SIGINT, SIGTERM/)
    // Ni un solo comando de gh: se aborta antes de leer nada.
    expect(readOrEmpty(join(repoRoot, 'gh-argv'))).toBe('')
    // El mensaje NOMBRA ERR_UNKNOWN_SIGNAL para explicar por qué se valida,
    // pero no puede haber una traza de que se haya llegado a lanzar.
    expect(r.out).not.toMatch(/at process\.kill/)
    expect(r.out).not.toMatch(/TypeError \[ERR_UNKNOWN_SIGNAL\]/)
    expect(r.out).not.toMatch(/claimed #90/)
  })

  it('lo mismo para el hook del checkpoint idle', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      ...baseEnv(repoRoot),
      CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT: 'SIGKILL', // válida para el SO, pero SIN manejador aquí
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT inválido: "SIGKILL"/)
  })

  // La parte de RAÍZ: validar el hook no arregla el agujero, solo un caso.
  // CUALQUIER throw en esa ventana dejaba el issue huérfano.
  it('una excepción cualquiera tras el claim revierte el claim, lo dice, e imprime la traza completa', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      ...baseEnv(repoRoot),
      CT_NEXT_TEST_THROW_AFTER_CLAIM: 'boom-de-prueba',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/excepción no capturada en ct-next\.mjs — esto es un bug/)
    expect(r.out).toMatch(/boom-de-prueba/)
    expect(r.out).toMatch(/at file:/) // la traza no se esconde
    expect(r.out).toMatch(/#90 tenía un claim \(status:in-progress\) sin worktree completado/)
    expect(r.out).toMatch(/claim de #90 revertido automáticamente a status:ready/)
    const argv = readOrEmpty(join(repoRoot, 'gh-argv'))
    // EXACTAMENTE un claim y EXACTAMENTE un revert — ni cero (el bug), ni dos.
    expect((argv.match(/issue edit 90 --repo o\/r --add-label status:in-progress/g) || []).length).toBe(1)
    expect((argv.match(/issue edit 90 --repo o\/r --add-label status:ready/g) || []).length).toBe(1)
    // El worktree nunca llegó a crearse.
    expect(readOrEmpty(join(repoRoot, 'git-log'))).not.toMatch(/worktree add/)
  })

  it('si el revert de emergencia TAMBIÉN falla, lo dice con el comando manual en vez de callarlo', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      ...baseEnv(repoRoot),
      CT_NEXT_TEST_THROW_AFTER_CLAIM: 'boom-de-prueba',
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready --remove-label status:in-progress',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATENCIÓN: no se pudo revertir automáticamente el claim de #90/)
    expect(r.out).toMatch(/gh issue edit 90 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })
})

// ---------------------------------------------------------------------------
// Hallazgo F (colateral, el más grave fuera del encargo) — un writeSync que
// falla no puede convertir un claim EXITOSO en "fallo inesperado"
// ---------------------------------------------------------------------------
describe('D5/F — el reenvío de la salida de dispatch-check no decide el resultado del claim', () => {
  // Reproducido sin arreglar, con el extremo de LECTURA de stdout cerrado
  // (el caso real de `ct-next | head`, o un caller que dejó de leer): el
  // claim de #90 SÍ se escribió (aparece en el log de gh, con su readback
  // detrás), pero el `writeSync(1, out)` posterior lanzaba EPIPE DENTRO del
  // try de attemptClaim, el catch lo leía como el fallo del subproceso
  // (`e.status` undefined) y ct-next imprimía "dispatch-check devolvió un
  // fallo inesperado […] probablemente es un bug o una mala configuración",
  // abortaba la tanda con exit 1 y NO revertía: issue huérfano por no haber
  // podido imprimir una línea.
  it('con stdout cerrado, un claim con éxito NO se reporta como fallo inesperado ni aborta la tanda', async () => {
    const repoRoot = makeRepoRoot()
    const child = spawn(process.execPath, [script, '--repo', 'o/r', '--cap', '1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: fakePath, ...baseEnv(repoRoot) },
    })
    let err = ''
    child.stderr.on('data', (d) => { err += d.toString() })
    child.stdout.destroy() // cierra el extremo de lectura: todo write a fd 1 da EPIPE
    const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c)))

    expect(err).not.toMatch(/fallo inesperado/)
    expect(err).not.toMatch(/probablemente es un bug o una mala configuración/)
    expect(err).not.toMatch(/Abortando toda la tanda/)
    expect(code).toBe(0)
    const argv = readOrEmpty(join(repoRoot, 'gh-argv'))
    // El claim se escribió UNA vez y NO se revirtió: el slice se despachó de
    // verdad, que es lo que de verdad ocurrió.
    expect((argv.match(/issue edit 90 --repo o\/r --add-label status:in-progress/g) || []).length).toBe(1)
    expect(argv).not.toMatch(/issue edit 90 --repo o\/r --add-label status:ready/)
    expect(readOrEmpty(join(repoRoot, 'git-log'))).toMatch(/worktree add -b feat\/90/)
  })

  // Hermano del anterior, en dispatch-check.mjs, y peor: ct-next captura la
  // salida de dispatch-check por una tubería que SÍ lee, pero el kickoff que
  // reciben los agentes trae el comando literal para ejecutarlo a mano, y un
  // humano lo pasa por `| head` sin pensarlo.
  //
  // Reproducido contra el código sin arreglar: el claim de #90 se escribió
  // CON ÉXITO (`issue edit 90 --add-label status:in-progress` + su readback
  // en el log de gh) y el proceso murió con una traza de EPIPE en el
  // `outLine` final, saliendo con 1 — que en el contrato de ESTE fichero es
  // 'skip': "colisión o carrera perdida, nada mutado". Un claim conseguido
  // leído como un claim que nunca ocurrió.
  it('dispatch-check con stdout cerrado: el exit code sigue describiendo el protocolo, no la tubería', async () => {
    const repoRoot = makeRepoRoot()
    const dcScript = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'dispatch-check.mjs')
    const argvLog = join(repoRoot, 'gh-argv')
    const child = spawn(process.execPath, [dcScript, '90', '--repo', 'o/r'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: fakePath,
        FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], []]),
        FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-count'),
        FAKE_GH_ARGV_LOG_FILE: argvLog,
        FAKE_GH_VIEW_LABELS: JSON.stringify([]),
      },
    })
    let err = ''
    child.stderr.on('data', (d) => { err += d.toString() })
    child.stdout.destroy()
    const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c)))

    // 0 = claim confirmado, que es exactamente lo que pasó.
    expect(code).toBe(0)
    expect(err).not.toMatch(/EPIPE/)
    expect((readOrEmpty(argvLog).match(/issue edit 90 --repo o\/r --add-label status:in-progress/g) || []).length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Hallazgo H — el dry-run enseña la tanda entera de una vez
// ---------------------------------------------------------------------------
describe('D5/H — --dry-run con destinos ocupados', () => {
  it('con --cap 3 y dos destinos ocupados: informa de los DOS, enseña el plan de los TRES, dice cuál rompería primero, y sale 1', () => {
    const repoRoot = makeRepoRoot()
    const issues = [
      { number: 91, title: '#91 a', labels: [{ name: 'status:ready' }], body: '' },
      { number: 92, title: '#92 b', labels: [{ name: 'status:ready' }], body: '' },
      { number: 93, title: '#93 c', labels: [{ name: 'status:ready' }], body: '' },
    ]
    const r = runReal(['--repo', 'o/r', '--cap', '3', '--dry-run'], {
      ...baseEnv(repoRoot, issues),
      FAKE_GIT_STALE_BRANCH_EXISTS: '92,93',
    })
    expect(r.code).toBe(1)
    // Los dos problemas, no solo el primero.
    expect(r.out).toMatch(/precondiciones NO cumplidas \(2\)/)
    expect(r.out).toMatch(/la rama feat\/92 ya existe/)
    expect(r.out).toMatch(/la rama feat\/93 ya existe/)
    // El plan de los TRES slices, incluido el sano — antes no se imprimía
    // ninguno.
    expect(r.out).toMatch(/=== slice #91 /)
    expect(r.out).toMatch(/=== slice #92 /)
    expect(r.out).toMatch(/=== slice #93 /)
    // El problema de cada slice, en SU bloque.
    expect(r.out).toMatch(/=== slice #92 \(b\) ===\nPRECONDICIÓN NO CUMPLIDA \(1\) para este slice/)
    // Y "destino libre" solo donde es cierto.
    expect(r.out).toMatch(/destino libre: .*\.worktrees\/91 no existe y la rama feat\/91 tampoco/)
    expect(r.out).toMatch(/destino: .*\.worktrees\/92 \/ rama feat\/92 — NO LIBRE/)
    expect(r.out).not.toMatch(/destino libre: .*\.worktrees\/92/)
    // Conteos y "cuál rompería primero", sin ambigüedad.
    expect(r.out).toMatch(/De los 3 slice\(s\) seleccionados, 2 tienen precondiciones sin cumplir \(#92, #93\); 1 sin problemas propios \(#91\)\. En una corrida real, el primero que rompería es #92/)
    expect(r.out).toMatch(/NO es luz verde/)
    // Un dry-run no toca nada, pase lo que pase.
    expect(readOrEmpty(join(repoRoot, 'gh-argv'))).not.toMatch(/issue edit/)
    expect(readOrEmpty(join(repoRoot, 'git-log'))).not.toMatch(/worktree add/)
  })

  it('la corrida REAL sigue abortando antes de escribir ningún claim, y con el mismo resumen', () => {
    // La asimetría es deliberada y acotada: las dos comprueban lo mismo y
    // las dos fallan; solo cambia cuánto se imprime DESPUÉS de fallar.
    const repoRoot = makeRepoRoot()
    const issues = [
      { number: 91, title: '#91 a', labels: [{ name: 'status:ready' }], body: '' },
      { number: 92, title: '#92 b', labels: [{ name: 'status:ready' }], body: '' },
    ]
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      ...baseEnv(repoRoot, issues),
      FAKE_GIT_STALE_BRANCH_EXISTS: '92',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ni un solo claim escrito: se comprueba antes de tocar GitHub/)
    expect(r.out).toMatch(/el primero que rompería es #92/)
    expect(r.out).not.toMatch(/=== slice #91 /) // el plan es cosa del dry-run
    expect(readOrEmpty(join(repoRoot, 'gh-argv'))).not.toMatch(/issue edit/)
  })
})

// ---------------------------------------------------------------------------
// Hallazgo propio (repaso de D5) — "NO COMPROBADOS (modo fixture)" en un
// dry-run que no es de fixture
// ---------------------------------------------------------------------------
describe('D5 (revisión propia) — el dry-run no puede llamar "modo fixture" a una consulta que falló', () => {
  // Reproducido contra el código sin arreglar: un --dry-run REAL (sin
  // CT_NEXT_FIXTURE) cuya consulta de rama falla caía en el mismo booleano
  // `false` que el modo fixture, e imprimía "NO COMPROBADOS (modo fixture:
  // repoRoot sintético, no se toca git). En una corrida real sí se
  // comprueban antes de reclamar" — tres afirmaciones falsas seguidas: no
  // era fixture, el repoRoot era real, git SÍ se tocó, y la corrida real
  // hará esta misma comprobación fallida.
  it('distingue "no se miró" (fixture) de "se miró y falló"', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      ...baseEnv(repoRoot),
      FAKE_GIT_REV_PARSE_BROKEN: '1', // la consulta de rama sale con 128, no con 1
    })
    expect(r.code).toBe(0) // 'unknown' es aviso, nunca fallo duro: no sabemos que esté ocupado
    expect(r.out).toMatch(/SIN CONFIRMAR: la consulta a git se intentó y FALLÓ/)
    expect(r.out).toMatch(/Esto NO es modo fixture/)
    expect(r.out).not.toMatch(/NO COMPROBADOS \(modo fixture/)
    // Y tampoco puede afirmar que el destino esté libre.
    expect(r.out).not.toMatch(/destino libre/)
  })

  it('en modo fixture SÍ dice modo fixture (el mensaje correcto no se pierde por el camino)', () => {
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      CT_NEXT_FIXTURE: JSON.stringify({
        issues: [{ n: 90, order: 1, status: 'ready', deps: [], touches: ['a'], name: 'algo', type: 'backend' }],
        mergedIssues: [],
      }),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/NO COMPROBADOS \(modo fixture/)
    expect(r.out).not.toMatch(/SIN CONFIRMAR/)
  })
})

// ---------------------------------------------------------------------------
// Hallazgo C — un Ctrl-C nunca se descarta en silencio
// ---------------------------------------------------------------------------
describe('D5/C — SIGINT que llega con el trabajo ya hecho', () => {
  // Reproducido sin arreglar con exactamente este montaje (--cap 1, señal
  // enviada SOLO al proceso node mientras está bloqueado dentro de `git
  // worktree add`): EXIT=0, "lanzados 1/1", y NI RASTRO de que se hubiera
  // pulsado nada. El manejador solo corre cuando el event loop recupera el
  // control, y con cap 1 no quedaba ningún `await` por delante.
  it('--cap 1: la señal se reconoce, se sale con 130, y no se deshace nada de lo ya hecho', async () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const child = spawn(process.execPath, [script, '--repo', 'o/r', '--cap', '1'], {
      env: {
        ...process.env,
                PATH: fakePath,
        ...baseEnv(repoRoot),
        // F8 — handshake en vez de ventana. Antes esto era
        // FAKE_GIT_WORKTREE_ADD_DELAY_MS: '2000', o sea "git worktree add
        // tarda 2s y confiamos en que este proceso reaccione dentro de esos
        // 2s". Reaccionar a tiempo dependía de que el planificador del SO nos
        // diera CPU, no del código bajo prueba. Ahora `git worktree add` se
        // queda PARADO hasta que este test lo suelte: la llamada bloqueante
        // real posterior al segundo checkpoint (donde el hallazgo dice que la
        // señal se perdía) sigue siendo exactamente la misma, pero su duración
        // ya no es una apuesta.
        FAKE_GIT_WORKTREE_ADD_WAIT_FILE: join(repoRoot, 'release-worktree-add'),
      },
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { out += d.toString() })
    // El listener de 'exit' se registra YA, antes de esperar a nada: si se
    // registrara después de la espera y el proceso hubiera terminado
    // mientras tanto, el evento se habría perdido y el test colgaría hasta
    // su propio timeout — un fallo del arnés disfrazado de fallo del código.
    const exited = new Promise((resolve) => child.on('exit', (c, s) => resolve({ code: c, sig: s })))

    // La señal se envía cuando `git worktree add` YA ARRANCÓ — fake-git
    // escribe su argv en el log ANTES de pararse, así que el log es el
    // marcador fiable de "estamos dentro de la llamada bloqueante". Y como el
    // stub no vuelve hasta que lo soltamos NOSOTROS (línea de abajo), no hay
    // ninguna ventana que se nos pueda cerrar antes de llegar.
    await new Promise((resolve) => {
      const t = setInterval(() => {
        if (/worktree add/.test(readOrEmpty(gitLog))) { clearInterval(t); resolve() }
      }, 5)
    })
    child.kill('SIGINT') // solo al proceso node, nunca al hijo `git`
    // Soltar DESPUÉS del kill: `child.kill` es síncrono a nivel de syscall, así
    // que al volver la señal ya está pendiente para el proceso destino.
    writeFileSync(join(repoRoot, 'release-worktree-add'), '')
    const { code, sig } = await exited

    expect(sig).toBeNull() // salió por su propio process.exit(), no matado por el SO
    expect(code).toBe(130)
    // El trabajo ya hecho se conserva y se informa: el resumen sale ANTES
    // del acuse de la señal.
    expect(out).toMatch(/lanzados 1\/1 slice\(s\) seleccionados de esta tanda/)
    expect(readOrEmpty(gitLog)).toMatch(/worktree add -b feat\/90/)
    // Y la señal se reconoce, con el matiz correcto: no interrumpió nada.
    expect(out).toMatch(/SIGINT recibido, pero la tanda YA había terminado de procesarse cuando llegó/)
    expect(out).toMatch(/no se interrumpe ni se deshace nada de lo ya hecho/)
    // NO se revierte el claim de un slice que se lanzó bien.
    expect(readOrEmpty(join(repoRoot, 'gh-argv'))).not.toMatch(/issue edit 90 --repo o\/r --add-label status:ready/)
    expect(out).toMatch(/no había ningún claim propio pendiente de revertir/)
  })

  // NOTA sobre lo que NO se testea aquí, y por qué: el mismo punto de cesión
  // final cubre también el camino de --dry-run (es literalmente la misma
  // línea, fuera del `if (!dryRun)`), pero no hay forma honesta de
  // ejercitarlo con una señal EXTERNA: en --dry-run, TODO lo que ocurre
  // después de instalar los manejadores es instantáneo (el bucle no hace ni
  // una llamada a subproceso; imprime y sigue), así que el proceso puede
  // terminar antes de que el SO entregue la señal. Un test así mediría el
  // scheduler, no el código — el mismo error de temporización que la ronda
  // anterior ya documentó para sus propios intentos con señales externas.
})
