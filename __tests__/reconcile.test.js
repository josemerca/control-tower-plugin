import { describe, it, expect } from 'vitest'
import {
  ownedLabelsOnly, diffLabels, diffDeps, diffAc, diffIssue, hasDrift, formatDrift,
  buildReconcileEditArgs, buildReconcileBody, reconcileGaps, hasReconcileGap,
} from '../scripts/reconcile.js'
import { buildIssueBody } from '../scripts/groom.js'
import { extractAc, extractDeps, extractSectionContent, extractSpecLink } from '../scripts/gh-issue-map.js'

// F5 — el groom detecta divergencia, no solo existencia. Hasta ahora,
// ct-groom.mjs solo comprobaba "¿existe un issue con este marcador
// ct-order?" — si sí, "ya existe, no se duplica" y listo, sin mirar si el
// título/labels/milestone/AC/deps del issue siguen coincidiendo con lo que
// el spec produce HOY.
//
// Review round 3 (coordinador), tres Critical atendidos en este fichero:
//   1. locateSection (gh-issue-map.js) no anclaba a columna 0 ni era
//      consciente de vallas de código — tests de eso en gh-issue-map.test.js.
//   2. --reconcile podía salir 0 sobre una divergencia real (ac/deps)
//      reportada pero no aplicada (cabecera renombrada/ausente) —
//      reconcileGaps/hasReconcileGap rastrean exactamente esto.
//   3. El dominio de detección (extractDeps/extractAc) y el de aplicación
//      (buildReconcileBody) ahora son el MISMO: solo el contenido de la
//      sección reconocida, nunca todo el body.
// Y un punto de fondo (6): Descripción/Protegido se reportan (nota:), pero
// YA NO cuentan para el exit code — anclar el exit a prosa que se edita de
// forma rutinaria sería el mismo problema de ruido que ya se cerró para las
// labels, en la otra dirección.

describe('ownedLabelsOnly — el spec solo es autoridad sobre los prefijos cuya columna trae la tabla §9', () => {
  it('con los tres prefijos activos: conserva type:/area:/touches:, descarta status: y labels ajenas', () => {
    const labels = ['type:backend', 'area:api', 'touches:db', 'status:in-progress', 'status:backlog', 'good first issue', 'priority:high']
    expect(ownedLabelsOnly(labels, ['type:', 'area:', 'touches:'])).toEqual(['type:backend', 'area:api', 'touches:db'])
  })
  it('lista vacía / undefined → []', () => {
    expect(ownedLabelsOnly([], ['type:', 'area:', 'touches:'])).toEqual([])
    expect(ownedLabelsOnly(undefined, ['type:', 'area:', 'touches:'])).toEqual([])
  })
  it('sin "area:" en los prefijos activos (columna Área ausente en la tabla): nunca se reporta, aunque el label exista', () => {
    const labels = ['type:backend', 'area:ops']
    expect(ownedLabelsOnly(labels, ['type:', 'touches:'])).toEqual(['type:backend'])
  })
  it('sin "touches:" en los prefijos activos: igual, se descarta', () => {
    expect(ownedLabelsOnly(['touches:db', 'type:x'], ['type:'])).toEqual(['type:x'])
  })
  it('sin "type:" en los prefijos activos (columna Tipo ausente): igual criterio', () => {
    expect(ownedLabelsOnly(['type:backend', 'area:api'], ['area:'])).toEqual(['area:api'])
  })
})

