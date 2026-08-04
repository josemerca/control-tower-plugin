import { describe, it, expect } from 'vitest'
import { cargarIssues } from '../scripts/loop-issues.js'

describe('cargarIssues', () => {
  it('aplana las páginas, descarta PRs y normaliza state_reason a mayúsculas', () => {
    const gh = (args) => {
      const abierto = args.includes('state=open')
      return JSON.stringify([[
        abierto
          ? { number: 1, body: 'x', labels: [] }
          : { number: 2, body: 'y', state_reason: 'completed', labels: [] },
        { number: 99, body: 'soy un PR', pull_request: { url: 'x' } },
      ]])
    }
    const { abiertos, cerrados } = cargarIssues({ repo: 'o/r', gh })
    expect(abiertos.map((i) => i.number)).toEqual([1])
    expect(cerrados.map((i) => i.number)).toEqual([2])
    expect(cerrados[0].stateReason).toBe('COMPLETED')
  })

  it('nunca pasa --limit: la paginación es real', () => {
    const vistos = []
    const gh = (args) => { vistos.push(args.join(' ')); return '[[]]' }
    cargarIssues({ repo: 'o/r', gh })
    for (const c of vistos) {
      expect(c).toContain('--paginate')
      expect(c).not.toContain('--limit')
    }
  })

  it('LANZA cuando falla una lectura, nombrando cuál — no sale del proceso', () => {
    const gh = (args) => { if (args.includes('state=open')) throw new Error('rate limit'); return '[[]]' }
    expect(() => cargarIssues({ repo: 'o/r', gh })).toThrow(/abiertos.*rate limit/s)
  })
})
