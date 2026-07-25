import { describe, it, expect } from 'vitest'
import { extractAc, extractOrder, mapGhIssue, filterMergedIssues, buildOrderIndex, buildDispatchInput } from '../scripts/gh-issue-map.js'
import { selectNext } from '../scripts/dispatch.js'
import { buildIssueBody } from '../scripts/groom.js'

describe('mapGhIssue — defensivo con labels/marcadores ausentes', () => {
  it('sin marcador ct-order en el body → order cae a i.number', () => {
    const mapped = mapGhIssue({ number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: 'sin marcador' })
    expect(mapped.order).toBe(42)
    expect(mapped.n).toBe(42)
  })
  it('sin label status: → status cae a "backlog"', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'type:backend' }], body: '' })
    expect(mapped.status).toBe('backlog')
  })
  it('sin labels touches: → touches es []', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:ready' }], body: '' })
    expect(mapped.touches).toEqual([])
  })
  // Finding 5 de la review final: gh-issue-map.js#mapGhIssue solo miraba
  // `touches:`, dropeando `area:` por completo, mientras claim.js#tokensOf ya
  // trataba ambos prefijos como igual-de-relevantes para colisión (spec §14:
  // conflicto = token `area:` O `touches:` compartido). Consecuencia real:
  // ct-next.mjs podía co-despachar dos slices que solo comparten un `area:`
  // (p.ej. `area:api` en ambos) sin detectarlo en la selección — worktrees y
  // agentes ya lanzados — y solo dispatch-check.mjs lo rechazaba después.
  it('con label area: (sin touches:) → también entra en touches, igual que claim.js#tokensOf', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'area:api' }], body: '' })
    expect(mapped.touches).toEqual(['api'])
  })
  it('con area: Y touches: a la vez → ambos entran, cada uno pelado de su propio prefijo', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'area:api' }, { name: 'touches:db' }], body: '' })
    expect(mapped.touches).toEqual(['api', 'db'])
  })
  it('sin label type: → type es cadena vacía, no el literal "type:"', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:ready' }], body: '' })
    expect(mapped.type).toBe('')
  })
  it('body vacío/ausente → deps [] y ac []', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body: '' })
    expect(mapped.deps).toEqual([])
    expect(mapped.ac).toEqual([])
    const mapped2 = mapGhIssue({ number: 1, title: '#1 x', labels: [] })
    expect(mapped2.deps).toEqual([])
    expect(mapped2.ac).toEqual([])
  })
  it('con marcador ct-order y merge-after → order/deps correctos', () => {
    const body = 'algo\n<!-- ct-order:7 -->\nmerge-after #3, merge-after #4'
    const mapped = mapGhIssue({ number: 99, title: '#99 x', labels: [], body })
    expect(mapped.order).toBe(7)
    expect(mapped.deps).toEqual([3, 4])
  })
  it('entrega: quita el prefijo "#N " del título', () => {
    const mapped = mapGhIssue({ number: 5, title: '#5 refresh token', labels: [], body: '' })
    expect(mapped.entrega).toBe('refresh token')
  })
  it('issue: siempre "#<number>", nunca undefined', () => {
    const mapped = mapGhIssue({ number: 5, title: '#5 x', labels: [], body: '' })
    expect(mapped.issue).toBe('#5')
  })
})

describe('extractAc', () => {
  it('sin sección "## Acceptance criteria" → []', () => {
    expect(extractAc('cualquier body sin esa sección')).toEqual([])
    expect(extractAc('')).toEqual([])
    expect(extractAc(null)).toEqual([])
  })
  it('con bloque AC → extrae cada línea "- ..."', () => {
    const body = '## Acceptance criteria (EARS, 1:1 con tests)\n- AC-7.1 algo\n- AC-7.2 otro\n\n## Dependencias\n- merge-after #1'
    expect(extractAc(body)).toEqual(['AC-7.1 algo', 'AC-7.2 otro'])
  })
  it('placeholder "(rellenar desde el spec)" no cuenta como AC real', () => {
    const body = '## Acceptance criteria (EARS, 1:1 con tests)\n- (rellenar desde el spec)\n\n## Dependencias'
    expect(extractAc(body)).toEqual([])
  })
  it('bloque AC es la última sección del body (sin encabezado siguiente) → también se extrae', () => {
    const body = '## Acceptance criteria (EARS, 1:1 con tests)\n- AC-1 único'
    expect(extractAc(body)).toEqual(['AC-1 único'])
  })
})