describe('diffLabels — solo compara los prefijos activos (columna presente en la tabla §9)', () => {
  const ALL = ['type:', 'area:', 'touches:']
  it('sin diferencias → missing y extra vacíos', () => {
    const d = diffLabels(['type:backend', 'area:api', 'status:in-progress'], ['type:backend', 'area:api', 'status:backlog'], ALL)
    expect(d).toEqual({ missing: [], extra: [] })
  })
  it('falta una label que el spec pide → missing', () => {
    const d = diffLabels(['status:backlog'], ['type:backend', 'status:backlog'], ALL)
    expect(d.missing).toEqual(['type:backend'])
    expect(d.extra).toEqual([])
  })
  it('sobra una label type:/area:/touches: que el spec ya no produce → extra', () => {
    const d = diffLabels(['type:ios', 'status:backlog'], ['type:backend', 'status:backlog'], ALL)
    expect(d.missing).toEqual(['type:backend'])
    expect(d.extra).toEqual(['type:ios'])
  })
  it('status:in-progress (o cualquier status: distinto de backlog) nunca aparece como extra', () => {
    const d = diffLabels(['type:backend', 'area:api', 'status:in-progress'], ['type:backend', 'area:api', 'status:backlog'], ALL)
    expect(d.extra).toEqual([])
    expect(d.missing).toEqual([])
  })
  it('una label ajena al spec (sin prefijo type:/area:/touches:) nunca se reporta', () => {
    const d = diffLabels(['type:backend', 'good first issue', 'priority:high'], ['type:backend'], ALL)
    expect(d.extra).toEqual([])
  })
  it('sin "area:" en los prefijos activos: un area: puesto a mano en el issue nunca es "extra"', () => {
    const d = diffLabels(['type:backend', 'area:ops'], ['type:backend'], ['type:', 'touches:'])
    expect(d.extra).toEqual([])
    expect(d.missing).toEqual([])
  })
})

describe('diffDeps / diffAc — comparación estructurada de las secciones que lee el dispatcher (set-based, sin importar el orden)', () => {
  it('diffDeps: sin diferencias → vacío', () => {
    expect(diffDeps([1, 2], [2, 1])).toEqual({ missing: [], extra: [] })
  })
  it('diffDeps: falta una dependencia que el spec pide', () => {
    expect(diffDeps([1], [1, 2])).toEqual({ missing: [2], extra: [] })
  })
  it('diffDeps: sobra una dependencia que el issue tiene y el spec ya no produce', () => {
    expect(diffDeps([1, 2], [1])).toEqual({ missing: [], extra: [2] })
  })
  it('diffAc: sin diferencias → vacío', () => {
    expect(diffAc(['AC-1.1', 'AC-1.2'], ['AC-1.2', 'AC-1.1'])).toEqual({ missing: [], extra: [] })
  })
  it('diffAc: falta un criterio que el spec pide', () => {
    expect(diffAc(['AC-1.1'], ['AC-1.1', 'AC-1.2'])).toEqual({ missing: ['AC-1.2'], extra: [] })
  })
  it('diffAc: sobra un criterio que el issue tiene y el spec ya no produce', () => {
    expect(diffAc(['AC-1.1', 'AC-1.2'], ['AC-1.1'])).toEqual({ missing: [], extra: ['AC-1.2'] })
  })
})

const SPEC_LINK = '> Slice #2 del epic. Spec: [docs/spec.md#9](docs/spec.md#9)'
const WANTED_ISSUE = {
  order: 2, title: '#2 refresh token', labels: ['type:backend', 'status:backlog'],
  deps: [1], ac: ['AC-2.1'], descripcion: 'flujo de refresco', protectedLine: '- 🚫 schema §6',
  specLink: SPEC_LINK,
}
const ALL_PREFIXES = ['type:', 'area:', 'touches:']

function existingWith(overrides) {
  return {
    number: 42,
    title: '#2 refresh token',
    state: 'open',
    milestone: { title: 'Epic' },
    labels: [{ name: 'type:backend' }],
    body: [
      SPEC_LINK, '',
      '## Descripción', 'flujo de refresco', '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
      '## Dependencias', '- merge-after #1', '',
      '## Out of scope / Protected', '- 🚫 schema §6', '',
      '<!-- ct-order:2 -->',
    ].join('\n'),
    ...overrides,
  }
}

