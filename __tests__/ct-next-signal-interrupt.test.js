// Finding 1 (auditoría de interrupción/staleness sobre el dispatcher):
// ct-next.mjs no tenía NI UN SOLO manejador de señal. La reproducción del
// auditor — dispatch-check real que escribe el claim y sale 0, un `git` fake
// colgado en `worktree add`, SIGINT a los 3s — dejaba el issue reclamado
// (status:in-progress) PARA SIEMPRE: sin revert, sin worktree, sin agente,
// sin ni un mensaje, solo EXIT=130.
//
// Estos tests cubren las DOS defensas del fix (ver el bloque de comentarios
// grande en ct-next.mjs, justo tras la comprobación de dispatchCheckPath):
//   1. Un checkpoint de cesión real (`await sleep(...)`) justo después de
//      confirmar el claim y antes de crear el worktree — la ventana exacta
//      que describe el hallazgo — y otro antes de arrancar un claim nuevo
//      (idle entre dos slices de la misma tanda).
//   2. Una cota de tiempo en toda llamada bloqueante a un subproceso
//      (dispatch-check.mjs, `git worktree add/remove`, `git branch -D`,
//      `gh()`), para el caso en que la señal NUNCA llega a JS porque el hijo
//      está genuinamente atascado (verificado por construcción: un
//      manejador de señal de JS no puede interrumpir una llamada síncrona
//      bloqueada — ver el informe de esta tarea para el experimento).
import { describe, it, expect, afterEach } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// D4: entorno hermético (dirs de cuenta + stubs de cmux/claude) — ver fixtures/hermetic-env.js
import { ACCOUNT_ENV } from './fixtures/hermetic-env.js'
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
  const d = mkdtempSync(join(tmpdir(), 'ct-next-sig-'))
  dirs.push(d)
  return d
}

function runInterruptible(args, envOverrides) {
  return spawn('node', [script, ...args], { env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...envOverrides } })
}

// ===========================================================================
// F8 — POR QUÉ ESTOS TESTS YA NO USAN UNA VENTANA DE TIEMPO.
//
// El montaje anterior era: ensanchar con CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS la
// ventana del checkpoint (2000-3000 ms), escuchar el stdout del hijo hasta ver
// un marcador ("claimed #77") y mandar la señal en ese momento. El comentario
// original decía que eso "evita cualquier sleep arbitrario", y es verdad a
// medias: el ENVÍO va atado al progreso observable, sí — pero la señal sigue
// teniendo que LLEGAR dentro de una ventana de N milisegundos que se cierra
// sola. Quien tiene que llegar a tiempo es este proceso de vitest, que compite
// por CPU con el resto de la suite. Con la máquina ociosa 2000 ms parecen
// infinitos; con carga, este proceso puede no ser planificado en varios
// segundos y la ventana se cierra antes de que el evento 'data' se procese
// siquiera.
//
// El montaje nuevo invierte quién espera a quién. Los stubs (`gh issue edit`,
// `cmux new-workspace`) se PARAN dentro de la llamada y no vuelven hasta que
// este test cree un fichero centinela — ver __tests__/fixtures/stub-wait.js.
// Como ct-next.mjs está bloqueado en un `execFileSync` mientras tanto, la
// señal queda PENDIENTE a nivel de kernel y no se procesa hasta que la
// llamada vuelve y el bucle llega a su checkpoint: exactamente el punto que
// estos tests quieren ejercitar, y ahora sin ninguna carrera. Da igual lo
// cargada que esté la máquina: el proceso bajo prueba espera.
// ===========================================================================

// waitForFileMatch: espera a que `path` exista y su contenido case con `re`.
// Es el detector de "el proceso bajo prueba ya está DENTRO de la llamada que
// nos interesa" — los stubs registran su argv (síncrono) ANTES de pararse.
function waitForFileMatch(path, re) {
  return new Promise((resolve) => {
    const t = setInterval(() => {
      if (existsSync(path) && re.test(readFileSync(path, 'utf8'))) {
        clearInterval(t)
        resolve()
      }
    }, 5)
  })
}
// release: suelta al stub parado. Se llama SIEMPRE DESPUÉS de child.kill(),
// que es síncrono a nivel de syscall: cuando vuelve, la señal ya está
// pendiente para el proceso destino, así que soltar aquí no puede adelantar
// al despacho de la señal.
const release = (path) => writeFileSync(path, '')

