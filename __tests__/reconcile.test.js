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
// Review round 4 (el reviewer atacó su PROPIO escáner del round 3, no solo
// los tres casos que se le habían dado):
//   1/2/3 (Critical, fence/exact-match/inserción sin límite): tests de la
//   capa de parseo puro viven en gh-issue-map.test.js; aquí se cubre el
//   Critical 3 (rendirse en vez de crecer sin límite) end-to-end vía
//   buildReconcileBody.
//   4 (importante): el enlace al spec se compara SOLO por su ancla
//   #sección — una diferencia de notación de ruta (relativa/absoluta) NUNCA
//   cuenta como divergencia (evita el ping-pong entre dos costumbres de
//   invocación).
//   5 (importante): un "## Dependencias"/"## Acceptance criteria"
//   DUPLICADO cambia lo que hace el dispatcher — SÍ cuenta para el exit
//   code. Duplicar Descripción/Protegido sigue siendo solo cosmético.
//   6 (importante): un "merge-after" fuera de la sección reconocida se
//   reporta como nota (nunca divergencia: --reconcile no puede tocarlo con
//   seguridad). Hasta el hardening del dispatch (D1), el dispatcher real SÍ
//   lo obedecía aunque --reconcile no pudiera aplicarlo; D1 finding 2
//   unificó ambos dominios — hoy es texto inerte para los dos, y la nota
//   se actualizó para decirlo así (ver reconcile.js#formatDrift).

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

// F10: la línea canónica de hoy — URL absoluta (relativa = 404 desde la
// página de un issue, verificado) y ancla del encabezado real
// ("## 9. Slices" -> "#9-slices", no "#9").
const SPEC_LINK = '> Slice #2 del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)'
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

