// Parseo puro de la tabla §9 "Desglose en slices" de un spec markdown.
const DEP_RE = /#(\d+)/g

function splitRow(line) {
  // "| a | b |" -> ["a","b"] (quita bordes y trim)
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
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
  const header = splitRow(lines[headerIdx]).map((c) => c.toLowerCase())
  const col = (needle) => header.findIndex((c) => c.includes(needle))
  const iN = col('#'), iIssue = col('slice'), iType = col('tipo'), iEntrega = col('entrega'),
        iDep = col('dep'), iAc = col('acepta'), iProt = col('protegido')

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
    })
  }
  return out
}
