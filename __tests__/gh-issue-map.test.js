import { describe, it, expect } from 'vitest'
import { extractAc, mapGhIssue, filterMergedIssues } from '../scripts/gh-issue-map.js'
import { buildIssueBody } from '../scripts/groom.js'

describe('mapGhIssue — defensivo con labels/marcadores ausentes', () => {
  it('sin marcador ct-order en el body → order cae a i.number', () => {
    const mapped = mapGhIssue({ number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: 'sin marcador' })
    expect(mapped.order).toBe(42)
    expect(mapped.n).toBe(42)
  })
  it('sin label status: → status cae a "backlog"', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'type:backend' }], body: '' })
    expect(mapped.status).toBe('backlog')
  })
  it('sin labels touches: → touches es []', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:ready' }], body: '' })
    expect(mapped.touches).toEqual([])
  })
  it('sin label type: → type es cadena vacía, no el literal "type:"', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:ready' }], body: '' })
    expect(mapped.type).toBe('')
  })
  it('body vacío/ausente → deps [] y ac []', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body: '' })
    expect(mapped.deps).toEqual([])
    expect(mapped.ac).toEqual([])
    const mapped2 = mapGhIssue({ number: 1, title: '#1 x', labels: [] })
    expect(mapped2.deps).toEqual([])
    expect(mapped2.ac).toEqual([])
  })
  it('con marcador ct-order y merge-after → order/deps correctos', () => {
    const body = 'algo\n<!-- ct-order:7 -->\nmerge-after #3, merge-after #4'
    const mapped = mapGhIssue({ number: 99, title: '#99 x', labels: [], body })
    expect(mapped.order).toBe(7)
    expect(mapped.deps).toEqual([3, 4])
  })
  it('entrega: quita el prefijo "#N " del título', () => {
    const mapped = mapGhIssue({ number: 5, title: '#5 refresh token', labels: [], body: '' })
    expect(mapped.entrega).toBe('refresh token')
  })
  it('issue: siempre "#<number>", nunca undefined', () => {
    const mapped = mapGhIssue({ number: 5, title: '#5 x', labels: [], body: '' })
    expect(mapped.issue).toBe('#5')
  })
})

describe('extractAc', () => {
  it('sin sección "## Acceptance criteria" → []', () => {
    expect(extractAc('cualquier body sin esa sección')).toEqual([])
    expect(extractAc('')).toEqual([])
    expect(extractAc(null)).toEqual([])
  })
  it('con bloque AC → extrae cada línea "- ..."', () => {
    const body = '## Acceptance criteria (EARS, 1:1 con tests)\n- AC-7.1 algo\n- AC-7.2 otro\n\n## Dependencias\n- merge-after #1'
    expect(extractAc(body)).toEqual(['AC-7.1 algo', 'AC-7.2 otro'])
  })
  it('placeholder "(rellenar desde el spec)" no cuenta como AC real', () => {
    const body = '## Acceptance criteria (EARS, 1:1 con tests)\n- (rellenar desde el spec)\n\n## Dependencias'
    expect(extractAc(body)).toEqual([])
  })
  it('bloque AC es la última sección del body (sin encabezado siguiente) → también se extrae', () => {
    const body = '## Acceptance criteria (EARS, 1:1 con tests)\n- AC-1 único'
    expect(extractAc(body)).toEqual(['AC-1 único'])
  })
})

describe('mapGhIssue + groom.js#buildIssueBody — ata las dos piezas (detecta deriva de formato)', () => {
  it('un body generado por el buildIssueBody real de ct-groom se mapea correctamente', () => {
    const slice = { n: 7, entrega: 'refresh token', ac: ['AC-7.1 algo', 'AC-7.2 otro'], deps: [1, 2], protected: '–' }
    const body = buildIssueBody(slice, { specPath: 'spec.md', specSection: '9' })
    const mapped = mapGhIssue({ number: 55, title: '#55 refresh token', labels: [{ name: 'status:ready' }, { name: 'type:backend' }], body })
    expect(mapped.order).toBe(7) // <!-- ct-order:7 --> generado por buildIssueBody
    expect(mapped.deps).toEqual([1, 2])
    expect(mapped.ac).toEqual(['AC-7.1 algo', 'AC-7.2 otro'])
    expect(mapped.status).toBe('ready')
    expect(mapped.type).toBe('backend')
  })
})

describe('filterMergedIssues', () => {
  it('stateReason COMPLETED (mayúsculas, enum GraphQL real) → cuenta como mergeado', () => {
    expect(filterMergedIssues([{ number: 1, stateReason: 'COMPLETED' }])).toEqual([1])
  })
  it('stateReason NOT_PLANNED → NO cuenta', () => {
    expect(filterMergedIssues([{ number: 1, stateReason: 'NOT_PLANNED' }])).toEqual([])
  })
  it('stateReason en minúsculas ("completed") → NO cuenta (no existe en la práctica; sin rama muerta)', () => {
    expect(filterMergedIssues([{ number: 1, stateReason: 'completed' }])).toEqual([])
  })
  it('defensivo: entrada vacía/ausente no revienta', () => {
    expect(filterMergedIssues([])).toEqual([])
    expect(filterMergedIssues(undefined)).toEqual([])
  })
})