function collectOutput(child) {
  const state = { out: '' }
  const onData = (d) => { state.out += d.toString() }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  state.exited = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })))
  return state
}

function runRealSync(args, envOverrides) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const openIssue77 = { number: 77, title: '#77 algo', labels: [{ name: 'status:ready' }], body: '' }

describe('ct-next — SIGINT tras un claim confirmado pero antes de crear el worktree (finding 1)', () => {
  // Montaje común de los dos primeros tests (SIGINT y SIGTERM): la señal se
  // manda mientras ct-next.mjs está BLOQUEADO dentro del `execFileSync` de
  // dispatch-check.mjs, que a su vez está parado dentro de su `gh issue edit`
  // (el claim). Al estar bloqueado, ct-next no puede procesar la señal: queda
  // pendiente. Cuando soltamos el stub, dispatch-check termina, ct-next marca
  // `activeClaim` (síncrono, sin ningún `await` de por medio) y el PRIMER
  // punto en el que cede el control es el checkpoint post-claim — la ventana
  // exacta de finding 1, alcanzada por construcción y no por temporización.
  async function signalDuringClaimWindow(repoRoot, signal) {
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const releaseFile = join(repoRoot, 'release-gh-edit')

    const child = runInterruptible(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_EDIT_WAIT_FILE: releaseFile,
    })
    const state = collectOutput(child)
    await waitForFileMatch(argvLog, /issue edit 77 .*--add-label status:in-progress/)
    child.kill(signal)
    release(releaseFile)
    const { code, sig } = await state.exited
    return { code, sig, out: state.out, gitLog, argvLog }
  }

  it('revierte el claim automáticamente, no crea worktree, y sale con 130', async () => {
    const repoRoot = makeRepoRoot()
    const { code, sig, out, gitLog, argvLog } = await signalDuringClaimWindow(repoRoot, 'SIGINT')

    expect(sig).toBeNull() // terminó por su propio process.exit(), no matado por el SO
    expect(code).toBe(130)
    expect(out).toMatch(/SIGINT recibido/)
    expect(out).toMatch(/revertido automáticamente a status:ready/)

    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 77 --repo o\/r --add-label status:in-progress --remove-label status:ready/)
    expect(argv).toMatch(/issue edit 77 --repo o\/r --add-label status:ready --remove-label status:in-progress/)

    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })

  it('lo mismo con SIGTERM: revierte y sale con 143', async () => {
    const repoRoot = makeRepoRoot()
    const { code, sig, out, gitLog } = await signalDuringClaimWindow(repoRoot, 'SIGTERM')

    expect(sig).toBeNull()
    expect(code).toBe(143)
    expect(out).toMatch(/SIGTERM recibido/)
    expect(out).toMatch(/revertido automáticamente a status:ready/)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })

  it('varias señales de más no reintentan el revert ni cuelgan el proceso (invariante de seguridad bajo señales repetidas)', async () => {
    // OJO — nota sobre por qué esta prueba verifica un INVARIANTE, no el
    // mensaje exacto de "recibido de nuevo...": las señales POSIX no-realtime
    // como SIGINT no se encolan — solo puede haber UNA pendiente de procesar
    // a la vez para un proceso. Si una segunda señal llega mientras la
    // primera todavía no se ha "drenado" a nivel de kernel/libuv, el SO
    // puede fusionarla con la ya pendiente en vez de entregarla como una
    // segunda invocación distinta del manejador — esto se observó
    // directamente al escribir esta prueba (bajo carga, con la suite
    // completa corriendo en paralelo, la ruta "recibido de nuevo" no
    // siempre se alcanzaba, aun con las mismas señales enviadas en la misma
    // secuencia). Ninguna cantidad de espera artificial por nuestra parte
    // cierra esa ventana — depende del scheduler del SO, no de este script.
    // Lo que SÍ es una garantía real y comprobable: pase lo que pase con
    // esa carrera, el proceso NUNCA hace un revert doble, NUNCA cuelga, y
    // SIEMPRE sale con un código de señal reconocido. Eso es lo que se
    // verifica aquí — un burst de señales, no solo dos.
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    const releaseFile = join(repoRoot, 'release-gh-edit')
    const child = runInterruptible(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
      // F8 — la PRIMERA señal ya no depende de una ventana: se manda con el
      // claim parado dentro del stub (handshake), igual que en los dos tests
      // de arriba. FAKE_GH_EDIT_DELAY_MS se mantiene porque aquí sí cumple una
      // función distinta: ensancha el REVERT (que no es donde se decide si el
      // test pasa) para darle a las señales de más la ocasión de llegar
      // mientras `interrupting` ya está puesto. Que lleguen o no sigue sin ser
      // un requisito — el invariante que se comprueba abajo vale en los dos
      // casos, y así lo dice la nota de arriba.
      FAKE_GH_EDIT_WAIT_FILE: releaseFile,
      FAKE_GH_EDIT_DELAY_MS: '3000',
    })
    const state = collectOutput(child)
    const timers = []
    await waitForFileMatch(argvLog, /issue edit 77 .*--add-label status:in-progress/)
    // Burst de señales adicionales (no solo una) para maximizar la
    // probabilidad de que al menos una llegue mientras `interrupting` ya está
    // puesto — sin depender de acertar una única carrera exacta.
    child.kill('SIGINT')
    for (const delayMs of [50, 150, 300, 600, 1000, 1500]) {
      timers.push(setTimeout(() => { try { child.kill('SIGINT') } catch { /* proceso ya muerto: ignorar */ } }, delayMs))
    }
    release(releaseFile)
    const { code, sig: signal } = await state.exited
    for (const t of timers) clearTimeout(t)
    const out = state.out

    expect(signal).toBeNull() // terminó por su propio process.exit(), nunca matado en seco por el SO
    expect(code).toBe(130)
    // Invariante real: por muchas señales de más que lleguen, el revert
    // automático se completa EXACTAMENTE una vez — nunca cero (una
    // regresión que dejara de revertir del todo pasaría con
    // `toBeLessThanOrEqual`, señalado por una revisión externa) y nunca dos
    // (doble revert solapado).
    const occurrences = (out.match(/revertido automáticamente a status:ready/g) || []).length
    expect(occurrences).toBe(1)
    // Si la carrera SÍ se ganó esta vez y una segunda señal se procesó de
    // verdad como reentrada, el mensaje debe ser el correcto (no una traza
    // de error ni un segundo revert) — pero no se exige que aparezca.
    if (out.includes('recibido de nuevo mientras ya se estaba limpiando')) {
      expect(occurrences).toBe(1)
    }
  })
})

