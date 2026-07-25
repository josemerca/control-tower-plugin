// Parseo puro de la tabla §9 "Desglose en slices" de un spec markdown.
const DEP_RE = /#(\d+)/g

function splitRow(line) {
  // "| a | b |" -> ["a","b"] (quita bordes y trim)
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
}

// normalizeToken: token crudo de celda Área/Toca -> token "label-safe" para
// componer `area:<token>`/`touches:<token>` (T14/W-A). Decisión de
// normalización (documentada en el informe de la tarea): trim + lowercase +
// se descartan silenciosamente los caracteres que no sean letra/dígito
// unicode, espacio, guion, guion bajo, `/`, `.` o `+` — en particular `:`
// (separador de prefijo `area:`/`touches:` que usa buildLabels en groom.js) y
// `,` (separador de tokens dentro de la propia celda, ver parseTokenList) se
// eliminan en vez de intentar escaparlos, para que el token resultante nunca
// pueda reintroducir ambigüedad en ninguno de los dos parseos que lo
// consumen. Los espacios SÍ se preservan (GitHub permite labels con espacios,
// p.ej. "good first issue"), solo se colapsan las corridas internas a uno.
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
function parseTokenList(cell) {
  const raw = (cell || '').trim()
  if (!raw || raw === '–' || raw === '-') return []
  return raw.split(',').map(normalizeToken).filter(Boolean)
}

export function parseSlices(specMd) {
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
  if (headerIdx === -1) return []
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

  const out = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim().startsWith('|')) break // fin de tabla
    if (/^\s*\|[\s:|-]+\|\s*$/.test(raw)) continue // fila separadora |---|
    const cells = splitRow(raw)
    const n = parseInt(cells[iN], 10)
    if (Number.isNaN(n)) continue
    const depCell = (cells[iDep] || '').trim()
    const deps = []
    let m
    while ((m = DEP_RE.exec(depCell)) !== null) deps.push(parseInt(m[1], 10))
    const acCell = (cells[iAc] || '').trim()
    const ac = acCell && acCell !== '–' && acCell !== '-' ? acCell.split(',').map((x) => x.trim()).filter(Boolean) : []
    const issueCell = (cells[iIssue] || '').trim()
    const issueMatch = issueCell.match(/#(\d+)/)
    out.push({
      n,
      issue: issueMatch ? `#${issueMatch[1]}` : null,
      type: (cells[iType] || '').trim(),
      entrega: (cells[iEntrega] || '').trim(),
      deps,
      ac,
      protected: (cells[iProt] || '').trim(),
      area: parseTokenList(cells[iArea]),
      touches: parseTokenList(cells[iToca]),
    })
  }
  return out
}