describe('mapGhIssue + groom.js#buildIssueBody — ata las dos piezas (detecta deriva de formato)', () => {
  it('un body generado por el buildIssueBody real de ct-groom se mapea correctamente', () => {
    const slice = { n: 7, entrega: 'refresh token', ac: ['AC-7.1 algo', 'AC-7.2 otro'], deps: [1, 2], protected: '–' }
    const body = buildIssueBody(slice, { specPath: 'spec.md', specSection: '9' })
    const mapped = mapGhIssue({ number: 55, title: '#55 refresh token', labels: [{ name: 'status:ready' }, { name: 'type:backend' }], body })
    expect(mapped.order).toBe(7) // <!-- ct-order:7 --> generado por buildIssueBody
    expect(mapped.deps).toEqual([1, 2])
    expect(mapped.ac).toEqual(['AC-7.1 algo', 'AC-7.2 otro'])
    expect(mapped.status).toBe('ready')
    expect(mapped.type).toBe('backend')
  })
})

// T10: en el sandbox real, groom.js crea issues en orden §9 pero GitHub les
// asigna sus propios números de issue — que NO coinciden con el orden. Orden
// 1 = issue #2, orden 2 = issue #3. Los bodies llevan `merge-after #1`
// (orden), pero mergedIssues son NÚMEROS DE ISSUE reales. Sin traducir,
// `deps.every(d => merged.has(d))` compara dos espacios distintos y deja
// bloqueado para siempre cualquier slice con dependencias — salvo que, por
// casualidad, orden == número de issue (que es exactamente lo que pasaba en
// TODOS los fixtures previos de la suite, por eso el bug nunca se detectó
// aquí). Ver gh-issue-map.js#buildDispatchInput.
describe('extractOrder', () => {
  it('lee el marcador ct-order:N', () => expect(extractOrder('x\n<!-- ct-order:2 -->')).toBe(2))
  it('sin marcador → null', () => expect(extractOrder('sin marcador')).toBeNull())
  it('body vacío/ausente → null', () => {
    expect(extractOrder('')).toBeNull()
    expect(extractOrder(undefined)).toBeNull()
  })
})

describe('buildOrderIndex', () => {
  it('mapea orden → número de issue a partir de bodies crudos', () => {
    const raw = [
      { number: 2, body: '<!-- ct-order:1 -->' },
      { number: 3, body: '<!-- ct-order:2 -->' },
    ]
    const idx = buildOrderIndex(raw)
    expect(idx.get(1)).toBe(2)
    expect(idx.get(2)).toBe(3)
  })
  it('issues sin marcador no entran en el índice (no hay orden que indexar)', () => {
    const idx = buildOrderIndex([{ number: 9, body: 'sin marcador' }])
    expect(idx.has(9)).toBe(false)
    expect(idx.size).toBe(0)
  })
  it('defensivo: entrada vacía/ausente no revienta', () => {
    expect(buildOrderIndex([]).size).toBe(0)
    expect(buildOrderIndex(undefined).size).toBe(0)
  })
})