// CRÍTICO (revisión externa, reproducido 3/3 y 2/2 de forma determinista
// contra la primera versión de este fix): el propio manejador de señal, al
// terminar en `await sleep(0)` antes de `process.exit()`, registraba un
// temporizador POR DETRÁS del temporizador YA PENDIENTE del bucle principal
// (su propio `await sleep(testDelayAfterClaimMs)`, registrado ANTES de que
// la señal se procesara). Node procesa los temporizadores vencidos en el
// orden en que se registraron — a CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS=0 (el
// único valor de PRODUCCIÓN; los otros tests de este fichero usan 2000-3000
// para poder enviar una señal externa con margen, un valor que además
// enmascaraba este bug por completo: con esa ventana tan grande el
// temporizador propio del manejador siempre "ganaba" la carrera de todas
// formas) el temporizador del bucle principal vencía ANTES que el del
// manejador — el bucle RETOMABA, creaba el worktree, lanzaba cmux, e
// imprimía "lanzado" DESPUÉS de que el manejador ya hubiera revertido el
// claim a status:ready. El claim queda revertido en GitHub mientras un
// agente real sigue corriendo sobre él: el finding 1 exacto, causado por el
// propio arreglo de finding 1.
//
// Estos dos tests reproducen la carrera EXACTA a valor de producción real
// (CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS sin fijar) — no al valor de 2000-3000
// que usa el resto de este fichero, que no la habría detectado nunca (así
// se confirmó: los diez tests de arriba pasaban igual con el bug presente
// que sin él). Enviar la señal desde un proceso EXTERNO justo en el
// instante exacto de esta ventana es, en sí mismo, una carrera de
// temporización de las que estos tests deberían evitar: verificado por
// construcción que, a este valor de delay, entre un 10 y un 20% de los
// intentos de un arnés de test externo nunca llegaban a procesar la señal
// en absoluto (la tubería entera de subprocesos falsos podía terminar antes
// de que el proceso externo reaccionara al dato de stdout) — un fallo de
// temporización del PROPIO test, no del código bajo prueba. En su lugar,
// `CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM`/`CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT`
// (hooks exclusivos de test, ver ct-next.mjs) hacen que el propio proceso
// se envíe la señal a sí mismo (`process.kill(pid, sig)`, la MISMA syscall
// subyacente que una señal externa — indistinguible para Node) de forma
// síncrona justo en el punto exacto que se quiere ejercitar, sin ninguna
// carrera de temporización entre procesos. Verificado 20/20 sin excepción
// contra el fix, y 0/20 (reproducción total) contra el código sin arreglar.
describe('ct-next — CRÍTICO: el propio manejador no debe darle al bucle principal una segunda oportunidad de mutar (regresión de una revisión externa)', () => {
  it('cap 1, autointerrupción justo tras confirmar el claim, a valor de producción (delay sin fijar): NUNCA crea el worktree ni relanza tras el revert', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    const r = runRealSync(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
      CT_NEXT_TEST_SELF_SIGINT_AFTER_CLAIM: 'SIGINT',
      // CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS deliberadamente SIN FIJAR: 0, el
      // valor real de producción — es el único valor en el que el bug
      // original se manifestaba.
    })

    expect(r.code).toBe(130)
    expect(r.out).toMatch(/revertido automáticamente a status:ready/)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
    const argv = readFileSync(argvLog, 'utf8')
    // Exactamente un claim (el original) y exactamente un revert — nunca un
    // segundo `issue edit` que reclamara de nuevo o repitiera nada.
    expect((argv.match(/issue edit 77 --repo o\/r --add-label status:in-progress/g) || []).length).toBe(1)
    expect((argv.match(/issue edit 77 --repo o\/r --add-label status:ready/g) || []).length).toBe(1)
  })

  it('cap 2, autointerrupción justo antes del checkpoint idle previo al segundo candidato: #78 NUNCA recibe un issue edit', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')
    const openIssue78 = { number: 78, title: '#78 otro', labels: [{ name: 'status:ready' }], body: '' }

    const r = runRealSync(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77, openIssue78], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
      CT_NEXT_TEST_SELF_SIGINT_BEFORE_IDLE_CHECKPOINT: 'SIGINT',
    })

    expect(r.code).toBe(130)
    // #77 (el primer candidato) sí se completó antes de la autointerrupción
    // (que se dispara solo a partir de la SEGUNDA iteración del bucle).
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).toMatch(/worktree add -b feat\/77/)
    // #78 nunca llega a intentar un claim: ni escritura, ni revert, nada.
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).not.toMatch(/issue edit 78/)
    expect(gitLogTxt).not.toMatch(/worktree add -b feat\/78/)
  })
})

