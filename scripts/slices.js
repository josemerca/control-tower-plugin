// Parseo puro de la tabla §9 "Desglose en slices" de un spec markdown.
const DEP_RE = /#(\d+)/g
// PLAIN_INT_RE: el `#` de cada fila debe ser un entero a secas ("1", "23"),
// nunca "S1" (letra de prefijo humano), "**1**" (negrita markdown) ni "1a"
// (basura de cola). `parseInt` a secas es demasiado permisivo — acepta
// "1abc" -> 1 y "S1" -> NaN de forma inconsistente, y NaN se descartaba en
// silencio (F1, defecto 1: la fila entera desaparecía sin dejar rastro). Con
// este regex, cualquier "#" que no sea dígitos puros se reporta como fila
// no-parseable en vez de perderse. A propósito NO se aplica ninguna
// tolerancia de marcado inline aquí (a diferencia de Área/Toca, ver
// EMPHASIS_CHARS_RE/cleanEmphasis más abajo): el enunciado original de esta
// feature pide explícitamente que "**1**" sea rechazado y el autor tenga
// que escribir "1" a secas, así que "#" no perdona negrita/backticks.
const PLAIN_INT_RE = /^\d+$/
// HEADING_RE: una cabecera markdown ("## 10. Otra sección") marca el fin
// real del bloque de la tabla §9 (review de F1, punto 3: antes de esto, el
// escaneo de filas se detenía en la primera línea que no empezaba por "|",
// tratando una línea en blanco en medio de la tabla como "fin de tabla" y
// truncando en silencio las filas siguientes). Detenerse en una cabecera
// nueva evita arrastrar una tabla de una sección completamente distinta más
// abajo en el mismo documento.
const HEADING_RE = /^#{1,6}\s/
// SEPARATOR_RE: la fila "|---|---|" de una tabla markdown.
const SEPARATOR_RE = /^\s*\|[\s:|-]+\|\s*$/

// NO_VALUE_MARKERS: valores de celda que significan "vacío"/"sin valor" —
// guion (-), en dash (–, U+2013) y em dash (—, U+2014) son variantes
// tipográficas razonables de la misma intención que un editor de texto
// (Word, Notion, un móvil con autocorrección…) puede sustituir sin que el
// autor lo note. CRITICAL de la review de F1: la tabla REAL que originó
// esta feature usa DELIBERADAMENTE un em dash en la fila S1 para "sin
// dependencias" — reconocer solo "–"/"-" significa que arreglar la columna
// "#" (como pide nuestro propio mensaje de error) hace que esa misma celda,
// que siempre significó "sin dependencias" correctamente, dispare el abort
// de "Dep malformado" pidiéndole al autor que escriba "#N" para una celda
// que no necesita ninguna referencia. Un solo criterio de "vacío",
// compartido entre Dep/Acepta/Área/Toca (antes cada campo repetía su propia
// comparación `!== '–' && !== '-'`, con el mismo hueco cuatro veces).
// NBSP alrededor del carácter (p.ej. copiado de un editor que lo inserta
// automáticamente) ya lo elimina `String#trim()` de forma nativa —
// verificado (`' — '.trim() === '—'`) — así que no hace falta
// tratarlo aparte aquí.
const NO_VALUE_MARKERS = new Set(['-', '–', '—', '―', '−', '--'])
// isNoValueCell corre `cleanEmphasis` ANTES de comparar (review round 2,
// punto c): envolver el marcador en marcado inline ("`–`", "**–**") es la
// MISMA forma que el CRITICAL del em dash — un autor que ya demostró
// envolver valores en negrita/backticks (F1: "**S1**") envuelve igual de
// fácil el marcador de "nada". Sin este strip, `isNoValueCell` comparaba la
// celda cruda contra el Set y "`–`"/"**–**" no matcheaban nada, así que el
// autor recibía "si no hay dependencias, escribe –" por haber escrito
// exactamente eso, solo que envuelto. También se amplía el propio conjunto:
// el signo menos matemático (−, U+2212) y el doble-guion ("--") son
// salidas plausibles de autocorrección, igual que el em dash.
// Exportada (además de usarse internamente arriba): groom.js#buildIssueBody
// la necesita para tratar "Protegido" con el mismo criterio de "sin valor"
// que ya usan Dep/Acepta/Área/Toca — ver el fix correspondiente en groom.js.
export function isNoValueCell(trimmedCell) {
  return NO_VALUE_MARKERS.has(cleanEmphasis(trimmedCell))
}

