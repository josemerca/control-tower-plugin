import { describe, it, expect } from 'vitest'
import { parseSlices, analyzeSlicesTable } from '../scripts/slices.js'

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

// F1 — la tabla real que disparó el incidente: alguien que no había leído
// commands/ct-groom.md escribió "#" como "**S1**"/"**S2**" (numeración con
// prefijo de letra y negrita markdown en vez de un entero a secas), el Dep
// de S2 como "S1" (sin "#"), y el valor de Área como el nombre completo de
// la label ("`area:medicacion`", con backticks) en vez del token pelado. Con
// el parser viejo esto producía `parseSlices() -> []` en absoluto silencio.
// No se parafrasea: son las filas exactas del informe del incidente.
const REAL_FAILING_SPEC = [
  '## 9. Slices',
  '| # | Slice | Qué entrega (visible) | Área | Toca | Depende de |',
  '|---|---|---|---|---|---|',
  '| **S1** | Segmented control + "Plan actual" | La pestaña se parte en dos… | `area:medicacion` | `touches:pbxproj` | — |',
  '| **S2** | Objetivo semanal y cumplimiento | La barra: % de la semana… | `area:medicacion` | `touches:migration` | S1 |',
  '',
].join('\n')

describe('analyzeSlicesTable — contrato enriquecido (F1)', () => {
  it('parseSlices(md) sigue devolviendo Slice[] a secas (contrato sin romper)', () => {
    expect(Array.isArray(parseSlices(REAL_FAILING_SPEC))).toBe(true)
  })

  it('regresión: la tabla real del incidente — cabecera encontrada, pero ambas filas se reportan como no parseables por "#"', () => {
    const r = analyzeSlicesTable(REAL_FAILING_SPEC)
    expect(r.tableFound).toBe(true)
    expect(r.missingRequiredColumns).toEqual([]) // "Qué entrega (visible)" matchea "entrega"
    expect(r.slices).toEqual([]) // ninguna fila parseable: 0 slices, ya no en silencio
    expect(r.skippedRows).toHaveLength(2)
    expect(r.skippedRows[0].value).toBe('**S1**')
    expect(r.skippedRows[1].value).toBe('**S2**')
  })

  it('sin tabla §9 → tableFound: false (no confundir con "tabla vacía")', () => {
    const r = analyzeSlicesTable('# spec sin tabla')
    expect(r.tableFound).toBe(false)
    expect(r.slices).toEqual([])
  })

  it('columna "#" ausente → missingRequiredColumns incluye "#"', () => {
    const spec = `## 9. Slices
| Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|
| x | backend | y | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.tableFound).toBe(true)
    expect(r.missingRequiredColumns).toContain('#')
  })

  it('columna "Entrega" ausente → missingRequiredColumns incluye "Entrega"', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Dep | Acepta | Protegido |
|---|---|---|---|---|---|
| 1 | x | backend | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.missingRequiredColumns).toContain('Entrega')
  })

  it('columnas Tipo/Acepta/Protegido/Área/Toca ausentes → missingOptionalColumns las nombra, pero slices se siguen parseando', () => {
    const spec = `## 9. Slices
| # | Slice | Entrega | Dep |
|---|---|---|---|
| 1 | x | y | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.missingRequiredColumns).toEqual([])
    expect(r.missingOptionalColumns.sort()).toEqual(['Acepta', 'Protegido', 'Tipo', 'Toca', 'Área'].sort())
    expect(r.slices).toHaveLength(1)
  })

  it('fila con "#" que no es un entero a secas ("**1**", "S1") se reporta en skippedRows con el valor ofensor', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| **1** | x | backend | y | – | – | – |
| 2 | ok | backend | z | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.skippedRows).toHaveLength(1)
    expect(r.skippedRows[0].value).toBe('**1**')
    expect(r.slices).toHaveLength(1) // la fila 2, válida, sí se parsea
    expect(r.slices[0].n).toBe(2)
  })

  it('tabla sin ninguna fila de datos → slices: [], skippedRows: [], totalDataRows: 0', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices).toEqual([])
    expect(r.skippedRows).toEqual([])
    expect(r.totalDataRows).toBe(0)
  })
})

