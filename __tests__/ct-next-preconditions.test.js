// D4 — el dry-run miente y el mapa de cuentas manda trabajo a la cuenta
// equivocada. Tests de EXTREMO A EXTREMO contra ct-next.mjs (nunca contra un
// repo, un cmux o un gh reales: stubs en PATH, repoRoot en un directorio
// temporal, y --dry-run con fixture donde no hace falta ni eso).
//
// Cada bloque de aquí se comprobó primero contra el código SIN arreglar: si
// no falla ahí, no prueba nada. Ver el informe de la tarea para el detalle.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync, cpSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// D4: entorno hermético (dirs de cuenta reales bajo tmpdir + stubs de
// cmux/claude en PATH) — ver fixtures/hermetic-env.js. Los tests de este
// fichero que ejercen la AUSENCIA de un binario fijan su propio PATH, que
// gana sobre este (los overrides se esparcen después).
import { ACCOUNT_ENV, hermeticEnv } from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(here, '..')
const scriptsDir = join(projectRoot, 'scripts')
const script = join(scriptsDir, 'ct-next.mjs')
const fixturesDir = join(here, 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  process.env.PATH,
].join(':')

// PATH mínimo para los casos que necesitan simular la AUSENCIA de un binario.
// No basta con omitir el stub y dejar `process.env.PATH` detrás: `cmux` y
// `claude` están instalados DE VERDAD en la máquina de desarrollo, así que
// esa omisión encontraría el binario real (el error exacto que ya cometió un
// agente anterior de este proyecto). Estos tests usan un PATH que NO incluye
// el real — posible solo porque van con --dry-run + CT_NEXT_FIXTURE, donde
// ct-next.mjs no lanza ni un subproceso (ni git, ni gh, ni cmux).
const dirs = []
function makeTmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
})

const FIXTURE_ONE_READY = JSON.stringify({
  issues: [{ n: 42, order: 1, status: 'ready', deps: [], touches: ['api'], name: 'refresh', type: 'backend', ac: ['AC-1'], issue: '#42' }],
  mergedIssues: [],
})

// process.execPath, no la cadena 'node': varios tests de aquí fijan un PATH
// que NO contiene el PATH real (para poder simular la ausencia de cmux/claude
// sin riesgo de encontrar los binarios de verdad de la máquina), y con ese
// PATH la propia palabra 'node' no resolvería — el spawn fallaría antes de
// ejecutar nada y el test mediría el arnés, no el código.
function run(args, envOverrides = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...hermeticEnv(), ...envOverrides },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

function runReal(args, envOverrides = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...envOverrides },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }

// ---------------------------------------------------------------------------
// Defecto 2 — argumentos numéricos parseados con `parseInt`
// ---------------------------------------------------------------------------
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

