import { describe, it, expect } from 'vitest'
import { buildIssueTitle, buildLabels, buildIssueBody, groomPlan } from '../scripts/groom.js'

const SLICE = { n: 2, issue: null, type: 'backend', entrega: 'refresh flow', deps: [1], ac: ['AC-2.1'], protected: 'schema §6' }

describe('groom puro', () => {
  it('title lleva orden + entrega', () => {
    expect(buildIssueTitle(SLICE)).toBe('#2 refresh flow')
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
