// F5 — lógica pura de reconciliación: hasta ahora ct-groom.mjs solo sabía
// decir "¿existe ya un issue con este marcador ct-order?" (idempotencia
// existence-only). Si sí, "ya existe, no se duplica" y listo — sin mirar
// NUNCA si el título/labels/milestone/AC/deps del issue siguen coincidiendo
// con lo que la tabla §9 produce HOY. Un autor que arregla un label, un
// título o una dependencia mal puesta en el spec y vuelve a correr
// /ct-groom no ve ninguna señal de que nada cambió: el mismo mensaje de
// éxito que si todo estuviera perfecto.
//
// Review de la primera versión (coordinador): excluir el body ENTERO tiraba
// justo lo que no es territorio humano. `merge-after #N` (deps) y `##
// Acceptance criteria` (ac) son datos ESTRUCTURADOS que el dispatcher
// obedece de verdad (gh-issue-map.js#mapGhIssue → dispatch.js decide si un
// slice se puede despachar con `deps`; kickoff.js compone el prompt del
// agente con `ac`) — no son prosa libre, y el body entero lo genera
// buildIssueBody a partir de una plantilla con secciones conocidas, así que
// compararlas SECCIÓN A SECCIÓN es preciso. Solo el marcador ct-order
// (bookkeeping nuestro) y la prosa genuinamente libre (Descripción/
// Protegido — comparadas, pero solo con un flag booleano, sin volcar el
// texto) quedan fuera del diff estructurado.
//
// Este módulo decide QUÉ cuenta como divergencia (diffIssue/hasDrift), CÓMO
// se reporta (formatDrift) y CÓMO se aplica (buildReconcileEditArgs para
// título/milestone/labels vía flags; buildReconcileBody para AC/Dependencias
// vía un splice quirúrgico del body). ct-groom.mjs es pegamento delgado:
// llama a estas funciones con lo que ya trae de `gh` y del plan, e
// imprime/ejecuta lo que le devuelven — ninguna decisión de negocio vive en
// el wrapper.
import { extractAc, extractDeps, extractSectionContent, locateSection } from './gh-issue-map.js'

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

// diffDeps / diffAc: comparación set-based (el orden en que aparecen en el
// body, o en la tabla §9, no es semánticamente significativo — son
// conjuntos de referencias/criterios, no listas ordenadas) de las dos
// secciones que el dispatcher SÍ obedece:
//   - deps (`merge-after #N`, extractDeps): gh-issue-map.js#mapGhIssue las
//     expone a dispatch.js, que gatea si el slice se puede despachar.
//   - ac (`## Acceptance criteria`, extractAc): kickoff.js las incluye
//     literalmente en el prompt del agente despachado.
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

// diffIssue: compara un issue EXISTENTE de verdad (la forma cruda de `gh api
// repos/<o>/<r>/issues`: number, title, state, milestone, labels, body)
// contra lo que el plan (groom.js#groomPlan) dice que ESE slice debería
// tener hoy (wantedIssue: título, milestone, labels, deps, ac, descripcion,
// protectedLine — todos campos que groomPlan ya expone, no solo el body ya
// renderizado).
//
// El marcador `<!-- ct-order:N -->` es lo ÚNICO del body que queda
// completamente fuera del diff: es bookkeeping nuestro (el puente
// orden-de-slice ↔ número-de-issue), nunca "contenido del spec".
//
// Descripción/Protegido SÍ se comparan (el spec los posee: derivan de
// Entrega/Protegido en la tabla §9), pero solo con un flag booleano
// (descripcionDiffers/protectedDiffers) — nunca se muestra el texto
// completo en el diff/reporte. Justificación: a diferencia de AC/deps
// (listas cortas de códigos/referencias, seguras de mostrar enteras), estas
// dos secciones son prosa de longitud arbitraria; volcarla en un reporte de
// CLI sería ruidoso y difícil de escanear. `--reconcile` tampoco las
// reescribe (ver buildReconcileBody): un splice de texto libre no puede
// garantizar, en general, que no se pierda una elaboración legítima que un
// humano haya añadido dentro de esa misma sección — el riesgo/beneficio no
// es el mismo que para AC/deps (listas estructuradas de las que SÍ se
// conoce exactamente qué debería haber).
//
// labels acepta tanto la forma cruda de la REST API (`[{name: 'x'}, ...]`)
// como un array de strings ya planos.
export function diffIssue(existing, wantedIssue, wantedMilestone, ownedLabelPrefixes) {
  const currentLabelNames = (existing.labels || []).map((l) => (typeof l === 'string' ? l : l.name))
  const labels = diffLabels(currentLabelNames, wantedIssue.labels, ownedLabelPrefixes)
  const currentMilestoneTitle = existing.milestone ? existing.milestone.title : null
  const titleDiffers = existing.title !== wantedIssue.title
  const milestoneDiffers = currentMilestoneTitle !== wantedMilestone

  const deps = diffDeps(extractDeps(existing.body), wantedIssue.deps)
  const ac = diffAc(extractAc(existing.body), wantedIssue.ac)

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

  return {
    order: wantedIssue.order,
    issueNumber: existing.number,
    closed: existing.state === 'closed',
    title: titleDiffers ? { current: existing.title, wanted: wantedIssue.title } : null,
    milestone: milestoneDiffers ? { current: currentMilestoneTitle, wanted: wantedMilestone } : null,
    labels,
    deps,
    ac,
    descripcionDiffers,
    protectedDiffers,
  }
}

