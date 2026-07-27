import { describe, it, expect } from 'vitest'
import { extractAc, extractDeps, extractOrder, extractSpecLink, normalizeSpecLink, locateSection, countHeadingLines, detectLineEnding, normalizeToLF, mapGhIssue, filterMergedIssues, buildOrderIndex, buildDispatchInput, AC_HEADING_FORMS, NO_MILESTONE_KEY, epicKeyOf, extractDepsInSection, extractStrayDeps } from '../scripts/gh-issue-map.js'
import { selectNext } from '../scripts/dispatch.js'
import { buildIssueBody } from '../scripts/groom.js'

// SPEC_REF (F10): la referencia al spec ya resuelta que recibe buildIssueBody
// — ruta relativa a la raíz del repo, encabezado real de la §9 y la URL
// absoluta verificada. Sustituye al viejo `{ specPath, specSection }`.
const SPEC_REF = {
  path: 'spec.md',
  heading: '9. Slices',
  url: 'https://github.com/o/r/blob/main/spec.md#9-slices',
  reason: null,
}

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
  it('con marcador ct-order y merge-after DENTRO de "## Dependencias" → order/deps correctos', () => {
    // D1 finding 2: mapGhIssue ya no escanea el body ENTERO en busca de
    // "merge-after #N" — solo el contenido de la sección "## Dependencias"
    // reconocida (unificado con el alcance de --reconcile). Un "merge-after"
    // fuera de esa sección (ver el describe dedicado más abajo) se ignora.
    const body = 'algo\n## Dependencias\n- merge-after #3\n- merge-after #4\n\n<!-- ct-order:7 -->'
    const mapped = mapGhIssue({ number: 99, title: '#99 x', labels: [], body })
    expect(mapped.order).toBe(7)
    expect(mapped.deps).toEqual([3, 4])
    expect(mapped.depsMalformed).toBe(false)
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
    const body = buildIssueBody(slice, SPEC_REF)
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
// F6, grave 1: el formato de la referencia de dependencia cambia de "#N"
// desnudo a código inline ("`#N`") para que GitHub deje de autoenlazarla al
// issue N (verificado contra la API real, ver groom.test.js). Los issues YA
// CREADOS con el formato viejo siguen existiendo en repos reales — el lector
// tiene que entender LOS DOS, para siempre. Decisión explícita: NO se migran
// (nadie reescribe bodies existentes solo por esto); un body viejo solo
// adopta el formato nuevo si --reconcile ya iba a reescribir esa sección por
// una divergencia real.
describe('extractDeps / extractDepsInSection — formato nuevo (`#N`) y viejo (#N) se leen igual (F6, grave 1)', () => {
  it('extractDeps lee la referencia entre backticks', () => {
    expect(extractDeps('- merge-after `#3`')).toEqual([3])
  })
  it('extractDeps sigue leyendo el formato viejo, sin backticks (issues ya creados)', () => {
    expect(extractDeps('- merge-after #3')).toEqual([3])
  })
  it('extractDeps lee un body mixto (una sección editada a mano con las dos formas)', () => {
    expect(extractDeps('- merge-after `#3`\n- merge-after #4')).toEqual([3, 4])
  })
  it('la sección generada hoy no es "malformed": la nota de orden no introduce ninguna referencia sin capturar', () => {
    const body = buildIssueBody({ n: 5, name: 'x', ac: ['AC-5.1'], deps: [1, 2], protected: '–' }, SPEC_REF)
    expect(extractDepsInSection(body)).toEqual({ deps: [1, 2], malformed: false })
  })
  it('un body con el formato VIEJO sigue mapeando igual por el camino de producción (mapGhIssue)', () => {
    const legacyBody = [
      '> Slice #5 del epic. Spec: [spec.md#9](spec.md#9)', '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-5.1', '',
      '## Dependencias', '- merge-after #1', '- merge-after #2', '',
      '## Out of scope / Protected', '- (ninguno declarado)', '',
      '<!-- ct-order:5 -->',
    ].join('\n')
    const mapped = mapGhIssue({ number: 60, title: '#60 x', labels: [{ name: 'status:ready' }], body: legacyBody })
    expect(mapped.deps).toEqual([1, 2])
    expect(mapped.depsMalformed).toBe(false)
    expect(mapped.strayDeps).toEqual([])
  })
})

describe('extractOrder', () => {
  it('lee el marcador ct-order:N', () => expect(extractOrder('x\n<!-- ct-order:2 -->')).toBe(2))
  it('sin marcador → null', () => expect(extractOrder('sin marcador')).toBeNull())
  it('body vacío/ausente → null', () => {
    expect(extractOrder('')).toBeNull()
    expect(extractOrder(undefined)).toBeNull()
  })
})

// buildOrderIndex — hardening del dispatch, D1 finding 1 (el más grave de la
// revisión): el índice orden→issue era GLOBAL AL REPO (un único Map), pero
// /ct-groom numera slices 1..N POR EPIC. Dos epics groomeados en el mismo
// repo reutilizan los mismos números de orden, y `index.set` se quedaba con
// el ÚLTIMO issue visto para cada orden — con `[...open, ...closed]`, un
// issue YA MERGEADO (cerrado) de un epic A ganaba silenciosamente el slot
// que un `merge-after` de un epic B en curso necesitaba resolver contra su
// propio slice hermano. Reproducción verificada por el auditor: epic A
// (slices 1,2 → #1,#2, ambos mergeados), epic B en el mismo repo (slices
// 1,2 → #7,#8) — el `merge-after #1` de #8 (orden 1 DE EPIC B) resolvía
// contra el #1 de epic A (ya mergeado), así que #7 y #8 se despachaban en la
// MISMA tanda sin que #8 esperara de verdad a #7. Nada se imprimía.
//
// Decisión de ALCANCE: cada issue lleva un milestone real desde que
// groom.js#groomPlan existe (una invocación de /ct-groom = un `--milestone`
// = un epic) — el número de milestone de GitHub es único POR REPO y ya
// viaja en CADA issue (abierto o cerrado) sin que este fix tenga que escribir
// nada nuevo en ningún body: coste de compatibilidad CERO para cualquier
// issue ya groomeado con el marcador actual (`<!-- ct-order:N -->` no
// cambia). La alternativa (codificar un identificador de epic DENTRO del
// propio marcador) se descarta: obligaría a reescribir issues ya existentes
// o a mantener dos formatos de marcador en paralelo indefinidamente, para
// llevar la MISMA información que el campo `milestone` de GitHub ya provee
// gratis. Un issue sin milestone (creado a mano, o un repo de antes de que
// ct-groom asignara milestone) cae en el bucket `NO_MILESTONE_KEY`
// compartido — sigue siendo mejor que reventar, pero el bucket compartido
// puede volver a colisionar si dos epics sin milestone reutilizan órdenes;
// ver el test de colisión más abajo, que cubre justo ese caso.
//
// Decisión de DETECCIÓN: una colisión dentro del MISMO epic (dos issues
// DISTINTOS con el mismo orden bajo el mismo milestone — p.ej. dos epics que
// comparten milestone por error, o un re-groom accidental) NUNCA se resuelve
// en silencio quedándose con "el último" o "el primero" — se reporta en
// `collisions` para que buildDispatchInput/ct-next.mjs aborten el batch
// entero (ver su propio describe más abajo) en vez de arriesgarse a
// despachar contra la dependencia equivocada, que es precisamente el bug
// que este finding describe.
describe('buildOrderIndex — alcance por epic (milestone) y detección de colisión (D1 finding 1)', () => {
  it('mapea orden → número de issue, con el índice separado POR MILESTONE (epic)', () => {
    const raw = [
      { number: 2, milestone: { number: 5 }, body: '<!-- ct-order:1 -->' },
      { number: 3, milestone: { number: 5 }, body: '<!-- ct-order:2 -->' },
    ]
    const { perEpic, collisions } = buildOrderIndex(raw)
    expect(perEpic.get('5').get(1)).toBe(2)
    expect(perEpic.get('5').get(2)).toBe(3)
    expect(collisions).toEqual([])
  })

  it('el MISMO número de orden en milestones DISTINTOS no es colisión — son epics distintos, cada uno con su propio espacio de orden', () => {
    const raw = [
      { number: 1, milestone: { number: 10 }, body: '<!-- ct-order:1 -->' }, // epic A, slice 1
      { number: 7, milestone: { number: 20 }, body: '<!-- ct-order:1 -->' }, // epic B, slice 1
    ]
    const { perEpic, collisions } = buildOrderIndex(raw)
    expect(collisions).toEqual([])
    expect(perEpic.get('10').get(1)).toBe(1)
    expect(perEpic.get('20').get(1)).toBe(7)
  })

  it('el MISMO orden bajo el MISMO milestone, en issues DISTINTOS → colisión real, reportada (nunca "el último gana" en silencio)', () => {
    const raw = [
      { number: 7, milestone: { number: 100 }, body: '<!-- ct-order:2 -->' },
      { number: 8, milestone: { number: 100 }, body: '<!-- ct-order:2 -->' },
    ]
    const { perEpic, collisions } = buildOrderIndex(raw)
    expect(collisions).toEqual([{ epicKey: '100', order: 2, issues: [7, 8] }])
    // el slot no se resuelve arbitrariamente a "el último" — sigue apuntando
    // al primero visto, pero quien consuma el índice tiene que mirar
    // `collisions` antes de confiar en ese valor (buildDispatchInput lo hace).
    expect(perEpic.get('100').get(2)).toBe(7)
  })

  it('issues SIN milestone caen en un bucket compartido (NO_MILESTONE_KEY), no en el de ningún epic real', () => {
    const raw = [{ number: 9, milestone: null, body: '<!-- ct-order:1 -->' }]
    const { perEpic } = buildOrderIndex(raw)
    expect(perEpic.get(NO_MILESTONE_KEY).get(1)).toBe(9)
  })

  it('dos issues sin milestone con el mismo orden → también cuenta como colisión (el bucket compartido no es inmune)', () => {
    const raw = [
      { number: 1, body: '<!-- ct-order:1 -->' },
      { number: 2, body: '<!-- ct-order:1 -->' },
    ]
    const { collisions } = buildOrderIndex(raw)
    expect(collisions).toEqual([{ epicKey: NO_MILESTONE_KEY, order: 1, issues: [1, 2] }])
  })

  it('issues sin marcador no entran en ningún índice', () => {
    const { perEpic, collisions } = buildOrderIndex([{ number: 9, milestone: { number: 1 }, body: 'sin marcador' }])
    expect(perEpic.get('1')).toBeUndefined()
    // Aserción reforzada (no solo "el bucket del milestone 1 no existe" —
    // eso por sí solo no descarta que se haya creado ALGÚN otro bucket
    // vacío por error): sin ningún marcador `ct-order`, `perEpic` entero
    // queda vacío, igual que el `idx.size === 0` que comprobaba la versión
    // pre-D1 (Map plano) de este mismo test.
    expect(perEpic.size).toBe(0)
    expect(collisions).toEqual([])
  })

  it('tres issues DISTINTOS en el mismo hueco (epic, orden) → UNA sola colisión con los tres números, nunca entradas solapadas por pares', () => {
    const raw = [
      { number: 7, milestone: { number: 100 }, body: '<!-- ct-order:2 -->' },
      { number: 8, milestone: { number: 100 }, body: '<!-- ct-order:2 -->' },
      { number: 9, milestone: { number: 100 }, body: '<!-- ct-order:2 -->' },
    ]
    const { collisions } = buildOrderIndex(raw)
    // Una única entrada para el hueco (epic 100, orden 2), con los TRES
    // números — no dos entradas solapadas ([7,8] y [7,9]) que repitan al
    // primero y hagan más difícil ver de un vistazo cuántos issues distintos
    // compiten de verdad por el mismo hueco.
    expect(collisions).toEqual([{ epicKey: '100', order: 2, issues: [7, 8, 9] }])
  })

  it('defensivo: entrada vacía/ausente no revienta', () => {
    expect(buildOrderIndex([]).perEpic.size).toBe(0)
    expect(buildOrderIndex([]).collisions).toEqual([])
    expect(buildOrderIndex(undefined).perEpic.size).toBe(0)
  })

  it('epicKeyOf: milestone con número → String(number); sin milestone (o milestone.number no finito) → NO_MILESTONE_KEY', () => {
    expect(epicKeyOf({ milestone: { number: 42 } })).toBe('42')
    expect(epicKeyOf({ milestone: null })).toBe(NO_MILESTONE_KEY)
    expect(epicKeyOf({})).toBe(NO_MILESTONE_KEY)
    expect(epicKeyOf({ milestone: {} })).toBe(NO_MILESTONE_KEY)
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
      body: '## Dependencias\n- merge-after #99\n\n<!-- ct-order:1 -->', // orden 99 no existe en ningún lado
    }]
    const { issues, mergedIssues, orderCollisions } = buildDispatchInput(open, [])
    expect(orderCollisions).toEqual([])
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
      body: '## Dependencias\n- merge-after #1\n\n<!-- ct-order:2 -->',
    }]
    const { issues, mergedIssues } = buildDispatchInput(open, closed)
    const selected = selectNext(issues, { mergedIssues, runningTouches: [], concurrencyCap: 1 })
    expect(selected.map((i) => i.n)).toEqual([11])
  })

  // D1 finding 1 (el más grave): reproducción END-TO-END exacta del auditor
  // — epic A groomeado y mergeado por completo (#1, #2, milestone 100), epic
  // B groomeado DESPUÉS en el mismo repo (#7, #8, milestone 200 — un
  // milestone DISTINTO, porque son epics distintos de verdad). #8 declara
  // "merge-after #1" — orden 1 DE SU PROPIO epic (B), que es #7. Antes de
  // este fix, el índice global de orden resolvía "orden 1" contra el ÚLTIMO
  // issue visto con ese marcador en TODO el repo — el #1 de epic A, ya
  // mergeado — así que #8 se despachaba junto a #7 en la misma tanda, sin
  // haber esperado nunca a #7 de verdad. Con el índice por milestone, #8
  // resuelve contra #7 (su hermano real) y queda bloqueado hasta que #7 se
  // mergee.
  it('D1 finding 1 — reproducción del auditor: epic A mergeado + epic B en curso, mismos números de orden, milestones DISTINTOS → el dep de B resuelve contra B, nunca contra A', () => {
    const closed = [
      { number: 1, stateReason: 'COMPLETED', milestone: { number: 100 }, body: '<!-- ct-order:1 -->' }, // epic A, slice 1
      { number: 2, stateReason: 'COMPLETED', milestone: { number: 100 }, body: '<!-- ct-order:2 -->' }, // epic A, slice 2
    ]
    const open = [
      {
        number: 7, title: '#7 cimiento epicB', labels: [{ name: 'status:ready' }],
        milestone: { number: 200 }, body: '<!-- ct-order:1 -->', // epic B, slice 1 (sin deps)
      },
      {
        number: 8, title: '#8 encima de epicB', labels: [{ name: 'status:ready' }],
        milestone: { number: 200 },
        body: 'algo\n## Dependencias\n- merge-after #1\n\n<!-- ct-order:2 -->', // epic B, slice 2: depende del orden 1 DE SU PROPIO epic
      },
    ]
    const { issues, mergedIssues, orderCollisions } = buildDispatchInput(open, closed)
    expect(orderCollisions).toEqual([]) // milestones distintos: nunca es una colisión real
    expect(mergedIssues).toEqual([1, 2])
    const slice8 = issues.find((i) => i.n === 8)
    expect(slice8.deps).toEqual([7]) // EL FIX: nunca [1] (el orden 1 de epic A)
    // end-to-end: con cap de sobra, solo #7 se despacha — #8 sigue esperando
    // a su hermano real, no al #1 de epic A que ya estaba mergeado.
    const selected = selectNext(issues, { mergedIssues, runningTouches: [], concurrencyCap: 5 })
    expect(selected.map((i) => i.n)).toEqual([7])
  })

  it('D1 finding 1 — si dos epics comparten milestone por error (p.ej. ambos con el título por defecto "Epic"), la colisión de orden se reporta, nunca se resuelve en silencio', () => {
    const open = [
      { number: 7, title: '#7 a', labels: [{ name: 'status:ready' }], milestone: { number: 100 }, body: '<!-- ct-order:1 -->' },
      { number: 8, title: '#8 b', labels: [{ name: 'status:ready' }], milestone: { number: 100 }, body: '<!-- ct-order:1 -->' },
    ]
    const { orderCollisions } = buildDispatchInput(open, [])
    expect(orderCollisions).toEqual([{ epicKey: '100', order: 1, issues: [7, 8] }])
  })

  // Review de D1, finding 4: el radio del "refuse" era demasiado ancho — el
  // batch entero abortaba (ver ct-next.mjs, versión anterior), incluso para
  // epics sanos y sin ninguna relación con la colisión. `issues` ahora
  // EXCLUYE, en el propio buildDispatchInput (para que ningún consumidor
  // tenga que acordarse de filtrar por su cuenta), cualquier issue cuyo
  // PROPIO epicKey esté en `orderCollisions` — ni se selecciona ni cuenta en
  // vuelo, porque su propia resolución de deps ya no es de fiar. Un epic sin
  // relación (milestone distinto, sin colisión) sigue viéndose con
  // normalidad.
  it('D1 finding 4 — un epic con colisión de orden queda EXCLUIDO de `issues` (ni se selecciona ni cuenta en vuelo), pero un epic sano y sin relación permanece intacto', () => {
    const open = [
      { number: 7, title: '#7 a', labels: [{ name: 'status:ready' }], milestone: { number: 100 }, body: '<!-- ct-order:1 -->' },
      { number: 8, title: '#8 b', labels: [{ name: 'status:ready' }], milestone: { number: 100 }, body: '<!-- ct-order:1 -->' },
      { number: 20, title: '#20 sano', labels: [{ name: 'status:ready' }], milestone: { number: 300 }, body: '<!-- ct-order:1 -->' },
    ]
    const { issues, orderCollisions } = buildDispatchInput(open, [])
    expect(orderCollisions.length).toBe(1) // la colisión se sigue reportando (informativo)
    expect(issues.map((i) => i.n)).toEqual([20]) // #7/#8 (epic colisionado) fuera; #20 (sano) presente
  })

  // Reproducción del escenario que más preocupaba a la review: la colisión
  // vive SOLO entre issues YA CERRADOS de un epic viejo — nadie tiene
  // trabajo pendiente ahí hoy. Un epic nuevo, abierto, sin relación (milestone
  // distinto), no debe verse afectado en absoluto — ni excluido ni bloqueado.
  it('D1 finding 4 — una colisión que vive SOLO entre issues cerrados de un epic viejo no excluye ni afecta a un epic nuevo y abierto', () => {
    const closed = [
      { number: 50, stateReason: 'COMPLETED', milestone: { number: 100 }, body: '<!-- ct-order:1 -->' },
      { number: 51, stateReason: 'COMPLETED', milestone: { number: 100 }, body: '<!-- ct-order:1 -->' }, // mismo (epic,orden) → colisión histórica
    ]
    const open = [
      { number: 60, title: '#60 nuevo', labels: [{ name: 'status:ready' }], milestone: { number: 400 }, body: '<!-- ct-order:1 -->' },
    ]
    const { issues, orderCollisions } = buildDispatchInput(open, closed)
    expect(orderCollisions.length).toBe(1)
    expect(issues.map((i) => i.n)).toEqual([60]) // el epic nuevo, sin relación, no se toca
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

// F10 sustituye a specLinkAnchor, que extraía SOLO el ancla y descartaba la
// ruta a propósito: mientras la línea se componía con `process.argv[2]` tal
// cual, comparar la ruta habría hecho que dos notaciones del mismo fichero
// se reescribieran mutuamente para siempre. El precio era no detectar que el
// spec se hubiera movido de fichero (un enlace a OTRO fichero con el mismo
// número de sección pasaba por bueno). Ahora la línea es canónica — deriva
// del repositorio, no de argv — y se compara entera.
describe('normalizeSpecLink — compara la línea entera, normalizando solo el espacio de los extremos (F10)', () => {
  const LINK = '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)'
  it('dos líneas idénticas son iguales', () => {
    expect(normalizeSpecLink(LINK)).toBe(normalizeSpecLink(LINK))
  })
  it('un espacio de cola (un editor que lo añade) no es un cambio de contenido', () => {
    expect(normalizeSpecLink(`${LINK}  `)).toBe(normalizeSpecLink(LINK))
  })
  it('el MISMO ancla en OTRO fichero YA NO se considera igual — el agujero que dejaba la comparación por ancla', () => {
    const otroFichero = '> Slice `#2` del epic. Spec: [docs/viejo.md § 9. Slices](https://github.com/o/r/blob/main/docs/viejo.md#9-slices)'
    expect(normalizeSpecLink(otroFichero)).not.toBe(normalizeSpecLink(LINK))
  })
  it('el enlace RELATIVO de antes de F10 no se considera igual al absoluto de hoy', () => {
    expect(normalizeSpecLink('> Slice `#2` del epic. Spec: [docs/spec.md#9](docs/spec.md#9)')).not.toBe(normalizeSpecLink(LINK))
  })
  it('sin línea → null (y null no es igual a ninguna línea real)', () => {
    expect(normalizeSpecLink(null)).toBeNull()
    expect(normalizeSpecLink(undefined)).toBeNull()
    expect(normalizeSpecLink(null)).not.toBe(normalizeSpecLink(LINK))
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
  // F6, grave 1: el orden pasa a ir entre backticks también en esta línea (el
  // `body_html` real del issue #4 del sandbox demuestra que GitHub enlazaba
  // ese "#3" al issue #3). Los dos formatos tienen que localizarse: los
  // issues viejos no se reescriben.
  it('localiza también la línea con el orden entre backticks (formato F6)', () => {
    const body = '> Slice `#2` del epic. Spec: [docs/spec.md#9](docs/spec.md#9)\n\n## Acceptance criteria\n- AC-1.1'
    expect(extractSpecLink(body)).toBe('> Slice `#2` del epic. Spec: [docs/spec.md#9](docs/spec.md#9)')
  })
  it('una línea "> Slice …" que no cita ningún orden no se confunde con el enlace al spec', () => {
    const body = '> Slice pendiente de negociar con Ana\n> Slice `#2` del epic. Spec: [x#9](x#9)'
    expect(extractSpecLink(body)).toBe('> Slice `#2` del epic. Spec: [x#9](x#9)')
  })
})

// D1 finding 2: extractDeps matcheaba SOLO el literal "merge-after #N", SIN
// anclarse a ninguna sección — y sin ninguna señal cuando el intento de
// declarar una dependencia no producía ningún match. Verificado por el
// auditor sobre bodies editados como un humano los edita de verdad en el
// editor web de GitHub:
//   "- merge-after #1"                  -> deps [1]      (caso normal)
//   "- Depende de #1 (merge primero)"   -> deps []       gate abierto, SILENCIO
//   "- merge after #1" (guion perdido)  -> deps []       gate abierto, SILENCIO
//   "- ~~merge-after #1~~ ya no aplica" -> deps [1]       (falla cerrado, no es el caso que este fix ataca)
//   "merge-after #9" en la prosa de un AC -> antes contaba (escaneo de TODO
//     el body); unificado con --reconcile (que YA leía solo la sección
//     "## Dependencias" — es la única que puede tocar con seguridad vía
//     splice), el dispatcher deja de verlo.
//
// La sección "## Dependencias" PRESENTE con CERO matches de "merge-after
// #N" es la señal que se estaba desperdiciando: antes se traducía en
// silencio a `deps: []` (mismo resultado que "este slice no declara
// ninguna dependencia"), indistinguible de un slice que de verdad no tiene
// deps. `mapGhIssue` ahora expone `depsMalformed: true` en ese caso —
// dispatch.js#computeReadyCandidates lo trata como NO listo para despachar
// (fail-closed) en vez de "sin deps" (ver dispatch.test.js).
//
// Coste de unificar el dominio: un `merge-after` escrito a mano FUERA de la
// sección reconocida (p.ej. en la prosa de un AC) deja de ser honrado por el
// dispatcher — exactamente lo que ya le pasaba a --reconcile desde F5. Antes
// de este fix, el dispatcher SÍ lo obedecía pero --reconcile jamás podía
// reconciliarlo (splice inseguro fuera de sección): un mismo dato con dos
// comportamientos distintos según quién lo leyera. Ahora ambos coinciden.
describe('mapGhIssue — deps con alcance de sección "## Dependencias" y detección de reescritura humana (D1 finding 2)', () => {
  it('"- merge-after #1" dentro de la sección → deps correctos, depsMalformed false', () => {
    const body = '## Dependencias\n- merge-after #1\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(false)
  })

  it('reescritura humana ("Depende de #1 (merge primero)") dentro de la sección → deps [], depsMalformed true — nunca "gate abierto" en silencio', () => {
    const body = '## Dependencias\n- Depende de #1 (merge primero)\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([])
    expect(mapped.depsMalformed).toBe(true)
  })

  it('guion perdido ("merge after #1", sin el guion) dentro de la sección → deps [], depsMalformed true', () => {
    const body = '## Dependencias\n- merge after #1\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([])
    expect(mapped.depsMalformed).toBe(true)
  })

  it('tachado ("~~merge-after #1~~ ya no aplica") → el regex SIGUE matcheando (falla cerrado; no es el caso que este fix ataca) → deps [1], NO malformed', () => {
    const body = '## Dependencias\n- ~~merge-after #1~~ ya no aplica\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(false)
  })

  it('un "merge-after #9" suelto en la prosa de un AC, FUERA de "## Dependencias" → se IGNORA (unificado con --reconcile); solo cuenta lo que hay DENTRO de la sección real', () => {
    const body = [
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- algo que menciona merge-after #9 de pasada, sin ser una dependencia real',
      '',
      '## Dependencias',
      '- merge-after #1',
      '',
      '<!-- ct-order:2 -->',
    ].join('\n')
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1]) // nunca [9, 1] ni [1, 9]
    expect(mapped.depsMalformed).toBe(false)
    // Review de D1, finding 1 (parte "falta el aviso"): estrechar el
    // dominio del dispatcher a la sección abrió una puerta que `main`
    // mantenía cerrada (el "#9" de la prosa antes SÍ bloqueaba, ahora ya
    // no) — correcto y deseado, pero invisible sin esto. `strayDeps` expone
    // exactamente esa referencia ignorada para que ct-next.mjs pueda
    // avisar; ver el describe dedicado más abajo.
    expect(mapped.strayDeps).toEqual([9])
  })

  it('sin sección "## Dependencias" en absoluto → deps [], depsMalformed false (caso normal: el slice no declara deps)', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body: 'sin nada de deps aquí' })
    expect(mapped.deps).toEqual([])
    expect(mapped.depsMalformed).toBe(false)
  })

  it('sección "## Dependencias" presente pero completamente vacía (sin ninguna línea de contenido) → depsMalformed true (buildIssueBody NUNCA emite la cabecera sin al menos un "merge-after"; si aparece así, alguien la vació a mano)', () => {
    const body = '## Dependencias\n\n<!-- ct-order:1 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([])
    expect(mapped.depsMalformed).toBe(true)
  })

  it('extractDepsInSection — misma función que reconcile.js reutiliza; alcance idéntico', () => {
    expect(extractDepsInSection('## Dependencias\n- merge-after #1\n\n<!-- ct-order:1 -->')).toEqual({ deps: [1], malformed: false })
    expect(extractDepsInSection('sin sección')).toEqual({ deps: [], malformed: false })
    expect(extractDepsInSection('## Dependencias\n- nada reconocible\n\n<!-- ct-order:1 -->')).toEqual({ deps: [], malformed: true })
  })

  // Ataque adversarial (no un ejemplo del auditor): una sección con DOS
  // líneas — una real ("merge-after #1") y una reescrita a mano ("Depende
  // de #2") — no produce CERO matches (así que la comprobación simple
  // "deps.length === 0" no la atraparía), pero SÍ pierde una dependencia
  // real en silencio. `malformed` compara el número de líneas de bullet
  // ("- ...") contra el número de deps extraídas: si hay menos deps que
  // bullets, alguna línea no se pudo leer — sigue siendo `malformed: true`,
  // aunque `deps` no esté vacío (fail-closed: el `#1` que SÍ se reconoció
  // sigue aplicando como dependencia real).
  it('sección con una línea real y otra reescrita a mano (mezcla) → deps parcial, PERO depsMalformed:true (no solo "cero matches")', () => {
    const body = '## Dependencias\n- merge-after #1\n- Depende de #2 (mal escrito)\n\n<!-- ct-order:3 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1]) // el #2 se pierde, pero #1 se conserva (fail-closed)
    expect(mapped.depsMalformed).toBe(true) // nunca se trata como "solo depende de #1"
  })

  it('dos "merge-after" reales en la MISMA línea de bullet → no es una mezcla, no malformed', () => {
    const body = '## Dependencias\n- merge-after #1, merge-after #2\n\n<!-- ct-order:3 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1, 2])
    expect(mapped.depsMalformed).toBe(false)
  })

  // Ataque adversarial contra mi PROPIA heurística de "bulletLines" (mismo
  // espíritu que las rondas de review de F5 sobre locateSection): una
  // sub-lista humana de elaboración, indentada BAJO una dependencia real
  // ("- merge-after #1\n  - nota: esto es importante") es una edición
  // legítima y frecuente — buildIssueBody nunca anida bullets, así que
  // contar CUALQUIER línea que empiece por "-" (incluso indentada) como
  // "bullet de dependencia" marcaría esto como `malformed` en falso, aunque
  // la única dependencia real (#1) se leyó perfectamente. `bulletLines`
  // cuenta solo bullets de NIVEL SUPERIOR ("- " sin indentar, igual que
  // buildIssueBody los emite) — una sub-lista indentada no cuenta.
  it('una sub-lista humana indentada bajo una dependencia real NO cuenta como bullet de dependencia — no dispara malformed en falso', () => {
    const body = '## Dependencias\n- merge-after #1\n  - nota: esto lo negociamos con pagos, no tocar\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(false)
  })

  // Otro ataque contra la propia heurística: un separador markdown "---"
  // (regla horizontal) empieza por "-" pero NO es un bullet — sin el
  // requisito de "- " (guion Y espacio, el formato exacto que buildIssueBody
  // emite), este separador inflaría bulletLines sin ninguna dependencia
  // correspondiente, marcando malformed en falso.
  it('una línea "---" (separador markdown) dentro de la sección no cuenta como bullet de dependencia', () => {
    const body = '## Dependencias\n- merge-after #1\n---\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(false)
  })
})

