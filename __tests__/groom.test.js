import { describe, it, expect } from 'vitest'
import { buildIssueTitle, buildLabels, buildIssueBody, groomPlan, renderDepsContent, renderAcContent, DEPS_ORDER_NOTE } from '../scripts/groom.js'

// F3: el título del issue viene de `slice.name` (columna "Slice" del spec),
// no de `slice.entrega` (columna "Entrega") — buildIssueTitle componía
// "#N <Entrega>" mientras "Slice" se descartaba salvo por su "#NN", así que
// un autor que escribe lo natural (nombre corto en Slice, descripción en
// Entrega) recibía un párrafo como título. `entrega` ahora es una
// descripción OPCIONAL que renderiza en el cuerpo (ver más abajo).
const SLICE = { n: 2, issue: null, name: 'refresh token', type: 'backend', entrega: 'flujo de refresco de sesión', deps: [1], ac: ['AC-2.1'], protected: 'schema §6' }

// SPEC_REF (F10): buildIssueBody/groomPlan ya no reciben `{ specPath,
// specSection }` (una ruta tal cual venía en argv + un número de sección que
// se convertía en un ancla inexistente), sino la referencia YA RESUELTA por
// scripts/spec-link.js: ruta relativa a la raíz del repo, texto del
// encabezado real de la §9, y la URL absoluta que se verificó contra GitHub.
const SPEC_REF = {
  path: 'docs/spec.md',
  heading: '9. Slices',
  url: 'https://github.com/o/r/blob/main/docs/spec.md#9-slices',
  reason: null,
}

