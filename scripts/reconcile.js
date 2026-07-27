// F5 — lógica pura de reconciliación: hasta ahora ct-groom.mjs solo sabía
// decir "¿existe ya un issue con este marcador ct-order?" (idempotencia
// existence-only). Si sí, "ya existe, no se duplica" y listo — sin mirar
// NUNCA si el título/labels/milestone/AC/deps del issue siguen coincidiendo
// con lo que la tabla §9 produce HOY. Un autor que arregla un label, un
// título o una dependencia mal puesta en el spec y vuelve a correr
// /ct-groom no ve ninguna señal de que nada cambió: el mismo mensaje de
// éxito que si todo estuviera perfecto.
//
// Review round 4 (el reviewer atacó su PROPIO escáner del round 3, no solo
// los tres casos que se le habían dado) — tres Critical más:
//   1. El rastreador de vallas (gh-issue-map.js) conmutaba con CUALQUIER
//      delimitador, sin mirar tipo ni longitud — REESCRITO ahí (stepFence),
//      ahora exige mismo carácter y longitud >= apertura, como CommonMark.
//   2. `locateSection` usaba `startsWith` para las CUATRO secciones, pero
//      solo AC tiene un sufijo legítimo — REESCRITO ahí: igualdad exacta
//      por defecto, prefijo solo para AC.
//   3. La rama degenerada de inserción de deps (sin "## Dependencias" NI
//      "## Out of scope / Protected" localizables) añadía una sección
//      nueva CIEGAMENTE en cada corrida, sin límite — ahora se RINDE
//      (unresolvedDeps, antes hardcodeado a `false`) igual que ya hacía AC.
//
// Y tres Importantes:
//   4. El enlace al spec se comparaba por texto completo, incluida la
//      ruta — dos costumbres de invocación (relativa/absoluta) hacían
//      ping-pong sobre issues reales para siempre. Ahora se compara SOLO
//      el ancla `#sección` (specLinkAnchor, gh-issue-map.js).
//   5. Un `## Dependencias`/`## Acceptance criteria` DUPLICADO cambia lo
//      que hace el dispatcher (que no sabe de "primera aparición") — esos
//      dos SÍ cuentan para el exit code; duplicar Descripción/Protegido
//      sigue siendo solo cosmético (nota, no cuenta).
//   6. Asimetría con mapGhIssue: la aplicación se queda acotada a la
//      sección (a propósito, ver el punto 3 de la ronda anterior), pero
//      ahora TAMBIÉN se escanea el body entero para avisar (nota:, nunca
//      divergencia:) de cualquier `merge-after` que el dispatcher vería
//      pero que vive fuera de la sección reconocida — el silencio ya no
//      afirma más de lo que la herramienta sabe.
//
// Y un Menor: CRLF. Todo el procesamiento normaliza a LF internamente
// (gh-issue-map.js#normalizeToLF) y, si aplica, `buildReconcileBody`
// reconvierte el resultado al final de línea original antes de devolverlo.
//
// Review round 5 — mismo diagnóstico que la ronda 4, aplicado a las OTRAS
// dos cosas con forma de delimitador que viven en el mismo body: "se
// endurecieron las vallas a fondo y se dejaron intactas comentarios HTML y
// encabezados que no son '## '". Dos Critical más, cerrados en
// gh-issue-map.js (ver stepLine/ATX_HEADING_RE ahí):
//   1. Un comentario HTML MULTILÍNEA (abre `<!--` sin cerrar en la misma
//      línea) no ocultaba su interior — una cabecera conocida "comentada"
//      dentro se leía como estructura real, y --reconcile podía escribir
//      DENTRO del comentario y borrar su propio `-->` de cierre.
//   2. Solo "## " a columna 0 terminaba una sección — "#", "###", "####",
//      un "##" con tabulador, o indentado 1-3 espacios (todos cabeceras
//      reales en GitHub) no terminaban nada: su contenido se tragaba en el
//      splice de la sección anterior.
//
// Y en este fichero, un Importante y un Menor más:
//   3. `hasDrift` cuenta duplicateMachineSections, pero `reconcileGaps`
//      solo cubría ac/deps — una divergencia real (duplicado) que
//      --reconcile no puede aplicar salía 0. Ahora `reconcileGaps` también
//      trae `duplicates` (ver el comentario de esa función).
//   4. La justificación de por qué un AC duplicado cuenta era la MISMA que
//      la de Dependencias (unión) — falso: solo Dependencias une, AC
//      descarta la segunda copia en silencio (ver el comentario de
//      DUPLICATE_CHECKS). Se mantiene `machine: true` para AC — descartar
//      en silencio una edición humana real es tan grave como una unión
//      indebida — pero con la justificación correcta.
// Y, en gh-issue-map.js, Importante 4: `extractAc` localizaba la sección
// por prefijo abierto (`{ exact: false }`) — el único hueco legítimo es un
// conjunto CERRADO de dos cadenas (AC_HEADING_FORMS), no un prefijo.
//
// Además, decisión de producto: `--reconcile` se documenta como
// EXPERIMENTAL (ver ct-groom.mjs y commands/ct-groom.md) — cinco rondas de
// review, cada una encontrando una forma nueva de corromper un body real,
// son evidencia suficiente de que la mitad de APLICACIÓN de esta feature
// (a diferencia de la de DETECCIÓN, que nunca escribe nada) sigue sin
// conocerse por completo.
//
// Este módulo decide QUÉ cuenta como divergencia (diffIssue/hasDrift), CÓMO
// se reporta (formatDrift) y CÓMO se aplica: buildReconcileEditArgs para
// título/milestone/labels, vía los flags de `gh issue edit`; buildReconcileBody
// para el enlace al spec (splice de una sola línea) y AC/Dependencias
// (splice quirúrgico de sección), ambos vía `--body`. ct-groom.mjs es
// pegamento delgado: llama a estas funciones con lo que ya trae de `gh` y
// del plan, e imprime/ejecuta lo que le devuelven — ninguna decisión de
// negocio vive en el wrapper.
import {
  extractAc, extractDepsInSection, extractStrayDeps, extractSectionContent, locateSection, locateLine,
  extractSpecLink, specLinkAnchor, countHeadingLines, detectLineEnding, normalizeToLF,
  AC_HEADING_FORMS, SPEC_LINK_PREFIXES,
} from './gh-issue-map.js'
// F6: el CONTENIDO de "## Dependencias"/"## Acceptance criteria" lo renderiza
// groom.js — la misma función que usa buildIssueBody al CREAR el issue. Hasta
// F6 este fichero tenía su propia copia del formato: dos implementaciones del
// mismo criterio que divergían en cuanto una cambiara (y F6 lo cambió: el
// orden de slice pasa a ir entre backticks para que GitHub no lo autoenlace
// como número de issue — un --reconcile con la copia vieja habría reescrito
// el formato nuevo de vuelta al viejo, reintroduciendo el enlace falso en
// cada corrida).
import { renderDepsContent, renderAcContent } from './groom.js'