// Review de D1, finding 1 (parte "falta el aviso"): estrechar el dominio de
// deps del dispatcher a "## Dependencias" (D1 finding 2) abrió una puerta
// que `main` mantenía cerrada — verificado por la review con el MISMO
// fixture en ambos sentidos: un `#8` cuyo body lleva `merge-after #1` bajo
// "## Descripción" (nunca dentro de "## Dependencias"). `main` (escaneo de
// TODO el body) lo veía y bloqueaba `#8` hasta que `#1`/su hermano real
// mergeara; esta rama, tras D1 finding 2, lo ignora del todo — correcto y
// deseado (es justo el estrechamiento pedido), pero antes de este fix no se
// imprimía NADA al respecto: `#8` se despachaba en silencio sin que nadie
// supiera que su intento de dependencia dejó de contar.
//
// `extractStrayDeps`/`mapGhIssue#strayDeps` exponen exactamente esas
// referencias "merge-after #N" que existen en el body pero FUERA de la
// sección reconocida — la misma señal que reconcile.js ya calculaba para su
// propio reporte (`diffIssue#strayDeps`), ahora compartida (una sola
// implementación, no dos que puedan divergir) para que ct-next.mjs también
// pueda avisar (ver ct-next-dryrun.test.js).
describe('extractStrayDeps / mapGhIssue#strayDeps — deps fuera de la sección reconocida, expuestas para poder avisar (D1 finding 1, seguimiento de review)', () => {
  it('reproducción EXACTA de la review: "merge-after #1" bajo "## Descripción" (nunca "## Dependencias") → deps:[], strayDeps:[1]', () => {
    const body = [
      '## Descripción',
      'hace referencia a merge-after #1 pero no en la sección correcta',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1',
      '',
      '<!-- ct-order:2 -->',
    ].join('\n')
    const mapped = mapGhIssue({ number: 8, title: '#8 x', labels: [], body })
    expect(mapped.deps).toEqual([]) // el estrechamiento (D1 finding 2) es correcto: no cuenta como dependencia real
    expect(mapped.strayDeps).toEqual([1]) // pero la referencia ignorada queda expuesta para poder avisar
  })

  it('un "merge-after #N" DENTRO de la sección reconocida no es "stray" — solo lo que vive fuera cuenta', () => {
    const body = '## Dependencias\n- merge-after #1\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.strayDeps).toEqual([])
  })

  it('sin ninguna referencia fuera de sección → strayDeps: [] (caso normal, sin ruido)', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body: 'body normal sin nada de esto' })
    expect(mapped.strayDeps).toEqual([])
  })

  it('extractStrayDeps — función compartida: dedup y orden ascendente, y una dep repetida DENTRO y fuera de la sección no cuenta como stray', () => {
    expect(extractStrayDeps('merge-after #9\nmerge-after #9', [])).toEqual([9]) // dedup
    expect(extractStrayDeps('merge-after #3\nmerge-after #1', [3])).toEqual([1]) // #3 ya está en sectionDeps, no es stray; #1 sí
    expect(extractStrayDeps('sin nada', [])).toEqual([])
  })
})