describe('diffIssue — compara título, milestone, enlace-al-spec, labels (prefijos activos), deps, ac y prosa (booleano) contra un issue existente', () => {
  it('todo coincide → sin ninguna divergencia', () => {
    const d = diffIssue(existingWith({}), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.title).toBeNull()
    expect(d.milestone).toBeNull()
    expect(d.specLink).toBeNull()
    expect(d.labels).toEqual({ missing: [], extra: [] })
    expect(d.deps).toEqual({ missing: [], extra: [] })
    expect(d.ac).toEqual({ missing: [], extra: [] })
    expect(d.descripcionDiffers).toBe(false)
    expect(d.protectedDiffers).toBe(false)
    expect(d.closed).toBe(false)
    expect(d.duplicateSections).toEqual([])
  })
  it('enlace al spec divergente (el spec se movió de sitio) → { current, wanted }', () => {
    const movedSpec = { ...WANTED_ISSUE, specLink: '> Slice #2 del epic. Spec: [docs/otra-ruta.md#9](docs/otra-ruta.md#9)' }
    const d = diffIssue(existingWith({}), movedSpec, 'Epic', ALL_PREFIXES)
    expect(d.specLink).toEqual({ current: SPEC_LINK, wanted: movedSpec.specLink })
  })
  it('enlace al spec ausente en el issue (un humano la borró) → current: null', () => {
    const noSpecLink = existingWith({ body: existingWith({}).body.split('\n').slice(2).join('\n') })
    const d = diffIssue(noSpecLink, WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.specLink).toEqual({ current: null, wanted: SPEC_LINK })
  })
  it('deps divergentes (issue con #1, spec ahora también pide #3)', () => {
    const d = diffIssue(existingWith({}), { ...WANTED_ISSUE, deps: [1, 3] }, 'Epic', ALL_PREFIXES)
    expect(d.deps).toEqual({ missing: [3], extra: [] })
  })
  it('deps sobrantes (issue con #1 y #4, spec ya no pide #4)', () => {
    const withExtra = existingWith({
      body: [
        SPEC_LINK, '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
        '## Dependencias', '- merge-after #1', '- merge-after #4', '',
        '## Out of scope / Protected', '- 🚫 schema §6', '',
        '<!-- ct-order:2 -->',
      ].join('\n'),
    })
    const d = diffIssue(withExtra, WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.deps).toEqual({ missing: [], extra: [4] })
  })
  // Critical 3 (dominio de detección = dominio de aplicación): un
  // "merge-after" suelto FUERA de "## Dependencias" (aquí, dentro de
  // Descripción) NUNCA cuenta como dependencia real para F5 — a
  // diferencia de gh-issue-map.js#extractDeps (que usa el DISPATCHER real
  // y sí escanea todo el body), diffIssue solo mira dentro de la sección
  // reconocida. Es la mitad de "detección" de la garantía de Critical 3:
  // la otra mitad (que --reconcile tampoco reporte éxito sin haber podido
  // arreglarlo) se prueba en la suite de ct-groom.mjs.
  it('un "merge-after" suelto en Descripción (fuera de "## Dependencias") NO cuenta como dependencia — mismo dominio que la aplicación', () => {
    const stray = existingWith({
      body: [
        SPEC_LINK, '',
        '## Descripción', 'menciona merge-after #9 de pasada, no es una dependencia real', '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
        '## Dependencias', '- merge-after #1', '',
        '## Out of scope / Protected', '- 🚫 schema §6', '',
        '<!-- ct-order:2 -->',
      ].join('\n'),
    })
    const d = diffIssue(stray, WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.deps).toEqual({ missing: [], extra: [] }) // #9 no se cuela
  })
  it('AC divergente (falta un criterio que el spec ahora pide)', () => {
    const d = diffIssue(existingWith({}), { ...WANTED_ISSUE, ac: ['AC-2.1', 'AC-2.2'] }, 'Epic', ALL_PREFIXES)
    expect(d.ac).toEqual({ missing: ['AC-2.2'], extra: [] })
  })
  it('Descripción divergente (contenido distinto) → descripcionDiffers true, SIN volcar el texto en el diff', () => {
    const d = diffIssue(existingWith({ body: existingWith({}).body.replace('flujo de refresco', 'otro flujo distinto') }), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.descripcionDiffers).toBe(true)
  })
  it('Descripción ausente en el issue cuando el spec SÍ la pide → diverge', () => {
    const withoutDescripcion = existingWith({
      body: [
        SPEC_LINK, '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
        '## Dependencias', '- merge-after #1', '',
        '## Out of scope / Protected', '- 🚫 schema §6', '',
        '<!-- ct-order:2 -->',
      ].join('\n'),
    })
    const d = diffIssue(withoutDescripcion, WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.descripcionDiffers).toBe(true)
  })
  it('sin Descripción en ninguno de los dos lados → no diverge (silencio real)', () => {
    const noDescripcionBody = [
      SPEC_LINK, '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
      '## Dependencias', '- merge-after #1', '',
      '## Out of scope / Protected', '- 🚫 schema §6', '',
      '<!-- ct-order:2 -->',
    ].join('\n')
    const d = diffIssue(existingWith({ body: noDescripcionBody }), { ...WANTED_ISSUE, descripcion: null }, 'Epic', ALL_PREFIXES)
    expect(d.descripcionDiffers).toBe(false)
  })
  it('Protegido divergente → protectedDiffers true', () => {
    const d = diffIssue(existingWith({ body: existingWith({}).body.replace('schema §6', 'otra cosa') }), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.protectedDiffers).toBe(true)
  })
  it('labels: solo se comparan los prefijos activos (columna presente) — sin "area:" activo, un area: puesto a mano no cuenta', () => {
    const withAreaLabel = existingWith({ labels: [{ name: 'type:backend' }, { name: 'area:ops' }] })
    const d = diffIssue(withAreaLabel, WANTED_ISSUE, 'Epic', ['type:', 'touches:']) // "area:" fuera de los prefijos activos
    expect(d.labels).toEqual({ missing: [], extra: [] })
  })
  it('acepta labels como array de strings además de array de {name}', () => {
    const d = diffIssue(existingWith({ labels: ['type:backend'] }), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.labels).toEqual({ missing: [], extra: [] })
  })
  it('issue cerrado → closed:true, junto con cualquier otra divergencia', () => {
    const d = diffIssue(existingWith({ state: 'closed', title: '#2 otro título' }), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.closed).toBe(true)
    expect(d.title).not.toBeNull()
  })
  // Menor (headings duplicados): informativo, no cuenta para hasDrift.
  it('una sección conocida duplicada (## Dependencias dos veces) se detecta en duplicateSections', () => {
    const dup = existingWith({
      body: [
        SPEC_LINK, '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
        '## Dependencias', '- merge-after #1', '',
        '## Dependencias', '- merge-after #1', '',
        '## Out of scope / Protected', '- 🚫 schema §6', '',
        '<!-- ct-order:2 -->',
      ].join('\n'),
    })
    const d = diffIssue(dup, WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.duplicateSections).toContain('Dependencias')
    expect(hasDrift(d)).toBe(false) // no cuenta para el exit code
  })
})

