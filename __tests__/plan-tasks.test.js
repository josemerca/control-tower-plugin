// El plan leído como lista de tareas EJECUTABLE (scripts/plan-tasks.js).
//
// La fixture principal NO es la plantilla: es el plan REAL del slice #5 de
// repo-pulse, 534 líneas y 8 tareas, tal y como lo escribió un agente
// despachado. Es deliberado — las tres trampas que este parser esquiva no
// aparecen ni una en `plan-template.md`, así que un test contra la plantilla
// pasaría en verde con un parser roto.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extractTasks, stripParenthesised } from '../scripts/plan-tasks.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8')

// Tres backticks en runtime, como en plan-contract.test.js: ninguna línea de
// este fichero puede empezar por un fence real.
const F = '```'

// El plan real tal cual se escribió: su **Verification:** es prosa en línea.
const REAL = fixture('plan-real-issue-5.md')
// El mismo plan con los comandos ya en bloque, que es lo que la regla nueva
// del contrato pide a los planes de ahora en adelante.
const EJECUTABLE = fixture('plan-real-issue-5-ejecutable.md')

const taskOf = (plan, n) => extractTasks(plan).tasks.find((t) => t.n === n)

describe('las tareas del plan', () => {
  it('encuentra las ocho tareas del plan real, numeradas y con nombre', () => {
    const { tasks } = extractTasks(REAL)
    expect(tasks.map((t) => t.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(tasks[0].name).toBe('el entorno de test DOM y el proxy de dev')
  })

  it('un texto sin tareas lo dice en vez de devolver una lista vacía y callar', () => {
    const { tasks, problems } = extractTasks('# un plan sin tareas\n')
    expect(tasks).toEqual([])
    expect(problems.map((p) => p.rule)).toContain('tasks')
  })
})

// ---------------------------------------------------------------------------
// TRAMPA 1 — los comandos viven en el bloque cercado, no en la línea
// ---------------------------------------------------------------------------
describe('la vara de la tarea: el bloque de comandos', () => {
  it('saca los comandos del bloque que va detrás de **Verification:**', () => {
    expect(taskOf(EJECUTABLE, 2).commands).toEqual([
      'npm test -w web   # exit 0',
      'npm run build && npm run lint   # exit 0',
    ])
  })

  it('acepta el bloque aunque el párrafo de **Verification:** lleve texto en línea delante', () => {
    // La tarea 1 del plan real dice: "**Verification:** `npm install` y después:"
    // y sólo entonces abre el bloque.
    expect(taskOf(REAL, 1).commands).toEqual([
      'npm test -w web   # exit 0, 1 test',
      'npm run build && npm run lint   # exit 0',
    ])
  })

  it('acepta el bloque aunque el párrafo de **Verification:** ocupe dos líneas', () => {
    // La tarea 8 del plan real ocupa dos líneas antes de terminar el párrafo.
    expect(taskOf(EJECUTABLE, 8).commands).toEqual([
      'npm test && npm run lint && npm run build   # exit 0',
      'wc -l AGENTS.md',
    ])
  })

  it('NO confunde el bloque de comandos con los bloques Contract y Current state de la tarea', () => {
    // Las tareas reales llevan sus propios cercados de código citado. Sólo
    // cuenta el que va inmediatamente detrás de **Verification:**, y por eso
    // ninguna tarea del plan ejecutable trae TypeScript entre sus comandos.
    for (const t of extractTasks(EJECUTABLE).tasks) {
      expect(t.commands.every((c) => /^(npm|wc|git|node|npx)\b/.test(c))).toBe(true)
    }
  })

  it('el plan REAL no es ejecutable: siete de sus ocho tareas verifican con prosa', () => {
    // Ésta es la medida que justifica la regla nueva del contrato. El plan real
    // es fiel a `plan-template.md` ("**Verification:** {{exact command and
    // expected output}}", en línea), y aun así ningún programa puede ejecutarlo.
    const { problems } = extractTasks(REAL)
    const sinBloque = problems.filter((p) => p.rule === 'verification-block')
    expect(sinBloque.map((p) => p.task)).toEqual([2, 3, 4, 5, 6, 7, 8])
  })

  it('el mismo plan con los comandos en bloque no tiene un solo problema', () => {
    expect(extractTasks(EJECUTABLE).problems).toEqual([])
  })

  it('un bloque de comandos vacío es un problema, no una tarea sin vara', () => {
    const plan = [
      '### Task 1 — vacía',
      '**Tests:** N/A — nada.',
      '**Verification:**',
      '',
      F + 'bash',
      F,
    ].join('\n')
    const { tasks, problems } = extractTasks(plan)
    expect(tasks[0].commands).toEqual([])
    expect(problems.map((p) => p.rule)).toContain('verification-block')
  })
})

// ---------------------------------------------------------------------------
// TRAMPA 2 — los paréntesis se barren POR PROFUNDIDAD
// ---------------------------------------------------------------------------
describe('los nombres de test', () => {
  it('el paréntesis explicativo con paréntesis dentro no cuela un nombre de test falso', () => {
    // El plan real, tarea 6:
    //   'a zero series sits on the baseline' (polylinePoints([0, 0], 1) es
    //   '0.0,199.0 600.0,199.0')
    // Con un barrido de un solo nivel, `0.0,199.0 600.0,199.0` entra como
    // nombre de test, no existe en ningún fichero y bloquea la tarea con un
    // falso positivo.
    const t6 = taskOf(REAL, 6)
    expect(t6.testsAdded).toEqual([
      'both series share one scale',
      'a zero series sits on the baseline',
      'the area closes on the baseline',
      'the pulse draws the previous window behind the current one',
      'on the full window there is no overlay',
    ])
    expect(t6.testsAdded).not.toContain('0.0,199.0 600.0,199.0')
  })

  it('el barrido de un solo nivel —el que NO vale— sí dejaría pasar el nombre falso', () => {
    // La prueba de que la trampa es real y no una precaución imaginaria.
    const linea = "'a zero series sits on the baseline' (polylinePoints([0, 0], 1) es '0.0,199.0 600.0,199.0')"
    const unNivel = linea.replace(/\([^()]*\)/g, '')
    expect(unNivel).toContain('0.0,199.0 600.0,199.0')
    expect(stripParenthesised(linea)).not.toContain('0.0,199.0 600.0,199.0')
  })

  it('lo que va entre backticks sin comillas simples son identificadores, no tests', () => {
    // La tarea 2 menciona `window=all` y la 6 menciona `pulse-previous`.
    expect(taskOf(REAL, 2).testsAdded).not.toContain('window=all')
    expect(taskOf(REAL, 6).testsAdded).not.toContain('pulse-previous')
    expect(taskOf(REAL, 2).testsAdded).toEqual([
      'lists the clones',
      'asks the summary for the window it is given',
      'surfaces the code of the error envelope',
      'a body that is not the envelope is internal',
    ])
  })

  it('junta la línea de **Tests:** cuando ocupa varias líneas', () => {
    expect(taskOf(REAL, 3).testsAdded).toHaveLength(5)
    expect(taskOf(REAL, 3).testsAdded).toContain('a day ago reads hace 1 día')
  })

  it('"N/A — <razón>" es una declaración legítima: ni añade ni retira', () => {
    for (const n of [4, 8]) {
      expect(taskOf(REAL, n).testsAdded).toEqual([])
      expect(taskOf(REAL, n).testsRemoved).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// TRAMPA 3 — el marcador de retirada tiene tres formas
// ---------------------------------------------------------------------------
describe('los tests que la tarea retira a propósito', () => {
  it('parte por "retira a propósito" (la forma del plan real)', () => {
    const t1 = taskOf(REAL, 1)
    expect(t1.testsAdded).toEqual(['renders the app title in a DOM'])
    expect(t1.testsRemoved).toEqual(['App exporta un componente de React'])
  })

  it('parte por "removed on purpose:" (la forma de la plantilla, en inglés)', () => {
    const plan = [
      '### Task 1 — dos formas',
      "**Tests:** added `'el que entra'`; removed on purpose: `'el que sale'`",
      '**Verification:**',
      F + 'bash',
      'npm test',
      F,
    ].join('\n')
    const t = extractTasks(plan).tasks[0]
    expect(t.testsAdded).toEqual(['el que entra'])
    expect(t.testsRemoved).toEqual(['el que sale'])
  })

  it('parte por "retira" a secas', () => {
    const plan = [
      '### Task 1 — forma corta',
      "**Tests:** añade `'el que entra'`; retira `'el que sale'`",
      '**Verification:**',
      F + 'bash',
      'npm test',
      F,
    ].join('\n')
    const t = extractTasks(plan).tasks[0]
    expect(t.testsAdded).toEqual(['el que entra'])
    expect(t.testsRemoved).toEqual(['el que sale'])
  })

  it('sin marcador de retirada, todos los nombres son añadidos', () => {
    expect(taskOf(REAL, 2).testsRemoved).toEqual([])
  })

  it('un test que una tarea retira puede haberlo añadido otra anterior', () => {
    // La tarea 5 del plan real retira el test que añadió la 1. Si el marcador
    // no partiera, ese nombre entraría en la lista de los que DEBEN existir
    // después de la tarea 5: exactamente lo contrario de lo correcto.
    expect(taskOf(REAL, 1).testsAdded).toContain('renders the app title in a DOM')
    expect(taskOf(REAL, 5).testsRemoved).toContain('renders the app title in a DOM')
    expect(taskOf(REAL, 5).testsAdded).not.toContain('renders the app title in a DOM')
  })
})

// ---------------------------------------------------------------------------
// LAS RUTAS QUE EL PLAN DECLARA — **Files:**
// ---------------------------------------------------------------------------
describe('las rutas que la tarea declara en **Files:**', () => {
  it('lee las rutas de **Files:** con su acción', () => {
    // La tarea 1 del plan ejecutable:
    //   **Files:** `web/package.json` (modify), `web/vite.config.ts` (modify),
    //   `web/src/testing/setup.ts` (create), `web/src/App.test.tsx` (modify)
    expect(taskOf(EJECUTABLE, 1).files).toEqual([
      { path: 'web/package.json', action: 'modify' },
      { path: 'web/vite.config.ts', action: 'modify' },
      { path: 'web/src/testing/setup.ts', action: 'create' },
      { path: 'web/src/App.test.tsx', action: 'modify' },
    ])
  })

  it('una ruta sin acción declarada la deja en null', () => {
    const plan = [
      '### Task 1 — sin acción',
      '**Files:** `web/src/App.test.tsx`',
      '**Tests:** N/A — nada.',
      '**Verification:**',
      F + 'bash',
      'npm test',
      F,
    ].join('\n')
    const t = extractTasks(plan).tasks[0]
    expect(t.files).toEqual([{ path: 'web/src/App.test.tsx', action: null }])
  })
})

// ---------------------------------------------------------------------------
// EL NOMBRE DE TEST QUE DECLARA **TDD:**
// ---------------------------------------------------------------------------
describe('el nombre del test que declara **TDD:**', () => {
  it('lee el nombre del test que declara **TDD:**', () => {
    // La tarea 1 del plan ejecutable: **TDD:** `test('renders the app title in a DOM')` — ...
    expect(taskOf(EJECUTABLE, 1).tddName).toBe('renders the app title in a DOM')
  })

  it('un No TDD no declara ningún test', () => {
    // La tarea 4 dice "No TDD — son los tokens de marca..." y la 8 "No TDD — es documentación...".
    expect(taskOf(EJECUTABLE, 4).tddName).toBeNull()
    expect(taskOf(EJECUTABLE, 8).tddName).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// LAS ETIQUETAS DE ROL DE LOS BLOQUES — Current state / Contract / Call site / Final text
// ---------------------------------------------------------------------------
describe('las etiquetas de rol de los bloques de la tarea', () => {
  it('lee los ficheros que nombra cada etiqueta de rol', () => {
    expect(taskOf(EJECUTABLE, 5).blockPaths).toEqual([
      { role: 'Current state', path: 'web/src/App.tsx' },
      { role: 'Contract', path: 'web/src/Header.tsx' },
    ])
    expect(taskOf(EJECUTABLE, 4).blockPaths).toEqual([
      { role: 'Contract', path: 'web/src/tokens.css' },
      { role: 'Call site', path: 'web/src/main.tsx' },
    ])
    expect(taskOf(EJECUTABLE, 8).blockPaths).toEqual([
      { role: 'Current state', path: 'AGENTS.md' },
      { role: 'Final text', path: 'AGENTS.md' },
    ])
  })

  it('lee el texto literal de un bloque Final text', () => {
    const plan = [
      '### Task 1 — reescribe una nota',
      '**Files:** `docs/nota.md` (modify)',
      'Final text (docs/nota.md):',
      '',
      F + 'md',
      'primera línea',
      'segunda línea',
      F,
      '**TDD:** No TDD — es documentación.',
      '**Tests:** N/A — no hay código nuevo.',
      '**Verification:**',
      F + 'bash',
      'npm test',
      F,
    ].join('\n')
    const t = extractTasks(plan).tasks[0]
    expect(t.finalTexts).toEqual([{ path: 'docs/nota.md', text: 'primera línea\nsegunda línea' }])
  })
})
