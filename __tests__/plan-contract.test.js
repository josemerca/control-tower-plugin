// El contrato del plan prescriptivo (scripts/plan-contract.js), testeado como
// lo que es: un módulo puro. El filesystem entra por inyección (`readFile`),
// así que la literalidad se prueba sin tocar disco.
import { describe, it, expect } from 'vitest'
import {
  validatePlan, checkPlans, planFilesForIssue, ROLE_BUDGETS, COMMAND_BUDGET, CODE_BUDGETS,
} from '../scripts/plan-contract.js'

// Tres backticks construidos en runtime: ninguna línea de ESTE fichero puede
// empezar por un fence real, o cualquier herramienta que embeba este fichero
// dentro de un bloque de código lo rompería (ver el plan de la ronda).
const F = '```'

const REAL_FILE = 'export function sum(a, b) {\n  return a + b\n}\n'

const VALID_PLAN = [
  '# #7 — sum() devuelve la suma',
  '',
  '> **This plan is written to be executed by task-scoped subagents with zero context.**',
  '',
  '## 1. Context and goal',
  'sum() existe y hay que cubrirla.',
  '### Desired end state',
  'sum() con test.',
  '### Out of scope',
  'N/A — nada que excluir.',
  '## 2. Closed decisions',
  '| Decision | Value |',
  '|---|---|',
  '| test runner | vitest |',
  '## 3. Reference patterns',
  'src/math.js',
  '## 4. Inventory',
  'src/math.js (modificar), tests/math.test.js (crear).',
  '## 5. Interfaces',
  'Consumes: nothing. Produces: sum(a, b) -> number.',
  '## 6. Test strategy',
  'Unit con vitest.',
  '## 7. Tasks',
  '### Task 1 — cover sum',
  '**Objective:** sum queda cubierta.',
  '**Files:** tests/math.test.js',
  'Current state (src/math.js):',
  F,
  'export function sum(a, b) {',
  '  return a + b',
  '}',
  F,
  '**TDD:** red first: expect(sum(2, 2)).toBe(4)',
  '**Tests:** add tests/math.test.js',
  '**Verification:** npm test, en verde.',
  F + 'bash',
  'npm test',
  F,
  '## 8. Global verification',
  'npm test en verde.',
  '## 9. Assumptions',
  'Ninguna.',
  '',
].join('\n')

const readFile = (path) => {
  if (path === 'src/math.js') return REAL_FILE
  throw new Error(`ENOENT: ${path}`)
}

// ============================================================================
// F-jjponz-4 — fixtures de la taxonomía de bloques.
//
// El plan del slice #2 de repo-pulse midió 73.868 caracteres con 1.271 líneas
// de código (65% del plan): cuerpos de módulo y ficheros de test completos.
// De sus 14 commits, 5 arreglaban defectos que venían pegados en el plan. A
// ese tamaño el gate humano `plan` no revisa, hojea. Desde esta ronda cada
// bloque declara su ROL y cada rol tiene presupuesto.
// ============================================================================

const CABECERA = (titulo) => [
  `# ${titulo}`,
  '',
  '> **This plan is written to be executed by task-scoped subagents with zero context.**',
  '',
  '## 1. Context and goal',
  'Hay que exponer sum() por el barrel.',
  '### Desired end state',
  'El barrel exporta sum().',
  '### Out of scope',
  'N/A — nada que excluir.',
  '## 2. Closed decisions',
  '| Decision | Value |',
  '|---|---|',
  '| test runner | vitest |',
  '## 3. Reference patterns',
  'src/math.js',
  '## 4. Inventory',
  '| File | Action | Block |',
  '|---|---|---|',
  '| src/index.js | create | Contract |',
  '## 5. Interfaces',
  'Consumes: N/A. Produces: sum(a, b) -> number desde src/index.js.',
  '## 6. Test strategy',
  'Unit con vitest.',
]

const COLA = [
  '## 8. Global verification',
  'npm test en verde.',
  '## 9. Assumptions',
  'Ninguna.',
  '',
]

const bloque = ([etiqueta, cuerpo, lang = '']) => [etiqueta, F + lang, ...cuerpo, F]

