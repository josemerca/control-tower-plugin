// Lógica pura de grooming: de Slice[] (T1) a un plan de operaciones GitHub.
import { isNoValueCell } from './slices.js'

// F3: el título viene de `slice.name` (columna "Slice" del spec §9), no de
// `slice.entrega` (columna "Entrega") — antes componía "#N <Entrega>"
// mientras el texto de "Slice" se descartaba salvo por un posible "#NN", así
// que un autor que escribe lo natural (nombre corto en Slice, descripción
// de qué entrega en Entrega) recibía un párrafo entero como título del
// issue. `slice.name` ya llega limpio de cualquier referencia "#NN" (ver
// slices.js#analyzeSlicesTable) — buildIssueTitle no necesita, y a
// propósito no repite, esa limpieza aquí.
export function buildIssueTitle(slice) {
  return `#${slice.n} ${slice.name}`.trim()
}

export function buildLabels(slice) {
  const labels = []
  // Omit empty type to avoid emitting garbage literal "type:" to GitHub.
  // Review de F3, finding 1: un marcador de "sin valor" ("–", "-", "—",
  // etc. — el mismo criterio que ya usan Dep/Acepta/Área/Toca, y que
  // buildIssueBody ya aplica a Protegido) es TRUTHY en JS, así que
  // `if (slice.type)` a secas lo trataba como un tipo real y emitía la
  // label literal "type:–" — que `gh label create --force` crearía de
  // verdad en el repo del usuario. Mismo bug de "area:areamedicacion" por
  // otra puerta: un marcador que el propio contrato enseña a usar en todas
  // las demás columnas producía basura en esta. isNoValueCell unifica el
  // criterio: celda vacía y celda con marcador producen la MISMA salida
  // (ninguna label "type:").
  if (slice.type && !isNoValueCell(slice.type)) labels.push(`type:${slice.type}`)
  // area/touches (T14/W-A): alimentan directamente la maquinaria de colisión
  // de claim.js#tokensOf y la serialización de dispatch.js#SERIALIZING_TOUCHES,
  // que hasta ahora quedaba inerte porque /ct-groom nunca emitía estas
  // labels. Orden fijo (tipo → area → touches → status) para que el output
  // sea determinista: mismo slice, mismo array de labels, siempre — clave
  // para que los tests y los diffs de `gh label`/dry-run sean estables.
  // Cuando el slice no trae area/touches (spec vieja sin esas columnas, o
  // arrays vacíos) esto produce exactamente la salida de antes.
  for (const a of slice.area || []) labels.push(`area:${a}`)
  for (const t of slice.touches || []) labels.push(`touches:${t}`)
  labels.push('status:backlog')
  return labels
}

// renderDescripcion / renderProtectedLine (F5): extraídas de buildIssueBody
// para ser la ÚNICA fuente de verdad de "qué debería decir" cada una de
// estas dos secciones — tanto al CREAR el issue (buildIssueBody, más abajo)
// como al COMPARARLO después contra un issue ya existente
// (scripts/reconcile.js#diffIssue). Sin esto, "lo que se escribe" y "lo que
// se compara" serían dos implementaciones del mismo criterio de "sin
// valor" que podrían divergir con el tiempo — el mismo motivo por el que
// ADDENDA (kickoff.js) es la única fuente de verdad de KNOWN_TYPES en
// ct-groom.mjs.
//
// renderDescripcion devuelve `null` (no un string vacío) cuando no hay
// "Entrega" real: `null` significa "la sección ## Descripción no debería
// existir en absoluto", distinto de "existe pero está vacía" — un issue
// existente que SÍ tiene la sección cuando el spec dice `null` es una
// divergencia real (el spec dejó de pedir descripción), no lo mismo que
// "coinciden en que no hay nada".
export function renderDescripcion(slice) {
  return (slice.entrega && !isNoValueCell(slice.entrega)) ? slice.entrega : null
}

// renderProtectedLine: a diferencia de Descripción, esta sección SIEMPRE
// existe en el body (buildIssueBody la emite incondicionalmente) — por eso
// esta función nunca devuelve `null`, siempre una de las dos líneas
// posibles.
export function renderProtectedLine(slice) {
  // Fix de review (F2): antes solo trataba el em dash literal ('–', U+2013)
  // como "sin valor" — las otras variantes que isNoValueCell ya acepta en
  // TODAS las demás columnas (Dep/Acepta/Área/Toca: '-', '—', '―', '−',
  // '--') colaban como si fueran contenido real, produciendo un bullet
  // basura ("- 🚫 -") en el body de CADA issue con esa variante. Mismo
  // criterio de "sin valor" que las demás columnas, sin excepción.
  return (slice.protected && !isNoValueCell(slice.protected)) ? `- 🚫 ${slice.protected}` : '- (ninguno declarado)'
}

