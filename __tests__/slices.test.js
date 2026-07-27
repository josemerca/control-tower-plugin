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

  // F3: el título del issue ya no sale de "Entrega" (ahora sale de "Slice",
  // ver más abajo) — "Entrega" pasa a ser una columna OPCIONAL (se convierte
  // en la sección "Descripción" del cuerpo, ver groom.js#buildIssueBody).
  // Este test antes esperaba que la columna ausente abortara (
  // missingRequiredColumns); ahora debe degradar como Tipo/Acepta/Protegido/
  // Área/Toca: se avisa (missingOptionalColumns), la tabla se sigue
  // parseando.
  it('columna "Entrega" ausente → missingOptionalColumns la incluye (F3: ya no es obligatoria), y la fila se sigue parseando', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Dep | Acepta | Protegido |
|---|---|---|---|---|---|
| 1 | x | backend | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.missingRequiredColumns).toEqual([])
    expect(r.missingOptionalColumns).toContain('Entrega')
    expect(r.slices).toHaveLength(1)
    expect(r.slices[0].entrega).toBe('')
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
// celda obligatoria vacía, o con menos celdas que la cabecera (típicamente
// porque a esa misma fila le faltan celdas finales), parseaba igual y
// producía un issue titulado "#N" a secas, sin AC ni deps, exit 0. Mismo
// resultado observable que "falta la columna entera" — solo que por fila.
// Se reporta en `invalidRows` y la fila NO se agrega a `slices`.
//
// F3: la celda con contenido obligatorio pasó de "Entrega" a "Slice" (el
// título del issue ahora sale de ahí) — "Entrega" vacía ya no invalida
// nada (ver el describe de más arriba sobre F3), así que este test se
// reescribe sobre "Slice" en vez de "Entrega".
describe('analyzeSlicesTable — celda "Slice" vacía o fila más corta que la cabecera (4, actualizado por F3)', () => {
  it('celda Slice vacía se reporta en invalidRows y no se cuela en slices', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 |  | ui | y | – | – | – |
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

// ============================================================================
// Review round 2/5 — el defecto de los prefijos seguía vivo una capa por
// debajo (split por comas antes de limpiar marcado), el heurístico de fin de
// tabla abortaba specs válidos, y 3 caminos silenciosos más.
// ============================================================================

// CRITICAL — slices.js hacía el split por comas ANTES de stripInlineMarkup,
// así que marcado que envuelve la CELDA COMPLETA (en vez de cada token)
// sobrevivía. Las listas por comas son el uso documentado normal
// (commands/ct-groom.md: "db, migration"), no un caso raro — y un autor que
// ya demostró envolver valores en negrita/backticks (F1: "**S1**") envuelve
// igual de fácil la celda entera de una lista.
describe('parseSlices — marcado que envuelve la CELDA COMPLETA de una lista por comas (review round 2, CRITICAL)', () => {
  it('negrita envolviendo "area:medicacion, area:otro" completo → ambos tokens sin duplicar el prefijo', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | **area:medicacion, area:otro** | – |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion', 'otro'])
  })

  it('backticks envolviendo "touches:pbxproj, touches:otro" completo → ambos tokens sin duplicar el prefijo', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | x | backend | y | – | – | – | – | `touches:pbxproj, touches:otro` |\n'
    const s = parseSlices(spec)
    expect(s[0].touches).toEqual(['pbxproj', 'otro'])
  })

  it('regresión exacta del ejemplo de la review: ambas columnas envueltas a la vez, ninguna label duplica el prefijo', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | x | backend | y | – | – | – | **area:medicacion, area:otro** | `touches:pbxproj, touches:otro` |\n'
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion', 'otro'])
    expect(s[0].touches).toEqual(['pbxproj', 'otro'])
    expect(s[0].area).not.toContain('areamedicacion')
    expect(s[0].touches).not.toContain('touchespbxproj')
  })

  it('sin marcado envolviendo la celda, listas por comas normales siguen funcionando (no regresión del uso documentado)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | modelo | backend | tabla users | – | AC-1.1 | schema | api | db, migration |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['api'])
    expect(s[0].touches).toEqual(['db', 'migration'])
  })
})