describe('buildDispatchInput — reproduce y fija el mismatch orden/issue del sandbox (T10)', () => {
  it('escenario exacto del sandbox: orden 1=#2 (mergeado), orden 2=#3 (ready, dep orden 1) → #3 queda despachable', () => {
    // #2 (orden 1) ya está cerrado y mergeado.
    const closed = [{ number: 2, stateReason: 'COMPLETED', body: '<!-- ct-order:1 -->' }]
    // #3 (orden 2) sigue abierto, ready, con dep declarada como "merge-after #1" (ORDEN, no issue).
    const open = [{
      number: 3, title: '#3 endpoint', labels: [{ name: 'status:ready' }],
      body: 'algo\n## Dependencias\n- merge-after #1\n\n<!-- ct-order:2 -->',
    }]
    const { issues, mergedIssues } = buildDispatchInput(open, closed)
    expect(mergedIssues).toEqual([2]) // número de issue real, no orden
    const mapped = issues.find((i) => i.n === 3)
    expect(mapped.deps).toEqual([2]) // traducido: orden 1 → issue #2, no [1]
    // Prueba end-to-end: con el mismatch sin corregir esto habría dado [].
    const selected = selectNext(issues, { mergedIssues, runningTouches: [], concurrencyCap: 1 })
    expect(selected.map((i) => i.n)).toEqual([3])
  })

  it('sin la traducción, comparar deps (orden) contra mergedIssues (issue) directamente NO selecciona nada (documenta el bug que se arregló)', () => {
    // Mismo escenario, pero replicando el código PRE-fix: mapGhIssue crudo
    // (deps en espacio de orden) comparado sin más contra mergedIssues.
    const openRaw = {
      number: 3, title: '#3 endpoint', labels: [{ name: 'status:ready' }],
      body: 'algo\n## Dependencias\n- merge-after #1\n\n<!-- ct-order:2 -->',
    }
    const mapped = mapGhIssue(openRaw) // deps sigue en espacio de orden: [1]
    expect(mapped.deps).toEqual([1])
    const mergedIssues = filterMergedIssues([{ number: 2, stateReason: 'COMPLETED' }]) // [2]
    const selected = selectNext([mapped], { mergedIssues, runningTouches: [], concurrencyCap: 1 })
    expect(selected).toEqual([]) // bloqueado para siempre sin la traducción — el bug real
  })

  it('dependencia cuyo orden no existe en ningún issue (abierto o cerrado) → null, nunca satisfecha, no revienta', () => {
    const open = [{
      number: 5, title: '#5 algo', labels: [{ name: 'status:ready' }],
      body: 'merge-after #99\n<!-- ct-order:1 -->', // orden 99 no existe en ningún lado
    }]
    const { issues, mergedIssues } = buildDispatchInput(open, [])
    const mapped = issues.find((i) => i.n === 5)
    expect(mapped.deps).toEqual([null])
    expect(() => selectNext(issues, { mergedIssues, runningTouches: [], concurrencyCap: 1 })).not.toThrow()
    expect(selectNext(issues, { mergedIssues, runningTouches: [], concurrencyCap: 1 })).toEqual([])
  })

  it('la dependencia SÍ mergeada resuelve correctamente aunque el issue mergeado ya no esté en la lista de abiertos', () => {
    // buildOrderIndex tiene que ver el body del CERRADO para conocer su orden
    // — si solo indexara abiertos, esta dep quedaría irresoluble en cuanto
    // la dependencia se mergeara (justo cuando queremos que se desbloquee).
    const closed = [{ number: 10, stateReason: 'COMPLETED', body: '<!-- ct-order:1 -->' }]
    const open = [{
      number: 11, title: '#11 x', labels: [{ name: 'status:ready' }],
      body: 'merge-after #1\n<!-- ct-order:2 -->',
    }]
    const { issues, mergedIssues } = buildDispatchInput(open, closed)
    const selected = selectNext(issues, { mergedIssues, runningTouches: [], concurrencyCap: 1 })
    expect(selected.map((i) => i.n)).toEqual([11])
  })
})

// Reproduce el escenario exacto del finding 5 end-to-end: dos issues `ready`
// que solo comparten un label `area:api` (nunca `touches:`) — antes del fix,
// selectNext (que decide qué co-despachar) no veía ese `area:` en absoluto y
// los lanzaba a los dos con cap 2; con el fix, ambos producen el mismo token
// pelado 'api' y la colisión se detecta en la SELECCIÓN, no después.
describe('mapGhIssue + selectNext — colisión por area: compartido se detecta en la selección (finding 5)', () => {
  it('dos issues ready que comparten SOLO area:api → con cap 2 solo se selecciona uno', () => {
    const a = mapGhIssue({ number: 1, title: '#1 a', labels: [{ name: 'status:ready' }, { name: 'area:api' }], body: '<!-- ct-order:1 -->' })
    const b = mapGhIssue({ number: 2, title: '#2 b', labels: [{ name: 'status:ready' }, { name: 'area:api' }], body: '<!-- ct-order:2 -->' })
    const selected = selectNext([a, b], { mergedIssues: [], runningTouches: [], concurrencyCap: 2 })
    expect(selected.map((i) => i.n)).toEqual([1])
  })
})

describe('filterMergedIssues', () => {
  it('stateReason COMPLETED (mayúsculas, enum GraphQL real) → cuenta como mergeado', () => {
    expect(filterMergedIssues([{ number: 1, stateReason: 'COMPLETED' }])).toEqual([1])
  })
  it('stateReason NOT_PLANNED → NO cuenta', () => {
    expect(filterMergedIssues([{ number: 1, stateReason: 'NOT_PLANNED' }])).toEqual([])
  })
  it('stateReason en minúsculas ("completed") → NO cuenta (no existe en la práctica; sin rama muerta)', () => {
    expect(filterMergedIssues([{ number: 1, stateReason: 'completed' }])).toEqual([])
  })
  it('defensivo: entrada vacía/ausente no revienta', () => {
    expect(filterMergedIssues([])).toEqual([])
    expect(filterMergedIssues(undefined)).toEqual([])
  })
})
