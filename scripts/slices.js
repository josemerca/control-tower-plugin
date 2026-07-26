// Parseo puro de la tabla §9 "Desglose en slices" de un spec markdown.
const DEP_RE = /#(\d+)/g
// PLAIN_INT_RE: el `#` de cada fila debe ser un entero a secas ("1", "23"),
// nunca "S1" (letra de prefijo humano), "**1**" (negrita markdown) ni "1a"
// (basura de cola). `parseInt` a secas es demasiado permisivo — acepta
// "1abc" -> 1 y "S1" -> NaN de forma inconsistente, y NaN se descartaba en
// silencio (F1, defecto 1: la fila entera desaparecía sin dejar rastro). Con
// este regex, cualquier "#" que no sea dígitos puros se reporta como fila
// no-parseable en vez de perderse.
const PLAIN_INT_RE = /^\d+$/

function splitRow(line) {
  // "| a | b |" -> ["a","b"] (quita bordes y trim)
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
}

// stripBackticks: `` `area:medicacion` `` -> "area:medicacion". Un autor
// humano envuelve el valor en backticks porque literalmente se le pide una
// label de GitHub y así es como se escriben en markdown. Si esto no se
// resuelve ANTES de buscar el prefijo de columna (stripColumnPrefix), el
// `:` seguiría ahí en el punto de decisión y el strip de prefijo no
// dispararía; hacerlo aquí, antes, es lo que permite que el valor
// backtick-envuelto y el valor pelado terminen en el mismo token.
function stripBackticks(raw) {
  const s = raw.trim()
  if (s.length >= 2 && s.startsWith('`') && s.endsWith('`')) return s.slice(1, -1).trim()
  return s
}

// stripColumnPrefix (F1, defecto 2): a la columna Área/Toca se le está
// pidiendo un token ("medicacion"), pero el error natural de un autor humano
// es escribir la label completa ("area:medicacion") porque es lo que ve en
// la UI de GitHub. Sin este strip, normalizeToken se limita a borrar el `:`
// (no es un carácter "label-safe") y el resultado es "areamedicacion", que
// buildLabels (groom.js) vuelve a prefijar como "area:areamedicacion" —
// prefijo duplicado, label basura creada de verdad en el repo (`gh label
// create --force` no rechaza nada).
//
// Si el prefijo encontrado es el de la OTRA columna (p.ej. "area:" dentro de
// Toca) se decide TOLERAR igual, no rechazar ni abortar: es información real
// que el autor sí quiso dar (probablemente confundió en qué columna iba, o
// copió/pegó desde la columna de al lado), y descartarla sería reintroducir
// exactamente el tipo de pérdida silenciosa que esta tarea existe para
// eliminar. Se marca con `mismatched: true` para que el llamador lo
// reporte como aviso (no error) — el valor se usa, pero el autor debe poder
// verlo señalado para corregir la columna si fue un despiste.
function stripColumnPrefix(raw, ownPrefix, otherPrefix) {
  const cleaned = stripBackticks(raw)
  const lower = cleaned.toLowerCase()
  const ownMarker = `${ownPrefix}:`
  if (lower.startsWith(ownMarker)) {
    return { token: cleaned.slice(ownMarker.length), mismatched: false }
  }
  if (otherPrefix) {
    const otherMarker = `${otherPrefix}:`
    if (lower.startsWith(otherMarker)) {
      return { token: cleaned.slice(otherMarker.length), mismatched: true }
    }
  }
  return { token: cleaned, mismatched: false }
}

// normalizeToken: token crudo (ya sin backticks/prefijo de columna) -> token
// "label-safe" para componer `area:<token>`/`touches:<token>` (T14/W-A).
// Decisión de normalización (documentada en el informe de la tarea): trim +
// lowercase + se descartan silenciosamente los caracteres que no sean
// letra/dígito unicode, espacio, guion, guion bajo, `/`, `.` o `+` — en
// particular `:` (separador de prefijo `area:`/`touches:` que usa
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
// "vacío" que la columna Acepta ya usaba (–, -, o celda vacía -> []).
// Column-aware (F1): con `ownPrefix`/`otherPrefix` tolera que la celda traiga
// el prefijo de label completo en vez del token pelado (ver
// stripColumnPrefix). Cuando el prefijo encontrado es el de la otra columna,
// empuja un registro a `warnings` (mutado in-place por el llamador) en vez
// de lanzar o descartar el valor.
function parseTokenList(cell, opts = {}) {
  const { ownPrefix, otherPrefix, columnLabel, n, warnings } = opts
  const raw = (cell || '').trim()
  if (!raw || raw === '–' || raw === '-') return []
  return raw
    .split(',')
    .map((piece) => {
      const trimmed = piece.trim()
      if (!trimmed) return ''
      if (!ownPrefix) return normalizeToken(trimmed)
      const { token, mismatched } = stripColumnPrefix(trimmed, ownPrefix, otherPrefix)
      if (mismatched && warnings) {
        warnings.push({ column: columnLabel, n, raw: stripBackticks(trimmed), otherPrefix })
      }
      return normalizeToken(token)
    })
    .filter(Boolean)
}