// IMPORTANTE — HEADING_RE (solo headings ATX "## ...") es demasiado
// estrecho: una regla horizontal, un heading setext, un pseudo-heading en
// negrita, o un "##10." sin espacio, todos markdown corriente, hacían que
// el escaneo post-hueco arrastrara la tabla de OTRA sección y abortara con
// un ejemplo de la tabla equivocada. Fix barato: tras un hueco, si la
// siguiente fila con "|" es inmediatamente seguida de una fila separadora
// (cabecera + separador de una tabla nueva), se corta el escaneo sin
// contarla como continuación — los 4 falsos positivos tienen esa forma; el
// salto de línea a mitad de LA MISMA tabla (caso real) no.
describe('analyzeSlicesTable — el escaneo post-hueco no arrastra una tabla ajena (review round 2, IMPORTANTE)', () => {
  it('regla horizontal ("---") antes de una tabla no relacionada, SIN heading markdown entre medias → no aborta', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |

---

| Cosa | Valor |
|---|---|
| x | y |
`
    const r = analyzeSlicesTable(spec)
    expect(r.rowsAfterGap).toEqual([])
    expect(r.skippedRows).toEqual([])
    expect(r.slices).toHaveLength(1)
  })

  it('heading setext ("Riesgos" + subrayado "-------") antes de una tabla ajena → no aborta', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |

Riesgos
-------

| Cosa | Valor |
|---|---|
| x | y |
`
    const r = analyzeSlicesTable(spec)
    expect(r.rowsAfterGap).toEqual([])
    expect(r.slices).toHaveLength(1)
  })

  it('pseudo-heading en negrita ("**10. Riesgos**") antes de una tabla ajena → no aborta', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |

**10. Riesgos**

| Cosa | Valor |
|---|---|
| x | y |
`
    const r = analyzeSlicesTable(spec)
    expect(r.rowsAfterGap).toEqual([])
    expect(r.slices).toHaveLength(1)
  })

  it('"##10." sin espacio tras las almohadillas antes de una tabla ajena → no aborta', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |

##10.Riesgos

| Cosa | Valor |
|---|---|
| x | y |
`
    const r = analyzeSlicesTable(spec)
    expect(r.rowsAfterGap).toEqual([])
    expect(r.slices).toHaveLength(1)
  })

  it('el caso REAL (línea en blanco a mitad de LA MISMA tabla) sigue disparando rowsAfterGap — no se ha perdido el true positive', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | primero | – | – | – |

| 2 | b | ui | segundo | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.rowsAfterGap).toHaveLength(1)
    expect(r.rowsAfterGap[0].raw).toContain('segundo')
    expect(r.slices).toHaveLength(2)
  })
})

// a) Fila MÁS LARGA que la cabecera (un "|" sin escapar dentro de una celda
// desplaza las columnas siguientes en silencio) — antes solo se comprobaba
// "menos celdas", nunca "más".
describe('analyzeSlicesTable — fila con MÁS celdas que la cabecera (desplazamiento de columnas) (review round 2, a)', () => {
  it('una fila con más celdas que la cabecera se reporta en invalidRows, no se cuela en slices con columnas desplazadas', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – | med | icacion | pbx |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toHaveLength(1)
    expect(r.invalidRows[0].n).toBe(1)
    expect(r.slices).toEqual([]) // no se cuela con area:['med']/touches:['icacion'] y "pbx" perdido
  })
})

// b) "Entrega" con un marcador de "nada" (–, -, —, etc.) → título de issue
// "#1 –", exit 0 — la única columna donde el contenido es obligatorio
// trataba "aquí no hay nada" como si fuera un título válido.
//
// F3: el título ya no sale de "Entrega" — sale de "Slice" (ver más abajo).
// "Entrega" pasa a ser opcional (Descripción del cuerpo), así que un
// marcador de "sin valor" ahí ya NO invalida la fila: significa "sin
// descripción", exactamente como en Acepta/Protegido/Área/Toca. La misma
// exigencia de contenido real se traslada a "Slice", que es de donde sale
// el título ahora.
describe('analyzeSlicesTable — "Entrega" con un marcador de "sin valor" ya NO invalida la fila (F3: contenido obligatorio se movió a "Slice")', () => {
  it('"Entrega" = "–" (Slice con contenido real) ya no aborta la fila — "sin descripción", no "sin título"', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | – | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toEqual([])
    expect(r.slices).toHaveLength(1)
    expect(r.slices[0].entrega).toBe('–')
  })

  it('"Slice" = "–" (marcador de "sin valor") SÍ invalida la fila — es de ahí de donde sale el título ahora', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | – | ui | y | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toHaveLength(1)
    expect(r.slices).toEqual([])
  })
})

