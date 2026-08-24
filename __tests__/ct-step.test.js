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

import { deliveredRun } from '../scripts/run-machine.js'
import { VERDICT_RULES } from '../scripts/step-contracts.js'

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
  '**Files:** `uno.txt` (create).',
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
  '**Files:** `dos.txt` (create).',
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

// Lo que escribiría un subagente, a fichero. `paths` es una lista de rutas
// simples: el informe no distingue producción de test (ver step-contracts.js).
const informe = (paths, nombre = 'report.json', summary = 'hecho') => {
  const p = join(repo, nombre)
  writeFileSync(p, JSON.stringify({ paths, summary }))
  return p
}
// A estos tests no les importa la regla: la tarea 4 la añadió al contrato, y
// una regla válida cualquiera basta para que el veredicto siga siendo válido
// sin reescribir cada llamada de este fichero. Lo mismo vale para el RECORRIDO
// de la rúbrica, que el contrato exige entero desde el Paso 3: se compone aquí
// a partir de la lista de reglas del propio módulo, así que ni se teclea ocho
// veces ni se queda atrás el día que la rúbrica cambie de tamaño.
// Y lo mismo con los dos campos que el contrato añadió después: la CLASE del
// resultado de cada paso y la CITA de cada hallazgo. A estos tests tampoco les
// importan —lo que miden es la máquina, no el juicio—, así que se rellenan aquí
// con un valor válido en vez de en cada una de las veinte llamadas del fichero.
const recorridoCompleto = () => VERDICT_RULES.map((rule) => ({ rule, result: `mirado en el test: ${rule}`, outcome: 'conforme' }))
const veredicto = (ruling, findings = [], nombre = 'verdict.json') => {
  const p = join(repo, nombre)
  const conRegla = findings.map((f) => ({ rule: 'alcance', evidence: 'la línea que lo prueba', ...f }))
  writeFileSync(p, JSON.stringify({ ruling, rubric: recorridoCompleto(), findings: conRegla }))
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

  it('cuando el juez devolvió la tarea, next se lo dice al implementador', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('verdict', veredicto('FAIL', [{ severity: 'high', what: 'está mal', path: 'uno.txt', line: 1 }]))
    expect(ct('next').stdout).toMatch(/El juez devolvió esta tarea[\s\S]*uno\.txt:1: está mal/)
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
    const r = ct('report', crudo(JSON.stringify({ paths: ['/etc/passwd'], summary: 'ups' })))
    expect(r.stdout).toMatch(/informe descartado.*fuera del worktree/)
    expect(estado().discards).toBe(1)
  })
})

describe('el veto no deja rastro que deshacer', () => {
  const veta = () => ct('verdict', veredicto('FAIL', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }]))

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
    const queja = () => ct('verdict', veredicto('PASS', [{ severity: 'medium', what: 'falta un caso', path: 'uno.txt', line: 1 }]))
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

