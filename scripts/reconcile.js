// F5 — lógica pura de reconciliación: hasta ahora ct-groom.mjs solo sabía
// decir "¿existe ya un issue con este marcador ct-order?" (idempotencia
// existence-only). Si sí, "ya existe, no se duplica" y listo — sin mirar
// NUNCA si el título/labels/milestone/AC/deps del issue siguen coincidiendo
// con lo que la tabla §9 produce HOY. Un autor que arregla un label, un
// título o una dependencia mal puesta en el spec y vuelve a correr
// /ct-groom no ve ninguna señal de que nada cambió: el mismo mensaje de
// éxito que si todo estuviera perfecto.
//
// Review round 3 (coordinador) — tres Critical, atendidos aquí:
//   1. locateSection (gh-issue-map.js) no estaba anclada a columna 0 ni era
//      consciente de vallas de código — REESCRITA ahí (ver ese fichero).
//   2. `--reconcile` podía salir 0 sobre una divergencia real (ac/deps) que
//      SE REPORTÓ pero no se pudo aplicar (p.ej. cabecera renombrada) — ver
//      reconcileGaps/hasReconcileGap más abajo, y cómo ct-groom.mjs los usa
//      para el código de salida y el mensaje.
//   3. Dominio de detección (extractDeps, todo el body) ≠ dominio de
//      aplicación (solo la sección) — unificado: AHORA ambos operan sobre
//      el contenido de la sección reconocida únicamente (ver diffIssue). Es
//      una divergencia deliberada del extractDeps que usa el DISPATCHER de
//      verdad (gh-issue-map.js#mapGhIssue, que sigue escaneando todo el
//      body — ese es su comportamiento real, no se toca aquí): un
//      "merge-after #N" suelto fuera de "## Dependencias" (en Descripción,
//      en una sección nueva…) es, técnicamente, obedecido por el
//      dispatcher real, pero F5 NUNCA podría reescribirlo de forma segura
//      sin arriesgar exactamente el tipo de corrupción de contenido humano
//      que el Critical 1 de esta misma review vino a cerrar. Se documenta
//      como límite conocido, no como descuido.
//
// Este módulo decide QUÉ cuenta como divergencia (diffIssue/hasDrift), CÓMO
// se reporta (formatDrift) y CÓMO se aplica: buildReconcileEditArgs para
// título/milestone/labels, vía los flags de `gh issue edit`; buildReconcileBody
// para el enlace al spec (splice de una sola línea) y AC/Dependencias
// (splice quirúrgico de sección), ambos vía `--body`. ct-groom.mjs es
// pegamento delgado: llama a estas funciones con lo que ya trae de `gh` y
// del plan, e imprime/ejecuta lo que le devuelven — ninguna decisión de
// negocio vive en el wrapper.
import { extractAc, extractDeps, extractSectionContent, locateSection, locateLine, extractSpecLink, countHeadingLines } from './gh-issue-map.js'

// ownedLabelsOnly: el spec solo es autoridad sobre un prefijo (`type:`,
// `area:`, `touches:`) SI la tabla §9 trae la columna que lo alimenta
// (Tipo/Área/Toca respectivamente) — `ownedPrefixes` es ese subconjunto,
// decidido por el caller (ct-groom.mjs, a partir de qué columnas trae la
// tabla) y NO tiene un default aquí a propósito: adivinar "todas por
// defecto" reintroduciría en silencio el falso positivo que esto corrige
// (review, punto 2): sin columna "Área", el spec no tiene ninguna opinión
// sobre `area:` y no debe reclamar autoridad sobre un label que un humano
// puso a mano por su cuenta — reportarlo como "sobra" sería ruido que
// enseña a ignorar el resto del reporte.
//
// `status:` NUNCA es un prefijo activo, ni siquiera cuando el spec sí
// controla su valor inicial (`status:backlog`, al crear el issue) — un
// humano o `/ct-next` lo mueven después (backlog → ready → in-progress →
// in-review…) como parte normal del flujo, así que compararlo reportaría
// "sobra status:in-progress" en todo slice en marcha en cada re-groom.
export function ownedLabelsOnly(labels, ownedPrefixes) {
  return (labels || []).filter((l) => (ownedPrefixes || []).some((p) => l.startsWith(p)))
}