describe('ct-next --cap: parseo estricto (D4, defecto 2)', () => {
  // Verificado contra el código sin arreglar, en el mismo orden que aquí:
  // "1e3" despachaba 1 slice, "3perros" despachaba 3, "2.9" despachaba 2, y
  // " 3" y "+2" colaban igual — los cinco con exit 0 y sin una sola línea de
  // aviso. El usuario pedía un cap y recibía otro.
  for (const bad of ['1e3', '3perros', '2.9', ' 3', '0x2', '1_000', '']) {
    it(`--cap ${JSON.stringify(bad)} → exit 2, nunca un cap distinto del pedido`, () => {
      const r = run(['--repo', 'menoplus-app/menoplus', '--cap', bad, '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
      expect(r.code).toBe(2)
      expect(r.out).toMatch(/--cap inválido/)
      expect(r.out).not.toMatch(/seleccionados para esta tanda/)
    })
  }

  // Rango vs. forma: dos errores distintos, con dos correcciones distintas.
  // Un "0" está BIEN ESCRITO (parseStrictInt lo lee fielmente como 0), así
  // que el mensaje correcto es el de rango, no "esto no es un entero".
  // (D5, hallazgo I: "-1" se movió de aquí a la lista de FORMA inválida — un
  // signo ya no es "dígitos decimales a secas". La distinción rango/forma se
  // conserva donde sigue significando algo: el 0.)
  it('--cap 0 → exit 2 con un mensaje de RANGO, distinto del de "no es un entero"', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '0', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/debe ser >= 1/)
  })

  // D5, hallazgo I — el mensaje de error decía "debe ser un entero en dígitos
  // decimales a secas" y "+2" se aceptaba igual: el mensaje afirmaba una
  // regla y el código aplicaba otra, la misma familia que el resto de esta
  // tanda. Verificado contra el código sin arreglar: `--cap +2` salía con
  // exit 0 e imprimía "cap 2", y `--cap -1` daba el mensaje de rango.
  for (const signed of ['+2', '-1']) {
    it(`--cap ${signed} → exit 2 con el mensaje de FORMA, que ahora sí nombra el signo`, () => {
      const r = run(['--repo', 'menoplus-app/menoplus', '--cap', signed, '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
      expect(r.code).toBe(2)
      expect(r.out).toMatch(/--cap inválido/)
      expect(r.out).toMatch(/ni signo "\+"\/"-"/)
      expect(r.out).not.toMatch(/debe ser >= 1/)
      expect(r.out).not.toMatch(/seleccionados para esta tanda/)
    })
  }

  it('--cap 3 (bien escrito) sigue funcionando', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '3', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/cap 3/)
  })

  it('--repo sin forma owner/repo → exit 2 (antes llegaba hasta gh y moría con un 404 sin explicar por qué)', () => {
    const r = run(['--repo', 'menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/--repo inválido/)
  })
})

// ---------------------------------------------------------------------------
// Defecto 1 — mapa de cuentas, con voz
// ---------------------------------------------------------------------------
describe('ct-next — cuenta resuelta, siempre dicha en voz alta (D4, defecto 1)', () => {
  it('repo que casa una regla → dice la cuenta Y la regla, sin avisos', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/cuenta resuelta: .*\.claude-personal \(personal\) — por la regla "\*\/menoplus"/)
    expect(r.out).not.toMatch(/POR DEFECTO/)
  })

  it('repo de la org mercadona → cuenta de TRABAJO (antes caía en la personal, en silencio)', () => {
    const r = run(['--repo', 'mercadona/algun-tool-interno', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/cuenta resuelta: .*\.claude-work \(trabajo\)/)
    expect(r.out).toMatch(/CLAUDE_CONFIG_DIR=\S*\.claude-work/)
  })

  it('el cambio de cuenta respecto del mapa anterior NUNCA pasa callado', () => {
    const r = run(['--repo', 'mercadona/algun-tool-interno', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    expect(r.out).toMatch(/aviso: CAMBIO DE CUENTA/)
    expect(r.out).toMatch(/se despachaba antes con \S*\.claude-personal/)
    expect(r.out).toMatch(/ahora se despacha con \S*\.claude-work/)
  })

  it('repo que no casa ningún patrón → dice que es el DEFAULT, cuál es, y cómo arreglarlo', () => {
    const r = run(['--repo', 'desconocido/lo-que-sea', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/aviso: ningún patrón de ACCOUNT_MAP casa/)
    expect(r.out).toMatch(/cuenta POR DEFECTO/)
    expect(r.out).toMatch(/desconocido\/\*/) // la sugerencia concreta de arreglo
  })

  // F16/H2: desde que los avisos salen por STDERR y el plan por STDOUT, este
  // test NO puede seguir usando `run()` — concatenar `stdout + stderr` ordena
  // por STREAM, no por tiempo, así que el aviso caería siempre después del
  // plan y el test fallaría contra un código perfectamente correcto (y, peor,
  // pasaría si algún día se emitiera al revés). La única forma honesta de
  // afirmar "esta línea salió antes que aquella" con dos streams distintos es
  // mandarlos AL MISMO descriptor y leer la transcripción — el mismo patrón
  // que ya usaba `combinedOutputOf` en ct-next-dryrun.test.js.
  it('el aviso se imprime ANTES del plan del slice, no después (requisito: "antes de lanzar nada")', () => {
    const logDir = makeTmp('ct-next-orden-')
    const logPath = join(logDir, 'combined.log')
    const fd = openSync(logPath, 'w')
    try {
      spawnSync(process.execPath, [script, '--repo', 'desconocido/lo-que-sea', '--cap', '1', '--dry-run'], {
        stdio: ['ignore', fd, fd],
        env: { ...process.env, ...hermeticEnv(), CT_NEXT_FIXTURE: FIXTURE_ONE_READY },
      })
    } finally {
      closeSync(fd)
    }
    const out = readFileSync(logPath, 'utf8')
    const avisoAt = out.indexOf('cuenta POR DEFECTO')
    const planAt = out.indexOf('=== slice #42')
    // Ambos índices tienen que existir de verdad: sin esto, un -1 (aviso
    // ausente) "pasaría" el toBeLessThan por casualidad — el test sería
    // verde contra el código sin arreglar, que es justo el que no lo imprime.
    expect(avisoAt).toBeGreaterThan(-1)
    expect(planAt).toBeGreaterThan(-1)
    expect(avisoAt).toBeLessThan(planAt)
  })
})

describe('ct-next — ACCOUNT_MAP malformado se detecta AL ARRANCAR (D4, defecto 1)', () => {
  // Se copia el árbol de scripts a un temporal y se estropea SOLO la copia de
  // kickoff.js: el mapa vive en código, así que no hay forma de inyectar uno
  // malo por env sin abrir una puerta de configuración que producción no debe
  // tener. Mismo patrón de copia que ya usa ct-next-claim.test.js.
  const SIBLINGS = ctNextSiblings(scriptsDir).concat(['dispatch-check.mjs'])

  // El temporal va DENTRO del proyecto (no en tmpdir) a propósito, igual que
  // en ct-next-claim.test.js: `state.js` importa el paquete `yaml`, y la
  // resolución de módulos de Node sube por el árbol de directorios buscando
  // node_modules — desde /tmp no encontraría ninguno y el test mediría un
  // ERR_MODULE_NOT_FOUND en vez del exit code del mapa malformado.
  function copyScriptsWithMap(mapSource) {
    const dir = mkdtempSync(join(projectRoot, 'tmp-ct-next-badmap-'))
    dirs.push(dir)
    for (const f of SIBLINGS) cpSync(join(scriptsDir, f), join(dir, f))
    const kickoff = readFileSync(join(dir, 'kickoff.js'), 'utf8')
    const patched = kickoff.replace(/export const ACCOUNT_MAP = \{[\s\S]*?\n\}/, mapSource)
    expect(patched).not.toBe(kickoff) // el reemplazo tiene que haber ocurrido de verdad
    writeFileSync(join(dir, 'kickoff.js'), patched)
    return join(dir, 'ct-next.mjs')
  }

  it('un patrón sin owner (el formato viejo) → exit 2 al arrancar, sin listar issues ni tocar nada', () => {
    const copied = copyScriptsWithMap('export const ACCOUNT_MAP = {\n  personal: [\'menoplus\'],\n  work: [],\n  personalDir,\n  workDir,\n}')
    const r = spawnSync('node', [copied, '--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], {
      encoding: 'utf8', env: { ...process.env, ...ACCOUNT_ENV, CT_NEXT_FIXTURE: FIXTURE_ONE_READY },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    expect(r.status).toBe(2)
    expect(out).toMatch(/ACCOUNT_MAP .*está mal formado/)
    expect(out).toMatch(/personal\[0\]/)
    expect(out).not.toMatch(/seleccionados para esta tanda/)
  })

  it('un patrón vacío → exit 2 (el caso literal del encargo)', () => {
    const copied = copyScriptsWithMap('export const ACCOUNT_MAP = {\n  personal: [\'*/menoplus\', \'\'],\n  work: [],\n  personalDir,\n  workDir,\n}')
    const r = spawnSync('node', [copied, '--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], {
      encoding: 'utf8', env: { ...process.env, ...ACCOUNT_ENV, CT_NEXT_FIXTURE: FIXTURE_ONE_READY },
    })
    expect(r.status).toBe(2)
    expect(((r.stdout || '') + (r.stderr || ''))).toMatch(/personal\[1\]/)
  })
})

// ---------------------------------------------------------------------------
// Defecto 3 — precondiciones del run real
// ---------------------------------------------------------------------------
describe('ct-next --dry-run — precondiciones de binarios y cuenta (D4, defecto 3)', () => {
  // PATH sin cmux Y sin el PATH real: con --dry-run + fixture, ct-next.mjs no
  // lanza NINGÚN subproceso, así que un PATH vacío es seguro y, sobre todo,
  // no puede encontrar el cmux de verdad de la máquina.
  it('cmux ausente del PATH → FALLO DURO (exit 1): lo invoca este mismo proceso, su ausencia rompe seguro', () => {
    const emptyDir = makeTmp('ct-next-emptypath-')
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], {
      CT_NEXT_FIXTURE: FIXTURE_ONE_READY,
      PATH: emptyDir,
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/`cmux` no está en el PATH/)
    expect(r.out).toMatch(/NO es luz verde/)
  })

  it('cmux presente pero claude ausente → AVISO (no concluyente: lo resuelve el shell de login), exit 0', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], {
      CT_NEXT_FIXTURE: FIXTURE_ONE_READY,
      PATH: join(fixturesDir, 'fake-cmux-bin'),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/aviso: `claude` no aparece en el PATH/)
    // y el recap final tiene que dejar claro que el 0 se dio A PESAR del aviso
    expect(r.out).toMatch(/terminó con exit 0 A PESAR de \d+ aviso/)
  })

  it('el CLAUDE_CONFIG_DIR resuelto no existe en disco → FALLO DURO (exit 1) antes de lanzar nada', () => {
    const gone = join(makeTmp('ct-next-nodir-'), 'no-existe')
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], {
      CT_NEXT_FIXTURE: FIXTURE_ONE_READY,
      CT_ACCOUNT_PERSONAL_DIR: gone,
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/NO existe en disco/)
    expect(r.out).toContain(gone)
  })

  it('el CLAUDE_CONFIG_DIR existe pero es un FICHERO → también falla duro (un existsSync a secas lo dejaría pasar)', () => {
    const asFile = join(makeTmp('ct-next-filedir-'), 'soy-un-fichero')
    writeFileSync(asFile, '')
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], {
      CT_NEXT_FIXTURE: FIXTURE_ONE_READY,
      CT_ACCOUNT_PERSONAL_DIR: asFile,
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/como directorio/)
  })

  it('CT_ACCOUNT_WORK_DIR reapunta la cuenta de trabajo (y se valida igual)', () => {
    const workDir = makeTmp('ct-next-work-')
    const r = run(['--repo', 'mercadona/algo', '--cap', '1', '--dry-run'], {
      CT_NEXT_FIXTURE: FIXTURE_ONE_READY,
      CT_ACCOUNT_WORK_DIR: workDir,
    })
    expect(r.code).toBe(0)
    expect(r.out).toContain(`CLAUDE_CONFIG_DIR=${workDir}`)
  })

  it('con todo en su sitio, el dry-run dice explícitamente qué comprobó', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/cmux: \S+ \(encontrado en PATH; no se ejecuta/)
    expect(r.out).toMatch(/CLAUDE_CONFIG_DIR: \S+ \(existe en disco\)/)
  })

  it('en modo fixture, el destino se marca como NO COMPROBADO en vez de darse por libre', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    expect(r.out).toMatch(/NO COMPROBADOS \(modo fixture/)
  })
})