describe('hasDrift — título/milestone/enlace-al-spec/labels/deps/ac cuentan; closed/prosa NUNCA (review round 3, punto 6)', () => {
  const CLEAN = {
    order: 1, issueNumber: 1, closed: false, title: null, milestone: null, specLink: null,
    labels: { missing: [], extra: [] }, deps: { missing: [], extra: [] }, ac: { missing: [], extra: [] },
    descripcionDiffers: false, protectedDiffers: false, duplicateSections: [],
  }
  it('sin ninguna divergencia → false, aunque esté cerrado', () => {
    expect(hasDrift({ ...CLEAN, closed: true })).toBe(false)
  })
  it('deps.missing no vacío → true', () => {
    expect(hasDrift({ ...CLEAN, deps: { missing: [3], extra: [] } })).toBe(true)
  })
  it('ac.extra no vacío → true', () => {
    expect(hasDrift({ ...CLEAN, ac: { missing: [], extra: ['AC-9'] } })).toBe(true)
  })
  it('specLink divergente → true', () => {
    expect(hasDrift({ ...CLEAN, specLink: { current: 'a', wanted: 'b' } })).toBe(true)
  })
  // Punto 6 de la review round 3: una divergencia que --reconcile NUNCA
  // puede resolver (prosa) no debe anclar el exit code para siempre — el
  // mismo argumento de ruido que ya justificó gatear las labels por
  // columna, en la dirección opuesta.
  it('descripcionDiffers → NUNCA cuenta (ya no ancla el exit code)', () => {
    expect(hasDrift({ ...CLEAN, descripcionDiffers: true })).toBe(false)
  })
  it('protectedDiffers → NUNCA cuenta', () => {
    expect(hasDrift({ ...CLEAN, protectedDiffers: true })).toBe(false)
  })
  it('duplicateSections → NUNCA cuenta (informativo)', () => {
    expect(hasDrift({ ...CLEAN, duplicateSections: ['Dependencias'] })).toBe(false)
  })
})

