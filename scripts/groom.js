// Lógica pura de grooming: de Slice[] (T1) a un plan de operaciones GitHub.
import { isNoValueCell } from './slices.js'
import { resolveGates, gateLabels, renderGatesIssueContent } from './gates.js'
import { locateSection, unterminatedDelimiter, normalizeToLF, SENAL_HEADING } from './gh-issue-map.js'

// SENAL_HEADING (Slice 10) nace en gh-issue-map.js (capa inferior: este
// fichero ya importa de allí y mapGhIssue también la necesita — aquí crearía
// un import circular) y se re-exporta para que los consumidores de groom no
// tengan que saber dónde nació — el mismo trato que las cabeceras hermanas
// GATES_HEADING/EPIC_CONTEXT_HEADING, que sí nacieron aquí.
export { SENAL_HEADING }

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

// EPIC_CONTEXT_REASONS (review final de rama, I1): por qué readEpicContext no
// devuelve texto. No es decoración del mensaje: decide si `--reconcile` puede
// RETIRAR la sección del cuerpo de los issues que ya la tengan.
//
//   ABSENT / EMPTY  el epic no tiene contexto común, y lo dice el spec. La
//                   sección no debe existir en ningún cuerpo: retirarla es la
//                   reconciliación correcta (§3.1 del diseño: una sección
//                   presente pero vacía cuenta como ausente).
//   MALFORMED       el spec SÍ tiene una opinión, pero no se ha podido leer un
//                   texto válido. Eso no autoriza a tocar nada: borrar la
//                   sección de los N issues porque alguien puso un `###` de
//                   más sería destruir texto bueno a cambio de un error de
//                   formato. Se avisa y se deja el cuerpo como está.
export const EPIC_CONTEXT_REASONS = { ABSENT: 'ausente', EMPTY: 'vacia', MALFORMED: 'malformada' }

// La frase que cierra los avisos de sección MALFORMADA. Está en una constante
// porque la comparten los dos avisos de esa clase y tiene que decir
// exactamente lo mismo en los dos: lo que un lector necesita saber es que su
// error de formato no le ha borrado nada.
const MALFORMED_KEEPS_WHAT_IS_THERE = 'Mientras esté así, no se toca ni se borra el contexto que ya tengan los issues de este epic: sin texto válido, el spec no tiene ninguna opinión que aplicar.'

// truncationLine: la línea que truncó la sección, si resulta que locateSection
// cortó antes de una cabecera H1/H2 o del final del fichero. `locateSection`
// termina la sección cuando encuentra una cabecera de CUALQUIER nivel, o un
// comentario HTML autocontenido (uno que abre y cierra en la misma línea —
// ver gh-issue-map.js#locateSection). Terminar en una cabecera es legítimo si
// es H1 o H2 (solo terminan la sección normalmente), pero si es H3+
// (subcabecera del epic), o si es el comentario autocontenido, hay un
// truncamiento que pierde contenido. Esta función devuelve esa línea
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

// ============================================================================
// F32 — LA PUERTA DE CONGELACIÓN (§4.1 del handoff F32). Groom gana UNA
// comprobación, pre-registrada como "dos greps en la pasada que groom ya
// hace": el spec no entra si tiene `[NEEDS CLARIFICATION` sin resolver o si
// `## Hipótesis` falta o está vacía. Sin apuesta falsable no es un epic
// (decisión de José, 2026-08-07); la CALIDAD de la hipótesis la juzga el
// humano en la congelación — aquí solo se mira PRESENCIA.
//
// A propósito NO reutiliza locateSection: aquello es un extractor con
// semántica de vallas y comentarios ocultos porque su texto viaja al cuerpo
// de los issues. Esto es un detector de presencia, y un detector más listo
// que su pre-registro es un instrumento distinto del que se congeló en §6.
// El único refinamiento sobre el grep desnudo: un comentario HTML residual
// de la plantilla no cuenta como contenido de la hipótesis — dejar el
// placeholder puesto es exactamente el "relleno" que la puerta existe para
// no dejar pasar en silencio.
export const HYPOTHESIS_HEADING = '## Hipótesis'
export const NEEDS_CLARIFICATION_MARKER = '[NEEDS CLARIFICATION'
export const HYPOTHESIS_REASONS = { OK: 'ok', ABSENT: 'ausente', EMPTY: 'vacia' }

