import { describe, it, expect } from 'vitest'
import { parseSlices } from '../scripts/slices.js'

const SPEC = `# Spec X
## 9. Desglose en slices
| # | Slice (issue) | Tipo | Entrega | Dep | Acepta (AC) | Protegido |
|---|---|---|---|---|---|---|
| 1 | #— login model | backend | modelo User | – | AC-1.1, AC-1.2 | schema §6 |
| 2 | refresh token | backend | refresh flow | #1 | AC-2.1 | – |
| 3 | UI login | ui | pantalla | #1, #2 | AC-3.1 | design-system |
| 4 | #42 notifications | backend | notif engine | #1 | – | logging |
`

describe('parseSlices', () => {
  const s = parseSlices(SPEC)
  it('extrae todas las filas de datos (no el separador)', () => {
    expect(s).toHaveLength(4)
  })
  it('tipa n, type, deps, ac', () => {
    expect(s[0]).toMatchObject({ n: 1, type: 'backend', deps: [], ac: ['AC-1.1', 'AC-1.2'], protected: 'schema §6' })
    expect(s[2].deps).toEqual([1, 2])
    expect(s[1].deps).toEqual([1])
  })
  it('deps vacío/– → []', () => {
    expect(s[0].deps).toEqual([])
  })
  it('issue: extrae #NN si existe, null en otro caso', () => {
    expect(s[0].issue).toEqual(null) // #— login model → no coincide /#(\d+)/
    expect(s[1].issue).toEqual(null) // refresh token → sin issue
    expect(s[3].issue).toEqual('#42') // #42 notifications → extrae #42
  })
  it('entrega: preserva el texto de la celda', () => {
    expect(s[0].entrega).toEqual('modelo User')
    expect(s[1].entrega).toEqual('refresh flow')
    expect(s[2].entrega).toEqual('pantalla')
    expect(s[3].entrega).toEqual('notif engine')
  })
  it('ac: – y vacío → []', () => {
    expect(s[3].ac).toEqual([]) // #42 notifications → AC es –
  })
  it('sin tabla §9 → []', () => {
    expect(parseSlices('# spec sin tabla')).toEqual([])
  })
  it('sin columnas Área/Toca (tabla vieja) → area/touches por defecto []', () => {
    expect(s[0].area).toEqual([])
    expect(s[0].touches).toEqual([])
  })
})

const SPEC_AREA_TOCA = `# Spec Y
## 9. Desglose en slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|-------|------|---------|-----|--------|-----------|------|------|
| 1 | modelo | backend | tabla users | – | AC-1.1 | schema | api | db, migration |
| 2 | api | backend | endpoint | #1 | AC-2.1 | – | api | – |
| 3 | pantalla | ui | login UI | #1, #2 | AC-3.1 | – |  |  |
`

describe('parseSlices — columnas Área/Toca', () => {
  const s = parseSlices(SPEC_AREA_TOCA)
  it('parsea area/touches comma-separated', () => {
    expect(s[0].area).toEqual(['api'])
    expect(s[0].touches).toEqual(['db', 'migration'])
  })
  it('single area, sin touches (–) → []', () => {
    expect(s[1].area).toEqual(['api'])
    expect(s[1].touches).toEqual([])
  })
  it('celdas vacías → []', () => {
    expect(s[2].area).toEqual([])
    expect(s[2].touches).toEqual([])
  })
})

describe('parseSlices — normalización de tokens Área/Toca', () => {
  it('trim, lowercase, colapsa espacios internos', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – |  API  ,  Payments Core  | ci  pipeline |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['api', 'payments core'])
    expect(s[0].touches).toEqual(['ci pipeline'])
  })
  it('cabecera "Area" sin tilde también resuelve la columna', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Area | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | api | – |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['api'])
  })
  it('caracteres inválidos para un label de GitHub se descartan del token', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | ap:i "core" | – |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['api core'])
  })
  it('cabecera "Área" en forma NFD (A + acento combinante) resuelve la columna igual que NFC', () => {
    // 'Á' aquí es DELIBERADAMENTE 'A' (U+0041) + acento agudo combinante
    // (U+0301), no el carácter precompuesto 'Á' (U+00C1/00E1, NFC). Algunos
    // editores/entornos (p.ej. macOS en ciertos flujos) normalizan a NFD al
    // guardar. Como string JS, 'Área' NO es === 'Área' (NFC) ni
    // contiene la subcadena 'area' ni 'área' bajo comparación literal —
    // hay que normalizar antes de comparar, o esta cabecera se pierde en
    // silencio y el epic entero se queda sin labels area:/touches:.
    const NFD_AREA_HEADER = 'A' + '\u0301' + 'rea' // 'Area' con A + acento agudo combinante (U+0301) = 'Área' visualmente, forma NFD
    expect(NFD_AREA_HEADER.normalize('NFC')).toBe('Área')
    expect(NFD_AREA_HEADER === 'Área').toBe(false)
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | ${NFD_AREA_HEADER} | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | api | db |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['api'])
    expect(s[0].touches).toEqual(['db'])
  })
})
