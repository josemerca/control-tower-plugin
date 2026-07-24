import { describe, it, expect } from 'vitest'
import { parseSlices } from '../scripts/slices.js'

const SPEC = `# Spec X
## 9. Desglose en slices
| # | Slice (issue) | Tipo | Entrega | Dep | Acepta (AC) | Protegido |
|---|---|---|---|---|---|---|
| 1 | #— login model | backend | modelo User | – | AC-1.1, AC-1.2 | schema §6 |
| 2 | refresh token | backend | refresh flow | #1 | AC-2.1 | – |
| 3 | UI login | ui | pantalla | #1, #2 | AC-3.1 | design-system |
`

describe('parseSlices', () => {
  const s = parseSlices(SPEC)
  it('extrae todas las filas de datos (no el separador)', () => {
    expect(s).toHaveLength(3)
  })
  it('tipa n, type, deps, ac', () => {
    expect(s[0]).toMatchObject({ n: 1, type: 'backend', deps: [], ac: ['AC-1.1', 'AC-1.2'], protected: 'schema §6' })
    expect(s[2].deps).toEqual([1, 2])
    expect(s[1].deps).toEqual([1])
  })
  it('deps vacío/– → []', () => {
    expect(s[0].deps).toEqual([])
  })
  it('sin tabla §9 → []', () => {
    expect(parseSlices('# spec sin tabla')).toEqual([])
  })
})