// Construye un plan válido con una tarea por elemento de `tareas`. Cada tarea
// es una lista de bloques [etiqueta, cuerpo, lang?]; una tarea sin ningún
// bloque con rol declara el escape `No code — <razón>`.
const planConTareas = (tareas, { antesDeLasTareas = [] } = {}) => [
  ...CABECERA('#9 — el análisis expone su contrato'),
  ...antesDeLasTareas.flatMap(bloque),
  '## 7. Tasks',
  ...tareas.flatMap((bloques, i) => [
    `### Task ${i + 1} — hacer el trabajo ${i + 1}`,
    `**Objective:** el trabajo ${i + 1} queda hecho.`,
    '**Files:** src/index.js',
    ...bloques.flatMap(bloque),
    ...(bloques.length ? [] : ['No code — la configuración se describe en prosa con el valor inline.']),
    '**TDD:** No TDD — fixture.',
    '**Tests:** N/A — fixture.',
    '**Verification:** npm test',
    F + 'bash',
    'npm test',
    F,
  ]),
  ...COLA,
].join('\n')

const lineasDe = (n) => Array.from({ length: n }, (_, i) => `export const c${i} = ${i}`)

const CITA_REAL = ['Current state (src/math.js):', ['export function sum(a, b) {', '  return a + b', '}']]
const CONTRATO = ['Contract (src/index.js):', ["export { sum } from './math.js'"], 'js']
const CALL_SITE = ['Call site (src/app.js):', ["import { sum } from './index.js'"], 'js']
const TEXTO = ['Final text (README.md):', ['## Uso', 'Importa `sum` desde `src/index.js`.']]

const PLAN_CON_ROLES = planConTareas([[CITA_REAL, CONTRATO, CALL_SITE, TEXTO], []])

describe('validatePlan — el plan válido de referencia', () => {
  it('pasa entero, literalidad incluida', () => {
    const r = validatePlan(VALID_PLAN, { readFile })
    expect(r.violations).toEqual([])
    expect(r.ok).toBe(true)
  })
})

describe('validatePlan — estructura', () => {
  it('detecta una sección canónica ausente', () => {
    const r = validatePlan(VALID_PLAN.replace('## 5. Interfaces', '## 5. Iface'), { readFile })
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.rule === 'sections' && v.detail.includes('## 5. Interfaces'))).toBe(true)
  })

  it('detecta la tabla de decisiones vacía', () => {
    const sinFila = VALID_PLAN.replace('| test runner | vitest |\n', '')
    const r = validatePlan(sinFila, { readFile })
    expect(r.violations.some((v) => v.rule === 'decisions')).toBe(true)
  })

  it('detecta un marcador de task ausente', () => {
    const r = validatePlan(VALID_PLAN.replace('**TDD:** red first: expect(sum(2, 2)).toBe(4)\n', ''), { readFile })
    expect(r.violations.some((v) => v.rule === 'tasks' && v.detail.includes('**TDD:**'))).toBe(true)
  })

  it('detecta numeración de tasks no consecutiva', () => {
    const r = validatePlan(VALID_PLAN.replace('### Task 1 — cover sum', '### Task 2 — cover sum'), { readFile })
    expect(r.violations.some((v) => v.rule === 'tasks' && v.detail.includes('no consecutiva'))).toBe(true)
  })
})

describe('validatePlan — placeholders', () => {
  it('un TBD fuera de fence es violación; dentro de un fence, no', () => {
    const fuera = validatePlan(VALID_PLAN.replace('Unit con vitest.', 'Unit con vitest. TBD'), { readFile })
    expect(fuera.violations.some((v) => v.rule === 'placeholders')).toBe(true)

    const dentro = VALID_PLAN.replace('  return a + b', '  return a + b // TBD')
    const real = REAL_FILE.replace('  return a + b', '  return a + b // TBD')
    const r = validatePlan(dentro, { readFile: () => real })
    expect(r.violations.filter((v) => v.rule === 'placeholders')).toEqual([])
  })
})

