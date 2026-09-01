import { describe, it, expect } from 'vitest'
import { pickCurrentIteration, hasProjectItem } from '../scripts/project-fields.js'

describe('pickCurrentIteration', () => {
  const iterations = [
    { id: 'a', title: 'Sprint 1', startDate: '2026-07-06', duration: 14 },
    { id: 'b', title: 'Sprint 2', startDate: '2026-07-20', duration: 14 },
    { id: 'c', title: 'Sprint 3', startDate: '2026-08-03', duration: 14 },
  ]

  it('elige la iteración cuyo rango [startDate, startDate+duration) cubre hoy', () => {
    expect(pickCurrentIteration(iterations, '2026-07-25')?.id).toBe('b')
  })

  it('el primer día de una iteración cuenta como vigente (límite inferior inclusivo)', () => {
    expect(pickCurrentIteration(iterations, '2026-07-20')?.id).toBe('b')
  })

  it('el día startDate+duration ya pertenece a la siguiente iteración (límite superior exclusivo)', () => {
    expect(pickCurrentIteration(iterations, '2026-08-03')?.id).toBe('c')
    expect(pickCurrentIteration(iterations, '2026-08-02')?.id).toBe('b')
  })

  it('devuelve null si ninguna iteración cubre la fecha (hueco entre sprints o fuera de rango)', () => {
    expect(pickCurrentIteration(iterations, '2026-06-01')).toBeNull()
    expect(pickCurrentIteration(iterations, '2026-09-01')).toBeNull()
  })

  it('acepta un ISO string completo (con hora) y lo recorta a la fecha', () => {
    expect(pickCurrentIteration(iterations, '2026-07-25T10:08:43.000Z')?.id).toBe('b')
  })

  it('defensivo: lista vacía o ausente devuelve null sin reventar', () => {
    expect(pickCurrentIteration([], '2026-07-25')).toBeNull()
    expect(pickCurrentIteration(undefined, '2026-07-25')).toBeNull()
  })

  it('no depende de la zona horaria del proceso (aritmética en días UTC)', () => {
    // Regresión: si se usara Date#setDate sobre un Date parseado sin hora,
    // en husos horarios negativos (America/*) la fecha calendario se
    // desplazaría un día. Fijamos TZ y comprobamos que el resultado no cambia.
    const prevTz = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    try {
      expect(pickCurrentIteration(iterations, '2026-07-20')?.id).toBe('b')
      expect(pickCurrentIteration(iterations, '2026-08-03')?.id).toBe('c')
    } finally {
      if (prevTz === undefined) delete process.env.TZ
      else process.env.TZ = prevTz
    }
  })
})

describe('hasProjectItem', () => {
  const items = [
    { content: { repository: 'o/r', number: 2 } },
    { content: { repository: 'o/r', number: 3 } },
    { content: { repository: 'other/repo', number: 2 } }, // mismo número, otro repo: no debe casar
  ]

  it('detecta un issue ya presente en el project', () => {
    expect(hasProjectItem(items, 'o/r', 2)).toBe(true)
    expect(hasProjectItem(items, 'o/r', 3)).toBe(true)
  })

  it('un issue con el mismo número pero de otro repo no cuenta como presente', () => {
    expect(hasProjectItem(items, 'other/repo', 3)).toBe(false)
  })

  it('devuelve false si el issue no está en la lista de items', () => {
    expect(hasProjectItem(items, 'o/r', 999)).toBe(false)
  })

  it('defensivo: lista vacía/ausente o content ausente no revienta', () => {
    expect(hasProjectItem([], 'o/r', 2)).toBe(false)
    expect(hasProjectItem(undefined, 'o/r', 2)).toBe(false)
    expect(hasProjectItem([{ content: null }], 'o/r', 2)).toBe(false)
    expect(hasProjectItem([{}], 'o/r', 2)).toBe(false)
  })
})
