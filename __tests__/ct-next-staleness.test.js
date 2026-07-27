// Finding 2 (auditoría de interrupción/staleness): con #41 atascado en
// status:in-progress reteniendo touches:api (p.ej. tras la interrupción del
// finding 1), la siguiente corrida decía:
//
//   El cap (1) ya está copado por trabajo en vuelo: 1 slice(s) en
//   status:in-progress — aunque subieras --cap no bastaría todavía: #42 está
//   ready con deps mergeadas, pero colisiona con trabajo en vuelo: comparte
//   el token 'api' con #41 (status:in-progress) — espera a que termine, o
//   resuelve el token.
//
// "espera a que termine" es falso cuando nada está corriendo — nada en el
// dispatch cruzaba nunca un in-progress contra evidencia LOCAL de trabajo
// real (worktree, rama, sesión cmux). Estos tests reproducen exactamente el
// escenario del auditor y verifican el mensaje endurecido.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// D4: entorno hermético (dirs de cuenta + stubs de cmux/claude) — ver fixtures/hermetic-env.js
import { ACCOUNT_ENV } from './fixtures/hermetic-env.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  process.env.PATH,
].join(':')

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-stale-'))
  dirs.push(d)
  return d
}

// El issue #41 "atascado" (colisiona vía touches:api) y #42 "ready" que
// choca con él — mismo shape que dispatch-integration-seams.test.js.
function rawIssue({ number, order, status = 'status:ready', touches = [] }) {
  const labels = [{ name: status }, ...touches.map((t) => ({ name: `touches:${t}` }))]
  return { number, title: `#${number} slice`, labels, body: `<!-- ct-order:${order} -->\n` }
}

const issue41Stuck = rawIssue({ number: 41, order: 1, status: 'status:in-progress', touches: ['api'] })
const issue42Ready = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['api'] })

