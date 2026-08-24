// ============================================================================
// La columna E2E: el parser la trata como una celda cruda más.
//
// Por qué cruda y no resuelta: slices.js "no sabe de gates, igual que no sabe
// de labels ni de addenda: su trabajo es convertir una tabla markdown en
// celdas fiables" (comentario del campo `gate`). La resolución de los tres
// estados de la celda vive en gates.js#resolveE2e.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { analyzeSlicesTable } from '../scripts/slices.js'

const table = (headerExtra, rowExtra) => `
## 9. Slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate |${headerExtra}
|---|-------|------|---------|-----|--------|-----------|------|------|------|${headerExtra ? '---|' : ''}
| 1 | uno | backend | algo | – | un criterio | – | core | – | – |${rowExtra}
`

describe('columna E2E', () => {
  it('sin columna E2E, el campo llega vacío y nada más cambia', () => {
    const { slices } = analyzeSlicesTable(table('', ''))
    expect(slices).toHaveLength(1)
    expect(slices[0].e2e).toBe('')
    expect(slices[0].name).toBe('uno')
  })

  it('con columna E2E, el campo trae la celda cruda ya trimmed', () => {
    const { slices } = analyzeSlicesTable(table(' E2E |', ' levantado con el example\\, curl -i :9115/metrics responde 200 |'))
    expect(slices[0].e2e).toBe('levantado con el example\\, curl -i :9115/metrics responde 200')
  })

  it('la celda `no` llega literal, sin interpretar', () => {
    const { slices } = analyzeSlicesTable(table(' E2E |', ' no |'))
    expect(slices[0].e2e).toBe('no')
  })

  it('la cabecera E2E no colisiona con ninguna de las diez existentes', () => {
    const { slices } = analyzeSlicesTable(table(' E2E |', ' un recorrido |'))
    const s = slices[0]
    expect(s.type).toBe('backend')
    expect(s.entrega).toBe('algo')
    expect(s.ac).toEqual(['un criterio'])
    expect(s.area).toEqual(expect.arrayContaining(['core']))
    expect(s.gate).toBe('–')
    expect(s.e2e).toBe('un recorrido')
  })

  it('la columna ausente NO produce aviso de columna opcional', () => {
    const res = analyzeSlicesTable(table('', ''))
    expect(res.missingOptionalColumns || []).not.toContain('E2E')
  })

  // e2eColumnPresent: expuesto porque NO es derivable de las celdas (una
  // columna con todo "–" es indistinguible de una columna ausente). La
  // Tarea 3 lo consume para decidir si exige una decisión de e2e por fila,
  // así que el booleano tiene que ser exacto: `toBe`, no una comprobación de
  // "truthy" que dejaría pasar por error un índice numérico.
  it('e2eColumnPresent es true cuando la cabecera E2E está', () => {
    const res = analyzeSlicesTable(table(' E2E |', ' un recorrido |'))
    expect(res.e2eColumnPresent).toBe(true)
  })

  it('e2eColumnPresent es false cuando la cabecera E2E no está', () => {
    const res = analyzeSlicesTable(table('', ''))
    expect(res.e2eColumnPresent).toBe(false)
  })

  it('e2eColumnPresent es false también en el camino de "no se encontró tabla"', () => {
    const res = analyzeSlicesTable('# Un documento sin tabla §9 en absoluto\n\nsolo texto.\n')
    expect(res.tableFound).toBe(false)
    expect(res.e2eColumnPresent).toBe(false)
  })
})
