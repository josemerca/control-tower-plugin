// El gate `plan` (F-jjponz-1, política F-jjponz-2): vocabulario nuevo en
// gates.js, IMPLICADO POR DEFECTO en todo slice. Se fija aquí lo que la
// doctrina de gates.js exige de toda entrada nueva: que exista en el
// vocabulario con sus DOS textos, que el defecto sea universal (todo slice
// lo lleva, venga el Tipo que venga), y que la renuncia por fila (`!plan`)
// sea una renuncia REAL, no inerte — con su ruido, como toda renuncia.
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

  it('está implicado en TODO slice, venga el Tipo que venga — sin tocar TYPE_GATES', () => {
    // TYPE_GATES sigue siendo el mapa Tipo→gate técnico (ui→visual,
    // infra→apply); el defecto universal de `plan` vive en gatesForType.
    expect(Object.values(TYPE_GATES).flat()).not.toContain('plan')
    expect(gatesForType('backend')).toContain('plan')
    expect(gatesForType('ui')).toEqual(['visual', 'plan'])
    expect(gatesForType('')).toContain('plan')
    expect(gatesForType(undefined)).toContain('plan')
  })

  it('`!plan` es una renuncia real por fila: quita el gate y hace ruido como toda renuncia', () => {
    const r = resolveGates('backend', '!plan')
    expect(r.gates).not.toContain('plan')
    expect(r.waived).toContain('plan')
    expect(r.inertWaivers).not.toContain('plan')
  })

  it('declararlo explícito es redundante (inocuo, y se dice)', () => {
    expect(parseGateCell('plan')).toMatchObject({ add: ['plan'], waive: [], unknown: [] })
    const r = resolveGates('backend', 'plan')
    expect(r.gates).toContain('plan')
    expect(r.redundant).toContain('plan')
  })

  it('convive con los demás en una celda: `visual, plan` sobre un Tipo ui', () => {
    const r = resolveGates('ui', 'visual, plan')
    expect(r.gates).toContain('visual')
    expect(r.gates).toContain('plan')
    expect(r.unknown).toEqual([])
  })
})