// hasDrift: `closed` NO cuenta por sí solo. El spec no tiene (ni debe tener)
// ninguna opinión sobre si un issue está abierto o cerrado — eso lo decide
// el flujo de trabajo (un PR mergeado, un humano cerrándolo a mano), no la
// tabla §9. Un issue cerrado cuyo título/labels/milestone/AC/deps/prosa
// siguen coincidiendo con el spec es exactamente "spec e issue están de
// acuerdo" — tratarlo como divergencia solo por estar cerrado sería
// fabricar ruido sobre algo que el spec nunca tuvo autoridad para decidir.
export function hasDrift(diff) {
  return Boolean(
    diff.title || diff.milestone ||
    diff.labels.missing.length || diff.labels.extra.length ||
    diff.deps.missing.length || diff.deps.extra.length ||
    diff.ac.missing.length || diff.ac.extra.length ||
    diff.descripcionDiffers || diff.protectedDiffers,
  )
}

// formatDrift: una línea humana por campo divergente, siempre nombrando el
// slice (orden §9) y el issue (número real de GitHub). Título/milestone/
// labels/deps/ac muestran el valor actual y el que pide el spec (son todos
// identificadores cortos o códigos — seguros de mostrar enteros).
// Descripción/Protegido SOLO señalan que difieren (ver diffIssue para la
// justificación de por qué no se vuelca el texto). Sin divergencia → []
// (silencio real — congruente con el resto de avisos de este proyecto: se
// avisa de lo que está mal, nunca se narra lo que está bien).
//
// El cierre del issue se anota como ÚLTIMA línea, y SOLO cuando ya hay
// alguna otra divergencia que reportar.
export function formatDrift(diff) {
  if (!hasDrift(diff)) return []
  const lines = []
  const head = `slice #${diff.order} (issue #${diff.issueNumber})`
  if (diff.title) lines.push(`divergencia: ${head}: título difiere — issue: "${diff.title.current}", spec: "${diff.title.wanted}"`)
  if (diff.milestone) lines.push(`divergencia: ${head}: milestone difiere — issue: "${diff.milestone.current ?? '(ninguno)'}", spec: "${diff.milestone.wanted}"`)
  for (const l of diff.labels.missing) lines.push(`divergencia: ${head}: falta la label "${l}" (la pide el spec, el issue no la tiene)`)
  for (const l of diff.labels.extra) lines.push(`divergencia: ${head}: sobra la label "${l}" (la tiene el issue, el spec ya no la produce)`)
  for (const d of diff.deps.missing) lines.push(`divergencia: ${head}: falta la dependencia "merge-after #${d}" (la pide el spec, el issue no la tiene)`)
  for (const d of diff.deps.extra) lines.push(`divergencia: ${head}: sobra la dependencia "merge-after #${d}" (la tiene el issue, el spec ya no la produce)`)
  for (const a of diff.ac.missing) lines.push(`divergencia: ${head}: falta el criterio de aceptación "${a}" (lo pide el spec, el issue no lo tiene)`)
  for (const a of diff.ac.extra) lines.push(`divergencia: ${head}: sobra el criterio de aceptación "${a}" (lo tiene el issue, el spec ya no lo produce)`)
  if (diff.descripcionDiffers) lines.push(`divergencia: ${head}: la sección "## Descripción" difiere del spec (prosa — revisa el issue a mano, --reconcile no la reescribe)`)
  if (diff.protectedDiffers) lines.push(`divergencia: ${head}: la sección "## Out of scope / Protected" difiere del spec (prosa — revisa el issue a mano, --reconcile no la reescribe)`)
  if (diff.closed) lines.push(`nota: ${head}: el issue está cerrado — revisa antes de aplicar --reconcile`)
  return lines
}