// ownedLabelsOnly: el spec solo es autoridad sobre un prefijo (`type:`,
// `area:`, `touches:`) SI la tabla §9 trae la columna que lo alimenta
// (Tipo/Área/Toca respectivamente) — `ownedPrefixes` es ese subconjunto,
// decidido por el caller (ct-groom.mjs, a partir de qué columnas trae la
// tabla) y NO tiene un default aquí a propósito: adivinar "todas por
// defecto" reintroduciría en silencio el falso positivo que esto corrige:
// sin columna "Área", el spec no tiene ninguna opinión sobre `area:` y no
// debe reclamar autoridad sobre un label que un humano puso a mano por su
// cuenta — reportarlo como "sobra" sería ruido que enseña a ignorar el
// resto del reporte.
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
// propia sección reconocida — mismo dominio en detección (aquí) y en
// aplicación (`buildReconcileBody`, que solo puede splicear esa sección con
// seguridad). Hasta el hardening del dispatch (D1), esto era una diferencia
// DELIBERADA respecto al dispatcher real (gh-issue-map.js#mapGhIssue llamaba
// a extractDeps sobre el body ENTERO) — D1 finding 2 unificó ambos dominios:
// mapGhIssue ahora usa exactamente `extractDepsInSection`, la misma función
// que este archivo. `depsInSection` queda como un wrapper delgado (solo
// para no tocar las llamadas de más abajo) sobre esa única fuente de
// verdad — ya no hay dos implementaciones del mismo criterio que puedan
// divergir. `extractAc` ya es, de por sí, section-scoped contra el conjunto
// cerrado AC_HEADING_FORMS (ver gh-issue-map.js, Importante 4) — se
// reexporta aquí sin más para que diffIssue no tenga que decidir dos
// criterios distintos.
function depsInSection(body) {
  return extractDepsInSection(body).deps
}
function acInSection(body) {
  return extractAc(body)
}

