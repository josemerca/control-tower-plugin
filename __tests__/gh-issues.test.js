import { describe, it, expect } from 'vitest'
import { flattenIssuePages, isPullRequest, realIssuesOnly, findByMarker, epicTitleOf, partitionByEpic } from '../scripts/gh-issues.js'

describe('flattenIssuePages', () => {
  it('aplana el array de páginas que produce --paginate --slurp', () => {
    const pages = [
      [{ number: 1, body: 'a' }, { number: 2, body: 'b' }],
      [{ number: 3, body: 'c' }],
    ]
    expect(flattenIssuePages(pages)).toEqual([
      { number: 1, body: 'a' },
      { number: 2, body: 'b' },
      { number: 3, body: 'c' },
    ])
  })
  it('una sola página (una sola entrada de array) también se aplana bien', () => {
    const pages = [[{ number: 1, body: 'a' }]]
    expect(flattenIssuePages(pages)).toEqual([{ number: 1, body: 'a' }])
  })
  it('defensivo: entrada no-array devuelve []', () => {
    expect(flattenIssuePages(null)).toEqual([])
    expect(flattenIssuePages(undefined)).toEqual([])
  })
})

describe('isPullRequest / realIssuesOnly', () => {
  it('descarta entradas que traen la clave pull_request', () => {
    const entries = [
      { number: 1, body: 'issue real' },
      { number: 2, body: 'esto es un PR', pull_request: { url: 'x' } },
    ]
    expect(isPullRequest(entries[1])).toBe(true)
    expect(isPullRequest(entries[0])).toBe(false)
    expect(realIssuesOnly(entries)).toEqual([{ number: 1, body: 'issue real' }])
  })
  it('defensivo: entrada vacía no revienta', () => {
    expect(realIssuesOnly(undefined)).toEqual([])
    expect(isPullRequest(undefined)).toBe(false)
  })
})

describe('findByMarker', () => {
  it('casa el marcador exacto de un slice', () => {
    const issues = [
      { number: 10, body: 'algo\n<!-- ct-order:2 -->' },
      { number: 11, body: 'otro\n<!-- ct-order:3 -->' },
    ]
    const found = findByMarker(issues, '<!-- ct-order:2 -->')
    expect(found.number).toBe(10)
  })
  it('NO casa el marcador de otro orden', () => {
    const issues = [{ number: 11, body: 'otro\n<!-- ct-order:3 -->' }]
    expect(findByMarker(issues, '<!-- ct-order:2 -->')).toBeUndefined()
  })
  it('un PR ya filtrado antes no puede casar por error', () => {
    const entries = [
      { number: 1, body: 'PR body con <!-- ct-order:2 --> por casualidad', pull_request: {} },
    ]
    const onlyIssues = realIssuesOnly(entries)
    expect(findByMarker(onlyIssues, '<!-- ct-order:2 -->')).toBeUndefined()
  })
})

// F23 — el alcance por epic. epicTitleOf/partitionByEpic son a /ct-groom lo
// que epicKeyOf/buildOrderIndex (gh-issue-map.js) son a /ct-next: la misma
// idea, con la llave que cada uno puede permitirse. /ct-next usa el NÚMERO
// del milestone; /ct-groom no puede, porque enumera los issues del repo ANTES
// de haber resuelto (o creado) el milestone de la corrida, así que en ese punto
// lo único que conoce del epic es su TÍTULO.
describe('epicTitleOf', () => {
  it('devuelve el título del milestone', () => {
    expect(epicTitleOf({ number: 1, milestone: { number: 4, title: 'Epic A' } })).toBe('Epic A')
  })
  it('sin milestone → null', () => {
    expect(epicTitleOf({ number: 1, milestone: null })).toBeNull()
    expect(epicTitleOf({ number: 1 })).toBeNull()
  })
  it('milestone sin título usable → null (no revienta, cae al cubo compartido)', () => {
    expect(epicTitleOf({ milestone: {} })).toBeNull()
    expect(epicTitleOf({ milestone: { title: '' } })).toBeNull()
    expect(epicTitleOf({ milestone: { title: 42 } })).toBeNull()
  })
  it('defensivo: entrada vacía no revienta', () => {
    expect(epicTitleOf(undefined)).toBeNull()
    expect(epicTitleOf(null)).toBeNull()
  })
})