describe('ct-next — SIGINT en el hueco idle entre dos slices de la misma tanda (finding 1, checkpoint pre-claim)', () => {
  it('el primer slice queda lanzado con éxito; el segundo nunca llega a intentarse', async () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')
    const openIssue78 = { number: 78, title: '#78 otro', labels: [{ name: 'status:ready' }], body: '' }
    const cmuxLog = join(repoRoot, 'cmux-invoked')
    const releaseFile = join(repoRoot, 'release-cmux')

    const child = runInterruptible(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open; idx1: ct-next closed; idx2/idx3: dispatch-check(#77)
      // collision-check + readback (limpios); idx4/idx5 (si se llegaran a
      // usar): dispatch-check(#78) — no deberían llegar a invocarse.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77, openIssue78], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_CMUX_INVOKED_LOG_FILE: cmuxLog,
      // F8 — handshake en vez de ventana: la señal se manda mientras ct-next
      // está BLOQUEADO dentro del `execFileSync('cmux', …)` que lanza #77.
      // Todo lo que queda por delante hasta el checkpoint idle previo a #78
      // (la verificación de la sesión, el "lanzado #77") es síncrono, así que
      // la señal pendiente se despacha exactamente en ese checkpoint — el
      // punto que este test quiere ejercitar. Antes se dependía de reaccionar
      // al "lanzado #77" de stdout dentro de una ventana de 2000ms.
      FAKE_CMUX_NEW_WORKSPACE_WAIT_FILE: releaseFile,
    })
    const state = collectOutput(child)
    await waitForFileMatch(cmuxLog, /new-workspace/)
    child.kill('SIGINT')
    release(releaseFile)
    const { code, sig } = await state.exited
    const out = state.out

    expect(sig).toBeNull()
    expect(code).toBe(130)
    expect(out).toMatch(/SIGINT recibido/)
    // #77 sí se completó (worktree creado) antes de la señal.
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    expect(gitLogTxt).toMatch(/worktree add -b feat\/77/)
    // #78 nunca llegó a intentar un claim.
    const argv = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(argv).not.toMatch(/issue edit 78/)
    expect(out).not.toMatch(/claimed #78/)
    // No queda ningún claim propio pendiente de revertir (ninguno se había
    // hecho para #78).
    expect(out).toMatch(/no había ningún claim propio pendiente de revertir/)
  })
})

