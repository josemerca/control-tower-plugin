// El vigilante del MERGE (scripts/ct-watch-merge.mjs), contra `gh` y `cmux` de
// mentira.
//
// Lo que este fichero fija: que el merge de la PR de un slice llegue a la
// sesión coordinadora sin que nadie se lo cuente. Hasta esta ronda, mergear era
// un acto que no producía ninguna señal mecánica — la cosecha (F20: el worktree
// `.worktrees/<n>`, la rama `feat/<n>` y su `claude` zombi) se quedaba en disco
// hasta que la misma persona que había mergeado iba a la ventana de la
// coordinadora a decírselo.
//
// Se ejecuta el script DE VERDAD como subproceso, igual que ct-watch-go.test.js
// y por el mismo motivo: lo que queda por probar aquí es la costura —hablar con
// `gh`, encontrar la coordinadora por su DIRECTORIO y teclearle la línea—, que
// es justo lo que un test con dobles en memoria no comprobaría.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(AQUI, '..', 'scripts', 'ct-watch-merge.mjs')
const STUBS = [join(AQUI, 'fixtures', 'fake-gh-bin'), join(AQUI, 'fixtures', 'fake-cmux-bin')].join(':')

let dir
let stateFile
let contadores = 0

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'watch-merge-'))
  stateFile = join(dir, 'cmux-state.json')
  // La coordinadora, expuesta por el stub con su `ref` y su `cwd`. El vigilante
  // la va a localizar por el DIRECTORIO (el checkout principal), no por el
  // título: así no hay ningún nombre de sesión que configurar en ningún sitio.
  // El título es distinto del cwd a propósito — si el vigilante buscara por
  // título, este test fallaría.
  writeFileSync(stateFile, JSON.stringify([{ title: 'coordinadora de repo-pulse', cwd: dir }]))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

// El vigilante corre hasta que decide, así que cada caso le pone plazos cortos:
// lo que se prueba es la decisión, no el reloj.
function correr(env = {}, { timeoutMs = 800, pollMs = 40, coordinatorCwd = null } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [
      SCRIPT, '--issue', '5', '--repo', 'jjponz/repo-pulse',
      '--coordinator-cwd', coordinatorCwd ?? dir,
    ], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        PATH: `${STUBS}:${process.env.PATH}`,
        FAKE_CMUX_STATE_FILE: stateFile,
        // La línea que se teclea es prosa, no un comando: sin esto el stub
        // intentaría ejecutarla con `sh -c`.
        FAKE_CMUX_SKIP_COMMAND_SUBSTR: 'coordinadora',
        CT_WATCH_MERGE_TIMEOUT_MS: String(timeoutMs),
        CT_WATCH_MERGE_POLL_MS: String(pollMs),
        ...env,
      },
    })
    return { status: 0, stdout }
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  }
}

const pendienteDe = () => JSON.parse(readFileSync(stateFile, 'utf8'))[0].pending

// El merge tiene que LLEGAR, no estar ya ahí: el vigilante nace justo cuando el
// PR se abre, así que el primer sondeo ve el PR sin mergear. Los casos de
// entrega van en secuencia — primeros sondeos vacíos, el siguiente con el PR
// mergeado — que es además cómo se ve de verdad.
const conMerge = (extra = {}) => ({
  FAKE_GH_PR_LIST_SEQUENCE: JSON.stringify([
    [],
    [{ number: 41, mergedAt: '2026-08-25T09:12:00Z' }],
  ]),
  FAKE_GH_PR_LIST_COUNTER_FILE: join(dir, `contador-${++contadores}`),
  ...extra,
})

// PATH sin `cmux` — pero CON `node`, o el stub de `gh` (que es un script con
// shebang `env node`) tampoco arrancaría y el test mediría otra cosa.
const sinCmux = () => [join(AQUI, 'fixtures', 'fake-gh-bin'), dirname(process.execPath), '/usr/bin', '/bin'].join(':')

describe('el vigilante entrega el aviso del merge', () => {
  it('ve el PR mergeado y teclea la línea en la coordinadora', () => {
    const r = correr(conMerge())
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/línea enviada/)
    // El `send-key Enter` consume el pendiente: que esté a null es la prueba de
    // que la línea se ENVIÓ y se ejecutó, no que se quedó en la línea de
    // edición. Los dos pasos van separados porque `cmux send` no añade Enter.
    expect(pendienteDe()).toBe(null)
  })

  it('la línea nombra el PR, el slice y los dos artefactos de la cosecha', () => {
    // Lo que la coordinadora recibe tiene que bastarle para actuar sin volver a
    // preguntar: qué PR, qué slice, y qué hay en disco. Si el mensaje sólo
    // dijera "mergeado", el humano seguiría siendo el bus de mensajes.
    //
    // Se lee del REGISTRO de invocaciones de cmux, no del `pending` del stub:
    // `send-key Enter` consume el pendiente (lo pone a null), que es justo lo
    // que el test de arriba usa como prueba de que la línea se ejecutó. Las dos
    // aserciones necesitan fuentes distintas.
    const invocaciones = join(dir, 'cmux-argv.log')
    const r = correr(conMerge({ FAKE_CMUX_INVOKED_LOG_FILE: invocaciones }))
    expect(r.status).toBe(0)
    const linea = readFileSync(invocaciones, 'utf8')
    expect(linea).toMatch(/#41/)
    expect(linea).toMatch(/#5/)
    expect(linea).toMatch(/\.worktrees\/5/)
    expect(linea).toMatch(/feat\/5/)
  })

  it('espera mientras el PR no está mergeado, y avisa en el tick en que lo está', () => {
    // Lo que de verdad importa: que no se rinda en el primer sondeo. Un PR se
    // mergea horas o días después de abrirse.
    const r = correr(conMerge())
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/línea enviada/)
  })
})

