// La máquina de estados como ORÁCULO (scripts/ct-step.mjs): la sesión sigue
// conduciendo, pero no decide la secuencia — la pregunta.
//
// Este test no necesita fixtures de proceso ni --dry-run, y eso no es una
// comodidad: el informe del implementador y el veredicto del juez SON ficheros
// JSON, así que el test escribe exactamente lo que escribirá un subagente. Lo
// único que no se simula es git, que corre de verdad contra un repo temporal —
// la mitad de las propiedades de aquí (comitea el programa, sólo entra lo
// declarado, un veto no deja rastro) no existen si git es un doble.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'scripts', 'ct-step.mjs')
const F = '```'

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

let repo

function montarRepo() {
  const d = mkdtempSync(join(tmpdir(), 'ct-step-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@e.com')
  g('config', 'user.name', 'T')
  g('config', 'commit.gpgsign', 'false')
  mkdirSync(join(d, '.agent'), { recursive: true })
  writeFileSync(join(d, '.agent', 'SLICE.md'), '---\nissue: 7\nepic: 12\n---\n\n# slice de mentira\n')
  writeFileSync(join(d, 'plan.md'), PLAN)
  g('add', '-A')
  g('commit', '-q', '-m', 'base del slice')
  // Los ficheros existen sin stagear, que es como deja el worktree un
  // implementador de verdad.
  writeFileSync(join(d, 'uno.txt'), 'uno\n')
  writeFileSync(join(d, 'dos.txt'), 'dos\n')
  return d
}

const ct = (...args) => spawnSync('node', [SCRIPT, ...args, '--plan', 'plan.md', '--issue', '7'], {
  cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, CLAUDE_CONFIG_DIR: join(repo, '.telemetria') },
})

// Lo que escribiría un subagente, a fichero. `paths` sigue siendo una lista de
// rutas simples porque a estos tests no les importa el kind: la tarea 3 lo
// añadió al contrato, y el valor por defecto 'production' basta para que el
// informe siga siendo válido sin reescribir cada llamada de este fichero.
const informe = (paths, nombre = 'report.json') => {
  const p = join(repo, nombre)
  writeFileSync(p, JSON.stringify({ paths: paths.map((path) => ({ path, kind: 'production' })), summary: 'hecho' }))
  return p
}
const veredicto = (ruling, findings = [], nombre = 'verdict.json') => {
  const p = join(repo, nombre)
  writeFileSync(p, JSON.stringify({ ruling, findings }))
  return p
}
const crudo = (texto, nombre = 'crudo.json') => {
  const p = join(repo, nombre)
  writeFileSync(p, texto)
  return p
}

const log = () => execFileSync('git', ['log', '--oneline'], { cwd: repo, encoding: 'utf8' })
const commits = () => log().trim().split('\n').filter(Boolean).length
const estado = () => JSON.parse(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8'))

// Una tarea entera por el camino feliz.
const tareaOk = (fichero) => {
  ct('report', informe([fichero]))
  ct('controls')
  ct('verdict', veredicto('PASS'))
  return ct('commit')
}

beforeEach(() => { repo = montarRepo() })
afterEach(() => { rmSync(repo, { recursive: true, force: true }) })

describe('next: la sesión pregunta y el oráculo contesta', () => {
  it('dice la tarea, el paso y qué despachar, sin transicionar', () => {
    const r = ct('next')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/tarea 1\/2 — la primera/)
    expect(r.stdout).toMatch(/paso: implement/)
    expect(r.stdout).toMatch(/DESPACHA UN IMPLEMENTADOR/)
    // Preguntar no avanza nada: el paso sigue siendo el mismo.
    expect(ct('next').stdout).toMatch(/paso: implement/)
    expect(estado().step).toBe('implement')
  })

  it('prepara el brief de la tarea, que es lo que el implementador necesita', () => {
    ct('next')
    const brief = join(repo, '.agent', 'run-7', 'task-1-brief.md')
    expect(existsSync(brief)).toBe(true)
    expect(readFileSync(brief, 'utf8')).toMatch(/### Task 1 — la primera/)
  })

  it('en el paso del juez prepara el paquete de revisión del ÍNDICE', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    const r = ct('next')
    expect(r.stdout).toMatch(/DESPACHA EL JUEZ .*ct-judge.*SIN Bash/)
    const paquete = join(repo, '.agent', 'run-7', 'task-1-review.diff')
    expect(readFileSync(paquete, 'utf8')).toMatch(/\+uno/)
  })

  it('el paquete de revisión dice de cada ruta si es producción o test, para que el juez lo vea', () => {
    // El kind existe para un solo consumidor: el juez, que tiene que poder ver
    // si un diff con la suite en verde no toca ningún fichero de producción.
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('next')
    const paquete = join(repo, '.agent', 'run-7', 'task-1-review.diff')
    expect(readFileSync(paquete, 'utf8')).toMatch(/uno\.txt.*production/)
  })

  it('cuando el juez devolvió la tarea, next se lo dice al implementador', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('verdict', veredicto('FAIL', [{ severity: 'high', what: 'está mal', where: 'uno.txt:1' }]))
    expect(ct('next').stdout).toMatch(/El juez devolvió esta tarea[\s\S]*está mal/)
  })
})