// DUPLICATE_CHECKS: qué cabeceras se comprueban por duplicado (`headings`:
// un string, o AC_HEADING_FORMS — el conjunto cerrado de dos formas
// aceptables, igual que locateSection), y si un duplicado es "machine"
// (cuenta para el exit code — review round 4, importante 5) o solo
// cosmético (Descripción/Protegido: una nota, nunca cuenta).
//
// La justificación de por qué Dependencias/AC SÍ cuentan es AHORA LA MISMA
// para las dos (antes de D1 no lo era — ver el historial más abajo, la
// ronda 4 la había escrito como si lo fuera y la ronda 5 lo corrigió):
// gh-issue-map.js#extractSectionContent/locateSection SIEMPRE devuelve la
// PRIMERA aparición de una cabecera — tanto Dependencias como AC. Ninguna
// de las dos "une" dos copias. Eso no las hace inocuas: si un humano edita
// la copia EQUIVOCADA (la segunda, tras un merge conflictivo mal resuelto o
// un copiar-pegar), esa edición queda invisible tanto para el dispatcher
// como para --reconcile sin que nada lo avise — silenciosamente se sigue
// usando la PRIMERA copia, que puede ser la vieja. Por eso ambas siguen
// contando para el exit code.
//
// Historial (antes de D1, hardening del dispatch): gh-issue-map.js#extractDeps,
// la que usaba el DISPATCHER real (mapGhIssue), escaneaba el body ENTERO con
// una regex global, sin ninguna noción de sección — dos "## Dependencias"
// con `merge-after` distintos se UNÍAN de verdad (el dispatcher obedecía la
// suma de ambas copias, no "la primera"), a diferencia de AC. D1 finding 2
// unificó el dominio del dispatcher con el de --reconcile (ambos
// section-scoped, ambos "primera copia") — la asimetría de justificación
// desapareció con ella.
const DUPLICATE_CHECKS = [
  { headings: '## Descripción', label: 'Descripción', machine: false },
  { headings: AC_HEADING_FORMS, label: 'Acceptance criteria', machine: true },
  { headings: '## Dependencias', label: 'Dependencias', machine: true },
  { headings: '## Out of scope / Protected', label: 'Out of scope / Protected', machine: false },
]

