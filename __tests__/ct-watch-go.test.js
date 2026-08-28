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
import { GO_TOKEN, goBody, goCommitment, newGoNonce, GO_FORMAT_REPLY } from '../scripts/go-response.js'

// F38 — el go que este vigilante reconoce es `-OK <nonce>`, con el nonce de SU
// despacho. Lo que le llega por argv es el sha256 (`--go-hash`): su argv lo
// enseña `ps` a cualquier proceso del mismo uid, el agente incluido.
const NONCE = newGoNonce(Buffer.from([0x3f, 0x9a, 0x1c, 0x04]))
const GO_HASH = goCommitment(NONCE)
const GO = goBody(NONCE)

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
      '--go-hash', env.CT_TEST_GO_HASH ?? GO_HASH,
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

// Los comentarios se identifican por `id` (`gh` lo da: `IC_kwDO…`), que es la
// ventana: cuenta lo que no estaba en la foto inicial. `createdAt` va también
// porque `gh` lo devuelve, pero NADIE lo mira — y hay un test del módulo puro
// que impide volver a cortar por tiempo.
let n = 0
const comentario = (body, id = null) => ({ id: id ?? `IC_${++n}`, body, createdAt: new Date().toISOString() })
const pendienteDe = () => JSON.parse(readFileSync(stateFile, 'utf8'))[0].pending

// El go tiene que LLEGAR después de que el vigilante saque su foto inicial: un
// payload FIJO que ya trae el `-OK` está, por definición, dentro de esa foto, y
// entonces no cuenta — que es exactamente la propiedad de la ventana. Así que
// los casos de entrega van en secuencia: primer sondeo sin go (la foto), el
// siguiente con él. Es además más fiel a lo que pasa de verdad.
let secuencias = 0
const conGo = (extra = {}) => ({
  FAKE_GH_VIEW_COMMENTS_SEQUENCE: JSON.stringify([
    { comments: [] },
    { comments: [comentario(GO)] },
  ]),
  FAKE_GH_VIEW_COMMENTS_COUNTER_FILE: join(dir, `contador-${++secuencias}`),
  ...extra,
})

// PATH sin `cmux` — pero CON `node`, o el stub de `gh` (que es un script con
// shebang `env node`) tampoco arrancaría y el test mediría otra cosa.
const sinCmux = () => [join(AQUI, 'fixtures', 'fake-gh-bin'), dirname(process.execPath), '/usr/bin', '/bin'].join(':')

describe('el vigilante entrega el go', () => {
  it('ve el token y teclea la línea en la sesión del slice', () => {
    const r = correr(conGo())
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/línea enviada/)
    // El `send-key Enter` consume el pendiente: que esté a null es la prueba de
    // que la línea se ENVIÓ y se ejecutó, no que se quedó en la línea de
    // edición. Los dos pasos van separados porque `cmux send` no añade Enter.
    expect(pendienteDe()).toBe(null)
  })

  it('espera mientras no hay token, y arranca en el tick en que aparece', () => {
    // Lo que de verdad importa: que no se rinda en el primer sondeo. El primer
    // payload no trae go; el segundo sí.
    const r = correr(conGo())
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/línea enviada/)
  })
})

