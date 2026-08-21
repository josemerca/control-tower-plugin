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
import { GO_TOKEN } from '../scripts/go-response.js'

const AQUI = dirname(fileURLToPath(import.meta.url))
const script = join(AQUI, '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(AQUI, 'fixtures')
const RECORDER = join(fixturesDir, 'fake-watch-go-bin', 'recorder.mjs')

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
    // copia de esa plantilla divergiría y el vigilante se quedaría esperando
    // para siempre a algo que ya llegó, sin ningún error que lo delate.
    // El nombre del slice llega ya sin el `#90 ` del título del issue: lo quita
    // el mapeo del issue, no esta ronda.
    expect(argv[argv.indexOf('--session') + 1]).toBe(
      cmuxSessionName({ repoName: 'r', issue: 90, sliceName: 'el cliente tipado' }),
    )
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
  it('si no se puede lanzar, se avisa y el slice sigue lanzado', () => {
    // El trabajo ya está en marcha cuando esto corre. No poder vigilar el go
    // significa volver al modo de antes —empujar la sesión a mano—, no perder
    // el slice. Misma regla que el `git add` de la telemetría en ct-step: el
    // termómetro no es parte del motor.
    const repoRoot = repoRootNuevo()
    const r = despachar(repoRoot, issueCon([{ name: 'status:ready' }]), {
      CT_WATCH_GO_BIN: join(repoRoot, 'no-existe', 'ni-de-broma.mjs'),
      // El log tampoco se puede crear: un fichero dentro de una ruta que es un
      // fichero, no un directorio.
      CLAUDE_CONFIG_DIR: join(repoRoot, 'gh-list-count', 'imposible'),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/lanzado #90/)
    expect(r.out).toMatch(/no se pudo lanzar el vigilante/)
    expect(r.out).toMatch(/a mano/)
  })
})