describe('formatDrift — divergencia: (cuenta) vs. nota: (no cuenta); deps/ac/specLink muestran el valor, Descripción/Protegido solo el flag', () => {
  const BASE = {
    order: 2, issueNumber: 42, closed: false, title: null, milestone: null, specLink: null,
    labels: { missing: [], extra: [] }, deps: { missing: [], extra: [] }, ac: { missing: [], extra: [] },
    descripcionDiffers: false, protectedDiffers: false, duplicateSections: [],
  }
  it('sin nada que reportar → []', () => {
    expect(formatDrift(BASE)).toEqual([])
  })
  it('specLink divergente → línea "divergencia:" con ambos valores', () => {
    const lines = formatDrift({ ...BASE, specLink: { current: 'vieja', wanted: 'nueva' } })
    expect(lines[0]).toMatch(/^divergencia:/)
    expect(lines[0]).toMatch(/"vieja"/)
    expect(lines[0]).toMatch(/"nueva"/)
  })
  it('deps faltante/sobrante → una línea "divergencia:" por cada una, nombrando merge-after #N', () => {
    const lines = formatDrift({ ...BASE, deps: { missing: [3], extra: [4] } })
    expect(lines.find((l) => l.includes('merge-after #3'))).toMatch(/^divergencia:.*falta/i)
    expect(lines.find((l) => l.includes('merge-after #4'))).toMatch(/^divergencia:.*sobra/i)
  })
  it('ac faltante/sobrante → una línea "divergencia:" por cada una, con el texto del criterio', () => {
    const lines = formatDrift({ ...BASE, ac: { missing: ['AC-2.2'], extra: ['AC-9.9'] } })
    expect(lines.find((l) => l.includes('AC-2.2'))).toMatch(/^divergencia:.*falta/i)
    expect(lines.find((l) => l.includes('AC-9.9'))).toMatch(/^divergencia:.*sobra/i)
  })
  // Punto 6: Descripción/Protegido son "nota:", NUNCA "divergencia:" — y se
  // reportan aunque sean LO ÚNICO que hay (no hace falta ninguna otra
  // divergencia real para que aparezcan).
  it('Descripción/Protegido divergentes (solos, sin ninguna otra divergencia) → líneas "nota:", mencionan la sección, nunca el texto completo', () => {
    const lines = formatDrift({ ...BASE, descripcionDiffers: true, protectedDiffers: true })
    expect(lines).toHaveLength(2)
    expect(lines.every((l) => l.startsWith('nota:'))).toBe(true)
    expect(lines.some((l) => l.includes('Descripción'))).toBe(true)
    expect(lines.some((l) => l.includes('Out of scope / Protected'))).toBe(true)
    for (const l of lines) expect(l.length).toBeLessThan(220) // nunca vuelca prosa completa
  })
  it('duplicateSections → una línea "nota:" por sección duplicada', () => {
    const lines = formatDrift({ ...BASE, duplicateSections: ['Dependencias'] })
    expect(lines[0]).toMatch(/^nota:/)
    expect(lines[0]).toMatch(/Dependencias/)
    expect(lines[0]).toMatch(/más de una vez/)
  })
  it('issue cerrado CON algo que reportar (incluida prosa-solo) → nota final de "cerrado"', () => {
    const lines = formatDrift({ ...BASE, closed: true, descripcionDiffers: true })
    expect(lines[lines.length - 1]).toMatch(/cerrad.*reconcile/is)
  })
  it('issue cerrado SIN NADA que reportar → sin nota de cierre (closed solo, sigue siendo silencio real)', () => {
    expect(formatDrift({ ...BASE, closed: true })).toEqual([])
  })
})