// diffIssue: compara un issue EXISTENTE de verdad (la forma cruda de `gh api
// repos/<o>/<r>/issues`: number, title, state, milestone, labels, body)
// contra lo que el plan (groom.js#groomPlan) dice que ESE slice debería
// tener hoy (wantedIssue: título, milestone, labels, deps, ac, descripcion,
// protectedLine, specLink, specSection — todos campos que groomPlan ya
// expone, no solo el body ya renderizado).
//
// El marcador `<!-- ct-order:N -->` es lo ÚNICO del body que queda
// completamente fuera del diff: es bookkeeping nuestro. El enlace al spec
// SÍ es contenido del spec, pero se compara SOLO por su ancla `#sección`
// (specLinkAnchor) — NUNCA por la ruta completa (review round 4, importante
// 4): `ct-groom.mjs` renderiza la ruta tal cual la escriba quien invoque el
// comando (`process.argv[2]`), y dos costumbres de invocación (relativa
// frente a absoluta, un slash command frente a un cron) para el MISMO
// fichero producirían, comparando la línea entera, una divergencia
// perpetua — cada corrida "reconciliando" contra la costumbre de la
// invocación anterior, para siempre. Comparar solo el ancla es inmune a
// eso, a cambio de un límite conocido: si el spec se MUEVE a otro fichero
// sin cambiar de número de sección, F5 ya no lo detecta.
//
// Descripción/Protegido SÍ se comparan (el spec los posee: derivan de
// Entrega/Protegido en la tabla §9), pero solo con un flag booleano
// (descripcionDiffers/protectedDiffers) — nunca se muestra el texto
// completo, y (ver hasDrift más abajo) NUNCA cuentan para el código de
// salida: son prosa que un humano edita de forma rutinaria y legítima tras
// crear el issue.
//
// `duplicateSections`/`duplicateMachineSections`: cabeceras conocidas que
// aparecen más de una vez — las de AC/Dependencias SÍ cuentan para el
// exit code (cambian lo que el dispatcher hace; ver DUPLICATE_CHECKS),
// Descripción/Protegido no.
//
// `strayDeps`: referencias `merge-after #N` que viven FUERA de la sección
// "## Dependencias" reconocida. Antes de D1 (hardening del dispatch), el
// DISPATCHER real SÍ las veía (escaneaba el body entero) mientras --reconcile
// nunca podía tocarlas (fuera de la sección que puede splicear con
// seguridad) — el reporte de abajo existía para que ESA asimetría, al menos,
// no quedara invisible. D1 finding 2 unificó el dominio: mapGhIssue ahora
// también ignora todo lo que viva fuera de la sección — un `strayDep` ya no
// lo obedece NADIE (ni el dispatcher ni --reconcile). El campo se conserva
// porque sigue siendo información real y accionable: un humano que escribió
// un "merge-after" ahí pensando que contaba merece que se lo digan, aunque
// ahora la razón sea "esto es texto muerto" y no "el dispatcher lo aplica
// pero yo no puedo".
//
// labels acepta tanto la forma cruda de la REST API (`[{name: 'x'}, ...]`)
// como un array de strings ya planos.
export function diffIssue(existing, wantedIssue, wantedMilestone, ownedLabelPrefixes) {
  const body = normalizeToLF(existing.body)
  const currentLabelNames = (existing.labels || []).map((l) => (typeof l === 'string' ? l : l.name))
  const labels = diffLabels(currentLabelNames, wantedIssue.labels, ownedLabelPrefixes)
  const currentMilestoneTitle = existing.milestone ? existing.milestone.title : null
  const titleDiffers = existing.title !== wantedIssue.title
  const milestoneDiffers = currentMilestoneTitle !== wantedMilestone

  const currentSpecLink = extractSpecLink(body)
  const specLinkDiffers = specLinkAnchor(currentSpecLink) !== specLinkAnchor(wantedIssue.specLink)

  const currentDeps = depsInSection(body)
  const deps = diffDeps(currentDeps, wantedIssue.deps)
  const ac = diffAc(acInSection(body), wantedIssue.ac)

  // Descripción: `null` en cualquiera de los dos lados significa "no debería
  // existir ninguna sección" — null en AMBOS lados es acuerdo (silencio
  // real), no divergencia. Solo se compara el texto (trim) cuando los dos
  // lados sí tienen sección.
  const currentDescripcion = extractSectionContent(body, '## Descripción') // string o null (sin sección)
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
  const currentProtected = extractSectionContent(body, '## Out of scope / Protected')
  const protectedDiffers = currentProtected === null || currentProtected.trim() !== (wantedIssue.protectedLine || '').trim()

  const duplicates = DUPLICATE_CHECKS.filter((c) => countHeadingLines(body, c.headings) > 1)
  const duplicateSections = duplicates.map((c) => c.label)
  const duplicateMachineSections = duplicates.filter((c) => c.machine).map((c) => c.label)

  // strayDeps: deps que viven en el body pero fuera de la sección reconocida
  // — desde D1, texto inerte para todo el mundo (ni el dispatcher ni
  // --reconcile lo obedecen); se reporta igual, sin importar si también
  // coinciden o no con lo que el spec pide (eso ya lo cubre `deps` arriba).
  // `extractStrayDeps` (gh-issue-map.js) es la MISMA función que
  // mapGhIssue usa para exponer esto en la ruta del dispatcher (D1, review:
  // "expón las deps fuera de sección desde mapGhIssue" — ya tienes la
  // forma hecha aquí, es la misma) — una sola implementación, no dos que
  // puedan divergir.
  const strayDeps = extractStrayDeps(body, currentDeps)

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
    duplicateMachineSections,
    strayDeps,
  }
}

