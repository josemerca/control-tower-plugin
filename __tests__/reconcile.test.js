import { describe, it, expect } from 'vitest'
import {
  ownedLabelsOnly, diffLabels, diffDeps, diffAc, diffIssue, hasDrift, formatDrift,
  buildReconcileEditArgs, buildReconcileBody,
} from '../scripts/reconcile.js'
import { buildIssueBody } from '../scripts/groom.js'
import { extractAc, extractDeps, extractSectionContent } from '../scripts/gh-issue-map.js'

// F5 — el groom detecta divergencia, no solo existencia. Hasta ahora,
// ct-groom.mjs solo comprobaba "¿existe un issue con este marcador
// ct-order?" — si sí, "ya existe, no se duplica" y listo, sin mirar si el
// título/labels/milestone/AC/deps del issue siguen coincidiendo con lo que
// el spec produce HOY.
//
// Review de la primera versión de esta feature (coordinador): excluir el
// body ENTERO tiraba justo lo que no es territorio humano — `merge-after
// #N` (deps, gh-issue-map.js → dispatch.js: gatea si un slice se puede
// despachar) y `## Acceptance criteria` (ac, gh-issue-map.js → kickoff.js:
// los criterios que recibe el agente) son datos ESTRUCTURADOS que el
// dispatcher obedece, no prosa libre — el body entero lo genera
// buildIssueBody a partir de una plantilla con secciones conocidas, así que
// compararlas SECCIÓN A SECCIÓN es preciso y legítimo. Solo el marcador
// ct-order (bookkeeping nuestro) y la prosa libre (Descripción/Protegido,
// que si se comparan es solo con un flag booleano, sin volcar el texto)
// quedan fuera del machine-readable diff.
//
// Esta capa pura decide QUÉ cuenta como divergencia, CÓMO se reporta, y
// CÓMO se aplica (--reconcile). ct-groom.mjs es pegamento delgado.

describe('ownedLabelsOnly — el spec solo es autoridad sobre los prefijos cuya columna trae la tabla §9', () => {
  it('con los tres prefijos activos: conserva type:/area:/touches:, descarta status: y labels ajenas', () => {
    const labels = ['type:backend', 'area:api', 'touches:db', 'status:in-progress', 'status:backlog', 'good first issue', 'priority:high']
    expect(ownedLabelsOnly(labels, ['type:', 'area:', 'touches:'])).toEqual(['type:backend', 'area:api', 'touches:db'])
  })
  it('lista vacía / undefined → []', () => {
    expect(ownedLabelsOnly([], ['type:', 'area:', 'touches:'])).toEqual([])
    expect(ownedLabelsOnly(undefined, ['type:', 'area:', 'touches:'])).toEqual([])
  })
  // Review, punto 2: si la tabla §9 no trae la columna "Área", el spec NO
  // tiene opinión sobre `area:` — no debe reclamar autoridad sobre un
  // prefijo que nunca decidió. Un falso positivo aquí ("sobra area:ops"
  // sobre una label que un humano puso a mano porque el spec nunca habló de
  // área) es ruido que enseña a ignorar el resto del reporte.
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
  // Review, punto 2 — end-to-end en diffLabels: sin la columna Área en la
  // tabla, un area:ops puesto a mano en el issue NUNCA es "extra".
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

const WANTED_ISSUE = {
  order: 2, title: '#2 refresh token', labels: ['type:backend', 'status:backlog'],
  deps: [1], ac: ['AC-2.1'], descripcion: 'flujo de refresco', protectedLine: '- 🚫 schema §6',
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
      '## Descripción', 'flujo de refresco', '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
      '## Dependencias', '- merge-after #1', '',
      '## Out of scope / Protected', '- 🚫 schema §6', '',
      '<!-- ct-order:2 -->',
    ].join('\n'),
    ...overrides,
  }
}