function splitRow(line) {
  // "| a | b |" -> ["a","b"] (quita bordes y trim)
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
}

// EMPHASIS_CHARS_RE / PAIRED_UNDERSCORE_RE / cleanEmphasis (review round 4
// — segunda mitad del rediseño de la round 3, no un parche encima): la
// round 3 ya invirtió el enfoque de backtick/asterisco (quitarlos siempre,
// sin intentar detectar "pares que envuelven"), pero para guion bajo
// conservó `^_+`/`_+$` — una eliminación ASIMÉTRICA que no distingue un PAR
// de énfasis real (`_x_`, `__x__`, el cierre es la MISMA cadena que la
// apertura) de un guion bajo inicial o final SIN pareja. Y eso es
// exactamente cómo empiezan "_layout.tsx"/"_app.tsx" (Expo Router, Next.js)
// o "__init__.py" (Python), y cómo puede terminar "trailing_" — nombres de
// fichero de lo más normales en una columna "Toca". El token ES la clave de
// colisión de claim.js#tokensOf (comparación exacta): corromper
// "_layout.tsx" en "layout.tsx" produce colisiones falsas entre slices que
// no colisionan de verdad.
//
// PAIRED_UNDERSCORE_RE exige que el cierre sea la MISMA cadena que la
// apertura (backreference `\1`) — verificado explícitamente carácter por
// carácter contra la matriz completa antes de escribir el fix:
// "_layout.tsx"/"_app.tsx"/"__init__.py"/"trailing_" NO matchean (no
// terminan en guion bajo, o no tienen pareja simétrica) y quedan intactos;
// "_x_"/"__x__" SÍ matchean y se reducen a "x".
const PAIRED_UNDERSCORE_RE = /^(_{1,3})(.+?)\1$/
function stripPairedUnderscore(s) {
  const m = PAIRED_UNDERSCORE_RE.exec(s)
  return m ? m[2] : s
}
// EMPHASIS_CHARS_RE: backtick/asterisco no tienen ningún significado
// legítimo dentro de un token de label — se quitan sin condición.
const EMPHASIS_CHARS_RE = /[`*]/g
// cleanEmphasis: limpieza para valores de UNA SOLA celda sin estructura de
// lista (Dep/Acepta/Entrega, vía isNoValueCell) — no hay split por comas de
// por medio, así que quitar backtick/asterisco de toda la celda y el par
// de guion bajo (si lo hay) es seguro y no corrompe nada.
function cleanEmphasis(raw) {
  const trimmed = raw.trim()
  const withoutPairedUnderscore = stripPairedUnderscore(trimmed)
  return withoutPairedUnderscore.replace(EMPHASIS_CHARS_RE, '').trim()
}

// ALNUM_RE: una letra o dígito unicode — el criterio de "esto ya no es
// basura envolvente, esto es contenido" que usa stripColumnPrefix.
const ALNUM_RE = /[\p{L}\p{N}]/u

// stripColumnPrefix (F1, defecto 2 — invertido en la review round 4): a la
// columna Área/Toca se le está pidiendo un token ("medicacion"), pero el
// error natural de un autor humano es escribir la label completa
// ("area:medicacion") porque es lo que ve en la UI de GitHub. Sin este
// strip, normalizeToken se limita a borrar el `:` (no es un carácter
// "label-safe") y el resultado es "areamedicacion", que buildLabels
// (groom.js) vuelve a prefijar como "area:areamedicacion" — prefijo
// duplicado, label basura creada de verdad en el repo (`gh label create
// --force` no rechaza nada).
//
// Las rondas F1/2/3 perseguían esto envoltorio por envoltorio (backtick,
// luego negrita, luego "celda completa vs. cada pieza", luego guion bajo) y
// cada una dejaba huecos: CUALQUIER carácter no alfanumérico antes de
// "area:" (`~~`, comillas rectas, paréntesis, un enlace markdown
// "[area:x](...)"...) reproduce el mismo defecto, porque el chequeo exigía
// el marcador en el índice 0 exacto. La lista de envoltorios posibles es
// infinita; perseguirla uno a uno nunca termina.
//
// Enfoque invertido: se SALTAN los caracteres NO alfanuméricos iniciales
// SOLO para comprobar si el marcador "area:"/"touches:" aparece justo
// después — sin mutar nada todavía. Si aparece, se quita desde el
// principio (la basura inicial + el marcador) y se devuelve el resto (que
// normalizeToken, más abajo, limpia de cualquier basura que quede, delante
// o detrás — backtick/asterisco/tilde/comillas/paréntesis ya están fuera de
// su alfabeto permitido). Si NO aparece ningún marcador tras saltar la
// basura inicial, se devuelve el token ORIGINAL sin tocar — así un valor
// SIN prefijo (el caso normal, con diferencia el más común) nunca se
// mutila por esta función: es normalizeToken quien decide, como siempre,
// qué hacer con su propia puntuación.
function stripColumnPrefix(raw, ownPrefix, otherPrefix) {
  const lower = raw.toLowerCase()
  let i = 0
  while (i < lower.length && !ALNUM_RE.test(lower[i])) i++
  const ownMarker = `${ownPrefix}:`
  if (lower.startsWith(ownMarker, i)) {
    return { token: raw.slice(i + ownMarker.length), mismatched: false }
  }
  if (otherPrefix) {
    const otherMarker = `${otherPrefix}:`
    if (lower.startsWith(otherMarker, i)) {
      return { token: raw.slice(i + otherMarker.length), mismatched: true }
    }
  }
  return { token: raw, mismatched: false }
}

// normalizeToken: token crudo (ya sin marcado inline/prefijo de columna) ->
// token "label-safe" para componer `area:<token>`/`touches:<token>`
// (T14/W-A). Decisión de normalización (documentada en el informe de la
// tarea): trim + lowercase + se descartan silenciosamente los caracteres que
// no sean letra/dígito unicode, espacio, guion, guion bajo, `/`, `.` o `+`
// — en particular `:` (separador de prefijo `area:`/`touches:` que usa
// buildLabels en groom.js) y `,` (separador de tokens dentro de la propia
// celda, ver parseTokenList) se eliminan en vez de intentar escaparlos, para
// que el token resultante nunca pueda reintroducir ambigüedad en ninguno de
// los dos parseos que lo consumen. Los espacios SÍ se preservan (GitHub
// permite labels con espacios, p.ej. "good first issue"), solo se colapsan
// las corridas internas a uno.
function normalizeToken(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_/.+]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// parseTokenList: celda Área/Toca -> string[] normalizado. Mismo criterio de
// "vacío" que usan Dep/Acepta (ver NO_VALUE_MARKERS/isNoValueCell).
// Column-aware (F1): con `ownPrefix`/`otherPrefix` tolera que la celda traiga
// el prefijo de label completo en vez del token pelado (ver
// stripColumnPrefix). Cuando el prefijo encontrado es el de la otra columna,
// empuja un registro a `warnings` (mutado in-place por el llamador) en vez
// de lanzar o descartar el valor.
//
// Punto 6 de la review de F1: un token con contenido real que, tras quitar
// prefijo/marcado y normalizar, queda vacío (p.ej. "area:" sin nada detrás,
// o "???" sin ningún carácter label-safe) se descartaba con
// `.filter(Boolean)` sin decir nada — la misma inercia de colisión/
// serialización que ya se reporta cuando falta la COLUMNA entera, pero
// callada cuando es solo la CELDA la que queda vacía. Se reporta en
// `emptyWarnings` (mutado in-place, igual que `warnings`).
function parseTokenList(cell, opts = {}) {
  const { ownPrefix, otherPrefix, columnLabel, n, warnings, emptyWarnings } = opts
  const raw = (cell || '').trim()
  if (!raw || isNoValueCell(raw)) return []
  // Review round 4: ya NO hace falta limpiar backtick/asterisco de la celda
  // completa antes del split (como hacía la round 3) — el `stripColumnPrefix`
  // invertido (ver arriba) detecta el prefijo saltando basura inicial PIEZA
  // A PIEZA, así que da igual dónde caiga el split respecto al marcado: cada
  // trozo resultante se limpia por su cuenta.
  return raw
    .split(',')
    .map((piece) => {
      const trimmedPiece = piece.trim()
      // Celda genuinemente vacía entre comas (p.ej. "api,,db", la pieza del
      // medio): nunca hubo contenido que reportar, no se avisa.
      if (!trimmedPiece) return ''
      // Guion bajo SIMÉTRICAMENTE emparejado (`_x_`, `__x__`) es énfasis
      // markdown y se quita; uno SIN pareja ("_layout.tsx", "__init__.py",
      // "trailing_") es contenido legítimo — ver PAIRED_UNDERSCORE_RE.
      // `stripPairedUnderscore` de una entrada no vacía SIEMPRE devuelve algo
      // no vacío (el grupo capturado exige al menos 1 carácter), así que no
      // hace falta un segundo check de "¿quedó vacío?" aquí — deliberado: la
      // review round 3 tenía un `if (!trimmed) return ''` justo después de su
      // paso de guion bajo que se saltaba el aviso de "token vacío" (una
      // celda de solo guiones bajos desaparecía sin avisar, a diferencia de
      // "???", que sí avisaba). Al no haber un segundo punto de retorno
      // temprano, TODO camino hacia un token vacío pasa por el único chequeo
      // de más abajo (`if (!token && emptyWarnings)`), sea cual sea el motivo.
      const afterUnderscore = stripPairedUnderscore(trimmedPiece)
      let token
      if (!ownPrefix) {
        token = normalizeToken(afterUnderscore)
      } else {
        const { token: t, mismatched } = stripColumnPrefix(afterUnderscore, ownPrefix, otherPrefix)
        if (mismatched && warnings) {
          warnings.push({ column: columnLabel, n, raw: afterUnderscore, otherPrefix })
        }
        token = normalizeToken(t)
      }
      if (!token && emptyWarnings) {
        emptyWarnings.push({ column: columnLabel, n, raw: afterUnderscore })
      }
      return token
    })
    .filter(Boolean)
}

// analyzeSlicesTable: el parseo real, con reporte enriquecido de todo lo que
// antes se perdía en silencio (F1/F2 y la review posterior de ambos). Forma
// del reporte:
//   - tableFound: se localizó una cabecera de tabla §9.
//   - pipeRowsFound: había al menos una línea de tabla markdown ("|...")
//     en el documento, la matcheara o no como cabecera de slices — permite
//     distinguir "no hay ninguna tabla en el spec" de "hay tabla(s), pero
//     ninguna con cabecera Slice/Dep" (mensajes de error distintos).
//   - missingRequiredColumns / missingOptionalColumns: columnas ausentes en
//     la CABECERA (ver detalle en el código de más abajo).
//   - totalDataRows: filas de datos vistas (no separador), en todo el bloque
//     de la tabla (incluyendo las que aparecen después de un hueco).
//   - rowsAfterGap: filas de datos que aparecen después de una línea sin
//     "|" (blanco u otro texto) dentro del bloque de la tabla — antes se
//     truncaba ahí en silencio (review de F1, punto 3).
//   - skippedRows: filas cuyo "#" no es un entero a secas.
//   - invalidRows: filas con la celda "Entrega" vacía (o con un marcador de
//     "sin valor" como "–"), o con un número de celdas distinto al de la
//     cabecera (de menos o de más — un "|" sin escapar desplaza columnas) —
//     mismo resultado observable que "falta la columna Entrega", pero por
//     fila (review de F1, punto 4; review round 2, puntos a/b). No se
//     agregan a `slices`.
//   - malformedDepRows: filas cuya celda "Dep" tiene contenido real (no
//     "vacío" según isNoValueCell) pero de la que no se extrajo ninguna
//     referencia "#N" (F2).
//   - invalidDepRefs: referencias "#N" en Dep que apuntan a un slice que no
//     existe en la tabla, o al propio slice (auto-referencia, nunca
//     legítima) — review de F1, punto 5.
//   - prefixWarnings: valores de Área/Toca con el prefijo de LA OTRA
//     columna — se usó el valor, pero se señala para revisión.
//   - emptyTokenWarnings: valores de Área/Toca que, tras normalizar, quedan
//     vacíos — se descartan, pero se avisa (review de F1, punto 6).
//   - slices: Slice[] — el mismo array que devolvía `parseSlices` antes.
export function analyzeSlicesTable(specMd) {
  const lines = (specMd || '').split('\n')
  // localizar el header de la tabla: fila con celdas que incluyen "Slice" y "Dep"
  let headerIdx = -1
  let pipeRowsFound = false
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('|')) continue
    pipeRowsFound = true
    const cells = splitRow(lines[i]).map((c) => c.toLowerCase())
    if (cells.some((c) => c.includes('slice')) && cells.some((c) => c === 'dep' || c.includes('dep'))) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) {
    return {
      tableFound: false,
      pipeRowsFound,
      missingRequiredColumns: [],
      missingOptionalColumns: [],
      totalDataRows: 0,
      rowsAfterGap: [],
      skippedRows: [],
      invalidRows: [],
      prefixWarnings: [],
      malformedDepRows: [],
      invalidDepRefs: [],
      emptyTokenWarnings: [],
      slices: [],
    }
  }
  // .normalize('NFC') ANTES de comparar: un header con tildes escrito/guardado
  // en forma NFD (p.ej. "Área" como 'A' + acento agudo combinante U+0301, en
  // vez del carácter precompuesto 'Á' U+00C1) es una cadena JS distinta
  // byte-a-byte de la forma NFC — ninguna de las dos `.includes()` de
  // colAny() (que compara contra los literales NFC 'área'/'area' de este
  // fichero) haría match, y la columna Área se perdería en silencio: exacto
  // el modo de fallo silencioso que esta feature (T14/W-A) viene a eliminar.
  // NFC es la forma que usan los literales de este fichero fuente, así que
  // normalizamos el header hacia ella (no al revés).
  const header = splitRow(lines[headerIdx]).map((c) => c.normalize('NFC').toLowerCase())
  const col = (needle) => header.findIndex((c) => c.includes(needle))
  // colAny: como col(), pero acepta varias grafías del mismo encabezado.
  // "Área" es la grafía "canónica" del spec, pero un autor humano puede
  // teclear la variante sin tilde "Area" — ambas deben resolver a la misma
  // columna. No colisiona con ninguna otra cabecera existente: "area"/"área"
  // no es substring de slice/tipo/entrega/dep/acepta/protegido/toca, y
  // ninguna de esas es substring de "área"/"area" tampoco.
  const colAny = (...needles) => header.findIndex((c) => needles.some((n) => c.includes(n)))
  const iN = col('#'), iIssue = col('slice'), iType = col('tipo'), iEntrega = col('entrega'),
        iDep = col('dep'), iAc = col('acepta'), iProt = col('protegido'),
        iArea = colAny('área', 'area'), iToca = colAny('toca')

  const missingRequiredColumns = []
  if (iN === -1) missingRequiredColumns.push('#')
  if (iEntrega === -1) missingRequiredColumns.push('Entrega')

  const missingOptionalColumns = []
  if (iType === -1) missingOptionalColumns.push('Tipo')
  if (iAc === -1) missingOptionalColumns.push('Acepta')
  if (iProt === -1) missingOptionalColumns.push('Protegido')
  if (iArea === -1) missingOptionalColumns.push('Área')
  if (iToca === -1) missingOptionalColumns.push('Toca')

  const slices = []
  const skippedRows = []
  const invalidRows = []
  const prefixWarnings = []
  const malformedDepRows = []
  const emptyTokenWarnings = []
  const rowsAfterGap = []
  let totalDataRows = 0
  let hitGap = false
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()
    if (HEADING_RE.test(trimmed)) break // nueva sección markdown: fin real del bloque de la tabla
    if (!trimmed.startsWith('|')) {
      // Línea en blanco (u otro texto) dentro del bloque de la tabla: NO
      // corta el escaneo (review de F1, punto 3) — solo marca que, si
      // aparecen más filas de datos después, hay que reportarlo.
      hitGap = true
      continue
    }
    if (SEPARATOR_RE.test(raw)) continue // fila separadora |---|

    // IMPORTANTE (review round 2): HEADING_RE (solo headings ATX "## ...")
    // es demasiado estrecho para decidir "fin del bloque de la tabla §9" —
    // una regla horizontal ("---"), un heading setext ("Riesgos" +
    // subrayado "-------"), un pseudo-heading en negrita ("**10.
    // Riesgos**") o un "##10." sin espacio son markdown perfectamente
    // corriente y ninguno matchea HEADING_RE; sin este check, el escaneo
    // post-hueco los trataría como más líneas de gap y acabaría arrastrando
    // la tabla de OTRA sección, abortando con un ejemplo de la fila
    // equivocada y un consejo ("une las filas en un solo bloque") que no
    // aplica. Arreglo barato que conserva el true positive: tras un hueco,
    // si esta fila con "|" está seguida INMEDIATAMENTE de una fila
    // separadora, es la cabecera de una tabla NUEVA (toda tabla markdown
    // válida tiene su separador justo después de su cabecera) — se corta el
    // escaneo aquí sin contar nada de esta fila en adelante. Una fila de
    // continuación de LA MISMA tabla (el caso real) nunca está seguida de
    // un separador nuevo.
    if (hitGap && SEPARATOR_RE.test(lines[i + 1] ?? '')) break

    // A partir de aquí: fila de datos real.
    totalDataRows++
    if (hitGap) rowsAfterGap.push({ raw: trimmed })
    const cells = splitRow(raw)
    const nCellRaw = iN === -1 ? '' : (cells[iN] || '').trim()
    if (!PLAIN_INT_RE.test(nCellRaw)) {
      skippedRows.push({ raw: trimmed, value: nCellRaw })
      continue
    }
    const n = parseInt(nCellRaw, 10)

    // Punto 4 de la review de F1: antes solo se validaba la CABECERA, nunca
    // las celdas. Una fila con menos celdas que la cabecera (típicamente
    // porque le faltan celdas finales), o con "Entrega" vacía, produce
    // exactamente el mismo resultado observable que "falta la columna
    // Entrega entera" (un issue titulado "#N" a secas, sin AC ni deps) —
    // solo que por fila. Se reporta y NO se agrega a `slices`: no hay
    // título de issue fiable que construir con esta fila.
    //
    // Punto (a) de la review round 2: una fila con MÁS celdas que la
    // cabecera (típicamente un "|" sin escapar dentro de una celda) desplaza
    // las columnas siguientes en silencio — "med | icacion | pbx" sobre una
    // cabecera de 9 columnas produce area:['med'], touches:['icacion'], y
    // "pbx" se pierde sin que nadie lo note. Antes solo se comprobaba
    // `cells.length < header.length`; ahora cualquier discrepancia (`!==`)
    // se trata igual.
    const rowLengthMismatch = cells.length !== header.length
    const entregaCellRaw = iEntrega === -1 ? undefined : cells[iEntrega]
    const entregaTrimmed = entregaCellRaw === undefined ? '' : entregaCellRaw.trim()
    // Punto (b) de la review round 2: "Entrega" con un marcador de "sin
    // valor" (–, -, —, etc. — ver isNoValueCell, ya usado en Dep/Acepta/
    // Área/Toca) producía un issue titulado "#1 –", exit 0. Entrega es la
    // única columna donde el contenido es obligatorio (sin ella no hay
    // título de issue); tratar "aquí no hay nada" como si fuera un título
    // válido era la excepción injustificada al propio estándar de este
    // cambio.
    const entregaEmpty = iEntrega !== -1 && (entregaCellRaw === undefined || entregaTrimmed === '' || isNoValueCell(entregaTrimmed))
    if (rowLengthMismatch || entregaEmpty) {
      invalidRows.push({
        n,
        reason: rowLengthMismatch
          ? `la fila tiene ${cells.length} celda(s), la cabecera tiene ${header.length}` +
            (cells.length > header.length ? ' (revisa si hay un "|" sin escapar dentro de una celda)' : '')
          : 'la columna "Entrega" está vacía (o trae un marcador de "sin valor" como "–")',
      })
      continue
    }

    const depCell = (cells[iDep] || '').trim()
    const deps = []
    let m
    DEP_RE.lastIndex = 0
    while ((m = DEP_RE.exec(depCell)) !== null) deps.push(parseInt(m[1], 10))
    // F2: "Dep" con contenido real (no un marcador de "sin valor" — ver
    // isNoValueCell/NO_VALUE_MARKERS, que ahora incluye el em dash) del que
    // no se extrajo ninguna "#N" — p.ej. "S1" en vez de "#1" — es una celda
    // malformada, no una fila sin dependencias. El disparador es "0 deps
    // extraídas de una celda con contenido": texto legítimo alrededor de
    // una referencia válida (p.ej. "#1 (tras el merge)") sigue extrayendo
    // su "#1" y NO cuenta como malformada.
    if (depCell && !isNoValueCell(depCell) && deps.length === 0) {
      malformedDepRows.push({ n, raw: depCell })
    }
    const acCell = (cells[iAc] || '').trim()
    const ac = acCell && !isNoValueCell(acCell) ? acCell.split(',').map((x) => x.trim()).filter(Boolean) : []
    const issueCell = (cells[iIssue] || '').trim()
    const issueMatch = issueCell.match(/#(\d+)/)
    slices.push({
      n,
      issue: issueMatch ? `#${issueMatch[1]}` : null,
      type: (cells[iType] || '').trim(),
      entrega: (cells[iEntrega] || '').trim(),
      deps,
      ac,
      protected: (cells[iProt] || '').trim(),
      area: parseTokenList(cells[iArea], { ownPrefix: 'area', otherPrefix: 'touches', columnLabel: 'Área', n, warnings: prefixWarnings, emptyWarnings: emptyTokenWarnings }),
      touches: parseTokenList(cells[iToca], { ownPrefix: 'touches', otherPrefix: 'area', columnLabel: 'Toca', n, warnings: prefixWarnings, emptyWarnings: emptyTokenWarnings }),
    })
  }

  // Punto 5 de la review de F1: las deps no se contrastaban contra los
  // slices que existen de verdad. "#99" en una tabla de 2 slices, o "#3" en
  // el propio slice 3 (auto-referencia, nunca legítima), parseaban sin
  // problema y llegarían a GitHub como `merge-after` — un grafo equivocado
  // escrito en los issues. Se valida aquí, una vez conocido el conjunto
  // completo de órdenes `n` que sí se parsearon.
  const knownOrders = new Set(slices.map((s) => s.n))
  const invalidDepRefs = []
  for (const s of slices) {
    for (const d of s.deps) {
      if (d === s.n) invalidDepRefs.push({ n: s.n, dep: d, reason: 'self' })
      else if (!knownOrders.has(d)) invalidDepRefs.push({ n: s.n, dep: d, reason: 'unknown' })
    }
  }

  return {
    tableFound: true,
    pipeRowsFound,
    missingRequiredColumns,
    missingOptionalColumns,
    totalDataRows,
    rowsAfterGap,
    skippedRows,
    invalidRows,
    prefixWarnings,
    malformedDepRows,
    invalidDepRefs,
    emptyTokenWarnings,
    slices,
  }
}

// parseSlices: contrato viejo preservado (md) -> Slice[]. Se mantiene solo
// por compatibilidad de contrato (varios tests, y en su momento otros
// módulos, dependían de esta firma exacta); a día de hoy no tiene ningún
// llamante en producción — ct-groom.mjs usa `analyzeSlicesTable` para poder
// validar antes de tocar GitHub. Quien necesite el reporte de validación
// (filas descartadas, columnas ausentes, avisos de prefijo/token vacío,
// referencias de Dep inválidas, huecos en la tabla) usa
// `analyzeSlicesTable` en su lugar.
export function parseSlices(specMd) {
  return analyzeSlicesTable(specMd).slices
}