describe('ct-next — colisión contra un in-progress SIN evidencia local (finding 2): el mensaje deja de afirmar "espera a que termine"', () => {
  it('sin worktree, sin rama, y cmux sin ninguna sesión con "#41" → nota de staleness, no "espera a que termine"', () => {
    const repoRoot = makeRepoRoot()
    // repoRoot NO tiene .worktrees/41 (ni se crea aquí).
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      // Sin FAKE_GIT_STALE_BRANCH_EXISTS: NINGUNA rama existe (default).
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify([]), // ninguna sesión cmux viva
    })
    expect(r.code).toBe(0)
    // El diagnóstico sigue siendo correcto (colisiona con #41, token api)...
    expect(r.out).toMatch(/#42 está ready con deps mergeadas, pero colisiona con trabajo en vuelo/)
    expect(r.out).toMatch(/comparte el token 'api' con #41/)
    // ...pero YA NO afirma "espera a que termine" sin matices.
    expect(r.out).not.toMatch(/espera a que termine, o resuelve el token/)
    expect(r.out).not.toMatch(/aunque subieras --cap no bastaría todavía: #42.*espera a que termine\./)
    // Y sí incluye la nota de staleness, dejando claro qué se sabe y qué no.
    expect(r.out).toMatch(/no se encontró worktree, rama local, ni sesión cmux para #41 EN ESTA MÁQUINA/)
    expect(r.out).toMatch(/no puede confirmar que nadie lo esté trabajando en otro sitio/)
    // Nunca afirma el abandono como un hecho llano — solo lo menciona para
    // DESCARTARLO explícitamente ("tampoco afirmamos que esté abandonado").
    expect(r.out).not.toMatch(/#41 está abandonado/i)
    expect(r.out).toMatch(/tampoco afirmamos que esté abandonado/)
  })

  it('con worktree presente para #41 → SIGUE diciendo "espera a que termine" (hay evidencia local real)', () => {
    const repoRoot = makeRepoRoot()
    mkdirSync(join(repoRoot, '.worktrees', '41'), { recursive: true })
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify([]),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/espera a que termine, o resuelve el token\./)
    expect(r.out).not.toMatch(/no se encontró worktree/)
  })

  it('con rama local feat/41 presente (worktree ya borrado, rama huérfana) → SIGUE diciendo "espera a que termine"', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      FAKE_GIT_STALE_BRANCH_EXISTS: '41',
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify([]),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/espera a que termine, o resuelve el token\./)
  })

  it('sin worktree ni rama, pero con una sesión cmux viva cuyo título contiene "#41" → SIGUE diciendo "espera a que termine"', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify(['o/r · #41 arreglar login']),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/espera a que termine, o resuelve el token\./)
  })

  it('ataque adversarial: una sesión cmux "#410" NO debe contar como evidencia de #41 (límite de palabra)', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      // "#410" contiene "#41" como substring pero es un issue DISTINTO — sin
      // límite de palabra en el regex, esto daría un falso "sigue vivo".
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify(['o/r · #410 otra cosa totalmente distinta']),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/no se encontró worktree, rama local, ni sesión cmux para #41 EN ESTA MÁQUINA/)
  })

  it('la consulta a cmux falla (daemon no disponible) → "no concluyente", NUNCA "no hay sesión"', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      FAKE_CMUX_LIST_WINDOWS_FAIL: '1',
    })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/espera a que termine, o resuelve el token\./)
    expect(r.out).not.toMatch(/EN ESTA MÁQUINA/) // esa es la frase del veredicto "sin evidencia" — aquí no aplica
    expect(r.out).toMatch(/no se pudo consultar cmux/)
    expect(r.out).toMatch(/no se puede descartar que el trabajo siga en curso en otro sitio/)
  })

  it('el cmux binario "no está disponible" (stub que siempre falla) → tratado igual que "no concluyente", nunca revienta ct-next.mjs', () => {
    // OJO — cmux SÍ está instalado en esta máquina de verdad (verificado por
    // construcción: un primer intento de este test que simplemente omitía
    // `fake-cmux-bin` del PATH pero conservaba `process.env.PATH` al final
    // TERMINÓ ENCONTRANDO Y CONSULTANDO EL CMUX REAL de la máquina de
    // desarrollo — exactamente el error que el encargo advierte que cometió
    // un agente anterior. Aquí se usa un stub DEDICADO
    // (fixtures/fake-cmux-missing-bin/cmux, que siempre falla) puesto
    // DELANTE del PATH real, para simular ausencia sin arriesgarse jamás a
    // tocar el binario de verdad.
    const repoRoot = makeRepoRoot()
    const pathWithMissingCmuxStub = [
      join(fixturesDir, 'fake-git-bin'),
      join(fixturesDir, 'fake-gh-bin'),
      join(fixturesDir, 'fake-cmux-missing-bin'),
      process.env.PATH,
    ].join(':')
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...ACCOUNT_ENV,
        PATH: pathWithMissingCmuxStub,
        FAKE_GIT_TOPLEVEL: repoRoot,
        FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    expect(r.status).toBe(0)
    expect(out).toMatch(/no se pudo consultar cmux/)
    expect(out).not.toMatch(/espera a que termine, o resuelve el token\./)
  })
})

describe('ct-next — staleness también se aplica al caso cap-lleno + colisión con hueco (finding 2, ataque adversarial: no solo el camino "cap ya cubierto")', () => {
  it('cap 1, #41 en vuelo sin evidencia, #42 colisiona: el mensaje de cap-lleno incluye la nota de staleness (no solo "sube --cap")', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue41Stuck, issue42Ready], []]),
      FAKE_CMUX_WINDOWS_JSON: JSON.stringify([{ id: 'win1' }]),
      FAKE_CMUX_WORKSPACE_TITLES_JSON: JSON.stringify([]),
    })
    expect(r.out).toMatch(/El cap \(1\) ya está copado por trabajo en vuelo: 1 slice\(s\) en status:in-progress/)
    expect(r.out).toMatch(/aunque subieras --cap no bastaría todavía/)
    expect(r.out).toMatch(/no se encontró worktree, rama local, ni sesión cmux para #41 EN ESTA MÁQUINA/)
  })
})