// diffLabels: compara DOS conjuntos de labels, pero solo dentro de
// `ownedPrefixes` (ownedLabelsOnly filtra ambos lados). Esto implica, sin
// código especial, que:
//   - una label ajena al spec, o de un prefijo cuya columna no está en la
//     tabla §9, nunca aparece ni en missing ni en extra.
//   - CUALQUIER status: tampoco aparece nunca (nunca está en ownedPrefixes).
export function diffLabels(currentLabels, wantedLabels, ownedPrefixes) {
  const current = new Set(ownedLabelsOnly(currentLabels, ownedPrefixes))
  const wanted = new Set(ownedLabelsOnly(wantedLabels, ownedPrefixes))
  const missing = [...wanted].filter((l) => !current.has(l))
  const extra = [...current].filter((l) => !wanted.has(l))
  return { missing, extra }
}

// diffSet / diffDeps / diffAc: comparación set-based (el orden en que
// aparecen en el body, o en la tabla §9, no es semánticamente significativo
// — son conjuntos de referencias/criterios, no listas ordenadas).
function diffSet(current, wanted) {
  const c = new Set(current || [])
  const w = new Set(wanted || [])
  return {
    missing: [...w].filter((x) => !c.has(x)),
    extra: [...c].filter((x) => !w.has(x)),
  }
}
export function diffDeps(currentDeps, wantedDeps) {
  return diffSet(currentDeps, wantedDeps)
}
export function diffAc(currentAc, wantedAc) {
  return diffSet(currentAc, wantedAc)
}

// depsInSection / acInSection: extraen deps/ac SOLO del contenido de su
// propia sección reconocida (locateSection) — a diferencia de
// gh-issue-map.js#extractDeps (usada por el DISPATCHER real, que escanea
// todo el body a propósito), esta es la extracción que F5 usa para
// comparar Y para decidir si `buildReconcileBody` puede aplicar el arreglo
// (Critical 3: mismo dominio en detección y en aplicación). `extractAc` ya
// era, de hecho, section-scoped desde antes (internamente ya usa
// extractSectionContent) — se reexporta aquí sin más para que diffIssue no
// tenga que decidir dos criterios distintos para ac/deps.
function depsInSection(body) {
  return extractDeps(extractSectionContent(body, '## Dependencias') || '')
}
function acInSection(body) {
  return extractAc(body)
}