describe('validatePlan — literalidad', () => {
  it('una cita que no existe verbatim en el fichero es violación', () => {
    const r = validatePlan(VALID_PLAN.replace('  return a + b', '  return a - b'), { readFile })
    expect(r.violations.some((v) => v.rule === 'literality' && v.detail.includes('src/math.js'))).toBe(true)
  })

  // F-jjponz-4: "Current state: does not exist." + contenido final era el
  // idiom que producía los volcados. Sigue sin comprobar literalidad (no casa
  // la regex), pero ahora la valla que le sigue no tiene rol y eso ES
  // violación — el caso vive completo en el describe de la taxonomía.
  it('una etiqueta que no casa la convención no comprueba literalidad', () => {
    const nuevo = VALID_PLAN.replace(
      ['Current state (src/math.js):', F, 'export function sum(a, b) {', '  return a + b', '}', F].join('\n'),
      ['Current state: does not exist.', F, 'nuevo contenido', F].join('\n'),
    )
    const r = validatePlan(nuevo, { readFile })
    expect(r.violations.filter((v) => v.rule === 'literality')).toEqual([])
  })

  it('sin readFile inyectado, la literalidad no se afirma ni se niega', () => {
    const r = validatePlan(VALID_PLAN.replace('  return a + b', '  return a - b'), {})
    expect(r.violations.filter((v) => v.rule === 'literality')).toEqual([])
  })
})

describe('planFilesForIssue — la convención issue-<n>-', () => {
  it('casa el issue exacto y no un prefijo', () => {
    const paths = [
      'docs/superpowers/plans/2026-08-12-issue-1-foo.md',
      'docs/superpowers/plans/2026-08-12-issue-12-bar.md',
      'docs/otro/2026-08-12-issue-1-x.md',
    ]
    expect(planFilesForIssue(1, paths)).toEqual(['docs/superpowers/plans/2026-08-12-issue-1-foo.md'])
    expect(planFilesForIssue(12, paths)).toEqual(['docs/superpowers/plans/2026-08-12-issue-12-bar.md'])
  })
})

describe('checkPlans — la decisión del gate', () => {
  const PLAN_PATH = 'docs/superpowers/plans/2026-08-12-issue-7-sum.md'
  const fsOf = (content) => (path) => {
    if (path === PLAN_PATH) return content
    if (path === 'src/math.js') return REAL_FILE
    throw new Error(`ENOENT: ${path}`)
  }

  it('sin candidato: code 6 con remedio', () => {
    const r = checkPlans({ issue: 7, candidates: ['src/app.js'], readFile: fsOf(VALID_PLAN) })
    expect(r.code).toBe(6)
    expect(r.message).toContain('writing-plans-prescriptive')
  })

  it('candidato válido: code 0', () => {
    const r = checkPlans({ issue: 7, candidates: [PLAN_PATH], readFile: fsOf(VALID_PLAN) })
    expect(r).toMatchObject({ ok: true, code: 0 })
  })

  it('candidato inválido: code 6 con las violaciones en el mensaje', () => {
    const roto = VALID_PLAN.replace('## 9. Assumptions', '## 9. Assumption')
    const r = checkPlans({ issue: 7, candidates: [PLAN_PATH], readFile: fsOf(roto) })
    expect(r.code).toBe(6)
    expect(r.message).toContain('## 9. Assumptions')
  })

  // F-jjponz-3 — el plan y los ficheros que cita NO se leen en la misma foto:
  // el plan lo introduce la rama (solo existe donde está ahora) y las citas se
  // comprueban contra la base, donde el slice todavía no había tocado nada.
  it('lee el PLAN con readFile y las CITAS con readCitedFile', () => {
    const soloElPlan = (path) => {
      if (path === PLAN_PATH) return VALID_PLAN
      throw new Error(`el plan no está en la base: ${path}`)
    }
    const soloLoCitado = (path) => {
      if (path === 'src/math.js') return REAL_FILE
      throw new Error(`ENOENT: ${path}`)
    }
    expect(checkPlans({
      issue: 7, candidates: [PLAN_PATH], readFile: soloElPlan, readCitedFile: soloLoCitado,
    })).toMatchObject({ ok: true, code: 0 })
  })

  it('sin readCitedFile, las citas se leen con readFile — el modo --check-plan no cambia', () => {
    const r = checkPlans({ issue: 7, candidates: [PLAN_PATH], readFile: fsOf(VALID_PLAN) })
    expect(r).toMatchObject({ ok: true, code: 0 })
  })

  it('una cita que el lector de citas no encuentra es violación con el motivo de ESE lector', () => {
    const r = checkPlans({
      issue: 7,
      candidates: [PLAN_PATH],
      readFile: fsOf(VALID_PLAN),
      readCitedFile: () => { throw new Error('no existe en la base de la rama (abc123def456)') },
    })
    expect(r.code).toBe(6)
    expect(r.message).toContain('src/math.js')
    expect(r.message).toContain('no existe en la base de la rama')
  })

  it('un volcado sin etiqueta de rol sale con code 6 y el mensaje trae el remedio (F-jjponz-4)', () => {
    const volcado = PLAN_CON_ROLES.replace('Contract (src/index.js):', 'Final content:')
    const r = checkPlans({ issue: 7, candidates: [PLAN_PATH], readFile: fsOf(volcado) })
    expect(r.code).toBe(6)
    expect(r.message).toContain('Contract (path):')
  })
})