describe('buildReconcileEditArgs — título/milestone/labels vía flags de `gh issue edit` (sin cambios)', () => {
  it('combina todos los campos divergentes de flag', () => {
    const d = { title: { current: 'a', wanted: 'b' }, milestone: { current: 'x', wanted: 'y' }, labels: { missing: ['type:backend'], extra: ['type:ios'] } }
    expect(buildReconcileEditArgs(d)).toEqual(['--title', 'b', '--milestone', 'y', '--add-label', 'type:backend', '--remove-label', 'type:ios'])
  })
  it('sin nada de eso → []', () => {
    expect(buildReconcileEditArgs({ title: null, milestone: null, labels: { missing: [], extra: [] } })).toEqual([])
  })
})

describe('reconcileGaps / hasReconcileGap — divergencia real que --reconcile no pudo aplicar (review round 3, Critical 2)', () => {
  const DIFF_CLEAN = { ac: { missing: [], extra: [] }, deps: { missing: [], extra: [] } }
  it('sin divergencia de ac/deps → sin gap, aunque bodyResult marque unresolved (no debería pasar, pero no basta por sí solo)', () => {
    const gaps = reconcileGaps(DIFF_CLEAN, { body: null, unresolvedAc: true, unresolvedDeps: true })
    expect(gaps).toEqual({ ac: false, deps: false })
    expect(hasReconcileGap(gaps)).toBe(false)
  })
  it('AC diverge Y no se pudo localizar la sección → gap.ac = true', () => {
    const diff = { ac: { missing: ['AC-1.2'], extra: [] }, deps: { missing: [], extra: [] } }
    const gaps = reconcileGaps(diff, { body: null, unresolvedAc: true, unresolvedDeps: false })
    expect(gaps.ac).toBe(true)
    expect(hasReconcileGap(gaps)).toBe(true)
  })
  it('AC diverge pero SÍ se pudo aplicar (unresolvedAc: false) → sin gap', () => {
    const diff = { ac: { missing: ['AC-1.2'], extra: [] }, deps: { missing: [], extra: [] } }
    const gaps = reconcileGaps(diff, { body: 'algo', unresolvedAc: false, unresolvedDeps: false })
    expect(gaps.ac).toBe(false)
    expect(hasReconcileGap(gaps)).toBe(false)
  })
})