describe('ct-next — destino ocupado: se detecta ANTES de reclamar (D4, defecto 3)', () => {
  function makeRepoRoot() {
    return makeTmp('ct-next-precond-repo-')
  }

  it('--dry-run con la rama feat/42 ya existente → exit 1 y lo dice; el dry-run deja de ser luz verde', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GIT_STALE_BRANCH_EXISTS: '42',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/la rama feat\/42 ya existe/)
    expect(r.out).toMatch(/NO es luz verde/)
  })

  it('--dry-run con el worktree ya existente → exit 1 y lo dice', () => {
    const repoRoot = makeRepoRoot()
    mkdirSync(join(repoRoot, '.worktrees', '42'), { recursive: true })
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/el worktree de #42 ya existe/)
  })

  // EL test que justifica todo el bloque: en la corrida REAL, con la rama ya
  // ocupada, ct-next.mjs escribía primero el claim (status:ready →
  // status:in-progress), luego `git worktree add` fallaba, y recién entonces
  // revertía. Ahora no se escribe NADA: el log de argv de gh no puede tener
  // ni un solo `issue edit` para #42.
  it('corrida REAL con la rama ocupada → exit 1 SIN haber escrito ningún claim', () => {
    const repoRoot = makeRepoRoot()
    const argvLog = join(repoRoot, 'gh-argv-log')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GIT_STALE_BRANCH_EXISTS: '42',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/la rama feat\/42 ya existe/)
    expect(r.out).toMatch(/ni un solo claim escrito/)
    const argv = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(argv).not.toMatch(/issue edit 42/)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })

  // El directorio ya no está, pero git sigue teniéndolo registrado (alguien
  // lo borró a mano sin `git worktree remove`). `existsSync` por sí solo dice
  // "libre" y `git worktree add` revienta después con "missing but already
  // registered worktree" — en el run real, con el claim ya escrito.
  it('worktree registrado pero con el directorio borrado a mano → exit 1 y apunta a `git worktree prune`', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GIT_WORKTREE_REGISTERED: join(repoRoot, '.worktrees', '42'),
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/SIGUE teniéndolo registrado/)
    expect(r.out).toMatch(/git worktree prune/)
  })

  // Un fallo de la CONSULTA no es una respuesta: "no pude preguntar si la
  // rama existe" no puede leerse como "la rama está libre", porque "libre"
  // es justo lo que autoriza a reclamar.
  it('si la consulta de la rama falla, se avisa — nunca se da por libre en silencio', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
      FAKE_GIT_REV_PARSE_BROKEN: '1',
    })
    expect(r.out).toMatch(/no se pudo comprobar si la rama feat\/42 ya existe/)
    expect(r.out).not.toMatch(/destino libre/)
    expect(r.out).toMatch(/A PESAR de \d+ aviso/)
  })

  it('destino libre en una corrida real → el dry-run lo afirma con evidencia, no por omisión', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42], []]),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/destino libre: .*no existe y la rama feat\/42 tampoco \(comprobado/)
  })
})