// c) Marcador de "nada" ENVUELTO en marcado ("`–`", "**–**") en Dep — misma
// forma que el CRITICAL del em dash: isNoValueCell corría sobre la celda
// cruda, así que el autor que ya demostró envolver valores en marcado
// recibía el mensaje "si no hay dependencias, escribe –" por escribir
// EXACTAMENTE eso, solo que envuelto.
describe('analyzeSlicesTable — marcador de "nada" envuelto en marcado (review round 2, c)', () => {
  it('"`–`" (backtick) en Dep no es malformado — deps: []', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |\n' +
      '|---|---|---|---|---|---|---|\n' +
      '| 1 | a | ui | x | `–` | – | – |\n'
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
    expect(r.slices[0].deps).toEqual([])
  })

  it('"**–**" (negrita) en Dep no es malformado — deps: []', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | **–** | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
    expect(r.slices[0].deps).toEqual([])
  })

  it('"**–**" (negrita) en Acepta también cuenta como "sin AC" (mismo isNoValueCell compartido)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | **–** | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices[0].ac).toEqual([])
  })
})

// Menor — el signo menos matemático (−, U+2212) y el doble-guion ("--") son
// salidas plausibles de autocorrección de teclado/editor, igual que el
// em dash.
describe('analyzeSlicesTable — signo menos (−, U+2212) y doble-guion ("--") también significan "sin valor" (menor)', () => {
  it('signo menos U+2212 en Dep no es malformado', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | − | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
  })

  it('doble-guion "--" en Dep no es malformado', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | -- | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
  })
})

// ============================================================================
// Review round 3/5 — el Critical del prefijo, tercera vez. Las dos rondas
// anteriores parcheaban por CAPA (bordes de la celda completa, luego bordes
// de cada pieza), y cada parche tapaba una forma de marcado y dejaba otra
// sin cubrir según en qué posición cayera. Reproducido por el coordinador a
// la primera con cada token envuelto en SU PROPIO backtick — el split
// partía "`area:hoy" y "area:web`" y ninguno de los dos empezaba/terminaba
// con el mismo backtick por separado, así que el segundo token seguía
// fallando.
//
// Enfoque nuevo: normalizar de un tirón, no por capas. Backtick (`) y
// asterisco (*) NUNCA son legítimos dentro de un token de label, así que se
// quitan GLOBALMENTE de la celda completa —en cualquier posición, sin
// intentar detectar "pares que envuelven"— antes de partir por comas.
// Guion bajo (_) SÍ es legítimo dentro de un token (normalizeToken ya lo
// permite, p.ej. "mi_token"), así que ESE se quita solo en los bordes de
// cada token, después del split, no globalmente.
describe('parseSlices — normalización de marcado en un solo paso, no por capas (review round 3)', () => {
  it('REPRODUCCIÓN EXACTA del coordinador: cada token envuelto en su PROPIO backtick — "`area:hoy`, `area:web`"', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | x | backend | y | – | – | – | `area:hoy`, `area:web` | – |\n'
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['hoy', 'web'])
    expect(s[0].area).not.toContain('areaweb')
  })

  it('las cuatro formas de marcado, en la MISMA tabla, todas producen labels limpias (cierra la clase, no un caso)', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | celda entera envuelta | backend | y | – | – | – | **area:medicacion, area:otro** | – |\n' +
      '| 2 | cada token envuelto | backend | y | – | – | – | `area:hoy`, `area:web` | – |\n' +
      '| 3 | mezcla | backend | y | – | – | – | **area:x**, `area:y` | – |\n' +
      '| 4 | envoltura anidada | backend | y | – | – | – | `**area:z**` | – |\n'
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion', 'otro']) // celda entera envuelta
    expect(s[1].area).toEqual(['hoy', 'web']) // cada token envuelto
    expect(s[2].area).toEqual(['x', 'y']) // mezcla
    expect(s[3].area).toEqual(['z']) // envoltura anidada
    for (const slice of s) {
      for (const token of slice.area) {
        expect(token).not.toMatch(/^area/) // ninguno debe conservar el prefijo duplicado ("areax", "areahoy", etc.)
      }
    }
  })

  it('control negativo: "areas-comunes" (guion) y un token con guion bajo INTERNO ("mi_token") sobreviven intactos', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | areas-comunes | mi_token |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['areas-comunes'])
    expect(s[0].touches).toEqual(['mi_token'])
  })

  it('guion bajo de énfasis SÍ se quita en los bordes del token ("_area:medicacion_"), sin tocar el interno de otro token en la misma celda', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | x | backend | y | – | – | – | _area:medicacion_, mi_token | – |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion', 'mi_token'])
  })

  it('marcador de "sin valor" (Dep) envuelto en backtick por token único sigue reconociéndose (isNoValueCell con el mismo enfoque de un paso)', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |\n' +
      '|---|---|---|---|---|---|---|\n' +
      '| 1 | a | ui | x | `–` | – | – |\n'
    const r = analyzeSlicesTable(spec)
    expect(r.malformedDepRows).toEqual([])
    expect(r.slices[0].deps).toEqual([])
  })
})