// hasDrift: cuenta título/milestone/enlace-al-spec (por ancla)/labels/deps/
// ac, y las secciones DUPLICADAS que cambian lo que el dispatcher hace
// (AC/Dependencias — review round 4, importante 5). `closed`, Descripción/
// Protegido (duplicados o divergentes) y `strayDeps` NUNCA cuentan: son, o
// bien algo sobre lo que el spec no tiene autoridad (closed), o bien prosa
// rutinaria, o bien algo que --reconcile NUNCA podría aplicar de forma
// segura (strayDeps vive fuera de la sección que --reconcile puede tocar)
// — anclar el exit code a cualquiera de ellos entrenaría a ignorar el
// resto del reporte.
export function hasDrift(diff) {
  return Boolean(
    diff.title || diff.milestone || diff.specLink ||
    diff.labels.missing.length || diff.labels.extra.length ||
    diff.deps.missing.length || diff.deps.extra.length ||
    diff.ac.missing.length || diff.ac.extra.length ||
    diff.duplicateMachineSections.length,
  )
}

// reconcileGaps / hasReconcileGap: --reconcile puede REPORTAR una
// divergencia sin poder APLICARLA. Dos formas distintas de esto:
//   - ac/deps: la cabecera de la sección puede no existir (un humano la
//     renombró o la borró), y sin ella `buildReconcileBody` no tiene dónde
//     escribir el arreglo (ni inventa una posición para deps cuando
//     tampoco hay un ancla segura — review round 4, Critical 3).
//     `bodyResult` es el resultado de `buildReconcileBody` (más abajo, trae
//     `unresolvedAc`/`unresolvedDeps`) — un gap real es "el diff dice que
//     diverge Y buildReconcileBody no pudo tocarlo".
//   - duplicates (review round 5, Importante 3): una sección "machine"
//     duplicada (diff.duplicateMachineSections) CUENTA para hasDrift, pero
//     --reconcile no tiene ningún código que decida cuál copia es la
//     correcta y fusione o borre la sobrante — no es un gap de "no sé dónde
//     escribir" como ac/deps, es un gap de "no hay escritura segura
//     posible en absoluto". Sin este campo, `ct-groom.mjs` (que bajo
//     --reconcile usa SOLO `hasReconcileGap` para decidir su exit code, ver
//     el comentario junto al `process.exit` final de ese fichero) veía
//     `anyReconcileGapRemains` en `false` cuando el ÚNICO drift era un
//     duplicado (ac/deps seguían de acuerdo en contenido) — cero llamadas a
//     `gh`, nada cambia, la línea de divergencia se imprime, y el proceso
//     salía 0: rompía además la paridad documentada con `--dry-run
//     --reconcile` sobre el MISMO body, que sí salía 3 (esa rama usa
//     `anyUnresolvedDrift`, no `anyReconcileGapRemains`).
//
// title/milestone/labels/specLink nunca tienen gap: siempre se resuelven
// vía flags o un splice de una sola línea, sin depender de localizar una
// sección con cabecera.
export function reconcileGaps(diff, bodyResult) {
  return {
    ac: Boolean((diff.ac.missing.length || diff.ac.extra.length) && bodyResult.unresolvedAc),
    deps: Boolean((diff.deps.missing.length || diff.deps.extra.length) && bodyResult.unresolvedDeps),
    duplicates: Boolean((diff.duplicateMachineSections || []).length),
  }
}
export function hasReconcileGap(gaps) {
  return Boolean(gaps.ac || gaps.deps || gaps.duplicates)
}