describe('el alcance de la tarea lo decide el plan', () => {
  it('una ruta tocada que el plan no declara para esa tarea es rojo', () => {
    // La tarea 1 declara sólo uno.txt; el informe trae también dos.txt.
    ct('report', informe(['uno.txt', 'dos.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/dos\.txt.*sobra/)
  })

  it('una ruta declarada que la tarea no tocó es rojo', () => {
    // El informe no trae nada: uno.txt, que la tarea 1 declara, se queda sin tocar.
    ct('report', informe([]))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/uno\.txt.*no está entre lo que tocó/)
  })

  it('(create) sobre un fichero que ya existía es rojo', () => {
    writeFileSync(join(repo, 'existente.txt'), 'ya estaba\n')
    execFileSync('git', ['add', 'existente.txt'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-q', '-m', 'ya existía'], { cwd: repo, stdio: 'ignore' })
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('`uno.txt` (create)', '`existente.txt` (create)'))
    // El implementador lo cambia de verdad: el alcance se mide sobre el
    // ÍNDICE, y un fichero declarado pero sin cambios no stagea nada.
    writeFileSync(join(repo, 'existente.txt'), 'ya estaba, y ahora cambia\n')
    ct('report', informe(['existente.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/existente\.txt.*ya existía en el commit anterior/)
  })
})

describe('lo que los bloques del plan prometen tiene que estar', () => {
  it('un fichero que un bloque nombra y la tarea no tocó es rojo', () => {
    const conBloque = PLAN.replace(
      '**Files:** `uno.txt` (create).\n**TDD:** No TDD — fixture.',
      ['**Files:** `uno.txt` (create).', '', 'Contract (falta.txt):', '', F + 'ts', 'function foo(): void', F, '', '**TDD:** No TDD — fixture.'].join('\n'),
    )
    writeFileSync(join(repo, 'plan.md'), conBloque)
    ct('report', informe(['uno.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/bloque Contract \(falta\.txt\).*no está entre lo que tocó/)
  })

  it('el test que declara el TDD tiene que estar en lo stageado', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace(
      '**TDD:** No TDD — fixture.',
      "**TDD:** `it('uno se sabe de memoria')`",
    ))
    ct('report', informe(['uno.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/dijo que añadía el test 'uno se sabe de memoria' y no está en lo stageado/)
  })

  it('el texto de Final text tiene que aparecer verbatim', () => {
    const conFinalText = PLAN.replace(
      '**Files:** `uno.txt` (create).\n**TDD:** No TDD — fixture.',
      ['**Files:** `uno.txt` (create), `doc.md` (create).', '', 'Final text (doc.md):', '', F + 'md', 'línea uno', 'línea dos', F, '', '**TDD:** No TDD — fixture.'].join('\n'),
    )
    writeFileSync(join(repo, 'plan.md'), conFinalText)
    // El implementador stagea doc.md con una de las dos líneas cambiada.
    writeFileSync(join(repo, 'doc.md'), 'línea uno\nlínea distinta\n')
    ct('report', informe(['uno.txt', 'doc.md']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/Final text \(doc\.md\).*'línea dos'.*no está verbatim/)
  })

  // ==========================================================================
  // EL CASO ADVERSARIAL de la comprobación anterior. `git show :<path>`
  // devuelve contenido para CUALQUIER fichero del índice, esté o no entre lo
  // que la tarea tocó — así que por sí sola esa comprobación no cierra el
  // hueco: un `Final text` que cite un fichero ya comiteado, con el texto ya
  // verbatim ahí desde antes, la pasaría aunque la tarea no lo haya tocado.
  // Lo que cierra el hueco es que todo bloque `Final text (path):` entra
  // TAMBIÉN en `blockPaths`, y ese bucle sí exige pertenencia a `run.lastPaths`
  // (ver la nota sobre `bloquesDeclarados` en ct-step.mjs). La garantía es
  // real pero implícita: nada la fijaba hasta este test, así que simplificar
  // ese bucle por parecer redundante con `finalTexts` reintroduciría en
  // silencio el fallo que este test existe para cazar — el mismo tipo de
  // falso negativo que ya sufrió `testsDeclarados` (ver `planComiteado` más
  // abajo): el plan vive comiteado en `docs/`, así que buscar en el repo es
  // buscar en el plan.
  // ==========================================================================
  it('un Final text que cita un fichero YA COMITEADO, y la tarea no lo toca, es rojo aunque el contenido ya esté verbatim', () => {
    writeFileSync(join(repo, 'ya-existe.md'), 'línea uno\nlínea dos\n')
    execFileSync('git', ['add', 'ya-existe.md'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-q', '-m', 'ya existía con el texto'], { cwd: repo, stdio: 'ignore' })

    const conFinalText = PLAN.replace(
      '**Files:** `uno.txt` (create).\n**TDD:** No TDD — fixture.',
      ['**Files:** `uno.txt` (create).', '', 'Final text (ya-existe.md):', '', F + 'md', 'línea uno', 'línea dos', F, '', '**TDD:** No TDD — fixture.'].join('\n'),
    )
    writeFileSync(join(repo, 'plan.md'), conFinalText)
    execFileSync('git', ['add', 'plan.md'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-q', '-m', 'el plan del slice'], { cwd: repo, stdio: 'ignore' })

    // La tarea sólo declara y toca uno.txt: ya-existe.md queda fuera.
    ct('report', informe(['uno.txt']))
    const r = ct('controls')
    expect(r.stdout).toMatch(/controles: failed/)
    expect(readFileSync(estado().lastControlsLog, 'utf8')).toMatch(/bloque Final text \(ya-existe\.md\).*no está entre lo que tocó/)
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
    const r = ct('verdict', veredicto('PASS', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }]))
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

  it('escribe telemetría con el epic sembrado en todas sus filas', () => {
    // La SECUENCIA de pasos la fija el test del Paso 6, al final del fichero:
    // ahí se retiró la fila de `commit` y ese es el sitio donde consta el motivo.
    tareaOk('uno.txt')
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas.length).toBeGreaterThan(0)
    expect(filas.every((f) => f.epic === '12')).toBe(true)
  })

  it('la fila de implement lleva el resumen del informe: es el único canal por el que se cuenta', () => {
    // El resumen muere en el estado si nadie lo lee (run.lastSummary no lo
    // consulta ningún otro verbo): la telemetría es lo único que lo saca.
    ct('report', informe(['uno.txt']))
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas[0].step).toBe('implement')
    expect(filas[0].summary).toBe('hecho')
  })

  it('un informe descartado no tiene resumen que contar', () => {
    ct('report', crudo(JSON.stringify({ paths: ['/etc/passwd'], summary: 'ups' })))
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas[0].outcome).toBe('discarded')
    expect(filas[0].summary).toBeNull()
  })
})

// Review de capde (2026-08-19), punto 2: el índice acumulaba entre intentos y
// el control de alcance miraba la lista del informe, no lo que de verdad se
// comitea. Las dos mitades del arreglo, cada una con su test.
describe('el índice no acumula entre intentos', () => {
  it('la ruta fuera de alcance del intento 1 NO viaja en el commit del intento 2', () => {
    // Intento 1: el implementador toca de más; se stagea y el control lo caza.
    ct('report', informe(['uno.txt', 'dos.txt']))
    expect(ct('controls').stdout).toMatch(/controles: failed/)
    // Intento 2: reporta solo lo legítimo. El reset de `report` vacía el
    // índice, así que el dos.txt del intento 1 no queda stageado a escondidas.
    ct('report', informe(['uno.txt']))
    expect(ct('controls').stdout).toMatch(/controles: done/)
    ct('verdict', veredicto('PASS'))
    expect(ct('commit').status).toBe(0)
    const files = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(files).toMatch(/uno\.txt/)
    expect(files).not.toMatch(/dos\.txt/)
  })

  it('el alcance mide el ÍNDICE, no la lista del informe: lo stageado sin declarar es rojo', () => {
    ct('report', informe(['uno.txt']))
    // Algo stagea dos.txt por fuera del informe — da igual quién.
    execFileSync('git', ['add', 'dos.txt'], { cwd: repo })
    expect(ct('controls').stdout).toMatch(/controles: failed/)
    const registro = readFileSync(join(repo, '.agent', 'run-7', 'task-1-controls-1.log'), 'utf8')
    expect(registro).toMatch(/dos\.txt.*no la declara/)
  })
})

// Review de capde (2026-08-19), punto 3 / criterio de cierre de F37: el PR de
// un slice trae un VEREDICTO, no una frase del mensaje de commit afirmándolo.
describe('el veredicto viaja en la pull request', () => {
  it('el PASS de cada tarea acaba trackeado y dentro del commit de su tarea', () => {
    tareaOk('uno.txt')
    const ruta = join('docs', 'superpowers', 'verdicts', 'issue-7-task-1.json')
    expect(existsSync(join(repo, ruta))).toBe(true)
    const files = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(files).toMatch(/issue-7-task-1\.json/)
    const guardado = JSON.parse(readFileSync(join(repo, ruta), 'utf8'))
    expect(guardado.verdict.ruling).toBe('PASS')
    expect(guardado.task).toBe(1)
  })

  it('un FAIL no deja veredicto trackeado: solo viaja el que aprueba', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('verdict', veredicto('FAIL', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }]))
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-task-1.json'))).toBe(false)
  })
})

// Review de capde (2026-08-19), punto 1: un prompt no es un gate. La mitad
// ct-step: el cierre bueno se persiste y deliveredRun (que lee el gate de
// dispatch-check --release) lo acepta o explica por qué no.
describe('el cierre bueno se persiste, y el gate del release lo lee', () => {
  it('run delivered → closed: "delivered" en el fichero, y deliveredRun lo acepta', () => {
    tareaOk('uno.txt')
    tareaOk('dos.txt')
    expect(estado().closed).toBe('delivered')
    expect(deliveredRun(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8'), 7)).toEqual({ ok: true })
  })

  it('sobre un run entregado, next dice "ya está" y los verbos que transicionan salen por 9', () => {
    tareaOk('uno.txt')
    tareaOk('dos.txt')
    const n = ct('next')
    expect(n.status).toBe(0)
    expect(n.stdout).toMatch(/run delivered/)
    expect(ct('report', informe(['uno.txt'])).status).toBe(9)
  })

  it('deliveredRun rechaza el run ausente, el de otro issue y el no entregado', () => {
    expect(deliveredRun(null, 7).ok).toBe(false)
    expect(deliveredRun(JSON.stringify({ issue: 8, closed: 'delivered' }), 7).ok).toBe(false)
    expect(deliveredRun('esto no es json', 7).ok).toBe(false)
    tareaOk('uno.txt') // 1 de 2: el run va bien pero NO está entregado
    const parcial = deliveredRun(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8'), 7)
    expect(parcial.ok).toBe(false)
    expect(parcial.why).toMatch(/no está entregado/)
  })
})

// Pasos 4, 5 y 6 del spec de la primera corrida en un repo ajeno.
describe('lo que el implementador avisa, y la telemetría, no se quedan donde nadie los lee', () => {
  it('Paso 4: `report` imprime el resumen del informe', () => {
    // El prompt del implementador le manda poner en `summary` la decisión
    // cerrada que obedeció a disgusto y el problema que vio y no tocó. Medido en
    // campo (jjponz/rust-monitoring#10): dijo que el Cargo.lock se commitea "para
    // CI reproducible" mientras el workflow corre sin --locked, y eso llegó a la
    // pull request SOLO porque aquella sesión abrió el fichero del informe por su
    // cuenta. Ningún verbo lo imprimía y ningún otro lo consultaba.
    const r = ct('report', informe(['uno.txt'], 'report.json', 'obedecí la fila del Cargo.lock y creo que se paga caro'))
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/obedecí la fila del Cargo.lock/)
  })

  it('Paso 4: `next` lo repite en el paso de commit, que es cuando la sesión escribe la pull request', () => {
    ct('report', informe(['uno.txt'], 'report.json', 'la decisión de la tarea 2 deja el lockfile sin hacer valer'))
    ct('controls')
    ct('verdict', veredicto('PASS'))
    const r = ct('next')
    expect(r.stdout).toMatch(/paso: commit/)
    expect(r.stdout).toMatch(/lockfile sin hacer valer/)
  })

  it('Paso 5: la telemetría viaja DENTRO del commit de su tarea', () => {
    tareaOk('uno.txt')
    const tocados = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(tocados).toMatch(/docs\/superpowers\/metrics\/issue-7\.jsonl/)
    const filas = readFileSync(join(repo, 'docs', 'superpowers', 'metrics', 'issue-7.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas.every((f) => f.issue === 7 && f.task === 1)).toBe(true)
  })

  it('Paso 5: NO se stagea antes de los controles, o el control de alcance vetaría la tarea', () => {
    // El veredicto ya resolvió esto mismo: es un artefacto de la maquinaria, no
    // alcance del implementador, así que entra en el índice DESPUÉS de medir.
    ct('report', informe(['uno.txt']))
    ct('controls')
    const enIndice = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, encoding: 'utf8' })
    expect(enIndice).not.toMatch(/metrics/)
    expect(enIndice).toMatch(/uno\.txt/)
  })

  it('Paso 5: las filas del intento que el juez vetó viajan también — el coste de las vueltas es el dato', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('verdict', veredicto('FAIL', [{ severity: 'high', what: 'no', path: 'uno.txt', line: 1 }]))
    ct('report', informe(['uno.txt']))
    ct('controls')
    ct('verdict', veredicto('PASS'))
    ct('commit')
    const commiteado = execFileSync('git', ['show', 'HEAD:docs/superpowers/metrics/issue-7.jsonl'], { cwd: repo, encoding: 'utf8' })
    const filas = commiteado.trim().split('\n').map((l) => JSON.parse(l))
    expect(filas.filter((f) => f.attempt === 1).length).toBeGreaterThan(0)
    expect(filas.filter((f) => f.attempt === 2).length).toBeGreaterThan(0)
    expect(filas.find((f) => f.step === 'judge' && f.attempt === 1).ruling).toBe('FAIL')
  })

  it('Paso 6: la fila de `controls` lleva cuánto tardó, que es el único tiempo que ejecuta el programa', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    const controles = filas.find((f) => f.step === 'controls')
    expect(typeof controles.duration_ms).toBe('number')
    expect(controles.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('Paso 6: no hay fila de `commit`: su sha y su hecho están enteros en git log', () => {
    tareaOk('uno.txt')
    const filas = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas.map((f) => f.step)).toEqual(['implement', 'controls', 'judge'])
  })
})

describe('un fallo de la telemetría no puede tumbar la tarea', () => {
  it('si la ruta del veredicto está gitignoreada, `git add` falla y la tarea se comitea igual', () => {
    // Mismo defecto que el de las métricas, en código anterior (590b995, el que
    // hizo viajar el veredicto): `git add` sobre una ruta ignorada sale con 1, la
    // excepción subía y el run se quedaba atascado en exit 9 con la tarea sin
    // comitear. Decisión humana, tomada al encontrarlo: avisar y seguir. Un
    // veredicto que no puede viajar degrada el contrato de F37 y hay que verlo,
    // pero un run atascado no lo arregla — y el veredicto sigue en disco, en la
    // carpeta del run.
    writeFileSync(join(repo, '.gitignore'), 'docs/superpowers/verdicts/\n')
    execFileSync('git', ['add', '--', '.gitignore'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'ignora los veredictos'], { cwd: repo })
    const r = tareaOk('uno.txt')
    expect(r.status).toBe(0)
    expect(commits()).toBe(3)
    expect(execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })).toMatch(/uno\.txt/)
  })

  it('si la ruta de las métricas está gitignoreada, `git add` falla y la tarea se comitea igual', () => {
    // El principio es del diseño y es viejo: "ninguna transición depende de la
    // medida". Al hacer que la telemetría VIAJE aparece un camino nuevo por el
    // que podía romperlo — el `git add` del fichero — y `git add` sobre una ruta
    // ignorada sale con 1. Un repo que ignore `docs/` no es raro.
    // Se ignora SOLO la ruta de las métricas, no `docs/` entero: con `docs/`
    // ignorado el que revienta primero es el `git add` del VEREDICTO, que es
    // código anterior a este cambio y tiene el mismo defecto — sale por 9 y deja
    // el run atascado. Ese hallazgo se reporta aparte; este test mide lo mío.
    writeFileSync(join(repo, '.gitignore'), 'docs/superpowers/metrics/\n')
    // Solo el .gitignore: un `git add -A` se llevaría también `uno.txt`, y
    // entonces el control de ALCANCE vetaría la tarea (un `(create)` de un
    // fichero que ya está en el commit anterior) y el fallo sería otro.
    execFileSync('git', ['add', '--', '.gitignore'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'ignora las metricas'], { cwd: repo })
    const r = tareaOk('uno.txt')
    expect(r.status).toBe(0)
    expect(commits()).toBe(3)
    expect(execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })).toMatch(/uno\.txt/)
  })
})