// diffIssue: compara un issue EXISTENTE de verdad (la forma cruda de `gh api
// repos/<o>/<r>/issues`: number, title, state, milestone, labels, body)
// contra lo que el plan (groom.js#groomPlan) dice que ESE slice debería
// tener hoy (wantedIssue: título, milestone, labels, deps, ac, descripcion,
// protectedLine, specLink — todos campos que groomPlan ya expone, no solo
// el body ya renderizado).
//
// El marcador `<!-- ct-order:N -->` es lo ÚNICO del body que queda
// completamente fuera del diff: es bookkeeping nuestro (el puente
// orden-de-slice ↔ número-de-issue), nunca "contenido del spec". La línea
// de enlace al spec (`> Slice #N del epic. Spec: …`) SÍ es contenido del
// spec (deriva de `--section`/la ruta) — se compara igual que el título
// (review round 3, importante 5: antes se afirmaba, incorrectamente, que
// el marcador era "lo único" fuera de la comparación).
//
// Descripción/Protegido SÍ se comparan (el spec los posee: derivan de
// Entrega/Protegido en la tabla §9), pero solo con un flag booleano
// (descripcionDiffers/protectedDiffers) — nunca se muestra el texto
// completo, y (ver hasDrift más abajo) NUNCA cuentan para el código de
// salida: son prosa que un humano edita de forma rutinaria y legítima tras
// crear el issue; si contaran, cualquier ampliación normal de la
// descripción dejaría el proceso en exit 3 para siempre, sin ningún
// `--reconcile` capaz de resolverlo — el mismo argumento del ruido que
// justifica gatear las labels por columna, aplicado aquí (review round 3,
// punto 6).
//
// labels acepta tanto la forma cruda de la REST API (`[{name: 'x'}, ...]`)
// como un array de strings ya planos.
export function diffIssue(existing, wantedIssue, wantedMilestone, ownedLabelPrefixes) {
  const currentLabelNames = (existing.labels || []).map((l) => (typeof l === 'string' ? l : l.name))
  const labels = diffLabels(currentLabelNames, wantedIssue.labels, ownedLabelPrefixes)
  const currentMilestoneTitle = existing.milestone ? existing.milestone.title : null
  const titleDiffers = existing.title !== wantedIssue.title
  const milestoneDiffers = currentMilestoneTitle !== wantedMilestone

  const currentSpecLink = extractSpecLink(existing.body)
  const specLinkDiffers = currentSpecLink !== wantedIssue.specLink

  const deps = diffDeps(depsInSection(existing.body), wantedIssue.deps)
  const ac = diffAc(acInSection(existing.body), wantedIssue.ac)

  // Descripción: `null` en cualquiera de los dos lados significa "no debería
  // existir ninguna sección" — null en AMBOS lados es acuerdo (silencio
  // real), no divergencia. Solo se compara el texto (trim) cuando los dos
  // lados sí tienen sección.
  const currentDescripcion = extractSectionContent(existing.body, '## Descripción') // string o null (sin sección)
  const wantedDescripcion = wantedIssue.descripcion ?? null // idem
  let descripcionDiffers
  if (currentDescripcion === null && wantedDescripcion === null) {
    descripcionDiffers = false // acuerdo: ninguno de los dos lados tiene sección
  } else if (currentDescripcion === null || wantedDescripcion === null) {
    descripcionDiffers = true // un lado tiene sección, el otro no
  } else {
    descripcionDiffers = currentDescripcion.trim() !== wantedDescripcion.trim()
  }

  // Protegido: SIEMPRE debería existir (buildIssueBody la emite
  // incondicionalmente) — si la cabecera falta del todo en el issue
  // existente (un humano la borró a mano), se trata como divergencia.
  const currentProtected = extractSectionContent(existing.body, '## Out of scope / Protected')
  const protectedDiffers = currentProtected === null || currentProtected.trim() !== (wantedIssue.protectedLine || '').trim()

  // duplicateSections (menor, review round 3): cabeceras conocidas que
  // aparecen MÁS de una vez en el body — informativo únicamente (ver
  // formatDrift), no cuenta para hasDrift ni para el código de salida: no
  // hay "spec vs. issue" que comparar aquí, es un aviso sobre la FORMA del
  // body en sí (locateSection/buildReconcileBody solo ven/tocan la
  // primera aparición; la segunda queda huérfana e invisible de otro
  // modo).
  const duplicateSections = [
    ['## Descripción', 'Descripción'],
    ['## Acceptance criteria', 'Acceptance criteria'],
    ['## Dependencias', 'Dependencias'],
    ['## Out of scope / Protected', 'Out of scope / Protected'],
  ].filter(([prefix]) => countHeadingLines(existing.body, prefix) > 1).map(([, label]) => label)

  return {
    order: wantedIssue.order,
    issueNumber: existing.number,
    closed: existing.state === 'closed',
    title: titleDiffers ? { current: existing.title, wanted: wantedIssue.title } : null,
    milestone: milestoneDiffers ? { current: currentMilestoneTitle, wanted: wantedMilestone } : null,
    specLink: specLinkDiffers ? { current: currentSpecLink, wanted: wantedIssue.specLink } : null,
    labels,
    deps,
    ac,
    descripcionDiffers,
    protectedDiffers,
    duplicateSections,
  }
}

// hasDrift: cuenta título/milestone/enlace-al-spec/labels/deps/ac — TODOS
// campos deterministas, cortos o estructurados, que `--reconcile` puede (al
// menos en principio) aplicar. `closed`, Descripción/Protegido y
// duplicateSections NUNCA cuentan (ver arriba y formatDrift): son, o bien
// algo sobre lo que el spec no tiene autoridad (closed), o bien prosa que
// se edita de forma rutinaria (Descripción/Protegido) — anclar el exit
// code a cualquiera de ellos entrenaría a ignorar el resto del reporte,
// exactamente el problema que esta feature corrige en la otra dirección.
export function hasDrift(diff) {
  return Boolean(
    diff.title || diff.milestone || diff.specLink ||
    diff.labels.missing.length || diff.labels.extra.length ||
    diff.deps.missing.length || diff.deps.extra.length ||
    diff.ac.missing.length || diff.ac.extra.length,
  )
}

