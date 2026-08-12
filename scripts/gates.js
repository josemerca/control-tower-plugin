// ============================================================================
// F21 — GATES HUMANOS, SEPARADOS DEL TIPO TÉCNICO DEL SLICE.
//
// EL DEFECTO QUE CIERRA ESTE FICHERO. Hasta aquí, el único gate humano de todo
// el plugin vivía DENTRO de una cadena de texto: la del addendum de `ui`
// (kickoff.js#ADDENDA, "gate de screenshot obligatorio y respeta el design
// system…"). No había ningún otro mecanismo — ni en slices.js, ni en groom.js,
// ni en el cuerpo del issue, ni en las labels. Consecuencia: la columna `Tipo`
// de la tabla §9 decidía DOS cosas a la vez —qué recordatorio TÉCNICO recibe
// el agente, y si hay GATE HUMANO— y esos dos ejes no siempre coinciden.
//
// El caso real que lo destapó: un slice cuyo `Tipo` es `backend` (una
// migración con backfill) que el spec del epic marcaba explícitamente como
// necesitado de gate visual, porque "la barra es lo más visible de todo el
// spec". Es backend por dentro y visible por fuera. El kickoff le dio el
// addendum de backend y NINGÚN gate, y nada lo señaló.
//
// Y la capa de ironía, que es la que fija el criterio de diseño de todo esto:
// el spec del epic decía "el gate visual no depende de esto: vive en §10 y en
// la REGLA #-2, que son más fuertes que un addendum". Eso es cierto para un
// HUMANO que lee el spec. El agente despachado NO lee el spec (el contrato §9
// lo dice con todas las letras: "no recibe el spec: se hidrata del issue").
// Una garantía que vive solo en un documento que el destinatario nunca abre no
// es una garantía. De ahí la propiedad de fondo:
//
//   NINGUNA EXIGENCIA QUE EL SPEC LE HAGA AL AGENTE PUEDE DEPENDER DE QUE EL
//   AGENTE LEA EL SPEC.
//
// POR QUÉ UN VOCABULARIO CERRADO. Cada gate tiene que poder EXPLICARSE al
// agente (una frase en el kickoff) y al humano que abre el PR (una línea en el
// cuerpo del issue). Un vocabulario abierto produciría `gate:loquesea`: una
// label que nadie sabe cómo cerrar, y por tanto un gate que existe en la
// etiqueta y no en la práctica — el mismo fallo que estamos arreglando, con
// otra ropa. Un token fuera de este mapa lo rechaza /ct-groom antes de escribir
// nada (ver la validación en ct-groom.mjs), y el mensaje nombra el vocabulario
// entero: estrechar lo que el sistema acepta crea una categoría nueva de
// rechazo, y esa categoría necesita voz propia.
//
// POR QUÉ ESTOS DOS GATES Y NO OTROS. No se han inventado: se han EXTRAÍDO de
// las dos únicas frases de ADDENDA que exigían un acto humano —"gate de
// screenshot obligatorio" (`ui`) y "apply solo tras review" (`infra`)—. El
// resto de cada addendum es recordatorio técnico y allí se queda. Añadir un
// gate nuevo aquí es un acto deliberado con su texto de kickoff y de issue; no
// hay forma de crear uno "de paso" desde un spec.
// ============================================================================

// GATE_LABEL_PREFIX / GATE_LABEL_NONE: el canal por el que el gate SOBREVIVE.
// Un kickoff es efímero (se pierde con el contexto de su sesión); una label de
// GitHub no. `/ct-next` reconstruye el slice que despacha a partir del ISSUE
// (gh-issue-map.js#mapGhIssue), así que un gate escrito en una label vuelve a
// aparecer intacto en un redespacho, en un `--reopen`, y en la pantalla del
// humano que abre el PR.
export const GATE_LABEL_PREFIX = 'gate:'
// GATE_LABEL_NONE — por qué existe una label para decir "ninguno". Sin ella,
// "este issue no tiene ninguna label gate:" significaría a la vez dos cosas
// incompatibles: (a) este slice no exige ningún gate, y (b) este issue se
// groomeó ANTES de que los gates existieran, así que su gate (si lo tenía) no
// está escrito en ninguna parte. El dispatcher tiene que distinguirlas: en (a)
// debe respetar el "ninguno"; en (b) debe caer al `Tipo`, o todos los issues
// `ui` ya groomeados perderían su gate de screenshot el día que esto se
// despliega — la misma avería que esta ronda cierra, en la otra dirección.
export const GATE_LABEL_NONE = 'gate:none'

