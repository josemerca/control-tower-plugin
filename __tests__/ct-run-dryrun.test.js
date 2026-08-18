// El conductor entero (scripts/ct-run.mjs), conducido de verdad contra un repo
// real y con las dos cosas caras sustituidas por fixtures: las llamadas al
// modelo y los comandos de los controles.
//
// git NO se sustituye. Se monta un repo temporal y el programa comitea en él de
// verdad, porque la mitad de las propiedades que este fichero fija —que el
// programa comitea y no el implementador, que se stagea antes de medir, que un
// veto no deja rastro— no existen si git es un doble.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'scripts', 'ct-run.mjs')
const F = '```'

// --- el plan del repo de pruebas: dos tareas, con su vara en bloque ---------
const PLAN = [
  '# #7 — dos tareas de mentira',
  '',
  '> **This plan is written to be executed by task-scoped subagents with zero context.**',
  '',
  '## 7. Tasks',
  '',
  '### Task 1 — la primera',
  '**Objective:** un fichero.',
  '**Files:** uno.txt',
  '**TDD:** No TDD — fixture.',
  '**Tests:** N/A — fixture.',
  '**Verification:** el fichero está.',
  '',
  F + 'bash',
  'test -f uno.txt',
  F,
  '',
  '### Task 2 — la segunda',
  '**Objective:** otro fichero.',
  '**Files:** dos.txt',
  '**TDD:** No TDD — fixture.',
  '**Tests:** N/A — fixture.',
  '**Verification:** el otro fichero está.',
  '',
  F + 'bash',
  'test -f dos.txt',
  F,
  '',
].join('\n')

// --- las respuestas del arnés, en el formato de la envoltura real -----------
const envoltura = (structured, { cost = 0.01, isError = false } = {}) => ({
  is_error: isError,
  session_id: 'sesion-de-mentira',
  total_cost_usd: cost,
  structured_output: structured,
  result: JSON.stringify(structured),
  permission_denials: [],
  subtype: 'success',
})
const informe = (paths) => envoltura({ paths, summary: 'hecho' })
const pasa = (findings = []) => envoltura({ ruling: 'PASS', findings })
const veta = (what = 'está mal') => envoltura({ ruling: 'FAIL', findings: [{ severity: 'high', what, where: 'uno.txt:1' }] })

let repo

// El implementador de mentira no escribe: lo escribe el test antes de arrancar,
// porque lo que se está probando es el CONDUCTOR, no el modelo. Los ficheros
// existen desde el principio y sin stagear, que es exactamente el estado en el
// que un implementador de verdad deja el worktree.
function montarRepo() {
  const d = mkdtempSync(join(tmpdir(), 'ct-run-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 'test@example.com')
  g('config', 'user.name', 'Test')
  g('config', 'commit.gpgsign', 'false')
  mkdirSync(join(d, '.agent'), { recursive: true })
  writeFileSync(join(d, '.agent', 'SLICE.md'), '---\nissue: 7\n---\n\n# slice de mentira\n')
  writeFileSync(join(d, 'plan.md'), PLAN)
  g('add', '-A')
  g('commit', '-q', '-m', 'base del slice')
  writeFileSync(join(d, 'uno.txt'), 'uno\n')
  writeFileSync(join(d, 'dos.txt'), 'dos\n')
  return d
}

const correr = (args, { calls = [], controls = null } = {}) => spawnSync('node', [SCRIPT, ...args], {
  cwd: repo,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    CT_RUN_HARNESS_FIXTURE: JSON.stringify(calls),
    ...(controls ? { CT_RUN_CONTROLS_FIXTURE: JSON.stringify(controls) } : {}),
  },
})

const log = () => execFileSync('git', ['log', '--oneline'], { cwd: repo, encoding: 'utf8' })
const commits = () => log().trim().split('\n').filter(Boolean).length

beforeEach(() => { repo = montarRepo() })
afterEach(() => { rmSync(repo, { recursive: true, force: true }) })

describe('el camino feliz', () => {
  it('conduce las dos tareas y las comitea el PROGRAMA, una por tarea', () => {
    const r = correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], {
      calls: [informe(['uno.txt']), pasa(), informe(['dos.txt']), pasa()],
    })
    expect(r.status).toBe(0)
    expect(commits()).toBe(3) // la base + una por tarea
    expect(log()).toMatch(/la primera \(#7, tarea 1\/2\)/)
    expect(log()).toMatch(/la segunda \(#7, tarea 2\/2\)/)
    expect(r.stdout).toMatch(/run delivered/)
  })

  it('lo que comitea es lo que el implementador declaró, no el worktree entero', () => {
    // dos.txt existe desde el principio y la tarea 1 no lo declara: si el
    // programa hiciera `git add -A`, viajaría dentro del primer commit.
    correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], {
      calls: [informe(['uno.txt']), veta()],
    })
    const primerCommit = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(primerCommit).not.toMatch(/dos\.txt/)
  })

  it('el mensaje de commit no lleva closing keywords aunque el plan las traiga', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('### Task 1 — la primera', '### Task 1 — fixes #451 la primera'))
    correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], {
      calls: [informe(['uno.txt']), pasa(), informe(['dos.txt']), pasa()],
    })
    expect(log()).not.toMatch(/fixes\s*#451/i)
    expect(log()).toMatch(/issue 451/)
  })
})

