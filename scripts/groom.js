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

export function buildIssueBody(slice, { specPath, specSection }) {
  const lines = []
  lines.push(`> Slice #${slice.n} del epic. Spec: [${specPath}#${specSection}](${specPath}#${specSection})`)
  lines.push('')
  // F3: "Entrega" ya no alimenta el título (ver buildIssueTitle) — pasa a
  // ser una descripción OPCIONAL del cuerpo. Va aquí, justo debajo del link
  // al spec y ANTES de "Acceptance criteria": quien abre el issue lee
  // primero QUÉ entrega el slice, y solo después sus criterios de
  // aceptación — el orden de lectura natural (qué, luego cómo se verifica).
  // Mismo criterio de "sin valor" que Protegido (isNoValueCell): una celda
  // vacía, ausente, o con un marcador como "–" no produce ninguna sección
  // (nada que describir, no un placeholder vacío).
  if (slice.entrega && !isNoValueCell(slice.entrega)) {
    lines.push('## Descripción')
    lines.push(slice.entrega)
    lines.push('')
  }
  lines.push('## Acceptance criteria (EARS, 1:1 con tests)')
  const ac = slice.ac || []
  if (ac.length) for (const a of ac) lines.push(`- ${a}`)
  else lines.push('- (rellenar desde el spec)')
  lines.push('')
  const deps = slice.deps || []
  if (deps.length) {
    lines.push('## Dependencias')
    for (const d of deps) lines.push(`- merge-after #${d}`)
    lines.push('')
  }
  lines.push('## Out of scope / Protected')
  // Fix de review (F2): antes solo trataba el em dash literal ('–', U+2013)
  // como "sin valor" — las otras variantes que isNoValueCell ya acepta en
  // TODAS las demás columnas (Dep/Acepta/Área/Toca: '-', '—', '―', '−',
  // '--') colaban como si fueran contenido real, produciendo un bullet
  // basura ("- 🚫 -") en el body de CADA issue con esa variante. Mismo
  // criterio de "sin valor" que las demás columnas, sin excepción.
  lines.push(slice.protected && !isNoValueCell(slice.protected) ? `- 🚫 ${slice.protected}` : '- (ninguno declarado)')
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

export function groomPlan(slices, { milestone, specPath, specSection }) {
  const dupes = findDuplicateOrders(slices)
  if (dupes.length) {
    throw new Error(`groomPlan: orden(es) de slice duplicado(s) en la tabla §9: ${dupes.join(', ')}`)
  }
  return {
    milestone,
    issues: slices.map((s) => ({
      order: s.n,
      title: buildIssueTitle(s),
      body: buildIssueBody(s, { specPath, specSection }),
      labels: buildLabels(s),
      deps: s.deps,
    })),
  }
}
