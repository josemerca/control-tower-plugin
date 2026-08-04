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

  it('devuelve el motivo cuando falla una lectura, nombrando cuál — no lanza ni sale del proceso', () => {
    const gh = (args) => { if (args.includes('state=open')) throw new Error('rate limit'); return '[[]]' }
    const { motivos } = cargarIssues({ repo: 'o/r', gh })
    expect(motivos).toHaveLength(1)
    expect(motivos[0]).toMatch(/abiertos.*rate limit/s)
  })

  it('si fallan los CERRADOS, los abiertos ya leídos NO se tiran', () => {
    // Lanzar al fallar la segunda lectura descartaba la primera, que ya estaba
    // entera en memoria: /ct-status imprimía un informe VACÍO bajo «lo de
    // arriba es sólo lo que sí se ha podido comprobar», sin nada arriba.
    const gh = (args) => {
      if (args.includes('state=closed')) throw new Error('rate limit')
      return JSON.stringify([[{ number: 42, body: '', labels: [] }]])
    }
    const { abiertos, cerrados, motivos } = cargarIssues({ repo: 'o/r', gh })
    expect(abiertos.map((i) => i.number)).toEqual([42])
    expect(cerrados).toEqual([])
    expect(motivos).toHaveLength(1)
    expect(motivos[0]).toMatch(/cerrados/)
  })

  it('si fallan LAS DOS lecturas se dicen las dos, y ninguna se degrada a "no hay issues"', () => {
    const gh = () => { throw new Error('sin red') }
    const { abiertos, cerrados, motivos } = cargarIssues({ repo: 'o/r', gh })
    expect(abiertos).toEqual([])
    expect(cerrados).toEqual([])
    expect(motivos.map((m) => /abiertos/.test(m) ? 'abiertos' : 'cerrados')).toEqual(['abiertos', 'cerrados'])
  })

  it('con las dos lecturas buenas, `motivos` viene vacío', () => {
    const { motivos } = cargarIssues({ repo: 'o/r', gh: () => '[[]]' })
    expect(motivos).toEqual([])
  })
})