describe('el veto no deja rastro que deshacer', () => {
  it('un FAIL repetido agota los reintentos, sale por 1 y NO comitea esa tarea', () => {
    const r = correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], {
      calls: [
        informe(['uno.txt']), veta(),
        informe(['uno.txt']), veta(),
        informe(['uno.txt']), veta(),
      ],
    })
    expect(r.status).toBe(1)
    expect(commits()).toBe(1) // sólo la base
  })

  it('un PASS con hallazgos medios corrige y luego entrega igual', () => {
    const conQueja = pasa([{ severity: 'medium', what: 'falta un caso', where: 'uno.txt:1' }])
    const r = correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], {
      calls: [
        informe(['uno.txt']), conQueja,   // refunfuño 1 → vuelve a implementar
        informe(['uno.txt']), conQueja,   // refunfuño 2 → vuelve a implementar
        informe(['uno.txt']), conQueja,   // agotado → comitea igual
        informe(['dos.txt']), pasa(),
      ],
    })
    expect(r.status).toBe(0)
    expect(commits()).toBe(3)
  })
})

describe('los controles los mide el programa', () => {
  it('un control en rojo devuelve la tarea al implementador y, agotado, sale por 4', () => {
    const r = correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], {
      calls: [informe(['uno.txt']), informe(['uno.txt']), informe(['uno.txt'])],
      controls: [{ code: 1, output: 'rojo' }, { code: 1, output: 'rojo' }, { code: 1, output: 'rojo' }],
    })
    expect(r.status).toBe(4)
    expect(commits()).toBe(1)
  })

  it('un control que no se pudo MEDIR cierra a la primera, por 5', () => {
    const r = correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], {
      calls: [informe(['uno.txt'])],
      controls: [{ code: 'unmeasured', output: 'command not found' }],
    })
    expect(r.status).toBe(5)
  })

  it('deja el log de cada ronda en disco, y el juez recibe su RUTA', () => {
    correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], {
      calls: [informe(['uno.txt']), pasa(), informe(['dos.txt']), pasa()],
    })
    expect(existsSync(join(repo, '.agent', 'run-7', 'task-1-controls-1.log'))).toBe(true)
    expect(readFileSync(join(repo, '.agent', 'run-7', 'task-1-controls-1.log'), 'utf8')).toMatch(/\$ test -f uno\.txt/)
  })
})

// ---------------------------------------------------------------------------
// La primera corrida REAL del conductor (2026-08-18, dos tareas, haiku) enseñó
// este agujero: la tarea 2 pedía `mul()` y su test, el implementador escribió
// `mul()` y no el test, y `node --test` volvió VERDE porque la suite del commit
// anterior seguía pasando. La vara del plan mide que nada se rompió, no que se
// haya añadido lo prometido.
// ---------------------------------------------------------------------------
describe('los tests que la tarea dijo que añadía', () => {
  const planConTests = PLAN.replace(
    '**Tests:** N/A — fixture.\n**Verification:** el fichero está.',
    "**Tests:** añade `'uno pinta uno'`.\n**Verification:** el fichero está.",
  )

  it('si el test declarado no está en lo stageado, la tarea vuelve en rojo', () => {
    writeFileSync(join(repo, 'plan.md'), planConTests)
    const r = correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], {
      calls: [informe(['uno.txt']), informe(['uno.txt']), informe(['uno.txt'])],
    })
    expect(r.status).toBe(4)
    expect(readFileSync(join(repo, '.agent', 'run-7', 'task-1-controls-1.log'), 'utf8'))
      .toMatch(/dijo que añadía el test 'uno pinta uno'/)
    expect(commits()).toBe(1)
  })

  it('con el test declarado presente en el índice, la tarea sigue adelante', () => {
    writeFileSync(join(repo, 'plan.md'), planConTests)
    writeFileSync(join(repo, 'uno.txt'), "test('uno pinta uno', () => {})\n")
    const r = correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], {
      calls: [informe(['uno.txt']), pasa(), informe(['dos.txt']), pasa()],
    })
    expect(r.status).toBe(0)
    expect(commits()).toBe(3)
  })
})