// ============================================================================
// F-jjponz-4 — la taxonomía de bloques
// ============================================================================

const violacionesDe = (plan, regla) =>
  validatePlan(plan, { readFile }).violations.filter((v) => v.rule === regla)

describe('validatePlan — taxonomía de bloques', () => {
  it('el plan con los cuatro roles pasa entero', () => {
    expect(validatePlan(PLAN_CON_ROLES, { readFile })).toMatchObject({ ok: true, violations: [] })
  })

  it('un bloque sin etiqueta de rol es violación, y el mensaje enumera los cuatro roles', () => {
    const roto = PLAN_CON_ROLES.replace('Contract (src/index.js):', 'Así queda el fichero:')
    const [v] = violacionesDe(roto, 'roles')
    expect(v.detail).toContain('Así queda el fichero:')
    for (const rol of ['Current state (path):', 'Contract (path):', 'Call site (path):', 'Final text (path.md):']) {
      expect(v.detail).toContain(rol)
    }
  })

  it('"Final content:" — la etiqueta que producía los volcados — ya no vale', () => {
    const roto = PLAN_CON_ROLES.replace('Contract (src/index.js):', 'Final content:')
    expect(violacionesDe(roto, 'roles')[0].detail).toContain('Final content:')
  })

  it('"Current state: does not exist." seguido de valla es violación: el idiom del volcado está muerto', () => {
    const roto = PLAN_CON_ROLES.replace('Contract (src/index.js):', 'Current state: does not exist.')
    expect(violacionesDe(roto, 'roles')).toHaveLength(1)
  })

  it('un Contract NO se comprueba verbatim: el fichero todavía no existe', () => {
    // `readFile` lanza ENOENT para todo lo que no sea src/math.js, y el
    // contrato apunta a src/index.js, que este plan crea.
    expect(violacionesDe(PLAN_CON_ROLES, 'literality')).toEqual([])
  })

  it('"Final text" vale sobre un fichero de texto y no sobre código', () => {
    expect(violacionesDe(PLAN_CON_ROLES, 'roles')).toEqual([])
    const roto = planConTareas([[['Final text (src/index.js):', ["export const x = 1"]]]])
    const [v] = violacionesDe(roto, 'roles')
    expect(v.detail).toContain('.md')
  })

  it('un bloque de comandos no necesita etiqueta: lo delata su lenguaje', () => {
    const plan = planConTareas([[CONTRATO, ['Y se comprueba así:', ['npm run build'], 'bash']]])
    expect(violacionesDe(plan, 'roles')).toEqual([])
  })

  it('un heredoc en un bloque de comandos es un fichero colado por la puerta de atrás', () => {
    const plan = planConTareas([[CONTRATO, ['Y se siembra así:', ['cat > f.txt <<EOF', 'hola', 'EOF'], 'bash']]])
    expect(violacionesDe(plan, 'commands')).toHaveLength(1)
  })

  it('un bloque con rol fuera de una tarea es violación y nombra el task brief', () => {
    const plan = planConTareas([[CITA_REAL]], { antesDeLasTareas: [CONTRATO] })
    const [v] = violacionesDe(plan, 'roles')
    expect(v.detail).toContain('task brief')
  })

  it('dos bloques Contract del mismo fichero en la misma tarea es violación', () => {
    const plan = planConTareas([[CONTRATO, CONTRATO]])
    expect(violacionesDe(plan, 'roles')).toHaveLength(1)
  })

  it('dos tareas distintas pueden llevar Contract del mismo fichero: una lo crea, otra lo extiende', () => {
    expect(violacionesDe(planConTareas([[CONTRATO], [CONTRATO]]), 'roles')).toEqual([])
  })
})