describe('diffIssue — compara título, milestone, labels (prefijos activos), deps, ac y prosa (booleano) contra un issue existente', () => {
  it('todo coincide → sin ninguna divergencia', () => {
    const d = diffIssue(existingWith({}), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.title).toBeNull()
    expect(d.milestone).toBeNull()
    expect(d.labels).toEqual({ missing: [], extra: [] })
    expect(d.deps).toEqual({ missing: [], extra: [] })
    expect(d.ac).toEqual({ missing: [], extra: [] })
    expect(d.descripcionDiffers).toBe(false)
    expect(d.protectedDiffers).toBe(false)
    expect(d.closed).toBe(false)
  })
  it('deps divergentes (issue con #1, spec ahora también pide #3)', () => {
    const d = diffIssue(existingWith({}), { ...WANTED_ISSUE, deps: [1, 3] }, 'Epic', ALL_PREFIXES)
    expect(d.deps).toEqual({ missing: [3], extra: [] })
  })
  it('deps sobrantes (issue con #1 y #4, spec ya no pide #4)', () => {
    const withExtra = existingWith({
      body: [
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
        '## Dependencias', '- merge-after #1', '- merge-after #4', '',
        '## Out of scope / Protected', '- 🚫 schema §6', '',
        '<!-- ct-order:2 -->',
      ].join('\n'),
    })
    const d = diffIssue(withExtra, WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.deps).toEqual({ missing: [], extra: [4] })
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
})

describe('hasDrift — incluye deps/ac/prosa; closed por sí solo NO cuenta', () => {
  const CLEAN = { order: 1, issueNumber: 1, closed: false, title: null, milestone: null, labels: { missing: [], extra: [] }, deps: { missing: [], extra: [] }, ac: { missing: [], extra: [] }, descripcionDiffers: false, protectedDiffers: false }
  it('sin ninguna divergencia → false, aunque esté cerrado', () => {
    expect(hasDrift({ ...CLEAN, closed: true })).toBe(false)
  })
  it('deps.missing no vacío → true', () => {
    expect(hasDrift({ ...CLEAN, deps: { missing: [3], extra: [] } })).toBe(true)
  })
  it('ac.extra no vacío → true', () => {
    expect(hasDrift({ ...CLEAN, ac: { missing: [], extra: ['AC-9'] } })).toBe(true)
  })
  it('descripcionDiffers → true', () => {
    expect(hasDrift({ ...CLEAN, descripcionDiffers: true })).toBe(true)
  })
  it('protectedDiffers → true', () => {
    expect(hasDrift({ ...CLEAN, protectedDiffers: true })).toBe(true)
  })
})

describe('formatDrift — una línea por campo; deps/ac muestran el valor, Descripción/Protegido solo el flag (sin volcar prosa)', () => {
  const BASE = { order: 2, issueNumber: 42, closed: false, title: null, milestone: null, labels: { missing: [], extra: [] }, deps: { missing: [], extra: [] }, ac: { missing: [], extra: [] }, descripcionDiffers: false, protectedDiffers: false }
  it('sin divergencia → []', () => {
    expect(formatDrift(BASE)).toEqual([])
  })
  it('deps faltante/sobrante → una línea por cada una, nombrando merge-after #N', () => {
    const lines = formatDrift({ ...BASE, deps: { missing: [3], extra: [4] } })
    expect(lines.find((l) => l.includes('merge-after #3'))).toMatch(/falta/i)
    expect(lines.find((l) => l.includes('merge-after #4'))).toMatch(/sobra/i)
  })
  it('ac faltante/sobrante → una línea por cada una, con el texto del criterio', () => {
    const lines = formatDrift({ ...BASE, ac: { missing: ['AC-2.2'], extra: ['AC-9.9'] } })
    expect(lines.find((l) => l.includes('AC-2.2'))).toMatch(/falta/i)
    expect(lines.find((l) => l.includes('AC-9.9'))).toMatch(/sobra/i)
  })
  it('Descripción/Protegido divergentes → una línea CADA UNO, mencionan la sección, NUNCA el texto completo de la prosa', () => {
    const lines = formatDrift({ ...BASE, descripcionDiffers: true, protectedDiffers: true })
    expect(lines.some((l) => l.includes('Descripción'))).toBe(true)
    expect(lines.some((l) => l.includes('Out of scope / Protected'))).toBe(true)
    // ninguna línea es sospechosamente larga (indicio de haber volcado prosa completa)
    for (const l of lines) expect(l.length).toBeLessThan(220)
  })
  it('issue cerrado CON divergencia → nota final de "cerrado"', () => {
    const lines = formatDrift({ ...BASE, closed: true, title: { current: 'a', wanted: 'b' } })
    expect(lines[lines.length - 1]).toMatch(/cerrad.*reconcile/is)
  })
})

describe('buildReconcileEditArgs — título/milestone/labels vía flags de `gh issue edit` (sin cambios de F5-r1)', () => {
  it('combina todos los campos divergentes de flag', () => {
    const d = { title: { current: 'a', wanted: 'b' }, milestone: { current: 'x', wanted: 'y' }, labels: { missing: ['type:backend'], extra: ['type:ios'] } }
    expect(buildReconcileEditArgs(d)).toEqual(['--title', 'b', '--milestone', 'y', '--add-label', 'type:backend', '--remove-label', 'type:ios'])
  })
  it('sin nada de eso → []', () => {
    expect(buildReconcileEditArgs({ title: null, milestone: null, labels: { missing: [], extra: [] } })).toEqual([])
  })
})

describe('buildReconcileBody — splice quirúrgico de AC/Dependencias, preserva todo lo demás (F5, review crítica)', () => {
  const SLICE = { n: 2, name: 'refresh', type: 'backend', entrega: 'flujo de refresco', deps: [1], ac: ['AC-2.1'], protected: 'schema §6' }
  const GENERATED = buildIssueBody(SLICE, { specPath: 'spec.md', specSection: '9' })

  it('sin divergencia de AC/deps → null (nada que aplicar)', () => {
    expect(buildReconcileBody(GENERATED, { deps: [1], ac: ['AC-2.1'] })).toBeNull()
  })

  // Consistencia entre "qué se reporta" y "qué se aplica" (fix de
  // auto-revisión tras la review del coordinador): diffAc/diffDeps son
  // set-based (el orden no es semántico) — si buildReconcileBody usara una
  // comparación de texto crudo en vez del mismo criterio, un simple cambio
  // de ORDEN en la tabla §9 (mismo conjunto de AC/deps) provocaría una
  // reescritura del body que diffIssue nunca reportó como divergencia.
  it('mismo conjunto de AC en otro orden → null (diffAc no lo considera divergencia, buildReconcileBody tampoco reescribe)', () => {
    const TWO_AC_SLICE = { ...SLICE, ac: ['AC-2.1', 'AC-2.2'] }
    const body = buildIssueBody(TWO_AC_SLICE, { specPath: 'spec.md', specSection: '9' })
    expect(buildReconcileBody(body, { deps: [1], ac: ['AC-2.2', 'AC-2.1'] })).toBeNull()
  })

  it('AC divergente → reemplaza SOLO el contenido de "## Acceptance criteria", preserva Descripción/Dependencias/Protected/marcador intactos', () => {
    const newBody = buildReconcileBody(GENERATED, { deps: [1], ac: ['AC-2.1', 'AC-2.2'] })
    expect(newBody).not.toBeNull()
    expect(extractAc(newBody)).toEqual(['AC-2.1', 'AC-2.2'])
    expect(extractDeps(newBody)).toEqual([1]) // deps intactas
    expect(extractSectionContent(newBody, '## Descripción')).toBe('flujo de refresco') // intacta
    expect(extractSectionContent(newBody, '## Out of scope / Protected')).toBe('- 🚫 schema §6') // intacta
    expect(newBody).toContain('<!-- ct-order:2 -->') // marcador intacto
  })

  it('deps divergente (falta una) → añade la referencia, preserva AC/Descripción/Protected', () => {
    const newBody = buildReconcileBody(GENERATED, { deps: [1, 3], ac: ['AC-2.1'] })
    expect(extractDeps(newBody)).toEqual([1, 3])
    expect(extractAc(newBody)).toEqual(['AC-2.1'])
    expect(extractSectionContent(newBody, '## Descripción')).toBe('flujo de refresco')
  })

  it('deps divergente (sobra una) → la quita, preserva el resto', () => {
    const withTwoDeps = buildIssueBody({ ...SLICE, deps: [1, 3] }, { specPath: 'spec.md', specSection: '9' })
    const newBody = buildReconcileBody(withTwoDeps, { deps: [1], ac: ['AC-2.1'] })
    expect(extractDeps(newBody)).toEqual([1])
  })

  it('spec deja de tener deps (issue las conserva) → retira la sección "## Dependencias" entera', () => {
    const newBody = buildReconcileBody(GENERATED, { deps: [], ac: ['AC-2.1'] })
    expect(extractDeps(newBody)).toEqual([])
    expect(newBody).not.toContain('## Dependencias')
    expect(extractAc(newBody)).toEqual(['AC-2.1']) // no se toca lo demás
    expect(newBody).toContain('<!-- ct-order:2 -->')
  })

  it('spec empieza a tener deps (issue no tenía sección) → inserta "## Dependencias" antes de "## Out of scope / Protected"', () => {
    const noDeps = buildIssueBody({ ...SLICE, deps: [] }, { specPath: 'spec.md', specSection: '9' })
    expect(noDeps).not.toContain('## Dependencias')
    const newBody = buildReconcileBody(noDeps, { deps: [5], ac: ['AC-2.1'] })
    expect(extractDeps(newBody)).toEqual([5])
    expect(newBody.indexOf('## Dependencias')).toBeLessThan(newBody.indexOf('## Out of scope / Protected'))
    expect(extractSectionContent(newBody, '## Descripción')).toBe('flujo de refresco')
    expect(newBody).toContain('<!-- ct-order:2 -->')
  })

  // Cómo se distingue "contenido humano añadido" de divergencia real: el
  // splice solo toca el RANGO de la sección conocida (cabecera propia hasta
  // la siguiente cabecera "## " / marcador / fin) — una sección NUEVA que un
  // humano haya añadido en cualquier otro punto del body (con su propia
  // cabecera "## Notas", p.ej.) nunca cae dentro de ese rango, así que
  // sobrevive intacta a un --reconcile que sí toca AC/Dependencias.
  it('contenido humano en una sección nueva ("## Notas") sobrevive intacto a un reconcile de AC', () => {
    const withHumanNotes = GENERATED.replace('<!-- ct-order:2 -->', '## Notas\nOjo con este slice, lo tocó Fulano.\n\n<!-- ct-order:2 -->')
    const newBody = buildReconcileBody(withHumanNotes, { deps: [1], ac: ['AC-2.1', 'AC-2.2'] })
    expect(newBody).toContain('## Notas')
    expect(newBody).toContain('Ojo con este slice, lo tocó Fulano.')
    expect(extractAc(newBody)).toEqual(['AC-2.1', 'AC-2.2'])
  })
})