describe('el veredicto que no se puede leer no es un veredicto', () => {
  it('un juez que incumple el esquema se descarta y se le vuelve a preguntar', () => {
    const r = correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], {
      calls: [
        informe(['uno.txt']), envoltura({ ruling: 'QUIZÁS', findings: [] }),
        pasa(), // el segundo intento del juez, ya legible
        informe(['dos.txt']), pasa(),
      ],
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/veredicto descartado/)
    expect(commits()).toBe(3)
  })

  it('un PASS con hallazgo grave se descarta: se contradice a sí mismo', () => {
    const r = correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], {
      calls: [informe(['uno.txt']), pasa([{ severity: 'high', what: 'mal', where: 'uno.txt:1' }])],
    })
    expect(r.stdout).toMatch(/contradice la rúbrica/)
    expect(r.status).toBe(3)
  })

  it('descartar sin parar se corta con exit 3 en vez de seguir pagando llamadas', () => {
    const ilegible = envoltura({ ruling: 'QUIZÁS', findings: [] })
    const r = correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], {
      calls: [informe(['uno.txt']), ...Array(10).fill(ilegible)],
    })
    expect(r.status).toBe(3)
    expect(r.stderr).toMatch(/descartes en este run/)
  })
})

describe('el dinero', () => {
  it('el tope corta el run y sale por 7, con lo hecho hasta ahí commiteado', () => {
    const caro = (s) => ({ ...s, total_cost_usd: 0.6 })
    const r = correr(['--plan', 'plan.md', '--issue', '7', '--dry-run', '--max-usd', '1'], {
      calls: [caro(informe(['uno.txt'])), caro(pasa()), caro(informe(['dos.txt'])), caro(pasa())],
    })
    expect(r.status).toBe(7)
    expect(r.stderr).toMatch(/tope de dinero agotado/)
    expect(commits()).toBe(2) // la tarea 1 sí entró
  })
})

describe('el plan y el entorno', () => {
  it('un plan cuya verificación es prosa sale por 6 sin llamar a nadie', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace(/```bash\ntest -f uno\.txt\n```/, ''))
    const r = correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], { calls: [] })
    expect(r.status).toBe(6)
    expect(r.stderr).toMatch(/plan no ejecutable/)
  })

  it('fuera del worktree de un slice sale por 8', () => {
    rmSync(join(repo, '.agent', 'SLICE.md'))
    const r = correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], { calls: [] })
    expect(r.status).toBe(8)
    expect(r.stderr).toMatch(/worktree de un slice/)
  })

  it('con el índice sucio de antes sale por 8: ese cambio no lo decidió nadie', () => {
    execFileSync('git', ['add', 'uno.txt'], { cwd: repo })
    const r = correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], { calls: [] })
    expect(r.status).toBe(8)
    expect(r.stderr).toMatch(/índice tiene cambios stageados/)
  })

  it.each([['--issue', '7x'], ['--max-usd', 'mucho']])('%s %s es error de uso (exit 2)', (flag, valor) => {
    const base = ['--plan', 'plan.md', '--issue', '7', '--dry-run']
    const args = flag === '--issue' ? ['--plan', 'plan.md', '--issue', valor, '--dry-run'] : [...base, flag, valor]
    expect(correr(args, { calls: [] }).status).toBe(2)
  })

  it('la fixture del arnés SIN --dry-run se rechaza antes de tocar nada', () => {
    const r = spawnSync('node', [SCRIPT, '--plan', 'plan.md', '--issue', '7'], {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CT_RUN_HARNESS_FIXTURE: '[]' },
    })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/falta --dry-run/)
  })
})

describe('la reanudación no adivina', () => {
  it('el estado se persiste y una segunda invocación retoma donde iba', () => {
    correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], {
      calls: [informe(['uno.txt']), veta(), informe(['uno.txt']), veta(), informe(['uno.txt']), veta()],
    })
    const estado = JSON.parse(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8'))
    expect(estado.task).toBe(1)
    expect(estado.issue).toBe(7)

    // Retoma en el PASO exacto en el que quedó —el juez de la tarea 1— y no
    // desde el principio de la tarea: la primera respuesta que consume es un
    // veredicto, no un informe de implementación.
    expect(estado.step).toBe('judge')
    const otra = correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], {
      calls: [pasa(), informe(['dos.txt']), pasa()],
    })
    expect(otra.stdout).toMatch(/reanudando el run del issue #7 en la tarea 1\/2, paso judge/)
    expect(otra.status).toBe(0)
    expect(commits()).toBe(3)
  })

  it('si el estado y git no cuentan lo mismo, para en vez de reimplementar encima', () => {
    correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], {
      calls: [informe(['uno.txt']), pasa(), informe(['dos.txt']), pasa()],
    })
    // Alguien comitea a mano por su cuenta: el estado dice una cosa y git otra.
    writeFileSync(join(repo, 'tres.txt'), 'tres\n')
    execFileSync('git', ['add', 'tres.txt'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'a mano'], { cwd: repo })
    const estado = JSON.parse(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8'))
    writeFileSync(join(repo, '.agent', 'run-7.json'), JSON.stringify({ ...estado, task: 2, step: 'implement' }))

    const r = correr(['--plan', 'plan.md', '--issue', '7', '--dry-run'], { calls: [] })
    expect(r.status).toBe(8)
    expect(r.stderr).toMatch(/no cuentan lo mismo/)
  })
})