describe('validatePlan — presupuesto por rol', () => {
  const rutaDe = { 'Current state': 'src/math.js', Contract: 'src/index.js', 'Call site': 'src/app.js', 'Final text': 'README.md' }

  it.each(Object.entries(ROLE_BUDGETS))('un bloque %s de presupuesto+1 líneas es violación', (rol, budget) => {
    const plan = planConTareas([[[`${rol} (${rutaDe[rol]}):`, lineasDe(budget + 1)]]])
    const [v] = violacionesDe(plan, 'budget')
    expect(v.detail).toContain(String(budget))
  })

  it('un Contract justo en su presupuesto pasa: el del ejemplo real son ~10 líneas', () => {
    const plan = planConTareas([[['Contract (src/index.js):', lineasDe(ROLE_BUDGETS.Contract)]]])
    expect(violacionesDe(plan, 'budget')).toEqual([])
  })

  it('una tarea que acumula más del presupuesto de tarea es violación y dice que un commit son dos', () => {
    const mitad = Math.ceil(CODE_BUDGETS.task / 2) + 1
    const plan = planConTareas([[
      ['Contract (src/index.js):', lineasDe(Math.min(mitad, ROLE_BUDGETS.Contract))],
      ['Contract (src/otro.js):', lineasDe(Math.min(mitad, ROLE_BUDGETS.Contract))],
    ]])
    const [v] = violacionesDe(plan, 'budget')
    expect(v.detail).toContain('commit')
  })

  // F-jjponz-5: NO hay presupuesto de plan. Un tope global obligaba al agente
  // a limar caracteres —14 de las 24 corridas de --check-plan del slice #3
  // fallaron por `size`— y su única salida real (partir el slice) no la puede
  // accionar: viene despachado para un issue congelado. Lo que sí puede partir
  // es una tarea, así que el techo va por tarea.
  it('seis tareas, cada una dentro de SU presupuesto, no acumulan violación de plan', () => {
    const tareas = Array.from({ length: 6 }, () => [['Contract (src/index.js):', lineasDe(ROLE_BUDGETS.Contract)]])
    expect(violacionesDe(planConTareas(tareas), 'budget')).toEqual([])
  })

  it('los bloques de comandos no cuentan para el acumulado', () => {
    const comandos = Array.from({ length: 40 }, (_, i) => [`Se comprueba (${i}):`, ['npm test'], 'bash'])
    expect(violacionesDe(planConTareas([[CONTRATO, ...comandos]]), 'budget')).toEqual([])
  })

  it('un bloque de comandos más largo que su presupuesto es violación', () => {
    const plan = planConTareas([[CONTRATO, ['Se comprueba así:', lineasDe(COMMAND_BUDGET + 1), 'bash']]])
    expect(violacionesDe(plan, 'commands')).toHaveLength(1)
  })
})

describe('validatePlan — las configuraciones no llevan bloque', () => {
  it.each([
    'package.json', 'server/tsconfig.json', '.github/workflows/ci.yml',
    'pnpm-lock.yaml', '.gitignore', 'Dockerfile',
  ])('un bloque sobre %s es violación y el remedio es prosa con el valor inline', (path) => {
    const plan = planConTareas([[[`Contract (${path}):`, ['{ "a": 1 }']]]])
    const [v] = violacionesDe(plan, 'config')
    expect(v.detail).toContain('prosa')
  })

  it('un fichero de código con nombre de config (vite.config.ts) NO es configuración', () => {
    const plan = planConTareas([[['Contract (vite.config.ts):', ['export default {}']]]])
    expect(violacionesDe(plan, 'config')).toEqual([])
  })
})

