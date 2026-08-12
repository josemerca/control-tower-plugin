// El gate `plan` (F-jjponz-1): vocabulario nuevo en gates.js, opt-in puro.
// Se fija aquí lo que la doctrina de gates.js exige de toda entrada nueva:
// que exista en el vocabulario con sus DOS textos, que ningún Tipo lo
// implique (opt-in significa opt-in), y que el pipeline entero lo trate como
// a los demás (celda -> resolveGates -> kickoff).
import { describe, it, expect } from 'vitest'
import { GATES, TYPE_GATES, parseGateCell, resolveGates, gatesForType } from '../scripts/gates.js'

describe('gate `plan` — vocabulario', () => {
  it('existe con sus dos textos, y los dos dicen quién lo cierra', () => {
    expect(Object.hasOwn(GATES, 'plan')).toBe(true)
    expect(GATES.plan.kickoff).toContain('PARA')
    expect(GATES.plan.kickoff).toContain('--check-plan')
    expect(GATES.plan.issue).toContain('comentario')
    for (const texto of [GATES.plan.kickoff, GATES.plan.issue]) {
      expect(texto.toLowerCase()).toContain('humano')
    }
  })

  it('ningún Tipo lo implica: es opt-in puro por columna Gate', () => {
    expect(Object.values(TYPE_GATES).flat()).not.toContain('plan')
    expect(gatesForType('backend')).not.toContain('plan')
  })

  it('la celda `plan` lo añade y `!plan` sobre un Tipo que no lo implica es renuncia inerte', () => {
    expect(parseGateCell('plan')).toMatchObject({ add: ['plan'], waive: [], unknown: [] })
    const r = resolveGates('backend', '!plan')
    expect(r.gates).not.toContain('plan')
    expect(r.inertWaivers).toContain('plan')
  })

  it('convive con los demás en una celda: `visual, plan` sobre un Tipo ui', () => {
    const r = resolveGates('ui', 'visual, plan')
    expect(r.gates).toContain('visual')
    expect(r.gates).toContain('plan')
    expect(r.unknown).toEqual([])
  })
})