// GATES: el vocabulario. `kickoff` es lo que lee el AGENTE; `issue`, lo que lee
// el HUMANO que abre el issue o el PR. Los dos textos dicen lo mismo desde los
// dos lados del gate a propósito: el agente tiene que saber que NO puede
// cerrarlo él, y el humano tiene que saber qué se espera de él.
export const GATES = {
  visual: {
    kickoff: 'GATE HUMANO `visual` (lo pide el spec para ESTE slice, esté o no en su `Tipo`): antes de que este PR se pueda mergear, un humano tiene que ver el cambio. Adjunta al PR una captura (o un vídeo corto) del estado ANTES y DESPUÉS, di desde qué pantalla/ruta se llega, y NO des el gate por cumplido tú: no lo cierras tú, lo cierra quien revisa.',
    issue: '**`visual`** — antes de mergear, un humano tiene que VER el cambio: el PR debe traer captura (o vídeo) del antes/después y la ruta para reproducirlo. El agente no puede darlo por cumplido.',
  },
  apply: {
    // El texto evita a propósito las palabras "migración"/"rollback"/"contrato":
    // los tests de kickoff.js comprueban que el addendum de un `Tipo` no se
    // filtra en el de otro usando esas palabras como marcadores, y un gate que
    // las repitiera haría que ese guardián diera un falso positivo (un slice
    // `infra` "contendría marcadores de backend"). El gate se explica igual de
    // bien sin ellas.
    kickoff: 'GATE HUMANO `apply` (lo pide el spec para ESTE slice, esté o no en su `Tipo`): no apliques nada contra un entorno real (`apply`, `deploy`, un script ejecutado sobre datos de verdad) por tu cuenta. Deja el plan/dry-run en el PR y PARA: el apply lo autoriza un humano después de revisarlo.',
    issue: '**`apply`** — nada se aplica contra un entorno real hasta que un humano revise el plan/dry-run que trae el PR. El agente deja el plan y para.',
  },
  plan: {
    // El único gate que corta ANTES de implementar, no antes de mergear: su
    // valor está en parar cuando tirar el trabajo aún no cuesta nada. Por eso
    // el texto pide publicar el plan como COMENTARIO del issue — el PR puede
    // no existir todavía. F-jjponz-2: está implicado POR DEFECTO en todo
    // slice (ver gatesForType, abajo) — no vive en TYPE_GATES porque no es
    // un eje técnico; la renuncia por fila es `!plan`, ruidosa como todas.
    kickoff: 'GATE HUMANO `plan` (implicado por defecto en TODO slice, salvo renuncia `!plan` en el spec): con el plan del slice escrito, validado con --check-plan y commiteado, publícalo como comentario del issue y PARA — no implementes nada hasta que un humano responda OK en ese comentario. No lo cierras tú: lo cierra quien revisa el plan.',
    issue: '**`plan`** — antes de implementar, un humano tiene que revisar el PLAN del slice: el agente lo publica como comentario de este issue y se detiene hasta el OK. El agente no puede darlo por cumplido.',
  },
}

// GATE_ORDER: orden canónico de salida (labels, cuerpo del issue, kickoff), para
// que el mismo slice produzca SIEMPRE la misma secuencia — igual que
// groom.js#buildLabels fija tipo → area → touches → status. Un orden que
// dependiera de cómo se escribió la celda haría inestables los diffs de
// `gh label`, el dry-run y la detección de divergencia.
const GATE_ORDER = Object.keys(GATES)
const inGateOrder = (tokens) => GATE_ORDER.filter((g) => tokens.includes(g))