// reconcileGaps / hasReconcileGap (review round 3, Critical 2): --reconcile
// puede REPORTAR una divergencia de ac/deps sin poder APLICARLA — la
// cabecera de la sección puede no existir (un humano la renombró o la
// borró), y sin ella `buildReconcileBody` no tiene dónde escribir el
// arreglo. `bodyResult` es el resultado de `buildReconcileBody` (más abajo,
// trae `unresolvedAc`/`unresolvedDeps`) — un gap real es "el diff dice que
// diverge Y buildReconcileBody no pudo tocarlo". title/milestone/labels/
// specLink nunca tienen gap: siempre se resuelven vía flags o un splice de
// una sola línea, sin depender de localizar una sección con cabecera.
export function reconcileGaps(diff, bodyResult) {
  return {
    ac: Boolean((diff.ac.missing.length || diff.ac.extra.length) && bodyResult.unresolvedAc),
    deps: Boolean((diff.deps.missing.length || diff.deps.extra.length) && bodyResult.unresolvedDeps),
  }
}
export function hasReconcileGap(gaps) {
  return Boolean(gaps.ac || gaps.deps)
}

// formatDrift: una línea humana por campo. Título/milestone/enlace-al-spec/
// labels/deps/ac son "divergencia:" — cuentan para el exit code (hasDrift)
// y muestran el valor actual y el que pide el spec (identificadores cortos
// o códigos, seguros de mostrar enteros). Descripción/Protegido son
// "nota:" — SIEMPRE se reportan si divergen (silencio total sobre esto
// sería tan malo como no reportar nada), pero NUNCA cuentan para el exit
// code (ver hasDrift) — la sección "nota:" vs. "divergencia:" es la forma
// en que la salida distingue "esto es tuyo, revísalo cuando quieras" de
// "esto es una divergencia real que --reconcile puede intentar arreglar".
// `duplicateSections` también es una nota informativa. El cierre del
// issue se anota al final, y solo si ya hay alguna otra línea que
// reportar (closed por sí solo, sin más, es silencio real).
export function formatDrift(diff) {
  const lines = []
  const head = `slice #${diff.order} (issue #${diff.issueNumber})`
  if (diff.title) lines.push(`divergencia: ${head}: título difiere — issue: "${diff.title.current}", spec: "${diff.title.wanted}"`)
  if (diff.milestone) lines.push(`divergencia: ${head}: milestone difiere — issue: "${diff.milestone.current ?? '(ninguno)'}", spec: "${diff.milestone.wanted}"`)
  if (diff.specLink) lines.push(`divergencia: ${head}: el enlace al spec difiere — issue: "${diff.specLink.current ?? '(ausente)'}", spec: "${diff.specLink.wanted}"`)
  for (const l of diff.labels.missing) lines.push(`divergencia: ${head}: falta la label "${l}" (la pide el spec, el issue no la tiene)`)
  for (const l of diff.labels.extra) lines.push(`divergencia: ${head}: sobra la label "${l}" (la tiene el issue, el spec ya no la produce)`)
  for (const d of diff.deps.missing) lines.push(`divergencia: ${head}: falta la dependencia "merge-after #${d}" (la pide el spec, el issue no la tiene)`)
  for (const d of diff.deps.extra) lines.push(`divergencia: ${head}: sobra la dependencia "merge-after #${d}" (la tiene el issue, el spec ya no la produce)`)
  for (const a of diff.ac.missing) lines.push(`divergencia: ${head}: falta el criterio de aceptación "${a}" (lo pide el spec, el issue no lo tiene)`)
  for (const a of diff.ac.extra) lines.push(`divergencia: ${head}: sobra el criterio de aceptación "${a}" (lo tiene el issue, el spec ya no lo produce)`)
  if (diff.descripcionDiffers) lines.push(`nota: ${head}: la sección "## Descripción" difiere del spec (prosa — no cuenta para el exit code; --reconcile no la reescribe)`)
  if (diff.protectedDiffers) lines.push(`nota: ${head}: la sección "## Out of scope / Protected" difiere del spec (prosa — no cuenta para el exit code; --reconcile no la reescribe)`)
  for (const section of diff.duplicateSections || []) {
    lines.push(`nota: ${head}: la sección "## ${section}" aparece más de una vez en el body — solo la primera se compara/reconcilia; revisa la(s) copia(s) sobrante(s) a mano`)
  }
  if (diff.closed && lines.length) lines.push(`nota: ${head}: el issue está cerrado — revisa antes de aplicar --reconcile`)
  return lines
}