describe('partitionByEpic', () => {
  const issues = [
    { number: 1, milestone: { title: 'Epic A' } },
    { number: 2, milestone: { title: 'Epic B' } },
    { number: 3, milestone: null },
    { number: 4, milestone: { title: 'Epic A' } },
  ]
  it('reparte en los tres cubos, disjuntos y en el orden de entrada', () => {
    const { inEpic, sinMilestone, otrosEpics } = partitionByEpic(issues, 'Epic A')
    expect(inEpic.map((i) => i.number)).toEqual([1, 4])
    expect(sinMilestone.map((i) => i.number)).toEqual([3])
    expect(otrosEpics.map((i) => i.number)).toEqual([2])
  })
  it('el título se compara EXACTO: no hay normalización de mayúsculas ni de espacios', () => {
    const { inEpic, otrosEpics } = partitionByEpic(issues, 'epic a')
    expect(inEpic).toEqual([])
    expect(otrosEpics.map((i) => i.number)).toEqual([1, 2, 4])
  })
  it('un título pedido que no existe deja inEpic vacío sin perder a nadie', () => {
    const { inEpic, sinMilestone, otrosEpics } = partitionByEpic(issues, 'Epic Z')
    expect(inEpic).toEqual([])
    expect(sinMilestone.length + otrosEpics.length).toBe(issues.length)
  })
  it('defensivo: lista vacía o ausente devuelve los tres cubos vacíos', () => {
    for (const entrada of [[], undefined, null]) {
      const p = partitionByEpic(entrada, 'Epic A')
      expect(p).toEqual({ inEpic: [], sinMilestone: [], otrosEpics: [] })
    }
  })
})

describe('normalizeGraphqlIssues — traduce la respuesta GraphQL a la forma REST que el resto del código espera', () => {
  it('aplana páginas, baja state a minúsculas y normaliza labels/milestone', async () => {
    const { normalizeGraphqlIssues } = await import('../scripts/gh-issues.js')
    const pages = [
      { data: { repository: { issues: { nodes: [
        { number: 501, title: '#1 login', body: 'x <!-- ct-order:1 -->', state: 'OPEN', milestone: { title: 'Epic' }, labels: { nodes: [{ name: 'type:backend' }, { name: 'area:api' }] } },
      ], pageInfo: { hasNextPage: true, endCursor: 'a' } } } } },
      { data: { repository: { issues: { nodes: [
        { number: 502, title: '#2 scoring', body: 'y <!-- ct-order:2 -->', state: 'CLOSED', milestone: null, labels: { nodes: [] } },
      ], pageInfo: { hasNextPage: false, endCursor: 'b' } } } } },
    ]
    expect(normalizeGraphqlIssues(pages)).toEqual([
      { number: 501, title: '#1 login', body: 'x <!-- ct-order:1 -->', state: 'open', milestone: { title: 'Epic' }, labels: [{ name: 'type:backend' }, { name: 'area:api' }] },
      { number: 502, title: '#2 scoring', body: 'y <!-- ct-order:2 -->', state: 'closed', milestone: null, labels: [] },
    ])
  })
  it('DOS páginas → concatena los nodes de ambas en orden (no pierde la página 2)', async () => {
    const { normalizeGraphqlIssues } = await import('../scripts/gh-issues.js')
    const mk = (n) => ({ number: n, title: `#${n}`, body: `<!-- ct-order:${n} -->`, state: 'OPEN', milestone: null, labels: { nodes: [] } })
    const pages = [
      { data: { repository: { issues: { nodes: [mk(1), mk(2)], pageInfo: { hasNextPage: true, endCursor: 'a' } } } } },
      { data: { repository: { issues: { nodes: [mk(3)], pageInfo: { hasNextPage: false, endCursor: 'b' } } } } },
    ]
    expect(normalizeGraphqlIssues(pages).map((i) => i.number)).toEqual([1, 2, 3])
  })
  it('defensivo: páginas vacías o sin nodes → []', async () => {
    const { normalizeGraphqlIssues } = await import('../scripts/gh-issues.js')
    expect(normalizeGraphqlIssues([])).toEqual([])
    expect(normalizeGraphqlIssues([{ data: { repository: { issues: { nodes: [] } } } }])).toEqual([])
    expect(normalizeGraphqlIssues(null)).toEqual([])
  })
})