// ============================================================================
// Review round 4/5 (última de F1) — dos cosas que corrompen datos:
//
// 1. REGRESIÓN NUEVA de la round 3: la eliminación de guion bajo por bordes
//    (^_+ / _+$) no distingue un PAR de énfasis (_x_, __x__) de un guion
//    bajo inicial/final SIN pareja — que es exactamente cómo empiezan
//    "_layout.tsx"/"_app.tsx" (Expo Router, Next.js) y "__init__.py"
//    (Python), y cómo puede terminar "trailing_". El token ES la clave de
//    colisión de claim.js#tokensOf (comparación exacta), así que corromper
//    "_layout.tsx" en "layout.tsx" produce colisiones falsas.
//
// 2. La clase de envoltorios estaba más ancha que backtick/asterisco/guion
//    bajo: cualquier carácter no alfanumérico ANTES de "area:" (~~, comillas
//    rectas, paréntesis, enlaces markdown...) reproducía el defecto
//    original, porque stripColumnPrefix exigía el prefijo en el índice 0.
//    Fix: invertir el enfoque — stripColumnPrefix salta los caracteres NO
//    alfanuméricos iniciales SOLO para detectar el prefijo (sin mutar), y
//    devuelve la cadena ORIGINAL sin tocar si no encuentra ningún prefijo
//    ahí. Así deja de depender de qué envoltorio use el autor, sin destruir
//    contenido cuando no hay prefijo.
// ============================================================================

