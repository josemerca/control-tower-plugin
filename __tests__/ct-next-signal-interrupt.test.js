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
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
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

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-sig-'))
  dirs.push(d)
  return d
}

function runInterruptible(args, envOverrides) {
  return spawn('node', [script, ...args], { env: { ...process.env, PATH: fakePath, ...envOverrides } })
}

// waitForMarkerThenSignal: escucha stdout+stderr del hijo; en cuanto aparece
// `marker` en el texto acumulado, envía `signal` (una sola vez) y sigue
// acumulando hasta que el proceso termina. Evita cualquier `sleep` arbitrario
// de temporización — el envío de la señal está atado al propio progreso
// observable del proceso, no a un reloj.
function waitForMarkerThenSignal(child, marker, signal) {
  return new Promise((resolve) => {
    let out = ''
    let sent = false
    const onData = (d) => {
      out += d.toString()
      if (!sent && out.includes(marker)) {
        sent = true
        child.kill(signal)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code, sig) => resolve({ code, sig, out, sent }))
  })
}

const openIssue77 = { number: 77, title: '#77 algo', labels: [{ name: 'status:ready' }], body: '' }

describe('ct-next — SIGINT tras un claim confirmado pero antes de crear el worktree (finding 1)', () => {
  it('revierte el claim automáticamente, no crea worktree, y sale con 130', async () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    const child = runInterruptible(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
      // Ensancha la ventana claim-confirmado→worktree para poder enviar la
      // señal dentro de ella de forma determinista (ver el comentario de
      // cabecera de CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS en ct-next.mjs).
      CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS: '2000',
    })
    const { code, sig, out } = await waitForMarkerThenSignal(child, 'claimed #77', 'SIGINT')

    expect(sig).toBeNull() // terminó por su propio process.exit(), no matado por el SO
    expect(code).toBe(130)
    expect(out).toMatch(/SIGINT recibido/)
    expect(out).toMatch(/revertido automáticamente a status:ready/)

    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 77 --repo o\/r --add-label status:in-progress --remove-label status:ready/)
    expect(argv).toMatch(/issue edit 77 --repo o\/r --add-label status:ready --remove-label status:in-progress/)

    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  }, 15000)

  it('lo mismo con SIGTERM: revierte y sale con 143', async () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    const child = runInterruptible(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
      CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS: '2000',
    })
    const { code, sig, out } = await waitForMarkerThenSignal(child, 'claimed #77', 'SIGTERM')

    expect(sig).toBeNull()
    expect(code).toBe(143)
    expect(out).toMatch(/SIGTERM recibido/)
    expect(out).toMatch(/revertido automáticamente a status:ready/)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  }, 15000)

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

    const child = runInterruptible(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
      CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS: '3000',
      FAKE_GH_EDIT_DELAY_MS: '3000',
    })
    let out = ''
    let firstSent = false
    const timers = []
    // OJO: "claimed #77" llega por STDOUT (dispatch-check lo relaya con
    // writeSync(1,...)) — ambos streams se acumulan en el mismo buffer para
    // no depender de por cuál llega cada marcador.
    const onData = (d) => {
      out += d.toString()
      if (!firstSent && out.includes('claimed #77')) {
        firstSent = true
        // Burst de señales adicionales (no solo una) para maximizar la
        // probabilidad de que al menos una llegue mientras `interrupting`
        // ya está puesto — sin depender de acertar una única carrera exacta.
        child.kill('SIGINT')
        for (const delayMs of [50, 150, 300, 600, 1000, 1500]) {
          timers.push(setTimeout(() => { try { child.kill('SIGINT') } catch { /* proceso ya muerto: ignorar */ } }, delayMs))
        }
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    const { code, signal } = await new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })))
    for (const t of timers) clearTimeout(t)

    expect(signal).toBeNull() // terminó por su propio process.exit(), nunca matado en seco por el SO
    expect(code).toBe(130)
    // Invariante real: por muchas señales de más que lleguen, el revert
    // automático se completa como MUCHO una vez — nunca doble.
    const occurrences = (out.match(/revertido automáticamente a status:ready/g) || []).length
    expect(occurrences).toBeLessThanOrEqual(1)
    // Si la carrera SÍ se ganó esta vez y una segunda señal se procesó de
    // verdad como reentrada, el mensaje debe ser el correcto (no una traza
    // de error ni un segundo revert) — pero no se exige que aparezca.
    if (out.includes('recibido de nuevo mientras ya se estaba limpiando')) {
      expect(occurrences).toBe(1)
    }
  }, 15000)
})

