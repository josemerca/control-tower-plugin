// El vigilante del `-OK` (scripts/ct-watch-go.mjs), contra `gh` y `cmux` de
// mentira.
//
// Lo que este fichero fija es la propiedad entera de la ronda: que el go se dé
// UNA vez, en el issue, y que el trabajo arranque solo. Antes el «ok» de GitHub
// no lo leía nadie y el que reanudaba el trabajo era el que la persona teclaba a
// mano en la ventana de cmux.
//
// Se ejecuta el script DE VERDAD como subproceso: la lógica de decidir ya está
// probada aparte (go-response.test.js) y lo que queda aquí es la costura —
// hablar con `gh`, encontrar la sesión por su título y teclearle la línea—, que
// es justo lo que un test con dobles en memoria no comprobaría.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GO_TOKEN } from '../scripts/go-response.js'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(AQUI, '..', 'scripts', 'ct-watch-go.mjs')
const STUBS = [join(AQUI, 'fixtures', 'fake-gh-bin'), join(AQUI, 'fixtures', 'fake-cmux-bin')].join(':')

const SESION = 'repo-pulse · #5 el cliente tipado'
let dir
let stateFile

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'watch-go-'))
  stateFile = join(dir, 'cmux-state.json')
  // Una sesión ya "lanzada" con el título que el vigilante va a buscar. El stub
  // la expone por `workspace list` con su `ref` y acepta `send` sobre ella.
  writeFileSync(stateFile, JSON.stringify([{ title: SESION, cwd: dir }]))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

// El vigilante corre hasta que decide, así que cada caso le pone plazos cortos:
// lo que se prueba es la decisión, no el reloj.
function correr(env = {}, { timeoutMs = 800, pollMs = 40 } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [
      SCRIPT, '--issue', '5', '--repo', 'jjponz/repo-pulse', '--session', SESION,
    ], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        PATH: `${STUBS}:${process.env.PATH}`,
        FAKE_CMUX_STATE_FILE: stateFile,
        // La línea que se teclea es prosa, no un comando: sin esto el stub
        // intentaría ejecutarla con `sh -c`.
        FAKE_CMUX_SKIP_COMMAND_SUBSTR: '#5',
        CT_WATCH_GO_TIMEOUT_MS: String(timeoutMs),
        CT_WATCH_GO_POLL_MS: String(pollMs),
        ...env,
      },
    })
    return { status: 0, stdout }
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  }
}

const comentario = (body, msDesdeAhora = 60_000) => ({
  body, createdAt: new Date(Date.now() + msDesdeAhora).toISOString(),
})
const pendienteDe = () => JSON.parse(readFileSync(stateFile, 'utf8'))[0].pending