// buildReconcileEditArgs: traduce título/milestone/labels a los flags de un
// ÚNICO `gh issue edit` (atómico desde el punto de vista del caller). []
// si no hay nada de esto que aplicar. El enlace al spec y AC/Dependencias
// NO viven aquí — se aplican vía `--body` (ver buildReconcileBody), pero el
// caller (ct-groom.mjs) combina ambos en la MISMA llamada a `gh issue edit`.
export function buildReconcileEditArgs(diff) {
  const args = []
  if (diff.title) args.push('--title', diff.title.wanted)
  if (diff.milestone) args.push('--milestone', diff.milestone.wanted)
  for (const l of diff.labels.missing) args.push('--add-label', l)
  for (const l of diff.labels.extra) args.push('--remove-label', l)
  return args
}

function renderAcContent(ac) {
  return (ac && ac.length) ? ac.map((a) => `- ${a}`).join('\n') : '- (rellenar desde el spec)'
}
function renderDepsContent(deps) {
  return (deps || []).map((d) => `- merge-after #${d}`).join('\n')
}

// withTrailingBlankLine: garantiza que `text` termine en exactamente una
// línea en blanco ("\n\n") antes de insertar algo justo detrás — fix de
// review round 3 (menor): la versión anterior insertaba una sección
// "## Dependencias" nueva en `body.length` (cuando ni la sección de deps ni
// "## Out of scope / Protected" existían) SIN ningún separador, pegando la
// cabecera nueva directamente al carácter anterior (típicamente el propio
// marcador `<!-- ct-order:N -->`, que casi nunca termina en salto de
// línea).
function withTrailingBlankLine(text) {
  if (text.length === 0) return text
  if (text.endsWith('\n\n')) return text
  if (text.endsWith('\n')) return text + '\n'
  return text + '\n\n'
}