// buildReconcileEditArgs: traduce título/milestone/labels a los flags de un
// ÚNICO `gh issue edit` (atómico desde el punto de vista del caller). []
// si no hay nada de esto que aplicar. AC/Dependencias NO viven aquí — se
// aplican vía `--body` (ver buildReconcileBody), pero el caller (ct-groom.mjs)
// combina ambos en la MISMA llamada a `gh issue edit`.
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

// buildReconcileBody: --reconcile SÍ reescribe AC/Dependencias (a diferencia
// de Descripción/Protegido, ver diffIssue) porque son los dos campos que el
// dispatcher obedece de verdad — dejarlos divergentes tras un --reconcile
// "exitoso" sería peor que las labels que motivaron esta feature (un slice
// se despacharía en el orden equivocado, o el agente recibiría AC
// incompletos). Reemplaza SOLO el rango de cada sección conocida dentro del
// body EXISTENTE (locateSection, scripts/gh-issue-map.js) — nunca reconstruye
// el body entero — así cualquier contenido humano antes/después de esas
// secciones (incluida una sección nueva con su propia cabecera "## …" que un
// humano haya añadido en cualquier punto) se preserva intacto. Devuelve
// `null` si ni AC ni Dependencias necesitan cambiar (nada que aplicar).
//
// "¿Necesita cambiar?" se decide con diffSet (el MISMO criterio set-based
// que diffAc/diffDeps, no una comparación de texto crudo) — a propósito:
// si el issue tiene "AC-1.1, AC-1.2" y el spec pide el mismo conjunto en
// otro orden, diffIssue ya dice "sin divergencia" (el orden no es
// semántico), así que reescribir aquí solo por una diferencia de orden
// contradiría esa misma decisión y produciría una mutación de `--reconcile`
// que nadie pidió (el reporte de arriba no la habría anunciado). Reescribir
// únicamente cuando missing/extra no están vacíos mantiene "lo que se
// reporta" y "lo que se aplica" como la MISMA fuente de verdad.
//
// La sección "## Acceptance criteria" SIEMPRE existe en un body bien
// formado (buildIssueBody la emite incondicionalmente, aunque esté vacía) —
// por eso aquí solo se REEMPLAZA su contenido, nunca se inserta/retira la
// cabecera. "## Dependencias" es condicional (solo aparece si el slice tiene
// deps) — puede tener que aparecer, desaparecer, o solo cambiar de
// contenido, según lo que quiera hoy el spec.
export function buildReconcileBody(existingBody, wantedIssue) {
  let body = existingBody || ''
  let changed = false

  const acDiff = diffAc(extractAc(body), wantedIssue.ac)
  if (acDiff.missing.length || acDiff.extra.length) {
    const acLoc = locateSection(body, '## Acceptance criteria')
    if (acLoc) {
      body = body.slice(0, acLoc.headingEnd) + renderAcContent(wantedIssue.ac) + '\n' + body.slice(acLoc.contentEnd)
      changed = true
    }
  }

  const depsDiff = diffDeps(extractDeps(body), wantedIssue.deps)
  const wantDeps = (wantedIssue.deps || []).length > 0
  if (depsDiff.missing.length || depsDiff.extra.length) {
    const depsLoc = locateSection(body, '## Dependencias') // sobre el body YA actualizado (posiciones frescas tras el splice de AC, si hubo uno)
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
      const insertAt = protectedLoc ? protectedLoc.headingStart : body.length
      body = body.slice(0, insertAt) + insertion + body.slice(insertAt)
      changed = true
    } else if (!wantDeps && depsLoc) {
      // El spec ya no declara deps para este slice, pero el issue conserva
      // la sección — se retira ENTERA (cabecera incluida), no solo su
      // contenido.
      body = body.slice(0, depsLoc.headingStart) + body.slice(depsLoc.contentEnd)
      changed = true
    }
  }

  return changed ? body : null
}