describe('ct-next — `git worktree add` genuinamente colgado, sin que la señal llegue nunca al hijo (finding 1, defensa 2: cota de tiempo)', () => {
  it('no se queda colgado para siempre: el timeout configurado lo acota, revierte el claim y sale con exit 1', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...ACCOUNT_ENV,
        PATH: fakePath,
        FAKE_GIT_TOPLEVEL: repoRoot,
        FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77], []]),
        FAKE_GH_COUNTER_FILE: counterFile,
        FAKE_GH_ARGV_LOG_FILE: argvLog,
        FAKE_GIT_LOG_FILE: gitLog,
        FAKE_GIT_WORKTREE_ADD_HANG: '1',
        // Cota corta para que el test no tenga que esperar los 10 minutos
        // por defecto de producción — ejercita el MISMO camino de código.
        CT_NEXT_CHILD_TIMEOUT_MS: '800',
        // F8 — ACOTADA AL PASO QUE ESTE TEST CUELGA A PROPÓSITO.
        //
        // Sin esto, los 800ms se aplicaban a TODOS los subprocesos, y el
        // test pasaba a depender de que la máquina despachara el
        // `dispatch-check` legítimo (un node que arranca otros tres nodes)
        // en menos de 800ms. Reproducido: con otra suite de vitest a la vez,
        // 2 de 6 corridas contra main fallaban aquí con
        //   expected 'aviso: ningún patrón de ACCOUNT_MAP c…'
        //   to match /no se pudo crear el worktree/
        // porque la cota había saltado sobre dispatch-check, no sobre `git
        // worktree add`. La respuesta correcta no es una ventana más ancha
        // (el fallo volvería con una máquina más cargada), es que el único
        // hijo capaz de agotar la cota sea el que este test cuelga.
        CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE: 'worktree-add',
      },
      // Red de seguridad del propio test: si el fix no funcionara,
      // `FAKE_GIT_WORKTREE_ADD_HANG` no termina NUNCA por su cuenta y
      // spawnSync colgaría el runner para siempre. Es un plazo de rescate, no
      // una aserción: la comprobación de "no se colgó" es `r.signal === null`
      // más abajo, que no depende de ningún umbral.
      timeout: 60000,
    })

    // No se quedó colgado: terminó por su PROPIO exit, no lo mató la red de
    // seguridad de spawnSync (que dejaría `signal` con el killSignal). Antes
    // esto se comprobaba con `elapsedMs < 5000` — un umbral de reloj de pared
    // que solo decía algo sobre lo ocupada que estaba la máquina.
    expect(r.signal).toBeNull()
    const out = (r.stdout || '') + (r.stderr || '')
    expect(out).toMatch(/no se pudo crear el worktree/)
    // MENOR (revisión externa): el mensaje de timeout debe nombrar el
    // límite exacto, la variable de entorno con la que se ajusta, y avisar
    // de que el SIGKILL puede haber dejado un worktree/rama a medio crear.
    expect(out).toMatch(/se agotó el límite de 800ms \(CT_NEXT_CHILD_TIMEOUT_MS\)/)
    expect(out).toMatch(/puede haber quedado un directorio y\/o una rama a MEDIO crear/)
    expect(out).toMatch(/revertido automáticamente a status:ready|ATENCIÓN: no se pudo revertir/)
    const argv = readFileSync(argvLog, 'utf8')
    // el claim inicial sí se escribió (dispatch-check llegó a completarse
    // antes del cuelgue, que ocurre DESPUÉS, en git worktree add)...
    expect(argv).toMatch(/issue edit 77 --repo o\/r --add-label status:in-progress --remove-label status:ready/)
    // ...y el revert automático también se intentó.
    expect(argv).toMatch(/issue edit 77 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
    expect(r.status).toBe(1)
  })
})