describe('groom puro', () => {
  it('title lleva orden + name (columna Slice), no Entrega', () => {
    expect(buildIssueTitle(SLICE)).toBe('#2 refresh token')
  })
  // F21: la label `gate:` se une a la salida de buildLabels. `gate:none` es
  // la que corresponde a un slice `backend` sin celda `Gate` — ver
  // gates.js#GATE_LABEL_NONE para por qué "ningún gate" se AFIRMA con una
  // label en vez de dejarse en silencio.
  it('labels: type + gate + status:backlog', () => {
    expect(buildLabels(SLICE)).toEqual(['type:backend', 'gate:plan', 'status:backlog'])
  })
  it('body: link al spec, AC, deps como merge-after, protected', () => {
    const b = buildIssueBody(SLICE, SPEC_REF)
    expect(b).toContain('[docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)')
    expect(b).toContain('AC-2.1')
    expect(b).toContain('merge-after `#1`')
    expect(b).toContain('schema §6')
  })
  // F3: "Entrega" ya no alimenta el título — se convierte en una sección de
  // descripción dentro del cuerpo (decisión: justo debajo del link al spec y
  // ANTES de "Acceptance criteria", para que quien lea el issue sepa QUÉ
  // entrega el slice antes de leer sus criterios de aceptación).
  it('body: "Entrega" renderiza como sección "## Descripción", antes de "Acceptance criteria"', () => {
    const b = buildIssueBody(SLICE, SPEC_REF)
    expect(b).toContain('## Descripción')
    expect(b).toContain('flujo de refresco de sesión')
    expect(b.indexOf('## Descripción')).toBeLessThan(b.indexOf('## Acceptance criteria'))
  })
  it('body: sin "Entrega" (vacía/undefined) → sin sección "Descripción"', () => {
    const b = buildIssueBody({ ...SLICE, entrega: '' }, SPEC_REF)
    expect(b).not.toContain('## Descripción')
    const b2 = buildIssueBody({ ...SLICE, entrega: undefined }, SPEC_REF)
    expect(b2).not.toContain('## Descripción')
  })
  it.each(['-', '–', '—', '―', '−', '--'])('body: "Entrega" con marcador de "sin valor" ("%s") → sin sección "Descripción", mismo criterio que Protegido', (marker) => {
    const b = buildIssueBody({ ...SLICE, entrega: marker }, SPEC_REF)
    expect(b).not.toContain('## Descripción')
  })
  it('body sin deps → sin merge-after', () => {
    const b = buildIssueBody({ ...SLICE, deps: [] }, SPEC_REF)
    expect(b).not.toContain('merge-after')
  })
  // F6, grave 1 — VERIFICADO CONTRA GITHUB DE VERDAD (API /markdown con
  // `context=josemerca/ct-loop-sandbox`, y el `body_html` real del issue #4 de
  // ese repo): un `#N` DESNUDO en el body de un issue se renderiza como un
  // ENLACE al issue N de ese repo en cuanto ese issue existe. El número que
  // groom escribe aquí es el ORDEN del slice en la tabla §9, no un número de
  // issue — así que en un repo que va por el #447, "merge-after #1" enlaza a
  // un issue antiguo sin ninguna relación, y quien abra el issue lee una
  // dependencia falsa sin forma de saber que lo es. En el sandbox se comprobó
  // literalmente: el issue #4 (slice 3) tiene "merge-after #2" y GitHub lo
  // enlazó a `issues/2`, que es el issue del slice 1.
  //
  // La misma comprobación mostró que `#N` DENTRO de código inline
  // (`` `#2` ``) NO se autoenlaza — de ahí el formato.
  it('body: la dependencia se emite como código inline (`#N`), nunca como "#N" desnudo (GitHub lo autoenlazaría al issue N)', () => {
    const b = buildIssueBody(SLICE, SPEC_REF)
    expect(b).toContain('- merge-after `#1`')
    expect(b).not.toMatch(/merge-after #\d/)
  })
  it('body: la sección Dependencias dice explícitamente que el número es orden de slice, no issue', () => {
    const b = buildIssueBody(SLICE, SPEC_REF)
    expect(b).toContain(DEPS_ORDER_NOTE)
    expect(DEPS_ORDER_NOTE.toLowerCase()).toMatch(/orden/)
    expect(DEPS_ORDER_NOTE.toLowerCase()).toMatch(/issue/)
    // La propia nota no puede introducir un "#<dígitos>" desnudo: sería otro
    // autoenlace falso, y además `extractDepsInSection` la leería como una
    // referencia no cubierta (`malformed`).
    expect(DEPS_ORDER_NOTE).not.toMatch(/#\d/)
  })
  // El mismo autoenlace falso vivía en la PRIMERA línea del body: el
  // `body_html` real del issue #4 del sandbox muestra "Slice #3 del epic" con
  // el "#3" convertido en un enlace a `issues/3` — el issue del slice 2.
  it('body: el enlace al spec cita el orden como código inline, nunca "#N" desnudo', () => {
    const b = buildIssueBody(SLICE, SPEC_REF)
    expect(b.split('\n')[0]).toContain('> Slice `#2` del epic')
    expect(b).not.toMatch(/> Slice #\d/)
  })
  // renderDepsContent/renderAcContent son la ÚNICA fuente de verdad de "qué
  // debería decir" cada sección — compartida entre CREAR el issue (aquí) y
  // RECONCILIARLO después (scripts/reconcile.js#buildReconcileBody, que hasta
  // F6 tenía su propia copia del formato: dos implementaciones del mismo
  // criterio que ya divergían en cuanto una de las dos cambiara).
  it('el body creado usa exactamente renderDepsContent/renderAcContent (una sola fuente de verdad con --reconcile)', () => {
    const b = buildIssueBody(SLICE, SPEC_REF)
    expect(b).toContain(renderDepsContent([1]))
    expect(b).toContain(renderAcContent(['AC-2.1']))
  })
  it('groomPlan agrega milestone + issues', () => {
    const plan = groomPlan([SLICE], { milestone: 'Epic X', specPath: 'x', specSection: '9' })
    expect(plan.milestone).toBe('Epic X')
    expect(plan.issues).toHaveLength(1)
    expect(plan.issues[0].labels).toContain('type:backend')
  })
  it('body emite marcador ct-order exacto', () => {
    const b = buildIssueBody(SLICE, SPEC_REF)
    expect(b).toContain('<!-- ct-order:2 -->')
  })
  it('buildIssueBody defensivo: undefined ac + deps', () => {
    const incomplete = { n: 5, type: 'frontend', entrega: 'fix', ac: undefined, deps: undefined, protected: '–' }
    const b = buildIssueBody(incomplete, SPEC_REF)
    expect(b).toContain('(rellenar desde el spec)')
    expect(b).not.toContain('merge-after')
  })
  it('buildLabels con type vacío: solo status:backlog', () => {
    const empty = { n: 1, type: '', entrega: 'x', deps: [], ac: [], protected: '–' }
    expect(buildLabels(empty)).toEqual(['gate:plan', 'status:backlog'])
  })
  // Review de F3, finding 1 (bug preexistente a F3, cerrado ahora): `Tipo`
  // con un marcador de "sin valor" ("–", "-", "—", etc. — el mismo criterio
  // que ya usan Dep/Acepta/Protegido/Área/Toca) es truthy en JS, así que
  // `if (slice.type)` lo trataba como un valor real y emitía la label
  // literal "type:–" — que `gh label create --force` crearía de verdad en
  // el repo del usuario. Mismo bug que "area:areamedicacion" por otra
  // puerta: un marcador que el propio contrato enseña a usar en todas las
  // demás columnas produce basura en esta. Las dos formas de decir "ninguno"
  // (celda vacía, celda con marcador) deben producir la MISMA salida.
  it.each(['-', '–', '—', '―', '−', '--'])('buildLabels con type = marcador de "sin valor" ("%s"): sin label "type:", igual que type vacío', (marker) => {
    const s = { n: 1, type: marker, entrega: 'x', deps: [], ac: [], protected: '–' }
    expect(buildLabels(s)).toEqual(['gate:plan', 'status:backlog'])
  })
  it('buildLabels emite area:/touches: por cada token, en orden tipo→area→touches→status', () => {
    const s = { ...SLICE, area: ['api'], touches: ['db', 'migration'] }
    expect(buildLabels(s)).toEqual(['type:backend', 'area:api', 'touches:db', 'touches:migration', 'gate:plan', 'status:backlog'])
  })
  it('buildLabels sin area/touches (undefined, spec vieja) produce exactamente la salida de hoy', () => {
    expect(buildLabels(SLICE)).toEqual(['type:backend', 'gate:plan', 'status:backlog'])
  })
  it('buildLabels con area/touches vacíos ([]) produce exactamente la salida de hoy', () => {
    const s = { ...SLICE, area: [], touches: [] }
    expect(buildLabels(s)).toEqual(['type:backend', 'gate:plan', 'status:backlog'])
  })
  it('groomPlan rechaza órdenes de slice duplicados, nombrando el/los duplicados', () => {
    const dup1 = { ...SLICE, n: 1 }
    const dup2 = { ...SLICE, n: 1 }
    expect(() => groomPlan([dup1, dup2], { milestone: 'Epic', specPath: 'x', specSection: '9' }))
      .toThrow(/1/)
  })
  it('groomPlan con órdenes únicos sigue funcionando (regresión)', () => {
    const a = { ...SLICE, n: 1 }
    const b = { ...SLICE, n: 2 }
    const plan = groomPlan([a, b], { milestone: 'Epic', specPath: 'x', specSection: '9' })
    expect(plan.issues).toHaveLength(2)
  })
  // Bug de review: buildIssueBody solo trataba el em dash literal ('–',
  // U+2013) como "sin valor" para Protegido — las otras cuatro variantes que
  // isNoValueCell acepta en TODAS las demás columnas (Dep/Acepta/Área/Toca)
  // colaban como si fueran contenido real, produciendo un bullet basura
  // ("- 🚫 -", "- 🚫 —", "- 🚫 −") en el body del issue. Las cinco variantes
  // deben producir "(ninguno declarado)", igual que las demás columnas.
  it.each(['-', '–', '—', '―', '−', '--'])('Protegido "%s" (marcador de "sin valor") → "(ninguno declarado)", no un bullet basura', (marker) => {
    const b = buildIssueBody({ ...SLICE, protected: marker }, SPEC_REF)
    expect(b).toContain('(ninguno declarado)')
    expect(b).not.toMatch(/🚫 .*[-–—―−]\s*$/m)
  })
  it('Protegido con contenido real sigue emitiendo su bullet 🚫', () => {
    const b = buildIssueBody({ ...SLICE, protected: 'schema §6' }, SPEC_REF)
    expect(b).toContain('🚫 schema §6')
  })
  it('groomPlan nombra todos los órdenes duplicados cuando hay más de uno', () => {
    const s1a = { ...SLICE, n: 1 }
    const s1b = { ...SLICE, n: 1 }
    const s2 = { ...SLICE, n: 2 }
    const s3a = { ...SLICE, n: 3 }
    const s3b = { ...SLICE, n: 3 }
    let message = ''
    try {
      groomPlan([s1a, s1b, s2, s3a, s3b], { milestone: 'Epic', specPath: 'x', specSection: '9' })
    } catch (e) {
      message = e.message
    }
    expect(message).toMatch(/1/)
    expect(message).toMatch(/3/)
  })
})