// analyzeSlicesTable: el parseo real, con reporte enriquecido de todo lo que
// antes se perdía en silencio (F1). `parseSlices` (más abajo) es un wrapper
// fino sobre esto que preserva el contrato viejo `(md) -> Slice[]` del que
// dependen otros módulos y la mayoría de los tests — no se toca esa firma,
// se añade esta como una segunda exportación con el reporte completo:
//   - tableFound: se localizó una cabecera de tabla §9 (distingue "no hay
//     tabla" de "hay tabla pero está vacía o mal formada").
//   - missingRequiredColumns: subconjunto de ['#', 'Entrega'] ausente en la
//     cabecera. Sin "#" no hay orden de slice ni se pueden resolver
//     dependencias; sin "Entrega" no hay título de issue. Se reporta para
//     que el llamador (ct-groom.mjs) pueda abortar fuerte ANTES de tocar
//     GitHub.
//   - missingOptionalColumns: subconjunto de ['Tipo','Acepta','Protegido',
//     'Área','Toca'] ausente — degrada el issue creado (sin label type:, sin
//     AC, sin sección Protegido explícita, o con la maquinaria de colisión/
//     serialización inerte) pero no impide crear issues razonables, así que
//     el llamador debe avisar y continuar, no abortar.
//   - totalDataRows: cuántas filas de datos (no separador) vio el parser,
//     independientemente de si se pudieron parsear.
//   - skippedRows: filas descartadas porque su celda "#" no es un entero a
//     secas — el defecto original (F1, defecto 1) era que estas filas
//     desaparecían con un `continue` silencioso.
//   - prefixWarnings: ocurrencias de un valor en Área/Toca con el prefijo de
//     LA OTRA columna (ver stripColumnPrefix) — se usó el valor, pero se
//     señala para revisión.
//   - slices: el mismo array que devolvía `parseSlices` antes.
export function analyzeSlicesTable(specMd) {
  const lines = (specMd || '').split('\n')
  // localizar el header de la tabla: fila con celdas que incluyen "Slice" y "Dep"
  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('|')) continue
    const cells = splitRow(lines[i]).map((c) => c.toLowerCase())
    if (cells.some((c) => c.includes('slice')) && cells.some((c) => c === 'dep' || c.includes('dep'))) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) {
    return {
      tableFound: false,
      missingRequiredColumns: [],
      missingOptionalColumns: [],
      totalDataRows: 0,
      skippedRows: [],
      prefixWarnings: [],
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
  const prefixWarnings = []
  let totalDataRows = 0
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim().startsWith('|')) break // fin de tabla
    if (/^\s*\|[\s:|-]+\|\s*$/.test(raw)) continue // fila separadora |---|
    totalDataRows++
    const cells = splitRow(raw)
    const nCellRaw = iN === -1 ? '' : (cells[iN] || '').trim()
    if (!PLAIN_INT_RE.test(nCellRaw)) {
      skippedRows.push({ raw: raw.trim(), value: nCellRaw })
      continue
    }
    const n = parseInt(nCellRaw, 10)
    const depCell = (cells[iDep] || '').trim()
    const deps = []
    let m
    DEP_RE.lastIndex = 0
    while ((m = DEP_RE.exec(depCell)) !== null) deps.push(parseInt(m[1], 10))
    const acCell = (cells[iAc] || '').trim()
    const ac = acCell && acCell !== '–' && acCell !== '-' ? acCell.split(',').map((x) => x.trim()).filter(Boolean) : []
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
      area: parseTokenList(cells[iArea], { ownPrefix: 'area', otherPrefix: 'touches', columnLabel: 'Área', n, warnings: prefixWarnings }),
      touches: parseTokenList(cells[iToca], { ownPrefix: 'touches', otherPrefix: 'area', columnLabel: 'Toca', n, warnings: prefixWarnings }),
    })
  }
  return { tableFound: true, missingRequiredColumns, missingOptionalColumns, totalDataRows, skippedRows, prefixWarnings, slices }
}

// parseSlices: contrato viejo preservado (md) -> Slice[]. Otros módulos
// (ct-groom.mjs, hasta esta tarea) y la mayoría de los tests dependen de
// esta firma exacta; no se rompe. Quien necesite el reporte de validación
// (filas descartadas, columnas ausentes, avisos de prefijo) usa
// `analyzeSlicesTable` en su lugar — ver ct-groom.mjs.
export function parseSlices(specMd) {
  return analyzeSlicesTable(specMd).slices
}
