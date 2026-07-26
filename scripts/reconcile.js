// F5 — lógica pura de reconciliación: hasta ahora ct-groom.mjs solo sabía
// decir "¿existe ya un issue con este marcador ct-order?" (idempotencia
// existence-only). Si sí, "ya existe, no se duplica" y listo — sin mirar
// NUNCA si el título/labels/milestone del issue siguen coincidiendo con lo
// que la tabla §9 produce HOY. Un autor que arregla un label o un título mal
// puesto en el spec y vuelve a correr /ct-groom no ve ninguna señal de que
// nada cambió: el mismo mensaje de éxito que si todo estuviera perfecto.
//
// Este módulo decide QUÉ cuenta como divergencia (diffIssue/hasDrift), CÓMO
// se reporta (formatDrift) y CÓMO se traduce a los flags de `gh issue edit`
// para aplicarla (buildReconcileEditArgs). ct-groom.mjs es pegamento
// delgado: llama a estas funciones con lo que ya trae de `gh` y del plan, e
// imprime/ejecuta lo que le devuelven — ninguna decisión de negocio vive en
// el wrapper.

// OWNED_LABEL_PREFIXES: el spec es la ÚNICA fuente de verdad para estos tres
// prefijos (buildLabels en groom.js los emite siempre, según Tipo/Área/Toca
// de la tabla §9). `status:` DELIBERADAMENTE se excluye por completo — el
// spec solo decide el valor INICIAL (`status:backlog`, al crear el issue),
// pero un humano o `/ct-next` mueven ese label después (backlog → ready →
// in-progress → in-review…) como parte normal del flujo de trabajo. Si
// comparáramos `status:` igual que type:/area:/touches:, CADA re-groom de un
// epic con trabajo en marcha reportaría "sobra status:in-progress" para
// todo slice que ya se esté trabajando — ruido constante que entrena a
// ignorar el resto del reporte (el mismo fallo, en espejo, que el bug que
// esta feature corrige). Excluir el prefijo entero (no solo "backlog") es lo
// que hace que ninguna transición de status, sea cual sea, se reporte
// jamás como divergencia.
const OWNED_LABEL_PREFIXES = ['type:', 'area:', 'touches:']

export function ownedLabelsOnly(labels) {
  return (labels || []).filter((l) => OWNED_LABEL_PREFIXES.some((p) => l.startsWith(p)))
}

// diffLabels: compara DOS conjuntos de labels, pero solo dentro del
// namespace que el spec posee (ownedLabelsOnly filtra ambos lados). Esto
// implica, sin código especial, que:
//   - una label ajena al spec (sin prefijo type:/area:/touches:, p.ej. "good
//     first issue" o "priority:high") nunca aparece ni en missing ni en extra.
//   - CUALQUIER status: (incluido status:backlog) tampoco aparece nunca — el
//     spec solo produce status:backlog como parte de `wanted`, pero al
//     filtrarlo aquí se descarta de los dos lados por igual, así que jamás
//     se compara.
export function diffLabels(currentLabels, wantedLabels) {
  const current = new Set(ownedLabelsOnly(currentLabels))
  const wanted = new Set(ownedLabelsOnly(wantedLabels))
  const missing = [...wanted].filter((l) => !current.has(l))
  const extra = [...current].filter((l) => !wanted.has(l))
  return { missing, extra }
}