// TYPE_GATES: qué gates implica cada `Tipo`, y por tanto EL CASO POR DEFECTO —
// un `Tipo: ui` sigue trayendo su gate de screenshot sin que nadie escriba
// nada nuevo en el spec. Esta tabla es la mitad "compatible" del arreglo; la
// columna `Gate` es la mitad que permite separarse de ella en los dos
// sentidos.
export const TYPE_GATES = {
  ui: ['visual'],
  infra: ['apply'],
}

export function gatesForType(type) {
  const typed = TYPE_GATES[typeof type === 'string' ? type.trim() : ''] ?? []
  // F-jjponz-2 — `plan` está implicado en TODO slice, venga el Tipo que
  // venga: el plan del slice siempre pasa por revisión humana antes de
  // implementar, salvo renuncia EXPLÍCITA por fila (`!plan` en la columna
  // Gate, con el mismo ruido que cualquier renuncia). Vive aquí y no en
  // TYPE_GATES a propósito: TYPE_GATES mapea el eje TÉCNICO (ui→visual,
  // infra→apply) y este defecto es transversal a todos los tipos —
  // meterlo en cada entrada del mapa lo haría depender de que el Tipo
  // exista en el mapa, y un `Tipo: backend` (sin entrada) lo perdería.
  return [...typed, 'plan']
}