describe('ct-next — staleness no se consulta en absoluto cuando no hace falta (coste solo cuando el motivo de bloqueo es colisión)', () => {
  it('none-ready: ni siquiera se invoca `cmux list-windows` (verificable: cmux "ausente" vía stub dedicado, y aun así exit 0 limpio)', () => {
    // Mismo motivo que el test de arriba para NUNCA depender de omitir
    // `fake-cmux-bin` del PATH: eso deja `process.env.PATH` como fallback,
    // que SÍ tiene el cmux real de esta máquina.
    const repoRoot = makeRepoRoot()
    const pathWithMissingCmuxStub = [
      join(fixturesDir, 'fake-git-bin'),
      join(fixturesDir, 'fake-gh-bin'),
      join(fixturesDir, 'fake-cmux-missing-bin'),
      process.env.PATH,
    ].join(':')
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: { ...process.env, ...ACCOUNT_ENV, PATH: pathWithMissingCmuxStub, FAKE_GIT_TOPLEVEL: repoRoot, FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], []]) },
    })
    expect(r.status).toBe(0)
    const out = (r.stdout || '') + (r.stderr || '')
    expect(out).toMatch(/No hay ningún issue en status:ready/)
    expect(out).not.toMatch(/no se pudo consultar cmux/) // nunca se intentó: no había colisión que explicar
  })
})

// Ataque adversarial descubierto en la revisión propia de esta tarea (no en
// el encargo original): CT_NEXT_FIXTURE promete NUNCA tocar nada real — pero
// sin una guarda explícita, un --dry-run con fixture que colisiona SÍ
// disparaba una llamada real de solo lectura a `cmux list-windows` (nunca
// `new-workspace`, pero real de todas formas) para poder explicar el motivo
// de bloqueo. Verificado por construcción: los dos tests de colisión de
// __tests__/ct-next-dryrun.test.js (por token compartido y por
// serialización) usan CT_NEXT_FIXTURE + --dry-run sin ningún PATH con
// stubs — antes de esta guarda, correr esta suite en una máquina con cmux
// real instalado (como esta) invocaba silenciosamente ese binario de
// verdad. queryAllCmuxWorkspaces ahora corta en seco (`if (fx) return
// null`) antes de tocar ningún subproceso cuando hay un fixture activo.
describe('ct-next — CT_NEXT_FIXTURE + colisión: la nota de staleness NUNCA dispara una llamada real a cmux (ataque adversarial, hallado en autorrevisión)', () => {
  it('con fixture, cmux jamás se invoca (ni de solo lectura) aunque el motivo de bloqueo sea una colisión', () => {
    const repoRoot = makeRepoRoot()
    const invokedLog = join(repoRoot, 'cmux-invoked-log')
    const fx = JSON.stringify({
      issues: [
        { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'], name: 'en curso', type: 'backend' },
        { n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'choca', type: 'backend' },
      ],
      mergedIssues: [],
    })
    // A propósito, PATH incluye el stub de cmux (para que, SI se invocara,
    // quede registrado en vez de fallar por "comando no encontrado" y
    // enmascarar el problema) — lo que se comprueba es que el log de
    // invocación quede VACÍO, no que cmux esté ausente del PATH.
    const r = runReal(['--repo', 'menoplus-app/menoplus', '--cap', '9', '--dry-run'], {
      CT_NEXT_FIXTURE: fx,
      FAKE_CMUX_INVOKED_LOG_FILE: invokedLog,
    })
    expect(r.code).toBe(0)
    // El mensaje de colisión sigue siendo el mismo (fixture nunca resuelve
    // repoRoot real, así que worktree/rama tampoco se comprueban de verdad
    // — pero eso es aparte; lo que este test verifica es cmux).
    expect(r.out).toMatch(/#2/)
    expect(r.out).toMatch(/#1/)
    expect(r.out).toMatch(/api/)
    expect(existsSync(invokedLog)).toBe(false)
  })
})