describe('parseSlices — guion bajo se quita SOLO si está emparejado simétricamente (review round 4, issue 1: regresión)', () => {
  it('control negativo de nombres de fichero: sobreviven INTACTOS (falla si se vuelve a ^_+/_+$ asimétrico)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | a | backend | y | – | – | – | – | _layout.tsx |
| 2 | b | backend | y | – | – | – | – | _app.tsx |
| 3 | c | backend | y | – | – | – | – | __init__.py |
| 4 | d | backend | y | – | – | – | – | trailing_ |
| 5 | e | backend | y | – | – | – | – | mi_token_largo |
| 6 | f | backend | y | – | – | – | areas-comunes | – |
`
    const s = parseSlices(spec)
    expect(s[0].touches).toEqual(['_layout.tsx'])
    expect(s[1].touches).toEqual(['_app.tsx'])
    expect(s[2].touches).toEqual(['__init__.py']) // la señal delatora: NUNCA "init__.py"
    expect(s[3].touches).toEqual(['trailing_'])
    expect(s[4].touches).toEqual(['mi_token_largo'])
    expect(s[5].area).toEqual(['areas-comunes'])
  })

  it('guion bajo emparejado simétricamente (_x_, __x__) SÍ se quita — énfasis markdown real', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | a | backend | y | – | – | – | _area:medicacion_ | __touches:pbxproj__ |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['medicacion'])
    expect(s[0].touches).toEqual(['pbxproj'])
  })

  it('"___" (solo guiones bajos, número impar) ya no desaparece en silencio: sobrevive como contenido, no se avisa (nada que avisar)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | a | backend | y | – | – | – | ___ | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices[0].area).toEqual(['_'])
    expect(r.emptyTokenWarnings).toEqual([])
  })
})

describe('parseSlices — stripColumnPrefix invertido: detecta el prefijo saltando basura inicial, sin destruir cuando no hay prefijo (review round 4, issue 2)', () => {
  it('la matriz de envoltorios (backtick, asterisco, guion bajo emparejado, ~~, comillas rectas, paréntesis, anidados) — todos producen labels limpias, sin duplicar el prefijo, en la MISMA tabla', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | backtick | backend | y | – | – | – | `area:med` | – |\n' +
      '| 2 | asterisco | backend | y | – | – | – | **area:med** | – |\n' +
      '| 3 | guion bajo | backend | y | – | – | – | _area:med_ | – |\n' +
      '| 4 | tachado | backend | y | – | – | – | ~~area:med~~ | – |\n' +
      '| 5 | comillas rectas | backend | y | – | – | – | "area:med" | – |\n' +
      '| 6 | parentesis | backend | y | – | – | – | (area:med) | – |\n' +
      '| 7 | anidado | backend | y | – | – | – | `**area:med**` | – |\n'
    const s = parseSlices(spec)
    for (const slice of s) {
      expect(slice.area).toEqual(['med'])
    }
  })

  it('control negativo del propio invertido: "areas-comunes" (empieza como "area" pero no es el marcador "area:") no se mutila', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | a | backend | y | – | – | – | areas-comunes | – |
`
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['areas-comunes'])
  })

  it('reproducción del coordinador (round 3, ya cerrada): cada token en su propio backtick sigue funcionando con el nuevo enfoque invertido', () => {
    const spec = '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | x | backend | y | – | – | – | `area:hoy`, `area:web` | – |\n'
    const s = parseSlices(spec)
    expect(s[0].area).toEqual(['hoy', 'web'])
  })
})

describe('analyzeSlicesTable — un token que legítimamente acaba vacío siempre avisa, incluso pasando por el paso de guion bajo (review round 4, issue 3)', () => {
  it('"_~~_" (par de guion bajo envolviendo solo un tachado, sin ningún carácter label-safe) acaba vacío y SÍ avisa — la garantía de F1 se mantiene tras el paso de guion bajo', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | a | backend | y | – | – | – | _~~_ | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices[0].area).toEqual([])
    expect(r.emptyTokenWarnings).toHaveLength(1)
    expect(r.emptyTokenWarnings[0]).toMatchObject({ column: 'Área', n: 1 })
  })
})

// ============================================================================
// F3 — el título del issue viene de la celda equivocada. buildIssueTitle
// (groom.js) componía "#N <Entrega>" mientras el texto de "Slice" se
// descartaba (solo se le extraía un "#NN" hacia `slice.issue`) — un autor
// que escribe lo natural (nombre corto en Slice, descripción en Entrega)
// recibía un párrafo entero como título del issue. Decisión: el título sale
// de "Slice" (`#N <Slice>`); "Slice" pasa a ser CONTENIDO OBLIGATORIO (igual
// de obligatorio que "Entrega" lo era antes); "Entrega" pasa a ser opcional
// y se convierte en una descripción dentro del cuerpo (ver groom.test.js).
// `slice.name` es el texto de "Slice" ya limpio de cualquier referencia
// "#NN" (que sigue extrayéndose, aparte, hacia `slice.issue` como siempre)
// — así el título nunca arrastra un hash colgante cuando la celda Slice
// trae AMBAS cosas (un nombre y una referencia de issue) a la vez.
// ============================================================================