// cleanGateToken: mismo criterio de tolerancia a marcado inline que el resto de
// la tabla §9 (slices.js#cleanEmphasis) — un autor que ya ha demostrado
// escribir "**S1**" y "`–`" escribirá "`visual`" igual de fácil, y una columna
// nueva no puede ser más quisquillosa que las ocho que ya existen. El `!` de
// renuncia se quita ANTES de limpiar (y se tolera un espacio detrás: "! visual")
// para que "**!visual**" signifique lo mismo que "!visual".
//
// NO se normaliza más allá de esto (nada de descartar caracteres sueltos como
// hace slices.js#normalizeToken): el resultado se compara contra un
// vocabulario CERRADO, así que cualquier basura restante hace que el token no
// matchee y se reporte como desconocido — que es exactamente lo que queremos.
// Normalizar de más convertiría "vi sual" en un gate válido.
function cleanGateToken(raw) {
  const cleaned = String(raw).replace(/[`*_~]/g, '').trim().toLowerCase()
  // Prefijo `gate:` tolerado, por la MISMA razón (y con el mismo precedente)
  // que slices.js#stripColumnPrefix tolera `area:`/`touches:` dentro de sus
  // columnas: al autor se le pide el token pelado, pero lo que ve en la UI de
  // GitHub es la label entera, así que escribir `Gate: gate:visual` es el
  // error natural. Sin este strip acabaría en el abort de "gate desconocido"
  // por haber escrito, con otra ropa, exactamente lo que se le pedía.
  return cleaned.startsWith(`${GATE_LABEL_PREFIX}`) ? cleaned.slice(GATE_LABEL_PREFIX.length).trim() : cleaned
}

// NO_VALUE_MARKERS: el mismo conjunto que slices.js. Se repite aquí (en vez de
// importarlo) porque `isNoValueCell` de slices.js es la puerta de entrada a
// TODO el parseo de la tabla, y gates.js tiene que poder usarse desde
// kickoff.js —que no depende de slices.js y no debe empezar a hacerlo— sin
// arrastrar el parser entero. Son seis caracteres y un test los fija.
const NO_VALUE = new Set(['-', '–', '—', '―', '−', '--', ''])

// parseGateCell: celda `Gate` cruda -> { add, waive, unknown }.
//
// SINTAXIS: tokens separados por coma. `visual` AÑADE el gate; `!visual`
// RENUNCIA al que implique el `Tipo`. Se eligió `!` y no `-` porque `-` es uno
// de los marcadores de "sin valor" de todas las demás columnas: "-visual" y
// "-" a dos caracteres de distancia significando cosas opuestas es justo el
// tipo de trampa que este parser lleva cinco rondas quitando.
//
// UNA CELDA CON MARCADOR DE "SIN VALOR" NO ES UNA RENUNCIA. "–" significa "no
// he declarado nada aquí" (igual que en Dep/Acepta/Protegido/Área/Toca), así
// que los gates del `Tipo` siguen en pie. Leerlo como "renuncio a todo" haría
// que rellenar la columna con guiones —lo que hace todo el mundo cuando el
// resto de la fila los lleva— quitara gates en silencio.
export function parseGateCell(cell) {
  const raw = String(cell ?? '').trim()
  const add = []
  const waive = []
  const unknown = []
  if (NO_VALUE.has(cleanGateToken(raw))) return { add, waive, unknown }
  for (const piece of raw.split(',')) {
    const trimmed = piece.trim()
    if (!trimmed) continue // celda vacía entre comas: nunca hubo nada que reportar
    const isWaiver = /^\s*[`*_~]*\s*!/.test(trimmed)
    const token = cleanGateToken(trimmed.replace(/^[`*_~\s]*!\s*/, ''))
    // Un "!" sin ningún gate detrás no nombra nada — pero la celda NO estaba
    // vacía, así que su autor cree haber declarado algo. Se reporta como
    // desconocido (con el texto crudo) en vez de descartarse: descartar en
    // silencio una renuncia mal escrita es exactamente la forma de fallo que
    // esta ronda persigue, en su versión más pequeña.
    if (!token) { unknown.push(trimmed); continue }
    if (!Object.hasOwn(GATES, token)) { unknown.push(token); continue }
    ;(isWaiver ? waive : add).push(token)
  }
  return { add, waive, unknown }
}

// resolveGates: los dos ejes, resueltos en un solo sitio. Devuelve, además del
// conjunto final, TODO lo que /ct-groom necesita para hablar en voz alta —
// porque el encargo no es solo "que se pueda declarar", es "que el sistema lo
// diga":
//   - gates        el conjunto final, en orden canónico
//   - implied      los que vienen del `Tipo` y siguen en pie
//   - added        gates que el `Tipo` NO implica → EL CASO QUE MOTIVA LA
//                  RONDA: quien groomea tiene que verlo
//   - waived       gates del `Tipo` a los que el spec RENUNCIA explícitamente
//                  → ruidoso siempre, nunca un silencio
//   - redundant    declarados y ya implicados por el `Tipo` (inocuo, se dice)
//   - inertWaivers renuncias a un gate que el `Tipo` no implicaba (no hacen
//                  nada; callarlas dejaría al autor creyendo que quitó algo)
//   - unknown      tokens fuera del vocabulario (los rechaza ct-groom.mjs)
//   - contradictions  el mismo gate pedido y renunciado en la misma celda
export function resolveGates(type, cell) {
  const { add, waive, unknown } = parseGateCell(cell)
  const implied = gatesForType(type)
  const contradictions = inGateOrder(add.filter((g) => waive.includes(g)))
  // Una contradicción NO se resuelve aquí eligiendo un ganador: ct-groom.mjs
  // aborta con ella. Se deja fuera del conjunto final por seguridad de la
  // función pura (alguien que llame a resolveGates sin pasar por ct-groom no
  // recibe un gate a medias), pero el conjunto que importa es el reporte.
  const waiveSet = new Set(waive)
  const addSet = new Set(add.filter((g) => !waiveSet.has(g)))
  const gates = inGateOrder([...new Set([...implied.filter((g) => !waiveSet.has(g)), ...addSet])])
  return {
    gates,
    implied: inGateOrder(implied.filter((g) => gates.includes(g))),
    added: inGateOrder([...addSet].filter((g) => !implied.includes(g))),
    waived: inGateOrder(waive.filter((g) => implied.includes(g))),
    redundant: inGateOrder(add.filter((g) => implied.includes(g) && !waiveSet.has(g))),
    inertWaivers: inGateOrder(waive.filter((g) => !implied.includes(g))),
    unknown,
    contradictions,
  }
}

// gateLabels: el conjunto resuelto -> labels. SIEMPRE devuelve al menos una
// (ver GATE_LABEL_NONE, arriba).
export function gateLabels(gates) {
  const list = inGateOrder(gates || [])
  return list.length ? list.map((g) => `${GATE_LABEL_PREFIX}${g}`) : [GATE_LABEL_NONE]
}

// gatesFromLabels: el camino de vuelta — de las labels de un issue real al
// conjunto de gates. `declared` es el bit que distingue "ningún gate" de
// "ninguna declaración" (ver GATE_LABEL_NONE).
//
// Una label `gate:` SIN valor (el colon presente y nada detrás, o solo
// espacios: creada por accidente en el editor de GitHub) no cuenta ni como
// gate ni como declaración — mismo criterio y mismo motivo que
// gh-issue-map.js#mapGhIssue aplica a `area:`/`touches:` vacías. `.trim()`
// antes de mirar la longitud, para que "gate: " no cuele por tener un carácter.
export function gatesFromLabels(labels) {
  const values = (labels || [])
    .filter((l) => typeof l === 'string' && l.startsWith(GATE_LABEL_PREFIX))
    .map((l) => l.slice(GATE_LABEL_PREFIX.length).trim().toLowerCase())
    .filter((v) => v.length > 0)
  const declared = values.length > 0
  const known = values.filter((v) => v !== 'none' && Object.hasOwn(GATES, v))
  const unknown = values.filter((v) => v !== 'none' && !Object.hasOwn(GATES, v))
  return { gates: inGateOrder(known), declared, unknown }
}

// resolveGatesForAgent: qué gates recibe el agente que se despacha.
//
// La regla —y su única excepción— en un solo sitio, porque es la que decide si
// un slice sale con gate o sin él: si el issue DECLARA sus gates (tiene alguna
// label `gate:`, incluida `gate:none`), esa declaración manda y no se
// completa con nada. Si no declara nada, es un issue anterior a esta ronda: se
// cae al `Tipo`, que es exactamente lo que hacía el plugin antes. La
// alternativa —unir siempre declaración y `Tipo`— resucitaría cualquier gate
// al que el spec hubiera renunciado.
export function resolveGatesForAgent(slice) {
  if (slice && slice.gatesDeclared) return inGateOrder(slice.gates || [])
  return gatesForType(slice && slice.type)
}

// renderGateKickoffLines / renderGatesIssueContent: los dos textos, cada uno
// para su lector. Viven aquí y no en kickoff.js/groom.js por el mismo motivo
// que groom.js#renderDepsContent: una sola fuente de verdad de "qué debería
// decir", compartida por quien lo escribe y por quien lo compara después.
export function renderGateKickoffLines(gates) {
  return inGateOrder(gates || []).map((g) => GATES[g].kickoff)
}

// renderGatesIssueContent: el cuerpo de la sección "## Gates" del issue.
// SIEMPRE devuelve contenido (nunca null, a diferencia de
// groom.js#renderDescripcion): la sección se emite siempre, también cuando no
// hay ningún gate. "Este slice no tiene gates" es una afirmación que un humano
// que abre el PR necesita poder leer; su ausencia solo diría "este issue es
// viejo, o nadie lo pensó".
export function renderGatesIssueContent(resolution, type) {
  const lines = []
  const gates = inGateOrder(resolution.gates || [])
  if (gates.length) {
    lines.push('Antes de mergear, estos gates los cierra un HUMANO — el agente que implementa el slice no puede darlos por cumplidos:')
    for (const g of gates) lines.push(`- ${GATES[g].issue}`)
  } else {
    lines.push('- (ninguno) — este slice no exige ningún gate humano antes de mergear.')
  }
  for (const g of resolution.added || []) {
    lines.push(`- ⚠️ el gate \`${g}\` lo pide el spec para ESTE slice: no viene de su \`Tipo\`${type ? ` (\`${type}\`)` : ''}.`)
  }
  for (const g of resolution.waived || []) {
    lines.push(`- ⚠️ RENUNCIA explícita: el gate \`${g}\`, que implica el \`Tipo\` de este slice (\`${type}\`), se ha retirado a propósito en la tabla §9 del spec (\`Gate: !${g}\`). Nadie lo comprobará antes de mergear.`)
  }
  return lines.join('\n')
}