export function analyzeSpecFreeze(specMd) {
  const lines = normalizeToLF(specMd || '').split('\n')
  const clarifications = []
  lines.forEach((raw, i) => {
    if (raw.includes(NEEDS_CLARIFICATION_MARKER)) clarifications.push({ line: i + 1, raw: raw.trim() })
  })
  // Cabecera de nivel 2 exacto cuyo texto EMPIEZA por "Hipótesis" — cubre
  // "## Hipótesis" y "## Hipótesis del experimento" (la plantilla). Un
  // "### Hipótesis" no cuenta: el grep pre-registrado es "## Hipótesis".
  const at = lines.findIndex((l) => /^ {0,3}##[ \t]+Hipótesis(\b|$)/.test(l))
  if (at === -1) return { hypothesis: HYPOTHESIS_REASONS.ABSENT, clarifications }
  const body = []
  for (let i = at + 1; i < lines.length; i++) {
    if (/^ {0,3}#{1,6}([ \t]|$)/.test(lines[i])) break
    body.push(lines[i])
  }
  const content = body.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim()
  return { hypothesis: content ? HYPOTHESIS_REASONS.OK : HYPOTHESIS_REASONS.EMPTY, clarifications }
}

// readEpicContext: lee del fichero de spec el texto que va a viajar, idéntico,
// al cuerpo de cada issue del epic.
//
// La sección se localiza POR EL TEXTO DE SU CABECERA, nunca por un número de
// sección — mismo criterio con el que analyzeSlicesTable localiza la tabla de
// slices por sus columnas: los números de sección de un spec se mueven en
// cuanto alguien inserta algo por delante.
//
// Devuelve `content: null` en los cuatro casos en que no hay nada que emitir
// (ausente, vacía, con un delimitador sin cerrar dentro, o con un
// truncamiento dentro), cada uno con su propio aviso: los cuatro se arreglan
// de forma distinta y un mensaje único obligaría a adivinar cuál pasó. Un spec
// sin esta sección es un spec VÁLIDO — de ahí que esto avise y nunca lance.
//
// `reason` (review final de rama, I1) es lo que impide que esos cuatro casos
// se confundan aguas abajo. Los cuatro producen el mismo `content: null`, pero
// NO significan lo mismo, y `buildReconcileBody` lee `null` como RETIRA LA
// SECCIÓN ENTERA: sin el motivo, añadir un `###` de más al spec borraba el
// contexto de los N issues del epic en el siguiente --reconcile. "El epic no
// tiene contexto" (ausente/vacía) autoriza a retirar; "no he podido leer un
// texto válido" (malformada) no autoriza nada — ver EPIC_CONTEXT_REASONS.
export function readEpicContext(specMd) {
  const warnings = []
  // CRLF (review final de rama, I2). Se normaliza AQUÍ, antes de localizar
  // nada, y por dos motivos distintos:
  //
  //   1. Lo que esta función devuelve viaja al CUERPO de los issues, y es el
  //      primer valor multi-línea derivado del spec que lo hace (las celdas de
  //      la tabla §9 pasan todas por `trim`, que se come el `\r`). Un `\r`
  //      dentro del cuerpo no se ve, pero diffIssue y buildReconcileBody
  //      comparan siempre texto normalizado a LF: contra un valor con `\r`
  //      no pueden coincidir NUNCA — `nota:` en cada corrida y, desde el
  //      arreglo de C1, una escritura en cada corrida, para siempre.
  //   2. `locateSection` (y con ella el guardarraíl entero) mira las líneas
  //      con ATX_HEADING_RE, que no reconoce "##\r" como cabecera: en un spec
  //      CRLF, una cabecera desnuda deja de terminar la sección y ésta se
  //      traga el resto del fichero. Ese fallo se arregla aquí, en la causa, y
  //      no tocando el regex de truncationLine — ese regex está bien, y de
  //      hecho coincide con ATX_HEADING_RE en rechazar "##\r"; lo que estaba
  //      mal era el texto que se les daba a los dos.
  const src = normalizeToLF(specMd || '')
  const loc = locateSection(src, EPIC_CONTEXT_HEADING)
  if (!loc) {
    warnings.push(`aviso: el spec no trae la sección "${EPIC_CONTEXT_HEADING}" — ningún issue de este epic lleva contexto común (ni el que se cree ahora, ni el que ya exista: con --reconcile la sección se retira del cuerpo). Si lo quieres, añade esa sección al spec, fuera de la tabla de slices, y vuelve a correr.`)
    return { content: null, reason: EPIC_CONTEXT_REASONS.ABSENT, warnings }
  }
  // Delimitador sin cerrar (review final de rama, C3). Va ANTES del
  // truncamiento porque es el fallo OPUESTO y lo tapa: `truncationLine` sólo
  // ve terminadores que cortan la sección demasiado pronto, y una valla (o un
  // comentario) sin cerrar esconde todas las líneas siguientes, así que deja
  // de haber terminador y `loc.content` se traga el resto del spec —tabla de
  // slices incluida— sin nada que avisar. Se comprueba con el MISMO escáner
  // que localiza la sección (gh-issue-map.js#unterminatedDelimiter), no con
  // uno nuevo.
  const abierto = unterminatedDelimiter(loc.content)
  if (abierto) {
    const que = abierto === 'valla' ? 'una valla de código (```) sin cerrar' : 'un comentario HTML (<!--) sin cerrar'
    warnings.push(`aviso: la sección "${EPIC_CONTEXT_HEADING}" del spec contiene ${que} y por eso NO se emite en ningún issue. Sin el cierre, la sección no termina donde parece: se traga todo lo que venga detrás en el spec (la tabla de slices incluida) y ese texto acabaría en el cuerpo de todos los issues. Cierra el delimitador y vuelve a correr. ${MALFORMED_KEEPS_WHAT_IS_THERE}`)
    return { content: null, reason: EPIC_CONTEXT_REASONS.MALFORMED, warnings }
  }

  const truncating = truncationLine(src, loc)
  if (truncating) {
    warnings.push(`aviso: la sección "${EPIC_CONTEXT_HEADING}" del spec contiene ("${truncating}") y por eso NO se emite en ningún issue. La sección se reescribe entera desde el spec: el reemplazo termina en la primera cosa que corta la sección (cabecera de cualquier nivel, comentario HTML, etc.), así que nada que corte puede vivir dentro. ${MALFORMED_KEEPS_WHAT_IS_THERE}`)
    return { content: null, reason: EPIC_CONTEXT_REASONS.MALFORMED, warnings }
  }
  const content = loc.content.trim()
  if (!content) {
    warnings.push(`aviso: la sección "${EPIC_CONTEXT_HEADING}" del spec está presente pero sin contenido — se trata igual que si no estuviera, o sea que ningún issue lleva contexto común (y con --reconcile la sección se retira del cuerpo de los que ya la tengan). Escribe algo debajo de la cabecera, o quítala.`)
    return { content: null, reason: EPIC_CONTEXT_REASONS.EMPTY, warnings }
  }
  return { content, reason: null, warnings }
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

// parseSenalCell (Slice 10): EL clasificador de la celda `Señal` — UNO solo,
// reutilizado por groom (validación en ct-groom.mjs + render aquí), por
// kickoff (la línea condicional del despacho) y, en prosa, por la rúbrica del
// juez de slice. La celda es texto libre de UNA pieza (la coma no separa,
// como `Protegido`), y la exención razonada se escribe `N/A — <razón>`: el
// idioma que el repo ya tiene para "no aplica, y por esto" (el §8 del plan de
// slice y el `**Tests:** N/A` de una tarea). Devuelve `{ kind, text }`:
//
//   ninguna             celda vacía, null, o con marcador de "sin valor"
//                       (guiones) — NO DECLARADA, nunca una exención.
//   senal               texto libre con contenido: la señal, trimmed verbatim.
//   exencion            `N/A — <razón>` con razón no vacía; `text` es la
//                       celda trimmed VERBATIM (con su `N/A —` dentro) — el
//                       consumidor la distingue solo por su prefijo, sin
//                       re-parsear ni re-renderizar nada.
//   exencion-sin-razon  la familia N/A sin razón legible detrás — el wrapper
//                       la convierte en hardError (exit 2): una exención que
//                       nadie puede leer es una señal sin declarar disfrazada
//                       de decisión.
//
// La detección de la familia N/A es /^n\/a(\b|$)/i, SIN tolerancia de énfasis
// (misma postura que la columna `#`: "**N/A**" no perdona negrita); la razón
// es lo que queda tras quitar `N/A` y los separadores iniciales (—/–/-/: y
// espacios).
export function parseSenalCell(raw) {
  const trimmed = (raw ?? '').trim()
  if (!trimmed || isNoValueCell(trimmed)) return { kind: 'ninguna', text: null }
  if (/^n\/a(\b|$)/i.test(trimmed)) {
    const razon = trimmed.replace(/^n\/a/i, '').replace(/^[\s—–\-:]+/, '').trim()
    if (!razon) return { kind: 'exencion-sin-razon', text: null }
    return { kind: 'exencion', text: trimmed }
  }
  return { kind: 'senal', text: trimmed }
}

// renderSenalContent (Slice 10): qué debería decir la sección
// `## Señal de observabilidad` — la misma fuente única de verdad que
// renderDescripcion/renderProtectedLine, compartida entre crear el issue
// (buildIssueBody) y compararlo después (reconcile.js#diffIssue). `null`
// significa "la sección no debería existir": sin declaración no hay nada que
// emitir (a diferencia de `## Gates`, aquí no hay fallback que distinguir y
// una sección que sale siempre es el aviso-que-sale-siempre que entrena a
// ignorar). Con una exención sin razón también devuelve `null` — esta función
// es pura y no lanza: el wrapper (ct-groom.mjs) aborta con hardError ANTES de
// llegar a ningún render.
export function renderSenalContent(slice) {
  const { kind, text } = parseSenalCell(slice.senal)
  return (kind === 'senal' || kind === 'exencion') ? text : null
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
  // Slice 10: la señal de observabilidad va tras los AC y ANTES de
  // "## Dependencias" — cierra la zona del lector "cómo se verifica → qué
  // debe observarse" sin tocar ningún ancla de inserción de --reconcile (el
  // contexto del epic se inserta antes de "## Contexto heredado"/los AC; las
  // deps se anclan en "## Out of scope / Protected"). Solo se emite cuando
  // hay contenido (señal o exención razonada, VERBATIM de la celda): sin
  // declaración, silencio — ambos casos son sin-vara para el juez y una
  // sección que saliera en todos los issues de todos los epics que no usan
  // la columna sería el aviso-que-sale-siempre que entrena a ignorar.
  const senal = renderSenalContent(slice)
  if (senal) {
    lines.push(SENAL_HEADING)
    lines.push(senal)
    lines.push('')
  }
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

export function groomPlan(slices, { milestone, specRef, epicContext = null, epicContextReason = null }) {
  // epicContextUnknown (I1): "no he podido leer un texto válido" NO es "el
  // epic no tiene contexto". Sin esta distinción, `epicContext: null` viajaba
  // igual en los dos casos y buildReconcileBody lo leía siempre como "retira
  // la sección". Es lo único que reconcile.js necesita saber del motivo: el
  // resto del detalle vive en el aviso, que ya lo ha impreso el wrapper.
  const epicContextUnknown = epicContextReason === EPIC_CONTEXT_REASONS.MALFORMED
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
      // Slice 10: la señal estructurada viaja junto a descripcion/
      // protectedLine y por el mismo motivo — reconcile compara contra un
      // issue existente sin re-parsear el body que este plan acaba de generar.
      senal: renderSenalContent(s),
      specLink: renderSpecLink(s, specRef),
      // F21: los gates RESUELTOS (no la celda cruda) viajan en el plan por el
      // mismo motivo que ac/descripcion/protectedLine — reconcile.js y el
      // dry-run los necesitan sin volver a resolverlos, y quien lea el JSON
      // del `--dry-run` tiene que poder ver qué gates saldrán sin reproducir
      // la resolución de cabeza.
      gates: gatesOf(s).gates,
      gatesContent: renderGatesContent(s),
      // El texto del epic viaja en el plan, no sólo dentro del body ya
      // renderizado, por el mismo motivo que ac/descripcion/protectedLine:
      // para que comparar este slice contra un issue existente no obligue a
      // re-parsear el cuerpo recién generado. Mientras tanto, quien lea el
      // JSON del --dry-run tiene que poder ver qué va a salir sin reproducir
      // la lectura del spec.
      epicContext,
      epicContextUnknown,
    })),
  }
}
