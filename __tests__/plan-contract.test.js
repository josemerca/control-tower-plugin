// El contrato del plan prescriptivo (scripts/plan-contract.js), testeado como
// lo que es: un módulo puro. El filesystem entra por inyección (`readFile`),
// así que la literalidad se prueba sin tocar disco.
import { describe, it, expect } from 'vitest'
import { validatePlan, checkPlans, planFilesForIssue } from '../scripts/plan-contract.js'

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
  '**Verification:** npm test',
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

  it('"Current state: does not exist." no comprueba nada', () => {
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
})