// Review de D1 (round 2): contar viñetas "- " no es el eje correcto — lo
// derrota cualquier línea buena con DOS "merge-after" (infla el conteo de
// deps sin inflar el de viñetas) y cualquier línea rota que no use "- "
// (viñeta "*", numerada, o sin viñeta en absoluto). La señal correcta es
// otra: CUALQUIER referencia "#N" (por VALOR, no por posición — así una
// misma referencia repetida en prosa, p.ej. "ver también #1", no cuenta
// como problema si #1 YA es una dependencia reconocida) que "merge-after"
// nunca capturó es lo que de verdad distingue "esta línea pretendía
// declarar una dependencia y está mal escrita" de "esta línea es una nota
// sin ningún número". Estos tests reproducen EXACTAMENTE los tres falsos
// negativos y el falso positivo que encontró la review contra mi primer
// heurístico (bulletLines), y atacan la heurística NUEVA con formas que
// nadie me dio: viñeta "*", numerada, sin viñeta, indentada, varias deps en
// una línea, deps tachadas.
describe('mapGhIssue — extractDepsInSection: la señal correcta es la referencia "#N" sin capturar, no el conteo de viñetas (review de D1, round 2)', () => {
  it('falso negativo 1 (review): dos merge-after reales en una línea + una tercera dependencia rota en OTRA línea → malformed:true (antes: false, la "mezcla" se perdía)', () => {
    const body = '## Dependencias\n- merge-after #1, merge-after #2\n- Depende de #3\n\n<!-- ct-order:4 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1, 2]) // lo que sí se leyó bien se conserva (fail-closed)
    expect(mapped.depsMalformed).toBe(true) // pero #3 no puede perderse en silencio
  })

  it('falso negativo 2 (review): dependencia rota con viñeta "*" en vez de "-" → malformed:true (antes: false, "*" no contaba como viñeta)', () => {
    const body = '## Dependencias\n- merge-after #1\n* Depende de #2\n\n<!-- ct-order:3 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(true)
  })

  it('falso negativo 3 (review): dependencia rota SIN viñeta en absoluto → malformed:true (antes: false, la línea no empezaba por "-")', () => {
    const body = '## Dependencias\n- merge-after #1\nDepende de #2 tambien\n\n<!-- ct-order:3 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(true)
  })

  it('falso positivo (review): una dependencia real + una NOTA sin ningún número → malformed:false (antes: true, 2 viñetas contra 1 dep bloqueaban un slice sano)', () => {
    const body = '## Dependencias\n- merge-after #1\n- ojo: revisar con Ana\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(false)
  })

  // Ataques adicionales contra la heurística NUEVA (no dados por la review):
  it('dependencia rota en formato de lista NUMERADA ("1. Depende de #2") → malformed:true', () => {
    const body = '## Dependencias\n- merge-after #1\n1. Depende de #2\n\n<!-- ct-order:3 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(true)
  })

  it('dependencia rota INDENTADA bajo la real ("  Depende de #2", sub-nivel) → malformed:true — indentarla no la vuelve inofensiva', () => {
    const body = '## Dependencias\n- merge-after #1\n  - Depende de #2\n\n<!-- ct-order:3 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(true)
  })

  it('una MISMA referencia repetida en prosa ("ver también #1 en el spec", #1 YA es una dependencia reconocida) → NO cuenta como problema (comparación por valor, no por posición)', () => {
    const body = '## Dependencias\n- merge-after #1\n- ver también #1 en el spec para más contexto\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(false)
  })

  it('deps tachadas ("~~merge-after #1~~ ya no aplica") + una nota sin número → sigue sin malformed (regresión: no reintroducir el falso positivo)', () => {
    const body = '## Dependencias\n- ~~merge-after #1~~ ya no aplica\n- nota: pendiente de decidir con pagos\n\n<!-- ct-order:2 -->'
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [], body })
    expect(mapped.deps).toEqual([1])
    expect(mapped.depsMalformed).toBe(false)
  })
})

