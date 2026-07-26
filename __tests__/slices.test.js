import { describe, it, expect } from 'vitest'
import { parseSlices, analyzeSlicesTable } from '../scripts/slices.js'
import { REAL_FAILING_TABLE, REAL_DEP_TABLE, REAL_TABLE_WITH_HASH_FIXED } from './fixtures/slices-real-tables.js'

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

describe('analyzeSlicesTable — contrato enriquecido (F1)', () => {
  it('parseSlices(md) sigue devolviendo Slice[] a secas (contrato sin romper)', () => {
    expect(Array.isArray(parseSlices(REAL_FAILING_TABLE))).toBe(true)
  })

  it('regresión: la tabla real del incidente — cabecera encontrada, pero ambas filas se reportan como no parseables por "#"', () => {
    const r = analyzeSlicesTable(REAL_FAILING_TABLE)
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

// ============================================================================
// Review de F1/F2 — 2 Critical + 4 caminos silenciosos encontrados al
// reproducir el RED contra el código base y al verificar el fix contra el
// spec real. Cada bloque de abajo corresponde a un punto numerado de esa
// review.
// ============================================================================

// CRITICAL 1 — el em dash (—, U+2014) es la forma en que la tabla REAL del
// incidente escribe "sin dependencias" en la fila S1, y el conjunto de
// marcadores de "vacío" solo reconocía en dash (–) y guion (-). Arreglar la
// columna "#" (como pide nuestro propio mensaje de F1) sin tocar nada más
// haría que esa misma celda, que siempre significó "sin dependencias"
// correctamente, disparase el abort de "Dep malformado".
describe('analyzeSlicesTable — em dash (—) y variantes de guion largo en Dep/Acepta/Área/Toca significan "sin valor" (CRITICAL 1)', () => {
  it('em dash (—) en Dep no es malformado — deps: []', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | — | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
    expect(r.slices[0].deps).toEqual([])
  })

  it('em dash envuelto en NBSP (U+00A0) también cuenta como "sin dependencias" (NBSP ya lo quita String#trim, verificado)', () => {
    const nbsp = ' '
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | ${nbsp}—${nbsp} | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
  })

  it('regresión EXACTA de la secuencia descrita por el coordinador: REAL_FAILING_TABLE con "#" ya corregido (1, 2) — la fila 1 (Dep "—") no debe abortar; la fila 2 (Dep "S1") sí debe seguir abortando', () => {
    const r = analyzeSlicesTable(REAL_TABLE_WITH_HASH_FIXED)
    expect(r.skippedRows).toEqual([]) // el "#" ya está arreglado
    expect(r.malformedDepRows).toHaveLength(1) // solo la fila 2 (Dep "S1"), no la 1 (Dep "—")
    expect(r.malformedDepRows[0]).toMatchObject({ n: 2, raw: 'S1' })
    expect(r.slices[0].deps).toEqual([]) // fila 1: "—" = sin dependencias, correcto
  })

  it('em dash en Acepta también cuenta como "sin AC" (mismo conjunto de marcadores, coherente entre columnas)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | — | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices[0].ac).toEqual([])
  })

  it('"ninguna"/"n/a" en Dep siguen abortando (política defendible), pero el mensaje debe decir qué escribir — verificado a nivel CLI', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | ninguna | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toHaveLength(1) // sigue siendo malformado — no es un marcador reconocido
  })
})

// CRITICAL 2 — la negrita markdown (**...**) es el hábito demostrado del
// autor real (es literalmente lo que produjo el defecto del "#": "**S1**").
// stripColumnPrefix solo desenvolvía backticks; "**area:medicacion**" no se
// reconocía como prefijado y el `:` se borraba igual que en el defecto
// original, produciendo "area:areamedicacion".
describe('parseSlices/analyzeSlicesTable — negrita/cursiva alrededor del valor prefijado en Área/Toca (CRITICAL 2)', () => {
  it('negrita (**area:medicacion**) no duplica el prefijo, igual que backticks', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | **area:medicacion** | **touches:pbxproj** |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion'])
    expect(s[0].touches).toEqual(['pbxproj'])
  })

  it('guion bajo simple (_area:medicacion_) tampoco duplica el prefijo', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | _area:medicacion_ | – |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion'])
  })

  it('backticks + negrita combinados ("`**area:medicacion**`") tampoco duplican el prefijo', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | x | backend | y | – | – | – | `**area:medicacion**` | – |\n'
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion'])
  })
})

// 3 — una línea en blanco (o cualquier línea sin "|") a mitad de la tabla
// hacía `break` en el bucle de filas: las filas después del hueco
// desaparecían en silencio (medio epic creado, exit 0, reportado como
// éxito). El fix escanea todo el bloque §9 (hasta la siguiente cabecera
// markdown "## N", que sí marca el fin real de la sección) y reporta las
// filas que aparecen después de un hueco en vez de truncar.
describe('analyzeSlicesTable — un hueco (línea en blanco/sin "|") dentro de la tabla no trunca en silencio (3)', () => {
  it('línea en blanco entre 2 filas de datos: ambas se parsean, y la fila tras el hueco se reporta en rowsAfterGap', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | primero | – | – | – |

| 2 | b | ui | segundo | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.totalDataRows).toBe(2) // ya no se trunca en 1
    expect(r.slices).toHaveLength(2)
    expect(r.slices.map((s) => s.n)).toEqual([1, 2])
    expect(r.rowsAfterGap).toHaveLength(1)
    expect(r.rowsAfterGap[0].raw).toContain('segundo')
  })

  it('sin ningún hueco → rowsAfterGap: []', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.rowsAfterGap).toEqual([])
  })

  it('una cabecera markdown nueva ("## 10. Otra sección") tras el hueco corta el escaneo — no arrastra la tabla de otra sección', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |

## 10. Otra sección

| Cosa | Valor |
|---|---|
| x | y |
`
    const r = analyzeSlicesTable(spec)
    expect(r.rowsAfterGap).toEqual([])
    expect(r.slices).toHaveLength(1)
  })

  it('prosa (no tabla) después de la tabla, sin más filas → rowsAfterGap: [] (no es falso positivo)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |

Texto normal después de la tabla, sin más filas.
`
    const r = analyzeSlicesTable(spec)
    expect(r.rowsAfterGap).toEqual([])
    expect(r.slices).toHaveLength(1)
  })
})