describe('el vigilante no avisa de lo que no es un merge', () => {
  it('un PR abierto y sin mergear agota el plazo sin tocar la coordinadora', () => {
    const r = correr({ FAKE_GH_PR_LIST: '[]' })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/plazo agotado/)
    expect(pendienteDe()).toBeUndefined()
  })
})

describe('lo que no puede tumbar la vigilancia', () => {
  it('un fallo de `gh` se anota y se reintenta en el próximo tick', () => {
    // La red se cae y el token caduca. Lo que no puede pasar es que un fallo
    // transitorio se lea como «no está mergeado» de forma permanente: el
    // vigilante se apagaría con el trabajo entregado y sin cosechar.
    const r = correr({ FAKE_GH_PR_LIST_FAIL: '1' })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/no se pudo consultar el PR/)
    expect(r.stdout).toMatch(/se reintenta/)
  })

  it('si el merge llega y no hay coordinadora, lo dice y muere', () => {
    writeFileSync(stateFile, JSON.stringify([]))
    const r = correr(conMerge())
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/cmux dice que no existe/)
    expect(r.stdout).toMatch(/a mano/)
  })

  it('si el merge llega y justo entonces no se puede preguntar a cmux, NO se abandona', () => {
    // El hallazgo que ct-watch-go pagó con una revisión adversarial: «cmux
    // contestó que no está» y «no se pudo preguntar» no significan lo mismo, y
    // tirar la distinción en el camino de ENTREGA mata la vigilancia en el
    // único instante que importa.
    const r = correr(conMerge({ PATH: sinCmux() }), { timeoutMs: 500, pollMs: 40 })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/el merge está visto pero no se pudo consultar cmux/)
    expect(r.stdout).toMatch(/se reintenta la entrega/)
  })

  // -------------------------------------------------------------------------
  // LA DIVERGENCIA DELIBERADA RESPECTO A ct-watch-go.
  //
  // Aquél se apaga en cuanto cmux contesta que la sesión del slice no existe, y
  // hace bien: sin esa sesión no hay nada que vigilar. Aquí NO, y el motivo es
  // que la ausencia de la coordinadora no significa lo mismo: cerrar su ventana
  // es lo normal —te vas a dormir y el merge llega por la mañana— y es justo el
  // caso que este vigilante existe para cubrir. Apagarse entonces sería
  // apagarse siempre en el escenario que motiva todo esto.
  // -------------------------------------------------------------------------
  it('si la coordinadora no está mientras espera, sigue vigilando', () => {
    writeFileSync(stateFile, JSON.stringify([]))
    const r = correr({ FAKE_GH_PR_LIST: '[]' }, { timeoutMs: 400, pollMs: 40 })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/plazo agotado/)
    // Y no se ha inventado un exit 4 «la sesión ya no existe» como el del
    // vigilante del go: aquí eso no es una cota, es el caso normal.
    expect(r.stdout).not.toMatch(/ya no existe/)
  })

  it('si el tecleo falla lo dice y muere: el merge se vio y no se pudo entregar', () => {
    const r = correr(conMerge({ FAKE_CMUX_SEND_FAIL: '1' }))
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/no se pudo escribir/)
  })
})

describe('los argumentos y los plazos', () => {
  it('sin issue, repo o cwd de la coordinadora no arranca', () => {
    let r
    try {
      execFileSync(process.execPath, [SCRIPT, '--issue', '5'], { encoding: 'utf8', timeout: 10_000 })
      r = { status: 0, stderr: '' }
    } catch (e) {
      r = { status: e.status, stderr: String(e.stderr || '') }
    }
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/uso:/)
  })

  it('un plazo que no se entiende aborta en vez de caer al defecto en silencio', () => {
    // Mismo criterio que CT_WATCH_GO_POLL_MS y CT_NEXT_LAUNCH_TIMEOUT_MS: un
    // plazo mal escrito cambia lo que este proceso significa, y no querrías
    // descubrirlo dos días después.
    const r = correr({ CT_WATCH_MERGE_POLL_MS: 'un rato' })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/CT_WATCH_MERGE_POLL_MS inválido/)
  })
})
