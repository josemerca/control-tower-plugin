// Lógica pura de grooming: de Slice[] (T1) a un plan de operaciones GitHub.
import { isNoValueCell } from './slices.js'
import { resolveGates, gateLabels, renderGatesIssueContent } from './gates.js'
import { locateSection } from './gh-issue-map.js'

// GATES_HEADING (F21): la sección de gates del cuerpo del issue. Constante
// exportada porque la nombran TRES sitios (este fichero al escribirla,
// reconcile.js al compararla, y sus tests) y una cabecera escrita a mano en
// tres sitios es una cabecera que acaba divergiendo en uno.
export const GATES_HEADING = '## Gates'

// Las DOS secciones de contexto del cuerpo de un issue, con dueños distintos
// y por eso con reglas distintas:
//
//   EPIC_CONTEXT_HEADING      la escribe /ct-groom desde el spec, idéntica en
//                             todos los issues del epic.
//   INHERITED_CONTEXT_HEADING la escribe la sesión coordinadora. El plugin la
//                             emite vacía al crear el issue y no vuelve a
//                             tocarla nunca: ni la compara, ni la reescribe,
//                             ni la inserta, ni la borra.
//
// Son constantes exportadas por el mismo motivo que GATES_HEADING: las nombran
// el que las escribe, el que las compara y sus tests, y una cabecera tecleada
// en tres sitios acaba divergiendo en uno. La primera es además la MISMA
// cadena en el fichero de spec y en el cuerpo del issue: una sola que aprender.
export const EPIC_CONTEXT_HEADING = '## Contexto del epic'
export const INHERITED_CONTEXT_HEADING = '## Contexto heredado'

// El placeholder afirma dos cosas que un humano necesita leer ahí mismo: quién
// rellena la sección, y que lo que escriba no se lo va a pisar nadie. Una
// sección vacía sin esa segunda frase invita a no usarla.
export const INHERITED_CONTEXT_PLACEHOLDER =
  '_(vacía — la rellena la sesión coordinadora cuando algo ya mergeado condiciona a este slice. `/ct-groom` no escribe aquí ni reescribe lo que escribas.)_'