describe('el vigilante no entrega lo que no es un go', () => {
  it('un comentario que no es el token exacto agota el plazo sin tocar la sesión', () => {
    // El modo de fallo asimétrico: «-OK pero cambia el nombre» tiene que dejar
    // el trabajo parado, porque arrancarlo es justo lo que esa persona frenaba.
    const r = correr({
      FAKE_GH_VIEW_COMMENTS: JSON.stringify({ comments: [comentario(`${GO} pero cambia el nombre`)] }),
    })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/plazo agotado/)
    expect(pendienteDe()).toBeUndefined()
  })

  it('un go que ya estaba al arrancar no cuenta: es el de un despacho previo', () => {
    // Sin ventana, redespachar un slice cuyo issue ya llevaba un go heredaría
    // ese go y el gate se saltaría en silencio. El payload es FIJO, así que el
    // `-OK` está ya en la foto inicial que el vigilante saca antes de buscar.
    const r = correr({
      FAKE_GH_VIEW_COMMENTS: JSON.stringify({ comments: [comentario(GO, 'IC_heredado')] }),
    })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/1 comentario\(s\) ya presentes/)
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
    const r = correr(conGo())
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/cmux dice que no existe/)
    expect(r.stdout).toMatch(/a mano/)
  })

  // -------------------------------------------------------------------------
  // EL HALLAZGO QUE MÁS DOLÍA de la revisión adversarial: `consultarSesion`
  // distingue «cmux contestó que no está» de «no se pudo preguntar», y el
  // camino de ENTREGA tiraba esa distinción. O sea que un timeout de cmux justo
  // en el tick en que llegaba el `-OK` mataba una vigilancia de ocho horas en
  // el único instante que importaba, y encima diagnosticaba lo contrario de lo
  // que había pasado. Cuando no hay nada que perder se reintentaba; con el go
  // ya en la mano, se abandonaba.
  // -------------------------------------------------------------------------
  it('si el go llega y justo entonces no se puede preguntar a cmux, NO se abandona', () => {
    const r = correr(conGo({ PATH: sinCmux() }), { timeoutMs: 500, pollMs: 40 })
    // Sale por plazo (nunca puede entregar, porque cmux no está), NO por el
    // exit 1 de «no hay sesión»: la diferencia es que sigue intentándolo.
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/el go está visto pero no se pudo consultar cmux/)
    expect(r.stdout).toMatch(/se reintenta la entrega/)
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

  // -------------------------------------------------------------------------
  // EL MISMO FALLO QUE LA REVISIÓN ADVERSARIAL DE LA #37 encontró en el
  // vigilante del merge, y que este fichero arrastraba desde antes: el recorrido
  // de cmux se leía a pelo. `custom_title` es un nombre de campo OBSERVADO, sin
  // garantía de esquema; si cmux lo renombrara, ninguna entrada casaría, se
  // devolvía «cmux contestó y la sesión no está», y este vigilante se APAGABA con
  // exit 4 declarando muerta una sesión que estaba ahí delante — tirando el go de
  // la persona que lo había dado.
  //
  // Aquí duele más que en el del merge: allí se pierde un aviso que /ct-next
  // vuelve a calcular; aquí se pierde el permiso de un humano y el slice se queda
  // parado sin que nadie lo sepa. `ct-next.mjs` ya lo había resuelto (D5,
  // hallazgo B) y desde esta ronda los tres consumidores comparten esa guarda.
  // -------------------------------------------------------------------------
  it('si cmux renombra el campo del título, NO declara muerta la sesión', () => {
    const r = correr({ FAKE_CMUX_SCHEMA_MISMATCH: '1' }, { timeoutMs: 400, pollMs: 40 })
    // Por plazo (exit 3), NO por el exit 4 de «la sesión ya no existe»: la
    // vigilancia sigue en pie en vez de suicidarse con un diagnóstico falso.
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/no se pudo consultar cmux/)
    expect(r.stdout).not.toMatch(/ya no existe/)
  })

  it('pero si no se pudo PREGUNTAR por la sesión, sigue esperando', () => {
    // La distinción que ct-next.mjs sostiene con tanto cuidado: "cmux contestó
    // que no está" y "no se pudo preguntar" no significan lo mismo, y de la
    // segunda no se sigue nada. Se quita `cmux` del PATH —no se le pide al stub
    // que finja— porque lo que hay que ejercer es que la consulta no se puede
    // hacer, no que conteste otra cosa.
    const r = correr({ PATH: sinCmux() }, { timeoutMs: 400, pollMs: 40 })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/no se pudo consultar cmux/)
    expect(r.stdout).toMatch(/plazo agotado/)
  })

  it('si el tecleo falla lo dice y muere: el go se vio y no se pudo entregar', () => {
    const r = correr(conGo({ FAKE_CMUX_SEND_FAIL: '1' }))
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/no se pudo escribir/)
  })
})

