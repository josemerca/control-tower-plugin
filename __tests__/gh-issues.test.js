import { describe, it, expect } from 'vitest'
import { flattenIssuePages, isPullRequest, realIssuesOnly, findByMarker } from '../scripts/gh-issues.js'

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