describe('validatePlan — los ficheros de test no llevan bloque de estado final', () => {
  it.each(['src/git.test.ts', 'src/git.spec.js', '__tests__/plan-contract.test.js'])(
    'Contract sobre %s es violación y remite a TDD/Tests',
    (path) => {
      const plan = planConTareas([[[`Contract (${path}):`, ['it("x", () => {})']]]])
      const [v] = violacionesDe(plan, 'tests')
      expect(v.detail).toContain('**TDD:**')
    },
  )

  it('Current state sobre un fichero de test SÍ vale: endurecer una aserción exige citar la de hoy', () => {
    const citaDeTest = ['Current state (src/math.test.js, lines 1-2):', ['expect(sum(2, 2)).toBe(4)']]
    const plan = planConTareas([[citaDeTest]])
    const readFileConTest = (p) => {
      if (p === 'src/math.test.js') return 'expect(sum(2, 2)).toBe(4)\n'
      throw new Error(`ENOENT: ${p}`)
    }
    const r = validatePlan(plan, { readFile: readFileConTest })
    expect(r.violations.filter((v) => v.rule === 'tests')).toEqual([])
    expect(r.violations.filter((v) => v.rule === 'literality')).toEqual([])
  })
})

describe('validatePlan — "al menos un bloque con rol" por tarea', () => {
  it('una tarea cuyo único bloque es la verificación en bash es violación', () => {
    const plan = planConTareas([[CONTRATO], []]).replace(
      'No code — la configuración se describe en prosa con el valor inline.', 'Aquí no hay nada.',
    )
    const [v] = violacionesDe(plan, 'tasks')
    expect(v.detail).toContain('No code — ')
  })

  it('…salvo que declare la línea exacta "No code — <razón>"', () => {
    expect(violacionesDe(planConTareas([[CONTRATO], []]), 'tasks')).toEqual([])
  })
})

describe('validatePlan — cada TAREA cabe en un folio A4', () => {
  const tareaGorda = (n) => [
    ['Contract (src/index.js):', ['export const x = 1']],
    ...Array.from({ length: n }, (_, i) => [`Se comprueba (${i}):`, [`npm test -- caso-${i}`], 'bash']),
  ]

  it(`una tarea de más de ${CODE_BUDGETS.chars} caracteres es violación, la nombra, dice cuántos folios ocupa y que la tarea son dos`, () => {
    const relleno = Array.from({ length: 100 }, (_, i) => `Detalle cerrado número ${i} de esta tarea.`)
    const plan = planConTareas([[CONTRATO]]).replace(
      '**TDD:** No TDD — fixture.', `${relleno.join('\n')}\n**TDD:** No TDD — fixture.`,
    )
    const [v] = violacionesDe(plan, 'size')
    expect(v.detail).toMatch(/Task 1/)
    expect(v.detail).toMatch(/folio/)
    expect(v.detail).toMatch(/la tarea son dos/)
  })

  it('el presupuesto es POR TAREA: dos tareas grandes pero cada una dentro del folio pasan', () => {
    const plan = planConTareas([tareaGorda(45), tareaGorda(45)])
    expect(plan.length).toBeGreaterThan(CODE_BUDGETS.chars)
    expect(violacionesDe(plan, 'size')).toEqual([])
  })

  it('el plan de referencia no dispara nada de tamaño', () => {
    expect(violacionesDe(PLAN_CON_ROLES, 'size')).toEqual([])
  })
})