describe('buildReconcileBody — splice quirúrgico de enlace-al-spec/AC/Dependencias, preserva todo lo demás (F5, review crítica)', () => {
  const SLICE = { n: 2, name: 'refresh', type: 'backend', entrega: 'flujo de refresco', deps: [1], ac: ['AC-2.1'], protected: 'schema §6' }
  const SPEC_OPTS = { specPath: 'spec.md', specSection: '9' }
  const GENERATED = buildIssueBody(SLICE, SPEC_OPTS)
  const WANTED_BASE = { deps: [1], ac: ['AC-2.1'], specLink: '> Slice #2 del epic. Spec: [spec.md#9](spec.md#9)' }

  it('sin divergencia de nada → body: null, unresolvedAc/unresolvedDeps: false (nada que aplicar)', () => {
    const r = buildReconcileBody(GENERATED, WANTED_BASE)
    expect(r).toEqual({ body: null, unresolvedAc: false, unresolvedDeps: false })
  })

  it('mismo conjunto de AC en otro orden → body: null (diffAc no lo considera divergencia, buildReconcileBody tampoco reescribe)', () => {
    const TWO_AC_SLICE = { ...SLICE, ac: ['AC-2.1', 'AC-2.2'] }
    const body = buildIssueBody(TWO_AC_SLICE, SPEC_OPTS)
    const r = buildReconcileBody(body, { ...WANTED_BASE, ac: ['AC-2.2', 'AC-2.1'] })
    expect(r.body).toBeNull()
  })

  it('AC divergente → reemplaza SOLO el contenido de "## Acceptance criteria", preserva Descripción/Dependencias/Protected/marcador intactos', () => {
    const { body: newBody, unresolvedAc } = buildReconcileBody(GENERATED, { ...WANTED_BASE, ac: ['AC-2.1', 'AC-2.2'] })
    expect(newBody).not.toBeNull()
    expect(unresolvedAc).toBe(false)
    expect(extractAc(newBody)).toEqual(['AC-2.1', 'AC-2.2'])
    expect(extractDeps(newBody)).toEqual([1]) // deps intactas
    expect(extractSectionContent(newBody, '## Descripción')).toBe('flujo de refresco') // intacta
    expect(extractSectionContent(newBody, '## Out of scope / Protected')).toBe('- 🚫 schema §6') // intacta
    expect(newBody).toContain('<!-- ct-order:2 -->') // marcador intacto
  })

  // Critical 2: si la cabecera de AC no existe (renombrada/borrada a mano),
  // buildReconcileBody NO inventa una posición — se rinde limpiamente y lo
  // informa vía unresolvedAc, en vez de fingir que aplicó algo.
  it('cabecera "## Acceptance criteria" renombrada/ausente → unresolvedAc: true, NO se inventa una posición, el resto de la sección de deps SÍ se puede seguir aplicando', () => {
    const renamed = GENERATED.replace('## Acceptance criteria (EARS, 1:1 con tests)', '## Criterios')
    const r = buildReconcileBody(renamed, { ...WANTED_BASE, ac: ['AC-2.1', 'AC-2.2'], deps: [1, 3] })
    expect(r.unresolvedAc).toBe(true)
    expect(extractAc(r.body ?? renamed)).not.toEqual(['AC-2.1', 'AC-2.2']) // no se aplicó
    expect(extractDeps(r.body)).toEqual([1, 3]) // pero deps SÍ se pudo aplicar (dominio independiente)
  })

  it('deps divergente (falta una) → añade la referencia, preserva AC/Descripción/Protected', () => {
    const { body: newBody } = buildReconcileBody(GENERATED, { ...WANTED_BASE, deps: [1, 3] })
    expect(extractDeps(newBody)).toEqual([1, 3])
    expect(extractAc(newBody)).toEqual(['AC-2.1'])
    expect(extractSectionContent(newBody, '## Descripción')).toBe('flujo de refresco')
  })

  it('deps divergente (sobra una) → la quita, preserva el resto', () => {
    const withTwoDeps = buildIssueBody({ ...SLICE, deps: [1, 3] }, SPEC_OPTS)
    const { body: newBody } = buildReconcileBody(withTwoDeps, { ...WANTED_BASE, deps: [1] })
    expect(extractDeps(newBody)).toEqual([1])
  })

  it('spec deja de tener deps (issue las conserva) → retira la sección "## Dependencias" entera', () => {
    const { body: newBody } = buildReconcileBody(GENERATED, { ...WANTED_BASE, deps: [] })
    expect(extractDeps(newBody)).toEqual([])
    expect(newBody).not.toContain('## Dependencias')
    expect(extractAc(newBody)).toEqual(['AC-2.1']) // no se toca lo demás
    expect(newBody).toContain('<!-- ct-order:2 -->')
  })

  it('spec empieza a tener deps (issue no tenía sección) → inserta "## Dependencias" antes de "## Out of scope / Protected"', () => {
    const noDeps = buildIssueBody({ ...SLICE, deps: [] }, SPEC_OPTS)
    expect(noDeps).not.toContain('## Dependencias')
    const { body: newBody } = buildReconcileBody(noDeps, { ...WANTED_BASE, deps: [5] })
    expect(extractDeps(newBody)).toEqual([5])
    expect(newBody.indexOf('## Dependencias')).toBeLessThan(newBody.indexOf('## Out of scope / Protected'))
    expect(extractSectionContent(newBody, '## Descripción')).toBe('flujo de refresco')
    expect(newBody).toContain('<!-- ct-order:2 -->')
  })

  // Menor: separador seguro al insertar en el caso degenerado (ni Deps ni
  // Protected existen) — antes se pegaba directamente al carácter anterior
  // (típicamente el marcador ct-order).
  it('inserción de deps sin "## Out of scope / Protected" (caso degenerado) NUNCA queda pegada al contenido anterior', () => {
    const noProtected = '> Slice #2 del epic. Spec: [x#9](x#9)\n\n## Acceptance criteria (EARS, 1:1 con tests)\n- AC-2.1\n\n<!-- ct-order:2 -->'
    const { body: newBody } = buildReconcileBody(noProtected, { ...WANTED_BASE, deps: [5] })
    expect(newBody).not.toMatch(/ct-order:2 -->## Dependencias/)
    expect(extractDeps(newBody)).toEqual([5])
  })

  it('contenido humano en una sección nueva ("## Notas") sobrevive intacto a un reconcile de AC', () => {
    const withHumanNotes = GENERATED.replace('<!-- ct-order:2 -->', '## Notas\nOjo con este slice, lo tocó Fulano.\n\n<!-- ct-order:2 -->')
    const { body: newBody } = buildReconcileBody(withHumanNotes, { ...WANTED_BASE, ac: ['AC-2.1', 'AC-2.2'] })
    expect(newBody).toContain('## Notas')
    expect(newBody).toContain('Ojo con este slice, lo tocó Fulano.')
    expect(extractAc(newBody)).toEqual(['AC-2.1', 'AC-2.2'])
  })

  // Enlace al spec (importante 5): se reescribe con un splice de una sola
  // línea, igual de quirúrgico que las secciones.
  it('enlace al spec divergente (el spec se movió) → se reemplaza la línea, preserva todo lo demás', () => {
    const { body: newBody } = buildReconcileBody(GENERATED, { ...WANTED_BASE, specLink: '> Slice #2 del epic. Spec: [otra-ruta.md#9](otra-ruta.md#9)' })
    expect(extractSpecLink(newBody)).toBe('> Slice #2 del epic. Spec: [otra-ruta.md#9](otra-ruta.md#9)')
    expect(extractAc(newBody)).toEqual(['AC-2.1'])
    expect(extractDeps(newBody)).toEqual([1])
    expect(newBody).toContain('<!-- ct-order:2 -->')
  })

  it('enlace al spec ausente (un humano lo borró) → se antepone al principio', () => {
    const withoutSpecLink = GENERATED.split('\n').slice(2).join('\n')
    const { body: newBody } = buildReconcileBody(withoutSpecLink, WANTED_BASE)
    expect(newBody.startsWith(WANTED_BASE.specLink)).toBe(true)
  })

  // Fence-awareness (Critical 1), verificado también end-to-end vía
  // buildReconcileBody: una mención de "## Dependencias" dentro de una
  // valla de código en Descripción no debe corromperse ni confundirse con
  // la sección real al aplicar un reconcile de deps.
  it('reconciliar deps con una mención de "## Dependencias" dentro de una valla en Descripción no corrompe la valla', () => {
    const withFence = [
      '> Slice #2 del epic. Spec: [spec.md#9](spec.md#9)', '',
      '## Descripción', 'Ejemplo:', '```', '## Dependencias', '- merge-after #99', '```', 'fin.', '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
      '## Dependencias', '- merge-after #1', '',
      '## Out of scope / Protected', '- 🚫 schema §6', '',
      '<!-- ct-order:2 -->',
    ].join('\n')
    const { body: newBody } = buildReconcileBody(withFence, { ...WANTED_BASE, deps: [1, 3] })
    expect(newBody).toContain('```\n## Dependencias\n- merge-after #99\n```') // la valla sobrevive intacta
    expect(newBody).toContain('fin.')
    expect(extractDeps(extractSectionContent(newBody, '## Descripción'))).toEqual([99]) // la valla no se tocó
    const realDepsSection = extractSectionContent(newBody, '## Dependencias')
    expect(extractDeps(realDepsSection)).toEqual([1, 3]) // la sección REAL sí se actualizó
  })
})