// renderSpecLink (F5 review round 3, importante 5): la línea de enlace al
// spec ES contenido que el spec posee de verdad — no es bookkeeping como el
// marcador `ct-order`. Extraída por el mismo motivo que renderDescripcion/
// renderProtectedLine: una sola fuente de verdad de "qué debería decir",
// compartida entre crear el issue (buildIssueBody) y compararlo después
// (scripts/reconcile.js#diffIssue).
//
// F6 (grave 1): el orden del slice va entre backticks (código inline) — un
// "#N" DESNUDO en el body de un issue lo autoenlaza GitHub al issue N de ese
// repo. Verificado contra GitHub de verdad, no deducido: el `body_html` real
// del issue #4 de josemerca/ct-loop-sandbox (`gh api ... -H "Accept:
// application/vnd.github.html+json"`) trae esta misma línea con el "#3" (que
// es el ORDEN del slice) convertido en `<a href=".../issues/3">` — el issue
// #3 de ese repo es, en realidad, el slice 2. Con código inline no se
// autoenlaza (comprobado en la misma corrida con la API /markdown: ``#2``
// sale como `<code>#2</code>`, mientras `#2` desnudo sale como `<a …>`).
//
// F10: la línea deja de componerse de `--section` + la ruta tal cual venía en
// argv (que producía "[docs/x.md#9](docs/x.md#9)": relativo, y por tanto 404
// desde la página de un issue, contra un ancla que además no existe). Ahora
// recibe `specRef` — el resultado de scripts/spec-link.js#resolveSpecRef —
// que ya trae, o una URL absoluta VERIFICADA contra GitHub, o `reason`: por
// qué no la hay. Esta función solo decide cómo se escriben esos dos casos,
// nunca inventa un enlace.
//
// specRef = { path, heading, url, reason }
//   path    ruta del spec relativa a la raíz del repo (o tal como llegó, si
//           no se pudo determinar el repo)
//   heading texto renderizado del encabezado de la §9 ("9. Slices"), o null
//   url     enlace absoluto verificado, o null
//   reason  motivo de que no haya url (cadena fija, ver SPEC_REF_REASONS)
export function renderSpecLink(slice, specRef) {
  const head = `> Slice \`#${slice.n}\` del epic. Spec: `
  const { path, heading, url, reason } = specRef || {}
  if (url) {
    // El texto del enlace SÍ puede llevar un "#N" del propio encabezado sin
    // riesgo: verificado contra GitHub que un "#3" (issue que existe de
    // verdad en ese repo) DENTRO del texto de un enlace no se autoenlaza,
    // mientras que el mismo "#3" en texto plano sí. Lo que sí hay que
    // escapar son los corchetes, que cortarían el enlace en seco.
    return `${head}[${escapeLinkText(labelOf(path, heading))}](${url})`
  }
  // Sin enlace: referencia honesta, sin `[...]( ... )` de ningún tipo. Ruta y
  // encabezado van en código inline porque AQUÍ sí son texto plano y un
  // "#N" del encabezado se autoenlazaría al issue N del repo.
  const headingPart = heading ? ` § ${inlineCode(heading)}` : ''
  return `${head}${inlineCode(path)}${headingPart} — sin enlace: ${reason}`
}

function labelOf(path, heading) {
  return heading ? `${path} § ${heading}` : String(path)
}

// escapeLinkText: `\` primero (si no, se escaparían los escapes recién
// puestos), luego los corchetes. Verificado contra GitHub: "[a \[b\] c](url)"
// sale como un único enlace con texto "a [b] c".
function escapeLinkText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/([[\]])/g, '\\$1')
}