describe('diffIssue — compara título, milestone, enlace-al-spec (ancla), labels (prefijos activos), deps, ac y prosa (booleano) contra un issue existente', () => {
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
    expect(d.duplicateMachineSections).toEqual([])
    expect(d.strayDeps).toEqual([])
  })
  // F10 invierte el "importante 4" de la review round 4. Aquel test exigía
  // que dos notaciones de la MISMA ruta no divergieran, porque la línea se
  // componía con `process.argv[2]` tal cual y comparar la ruta habría hecho
  // ping-pong entre dos costumbres de invocación. Esa premisa ya no existe:
  // la ruta que va a la línea es la relativa a la raíz del repo, calculada
  // con git, así que no hay dos notaciones posibles que reconciliar — y
  // "dos rutas distintas" ya solo puede significar lo que siempre debió
  // significar, que el spec está en otro fichero.
  it('enlace al spec al MISMO fichero y MISMA sección → NO diverge', () => {
    const d = diffIssue(existingWith({}), { ...WANTED_ISSUE, specLink: SPEC_LINK }, 'Epic', ALL_PREFIXES)
    expect(d.specLink).toBeNull()
  })
  it('enlace al spec a OTRO FICHERO (spec movido) → SÍ diverge — lo que la comparación por ancla no detectaba', () => {
    const movedFile = '> Slice #2 del epic. Spec: [docs/viejo.md § 9. Slices](https://github.com/o/r/blob/main/docs/viejo.md#9-slices)'
    const d = diffIssue(existingWith({}), { ...WANTED_ISSUE, specLink: movedFile }, 'Epic', ALL_PREFIXES)
    expect(d.specLink).toEqual({ current: SPEC_LINK, wanted: movedFile })
  })
  it('enlace al spec con distinta SECCIÓN → SÍ diverge', () => {
    const movedSection = '> Slice #2 del epic. Spec: [docs/spec.md § 10. Riesgos](https://github.com/o/r/blob/main/docs/spec.md#10-riesgos)'
    const d = diffIssue(existingWith({}), { ...WANTED_ISSUE, specLink: movedSection }, 'Epic', ALL_PREFIXES)
    expect(d.specLink).toEqual({ current: SPEC_LINK, wanted: movedSection })
  })
  it('el enlace RELATIVO de antes de F10, todavía en un issue creado entonces → SÍ diverge (era, y sigue siendo, un enlace roto)', () => {
    const preF10 = existingWith({
      body: existingWith({}).body.replace(SPEC_LINK, '> Slice #2 del epic. Spec: [docs/spec.md#9](docs/spec.md#9)'),
    })
    const d = diffIssue(preF10, WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.specLink).toEqual({ current: '> Slice #2 del epic. Spec: [docs/spec.md#9](docs/spec.md#9)', wanted: SPEC_LINK })
  })
  it('enlace al spec ausente en el issue (un humano la borró) → current: null', () => {
    const noSpecLink = existingWith({ body: existingWith({}).body.split('\n').slice(2).join('\n') })
    const d = diffIssue(noSpecLink, WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.specLink).toEqual({ current: null, wanted: SPEC_LINK })
  })
  // F23: esta rama ya no la ejercita ningún test de /ct-groom — desde que el
  // emparejado se acota por epic (`partitionByEpic`), un issue que
  // `findByMarker` encuentra en `ct-groom.mjs` SIEMPRE vino del milestone
  // pedido, así que `diffIssue` nunca recibe ahí un milestone distinto. La
  // rama sigue viva (otros callers de `diffIssue` pueden alcanzarla), así
  // que su cobertura baja aquí, al detector puro, en vez de desaparecer.
  it('milestone divergente (issue en "Sprint 1", spec pide "Epic") → current/wanted', () => {
    const d = diffIssue(existingWith({ milestone: { title: 'Sprint 1' } }), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.milestone).toEqual({ current: 'Sprint 1', wanted: 'Epic' })
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
    expect(d.deps).toEqual({ missing: [], extra: [] }) // #9 no se cuela en la comparación que decide aplicar/exit code
    // Importante 6: pero SÍ se avisa (nota, no divergencia) — el dispatcher
    // real (mapGhIssue/extractDeps sin acotar) lo obedecería igualmente.
    expect(d.strayDeps).toEqual([9])
  })
  it('sin nada fuera de la sección → strayDeps vacío', () => {
    const d = diffIssue(existingWith({}), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.strayDeps).toEqual([])
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
  // Importante 5 (review round 4): un "## Dependencias"/"## Acceptance
  // criteria" duplicado cambia lo que el dispatcher hace de verdad (no
  // distingue "la primera") — se reporta en duplicateMachineSections, y
  // hasDrift lo cuenta.
  it('"## Dependencias" duplicado → aparece en duplicateSections Y en duplicateMachineSections, hasDrift lo cuenta', () => {
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
    expect(d.duplicateMachineSections).toContain('Dependencias')
    expect(hasDrift(d)).toBe(true) // SÍ cuenta para el exit code
  })
  it('"## Descripción" duplicado → aparece en duplicateSections pero NO en duplicateMachineSections, hasDrift NO lo cuenta', () => {
    const dup = existingWith({
      body: [
        SPEC_LINK, '',
        '## Descripción', 'flujo de refresco', '',
        '## Descripción', 'copia pegada por error', '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
        '## Dependencias', '- merge-after #1', '',
        '## Out of scope / Protected', '- 🚫 schema §6', '',
        '<!-- ct-order:2 -->',
      ].join('\n'),
    })
    const d = diffIssue(dup, WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.duplicateSections).toContain('Descripción')
    expect(d.duplicateMachineSections).toEqual([])
    expect(hasDrift(d)).toBe(false)
  })

  // Task 4 (review, finding 3): la lógica de `e2eDiffers` no tenía ningún
  // test propio — sólo se parecía, sin probarlo, al `descripcionDiffers` ya
  // cubierto arriba. Se cubre aquí con el MISMO arnés (`existingWith`,
  // `diffIssue` directo), siguiendo el patrón exacto de "## Descripción"
  // (duplicado) y de las tres ramas de estado de esa misma sección
  // (divergente, ausente-cuando-el-spec-la-pide, silencio real en los dos
  // lados) — no se inventa ningún harness nuevo.
  it('"## E2E" duplicado → aparece en duplicateSections pero NO en duplicateMachineSections, hasDrift NO lo cuenta', () => {
    const dup = existingWith({
      body: [
        SPEC_LINK, '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
        '## Dependencias', '- merge-after #1', '',
        '## E2E', '- curl -i :9115/metrics responde 200', '',
        '## E2E', '- copia pegada por error', '',
        '## Out of scope / Protected', '- 🚫 schema §6', '',
        '<!-- ct-order:2 -->',
      ].join('\n'),
    })
    const d = diffIssue(dup, { ...WANTED_ISSUE, e2eContent: '- curl -i :9115/metrics responde 200' }, 'Epic', ALL_PREFIXES)
    expect(d.duplicateSections).toContain('E2E')
    expect(d.duplicateMachineSections).toEqual([])
    expect(hasDrift(d)).toBe(false)
  })
  it('"## E2E" con contenido distinto del spec → e2eDiffers true, y SÍ cuenta para hasDrift', () => {
    const withE2e = existingWith({
      body: [
        SPEC_LINK, '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
        '## Dependencias', '- merge-after #1', '',
        '## E2E', '- curl -i :9115/metrics responde 200', '',
        '## Out of scope / Protected', '- 🚫 schema §6', '',
        '<!-- ct-order:2 -->',
      ].join('\n'),
    })
    const d = diffIssue(withE2e, { ...WANTED_ISSUE, e2eContent: '- otro recorrido distinto' }, 'Epic', ALL_PREFIXES)
    expect(d.e2eDiffers).toBe(true)
    // Review final de rama: al revés que Gates. De esta sección salen los
    // recorridos que /ct-next siembra y los que --release exige, así que un
    // issue que no los tenga es un slice que no atraviesa lo que el spec pide.
    expect(hasDrift(d)).toBe(true)
  })
  it('"## E2E" ausente en el issue cuando el spec SÍ pide recorridos → e2eDiffers true', () => {
    const d = diffIssue(existingWith({}), { ...WANTED_ISSUE, e2eContent: '- curl -i :9115/metrics responde 200' }, 'Epic', ALL_PREFIXES)
    expect(d.e2eDiffers).toBe(true)
  })
  it('sin "## E2E" en ninguno de los dos lados → e2eDiffers false (acuerdo real: este slice no tiene recorridos)', () => {
    // A diferencia de Gates (siempre emitida, así que su ausencia SIEMPRE
    // diverge), "## E2E" sólo se emite con contenido — null en los dos
    // lados es el caso normal (6 de cada 8 filas en mo-monitoring v1), no
    // una divergencia.
    const d = diffIssue(existingWith({}), WANTED_ISSUE, 'Epic', ALL_PREFIXES) // WANTED_ISSUE no trae e2eContent
    expect(d.e2eDiffers).toBe(false)
  })
})

