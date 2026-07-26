import { describe, it, expect } from 'vitest'
import { buildIssueTitle, buildLabels, buildIssueBody, groomPlan } from '../scripts/groom.js'

// F3: el título del issue viene de `slice.name` (columna "Slice" del spec),
// no de `slice.entrega` (columna "Entrega") — buildIssueTitle componía
// "#N <Entrega>" mientras "Slice" se descartaba salvo por su "#NN", así que
// un autor que escribe lo natural (nombre corto en Slice, descripción en
// Entrega) recibía un párrafo como título. `entrega` ahora es una
// descripción OPCIONAL que renderiza en el cuerpo (ver más abajo).
const SLICE = { n: 2, issue: null, name: 'refresh token', type: 'backend', entrega: 'flujo de refresco de sesión', deps: [1], ac: ['AC-2.1'], protected: 'schema §6' }

describe('groom puro', () => {
  it('title lleva orden + name (columna Slice), no Entrega', () => {
    expect(buildIssueTitle(SLICE)).toBe('#2 refresh token')
  })
  it('labels: type + status:backlog', () => {
    expect(buildLabels(SLICE)).toEqual(['type:backend', 'status:backlog'])
  })
  it('body: link al spec, AC, deps como merge-after, protected', () => {
    const b = buildIssueBody(SLICE, { specPath: 'docs/spec.md', specSection: '9' })
    expect(b).toContain('docs/spec.md#9')
    expect(b).toContain('AC-2.1')
    expect(b).toContain('merge-after #1')
    expect(b).toContain('schema §6')
  })
  // F3: "Entrega" ya no alimenta el título — se convierte en una sección de
  // descripción dentro del cuerpo (decisión: justo debajo del link al spec y
  // ANTES de "Acceptance criteria", para que quien lea el issue sepa QUÉ
  // entrega el slice antes de leer sus criterios de aceptación).
  it('body: "Entrega" renderiza como sección "## Descripción", antes de "Acceptance criteria"', () => {
    const b = buildIssueBody(SLICE, { specPath: 'docs/spec.md', specSection: '9' })
    expect(b).toContain('## Descripción')
    expect(b).toContain('flujo de refresco de sesión')
    expect(b.indexOf('## Descripción')).toBeLessThan(b.indexOf('## Acceptance criteria'))
  })
  it('body: sin "Entrega" (vacía/undefined) → sin sección "Descripción"', () => {
    const b = buildIssueBody({ ...SLICE, entrega: '' }, { specPath: 'x', specSection: '9' })
    expect(b).not.toContain('## Descripción')
    const b2 = buildIssueBody({ ...SLICE, entrega: undefined }, { specPath: 'x', specSection: '9' })
    expect(b2).not.toContain('## Descripción')
  })
  it.each(['-', '–', '—', '―', '−', '--'])('body: "Entrega" con marcador de "sin valor" ("%s") → sin sección "Descripción", mismo criterio que Protegido', (marker) => {
    const b = buildIssueBody({ ...SLICE, entrega: marker }, { specPath: 'x', specSection: '9' })
    expect(b).not.toContain('## Descripción')
  })
  it('body sin deps → sin merge-after', () => {
    const b = buildIssueBody({ ...SLICE, deps: [] }, { specPath: 'x', specSection: '9' })
    expect(b).not.toContain('merge-after')
  })
  it('groomPlan agrega milestone + issues', () => {
    const plan = groomPlan([SLICE], { milestone: 'Epic X', specPath: 'x', specSection: '9' })
    expect(plan.milestone).toBe('Epic X')
    expect(plan.issues).toHaveLength(1)
    expect(plan.issues[0].labels).toContain('type:backend')
  })
  it('body emite marcador ct-order exacto', () => {
    const b = buildIssueBody(SLICE, { specPath: 'x', specSection: '9' })
    expect(b).toContain('<!-- ct-order:2 -->')
  })
  it('buildIssueBody defensivo: undefined ac + deps', () => {
    const incomplete = { n: 5, type: 'frontend', entrega: 'fix', ac: undefined, deps: undefined, protected: '–' }
    const b = buildIssueBody(incomplete, { specPath: 'x', specSection: '9' })
    expect(b).toContain('(rellenar desde el spec)')
    expect(b).not.toContain('merge-after')
  })
  it('buildLabels con type vacío: solo status:backlog', () => {
    const empty = { n: 1, type: '', entrega: 'x', deps: [], ac: [], protected: '–' }
    expect(buildLabels(empty)).toEqual(['status:backlog'])
  })
  it('buildLabels emite area:/touches: por cada token, en orden tipo→area→touches→status', () => {
    const s = { ...SLICE, area: ['api'], touches: ['db', 'migration'] }
    expect(buildLabels(s)).toEqual(['type:backend', 'area:api', 'touches:db', 'touches:migration', 'status:backlog'])
  })
  it('buildLabels sin area/touches (undefined, spec vieja) produce exactamente la salida de hoy', () => {
    expect(buildLabels(SLICE)).toEqual(['type:backend', 'status:backlog'])
  })
  it('buildLabels con area/touches vacíos ([]) produce exactamente la salida de hoy', () => {
    const s = { ...SLICE, area: [], touches: [] }
    expect(buildLabels(s)).toEqual(['type:backend', 'status:backlog'])
  })
  it('groomPlan rechaza órdenes de slice duplicados, nombrando el/los duplicados', () => {
    const dup1 = { ...SLICE, n: 1 }
    const dup2 = { ...SLICE, n: 1 }
    expect(() => groomPlan([dup1, dup2], { milestone: 'Epic', specPath: 'x', specSection: '9' }))
      .toThrow(/1/)
  })
  it('groomPlan con órdenes únicos sigue funcionando (regresión)', () => {
    const a = { ...SLICE, n: 1 }
    const b = { ...SLICE, n: 2 }
    const plan = groomPlan([a, b], { milestone: 'Epic', specPath: 'x', specSection: '9' })
    expect(plan.issues).toHaveLength(2)
  })
  // Bug de review: buildIssueBody solo trataba el em dash literal ('–',
  // U+2013) como "sin valor" para Protegido — las otras cuatro variantes que
  // isNoValueCell acepta en TODAS las demás columnas (Dep/Acepta/Área/Toca)
  // colaban como si fueran contenido real, produciendo un bullet basura
  // ("- 🚫 -", "- 🚫 —", "- 🚫 −") en el body del issue. Las cinco variantes
  // deben producir "(ninguno declarado)", igual que las demás columnas.
  it.each(['-', '–', '—', '―', '−', '--'])('Protegido "%s" (marcador de "sin valor") → "(ninguno declarado)", no un bullet basura', (marker) => {
    const b = buildIssueBody({ ...SLICE, protected: marker }, { specPath: 'x', specSection: '9' })
    expect(b).toContain('(ninguno declarado)')
    expect(b).not.toMatch(/🚫 .*[-–—―−]\s*$/m)
  })
  it('Protegido con contenido real sigue emitiendo su bullet 🚫', () => {
    const b = buildIssueBody({ ...SLICE, protected: 'schema §6' }, { specPath: 'x', specSection: '9' })
    expect(b).toContain('🚫 schema §6')
  })
  it('groomPlan nombra todos los órdenes duplicados cuando hay más de uno', () => {
    const s1a = { ...SLICE, n: 1 }
    const s1b = { ...SLICE, n: 1 }
    const s2 = { ...SLICE, n: 2 }
    const s3a = { ...SLICE, n: 3 }
    const s3b = { ...SLICE, n: 3 }
    let message = ''
    try {
      groomPlan([s1a, s1b, s2, s3a, s3b], { milestone: 'Epic', specPath: 'x', specSection: '9' })
    } catch (e) {
      message = e.message
    }
    expect(message).toMatch(/1/)
    expect(message).toMatch(/3/)
  })
})
