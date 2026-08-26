// Que la COORDINADORA lance el vigilante del `-OK` al despachar, y sólo cuando
// hay algo que vigilar.
//
// Por qué el vigilante vive en este lado y no en el del agente: la doctrina de
// este repo lo dice cinco veces —«el kickoff es un prompt, no un gate. Un agente
// que no lo llame se salta esta puerta» (dispatch-check.mjs), «ninguna exigencia
// que el spec le haga al agente puede depender de que el agente lea el spec»
// (kickoff.js)—. Pedirle al agente que se vigile su propio gate sería una
// obligación creada por una línea de prompt. Y el reparto de papeles lo remata:
// la coordinadora «groomea, despacha, REVISA y mergea»; la despachada
// «implementa lo suyo Y PARA» (README).
//
// El vigilante de verdad se sustituye por una grabadora vía CT_WATCH_GO_BIN: sin
// eso, cada test que despacha un slice dejaría un proceso sondeando GitHub
// durante ocho horas.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCOUNT_ENV } from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { cmuxSessionName } from '../scripts/dispatch.js'
import { GO_TOKEN, goCommitment } from '../scripts/go-response.js'
import { goPath } from '../scripts/go-registry.js'

const AQUI = dirname(fileURLToPath(import.meta.url))
const script = join(AQUI, '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(AQUI, 'fixtures')
const RECORDER = join(fixturesDir, 'fake-watch-go-bin', 'recorder.mjs')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  join(fixturesDir, 'fake-osascript-bin'),
  process.env.PATH,
].join(':')

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
})
function repoRootNuevo() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-watch-go-'))
  dirs.push(d)
  return d
}

// El hijo va DESPRENDIDO y sin `unref` no se espera a nadie, así que ct-next
// puede terminar antes de que la grabadora escriba. Se sondea el fichero en vez
// de leerlo una vez: si no, el test sería intermitente por construcción.
async function esperarArgv(ruta, ms = 5000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    if (existsSync(ruta)) return readFileSync(ruta, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    await new Promise((r) => setTimeout(r, 25))
  }
  return null
}

function despachar(repoRoot, issue, envExtra = {}) {
  const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...ACCOUNT_ENV,
      PATH: fakePath,
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
      // El log del vigilante va a ~/.claude/control-tower/log/. En un test eso
      // sería el $HOME de quien lo corre, así que se redirige con la variable
      // REAL que el código ya consulta, no con una trampa de test.
      CLAUDE_CONFIG_DIR: join(repoRoot, 'claude-config'),
      CT_WATCH_GO_BIN: RECORDER,
      FAKE_WATCH_GO_LOG: join(repoRoot, 'watch-go-argv.log'),
      ...envExtra,
    },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const issueCon = (labels) => ({ number: 90, title: '#90 el cliente tipado', labels, body: '' })

describe('la coordinadora lanza el vigilante del -OK', () => {
  it('lo lanza al despachar, con el issue, el repo y el título exacto de la sesión', async () => {
    const repoRoot = repoRootNuevo()
    // Sin ninguna label `gate:`, resolveGatesForAgent cae al Tipo — y el gate
    // `plan` está implicado en TODO slice (gates.js#gatesForType). O sea que el
    // caso por defecto SÍ para a esperar, y por tanto SÍ estrena vigilante.
    const r = despachar(repoRoot, issueCon([{ name: 'status:ready' }]))
    expect(r.code).toBe(0)
    expect(r.out).toContain(`vigilante del ${GO_TOKEN} de #90 lanzado`)

    const llamadas = await esperarArgv(join(repoRoot, 'watch-go-argv.log'))
    expect(llamadas).toHaveLength(1)
    const argv = llamadas[0]
    expect(argv).toContain('--issue')
    expect(argv[argv.indexOf('--issue') + 1]).toBe('90')
    expect(argv[argv.indexOf('--repo') + 1]).toBe('o/r')
    // El título es el HANDLE con el que el vigilante encontrará la sesión: no
    // hay identificador estable que cmux devuelva al crearla. Se compara contra
    // cmuxSessionName y no contra una cadena escrita a mano, porque una segunda
    // copia de esa plantilla divergiría y entonces el vigilante se apagaría en su
    // primer sondeo diciendo que la sesión ya no existe — el go de esa persona
    // sin entregar, y el mensaje culpando a la sesión en vez al desajuste.
    // El nombre del slice llega ya sin el `#90 ` del título del issue: lo quita
    // el mapeo del issue, no esta ronda.
    expect(argv[argv.indexOf('--session') + 1]).toBe(
      cmuxSessionName({ repoName: 'r', issue: 90, sliceName: 'el cliente tipado' }),
    )
    // El log lo abre el VIGILANTE, no ct-next: cuando lo abría ct-next, la
    // suite creaba ficheros en el $HOME real de quien la corriera. Aquí sólo
    // viaja la ruta.
    expect(argv[argv.indexOf('--log') + 1]).toMatch(/watch-go-90\.log$/)
  })

  it('dice dónde está el log, porque un proceso que corre cuando no miras y no deja rastro es indepurable', () => {
    const repoRoot = repoRootNuevo()
    const r = despachar(repoRoot, issueCon([{ name: 'status:ready' }]))
    expect(r.out).toMatch(/Log: .*watch-go-90\.log/)
  })

  it('NO lo lanza si el slice no tiene el gate `plan`: no hay nada que vigilar', async () => {
    const repoRoot = repoRootNuevo()
    // `gate:none` es una declaración explícita de "ningún gate" (gates.js:
    // existe precisamente para distinguirla de "este issue es viejo"). Un slice
    // así no para a esperar a nadie, y un proceso sondeando GitHub ocho horas
    // para nada es peor que su ausencia.
    const r = despachar(repoRoot, issueCon([{ name: 'status:ready' }, { name: 'gate:none' }]))
    expect(r.code).toBe(0)
    expect(r.out).not.toContain('vigilante del')
    expect(await esperarArgv(join(repoRoot, 'watch-go-argv.log'), 600)).toBe(null)
  })
})