// D1 finding 3: dos labels "status:" a la vez (una edición a medias — se
// añadió la nueva sin quitar la vieja) hacía que `Array.prototype.find`
// eligiera la PRIMERA del array que devuelve `gh`, sin ningún aviso ni
// comprobación de que hubiera exactamente una. El auditor verificó que
// `['status:in-progress','status:ready']` resuelve a "in-progress" y el
// mismo array invertido resuelve a "ready" — pero no pudo determinar offline
// el orden real que GitHub usa, y pidió explícitamente NO adivinarlo: el
// código tiene que ser independiente de ese orden. La resolución aquí NO
// intenta adivinar cuál de las dos labels es "la real": aplica, siempre,
// la interpretación MÁS CONSERVADORA posible (in-progress > in-review >
// ready > backlog) — la que menos probabilidad tiene de re-despachar dos
// veces el mismo trabajo o de dejarlo fuera del cómputo del cap. El mismo
// resultado para las DOS órdenes del array es la prueba de independencia.
describe('mapGhIssue — status: ambiguo con más de una label a la vez, resuelto sin depender del orden del array (D1 finding 3)', () => {
  it('["status:in-progress","status:ready"] → resuelve a "in-progress", marcado ambiguo', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:in-progress' }, { name: 'status:ready' }], body: '' })
    expect(mapped.status).toBe('in-progress')
    expect(mapped.statusAmbiguous).toBe(true)
  })

  it('el MISMO array pero INVERTIDO → resuelve al MISMO status ("in-progress") — independiente del orden', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:ready' }, { name: 'status:in-progress' }], body: '' })
    expect(mapped.status).toBe('in-progress')
    expect(mapped.statusAmbiguous).toBe(true)
  })

  it('status:ready + status:in-review (ambos órdenes) → siempre "in-review", nunca "ready"', () => {
    const a = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:ready' }, { name: 'status:in-review' }], body: '' })
    const b = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:in-review' }, { name: 'status:ready' }], body: '' })
    expect(a.status).toBe('in-review')
    expect(b.status).toBe('in-review')
  })

  it('una sola label status: → sin ambigüedad, comportamiento normal sin cambios', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:ready' }], body: '' })
    expect(mapped.status).toBe('ready')
    expect(mapped.statusAmbiguous).toBe(false)
  })

  it('sin ninguna label status: → "backlog", sin ambigüedad', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'type:x' }], body: '' })
    expect(mapped.status).toBe('backlog')
    expect(mapped.statusAmbiguous).toBe(false)
  })

  it('tres labels status: a la vez (edición doblemente a medias) → sigue resolviendo por precedencia, sin reventar', () => {
    const mapped = mapGhIssue({
      number: 1, title: '#1 x',
      labels: [{ name: 'status:backlog' }, { name: 'status:ready' }, { name: 'status:in-progress' }],
      body: '',
    })
    expect(mapped.status).toBe('in-progress')
    expect(mapped.statusAmbiguous).toBe(true)
  })

  // Menor (review de D1): dos labels custom que NO son ninguna de las cuatro
  // conocidas (no gatean nada en dispatch.js — no cuenta como "ready" ni
  // "in-progress" en ningún sitio, así que la DECISIÓN de despacho es
  // idéntica pase lo que pase aquí) seguían resolviendo por el orden del
  // array vía `?? statusLabels[0]` — el mismo defecto que esta función existe
  // para no tener. El TEXTO del aviso sí depende de este valor: tiene que
  // ser independiente del orden igual que el resto de la función.
  it('dos labels status: custom (ninguna de las cuatro conocidas) → el fallback es independiente del orden del array (alfabético, no "el primero del array")', () => {
    const a = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:paused' }, { name: 'status:blocked' }], body: '' })
    const b = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'status:blocked' }, { name: 'status:paused' }], body: '' })
    expect(a.status).toBe(b.status) // el mismo resultado sin importar el orden de entrada
    expect(a.status).toBe('blocked') // determinista: "blocked" < "paused" alfabéticamente
  })
})