// truncationLine: la línea que truncó la sección, si resulta que locateSection
// cortó antes de una cabecera H1/H2 o del final del fichero. `locateSection`
// termina la sección cuando encuentra una cabecera de CUALQUIER nivel. Eso es
// legítimo si es H1 o H2 (solo terminan la sección normalmente), pero si es
// H3+ (subcabecera del epic), un comentario HTML autocontenido u otra cosa,
// hay un truncamiento que pierde contenido. Esta función devuelve esa línea
// ofensora, o null si no la hay.
//
// El regex de cabeceras H1/H2 aquí debe ser coherente con ATX_HEADING_RE en
// gh-issue-map.js — ambos gobiernan qué `locateSection` ve como cabecera. Si
// divergen, emitiremos falsos avisos de truncamiento sobre secciones sanas.
//
// `contentEnd` apunta al '\n' que precede a la línea terminadora (o al final
// del texto si no hay ninguna), así que la primera línea no vacía a partir de
// ahí es esa línea terminadora.
function truncationLine(specMd, loc) {
  const rest = (specMd || '').slice(loc.contentEnd)
  const line = rest.split('\n').find((l) => l.trim() !== '')
  if (!line) return null // Final del fichero, no hay truncamiento

  // Cabecera H1 o H2: termina la sección normalmente. El regex es coherente
  // con ATX_HEADING_RE en gh-issue-map.js: acepta # o ## seguidos de espacio,
  // tabulador, o fin de línea. Una cabecera desnuda (p.ej. "##" sin texto)
  // también es válida y termina la sección sin truncamiento.
  if (/^ {0,3}#{1,2}([ \t]|$)/.test(line)) return null

  // Cualquier otra cosa: es un truncamiento
  return line.trim()
}

// readEpicContext: lee del fichero de spec el texto que va a viajar, idéntico,
// al cuerpo de cada issue del epic.
//
// La sección se localiza POR EL TEXTO DE SU CABECERA, nunca por un número de
// sección — mismo criterio con el que analyzeSlicesTable localiza la tabla de
// slices por sus columnas: los números de sección de un spec se mueven en
// cuanto alguien inserta algo por delante.
//
// Devuelve `content: null` en los tres casos en que no hay nada que emitir
// (ausente, vacía, o con un truncamiento dentro), cada uno con su propio
// aviso: los tres se arreglan de forma distinta y un mensaje único obligaría a
// adivinar cuál pasó. Un spec sin esta sección es un spec VÁLIDO — de ahí que
// esto avise y nunca lance.
export function readEpicContext(specMd) {
  const warnings = []
  const loc = locateSection(specMd || '', EPIC_CONTEXT_HEADING)
  if (!loc) {
    warnings.push(`aviso: el spec no trae la sección "${EPIC_CONTEXT_HEADING}" — los issues de este epic se crearán sin contexto común. Si lo quieres, añade esa sección al spec, fuera de la tabla de slices, y vuelve a correr.`)
    return { content: null, warnings }
  }
  const truncating = truncationLine(specMd, loc)
  if (truncating) {
    warnings.push(`aviso: la sección "${EPIC_CONTEXT_HEADING}" del spec contiene ("${truncating}") y por eso NO se emite en ningún issue. La sección se reescribe entera desde el spec: el reemplazo termina en la primera cosa que corta la sección (cabecera de cualquier nivel, comentario HTML, etc.), así que nada que corte puede vivir dentro.`)
    return { content: null, warnings }
  }
  const content = loc.content.trim()
  if (!content) {
    warnings.push(`aviso: la sección "${EPIC_CONTEXT_HEADING}" del spec está presente pero sin contenido — se trata igual que si no estuviera. Escribe algo debajo de la cabecera, o quítala.`)
    return { content: null, warnings }
  }
  return { content, warnings }
}

// gatesOf: la resolución de gates de un slice, en un solo sitio. La llaman
// buildLabels y buildIssueBody por separado (es pura y barata) en vez de
// pasarse el resultado, para que ninguna de las dos pueda quedarse con una
// resolución vieja si mañana cambia la forma del slice.
export function gatesOf(slice) {
  return resolveGates(slice.type, slice.gate)
}

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
  // gate: (F21) — el canal por el que el gate humano SOBREVIVE al despacho.
  // Hasta esta ronda, el único gate del plugin vivía dentro del addendum de
  // `ui`, es decir dentro de un KICKOFF: un prompt que se pierde con el
  // contexto de su sesión. Un redespacho, un `--reopen` o un `/clear` lo
  // borraban, y el humano que abría el PR no tenía dónde ver que quedaba un
  // gate pendiente. Una label de GitHub sobrevive a las tres cosas y la ve
  // todo el mundo. `gateLabels` SIEMPRE devuelve al menos una (`gate:none`
  // cuando no hay ninguno) — ver gates.js#GATE_LABEL_NONE para por qué el
  // silencio no puede significar dos cosas distintas aquí.
  //
  // Va después de area/touches y antes de status por la misma razón que el
  // resto: orden fijo = salida determinista para tests, dry-run y diffs.
  for (const g of gateLabels(gatesOf(slice).gates)) labels.push(g)
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

// renderGatesContent (F21): igual que renderDescripcion/renderProtectedLine/
// renderSpecLink, la ÚNICA fuente de verdad de "qué debería decir" la sección
// de gates — compartida entre crear el issue (buildIssueBody) y compararlo
// después (reconcile.js#diffIssue). NUNCA devuelve null (a diferencia de
// renderDescripcion): la sección se emite siempre, porque "este slice no exige
// ningún gate" es una afirmación que un humano necesita poder leer en el
// issue; su ausencia solo diría "aquí no lo pensó nadie".
export function renderGatesContent(slice) {
  return renderGatesIssueContent(gatesOf(slice), slice.type)
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

export function buildIssueBody(slice, specRef, epicContext = null) {
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
  // Las dos secciones de contexto van DESPUÉS de la descripción y ANTES de los
  // criterios de aceptación: son el contexto con el que esos criterios se
  // interpretan, y detrás de ellos se leerían tarde.
  //
  // El contexto del epic sólo se emite si el spec trae texto real — sin él, el
  // spec no tiene ninguna opinión, y una sección vacía afirmaría que sí la
  // tiene y está en blanco. La heredada se emite SIEMPRE, aunque nadie haya
  // escrito nada todavía: una sección que sólo existe cuando alguien se acordó
  // de crearla es una sección que nadie crea cuando hace falta, y sin un sitio
  // fijo cada quien inventa el suyo — con lo que ningún kickoff puede
  // nombrarla.
  if (epicContext) {
    lines.push(EPIC_CONTEXT_HEADING)
    lines.push(epicContext)
    lines.push('')
  }
  lines.push(INHERITED_CONTEXT_HEADING)
  lines.push(INHERITED_CONTEXT_PLACEHOLDER)
  lines.push('')
  lines.push('## Acceptance criteria (EARS, 1:1 con tests)')
  lines.push(renderAcContent(slice.ac))
  lines.push('')
  const deps = slice.deps || []
  if (deps.length) {
    lines.push('## Dependencias')
    lines.push(renderDepsContent(deps))
    lines.push('')
  }
  // F21: los gates van justo después de los criterios de aceptación (y de las
  // dependencias, si las hay) y ANTES de "Out of scope / Protected" — el orden
  // de lectura de quien abre el issue o el PR es "qué entrega → cómo se
  // verifica → qué falta para poder mergearlo → qué queda fuera". Se emite
  // SIEMPRE, también cuando no hay ningún gate: ver renderGatesContent.
  lines.push(GATES_HEADING)
  lines.push(renderGatesContent(slice))
  lines.push('')
  lines.push('## Out of scope / Protected')
  lines.push(renderProtectedLine(slice))
  lines.push('')
  lines.push(`<!-- ct-order:${slice.n} -->`) // marcador greppable de orden para el dispatcher
  return lines.join('\n')
}

// findDuplicateOrders: los números de slice (`#` de la tabla §9) son la
// única llave que buildOrderIndex (scripts/gh-issue-map.js) usa para mapear
// "orden -> número de issue de GitHub" dentro de un epic. Desde D1 esa
// función no resuelve una colisión a ciegas: el primer issue visto conserva
// el slot y el hueco entero se acumula en `collisions`, lo que hace que
// buildDispatchInput EXCLUYA de la tanda al epic afectado. Aun así, un
// duplicado en la FUENTE (dos filas de la tabla §9 con el mismo `#`) sigue
// siendo un error que hay que cortar aquí y no allí: dejarlo pasar convierte
// un epic entero en indispachable. Se corta en el productor (aquí) en vez de
// dejar que el consumidor se defienda.
function findDuplicateOrders(slices) {
  const seen = new Set()
  const dupes = new Set()
  for (const s of slices || []) {
    if (seen.has(s.n)) dupes.add(s.n)
    seen.add(s.n)
  }
  return [...dupes].sort((a, b) => a - b)
}

export function groomPlan(slices, { milestone, specRef, epicContext = null }) {
  const dupes = findDuplicateOrders(slices)
  if (dupes.length) {
    throw new Error(`groomPlan: orden(es) de slice duplicado(s) en la tabla §9: ${dupes.join(', ')}`)
  }
  return {
    milestone,
    issues: slices.map((s) => ({
      order: s.n,
      title: buildIssueTitle(s),
      body: buildIssueBody(s, specRef, epicContext),
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
      // F21: los gates RESUELTOS (no la celda cruda) viajan en el plan por el
      // mismo motivo que ac/descripcion/protectedLine — reconcile.js y el
      // dry-run los necesitan sin volver a resolverlos, y quien lea el JSON
      // del `--dry-run` tiene que poder ver qué gates saldrán sin reproducir
      // la resolución de cabeza.
      gates: gatesOf(s).gates,
      gatesContent: renderGatesContent(s),
      // El texto del epic viaja en el plan, no sólo dentro del body ya
      // renderizado, por el mismo motivo que ac/descripcion/protectedLine: la
      // comparación contra un issue existente lo necesita sin volver a parsear
      // el cuerpo que acaba de generar, y quien lea el JSON del --dry-run
      // tiene que poder ver qué va a salir sin reproducir la lectura del spec.
      epicContext,
    })),
  }
}