// formatDrift: una línea humana por campo. Título/milestone/enlace-al-spec/
// labels/deps/ac y los duplicados "machine" (AC/Dependencias) son
// "divergencia:" — cuentan para el exit code (hasDrift) y muestran el valor
// actual y el que pide el spec cuando aplica. Descripción/Protegido (y sus
// duplicados) y `strayDeps` son "nota:" — SIEMPRE se reportan si aplican
// (silencio total sobre esto sería tan malo como no reportar nada), pero
// NUNCA cuentan para el exit code. El cierre del issue se anota al final, y
// solo si ya hay alguna otra línea que reportar.
export function formatDrift(diff) {
  const lines = []
  const head = `slice #${diff.order} (issue #${diff.issueNumber})`
  if (diff.title) lines.push(`divergencia: ${head}: título difiere — issue: "${diff.title.current}", spec: "${diff.title.wanted}"`)
  if (diff.milestone) lines.push(`divergencia: ${head}: milestone difiere — issue: "${diff.milestone.current ?? '(ninguno)'}", spec: "${diff.milestone.wanted}"`)
  if (diff.specLink) lines.push(`divergencia: ${head}: el enlace al spec difiere — issue: "${diff.specLink.current ?? '(ausente)'}", spec: "${diff.specLink.wanted}"`)
  for (const l of diff.labels.missing) lines.push(`divergencia: ${head}: falta la label "${l}" (la pide el spec, el issue no la tiene)`)
  for (const l of diff.labels.extra) lines.push(`divergencia: ${head}: sobra la label "${l}" (la tiene el issue, el spec ya no la produce)`)
  // F6: el número que se nombra aquí es el ORDEN del slice en la tabla §9,
  // nunca un número de issue — decirlo en el propio mensaje evita que quien
  // lee el reporte salga a buscar "el issue #3" que no tiene nada que ver.
  for (const d of diff.deps.missing) lines.push(`divergencia: ${head}: falta la dependencia "merge-after \`#${d}\`" (orden de slice de la tabla §9, no un número de issue; la pide el spec, el issue no la tiene)`)
  for (const d of diff.deps.extra) lines.push(`divergencia: ${head}: sobra la dependencia "merge-after \`#${d}\`" (orden de slice de la tabla §9, no un número de issue; la tiene el issue, el spec ya no la produce)`)
  for (const a of diff.ac.missing) lines.push(`divergencia: ${head}: falta el criterio de aceptación "${a}" (lo pide el spec, el issue no lo tiene)`)
  for (const a of diff.ac.extra) lines.push(`divergencia: ${head}: sobra el criterio de aceptación "${a}" (lo tiene el issue, el spec ya no lo produce)`)
  for (const section of diff.duplicateMachineSections || []) {
    // Menor (review round 5): "el dispatcher no distingue la primera" era
    // preciso para Dependencias (une ambas copias, escaneo de todo el
    // body) pero FALSO para Acceptance criteria (el dispatcher SÍ usa solo
    // la primera — el riesgo ahí es que esa primera copia ya no sea la que
    // un humano quiso, no que el dispatcher las mezcle). El mensaje ya no
    // afirma un mecanismo único para las dos: nombra el riesgo real,
    // suficiente para que revisar a mano tenga sentido sin necesitar saber
    // cuál mecanismo aplica.
    lines.push(`divergencia: ${head}: la sección "## ${section}" aparece más de una vez en el body — el dispatcher no reconstruye la intención de un humano a partir de "la primera" ni de "la unión": revisa y une o elimina la copia sobrante a mano`)
  }
  if (diff.descripcionDiffers) lines.push(`nota: ${head}: la sección "## Descripción" difiere del spec (prosa — no cuenta para el exit code; --reconcile no la reescribe)`)
  if (diff.protectedDiffers) lines.push(`nota: ${head}: la sección "## Out of scope / Protected" difiere del spec (prosa — no cuenta para el exit code; --reconcile no la reescribe)`)
  for (const section of diff.duplicateSections || []) {
    if ((diff.duplicateMachineSections || []).includes(section)) continue // ya reportada arriba como divergencia:
    lines.push(`nota: ${head}: la sección "## ${section}" aparece más de una vez en el body — solo la primera se compara/reconcilia; revisa la(s) copia(s) sobrante(s) a mano`)
  }
  for (const d of diff.strayDeps || []) {
    lines.push(`nota: ${head}: "merge-after #${d}" aparece fuera de la sección "## Dependencias" — desde el hardening del dispatch (D1), ya NO lo obedece nadie (ni el dispatcher real ni --reconcile); si se pretendía como dependencia real, muévelo dentro de la sección`)
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

// buildReconcileBody: --reconcile SÍ reescribe el enlace al spec y
// AC/Dependencias (a diferencia de Descripción/Protegido, ver diffIssue)
// porque son campos deterministas o estructurados que el dispatcher (o la
// trazabilidad del spec) obedecen/necesitan de verdad. Reemplaza SOLO el
// rango de cada sección/línea conocida dentro del body EXISTENTE
// (locateSection/locateLine, scripts/gh-issue-map.js) — nunca reconstruye
// el body entero — así cualquier contenido humano antes/después de esas
// secciones se preserva intacto.
//
// Todo el procesamiento interno trabaja sobre el body normalizado a LF
// (`normalizeToLF`) — si el original usaba CRLF, el resultado se
// reconvierte a CRLF antes de devolverlo (`detectLineEnding`), para no
// dejar un body con finales de línea mezclados (review round 4, menor).
//
// Devuelve `{ body, unresolvedAc, unresolvedDeps }`: `body` es el body
// spliceado (en el mismo final de línea que el original), o `null` si nada
// necesitaba cambiar. `unresolvedAc`/`unresolvedDeps` son ciertos cuando el
// diff SÍ pedía un cambio pero no se pudo aplicar sin adivinar una
// posición:
//   - AC: su cabecera SIEMPRE debería existir en un body bien formado; si
//     un humano la renombra o la borra, no hay dónde escribir el reemplazo.
//   - Dependencias (review round 4, Critical 3): si la sección no existe Y
//     TAMPOCO existe "## Out of scope / Protected" (el ancla segura para
//     insertarla), la versión anterior insertaba una sección nueva a
//     ciegas al final del body EN CADA CORRIDA — verificado que, con una
//     valla sin cerrar delante (que hace inhallable cualquier cabecera
//     posterior), esto crecía sin límite: 2, 3, 4 secciones en pasadas
//     sucesivas, y el dispatcher (que sí ve las tres) acumulaba
//     "merge-after #N" repetido. Ahora, sin un ancla segura, se RIÈNDE
//     igual que AC: no inserta nada, marca `unresolvedDeps`, dejando que
//     la maquinaria de gaps lo reporte y cuente para el exit code.
//
// "¿Necesita cambiar?" se decide con diffSet/depsInSection/acInSection (el
// MISMO criterio, y el MISMO dominio — section-scoped — que usa diffIssue)
// — nunca una comparación de texto crudo ni un escaneo de todo el body: si
// el issue tiene "AC-1.1, AC-1.2" y el spec pide el mismo conjunto en otro
// orden, diffIssue ya dice "sin divergencia", así que reescribir aquí solo
// por una diferencia de orden contradiría esa misma decisión. El enlace al
// spec se compara por su ANCLA (specLinkAnchor), no por el texto completo
// — mismo criterio que diffIssue (review round 4, importante 4): una
// diferencia de notación de ruta nunca dispara una reescritura.
export function buildReconcileBody(existingBody, wantedIssue) {
  const eol = detectLineEnding(existingBody)
  let body = normalizeToLF(existingBody)
  let changed = false
  let unresolvedAc = false
  let unresolvedDeps = false

  const specLinkLoc = locateLine(body, SPEC_LINK_PREFIXES)
  const currentSpecLink = specLinkLoc ? specLinkLoc.line : null
  if (specLinkAnchor(currentSpecLink) !== specLinkAnchor(wantedIssue.specLink)) {
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
    const acLoc = locateSection(body, AC_HEADING_FORMS)
    if (acLoc) {
      body = body.slice(0, acLoc.headingEnd) + renderAcContent(wantedIssue.ac) + '\n' + body.slice(acLoc.contentEnd)
      changed = true
    } else {
      // Cabecera "## Acceptance criteria" ausente por completo: no hay
      // dónde escribir el reemplazo sin adivinar una posición — se rinde
      // limpiamente en vez de inventar una, y lo informa (unresolvedAc)
      // para que el caller nunca reporte esto como "aplicado".
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
      // (cabecera incluida) justo antes de "## Out of scope / Protected" —
      // SOLO si esa cabecera se puede localizar (es el único ancla segura
      // de dónde insertar). Sin ella, no se inventa una posición (Critical
      // 3, review round 4): se rinde, marca `unresolvedDeps`, y no toca el
      // body — la alternativa (insertar al final a ciegas) creaba una
      // sección nueva EN CADA CORRIDA sin límite cuando el body tenía una
      // valla sin cerrar por delante.
      const protectedLoc = locateSection(body, '## Out of scope / Protected')
      if (protectedLoc) {
        const insertion = `## Dependencias\n${wantedDepsContent}\n\n`
        body = body.slice(0, protectedLoc.headingStart) + insertion + body.slice(protectedLoc.headingStart)
        changed = true
      } else {
        unresolvedDeps = true
      }
    } else if (!wantDeps && depsLoc) {
      // El spec ya no declara deps para este slice, pero el issue conserva
      // la sección — se retira ENTERA (cabecera incluida), no solo su
      // contenido.
      //
      // Menor (review round 5): `body.slice(0, depsLoc.headingStart)`
      // conserva la línea en blanco que ya separaba a la sección ANTERIOR
      // de "## Dependencias" (buildIssueBody siempre deja una entre
      // secciones), y `body.slice(depsLoc.contentEnd)` empieza con el '\n'
      // que separaba a Dependencias de la sección SIGUIENTE — concatenar
      // ambos tal cual deja DOS líneas en blanco seguidas en el punto de la
      // costura. Se recorta un '\n' sobrante del final del primer trozo
      // (si no hay ninguno, p.ej. porque Dependencias era la primera
      // sección del body, no hay nada que recortar y el `replace` es un
      // no-op) para dejar exactamente una.
      const before = body.slice(0, depsLoc.headingStart).replace(/\n$/, '')
      body = before + body.slice(depsLoc.contentEnd)
      changed = true
    }
  }

  if (!changed) return { body: null, unresolvedAc, unresolvedDeps }
  const finalBody = eol === '\r\n' ? body.replace(/\n/g, '\r\n') : body
  return { body: finalBody, unresolvedAc, unresolvedDeps }
}