describe('ct-next — SIGINT en el hueco idle entre dos slices de la misma tanda (finding 1, checkpoint pre-claim)', () => {
  it('el primer slice queda lanzado con éxito; el segundo nunca llega a intentarse', async () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')
    const openIssue78 = { number: 78, title: '#78 otro', labels: [{ name: 'status:ready' }], body: '' }

    const child = runInterruptible(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open; idx1: ct-next closed; idx2/idx3: dispatch-check(#77)
      // collision-check + readback (limpios); idx4/idx5 (si se llegaran a
      // usar): dispatch-check(#78) — no deberían llegar a invocarse.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77, openIssue78], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
      // Ensancha el checkpoint idle (pre-claim) — el mismo valor que el
      // checkpoint post-claim, ver el comentario de cabecera en ct-next.mjs.
      CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS: '2000',
    })
    const { code, sig, out } = await waitForMarkerThenSignal(child, 'lanzado #77', 'SIGINT')

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
  }, 15000)
})

describe('ct-next — `git worktree add` genuinamente colgado, sin que la señal llegue nunca al hijo (finding 1, defensa 2: cota de tiempo)', () => {
  it('no se queda colgado para siempre: el timeout configurado lo acota, revierte el claim y sale con exit 1', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    const start = Date.now()
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: {
        ...process.env,
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
      },
      timeout: 10000, // red de seguridad del propio test: si el fix no funcionara, spawnSync no colgaría el runner para siempre
    })
    const elapsedMs = Date.now() - start

    // No se quedó colgado para siempre: terminó bastante antes de la red de
    // seguridad de 10s del propio test, cerca de la cota configurada (800ms).
    expect(elapsedMs).toBeLessThan(5000)
    const out = (r.stdout || '') + (r.stderr || '')
    expect(out).toMatch(/no se pudo crear el worktree/)
    expect(out).toMatch(/revertido automáticamente a status:ready|ATENCIÓN: no se pudo revertir/)
    const argv = readFileSync(argvLog, 'utf8')
    // el claim inicial sí se escribió (dispatch-check llegó a completarse
    // antes del cuelgue, que ocurre DESPUÉS, en git worktree add)...
    expect(argv).toMatch(/issue edit 77 --repo o\/r --add-label status:in-progress --remove-label status:ready/)
    // ...y el revert automático también se intentó.
    expect(argv).toMatch(/issue edit 77 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
    expect(r.status).toBe(1)
  }, 15000)
})

describe('ct-next — CT_NEXT_CHILD_TIMEOUT_MS / CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS malformados (validación defensiva, ataque adversarial)', () => {
  it('CT_NEXT_CHILD_TIMEOUT_MS no numérico → exit 2, uso claro, nada de gh/git tocado', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fakePath, CT_NEXT_CHILD_TIMEOUT_MS: 'not-a-number' },
    })
    expect(r.status).toBe(2)
    expect((r.stdout || '') + (r.stderr || '')).toMatch(/CT_NEXT_CHILD_TIMEOUT_MS inválido/)
  })

  it('CT_NEXT_CHILD_TIMEOUT_MS negativo → exit 2', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fakePath, CT_NEXT_CHILD_TIMEOUT_MS: '-5' },
    })
    expect(r.status).toBe(2)
  })

  it('CT_NEXT_CHILD_TIMEOUT_MS por encima del techo (25h) → exit 2', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fakePath, CT_NEXT_CHILD_TIMEOUT_MS: String(25 * 60 * 60 * 1000) },
    })
    expect(r.status).toBe(2)
  })

  it('CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS negativo → exit 2', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fakePath, CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS: '-1' },
    })
    expect(r.status).toBe(2)
  })

  it('CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS por encima del techo (60001ms) → exit 2', () => {
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fakePath, CT_NEXT_TEST_DELAY_AFTER_CLAIM_MS: '60001' },
    })
    expect(r.status).toBe(2)
  })
})