describe('hasDrift — título/milestone/enlace-al-spec/labels/deps/ac/duplicados-machine cuentan; closed/prosa/strayDeps NUNCA', () => {
  const CLEAN = {
    order: 1, issueNumber: 1, closed: false, title: null, milestone: null, specLink: null,
    labels: { missing: [], extra: [] }, deps: { missing: [], extra: [] }, ac: { missing: [], extra: [] },
    descripcionDiffers: false, protectedDiffers: false, e2eDiffers: false, duplicateSections: [], duplicateMachineSections: [], strayDeps: [],
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
  it('duplicateMachineSections no vacío → true', () => {
    expect(hasDrift({ ...CLEAN, duplicateMachineSections: ['Dependencias'] })).toBe(true)
  })
  it('descripcionDiffers → NUNCA cuenta (ya no ancla el exit code)', () => {
    expect(hasDrift({ ...CLEAN, descripcionDiffers: true })).toBe(false)
  })
  it('protectedDiffers → NUNCA cuenta', () => {
    expect(hasDrift({ ...CLEAN, protectedDiffers: true })).toBe(false)
  })
  it('duplicateSections (solo cosmético, p.ej. Descripción) → NUNCA cuenta', () => {
    expect(hasDrift({ ...CLEAN, duplicateSections: ['Descripción'] })).toBe(false)
  })
  it('strayDeps no vacío → NUNCA cuenta (--reconcile no puede tocarlo con seguridad)', () => {
    expect(hasDrift({ ...CLEAN, strayDeps: [9] })).toBe(false)
  })
  it('e2eDiffers → SÍ cuenta (el recorrido no es prosa: lo obedecen /ct-next y --release)', () => {
    expect(hasDrift({ ...CLEAN, e2eDiffers: true })).toBe(true)
  })
})

describe('formatDrift — divergencia: (cuenta) vs. nota: (no cuenta); deps/ac/specLink/duplicados-machine muestran el valor, prosa/strayDeps/duplicados-cosméticos solo el flag', () => {
  const BASE = {
    order: 2, issueNumber: 42, closed: false, title: null, milestone: null, specLink: null,
    labels: { missing: [], extra: [] }, deps: { missing: [], extra: [] }, ac: { missing: [], extra: [] },
    descripcionDiffers: false, protectedDiffers: false, duplicateSections: [], duplicateMachineSections: [], strayDeps: [],
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
  // F23: mismo motivo que el test de milestone en el describe de diffIssue —
  // /ct-groom ya no puede producir un diff.milestone no-nulo (el emparejado
  // acotado por epic lo hace inalcanzable desde ese call-site), así que la
  // línea de formatDrift para esta rama se prueba aquí, contra el
  // formateador puro, en vez de contra una corrida de /ct-groom.
  it('milestone divergente → línea "divergencia:" con ambos valores', () => {
    const lines = formatDrift({ ...BASE, milestone: { current: 'Sprint 1', wanted: 'Epic' } })
    expect(lines[0]).toMatch(/^divergencia:/)
    expect(lines[0]).toMatch(/milestone difiere/)
    expect(lines[0]).toMatch(/"Sprint 1"/)
    expect(lines[0]).toMatch(/"Epic"/)
  })
  // F6: la línea cita la referencia EXACTAMENTE como aparece en el body que
  // el spec produce hoy (con backticks) y dice, además, que ese número es un
  // orden de slice — no un número de issue. Un humano que lee "falta la
  // dependencia merge-after #3" en el terminal no tiene forma de saber cuál
  // de los dos espacios de IDs está mirando.
  it('deps faltante/sobrante → una línea "divergencia:" por cada una, nombrando merge-after `#N` y que es orden de slice', () => {
    const lines = formatDrift({ ...BASE, deps: { missing: [3], extra: [4] } })
    expect(lines.find((l) => l.includes('merge-after `#3`'))).toMatch(/^divergencia:.*falta/i)
    expect(lines.find((l) => l.includes('merge-after `#4`'))).toMatch(/^divergencia:.*sobra/i)
    expect(lines.every((l) => /orden de slice/i.test(l))).toBe(true)
    expect(lines.some((l) => /merge-after #\d/.test(l))).toBe(false) // nunca la forma desnuda, que sugiere un número de issue
  })
  it('ac faltante/sobrante → una línea "divergencia:" por cada una, con el texto del criterio', () => {
    const lines = formatDrift({ ...BASE, ac: { missing: ['AC-2.2'], extra: ['AC-9.9'] } })
    expect(lines.find((l) => l.includes('AC-2.2'))).toMatch(/^divergencia:.*falta/i)
    expect(lines.find((l) => l.includes('AC-9.9'))).toMatch(/^divergencia:.*sobra/i)
  })
  it('duplicateMachineSections (p.ej. Dependencias) → línea "divergencia:", no "nota:"', () => {
    const lines = formatDrift({ ...BASE, duplicateSections: ['Dependencias'], duplicateMachineSections: ['Dependencias'] })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^divergencia:/)
    expect(lines[0]).toMatch(/Dependencias/)
  })
  it('duplicateSections cosmético (Descripción, no machine) → línea "nota:"', () => {
    const lines = formatDrift({ ...BASE, duplicateSections: ['Descripción'], duplicateMachineSections: [] })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^nota:/)
    expect(lines[0]).toMatch(/Descripción/)
  })
  it('Descripción/Protegido divergentes (solos, sin ninguna otra divergencia) → líneas "nota:", mencionan la sección, nunca el texto completo', () => {
    const lines = formatDrift({ ...BASE, descripcionDiffers: true, protectedDiffers: true })
    expect(lines).toHaveLength(2)
    expect(lines.every((l) => l.startsWith('nota:'))).toBe(true)
    expect(lines.some((l) => l.includes('Descripción'))).toBe(true)
    expect(lines.some((l) => l.includes('Out of scope / Protected'))).toBe(true)
    for (const l of lines) expect(l.length).toBeLessThan(220) // nunca vuelca prosa completa
  })
  it('strayDeps → línea "nota:" por cada referencia, nombrando el número y que el dispatcher SÍ lo obedece', () => {
    const lines = formatDrift({ ...BASE, strayDeps: [9] })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^nota:/)
    expect(lines[0]).toMatch(/merge-after #9/)
    expect(lines[0]).toMatch(/dispatcher/i)
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

describe('reconcileGaps / hasReconcileGap — divergencia real que --reconcile no pudo aplicar', () => {
  const DIFF_CLEAN = { ac: { missing: [], extra: [] }, deps: { missing: [], extra: [] }, duplicateMachineSections: [] }
  it('sin divergencia de ac/deps/e2e → sin gap, aunque bodyResult marque unresolved (no debería pasar, pero no basta por sí solo)', () => {
    const gaps = reconcileGaps(DIFF_CLEAN, { body: null, unresolvedAc: true, unresolvedDeps: true, unresolvedE2e: 'duplicada' })
    expect(gaps).toEqual({ ac: false, deps: false, e2e: false, duplicates: false })
    expect(hasReconcileGap(gaps)).toBe(false)
  })
  // La sección "## E2E" cuenta para hasDrift, así que rendirse al escribirla
  // tiene que contar también para el exit code de --reconcile: sin esto, un
  // body en el que la sección no se puede tocar con seguridad salía 0 dejando
  // al issue sin los recorridos que el spec pide.
  it('"## E2E" diverge Y no se pudo escribir → gap.e2e = true', () => {
    const diff = { ...DIFF_CLEAN, e2eDiffers: true }
    const gaps = reconcileGaps(diff, { body: null, unresolvedAc: false, unresolvedDeps: false, unresolvedE2e: 'duplicada' })
    expect(gaps.e2e).toBe(true)
    expect(hasReconcileGap(gaps)).toBe(true)
  })
  it('"## E2E" diverge pero SÍ se pudo escribir → sin gap', () => {
    const diff = { ...DIFF_CLEAN, e2eDiffers: true }
    const gaps = reconcileGaps(diff, { body: null, unresolvedAc: false, unresolvedDeps: false, unresolvedE2e: null })
    expect(gaps.e2e).toBe(false)
    expect(hasReconcileGap(gaps)).toBe(false)
  })
  it('AC diverge Y no se pudo localizar la sección → gap.ac = true', () => {
    const diff = { ac: { missing: ['AC-1.2'], extra: [] }, deps: { missing: [], extra: [] }, duplicateMachineSections: [] }
    const gaps = reconcileGaps(diff, { body: null, unresolvedAc: true, unresolvedDeps: false })
    expect(gaps.ac).toBe(true)
    expect(hasReconcileGap(gaps)).toBe(true)
  })
  it('AC diverge pero SÍ se pudo aplicar (unresolvedAc: false) → sin gap', () => {
    const diff = { ac: { missing: ['AC-1.2'], extra: [] }, deps: { missing: [], extra: [] }, duplicateMachineSections: [] }
    const gaps = reconcileGaps(diff, { body: 'algo', unresolvedAc: false, unresolvedDeps: false })
    expect(gaps.ac).toBe(false)
    expect(hasReconcileGap(gaps)).toBe(false)
  })
  // Critical 3 (review round 4): deps AHORA sí puede quedar unresolved
  // (antes hardcodeado a false) — cuando no hay ancla segura donde insertar.
  it('deps diverge Y no se pudo localizar un ancla segura → gap.deps = true', () => {
    const diff = { ac: { missing: [], extra: [] }, deps: { missing: [2], extra: [] }, duplicateMachineSections: [] }
    const gaps = reconcileGaps(diff, { body: null, unresolvedAc: false, unresolvedDeps: true })
    expect(gaps.deps).toBe(true)
    expect(hasReconcileGap(gaps)).toBe(true)
  })

  // Importante 3 (review round 5): "con --reconcile, la divergencia que
  // --reconcile no puede aplicar sale 0" — hasDrift cuenta
  // duplicateMachineSections, pero antes de este fix reconcileGaps solo
  // miraba ac/deps: un duplicado, sin NINGÚN gap de ac/deps a la vez
  // (ac/deps siguen de acuerdo en contenido — el duplicado es el único
  // drift), pasaba con hasReconcileGap en false, así que ct-groom.mjs
  // (que bajo --reconcile usa solo hasReconcileGap para su exit code)
  // salía 0 sobre una divergencia real sin aplicar ni una sola llamada a
  // `gh`.
  it('duplicateMachineSections no vacío, sin ningún gap de ac/deps → gap.duplicates = true de todos modos', () => {
    const diff = { ac: { missing: [], extra: [] }, deps: { missing: [], extra: [] }, duplicateMachineSections: ['Dependencias'] }
    const gaps = reconcileGaps(diff, { body: null, unresolvedAc: false, unresolvedDeps: false })
    expect(gaps.ac).toBe(false)
    expect(gaps.deps).toBe(false)
    expect(gaps.duplicates).toBe(true)
    expect(hasReconcileGap(gaps)).toBe(true)
  })
  it('sin duplicateMachineSections (o campo ausente) → gap.duplicates = false', () => {
    expect(reconcileGaps(DIFF_CLEAN, { body: null, unresolvedAc: false, unresolvedDeps: false }).duplicates).toBe(false)
    const diffSinCampo = { ac: { missing: [], extra: [] }, deps: { missing: [], extra: [] } }
    expect(reconcileGaps(diffSinCampo, { body: null, unresolvedAc: false, unresolvedDeps: false }).duplicates).toBe(false)
  })
})

describe('buildReconcileBody — splice quirúrgico de enlace-al-spec/AC/Dependencias, preserva todo lo demás', () => {
  const SLICE = { n: 2, name: 'refresh', type: 'backend', entrega: 'flujo de refresco', deps: [1], ac: ['AC-2.1'], protected: 'schema §6' }
  const SPEC_OPTS = { path: 'spec.md', heading: '9. Slices', url: 'https://github.com/o/r/blob/main/spec.md#9-slices', reason: null }
  const GENERATED = buildIssueBody(SLICE, SPEC_OPTS)
  const WANTED_BASE = { deps: [1], ac: ['AC-2.1'], specLink: '> Slice `#2` del epic. Spec: [spec.md § 9. Slices](https://github.com/o/r/blob/main/spec.md#9-slices)' }

  it('sin divergencia de nada → body: null, ninguna rendición marcada (nada que aplicar)', () => {
    const r = buildReconcileBody(GENERATED, WANTED_BASE)
    expect(r).toEqual({
      body: null,
      unresolvedE2e: null,
      unresolvedAc: false,
      unresolvedDeps: false,
      unresolvedReasons: { ac: null, deps: null },
      unresolvedEpicContext: null,
      unresolvedFrozenDecisions: null,
    })
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

  // Un cuerpo anterior a F26 (sin "## Contexto heredado"), que es donde la
  // propiedad de abajo se lee sin ruido: AC y Dependencias son dominios
  // independientes y que uno se rinda no bloquea al otro. Con la sección
  // heredada presente la cosa cambia, y ese caso tiene su propio test justo
  // debajo — ver ahí por qué.
  const SIN_HEREDADA = GENERATED.replace(/## Contexto heredado\n.*\n\n/, '')

  it('cabecera "## Acceptance criteria" renombrada/ausente → unresolvedAc: true, NO se inventa una posición, el resto de la sección de deps SÍ se puede seguir aplicando', () => {
    const renamed = SIN_HEREDADA.replace('## Acceptance criteria (EARS, 1:1 con tests)', '## Criterios')
    expect(renamed).not.toContain('## Contexto heredado') // la premisa del caso, explícita
    const r = buildReconcileBody(renamed, { ...WANTED_BASE, ac: ['AC-2.1', 'AC-2.2'], deps: [1, 3] })
    expect(r.unresolvedAc).toBe(true)
    expect(extractAc(r.body ?? renamed)).not.toEqual(['AC-2.1', 'AC-2.2']) // no se aplicó
    expect(extractDeps(r.body)).toEqual([1, 3]) // pero deps SÍ se pudo aplicar (dominio independiente)
  })

  // Segunda oleada de la review final de rama. La zona intocable de la sesión
  // coordinadora ya no termina en la primera cabecera ATX (que puede ser una
  // que ella pegó) sino en "## Acceptance criteria". Sin esa cabecera no hay
  // forma de saber dónde acaba lo suyo, y el rango se extiende hasta el final
  // del body a propósito: de los dos errores posibles, el caro es el que borra
  // texto humano. El precio, medido y pagado entero, es este: sobre un cuerpo
  // CON sección heredada y SIN cabecera de AC, Dependencias tampoco se aplica.
  // Se rinde en voz alta, con un motivo que no habla de la sección heredada
  // (no se puede afirmar que el bloque sea de ella) sino del límite que falta.
  it('con la sección heredada y sin cabecera de AC, Dependencias tampoco se aplica: la zona de la coordinadora deja de tener fin conocido', () => {
    const renamed = GENERATED.replace('## Acceptance criteria (EARS, 1:1 con tests)', '## Criterios')
    expect(renamed).toContain('## Contexto heredado') // la premisa del caso
    const r = buildReconcileBody(renamed, { ...WANTED_BASE, ac: ['AC-2.1', 'AC-2.2'], deps: [1, 3] })
    expect(r.unresolvedAc).toBe(true)
    expect(r.unresolvedDeps).toBe(true)
    expect(r.unresolvedReasons.deps).toBe('zona-sin-fin')
    expect(r.body).toBeNull() // no se escribe NADA por detrás de la cabecera heredada
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
    const { body: newBody, unresolvedDeps } = buildReconcileBody(noDeps, { ...WANTED_BASE, deps: [5] })
    expect(unresolvedDeps).toBe(false)
    expect(extractDeps(newBody)).toEqual([5])
    expect(newBody.indexOf('## Dependencias')).toBeLessThan(newBody.indexOf('## Out of scope / Protected'))
    expect(extractSectionContent(newBody, '## Descripción')).toBe('flujo de refresco')
    expect(newBody).toContain('<!-- ct-order:2 -->')
  })

  // Critical 3 (review round 4): sin AC ni "## Out of scope / Protected"
  // localizables, la versión anterior insertaba una sección nueva CIEGAMENTE
  // en `body.length` — sin límite, en cada corrida. Ahora se RINDE
  // (unresolvedDeps: true), igual que ya hacía AC, y NO toca el body.
  it('sin "## Out of scope / Protected" localizable (sin ancla segura) → se RIÈNDE: unresolvedDeps true, body sin cambios para deps', () => {
    const noProtected = '> Slice `#2` del epic. Spec: [spec.md § 9. Slices](https://github.com/o/r/blob/main/spec.md#9-slices)\n\n## Acceptance criteria (EARS, 1:1 con tests)\n- AC-2.1\n\n<!-- ct-order:2 -->'
    const r = buildReconcileBody(noProtected, { ...WANTED_BASE, deps: [5] })
    expect(r.unresolvedDeps).toBe(true)
    expect(r.body).toBeNull() // nada más divergía (AC/specLink ya coincidían) → null entero
    expect(extractDeps(noProtected)).toEqual([]) // el original, verificado, seguía sin la dependencia
  })

  // Reproducción exacta del bug del reviewer: una valla sin cerrar hace
  // inhallable CUALQUIER cabecera posterior (incluida "## Out of scope /
  // Protected") — antes esto disparaba una inserción ciega en cada
  // corrida, creciendo sin límite (2, 3, 4 secciones en 3 pasadas). Ahora,
  // tres llamadas sucesivas (simulando tres corridas de /ct-groom
  // --reconcile) deben rendirse las TRES veces, sin insertar nada nunca.
  it('valla sin cerrar (ancla de Protected inhallable) → tres "corridas" sucesivas se rinden las tres, sin crecer sin límite', () => {
    const withUnclosedFence = [
      '> Slice `#2` del epic. Spec: [spec.md § 9. Slices](https://github.com/o/r/blob/main/spec.md#9-slices)', '',
      '## Descripción', '```', 'esta valla nunca se cierra', '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
      '<!-- ct-order:2 -->',
    ].join('\n')
    let current = withUnclosedFence
    for (let run = 0; run < 3; run++) {
      const r = buildReconcileBody(current, { ...WANTED_BASE, deps: [5] })
      expect(r.unresolvedDeps).toBe(true)
      expect(r.body).toBeNull()
      // "current" no cambia entre corridas — no hay nada que reconciliar
      // apliquemos lo que apliquemos, así que el bucle converge en un
      // no-op estable, no en un crecimiento sin límite.
      current = current // eslint-disable-line no-self-assign
    }
    expect((current.match(/## Dependencias/g) || []).length).toBe(0)
  })

  it('contenido humano en una sección nueva ("## Notas") sobrevive intacto a un reconcile de AC', () => {
    const withHumanNotes = GENERATED.replace('<!-- ct-order:2 -->', '## Notas\nOjo con este slice, lo tocó Fulano.\n\n<!-- ct-order:2 -->')
    const { body: newBody } = buildReconcileBody(withHumanNotes, { ...WANTED_BASE, ac: ['AC-2.1', 'AC-2.2'] })
    expect(newBody).toContain('## Notas')
    expect(newBody).toContain('Ojo con este slice, lo tocó Fulano.')
    expect(extractAc(newBody)).toEqual(['AC-2.1', 'AC-2.2'])
  })

  // Enlace al spec: splice de una sola línea. F10 — se dispara ante
  // CUALQUIER diferencia de la línea, no solo del ancla: la línea es ahora
  // canónica (deriva del repositorio, no de argv), así que una diferencia ya
  // solo puede significar un cambio real (otra sección, otro fichero, o el
  // enlace relativo roto de antes de F10).
  const OTRA_SECCION = '> Slice `#2` del epic. Spec: [spec.md § 10. Riesgos](https://github.com/o/r/blob/main/spec.md#10-riesgos)'
  it('enlace al spec con otra sección → se reemplaza la línea, preserva todo lo demás', () => {
    const { body: newBody } = buildReconcileBody(GENERATED, { ...WANTED_BASE, specLink: OTRA_SECCION })
    expect(extractSpecLink(newBody)).toBe(OTRA_SECCION)
    expect(extractAc(newBody)).toEqual(['AC-2.1'])
    expect(extractDeps(newBody)).toEqual([1])
    expect(newBody).toContain('<!-- ct-order:2 -->')
  })
  const OTRO_FICHERO = '> Slice `#2` del epic. Spec: [docs/viejo.md § 9. Slices](https://github.com/o/r/blob/main/docs/viejo.md#9-slices)'
  it('enlace al spec a otro fichero (misma sección) → TAMBIÉN se reemplaza — antes de F10 esto no se tocaba nunca', () => {
    const { body: newBody } = buildReconcileBody(GENERATED, { ...WANTED_BASE, specLink: OTRO_FICHERO })
    expect(extractSpecLink(newBody)).toBe(OTRO_FICHERO)
  })
  it('enlace al spec idéntico → NO se reescribe: body sin cambios para ese campo', () => {
    const r = buildReconcileBody(GENERATED, WANTED_BASE)
    expect(r.body).toBeNull()
  })

  it('enlace al spec ausente (un humano lo borró) → se antepone al principio', () => {
    const withoutSpecLink = GENERATED.split('\n').slice(2).join('\n')
    const { body: newBody } = buildReconcileBody(withoutSpecLink, WANTED_BASE)
    expect(newBody.startsWith(WANTED_BASE.specLink)).toBe(true)
  })

  it('reconciliar deps con una mención de "## Dependencias" dentro de una valla en Descripción no corrompe la valla', () => {
    const withFence = [
      '> Slice `#2` del epic. Spec: [spec.md § 9. Slices](https://github.com/o/r/blob/main/spec.md#9-slices)', '',
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

  // Review round 5, Critical 1 — end-to-end: unas deps VIEJAS comentadas
  // "mientras decidimos con pagos" no deben secuestrar el splice de
  // --reconcile ni perder su "-->" de cierre.
  it('reconciliar deps con una mención de "## Dependencias" dentro de un comentario HTML multilínea no corrompe el comentario ni pierde su cierre', () => {
    const withComment = [
      '> Slice `#2` del epic. Spec: [spec.md § 9. Slices](https://github.com/o/r/blob/main/spec.md#9-slices)', '',
      '## Descripción', 'Ejemplo:', '<!--', '## Dependencias', '- merge-after #99 (pospuesto, negociado con pagos)', '-->', 'fin.', '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1', '',
      '## Dependencias', '- merge-after #1', '',
      '## Out of scope / Protected', '- 🚫 schema §6', '',
      '<!-- ct-order:2 -->',
    ].join('\n')
    const { body: newBody } = buildReconcileBody(withComment, { ...WANTED_BASE, deps: [1, 3] })
    expect(newBody).toContain('<!--\n## Dependencias\n- merge-after #99 (pospuesto, negociado con pagos)\n-->') // el comentario sobrevive intacto, CON su cierre
    expect(newBody).toContain('fin.')
    const realDepsSection = extractSectionContent(newBody, '## Dependencias')
    expect(extractDeps(realDepsSection)).toEqual([1, 3]) // la sección REAL sí se actualizó
    // Ninguna sección/protegido desapareció (lo que pasaría si el "-->" se
    // hubiera comido junto con todo lo que viene detrás, hasta EOF).
    expect(newBody).toContain('## Out of scope / Protected')
    expect(newBody).toContain('<!-- ct-order:2 -->')
  })

  // Review round 5, Critical 2 — end-to-end: reproducción exacta del
  // mecanismo de corrupción del reviewer. Un "### Notas de implementación"
  // con una advertencia real, escrito JUSTO DEBAJO del contenido de AC (y
  // por tanto, antes del fix, "dentro" del rango que --reconcile sustituye
  // al splicear AC), no debe perderse cuando AC se reconcilia — el splice
  // tiene que parar en esa cabecera, no en la siguiente "## " literal.
  it('reconciliar AC con un "### Notas de implementación" (advertencia real) pegado justo debajo del contenido de AC no se lo traga el splice', () => {
    const withSubheading = GENERATED.replace(
      '- AC-2.1\n\n## Dependencias',
      '- AC-2.1\n\n### Notas de implementación\nla dependencia la negociamos con pagos: NO tocar sin hablar con Ana\n\n## Dependencias',
    )
    const { body: newBody } = buildReconcileBody(withSubheading, { ...WANTED_BASE, ac: ['AC-2.1', 'AC-2.2'] })
    expect(newBody).toContain('### Notas de implementación')
    expect(newBody).toContain('NO tocar sin hablar con Ana')
    expect(extractAc(newBody)).toEqual(['AC-2.1', 'AC-2.2'])
  })

  // Menor: CRLF — el resultado final conserva el final de línea del
  // original, sin mezclar LF nuestro con CRLF humano.
  it('body en CRLF: el resultado reconciliado también es CRLF de punta a punta (sin finales mezclados)', () => {
    const crlfBody = GENERATED.replace(/\n/g, '\r\n')
    const { body: newBody } = buildReconcileBody(crlfBody, { ...WANTED_BASE, ac: ['AC-2.1', 'AC-2.2'] })
    expect(newBody).not.toBeNull()
    expect(newBody).toContain('\r\n')
    expect(newBody).not.toMatch(/[^\r]\n/) // ningún '\n' sin su '\r' delante — nunca mezclado
    expect(extractAc(newBody)).toEqual(['AC-2.1', 'AC-2.2']) // el contenido sigue siendo correcto tras normalizar/reconvertir
  })
})

// ============================================================================
// La sección "## E2E" bajo --reconcile (review final de rama, Importante 1).
//
// El camino de adopción natural de toda la feature es: un epic ya groomeado,
// más la columna `E2E` nueva en el spec, más `--reconcile`. Hasta esta ronda
// ese camino añadía la label `gate:e2e` (la cubre el prefijo `gate:` de
// `ownedLabelPrefixes`) y NO la sección — o sea, un issue con la label y sin
// recorridos: /ct-next sembraba `[]`, el agente no atravesaba nada, y
// `--release` liberaba con un aviso por stderr. La herramienta fabricaba el
// mismo estado divergente que el §4.6 del diseño describe como "alguien editó
// el issue a mano".
//
// Se reescribe, a diferencia de Descripción/Protegido, porque lo que las
// protege a aquéllas —el derecho de un humano a editar SU issue— aquí es justo
// lo contrario: el §3.3 dice que el recorrido no puede ser editable sin pasar
// por la Puerta 1.
// ============================================================================
describe('buildReconcileBody — la sección "## E2E"', () => {
  const SLICE = { n: 2, name: 'refresh', type: 'backend', entrega: 'flujo de refresco', deps: [1], ac: ['AC-2.1'], protected: 'schema §6' }
  const SPEC_OPTS = { path: 'spec.md', heading: '9. Slices', url: 'https://github.com/o/r/blob/main/spec.md#9-slices', reason: null }
  const SIN_E2E = buildIssueBody(SLICE, SPEC_OPTS)
  const CON_E2E = buildIssueBody({ ...SLICE, e2e: 'curl -i :9115/metrics responde 200' }, SPEC_OPTS)
  const WANTED_BASE = { deps: [1], ac: ['AC-2.1'], specLink: '> Slice `#2` del epic. Spec: [spec.md § 9. Slices](https://github.com/o/r/blob/main/spec.md#9-slices)' }
  const RECORRIDO = '- curl -i :9115/metrics responde 200'

  it('el issue no tiene la sección y el spec ahora pide recorridos → se inserta entera, justo antes de "## Out of scope / Protected"', () => {
    const { body, unresolvedE2e } = buildReconcileBody(SIN_E2E, { ...WANTED_BASE, e2eContent: RECORRIDO })
    expect(unresolvedE2e).toBeNull()
    expect(extractSectionContent(body, '## E2E')).toBe(RECORRIDO)
    expect(body.indexOf('## E2E')).toBeLessThan(body.indexOf('## Out of scope / Protected'))
    expect(body.indexOf('## Gates')).toBeLessThan(body.indexOf('## E2E'))
    // Nada más se ha tocado: el marcador del dispatcher sigue ahí y los AC no
    // se han movido.
    expect(body).toContain('<!-- ct-order:2 -->')
    expect(extractAc(body)).toEqual(['AC-2.1'])
  })

  it('el issue tiene otra cosa en la sección → se reemplaza SOLO su contenido', () => {
    const editado = CON_E2E.replace(RECORRIDO, '- un recorrido que alguien escribió a mano')
    const { body } = buildReconcileBody(editado, { ...WANTED_BASE, e2eContent: RECORRIDO })
    expect(extractSectionContent(body, '## E2E')).toBe(RECORRIDO)
    expect(body).not.toContain('un recorrido que alguien escribió a mano')
    expect(body).toContain('<!-- ct-order:2 -->')
  })

  it('el spec ya no declara recorridos (la celda pasó a "no") → la sección se retira ENTERA', () => {
    const { body } = buildReconcileBody(CON_E2E, WANTED_BASE) // sin e2eContent
    expect(body).not.toContain('## E2E')
    expect(body).toContain('## Out of scope / Protected')
    expect(body).toContain('<!-- ct-order:2 -->')
    expect(body).not.toMatch(/\n\n\n/) // la costura no deja dos líneas en blanco
  })

  it('los dos lados de acuerdo (ni el issue ni el spec traen recorridos) → body: null', () => {
    expect(buildReconcileBody(SIN_E2E, WANTED_BASE).body).toBeNull()
  })

  it('hay que insertarla pero el ancla "## Out of scope / Protected" no se localiza → se rinde en voz alta, no inventa una posición', () => {
    const sinAncla = SIN_E2E.replace('## Out of scope / Protected', '## Fuera de alcance (renombrada a mano)')
    const { body, unresolvedE2e } = buildReconcileBody(sinAncla, { ...WANTED_BASE, e2eContent: RECORRIDO })
    expect(unresolvedE2e).toBe('sin-ancla')
    expect(body).toBeNull() // no había nada más que aplicar, y esto no se aplicó
  })

  it('la sección aparece dos veces → no se escribe en ninguna (una puede ser texto pegado en "## Contexto heredado")', () => {
    const duplicada = CON_E2E.replace('## Out of scope / Protected', '## E2E\n- copia pegada por error\n\n## Out of scope / Protected')
    const { unresolvedE2e } = buildReconcileBody(duplicada, { ...WANTED_BASE, e2eContent: '- otro recorrido' })
    expect(unresolvedE2e).toBe('duplicada')
  })
})

// Slice 10 — la señal en la reconciliación: comparación sí/no como `nota:`,
// el precedente EXACTO de Descripción/Protegido. La autoridad en runtime es
// EL ISSUE (como los gates: la señal que obedece el juez de slice es la que
// el issue tenía al despachar), y la maquinaria de splice es la mitad
// EXPERIMENTAL que cinco rondas de review decidieron no engordar — así que
// `senalDiffers` no entra en hasDrift, ni en reconcileGaps, ni
// buildReconcileBody la escribe o retira jamás.
describe('la señal en la reconciliación (Slice 10)', () => {
  const SENAL_SECTION = '## Señal de observabilidad'
  const bodyConSenal = (texto) =>
    existingWith({}).body.replace('## Dependencias', `${SENAL_SECTION}\n${texto}\n\n## Dependencias`)

  it('senalDiffers: acuerdo cuando ninguno de los dos lados tiene sección', () => {
    // WANTED_ISSUE no trae `senal` (→ null) y el body de existingWith tampoco
    // trae la sección: silencio real en ambos lados, nunca divergencia — el
    // mismo acuerdo null/null de descripcionDiffers.
    const d = diffIssue(existingWith({}), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.senalDiffers).toBe(false)
  })

  it('senalDiffers: un lado con sección y el otro sin ella difiere; texto distinto difiere', () => {
    // Issue con sección, spec sin señal → difiere.
    const conSeccion = existingWith({ body: bodyConSenal('métrica x') })
    expect(diffIssue(conSeccion, WANTED_ISSUE, 'Epic', ALL_PREFIXES).senalDiffers).toBe(true)
    // Issue sin sección, spec con señal → difiere.
    expect(diffIssue(existingWith({}), { ...WANTED_ISSUE, senal: 'métrica x' }, 'Epic', ALL_PREFIXES).senalDiffers).toBe(true)
    // Ambos con texto, distinto → difiere; igual (módulo trim) → acuerdo.
    expect(diffIssue(conSeccion, { ...WANTED_ISSUE, senal: 'métrica y' }, 'Epic', ALL_PREFIXES).senalDiffers).toBe(true)
    expect(diffIssue(conSeccion, { ...WANTED_ISSUE, senal: '  métrica x  ' }, 'Epic', ALL_PREFIXES).senalDiffers).toBe(false)
  })

  it('la divergencia de señal sale como nota: y no cuenta para hasDrift ni para reconcileGaps', () => {
    // La única divergencia del diff es la señal: todo lo demás coincide.
    const d = diffIssue(existingWith({ body: bodyConSenal('métrica x') }), WANTED_ISSUE, 'Epic', ALL_PREFIXES)
    expect(d.senalDiffers).toBe(true)
    expect(hasDrift(d)).toBe(false)
    const lines = formatDrift(d)
    // Este fixture (sin sección "## Gates") arrastra además la nota de gates,
    // preexistente y ortogonal — lo que se clava aquí es que la señal sale
    // como nota: (verbatim) y que NINGUNA línea es divergencia:.
    expect(lines).toContain('nota: slice #2 (issue #42): la sección "## Señal de observabilidad" difiere del spec (no cuenta para el exit code; --reconcile no la reescribe — la señal que obedece el juez de slice es la que el issue tenía al despachar, igual que los gates)')
    expect(lines.every((l) => l.startsWith('nota:'))).toBe(true)
    const gaps = reconcileGaps(d, { body: null, unresolvedAc: false, unresolvedDeps: false })
    // `e2e: false` entró en la forma de reconcileGaps con la columna E2E (que
    // SÍ se reescribe y SÍ cuenta para el exit code): aquí sólo diverge la
    // señal, así que ninguna de las cuatro casillas se enciende.
    expect(gaps).toEqual({ ac: false, deps: false, e2e: false, duplicates: false })
    expect(hasReconcileGap(gaps)).toBe(false)
  })

  it('buildReconcileBody no escribe ni retira la sección de señal aunque diverja', () => {
    const SLICE_S = { n: 2, name: 'refresh', type: 'backend', entrega: 'flujo de refresco', deps: [1], ac: ['AC-2.1'], protected: 'schema §6', senal: 'métrica `x` con label `y`' }
    const SPEC_OPTS = { path: 'spec.md', heading: '9. Slices', url: 'https://github.com/o/r/blob/main/spec.md#9-slices', reason: null }
    const WANTED = { deps: [1], ac: ['AC-2.1'], specLink: '> Slice `#2` del epic. Spec: [spec.md § 9. Slices](https://github.com/o/r/blob/main/spec.md#9-slices)' }
    // Caso A: el body TIENE la sección, el spec ya no declara señal, y hay una
    // divergencia real de AC que fuerza un splice — la sección sobrevive
    // verbatim al body reescrito.
    const generado = buildIssueBody(SLICE_S, SPEC_OPTS)
    const rA = buildReconcileBody(generado, { ...WANTED, ac: ['AC-2.1', 'AC-2.2'] })
    expect(rA.body).not.toBeNull()
    expect(extractSectionContent(rA.body, SENAL_SECTION)).toBe('métrica `x` con label `y`')
    // Caso B: el body NO tiene la sección y el spec sí declara señal — el
    // splice de AC no la inserta.
    const sinSenal = buildIssueBody({ ...SLICE_S, senal: '' }, SPEC_OPTS)
    const rB = buildReconcileBody(sinSenal, { ...WANTED, ac: ['AC-2.1', 'AC-2.2'], senal: 'métrica nueva' })
    expect(rB.body).not.toBeNull()
    expect(rB.body).not.toContain(SENAL_SECTION)
  })
})