describe('el vigilante entrega el go', () => {
  it('ve el token y teclea la línea en la sesión del slice', () => {
    const r = correr({
      FAKE_GH_VIEW_COMMENTS: JSON.stringify({ comments: [comentario(GO_TOKEN)] }),
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/línea entregada/)
    // El `send-key Enter` consume el pendiente: que esté a null es la prueba de
    // que la línea se ENVIÓ y se ejecutó, no que se quedó en la línea de
    // edición. Los dos pasos van separados porque `cmux send` no añade Enter.
    expect(pendienteDe()).toBe(null)
  })

  it('espera mientras no hay token, y arranca en el tick en que aparece', () => {
    // Lo que de verdad importa: que no se rinda en el primer sondeo. El primer
    // payload no trae go; el segundo sí.
    const r = correr({
      FAKE_GH_VIEW_COMMENTS_SEQUENCE: JSON.stringify([
        { comments: [] },
        { comments: [comentario(GO_TOKEN)] },
      ]),
      FAKE_GH_VIEW_COMMENTS_COUNTER_FILE: join(dir, 'contador'),
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/línea entregada/)
  })
})

describe('el vigilante no entrega lo que no es un go', () => {
  it('un comentario que no es el token exacto agota el plazo sin tocar la sesión', () => {
    // El modo de fallo asimétrico: «-OK pero cambia el nombre» tiene que dejar
    // el trabajo parado, porque arrancarlo es justo lo que esa persona frenaba.
    const r = correr({
      FAKE_GH_VIEW_COMMENTS: JSON.stringify({ comments: [comentario(`${GO_TOKEN} pero cambia el nombre`)] }),
    })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/plazo agotado/)
    expect(pendienteDe()).toBeUndefined()
  })

  it('un go anterior al arranque del vigilante no cuenta: es el de un despacho previo', () => {
    // Sin ventana, redespachar un slice cuyo issue ya llevaba un go heredaría
    // ese go y el gate se saltaría en silencio.
    const r = correr({
      FAKE_GH_VIEW_COMMENTS: JSON.stringify({ comments: [comentario(GO_TOKEN, -3_600_000)] }),
    })
    expect(r.status).toBe(3)
    expect(pendienteDe()).toBeUndefined()
  })
})

describe('lo que no puede tumbar la vigilancia', () => {
  it('un fallo de `gh` se anota y se reintenta en el próximo tick', () => {
    // La red se cae y el token caduca. Lo que no puede pasar es que un fallo
    // transitorio se lea como «no hay go» de forma permanente.
    const r = correr({ FAKE_GH_VIEW_FAIL: '1' })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/no se pudo leer el issue/)
    expect(r.stdout).toMatch(/se reintenta/)
  })

  it('si la sesión no existe lo dice y muere, en vez de fingir que sigue vigilando', () => {
    writeFileSync(stateFile, JSON.stringify([]))
    const r = correr({
      FAKE_GH_VIEW_COMMENTS: JSON.stringify({ comments: [comentario(GO_TOKEN)] }),
    })
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/no se encontró la sesión/)
    expect(r.stdout).toMatch(/a mano/)
  })

  // -------------------------------------------------------------------------
  // LA COTA QUE DE VERDAD ACOTA. El plazo de ocho horas cubre que la persona
  // esté durmiendo; no cubre que la sesión desaparezca, y entonces el vigilante
  // sondearía horas para entregarle una línea a algo que ya no existe. Se vio a
  // la primera: la primera corrida de la suite completa dejó 42 procesos así.
  // -------------------------------------------------------------------------
  it('si la sesión desaparece se apaga solo, sin esperar a agotar el plazo', () => {
    // Plazo largo a propósito: si el vigilante esperara al plazo, este test
    // tardaría un minuto. Que termine rápido ES la aserción.
    writeFileSync(stateFile, JSON.stringify([]))
    const antes = Date.now()
    const r = correr({}, { timeoutMs: 60_000, pollMs: 40 })
    expect(r.status).toBe(4)
    expect(r.stdout).toMatch(/ya no existe/)
    expect(Date.now() - antes).toBeLessThan(20_000)
  })

  it('pero si no se pudo PREGUNTAR por la sesión, sigue esperando', () => {
    // La distinción que ct-next.mjs sostiene con tanto cuidado: "cmux contestó
    // que no está" y "no se pudo preguntar" no significan lo mismo, y de la
    // segunda no se sigue nada. Se quita `cmux` del PATH —no se le pide al stub
    // que finja— porque lo que hay que ejercer es que la consulta no se puede
    // hacer, no que conteste otra cosa.
    const soloGh = `${join(AQUI, 'fixtures', 'fake-gh-bin')}:/usr/bin:/bin`
    const r = correr({ PATH: soloGh }, { timeoutMs: 400, pollMs: 40 })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/no se pudo consultar cmux/)
    expect(r.stdout).toMatch(/plazo agotado/)
  })

  it('si el tecleo falla lo dice y muere: el go se vio y no se pudo entregar', () => {
    const r = correr({
      FAKE_GH_VIEW_COMMENTS: JSON.stringify({ comments: [comentario(GO_TOKEN)] }),
      FAKE_CMUX_SEND_FAIL: '1',
    })
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/no se pudo teclear/)
  })
})

describe('los argumentos y los plazos', () => {
  it('sin issue, repo o sesión no arranca', () => {
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
    // Mismo criterio que CT_NEXT_LAUNCH_TIMEOUT_MS: un plazo mal escrito cambia
    // lo que este proceso significa, y no querrías descubrirlo ocho horas
    // después.
    const r = correr({ CT_WATCH_GO_POLL_MS: 'un rato' })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/CT_WATCH_GO_POLL_MS inválido/)
  })
})