// buildReconcileBody: --reconcile SÍ reescribe el enlace al spec y
// AC/Dependencias (a diferencia de Descripción/Protegido, ver diffIssue)
// porque son campos deterministas o estructurados que el dispatcher (o la
// trazabilidad del spec) obedecen/necesitan de verdad — dejarlos
// divergentes tras un --reconcile "exitoso" sería peor que las labels que
// motivaron esta feature. Reemplaza SOLO el rango de cada sección/línea
// conocida dentro del body EXISTENTE (locateSection/locateLine,
// scripts/gh-issue-map.js) — nunca reconstruye el body entero — así
// cualquier contenido humano antes/después de esas secciones (incluida una
// sección nueva con su propia cabecera "## …" que un humano haya añadido en
// cualquier punto) se preserva intacto.
//
// Devuelve `{ body, unresolvedAc, unresolvedDeps }`: `body` es el body
// spliceado, o `null` si nada necesitaba cambiar. `unresolvedAc`/
// `unresolvedDeps` (review round 3, Critical 2) son ciertos cuando el diff
// SÍ pedía un cambio pero no se pudo aplicar — hoy eso solo le puede pasar
// a AC (su cabecera SIEMPRE debería existir en un body bien formado; si un
// humano la renombra o la borra, no hay dónde escribir el reemplazo y NO
// se inventa una posición). Dependencias, al ser una sección condicional,
// siempre tiene una acción segura (reemplazar/insertar/retirar), así que
// `unresolvedDeps` se mantiene por simetría con `unresolvedAc` — el
// caller (ct-groom.mjs, vía reconcileGaps) es quien decide qué significa
// cada gap para el mensaje y el código de salida; esta función no lo
// decide, solo lo informa.
//
// "¿Necesita cambiar?" se decide con diffSet/depsInSection/acInSection
// (el MISMO criterio, y el MISMO dominio — section-scoped — que usa
// diffIssue, ver Critical 3 arriba) — nunca una comparación de texto
// crudo ni un escaneo de todo el body: si el issue tiene "AC-1.1, AC-1.2"
// y el spec pide el mismo conjunto en otro orden, diffIssue ya dice "sin
// divergencia", así que reescribir aquí solo por una diferencia de orden
// contradiría esa misma decisión.
export function buildReconcileBody(existingBody, wantedIssue) {
  let body = existingBody || ''
  let changed = false
  let unresolvedAc = false
  const unresolvedDeps = false // ver comentario de la función: hoy siempre resoluble (replace/insert/remove)

  const specLinkLoc = locateLine(body, '> Slice #')
  const currentSpecLink = specLinkLoc ? specLinkLoc.line : null
  if (currentSpecLink !== wantedIssue.specLink) {
    if (specLinkLoc) {
      body = body.slice(0, specLinkLoc.start) + wantedIssue.specLink + body.slice(specLinkLoc.end)
    } else {
      // Sin línea previa que reemplazar (un humano la borró): se antepone
      // al principio del body, en la misma posición en la que
      // buildIssueBody la coloca siempre.
      body = wantedIssue.specLink + (body.length ? '\n\n' + body : '')
    }
    changed = true
  }

  const acDiff = diffAc(acInSection(body), wantedIssue.ac)
  if (acDiff.missing.length || acDiff.extra.length) {
    const acLoc = locateSection(body, '## Acceptance criteria')
    if (acLoc) {
      body = body.slice(0, acLoc.headingEnd) + renderAcContent(wantedIssue.ac) + '\n' + body.slice(acLoc.contentEnd)
      changed = true
    } else {
      // Cabecera "## Acceptance criteria" ausente por completo: no hay
      // dónde escribir el reemplazo sin adivinar una posición — se rinde
      // limpiamente en vez de inventar una, y lo informa (unresolvedAc)
      // para que el caller nunca reporte esto como "aplicado" ni, peor,
      // como "solo prosa" (review round 3, Critical 2).
      unresolvedAc = true
    }
  }

  const depsDiff = diffDeps(depsInSection(body), wantedIssue.deps)
  const wantDeps = (wantedIssue.deps || []).length > 0
  if (depsDiff.missing.length || depsDiff.extra.length) {
    const depsLoc = locateSection(body, '## Dependencias') // sobre el body YA actualizado (posiciones frescas tras los splices de arriba, si hubo alguno)
    const wantedDepsContent = renderDepsContent(wantedIssue.deps)
    if (wantDeps && depsLoc) {
      body = body.slice(0, depsLoc.headingEnd) + wantedDepsContent + '\n' + body.slice(depsLoc.contentEnd)
      changed = true
    } else if (wantDeps && !depsLoc) {
      // Sección ausente pero el spec ahora sí quiere deps: se inserta ENTERA
      // (cabecera incluida) en la misma posición que buildIssueBody usaría —
      // justo antes de "## Out of scope / Protected" (que SIEMPRE existe) —
      // para que un futuro re-groom la vuelva a encontrar donde la espera.
      const protectedLoc = locateSection(body, '## Out of scope / Protected')
      const insertion = `## Dependencias\n${wantedDepsContent}\n\n`
      if (protectedLoc) {
        body = body.slice(0, protectedLoc.headingStart) + insertion + body.slice(protectedLoc.headingStart)
      } else {
        // Degenerado (ni Dependencias ni Protected existen): se añade al
        // final, garantizando primero un separador real — nunca pegado al
        // carácter anterior (típicamente el marcador ct-order).
        body = withTrailingBlankLine(body) + insertion
      }
      changed = true
    } else if (!wantDeps && depsLoc) {
      // El spec ya no declara deps para este slice, pero el issue conserva
      // la sección — se retira ENTERA (cabecera incluida), no solo su
      // contenido.
      body = body.slice(0, depsLoc.headingStart) + body.slice(depsLoc.contentEnd)
      changed = true
    }
  }

  return { body: changed ? body : null, unresolvedAc, unresolvedDeps }
}