describe('parseSlices/analyzeSlicesTable — tolerancia al prefijo de label en Área/Toca (F1)', () => {
  it('Área acepta el token pelado ("medicacion") y el prefijado ("area:medicacion"), mismo resultado', () => {
    const spec = (val) => `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | ${val} | – |
`
    expect(parseSlices(spec('medicacion'))[0].area).toEqual(['medicacion'])
    expect(parseSlices(spec('area:medicacion'))[0].area).toEqual(['medicacion'])
  })

  it('Toca acepta el token pelado ("pbxproj") y el prefijado ("touches:pbxproj"), mismo resultado', () => {
    const spec = (val) => `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | – | ${val} |
`
    expect(parseSlices(spec('pbxproj'))[0].touches).toEqual(['pbxproj'])
    expect(parseSlices(spec('touches:pbxproj'))[0].touches).toEqual(['pbxproj'])
  })

  it('backticks alrededor del valor prefijado ("`area:medicacion`") no duplican el prefijo', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | \`area:medicacion\` | \`touches:pbxproj\` |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion'])
    expect(s[0].touches).toEqual(['pbxproj'])
  })

  it('prefijo de LA OTRA columna ("area:x" dentro de Toca) se admite (no se pierde el valor) pero se reporta como aviso', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | – | area:pbxproj |
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices[0].touches).toEqual(['pbxproj']) // se usa el valor, no se descarta
    expect(r.prefixWarnings).toHaveLength(1)
    expect(r.prefixWarnings[0]).toMatchObject({ column: 'Toca', n: 1, raw: 'area:pbxproj' })
  })
})

// F2 — hueco señalado por el coordinador tras verificar F1: una celda "Dep"
// con contenido (no "–"/"-"/vacío) que no matchea NINGÚN "#N" produce
// deps: [] en silencio — el grafo de dependencias desaparece pero groom
// sale con exit 0 y crea los issues igualmente. Es peor que el caso de 0
// slices (F1 defecto 1): aquel no hacía nada; este hace daño (rompe el
// orden merge-after) mientras aparenta funcionar. Mismo criterio que los
// demás defectos: reportar, no perder en silencio.
const REAL_DEP_TABLE = [
  '## 9. Slices',
  '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |',
  '|---|---|---|---|---|---|---|',
  '| 1 | a | ui | primero | – | – | – |',
  '| 2 | b | ui | segundo | S1 | – | – |',
  '| 3 | c | ui | tercero | S1, S2 | – | – |',
  '',
].join('\n')

describe('analyzeSlicesTable — Dep con contenido pero sin ninguna referencia #N reconocible (F2)', () => {
  it('regresión: la tabla del coordinador — 2 filas con Dep malformado ("S1", "S1, S2"), la fila con "–" no cuenta', () => {
    const r = analyzeSlicesTable(REAL_DEP_TABLE)
    expect(r.tableFound).toBe(true)
    expect(r.slices).toHaveLength(3) // el "#" de las 3 filas es válido, solo Dep está mal
    expect(r.malformedDepRows).toHaveLength(2)
    expect(r.malformedDepRows[0]).toMatchObject({ n: 2, raw: 'S1' })
    expect(r.malformedDepRows[1]).toMatchObject({ n: 3, raw: 'S1, S2' })
  })

  it('"–"/"-"/vacío en Dep no es malformado (es la forma legítima de "sin dependencias")', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | - | – | – |
| 3 | c | ui | z |  | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
  })

  it('texto legítimo alrededor de una referencia #N válida SÍ pasa (el disparador es "0 deps extraídas", no "caracteres raros")', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | #1 (tras el merge) | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
    expect(r.slices[1].deps).toEqual([1])
  })

  it('sin tabla / sin filas → malformedDepRows: []', () => {
    expect(analyzeSlicesTable('# sin tabla').malformedDepRows).toEqual([])
  })
})