describe('ct-next — CT_NEXT_CHILD_TIMEOUT_MS / CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS malformados (validación defensiva, ataque adversarial)', () => {
  it('CT_NEXT_CHILD_TIMEOUT_MS no numérico → exit 2, uso claro, nada de gh/git tocado', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, CT_NEXT_CHILD_TIMEOUT_MS: 'not-a-number' },
    })
    expect(r.status).toBe(2)
    expect((r.stdout || '') + (r.stderr || '')).toMatch(/CT_NEXT_CHILD_TIMEOUT_MS inválido/)
  })

  it('CT_NEXT_CHILD_TIMEOUT_MS negativo → exit 2', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, CT_NEXT_CHILD_TIMEOUT_MS: '-5' },
    })
    expect(r.status).toBe(2)
  })

  it('CT_NEXT_CHILD_TIMEOUT_MS por encima del techo (25h) → exit 2', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, CT_NEXT_CHILD_TIMEOUT_MS: String(25 * 60 * 60 * 1000) },
    })
    expect(r.status).toBe(2)
  })

  it('CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS negativo → exit 2', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS: '-1' },
    })
    expect(r.status).toBe(2)
  })

  it('CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS por encima del techo (60001ms) → exit 2', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS: '60001' },
    })
    expect(r.status).toBe(2)
  })

  // F8 — el hook nuevo (CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE) se valida igual que
  // los demás. Un hook de test que vive en el script de PRODUCCIÓN y se lee
  // del entorno es exactamente el sitio del que llega un valor con un typo, y
  // este en concreto falla en SILENCIO si no se valida: con un alcance que no
  // se reconoce, la cota corta no se aplicaría a ningún hijo y todos usarían
  // el default de 10 minutos — el test que creía estar ejercitando el camino
  // del timeout se quedaría esperando diez minutos contra un stub que no
  // termina nunca, o aprobaría sin haber ejercitado nada.
  it('CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE con un alcance desconocido → exit 2, nombrando los válidos', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE: 'worktree_add' },
    })
    expect(r.status).toBe(2)
    const out = (r.stdout || '') + (r.stderr || '')
    expect(out).toMatch(/CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE inválido/)
    expect(out).toMatch(/dispatch-check, worktree-add/)
  })

  it('CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE vacío se ignora (equivale a no fijarlo): la cota sigue siendo global', () => {
    // Cadena vacía = "la variable está pero sin valor", el caso típico de un
    // `export VAR=` colgado en el entorno. No debe abortar, y tampoco debe
    // desactivar la cota: con CT_NEXT_CHILD_TIMEOUT_MS malformado seguimos
    // esperando el exit 2 de SIEMPRE, no el del alcance.
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, CT_NEXT_TEST_CHILD_TIMEOUT_SCOPE: '', CT_NEXT_CHILD_TIMEOUT_MS: 'not-a-number' },
    })
    expect(r.status).toBe(2)
    expect((r.stdout || '') + (r.stderr || '')).toMatch(/CT_NEXT_CHILD_TIMEOUT_MS inválido/)
  })
})