// ===========================================================================
// D-4 — la vara de la tarea tiene que ser EJECUTABLE.
//
// El contrato ya exigía que **Verification:** estuviera. Lo que no exigía es
// que dijera algo que se pueda correr, y esa diferencia es la que decide si el
// plan lo puede ejecutar un programa o hace falta un humano interpretando
// prosa. La fixture del caso real vive en plan-tasks.test.js; aquí se fija el
// borde del contrato.
// ===========================================================================
describe('los comandos de **Verification:** van en un bloque, no en la frase', () => {
  const planCon = (verificacion) => [
    '# #7 — sum() devuelve la suma',
    '',
    '> **This plan is written to be executed by task-scoped subagents with zero context.**',
    '',
    '## 1. Context and goal',
    'sum() existe y hay que cubrirla.',
    '### Desired end state',
    'sum() con test.',
    '### Out of scope',
    'N/A — nada que excluir.',
    '## 2. Closed decisions',
    '| Decision | Value |',
    '|---|---|',
    '| test runner | vitest |',
    '## 3. Reference patterns',
    'src/math.js',
    '## 4. Inventory',
    'tests/math.test.js (crear).',
    '## 5. Interfaces',
    'Consumes: nothing. Produces: sum(a, b) -> number.',
    '## 6. Test strategy',
    'Unit con vitest.',
    '## 7. Tasks',
    '### Task 1 — cover sum',
    '**Objective:** sum queda cubierta.',
    '**Files:** tests/math.test.js',
    'No code — el test se describe por nombre y aserción.',
    '**TDD:** red first: expect(sum(2, 2)).toBe(4)',
    '**Tests:** add tests/math.test.js',
    ...verificacion,
    '## 8. Global verification',
    'npm test en verde.',
    '## 9. Assumptions',
    'Ninguna.',
    '',
  ].join('\n')

  const rulesOf = (plan) => validatePlan(plan, { readFile: () => null })
    .violations.filter((v) => v.rule === 'verification')

  it('una tarea que verifica con prosa en línea NO pasa el contrato', () => {
    // Ésta es exactamente la forma del plan real del slice #5 de repo-pulse, y
    // la que pedía la plantilla hasta esta ronda.
    const plan = planCon(['**Verification:** `npm test` → exit 0. `npm run lint` → exit 0.'])
    expect(rulesOf(plan)).toHaveLength(1)
    expect(rulesOf(plan)[0].detail).toMatch(/no ejecuta prosa/)
  })

  it('la misma tarea con los comandos en bloque sí pasa', () => {
    expect(rulesOf(planCon([
      '**Verification:** los dos en verde.',
      F + 'bash',
      'npm test   # exit 0',
      'npm run lint   # exit 0',
      F,
    ]))).toEqual([])
  })

  // Paso 2 del spec de la primera corrida en un repo ajeno: el bloque puede
  // estar y sus comandos medir al revés. `--check-plan` es la puerta que dejó
  // pasar el control invertido de jjponz/rust-monitoring#10, así que la regla
  // tiene que llegar HASTA AQUÍ y no quedarse en el extractor.
  it('el control invertido de rust-monitoring, con su bloque y todo, NO pasa el contrato', () => {
    const plan = planCon([
      '**Verification:** la sección protegida no se toca.',
      F + 'bash',
      "git diff HEAD -- AGENTS.md | grep -c 'ct-init:slices-contract'   # expected: 0",
      F,
    ])
    expect(rulesOf(plan)).toHaveLength(1)
    expect(rulesOf(plan)[0].detail).toMatch(/no puede afirmar lo que el control dice medir/)
  })

  it('el mismo control escrito como predicado sí pasa', () => {
    expect(rulesOf(planCon([
      '**Verification:** la sección protegida no se toca.',
      F + 'bash',
      'test "$(git diff HEAD -- AGENTS.md | grep -c \'ct-init:slices-contract\')" -eq 0',
      F,
    ]))).toEqual([])
  })

  it('acepta el bloque aunque el párrafo de **Verification:** lleve prosa delante', () => {
    expect(rulesOf(planCon([
      '**Verification:** primero `npm install`, y después:',
      F + 'bash',
      'npm test   # exit 0',
      F,
    ]))).toEqual([])
  })

  it('el bloque de Current state de la tarea NO cuenta como bloque de comandos', () => {
    // Sin la regla de "el bloque INMEDIATAMENTE posterior", un plan con
    // cualquier cercado suelto en la tarea pasaría dando por verificada una
    // tarea cuya vara sigue siendo prosa.
    const plan = planCon([
      '**Verification:** `npm test` → exit 0.',
      '',
      'Current state (src/math.js):',
      F,
      'export function sum(a, b) {',
      '}',
      F,
    ])
    expect(rulesOf(plan)).toHaveLength(1)
  })

  it('un plan con varias tareas nombra cuáles fallan, no cuántas', () => {
    const plan = planCon(['**Verification:** `npm test` → exit 0.'])
      .replace('## 8. Global verification', [
        '### Task 2 — otra',
        '**Objective:** otra cosa.',
        '**Files:** tests/otra.test.js',
        'No code — descrito en prosa.',
        '**TDD:** No TDD — fixture.',
        '**Tests:** N/A — fixture.',
        '**Verification:** `npm test` otra vez, en prosa.',
        '## 8. Global verification',
      ].join('\n'))
    expect(rulesOf(plan).map((v) => v.detail.match(/tarea (\d+)/)[1])).toEqual(['1', '2'])
  })
})