// D1 finding 4: una label "area:" o "touches:" SIN VALOR (el colon presente,
// nada detrás — p.ej. creada por accidente en el editor de GitHub) pela a
// una cadena VACÍA tras quitarle el prefijo. Dos issues así "colisionan"
// sobre el token '' aunque no compartan ningún área/touch real — y el
// mensaje de colisión en ct-next.mjs lo mostraría como `comparte el token
// ''`. Un token vacío no representa nada: se descarta antes de entrar en la
// maquinaria de colisión (dispatch.js#touchesConflict), igual que un dep de
// orden no mapeable se descarta a `null` en vez de colar un valor basura.
describe('mapGhIssue — una label "area:"/"touches:" sin valor no produce un token vacío colisionable (D1 finding 4)', () => {
  it('label "area:" sin nada detrás del colon → touches no incluye la cadena vacía', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'area:' }, { name: 'status:ready' }], body: '' })
    expect(mapped.touches).toEqual([])
  })

  it('label "touches:" sin valor + un area: real → solo el token real sobrevive, nunca la cadena vacía', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'touches:' }, { name: 'area:api' }], body: '' })
    expect(mapped.touches).toEqual(['api'])
  })

  it('dos issues que SOLO comparten la label rota "area:" (sin valor) → selectNext NO los trata como colisión (el token vacío no cuenta)', () => {
    const a = mapGhIssue({ number: 1, title: '#1 a', labels: [{ name: 'status:ready' }, { name: 'area:' }], body: '<!-- ct-order:1 -->' })
    const b = mapGhIssue({ number: 2, title: '#2 b', labels: [{ name: 'status:ready' }, { name: 'area:' }], body: '<!-- ct-order:2 -->' })
    const selected = selectNext([a, b], { mergedIssues: [], runningTouches: [], concurrencyCap: 2 })
    expect(selected.map((i) => i.n)).toEqual([1, 2]) // ambos, sin colisión espuria
  })

  // Ataque adversarial (no un ejemplo del auditor): "area: " — colon seguido
  // de un espacio en blanco, sin contenido real detrás — pela a ' ' (un
  // espacio, NO la cadena vacía). Un filtro que solo comprueba
  // `t.length > 0` deja pasar este token igual de vacío-de-contenido, y dos
  // issues con esta variante volverían a "colisionar" sobre ' ' — el MISMO
  // bug del finding, con un carácter distinto.
  it('label "area: " (colon + espacio en blanco, sin contenido real) → tampoco produce un token colisionable', () => {
    const mapped = mapGhIssue({ number: 1, title: '#1 x', labels: [{ name: 'area: ' }], body: '' })
    expect(mapped.touches).toEqual([])
  })

  it('dos issues que comparten SOLO "area: " (espacio en blanco) → tampoco colisionan', () => {
    const a = mapGhIssue({ number: 1, title: '#1 a', labels: [{ name: 'status:ready' }, { name: 'area: ' }], body: '<!-- ct-order:1 -->' })
    const b = mapGhIssue({ number: 2, title: '#2 b', labels: [{ name: 'status:ready' }, { name: 'area: ' }], body: '<!-- ct-order:2 -->' })
    const selected = selectNext([a, b], { mergedIssues: [], runningTouches: [], concurrencyCap: 2 })
    expect(selected.map((i) => i.n)).toEqual([1, 2])
  })
})