// 4 — solo se validaba la cabecera, nunca las celdas: una fila con la
// celda "Entrega" vacía, o con menos celdas que la cabecera (típicamente
// porque a esa misma fila le faltan celdas finales), parseaba igual y
// producía un issue titulado "#N" a secas, sin AC ni deps, exit 0. Mismo
// resultado observable que "falta la columna Entrega entera" — solo que
// por fila. Se reporta en `invalidRows` y la fila NO se agrega a `slices`.
describe('analyzeSlicesTable — celda "Entrega" vacía o fila más corta que la cabecera (4)', () => {
  it('celda Entrega vacía se reporta en invalidRows y no se cuela en slices', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui |  | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toHaveLength(1)
    expect(r.invalidRows[0].n).toBe(1)
    expect(r.slices).toEqual([])
  })

  it('fila con menos celdas que la cabecera se reporta en invalidRows y no se cuela en slices', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui |
| 2 | b | ui | y | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toHaveLength(1)
    expect(r.invalidRows[0].n).toBe(1)
    expect(r.slices).toHaveLength(1) // la fila 2, completa, sí se parsea
    expect(r.slices[0].n).toBe(2)
  })

  it('fila completa y válida no aparece en invalidRows', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toEqual([])
  })
})

// 5 — las deps no se contrastaban contra los slices que existen de verdad
// en la tabla: "#99" en una tabla de 3 slices, o "#3" en el propio slice 3
// (auto-referencia, nunca legítima), parseaban y llegarían a GitHub como
// `merge-after` — un grafo equivocado escrito en los issues, aunque el
// dispatcher lo acabe reportando como deps-unmet en vez de fallar en
// silencio del todo.
describe('analyzeSlicesTable — Dep apunta a un slice inexistente o a sí mismo (5)', () => {
  it('auto-referencia (slice #3 depende de #3) se reporta en invalidDepRefs', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | #1 | – | – |
| 3 | c | ui | z | #3 | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidDepRefs).toHaveLength(1)
    expect(r.invalidDepRefs[0]).toMatchObject({ n: 3, dep: 3, reason: 'self' })
  })

  it('referencia a un "#" que no existe en la tabla (3 slices, #99) se reporta en invalidDepRefs', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | #99 | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidDepRefs).toHaveLength(1)
    expect(r.invalidDepRefs[0]).toMatchObject({ n: 2, dep: 99, reason: 'unknown' })
  })

  it('deps válidas (apuntan a slices existentes, distintos de sí mismas) → invalidDepRefs: []', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | #1 | – | – |
| 3 | c | ui | z | #1, #2 | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidDepRefs).toEqual([])
  })
})

// 6 — una celda Área/Toca que normaliza a cadena vacía (p.ej. "area:" sin
// nada detrás del prefijo, o "???" sin ningún carácter label-safe) se
// descartaba con `.filter(Boolean)` sin avisar. El caso de columna AUSENTE
// sí avisa ("la maquinaria de colisión queda inerte"); el de celda vaciada
// producía la misma inercia y callaba — incoherente con el propio estándar
// de este cambio.
describe('analyzeSlicesTable — token Área/Toca que normaliza a vacío se avisa (6)', () => {
  it('"area:" solo (nada tras el prefijo) → token vacío, no se cuela en area[], se avisa en emptyTokenWarnings', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | area: | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices[0].area).toEqual([])
    expect(r.emptyTokenWarnings).toHaveLength(1)
    expect(r.emptyTokenWarnings[0]).toMatchObject({ column: 'Área', n: 1 })
  })

  it('"???" en Toca (sin ningún carácter label-safe) → token vacío, se avisa', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | – | ??? |
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices[0].touches).toEqual([])
    expect(r.emptyTokenWarnings).toHaveLength(1)
    expect(r.emptyTokenWarnings[0]).toMatchObject({ column: 'Toca', n: 1 })
  })

  it('celda vacía o "–" (forma legítima de "sin valor") NO cuenta como token vacío', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | – |  |
`
    const r = analyzeSlicesTable(spec)
    expect(r.emptyTokenWarnings).toEqual([])
  })
})

// "no se encontró la tabla §9" debía distinguir "no hay ninguna tabla
// markdown en absoluto" de "hay filas de tabla, pero ninguna cabecera con
// Slice/Dep" — el propio detector ya sabe cuál de las dos pasó.
describe('analyzeSlicesTable — distingue "no hay tabla" de "hay tabla sin cabecera Slice/Dep"', () => {
  it('sin ninguna línea "|" en el spec → pipeRowsFound: false', () => {
    const r = analyzeSlicesTable('# spec sin tabla, solo prosa')
    expect(r.tableFound).toBe(false)
    expect(r.pipeRowsFound).toBe(false)
  })

  it('hay filas de tabla markdown, pero ninguna cabecera con "Slice"/"Dep" → pipeRowsFound: true', () => {
    const spec = `## 9. Algo\n| Foo | Bar |\n|---|---|\n| 1 | 2 |\n`
    const r = analyzeSlicesTable(spec)
    expect(r.tableFound).toBe(false)
    expect(r.pipeRowsFound).toBe(true)
  })
})