describe('el vigilante no puede tumbar el despacho', () => {
  // -------------------------------------------------------------------------
  // `spawn(process.execPath, [bin, …])` con un `bin` que NO EXISTE no falla: el
  // ejecutable es siempre `node`. El proceso nace, muere al instante con un
  // error de módulo, y antes de este arreglo se anunciaba «vigilante lanzado»
  // con un pid ya muerto. Lo cazó una revisión adversarial, y señaló que el test
  // que decía cubrirlo fijaba a la vez un bin roto y un log imposible, así que
  // pasaba por el fallo del log y el bin roto no se probaba nunca.
  //
  // Es la misma clase de defecto que F19/H1 cerró en el despacho —«cmux devolvió
  // 0» no es «el comando corrió»— con una evidencia aún más débil: lo único
  // comprobado sería que `node` existe.
  // -------------------------------------------------------------------------
  it('un programa de vigilante que no existe se avisa, y NO se anuncia como lanzado', async () => {
    const repoRoot = repoRootNuevo()
    const r = despachar(repoRoot, issueCon([{ name: 'status:ready' }]), {
      CT_WATCH_GO_BIN: join(repoRoot, 'no-existe', 'ni-de-broma.mjs'),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/lanzado #90/)
    expect(r.out).toMatch(/no se ha lanzado el vigilante/)
    expect(r.out).toMatch(/no existe/)
    expect(r.out).not.toMatch(/vigilante del .* lanzado \(pid/)
    expect(r.out).toMatch(/a mano/)
    expect(await esperarArgv(join(repoRoot, 'watch-go-argv.log'), 600)).toBe(null)
  })

  it('si no se sabe dónde vive el estado de la coordinadora, se avisa y el slice sigue lanzado', () => {
    // El trabajo ya está en marcha cuando esto corre. No poder vigilar el go
    // significa volver al modo de antes —empujar la sesión a mano—, no perder
    // el slice. Misma regla que el `git add` de la telemetría en ct-step: el
    // termómetro no es parte del motor.
    //
    // F38 — CON `HOME` Y `CLAUDE_CONFIG_DIR` VACÍOS, LO PRIMERO QUE FALLA YA NO
    // ES EL LOG: es el REGISTRO DEL GO, que sin una ruta absoluta se niega a
    // escribir (go-registry.js) en vez de dejar el compromiso en el cwd, donde
    // nadie lo leería. Se asertan las dos mitades del aviso a propósito: antes
    // este test sólo miraba el exit code, así que habría seguido verde con el
    // aviso hablando de otra cosa — que es exactamente lo que pasó al construir
    // esta ronda.
    const repoRoot = repoRootNuevo()
    const r = despachar(repoRoot, issueCon([{ name: 'status:ready' }]), {
      CLAUDE_CONFIG_DIR: '',
      HOME: '',
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/lanzado #90/)
    expect(r.out).toMatch(/no se ha lanzado el vigilante/)
    expect(r.out).toMatch(/no se ha podido registrar el go/)
    // El remedio, nombrado: sin registro la puerta 9 se negará, y hay un comando
    // para salir de ahí.
    expect(r.out).toMatch(/ct-go\.mjs --issue 90 --repo o\/r/)
    // Y no se anuncia ningún vigilante lanzado: sin compromiso registrado, un go
    // que arrancara el trabajo no se podría honrar al liberar.
    expect(r.out).not.toMatch(/vigilante del .* lanzado \(pid/)
  })

  // -------------------------------------------------------------------------
  // El único handle del vigilante es el TÍTULO de la sesión. Si cmux acaba de
  // contestar que no hay ninguna sesión con ese título, lanzarlo era anunciar
  // «la sesión arranca sola» en la misma corrida en la que se dice que esa
  // sesión no se localiza. El repo tiene un fichero de tests entero contra esta
  // clase de mensaje (ct-next-honest-messages.test.js).
  // -------------------------------------------------------------------------
  it('NO se lanza cuando cmux no encuentra la sesión que se acaba de crear', async () => {
    const repoRoot = repoRootNuevo()
    const r = despachar(repoRoot, issueCon([{ name: 'status:ready' }]), {
      FAKE_CMUX_SKIP_STATE_SUBSTR: '#90',
    })
    expect(r.out).toMatch(/no se encontró ninguna sesión con el nombre/)
    expect(r.out).not.toMatch(/la sesión arranca sola/)
    expect(await esperarArgv(join(repoRoot, 'watch-go-argv.log'), 600)).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// F38 — EL NONCE DEL GO SALE POR LA PANTALLA Y POR NINGÚN OTRO SITIO.
//
// Es la propiedad entera de la ronda: el agente no puede FABRICAR el go porque
// el nonce no está en su contexto, ni en el issue, ni en su worktree, ni en el
// argv de un proceso que él puede leer con `ps`, ni en el log del vigilante. Lo
// que viaja a todos esos sitios es el sha256. Si un cambio futuro filtrara el
// nonce al argv, esta ronda dejaría de valer para nada Y NADA MÁS FALLARÍA — de
// ahí que estos tests miren dónde NO está.
// ---------------------------------------------------------------------------
describe('el nonce del go: dónde aparece y dónde no', () => {
  const nonceDe = (out) => (out.match(/-OK ([0-9a-f]{8})/) || [])[1]

  it('se dicta por pantalla, y al vigilante le llega sólo su sha256', async () => {
    const repoRoot = repoRootNuevo()
    const r = despachar(repoRoot, issueCon([{ name: 'status:ready' }]))
    expect(r.code).toBe(0)

    const nonce = nonceDe(r.out)
    expect(nonce).toMatch(/^[0-9a-f]{8}$/)
    expect(r.out).toContain(`GO de #90: contesta exactamente \`${GO_TOKEN} ${nonce}\``)

    const argv = (await esperarArgv(join(repoRoot, 'watch-go-argv.log')))[0]
    const hash = argv[argv.indexOf('--go-hash') + 1]
    // El hash es EL del nonce dictado: si divergieran, la persona tecleraría el
    // permiso correcto y no arrancaría nada.
    expect(hash).toBe(goCommitment(nonce))
    // Y el nonce NO está en el argv, que es lo que `ps` enseña al agente.
    expect(argv.join(' ')).not.toContain(nonce)
  })

  it('el compromiso queda registrado fuera del repo, y sin el nonce dentro', () => {
    const repoRoot = repoRootNuevo()
    const configDir = join(repoRoot, 'claude-config')
    const r = despachar(repoRoot, issueCon([{ name: 'status:ready' }]))
    const nonce = nonceDe(r.out)

    const ruta = goPath({ repo: 'o/r', issue: 90, configDir })
    // Fuera del repo a propósito: en GitHub todo lo escribe el agente, que tiene
    // `gh`; un compromiso en una label lo convertiría en un juego de una jugada.
    expect(ruta.startsWith(configDir)).toBe(true)
    const dato = JSON.parse(readFileSync(ruta, 'utf8'))
    expect(dato.commitment).toBe(goCommitment(nonce))
    expect(readFileSync(ruta, 'utf8')).not.toContain(nonce)
  })

  it('con CT_GO_CHANNEL=notify el nonce no pasa por stdout: no entra en el contexto de NINGÚN agente', () => {
    const repoRoot = repoRootNuevo()
    const log = join(repoRoot, 'osascript.log')
    const r = despachar(repoRoot, issueCon([{ name: 'status:ready' }]), {
      CT_GO_CHANNEL: 'notify',
      FAKE_OSASCRIPT_LOG: log,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/enviado por notificación del sistema/)
    expect(r.out).not.toMatch(/-OK [0-9a-f]{8}/)
    // El go sí va en la notificación, y en un ARGUMENTO aparte: nada se
    // interpola dentro del AppleScript, así que no hay nada que escapar.
    const llamada = JSON.parse(readFileSync(log, 'utf8').trim().split('\n')[0])
    expect(llamada[llamada.length - 1]).toMatch(new RegExp(`^\\${GO_TOKEN} [0-9a-f]{8}$`))
  })

  it('si la notificación falla, cae a pantalla DICIÉNDOLO — callarse dejaría el gate sin go', () => {
    const repoRoot = repoRootNuevo()
    const r = despachar(repoRoot, issueCon([{ name: 'status:ready' }]), {
      CT_GO_CHANNEL: 'notify',
      FAKE_OSASCRIPT_FAIL: '1',
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/la notificación del go de #90 falló/)
    // Y avisa de la consecuencia real: el nonce SÍ acaba en este contexto.
    expect(r.out).toMatch(/SÍ entra en el contexto de esta sesión/)
    expect(r.out).toMatch(/-OK [0-9a-f]{8}/)
  })

  it('sin gate `plan` no se registra ningún go: no hay nada que autorizar', () => {
    const repoRoot = repoRootNuevo()
    const configDir = join(repoRoot, 'claude-config')
    const r = despachar(repoRoot, issueCon([{ name: 'status:ready' }, { name: 'gate:none' }]))
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/GO de #90/)
    expect(existsSync(goPath({ repo: 'o/r', issue: 90, configDir }))).toBe(false)
  })
})