// ---------------------------------------------------------------------------
// LA PROPIEDAD CENTRAL: la secuencia es mecanismo, no prosa.
// ---------------------------------------------------------------------------
describe('la guardia del paso', () => {
  it.each([
    ['commit', 'implement'],
    ['controls', 'implement'],
    ['verdict', 'implement'],
  ])('pedir "%s" estando en "%s" se RECHAZA con 9, y dice cuál toca', (verbo, paso) => {
    const r = verbo === 'verdict' ? ct('verdict', veredicto('PASS')) : ct(verbo)
    expect(r.status).toBe(9)
    expect(r.stderr).toMatch(new RegExp(`el run está en "${paso}"`))
    expect(r.stderr).toMatch(/ct-step next/)
  })

  it('no se puede saltar el juez para commitear', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    const r = ct('commit')
    expect(r.status).toBe(9)
    expect(commits()).toBe(1)
  })

  it('no se puede volver a medir una tarea ya comiteada', () => {
    tareaOk('uno.txt')
    expect(estado().task).toBe(2)
    expect(ct('controls').status).toBe(9)   // la tarea 2 está en implement
  })
})

describe('el camino feliz', () => {
  it('dos tareas, dos commits, y los comitea el PROGRAMA', () => {
    tareaOk('uno.txt')
    const r = tareaOk('dos.txt')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/run delivered/)
    expect(r.stdout).toMatch(/lista para la pull request/)
    expect(commits()).toBe(3)
    expect(log()).toMatch(/la primera \(#7, tarea 1\/2\)/)
    expect(log()).toMatch(/la segunda \(#7, tarea 2\/2\)/)
  })

  it('sólo entra en el commit lo que el implementador declaró', () => {
    // dos.txt existe desde el principio y la tarea 1 no lo declara.
    tareaOk('uno.txt')
    const primero = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(primero).not.toMatch(/dos\.txt/)
  })

  it('el mensaje no lleva closing keywords aunque el plan las traiga', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('### Task 1 — la primera', '### Task 1 — fixes #451 la primera'))
    tareaOk('uno.txt')
    expect(log()).not.toMatch(/fixes\s*#451/i)
    expect(log()).toMatch(/issue 451/)
  })

  it('rechaza rutas de fuera del worktree: la lista la escribe un modelo', () => {
    const r = ct('report', crudo(JSON.stringify({ paths: [{ path: '/etc/passwd', kind: 'production' }], summary: 'ups' })))
    expect(r.stdout).toMatch(/informe descartado.*fuera del worktree/)
    expect(estado().discards).toBe(1)
  })
})

describe('el veto no deja rastro que deshacer', () => {
  const veta = () => ct('verdict', veredicto('FAIL', [{ severity: 'high', what: 'mal', where: 'uno.txt:1' }]))

  it('tres vetos agotan el presupuesto, salen por 1 y NO comitean', () => {
    for (let i = 0; i < 3; i++) {
      ct('report', informe(['uno.txt']))
      ct('controls')
      var r = veta()
    }
    expect(r.status).toBe(1)
    expect(commits()).toBe(1)
  })

  it('un PASS con hallazgos medios corrige y luego entrega igual', () => {
    const queja = () => ct('verdict', veredicto('PASS', [{ severity: 'medium', what: 'falta un caso', where: 'uno.txt:1' }]))
    for (let i = 0; i < 3; i++) {
      ct('report', informe(['uno.txt']))
      ct('controls')
      queja()
    }
    expect(estado().step).toBe('commit')     // agotado el presupuesto: entrega
    expect(ct('commit').status).toBe(0)
    expect(commits()).toBe(2)
  })
})

describe('los controles los mide el programa, no el implementador', () => {
  it('un control en rojo devuelve la tarea y, agotado, sale por 4', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('test -f uno.txt', 'test -f no-existe.txt'))
    for (let i = 0; i < 3; i++) {
      ct('report', informe(['uno.txt']))
      var r = ct('controls')
    }
    expect(r.status).toBe(4)
    expect(commits()).toBe(1)
  })

  it('un control que no se pudo MEDIR cierra a la primera, por 5', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('test -f uno.txt', 'comando-que-no-existe-en-esta-maquina'))
    ct('report', informe(['uno.txt']))
    expect(ct('controls').status).toBe(5)
  })

  it('los tests que la tarea prometió tienen que existir en lo stageado', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace(
      '**Tests:** N/A — fixture.\n**Verification:** el fichero está.',
      "**Tests:** añade `'uno pinta uno'`.\n**Verification:** el fichero está.",
    ))
    ct('report', informe(['uno.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/dijo que añadía el test 'uno pinta uno'/)
  })

  // ==========================================================================
  // EL ÁMBITO DE ESA COMPROBACIÓN — los dos de abajo son el mismo bug por sus
  // dos caras, y el de arriba no cazaba ninguna: reescribe el plan SIN
  // comitearlo, así que el nombre del test no llega al índice y
  // `git grep --cached` no lo encuentra mire donde mire.
  //
  // En la vida real el plan SÍ está comiteado —lo exige el gate— y un plan
  // prescriptivo CITA el código verbatim. Medido en el slice #5 de repo-pulse:
  // el nombre de cada test de cada tarea vive dentro de `docs/`. Por eso el
  // plan de estos dos se comitea: sin eso, el test pasa con el bug puesto.
  // ==========================================================================
  const planComiteado = (texto) => {
    writeFileSync(join(repo, 'plan.md'), texto)
    execFileSync('git', ['add', 'plan.md'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-q', '-m', 'el plan del slice'], { cwd: repo, stdio: 'ignore' })
  }
  const conLineaDeTests = (linea) => PLAN.replace(
    '**Tests:** N/A — fixture.\n**Verification:** el fichero está.',
    `**Tests:** ${linea}\n**Verification:** el fichero está.`,
  )

  it('un test RETIRADO que sigue nombrado en el plan comiteado no es un test que siga estando', () => {
    // El falso positivo: el trabajo bien hecho y los controles en rojo, así que
    // la tarea no se podía cerrar por mucho que el implementador insistiera.
    planComiteado(conLineaDeTests("retira `'uno pinta uno'`."))
    ct('report', informe(['uno.txt']))
    expect(ct('controls').stdout).toMatch(/controles: done/)
  })

  it('un test PROMETIDO que sólo está en el plan, y no en lo que la tarea tocó, es rojo', () => {
    // El falso negativo, que es el grave: sin acotar el ámbito, esta
    // comprobación aprueba una tarea que prometió un test y no lo escribió
    // —exactamente el fallo para el que existe— porque el nombre está en el plan.
    planComiteado(conLineaDeTests("añade `'uno pinta uno'`."))
    ct('report', informe(['uno.txt']))
    expect(ct('controls').stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/dijo que añadía el test 'uno pinta uno'/)
  })
})

describe('el veredicto que no se puede leer no es un veredicto', () => {
  const preparar = () => { ct('report', informe(['uno.txt'])); ct('controls') }

  it('un JSON que no parsea es un DESCARTE, no un error de uso', () => {
    preparar()
    const r = ct('verdict', crudo('esto no es json'))
    expect(r.stdout).toMatch(/veredicto descartado/)
    expect(estado().discards).toBe(1)
    expect(estado().step).toBe('judge')      // se le vuelve a preguntar
  })

  it('un ruling inventado se descarta', () => {
    preparar()
    expect(ct('verdict', veredicto('QUIZÁS')).stdout).toMatch(/ruling desconocido/)
  })

  it('un PASS con hallazgo grave se descarta: se contradice a sí mismo', () => {
    preparar()
    const r = ct('verdict', veredicto('PASS', [{ severity: 'high', what: 'mal', where: 'uno.txt:1' }]))
    expect(r.stdout).toMatch(/contradice la rúbrica/)
  })

  it('descartar sin parar se corta con 3 en vez de seguir preguntando', () => {
    preparar()
    let r
    for (let i = 0; i < 7; i++) r = ct('verdict', crudo('nada'))
    expect(r.status).toBe(3)
    expect(r.stderr).toMatch(/descartes en este run/)
  })
})

describe('el plan y el entorno', () => {
  it('un plan cuya verificación es prosa sale por 6, y ni siquiera dice qué despachar', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace(/```bash\ntest -f uno\.txt\n```/, ''))
    const r = ct('next')
    expect(r.status).toBe(6)
    expect(r.stderr).toMatch(/plan no ejecutable/)
  })

  it('fuera del worktree de un slice sale por 8', () => {
    rmSync(join(repo, '.agent', 'SLICE.md'))
    expect(ct('next').status).toBe(8)
  })

  it('con el índice sucio de antes y el run nuevo sale por 8', () => {
    execFileSync('git', ['add', 'uno.txt'], { cwd: repo })
    expect(ct('next').status).toBe(8)
  })

  it('un verbo desconocido es error de uso', () => {
    expect(ct('bailar').status).toBe(2)
  })
})

describe('el sitio en el que va está en disco, no en la conversación', () => {
  it('el estado sobrevive entre invocaciones: cada verbo es un proceso nuevo', () => {
    ct('report', informe(['uno.txt']))
    expect(estado().step).toBe('controls')
    ct('controls')
    expect(estado().step).toBe('judge')
  })

  it('si el estado y git no cuentan lo mismo, para en vez de seguir', () => {
    tareaOk('uno.txt')
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'a mano'], { cwd: repo })
    const r = ct('next')
    expect(r.status).toBe(8)
    expect(r.stderr).toMatch(/no cuentan lo mismo/)
  })

  it('escribe telemetría: una fila por paso, con el epic sembrado', () => {
    tareaOk('uno.txt')
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas.map((f) => f.step)).toEqual(['implement', 'controls', 'judge', 'commit'])
    expect(filas.every((f) => f.epic === '12')).toBe(true)
  })
})
