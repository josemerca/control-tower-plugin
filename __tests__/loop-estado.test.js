import { describe, it, expect } from 'vitest'
import { construirEstado } from '../scripts/loop-estado.js'

const base = {
  enProgreso: [], mergeados: [], cerradosConStatus: [],
  worktreesEnDisco: [], ramasEnDisco: [],
  procesos: { porSlice: new Map(), comprobado: true, motivo: null },
  edadClaimMs: new Map(), ventanaArranqueMs: 15000,
}

describe('construirEstado — en vuelo', () => {
  it('un slice con proceso vivo sale vivo y con su pid', () => {
    const e = construirEstado({
      ...base,
      enProgreso: [{ n: 7, nombre: 'refresh' }],
      worktreesEnDisco: ['7'], ramasEnDisco: ['feat/7'],
      procesos: { porSlice: new Map([['7', '4242']]), comprobado: true, motivo: null },
      edadClaimMs: new Map([[7, 3_600_000]]),
    })
    expect(e.enVuelo[0]).toMatchObject({ n: 7, vivo: true, pid: '4242', arrancando: false })
    expect(e.hayHallazgos).toBe(false)
  })

  it('sin proceso y con claim VIEJO: es un hallazgo', () => {
    const e = construirEstado({
      ...base,
      enProgreso: [{ n: 7, nombre: 'refresh' }],
      worktreesEnDisco: ['7'],
      edadClaimMs: new Map([[7, 3 * 3_600_000]]),
    })
    expect(e.enVuelo[0]).toMatchObject({ vivo: false, arrancando: false })
    expect(e.hayHallazgos).toBe(true)
  })

  it('sin proceso pero con claim RECIÉN puesto: arrancando, y NO es hallazgo', () => {
    const e = construirEstado({
      ...base,
      enProgreso: [{ n: 7, nombre: 'refresh' }],
      worktreesEnDisco: ['7'],
      edadClaimMs: new Map([[7, 5_000]]),
    })
    expect(e.enVuelo[0]).toMatchObject({ vivo: false, arrancando: true })
    expect(e.hayHallazgos).toBe(false)
  })

  it('sin proceso y con la edad del claim DESCONOCIDA: no se acusa, y va a sinComprobar', () => {
    const e = construirEstado({
      ...base,
      enProgreso: [{ n: 7, nombre: 'refresh' }],
      worktreesEnDisco: ['7'],
      edadClaimMs: new Map([[7, null]]),
    })
    expect(e.enVuelo[0].arrancando).toBe(false)
    expect(e.enVuelo[0].vivo).toBe(false)
    expect(e.sinComprobar.join(' ')).toMatch(/#7/)
  })

  it('procesos no comprobados: NADIE sale como muerto, y el motivo viaja', () => {
    const e = construirEstado({
      ...base,
      enProgreso: [{ n: 7, nombre: 'refresh' }],
      worktreesEnDisco: ['7'],
      edadClaimMs: new Map([[7, 3 * 3_600_000]]),
      procesos: { porSlice: new Map(), comprobado: false, motivo: 'lsof no está' },
    })
    expect(e.enVuelo[0].vivo).toBeNull()
    expect(e.sinComprobar.join(' ')).toMatch(/lsof no está/)
  })
})

describe('construirEstado — cosecha y residuo', () => {
  it('un mergeado que deja worktree o rama va a cosecha', () => {
    const e = construirEstado({ ...base, mergeados: [5], worktreesEnDisco: ['5'] })
    expect(e.cosecha).toEqual([{ n: 5, hasWorktree: true, hasBranch: false }])
    expect(e.hayHallazgos).toBe(true)
  })

  it('un worktree que NINGÚN issue reclama sale como huérfano', () => {
    const e = construirEstado({ ...base, worktreesEnDisco: ['9'] })
    expect(e.residuo.worktreesHuerfanos).toEqual(['9'])
    expect(e.hayHallazgos).toBe(true)
  })

  it('el worktree de un slice EN VUELO no es huérfano', () => {
    const e = construirEstado({
      ...base,
      enProgreso: [{ n: 9, nombre: 'x' }], worktreesEnDisco: ['9'],
      procesos: { porSlice: new Map([['9', '1']]), comprobado: true, motivo: null },
      edadClaimMs: new Map([[9, 1000]]),
    })
    expect(e.residuo.worktreesHuerfanos).toEqual([])
  })

  it('el worktree de un MERGEADO sale por cosecha y NO se duplica en huérfanos', () => {
    const e = construirEstado({ ...base, mergeados: [5], worktreesEnDisco: ['5'] })
    expect(e.residuo.worktreesHuerfanos).toEqual([])
    expect(e.cosecha).toHaveLength(1)
  })

  it('labels status: sobre issues cerrados van a residuo', () => {
    const e = construirEstado({ ...base, cerradosConStatus: [{ n: 3, statusLabels: ['status:in-review'] }] })
    expect(e.residuo.labels).toHaveLength(1)
    expect(e.hayHallazgos).toBe(true)
  })
})

describe('construirEstado — un loop limpio', () => {
  it('sin nada que revisar: cero hallazgos y cero motivos sin comprobar', () => {
    const e = construirEstado(base)
    expect(e.hayHallazgos).toBe(false)
    expect(e.sinComprobar).toEqual([])
    expect(e.enVuelo).toEqual([])
  })
})