describe('ct-next --dry-run — el kickoff se ve como PROSA (D4, defecto 3)', () => {
  it('imprime el kickoff en líneas de verdad, no como un blob con \\n escapados', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    expect(r.code).toBe(0)
    const start = r.out.indexOf('--- kickoff que recibiría el agente')
    const end = r.out.indexOf('--- fin del kickoff ---')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const block = r.out.slice(start, end)
    // Prosa de verdad: varias líneas reales…
    expect(block.split('\n').length).toBeGreaterThan(5)
    // …y ni un solo "\n" de dos caracteres (que es como salía antes, dentro
    // del JSON.stringify de la línea de cmux).
    expect(block).not.toContain('\\n')
    expect(block).toMatch(/Es human-gated/)
  })

  it('lo que se ejecutaría se conserva íntegro y literal — F19 lo movió de la línea de cmux al script de arranque, pero NO se puede esconder', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })
    // ANTES de F19 esto era `--command "claude --dangerously-skip-permissions
    // …"`: el comando entero viajaba TECLEADO al pty, que es exactamente lo
    // que dejó que un prompt de oh-my-zsh se comiera la `c` de `claude` en el
    // primer despacho real (ver __tests__/f19-verificar-el-arranque.test.js).
    // Ahora se teclea solo un `. <ruta>` y el comando vive en el script. La
    // propiedad que este test defiende NO cambia —el dry-run tiene que enseñar
    // literalmente lo que se ejecutaría, sin recortes— solo cambia dónde está.
    expect(r.out).toMatch(/cmux new-workspace --name .*--command "\. '.*launch\.sh'"/)
    expect(r.out).toMatch(/script de arranque que cmux sourcearía/)
    expect(r.out).toMatch(/^claude --dangerously-skip-permissions '/m)
  })
})