// inlineCode: envuelve en la valla de backticks MÁS CORTA que el contenido no
// pueda cerrar — misma regla que CommonMark y que el escáner de vallas de
// gh-issue-map.js. Un encabezado con backticks dentro ("## Slices `parseo`")
// llega aquí ya sin ellos (anchor.js#inlineText resuelve el code span), pero
// una RUTA con un backtick es posible en un sistema de ficheros de verdad, y
// una valla de un solo backtick la rompería dejando el "#N" del propio texto
// fuera de todo código inline — o sea, autoenlazado.
function inlineCode(text) {
  const s = String(text)
  let longest = 0
  for (const run of s.match(/`+/g) || []) longest = Math.max(longest, run.length)
  const fence = '`'.repeat(longest + 1)
  const pad = (s.startsWith('`') || s.endsWith('`')) ? ' ' : ''
  return `${fence}${pad}${s}${pad}${fence}`
}

// DEPS_ORDER_NOTE / renderDepsContent / renderAcContent (F6): el CONTENIDO de
// las dos secciones que el dispatcher obedece de verdad. Igual que
// renderDescripcion/renderProtectedLine/renderSpecLink, son la ÚNICA fuente
// de verdad de "qué debería decir" cada sección — hasta F6, scripts/
// reconcile.js#buildReconcileBody tenía su PROPIA copia del formato
// (`renderAcContent`/`renderDepsContent` allí), así que un cambio de formato
// aquí dejaba al reconciliador escribiendo el formato viejo encima de un
// issue nuevo. Ahora reconcile.js importa estas dos.
//
// DEPS_ORDER_NOTE: la mitad "legible y verdadera para un humano" del arreglo
// del autoenlace. Los backticks impiden el enlace falso, pero por sí solos no
// explican qué es ese número — un humano que abre el issue sigue sin poder
// distinguir "orden de slice" de "número de issue". La nota lo dice, y dice
// también quién lo traduce. NO puede contener ningún "#<dígitos>": sería otro
// autoenlace falso, y además `gh-issue-map.js#extractDepsInSection` lo leería
// como una referencia no capturada por `merge-after` y marcaría la sección
// como `malformed` (fail-closed, el slice dejaría de despacharse).
export const DEPS_ORDER_NOTE = '*(cada `#N` de esta sección es el ORDEN del slice en la tabla §9 del spec, NO un número de issue de GitHub — `/ct-next` lo traduce por el marcador `ct-order` de cada issue)*'
export function renderDepsContent(deps) {
  return [DEPS_ORDER_NOTE, ...(deps || []).map((d) => `- merge-after \`#${d}\``)].join('\n')
}
export function renderAcContent(ac) {
  return (ac && ac.length) ? ac.map((a) => `- ${a}`).join('\n') : '- (rellenar desde el spec)'
}

export function buildIssueBody(slice, specRef) {
  const lines = []
  lines.push(renderSpecLink(slice, specRef))
  lines.push('')
  // F3: "Entrega" ya no alimenta el título (ver buildIssueTitle) — pasa a
  // ser una descripción OPCIONAL del cuerpo. Va aquí, justo debajo del link
  // al spec y ANTES de "Acceptance criteria": quien abre el issue lee
  // primero QUÉ entrega el slice, y solo después sus criterios de
  // aceptación — el orden de lectura natural (qué, luego cómo se verifica).
  const descripcion = renderDescripcion(slice)
  if (descripcion) {
    lines.push('## Descripción')
    lines.push(descripcion)
    lines.push('')
  }
  lines.push('## Acceptance criteria (EARS, 1:1 con tests)')
  lines.push(renderAcContent(slice.ac))
  lines.push('')
  const deps = slice.deps || []
  if (deps.length) {
    lines.push('## Dependencias')
    lines.push(renderDepsContent(deps))
    lines.push('')
  }
  lines.push('## Out of scope / Protected')
  lines.push(renderProtectedLine(slice))
  lines.push('')
  lines.push(`<!-- ct-order:${slice.n} -->`) // marcador greppable de orden para el dispatcher
  return lines.join('\n')
}

// findDuplicateOrders: los números de slice (`#` de la tabla §9) son la
// única llave que buildOrderIndex (scripts/gh-issue-map.js) usa para mapear
// "orden -> número de issue de GitHub", y esa función se queda con el ÚLTIMO
// issue visto para un orden repetido — así que un duplicado en la fuente
// (dos filas con el mismo `#`) hace que un `merge-after #N` resuelva contra
// el issue equivocado, y en ct-groom.mjs el placeholder en memoria de un
// issue recién creado (aún sin `number` real) provoca que el segundo slice
// con el mismo orden intente operar contra un issue `null`. Se corta en el
// productor (aquí) en vez de dejar que el consumidor adivine.
function findDuplicateOrders(slices) {
  const seen = new Set()
  const dupes = new Set()
  for (const s of slices || []) {
    if (seen.has(s.n)) dupes.add(s.n)
    seen.add(s.n)
  }
  return [...dupes].sort((a, b) => a - b)
}

export function groomPlan(slices, { milestone, specRef }) {
  const dupes = findDuplicateOrders(slices)
  if (dupes.length) {
    throw new Error(`groomPlan: orden(es) de slice duplicado(s) en la tabla §9: ${dupes.join(', ')}`)
  }
  return {
    milestone,
    issues: slices.map((s) => ({
      order: s.n,
      title: buildIssueTitle(s),
      body: buildIssueBody(s, specRef),
      labels: buildLabels(s),
      deps: s.deps,
      // F5: además del body ya renderizado (arriba), el plan lleva los
      // valores ESTRUCTURADOS que lo alimentan — scripts/reconcile.js los
      // necesita para comparar contra un issue existente sin tener que
      // volver a parsear el body que él mismo acaba de generar (evita dos
      // implementaciones del mismo criterio que puedan divergir).
      ac: s.ac || [],
      descripcion: renderDescripcion(s),
      protectedLine: renderProtectedLine(s),
      specLink: renderSpecLink(s, specRef),
    })),
  }
}