// diffIssue: compara un issue EXISTENTE de verdad (la forma cruda de `gh api
// repos/<o>/<r>/issues`: number, title, state, milestone, labels) contra lo
// que el plan (groom.js#groomPlan) dice que ESE slice debería tener hoy.
//
// El body NO se compara — decisión deliberada, no un descuido:
//   1. Es, con diferencia, el campo que más edita un humano después de
//      crear el issue (contexto añadido, discusión, notas de progreso) —
//      compararlo entero convertiría cada edición legítima en "divergencia".
//   2. El propio marcador `<!-- ct-order:N -->` vive DENTRO del body — nunca
//      es "contenido del spec" en el mismo sentido que título/labels/
//      milestone, es bookkeeping nuestro.
//   3. Los campos que SÍ derivan mecánicamente del spec y viven dentro del
//      body (AC, deps `merge-after`) también son, en la práctica, el lugar
//      donde el trabajo real afina la redacción tras la discusión del
//      issue — tratar cada retoque editorial como drift sería el mismo
//      ruido-que-entrena-a-ignorar que ya se evitó para `status:`.
//   Título/labels/milestone, en cambio, casi nunca se tocan a mano por
//   buenas razones de negocio — cuando divergen del spec, es casi siempre
//   porque el spec cambió y el issue quedó atrás (el escenario exacto que
//   motiva esta feature). Se documenta aquí en vez de en el wrapper porque
//   es una decisión, y las decisiones viven en la capa pura.
//
// labels acepta tanto la forma cruda de la REST API (`[{name: 'x'}, ...]`)
// como un array de strings ya planos — tolerante a la forma de entrada para
// que los tests (y una futura fuente distinta de `gh api`) no tengan que
// adivinar cuál usar.
export function diffIssue(existing, wantedIssue, wantedMilestone) {
  const currentLabelNames = (existing.labels || []).map((l) => (typeof l === 'string' ? l : l.name))
  const labels = diffLabels(currentLabelNames, wantedIssue.labels)
  const currentMilestoneTitle = existing.milestone ? existing.milestone.title : null
  const titleDiffers = existing.title !== wantedIssue.title
  const milestoneDiffers = currentMilestoneTitle !== wantedMilestone
  return {
    order: wantedIssue.order,
    issueNumber: existing.number,
    closed: existing.state === 'closed',
    title: titleDiffers ? { current: existing.title, wanted: wantedIssue.title } : null,
    milestone: milestoneDiffers ? { current: currentMilestoneTitle, wanted: wantedMilestone } : null,
    labels,
  }
}

// hasDrift: `closed` NO cuenta por sí solo. El spec no tiene (ni debe tener)
// ninguna opinión sobre si un issue está abierto o cerrado — eso lo decide
// el flujo de trabajo (un PR mergeado, un humano cerrándolo a mano), no la
// tabla §9. Un issue cerrado cuyo título/labels/milestone siguen
// coincidiendo con el spec es exactamente "spec e issue están de acuerdo" —
// tratarlo como divergencia solo por estar cerrado sería fabricar ruido
// sobre algo que el spec nunca tuvo autoridad para decidir.
export function hasDrift(diff) {
  return Boolean(diff.title || diff.milestone || diff.labels.missing.length || diff.labels.extra.length)
}

// formatDrift: una línea humana por campo divergente, siempre nombrando el
// slice (orden §9), el issue (número real de GitHub), el valor actual y el
// valor que pide el spec — nunca "algo cambió", siempre "esto, de X a Y".
// Sin divergencia → [] (silencio real: "spec e issues están de acuerdo" se
// expresa con AUSENCIA de línea, no con una línea que diga "todo bien" —
// congruente con cómo ya se comportan los avisos existentes del fichero:
// se avisa de lo que está mal, nunca se narra lo que está bien).
//
// El cierre del issue se anota como ÚLTIMA línea, y SOLO cuando ya hay
// alguna otra divergencia que reportar — closed por sí solo no genera
// ninguna línea (ver hasDrift): no hay nada que --reconcile fuera a tocar,
// así que no hay nada de qué avisar antes de aplicarlo.
export function formatDrift(diff) {
  if (!hasDrift(diff)) return []
  const lines = []
  const head = `slice #${diff.order} (issue #${diff.issueNumber})`
  if (diff.title) lines.push(`divergencia: ${head}: título difiere — issue: "${diff.title.current}", spec: "${diff.title.wanted}"`)
  if (diff.milestone) lines.push(`divergencia: ${head}: milestone difiere — issue: "${diff.milestone.current ?? '(ninguno)'}", spec: "${diff.milestone.wanted}"`)
  for (const l of diff.labels.missing) lines.push(`divergencia: ${head}: falta la label "${l}" (la pide el spec, el issue no la tiene)`)
  for (const l of diff.labels.extra) lines.push(`divergencia: ${head}: sobra la label "${l}" (la tiene el issue, el spec ya no la produce)`)
  if (diff.closed) lines.push(`nota: ${head}: el issue está cerrado — revisa antes de aplicar --reconcile`)
  return lines
}

// buildReconcileEditArgs: traduce un diff a los flags de un ÚNICO `gh issue
// edit` (título + milestone + labels en la misma llamada — atómico desde el
// punto de vista del caller: o se aplican todos los campos divergentes de
// este issue, o ninguno, nunca una mezcla a medias por dos llamadas
// independientes que podrían fallar por separado). [] si no hay nada que
// aplicar — el caller debe evitar invocar `gh` en ese caso.
export function buildReconcileEditArgs(diff) {
  const args = []
  if (diff.title) args.push('--title', diff.title.wanted)
  if (diff.milestone) args.push('--milestone', diff.milestone.wanted)
  for (const l of diff.labels.missing) args.push('--add-label', l)
  for (const l of diff.labels.extra) args.push('--remove-label', l)
  return args
}