// ---------------------------------------------------------------------------
// Defecto 5 — un slice sin número resoluble no puede despacharse
// ---------------------------------------------------------------------------
describe('ct-next — slice sin número de issue utilizable (D4, defecto 5)', () => {
  const FIXTURE_NO_N = JSON.stringify({
    issues: [{ order: 1, status: 'ready', deps: [], touches: [], name: 'sin numero', type: 'backend' }],
    mergedIssues: [],
  })

  it('no se despacha, y el identificador ilegible no se propaga a rama/worktree/claim/título', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_NO_N })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no es un número de issue utilizable/)
    // Antes: "feat/undefined", ".worktrees/undefined", "dispatch-check.mjs
    // undefined", y el título "repo · #undefined nombre" — con exit 0.
    expect(r.out).not.toMatch(/feat\/undefined|worktrees\/undefined|· #undefined/)
    expect(r.out).not.toMatch(/=== slice/)
  })

  // El encargo describía este defecto como "el nombre del workspace sale como
  // `repo · #— nombre`". Lo observado contra el código sin arreglar con un
  // slice SIN `n` fue peor (`#undefined` propagado a rama/worktree/claim),
  // pero un `n` que es literalmente un guion largo — la forma que usa
  // slices.js para "sin valor" — es el mismo defecto por la otra puerta, y
  // se para en el mismo sitio.
  it('un `n` que es un guion largo (el caso literal del encargo) tampoco se despacha', () => {
    const fx = JSON.stringify({
      issues: [{ n: '—', order: 1, status: 'ready', deps: [], touches: [], name: 'raro', type: 'backend' }],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no es un número de issue utilizable/)
    expect(r.out).not.toMatch(/· #—/)
  })

  // Con cap > 1, un solo slice sin número aborta la tanda ENTERA antes de
  // reclamar nada — la misma decisión que ya regía para cualquier fallo de
  // precondición: se prefiere no empezar a empezar a medias.
  // D5, hallazgo H: la tanda entera sigue sin despacharse (exit 1, ningún
  // claim), pero el --dry-run YA NO se calla el plan de los slices sanos —
  // un dry-run existe para enseñar la tanda entera de una vez. Antes, el
  // bloque `=== slice #7 ===` no se imprimía en absoluto.
  it('con cap 2, un slice roto impide el despacho de la tanda entera — pero el dry-run SÍ enseña el plan del slice sano', () => {
    const fx = JSON.stringify({
      issues: [
        { n: null, order: 1, status: 'ready', deps: [], touches: ['a'], name: 'roto', type: 'backend' },
        { n: 7, order: 2, status: 'ready', deps: [], touches: ['b'], name: 'bueno', type: 'backend' },
      ],
      mergedIssues: [],
    })
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '2', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(1)
    // El plan del slice sano se imprime igual...
    expect(r.out).toMatch(/=== slice #7/)
    // ...y el resumen final dice cuántos fallaron, cuál rompería primero, y
    // cuál queda sin problemas propios.
    expect(r.out).toMatch(/precondiciones NO cumplidas \(1\)/)
    expect(r.out).toMatch(/el primero que rompería es \(slice SIN número de issue utilizable/)
    expect(r.out).toMatch(/1 sin problemas propios \(#7\)/)
    expect(r.out).toMatch(/NO es luz verde/)
  })

  it('la línea de selección tampoco lo imprime como si fuera un número', () => {
    const r = run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_NO_N })
    expect(r.out).toMatch(/seleccionados para esta tanda.*SIN número de issue utilizable/)
    expect(r.out).not.toMatch(/#undefined/)
  })
})