describe('la foto inicial', () => {
  // Si la primera lectura falla y se diera la foto por vacía, un `-OK`
  // heredado de un despacho anterior contaría como nuevo y saltaría el gate en
  // silencio — justo lo que la ventana existe para impedir. Así que se
  // reintenta hasta conseguirla, y si no se consigue no se entrega nada.
  it('no se da por vacía: si no se puede leer ni una vez, no se entrega nada', () => {
    const r = correr({ FAKE_GH_VIEW_FAIL: '1' }, { timeoutMs: 300, pollMs: 40 })
    expect(r.status).toBe(3)
    expect(r.stdout).toMatch(/sin poder leer ni una vez/)
    expect(r.stdout).not.toMatch(/foto inicial/)
  })

  it('se anuncia cuántos comentarios no van a contar', () => {
    const r = correr({
      FAKE_GH_VIEW_COMMENTS: JSON.stringify({ comments: [comentario('hola'), comentario('qué tal')] }),
    }, { timeoutMs: 300, pollMs: 40 })
    expect(r.stdout).toMatch(/foto inicial: 2 comentario\(s\) ya presentes/)
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

// El intento que no arranca nada, contestado donde la persona está mirando.
// Medido en jjponz/rust-monitoring#7: `-OK` pelado, silencio, y ocho minutos
// hasta el go bueno. El gate NO se mueve por esto — sigue abriéndose sólo con el
// token exacto—; lo que cambia es que quien lo intenta se entera del formato.
describe('un intento de go que no arranca nada recibe el formato en el issue', () => {
  const conIntento = (cuerpo) => {
    const contador = join(dir, `contador-intento-${++secuencias}`)
    return {
      FAKE_GH_VIEW_COMMENTS_SEQUENCE: JSON.stringify([
        { comments: [] },
        { comments: [comentario(cuerpo)] },
      ]),
      FAKE_GH_VIEW_COMMENTS_COUNTER_FILE: contador,
    }
  }
  // El registro SE LEE CRUDO y no partido por saltos de línea. El cuerpo que se
  // publica es multilínea, así que partirlo dejaba `publicados()[0]` en el
  // primer fragmento del cuerpo y la aserción del nonce miraba donde el nonce
  // nunca iba a estar. Salió mutando: interpolar el hash al FINAL del cuerpo
  // dejaba el test en verde.
  const registro = () => {
    try {
      return readFileSync(join(dir, 'argv.log'), 'utf8')
    } catch {
      return ''
    }
  }
  const cuantosPublicados = () => registro().split('issue comment').length - 1

  it('publica el formato cuando el comentario nuevo es el token pelado', () => {
    correr({ ...conIntento(GO_TOKEN), FAKE_GH_ARGV_LOG_FILE: join(dir, 'argv.log') }, { timeoutMs: 1500, pollMs: 40 })
    expect(cuantosPublicados()).toBe(1)
    expect(registro()).toContain('jjponz/repo-pulse')
  })

  it('el cuerpo publicado es el texto del módulo, y NO lleva el nonce ni su hash', () => {
    correr({ ...conIntento(`${GO_TOKEN} deadbeef`), FAKE_GH_ARGV_LOG_FILE: join(dir, 'argv.log') }, { timeoutMs: 1500, pollMs: 40 })
    expect(cuantosPublicados()).toBe(1)
    expect(registro()).toContain(GO_FORMAT_REPLY)
    expect(registro()).not.toContain(NONCE)
    expect(registro()).not.toContain(GO_HASH)
  })

  it('lo publica UNA vez aunque el intento siga ahí tick tras tick', () => {
    correr({
      FAKE_GH_VIEW_COMMENTS_SEQUENCE: JSON.stringify([
        { comments: [] },
        { comments: [comentario(GO_TOKEN, 'IC_intento')] },
        { comments: [comentario(GO_TOKEN, 'IC_intento')] },
        { comments: [comentario(GO_TOKEN, 'IC_intento')] },
      ]),
      FAKE_GH_VIEW_COMMENTS_COUNTER_FILE: join(dir, `contador-repe-${++secuencias}`),
      FAKE_GH_ARGV_LOG_FILE: join(dir, 'argv.log'),
    }, { timeoutMs: 1500, pollMs: 40 })
    expect(cuantosPublicados()).toBe(1)
  })

  it('un go VÁLIDO no recibe explicación: se contestaría a quien acertó', () => {
    correr({ ...conGo(), FAKE_GH_ARGV_LOG_FILE: join(dir, 'argv.log') })
    expect(cuantosPublicados()).toBe(0)
  })

  it('un comentario que no intenta dar el go no recibe explicación', () => {
    correr({ ...conIntento('me parece bien el plan'), FAKE_GH_ARGV_LOG_FILE: join(dir, 'argv.log') }, { timeoutMs: 1500, pollMs: 40 })
    expect(cuantosPublicados()).toBe(0)
  })

  it('si publicar falla, la vigilancia sigue: el go posterior se entrega igual', () => {
    const r = correr({
      FAKE_GH_VIEW_COMMENTS_SEQUENCE: JSON.stringify([
        { comments: [] },
        { comments: [comentario(GO_TOKEN, 'IC_intento')] },
        { comments: [comentario(GO_TOKEN, 'IC_intento'), comentario(GO, 'IC_bueno')] },
      ]),
      FAKE_GH_VIEW_COMMENTS_COUNTER_FILE: join(dir, `contador-fallo-${++secuencias}`),
      FAKE_GH_ISSUE_COMMENT_FAIL: '1',
      // Plazo HOLGADO y no ajustado, y el motivo es una regresión medida: con
      // 600 ms este caso pasaba suelto y fallaba en la suite completa, porque
      // el go llega en el TERCER sondeo y con la máquina cargada un tick tarda
      // más que su presupuesto. Aquí el plazo no es el sujeto —el sujeto es que
      // un fallo al publicar no mata la vigilancia— y el proceso sale solo en
      // cuanto entrega, así que sobrar plazo no cuesta tiempo cuando pasa.
    }, { timeoutMs: 8000, pollMs: 40 })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/no se pudo publicar el formato/)
    expect(r.stdout).toMatch(new RegExp(`${GO_TOKEN} visto`))
  })
})