describe('analyzeSlicesTable/parseSlices — "Slice" alimenta slice.name (título del issue) (F3)', () => {
  it('Slice sin ningún "#NN" → name es el texto tal cual, issue null', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login model | backend | modelo de sesión | – | – | – |
`
    const s = parseSlices(spec)
    expect(s[0].name).toBe('login model')
    expect(s[0].issue).toBeNull()
  })

  it('Slice con nombre y una referencia "#NN" a la vez → issue extrae "#NN", name queda SIN esa referencia (sin hash colgante en el título)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | #42 notifications | backend | motor de notificaciones | – | – | – |
`
    const s = parseSlices(spec)
    expect(s[0].issue).toBe('#42')
    expect(s[0].name).toBe('notifications')
    expect(s[0].name).not.toMatch(/#/)
  })

  it('Slice con la referencia "#NN" en medio del texto → se quita solo el hash, el resto del nombre sobrevive sin dobles espacios', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login #7 model | backend | y | – | – | – |
`
    const s = parseSlices(spec)
    expect(s[0].issue).toBe('#7')
    expect(s[0].name).toBe('login model')
  })

  it('la celda "Slice" sigue reconociendo el marcador de "sin valor" (–) como vacía (invalida la fila)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | – | ui | y | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toHaveLength(1)
    expect(r.slices).toEqual([])
  })

  it('Slice que SOLO trae "#7" (sin ningún nombre alrededor) → name queda vacío tras quitar el hash → fila inválida (no hay título fiable)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | #7 | ui | y | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toHaveLength(1)
    expect(r.invalidRows[0].reason).toMatch(/Slice/)
    expect(r.slices).toEqual([])
  })

  it('fila válida (Slice con contenido) no aparece en invalidRows, y "entrega" se sigue poblando desde la columna Entrega, sin cambios', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo de sesión | – | – | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.invalidRows).toEqual([])
    expect(r.slices[0].name).toBe('login')
    expect(r.slices[0].entrega).toBe('modelo de sesión')
  })
})

// F6, importante 3: el contrato dice "Acepta: criterios coma-separados" y no
// avisa de que una coma DENTRO de un criterio lo trocea en silencio. Y la
// cabecera de la sección que genera es literalmente "Acceptance criteria
// (EARS, 1:1 con tests)": la sintaxis EARS ("Cuando <trigger>, el sistema
// debe <respuesta>") lleva coma casi siempre, así que no es un caso raro —
// es la forma natural de escribir esta columna. Se soporta un escape (`\,`)
// y se declara en el contrato (ct-init.sh).
describe('analyzeSlicesTable — "Acepta": coma escapada (\\,) NO trocea el criterio (F6, importante 3)', () => {
  it('una coma escapada se conserva como parte del criterio, y no cuenta como separador', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | x | – | Cuando el token caduca\\, el sistema pide login | – |
`
    const r = analyzeSlicesTable(spec)
    expect(r.slices[0].ac).toEqual(['Cuando el token caduca, el sistema pide login'])
  })
  it('coma SIN escapar sigue separando criterios (comportamiento de siempre)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | x | – | AC-1.1, AC-1.2 | – |
`
    expect(analyzeSlicesTable(spec).slices[0].ac).toEqual(['AC-1.1', 'AC-1.2'])
  })
  it('mezcla: separadores reales + una coma escapada dentro de un criterio', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | x | – | AC-1.1, Cuando A\\, entonces B, AC-1.3 | – |
`
    expect(analyzeSlicesTable(spec).slices[0].ac).toEqual(['AC-1.1', 'Cuando A, entonces B', 'AC-1.3'])
  })
  it('una barra invertida que no precede a una coma se conserva tal cual (no se come el escape de nadie)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | x | – | ruta C:\\Users existe | – |
`
    expect(analyzeSlicesTable(spec).slices[0].ac).toEqual(['ruta C:\\Users existe'])
  })
  // Las OTRAS celdas que el contrato llama "coma-separadas" (comprobado
  // columna por columna, F6): "Protegido" NO se trocea por comas en absoluto
  // (es texto libre de una sola pieza), "Dep" no se trocea tampoco (se
  // extraen las referencias "#N" con una regex, así que una coma dentro no
  // cambia nada), y "Área"/"Toca" SÍ se trocean pero sus valores son tokens
  // de label donde la coma se descarta igualmente al normalizar — así que un
  // escape ahí no significaría nada. Solo "Acepta" tenía el problema.
  it('"Protegido" no se trocea por comas (texto libre de una pieza)', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | x | – | AC-1.1 | schema, migraciones y CI |
`
    expect(analyzeSlicesTable(spec).slices[0].protected).toBe('schema, migraciones y CI')
  })
  it('"Dep" con comas entre referencias no depende del split: las #N se extraen igual', () => {
    const spec = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | backend | x | – | – | – |
| 2 | b | backend | x | – | – | – |
| 3 | c | backend | x | #1 (tras el merge), #2 | – | – |
`
    expect(analyzeSlicesTable(spec).slices[2].deps).toEqual([1, 2])
  })
})
