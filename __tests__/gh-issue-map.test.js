import { describe, it, expect } from 'vitest'
import { extractAc, extractDeps, extractOrder, extractSpecLink, specLinkAnchor, locateSection, countHeadingLines, detectLineEnding, normalizeToLF, mapGhIssue, filterMergedIssues, buildOrderIndex, buildDispatchInput, AC_HEADING_FORMS } from '../scripts/gh-issue-map.js'
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
  it('name: quita el prefijo "#N " del título', () => {
    const mapped = mapGhIssue({ number: 5, title: '#5 refresh token', labels: [], body: '' })
    expect(mapped.name).toBe('refresh token')
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

// F5 review round 3, CRITICAL 1 — locateSection buscaba la cabecera con una
// regex SIN anclar a inicio de línea y SIN escapar, mientras el terminador
// SÍ estaba anclado (`\n##\s`) — las dos mitades usaban criterios
// distintos. Verificado por construcción (informe del reviewer): una
// mención de "## Dependencias" dentro de una valla de código, a mitad de
// línea, o citada, se confundía con una cabecera real. Estos tests
// reproducen las tres formas exactas del informe.
describe('locateSection — anclado a columna 0 y consciente de vallas de código (review round 3, Critical 1)', () => {
  it('mención inline ("...## Dependencias..." a mitad de línea, dentro de un AC) NO se confunde con la cabecera real', () => {
    const body = [
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-2.1 el body debe traer ## Dependencias cuando hay deps',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '',
      '<!-- ct-order:2 -->',
    ].join('\n')
    const loc = locateSection(body, '## Dependencias')
    expect(loc).not.toBeNull()
    expect(extractDeps(loc.content)).toEqual([1]) // la sección REAL, no la mención inline
    // el AC en sí no se trunca por la mención — sigue completo
    expect(extractAc(body)).toEqual(['AC-2.1 el body debe traer ## Dependencias cuando hay deps'])
  })

  it('cabecera citada ("> ## Dependencias") NO se confunde con la cabecera real', () => {
    const body = [
      '## Descripción',
      '> ## Dependencias (cita de otro issue, no una cabecera real)',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '## Dependencias',
      '- merge-after #3',
      '',
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const loc = locateSection(body, '## Dependencias')
    expect(extractDeps(loc.content)).toEqual([3])
  })

  it('"## Dependencias" dentro de una valla de código cercada (dentro de "## Descripción") NO se confunde con la cabecera real, y la valla sobrevive intacta', () => {
    const body = [
      '## Descripción',
      'Ejemplo de la sección que genera el groom:',
      '```',
      '## Dependencias',
      '- merge-after #99',
      '```',
      'fin del ejemplo.',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const depsLoc = locateSection(body, '## Dependencias')
    expect(extractDeps(depsLoc.content)).toEqual([1]) // la sección REAL, no la de dentro de la valla (#99)

    const descripcionLoc = locateSection(body, '## Descripción')
    // La sección Descripción debe incluir la valla ENTERA (apertura Y cierre) —
    // si el cierre "```" se pierde, el resto del body se renderiza como código.
    expect(descripcionLoc.content).toContain('```\n## Dependencias\n- merge-after #99\n```')
    expect(descripcionLoc.content).toContain('fin del ejemplo.')
    expect(descripcionLoc.content).not.toContain('## Acceptance criteria') // no se comió la siguiente cabecera real
  })
})

// Review round 4 — el reviewer atacó su propio round 3: "arregló las tres
// formas que el review nombró y probó exactamente esas tres; no atacó su
// propio escáner". Estos tests construyen entradas adversarias que nadie
// pidió explícitamente: valla anidada (delimitador más corto del MISMO
// carácter dentro), delimitadores de distinta longitud, "~~~" dentro de
// "```" (carácter DISTINTO), valla sin cerrar, y cabecera con sufijo para
// las secciones que NO deberían tolerarlo.
describe('locateSection / stepFence — CommonMark real: cierra solo con MISMO carácter y longitud >= apertura (review round 4, Critical 1)', () => {
  it('un delimitador MÁS CORTO del mismo carácter (``` dentro de una valla abierta con ````) NO cierra — la sección real más allá se localiza bien', () => {
    const body = [
      '## Descripción',
      'Ejemplo (round 4): una valla de 4 backticks que contiene, como parte',
      'del propio ejemplo, un bloque de 3 backticks con la cabecera real dentro:',
      '````',
      '```',
      '## Dependencias',
      '- merge-after #99',
      '```',
      '````',
      'fin del ejemplo real.',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const depsLoc = locateSection(body, '## Dependencias')
    expect(extractDeps(depsLoc.content)).toEqual([1]) // la sección REAL, no la del ejemplo anidado (#99)
    const descripcionLoc = locateSection(body, '## Descripción')
    expect(descripcionLoc.content).toContain('````\n```\n## Dependencias\n- merge-after #99\n```\n````')
    expect(descripcionLoc.content).toContain('fin del ejemplo real.')
    expect(descripcionLoc.content).not.toContain('## Acceptance criteria')
  })

  it('un delimitador de OTRO carácter ("~~~~" dentro de una valla abierta con "```") NO cierra la valla', () => {
    const body = [
      '## Descripción',
      '```',
      'dentro de la valla de backticks, esto NO la cierra:',
      '~~~~',
      '## Dependencias',
      '- merge-after #99',
      '~~~~',
      'y esto sí la cierra de verdad:',
      '```',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const depsLoc = locateSection(body, '## Dependencias')
    expect(extractDeps(depsLoc.content)).toEqual([1])
    const descripcionLoc = locateSection(body, '## Descripción')
    expect(descripcionLoc.content).toContain('~~~~\n## Dependencias\n- merge-after #99\n~~~~')
    expect(descripcionLoc.content).not.toContain('## Acceptance criteria')
  })

  it('un delimitador MÁS LARGO del mismo carácter SÍ cierra (CommonMark real: longitud >= apertura)', () => {
    const body = [
      '## Descripción',
      '```',
      'contenido',
      '````',
      'esto ya está FUERA de la valla (la cerró la línea de arriba, más larga)',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const descripcionLoc = locateSection(body, '## Descripción')
    expect(descripcionLoc.content).toContain('esto ya está FUERA de la valla')
    // La cabecera de AC se localiza con normalidad — no quedó "dentro" de nada.
    const acLoc = locateSection(body, AC_HEADING_FORMS)
    expect(acLoc).not.toBeNull()
  })

  // Menor (review round 5): una línea de CIERRE, por CommonMark real, no
  // puede llevar nada detrás del delimitador salvo espacio en blanco — un
  // "info string" (p.ej. el "js" de "```js") solo es válido en la
  // APERTURA. Antes, "```js" dentro de un bloque YA abierto (pensado como
  // CONTENIDO de ejemplo — mostrando otro fence con lenguaje —, no como
  // cierre real) se leía igual como cierre porque solo se comparaba
  // carácter+longitud, ignorando el resto de la línea.
  it('"```js" (con info string) DENTRO de una valla ya abierta con "```" NO la cierra — sigue siendo contenido del ejemplo', () => {
    const body = [
      '## Descripción',
      '```',
      'ejemplo mostrando cómo abrir un fence con lenguaje:',
      '```js',
      'esto sigue siendo CONTENIDO del ejemplo exterior, no un cierre real',
      '```',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const descripcionLoc = locateSection(body, '## Descripción')
    // Los tres delimitadores del ejemplo (apertura, el "```js" interior que
    // NO cierra, y el cierre real) sobreviven intactos dentro de la sección.
    expect(descripcionLoc.content).toContain('```\nejemplo mostrando cómo abrir un fence con lenguaje:\n```js\nesto sigue siendo CONTENIDO del ejemplo exterior, no un cierre real\n```')
    expect(descripcionLoc.content).not.toContain('## Dependencias')
    const depsLoc = locateSection(body, '## Dependencias')
    expect(extractDeps(depsLoc.content)).toEqual([1])
  })

  it('valla SIN CERRAR: todo lo que sigue se trata como dentro de ella (CommonMark: una valla abierta llega hasta el fin del documento) — una cabecera real después de la apertura no se localiza', () => {
    const body = [
      '## Descripción',
      '```',
      'esta valla nunca se cierra',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    // "## Dependencias" vive, literalmente, dentro de la valla sin cerrar —
    // no es una cabecera real mientras la valla siga abierta.
    expect(locateSection(body, '## Dependencias')).toBeNull()
    expect(locateSection(body, '## Out of scope / Protected')).toBeNull()
  })

  it('cabecera con sufijo humano ("## Dependencias externas (notas del equipo)") NO se reclama como la sección de dependencias real (exact, no prefijo)', () => {
    const body = [
      '## Dependencias externas (notas del equipo)',
      'El equipo de pagos también depende de este cambio, informalmente.',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const depsLoc = locateSection(body, '## Dependencias')
    expect(extractDeps(depsLoc.content)).toEqual([1]) // la sección REAL, no la humana con sufijo
    expect(depsLoc.content).not.toContain('pagos')
  })

  it('"## Acceptance criteria" acepta las DOS formas de AC_HEADING_FORMS — nunca un prefijo abierto', () => {
    const body = '## Acceptance criteria (EARS, 1:1 con tests)\n- AC-1.1\n\n<!-- ct-order:1 -->'
    const loc = locateSection(body, AC_HEADING_FORMS)
    expect(loc).not.toBeNull()
    expect(extractAc(body)).toEqual(['AC-1.1'])
  })

  it('la forma vieja de la cabecera de AC (sin el sufijo EARS, de antes de que se añadiera) también se localiza — es la SEGUNDA forma del conjunto cerrado', () => {
    const body = '## Acceptance criteria\n- AC-1.1\n\n<!-- ct-order:1 -->'
    expect(extractAc(body)).toEqual(['AC-1.1'])
  })

  // Importante 4 (review round 5): antes, `extractAc` localizaba la cabecera
  // por PREFIJO (`{ exact: false }`) — el mismo secuestro que ya se había
  // cerrado para las otras tres secciones. Un "## Acceptance criteria
  // propuestos por QA (borrador)" escrito por un humano POR ENCIMA de la
  // sección real se reclamaba como si fuera ella: el dispatcher inyectaba
  // CERO criterios reales en el prompt del agente. buildIssueBody solo
  // emite dos cadenas fijas para esta cabecera — el hueco legítimo es ESE
  // conjunto cerrado, no un prefijo.
  it('un "## Acceptance criteria propuestos por QA (borrador)" por ENCIMA de la real ya no la secuestra — extractAc lee la real, no la de QA', () => {
    const body = [
      '## Acceptance criteria propuestos por QA (borrador)',
      '- esto NO debe ser lo que el dispatcher inyecte',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1 la real',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    expect(extractAc(body)).toEqual(['AC-1.1 la real'])
  })
})

// Review round 5, Critical 1 — mismo diagnóstico que la ronda 4 aplicado a
// la OTRA cosa con forma de delimitador que vive en el mismo body: un
// comentario HTML MULTILÍNEA no ocultaba su interior, así que una cabecera
// conocida "comentada" (deps viejas que se pospusieron, p.ej.) se leía como
// estructura real. Estos tests atacan la CLASE — no solo el ejemplo que dio
// el reviewer (deps comentadas) — igual que el round 4 atacó su propio
// escáner de vallas más allá de los tres casos nombrados.
describe('locateSection / stepLine — comentarios HTML multilínea ocultan su interior (review round 5, Critical 1)', () => {
  it('reproducción del reviewer: unas deps VIEJAS comentadas "mientras decidimos" no secuestran la sección — se localiza la real', () => {
    const body = [
      '## Descripción',
      'algo',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '<!--',
      '## Dependencias',
      '- merge-after #99 (pospuesto mientras decidimos con pagos)',
      '-->',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const depsLoc = locateSection(body, '## Dependencias')
    expect(extractDeps(depsLoc.content)).toEqual([1]) // la sección REAL, no la comentada (#99)
  })

  it('el comentario multilínea sobrevive INTACTO (apertura y cierre) dentro de la sección que lo contiene', () => {
    const body = [
      '## Descripción',
      'antes del comentario.',
      '<!--',
      '## Dependencias',
      '- merge-after #99',
      '-->',
      'después del comentario, misma sección.',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const descripcionLoc = locateSection(body, '## Descripción')
    expect(descripcionLoc.content).toContain('<!--\n## Dependencias\n- merge-after #99\n-->')
    expect(descripcionLoc.content).toContain('después del comentario, misma sección.')
    expect(descripcionLoc.content).not.toContain('## Acceptance criteria') // no se comió la siguiente cabecera real
  })

  it('comentario SIN CERRAR: todo lo que sigue (incluidas cabeceras reales) queda oculto hasta EOF — igual que una valla sin cerrar', () => {
    const body = [
      '## Descripción',
      '<!--',
      'este comentario nunca se cierra',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    // "## Dependencias" y "## Out of scope / Protected" viven, literalmente,
    // dentro del comentario sin cerrar — no son cabeceras reales mientras
    // el comentario siga abierto.
    expect(locateSection(body, '## Dependencias')).toBeNull()
    expect(locateSection(body, '## Out of scope / Protected')).toBeNull()
  })

  it('tras cerrar el comentario, el escaneo se reanuda con normalidad: una cabecera real DESPUÉS del cierre se localiza bien', () => {
    const body = [
      '## Descripción',
      '<!--',
      'nota vieja',
      '-->',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const depsLoc = locateSection(body, '## Dependencias')
    expect(depsLoc).not.toBeNull()
    expect(extractDeps(depsLoc.content)).toEqual([1])
    expect(extractAc(body)).toEqual(['AC-1.1'])
  })

  it('un comentario AUTOCONTENIDO (abre y cierra en la MISMA línea, como el marcador ct-order) sigue terminando una sección con normalidad — no se confunde con la apertura de uno multilínea', () => {
    const body = [
      '## Out of scope / Protected',
      '- (ninguno declarado)',
      '<!-- ct-order:1 -->',
      '',
      '## Dependencias',
      '- merge-after #99 (esto NO debería aparecer dentro de Protected)',
    ].join('\n')
    const protectedLoc = locateSection(body, '## Out of scope / Protected')
    expect(protectedLoc.content).not.toContain('## Dependencias')
    expect(protectedLoc.content).not.toContain('merge-after #99')
  })

  it('un comentario dentro de una valla de código ABIERTA se trata como texto literal — no dispara el rastreo de comentario ni oculta nada extra más allá de la valla', () => {
    const body = [
      '## Descripción',
      '```',
      'ejemplo mostrando un comentario sin cerrar: <!--',
      'esto sigue siendo parte del EJEMPLO, no un comentario real',
      '```',
      'fin del ejemplo — esto ya está fuera de la valla',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const depsLoc = locateSection(body, '## Dependencias')
    expect(depsLoc).not.toBeNull()
    expect(extractDeps(depsLoc.content)).toEqual([1])
    const descripcionLoc = locateSection(body, '## Descripción')
    expect(descripcionLoc.content).toContain('fin del ejemplo — esto ya está fuera de la valla')
  })

  it('countHeadingLines también ignora una cabecera "comentada" dentro de un comentario multilínea — no cuenta como duplicado', () => {
    const body = [
      '## Dependencias',
      '- merge-after #1',
      '',
      '<!--',
      '## Dependencias',
      '- merge-after #99 (copia vieja comentada, no un duplicado real)',
      '-->',
    ].join('\n')
    expect(countHeadingLines(body, '## Dependencias')).toBe(1)
  })
})

// Review round 5, Critical 2 — "solo '## ' a columna 0 termina una
// sección": un "#", "###", "####", un "##" separado por tabulador, o uno
// indentado 1-3 espacios son, los cinco, cabeceras ATX reales en GitHub —
// ninguno terminaba nada antes de este fix, así que su contenido (y
// cualquier cosa debajo, hasta la siguiente "## " EXACTA) se tragaba en el
// splice de la sección anterior. Estos tests atacan la CLASE completa de
// niveles/formas ATX, no solo el "###" que dio el reviewer.
describe('locateSection — cualquier cabecera ATX (no solo "## ") termina una sección (review round 5, Critical 2)', () => {
  it('reproducción del reviewer: un "### Notas de implementación" con una advertencia real ya NO desaparece al reconciliar — queda fuera de la sección anterior', () => {
    const body = [
      '## Descripción',
      'algo de contexto.',
      '',
      '### Notas de implementación',
      'la dependencia la negociamos con pagos: NO tocar sin hablar con Ana',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const descripcionLoc = locateSection(body, '## Descripción')
    expect(descripcionLoc.content).not.toContain('NO tocar sin hablar con Ana')
    expect(descripcionLoc.content).not.toContain('### Notas de implementación')
  })

  it('un H1 ("# Algo") también termina la sección anterior', () => {
    const body = '## Descripción\ncontenido\n\n# Algo\nresto\n\n<!-- ct-order:1 -->'
    expect(locateSection(body, '## Descripción').content).not.toContain('# Algo')
  })

  it('un H4 ("#### Algo") también termina la sección anterior', () => {
    const body = '## Descripción\ncontenido\n\n#### Algo\nresto\n\n<!-- ct-order:1 -->'
    expect(locateSection(body, '## Descripción').content).not.toContain('#### Algo')
  })

  it('un "##" separado por TABULADOR (en vez de espacio) también termina la sección anterior', () => {
    const body = '## Descripción\ncontenido\n\n##\tOtra cabecera\nresto\n\n<!-- ct-order:1 -->'
    expect(locateSection(body, '## Descripción').content).not.toContain('Otra cabecera')
  })

  it('una cabecera indentada 1-3 espacios ("   ## Algo") también termina la sección anterior (CommonMark: hasta 3 espacios siguen siendo cabecera)', () => {
    const body = '## Descripción\ncontenido\n\n   ## Algo\nresto\n\n<!-- ct-order:1 -->'
    expect(locateSection(body, '## Descripción').content).not.toContain('Algo')
  })

  it('una cabecera de nivel único "##" sin nada detrás (fin de línea inmediato) también termina la sección anterior', () => {
    const body = '## Descripción\ncontenido\n\n##\nresto\n\n<!-- ct-order:1 -->'
    expect(locateSection(body, '## Descripción').content).not.toContain('resto')
  })

  // Negativos — ataque a mi propia regla: verificar que NO se ensanchó de
  // más el criterio.
  it('4+ espacios de indentación → bloque de código indentado, NO una cabecera (CommonMark real) — no termina nada', () => {
    const body = '## Descripción\ncontenido\n\n    ## esto es código indentado, no una cabecera\nmás contenido\n\n<!-- ct-order:1 -->'
    const loc = locateSection(body, '## Descripción')
    expect(loc.content).toContain('## esto es código indentado, no una cabecera')
    expect(loc.content).toContain('más contenido')
  })

  it('sin espacio/tabulador tras los "#" ("##Something", pegado) → NO es una cabecera ATX válida, no termina nada', () => {
    const body = '## Descripción\ncontenido\n\n##Something pegado, no es cabecera\nresto\n\n<!-- ct-order:1 -->'
    const loc = locateSection(body, '## Descripción')
    expect(loc.content).toContain('##Something pegado, no es cabecera')
    expect(loc.content).toContain('resto')
  })

  it('más de 6 "#" (p.ej. 7) → CommonMark ya no lo considera una cabecera ATX, no termina nada', () => {
    const body = '## Descripción\ncontenido\n\n####### siete almohadillas, no es cabecera ATX\nresto\n\n<!-- ct-order:1 -->'
    const loc = locateSection(body, '## Descripción')
    expect(loc.content).toContain('####### siete almohadillas, no es cabecera ATX')
    expect(loc.content).toContain('resto')
  })
})

describe('CRLF — normalizeToLF/detectLineEnding (review round 4, menor)', () => {
  it('detectLineEnding: cuerpo con \\r\\n → "\\r\\n"; cuerpo con \\n puro → "\\n"', () => {
    expect(detectLineEnding('a\r\nb\r\n')).toBe('\r\n')
    expect(detectLineEnding('a\nb\n')).toBe('\n')
    expect(detectLineEnding('')).toBe('\n')
  })
  it('normalizeToLF: quita \\r\\n y cualquier \\r suelto, deja \\n puro', () => {
    expect(normalizeToLF('a\r\nb\r\nc')).toBe('a\nb\nc')
    expect(normalizeToLF('a\rb')).toBe('ab')
  })
  it('una cabecera "exact" con CRLF (arrastra un \\r al final de línea) sigue matcheando — trimEnd absorbe el \\r', () => {
    const body = normalizeToLF('## Dependencias\r\n- merge-after #1\r\n\r\n<!-- ct-order:1 -->\r\n')
    const loc = locateSection(body, '## Dependencias')
    expect(extractDeps(loc.content)).toEqual([1])
  })
})

describe('specLinkAnchor — compara solo el ancla #sección, nunca la ruta (review round 4, importante 4)', () => {
  it('extrae la sección de un enlace con ruta relativa', () => {
    expect(specLinkAnchor('> Slice #2 del epic. Spec: [docs/spec.md#9](docs/spec.md#9)')).toBe('9')
  })
  it('extrae la MISMA sección aunque la ruta sea absoluta — el "#2" de "Slice #2" (antes de cualquier corchete) no se confunde con el ancla', () => {
    expect(specLinkAnchor('> Slice #2 del epic. Spec: [/Users/jose/repo/docs/spec.md#9](/Users/jose/repo/docs/spec.md#9)')).toBe('9')
  })
  it('sin línea → null', () => {
    expect(specLinkAnchor(null)).toBeNull()
    expect(specLinkAnchor(undefined)).toBeNull()
  })
})

describe('countHeadingLines — cuenta cabeceras duplicadas (review round 3, menor)', () => {
  it('una sola aparición → 1', () => {
    expect(countHeadingLines('## Dependencias\n- merge-after #1', '## Dependencias')).toBe(1)
  })
  it('ausente → 0', () => {
    expect(countHeadingLines('## Acceptance criteria\n- x', '## Dependencias')).toBe(0)
  })
  it('dos apariciones reales → 2', () => {
    const body = '## Dependencias\n- merge-after #1\n\n## Dependencias\n- merge-after #2'
    expect(countHeadingLines(body, '## Dependencias')).toBe(2)
  })
  it('una aparición dentro de una valla de código NO cuenta como real', () => {
    const body = '## Descripción\n```\n## Dependencias\n```\n\n## Dependencias\n- merge-after #1'
    expect(countHeadingLines(body, '## Dependencias')).toBe(1)
  })
})

describe('extractSpecLink — la línea "> Slice #N del epic. Spec: …" (review round 3, importante 5)', () => {
  it('la extrae tal cual', () => {
    const body = '> Slice #2 del epic. Spec: [docs/spec.md#9](docs/spec.md#9)\n\n## Acceptance criteria (EARS, 1:1 con tests)\n- AC-1.1'
    expect(extractSpecLink(body)).toBe('> Slice #2 del epic. Spec: [docs/spec.md#9](docs/spec.md#9)')
  })
  it('sin esa línea → null', () => {
    expect(extractSpecLink('## Acceptance criteria\n- x')).toBeNull()
  })
  it('una mención citada/indentada no cuenta como la línea real', () => {
    const body = '> algo más\n  > Slice #9 no es la línea real (indentada)\n> Slice #2 del epic. Spec: [x#9](x#9)'
    expect(extractSpecLink(body)).toBe('> Slice #2 del epic. Spec: [x#9](x#9)')
  })
})
