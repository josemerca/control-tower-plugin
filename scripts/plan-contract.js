// ============================================================================
// PLAN-CONTRACT — el contrato del plan prescriptivo de un slice.
//
// El plan que escribe el agente despachado (writing-plans-prescriptive) es el
// artefacto que cruza la frontera hacia los subagentes por task: si miente
// —secciones que faltan, código citado de memoria que no existe en el repo,
// placeholders sin rellenar— los subagentes lo ejecutan igual, porque no
// tienen contexto para dudar. Este módulo convierte ese contrato de prosa en
// comprobación, con la misma doctrina que el resto del plugin: una
// comprobación que solo imprime no es una comprobación.
//
// La pieza que no tiene equivalente en ningún otro sitio del plugin es la
// LITERALIDAD: cada bloque `Current state (path):` del plan debe existir
// verbatim en el fichero que cita. Es el detector de código citado de
// memoria — el modo de fallo número uno de un plan escrito por un agente.
//
// Módulo PURO a propósito (misma razón que gates.js/slices.js): toda la
// lógica es testeable sin harness; el I/O entra por inyección (`readFile`) y
// quien lo cablea (dispatch-check.mjs) aporta el filesystem real.
// ============================================================================

const BLOCKQUOTE_MARKER = 'This plan is written to be executed by task-scoped subagents'

export const PLAN_SECTIONS = [
  '## 1. Context and goal',
  '## 2. Closed decisions',
  '## 3. Reference patterns',
  '## 4. Inventory',
  '## 5. Interfaces',
  '## 6. Test strategy',
  '## 7. Tasks',
  '## 8. Global verification',
  '## 9. Assumptions',
]

const SUBSECTIONS = ['### Desired end state', '### Out of scope']

const TASK_MARKERS = ['**Objective:**', '**Files:**', '**TDD:**', '**Tests:**', '**Verification:**']

// Tokens que delatan una decisión abierta o un placeholder. Solo se buscan
// FUERA de los bloques de código: un plan puede citar legítimamente un
// fichero cuyo contenido diga cualquiera de estas cosas.
const FORBIDDEN = [
  [/\bTBD\b/, 'TBD'],
  [/TODO:/, 'TODO:'],
  [/\bFIXME\b/, 'FIXME'],
  [/similar to Task/i, '"similar to Task N" (repite el contenido)'],
  [/to be decided/i, '"to be decided"'],
  [/<!--/, 'comentario HTML sin resolver'],
  [/(^|[^$])\{\{/, 'placeholder {{...}} sin rellenar'],
]

const TASK_HEADING = /^### Task (\d+) — /
const CURRENT_STATE = /^Current state \(([^),]+)(?:,[^)]*)?\):\s*$/

// Anota cada línea con si es estructural (fuera de fence) — el único parseo
// de markdown que este contrato necesita. Un fence abre y cierra con una
// línea que EMPIEZA por tres backticks, como en el resto de parsers del repo.
function annotate(markdown) {
  const out = []
  let inFence = false
  for (const line of String(markdown).split('\n')) {
    if (line.startsWith('```')) {
      out.push({ line, structural: false, fence: true, opens: !inFence })
      inFence = !inFence
      continue
    }
    out.push({ line, structural: !inFence, fence: false, opens: false })
  }
  return out
}

function fenceBodyAfter(lines, from) {
  let i = from
  while (i < lines.length && lines[i].line.trim() === '') i++
  if (i >= lines.length || !lines[i].fence || !lines[i].opens) return null
  const body = []
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].fence) return body.join('\n')
    body.push(lines[j].line)
  }
  return null
}

export function validatePlan(markdown, { readFile } = {}) {
  const violations = []
  const push = (rule, detail) => violations.push({ rule, detail })
  const lines = annotate(markdown)

  if (!lines.length || !lines[0].line.startsWith('# ')) {
    push('title', 'la primera línea debe ser el título: "# <issue> — <qué>"')
  }
  if (!lines.some((l) => l.structural && l.line.includes(BLOCKQUOTE_MARKER))) {
    push('header', `falta el blockquote de cabecera (debe contener: "${BLOCKQUOTE_MARKER}")`)
  }

  let prev = -1
  for (const section of PLAN_SECTIONS) {
    const at = lines.findIndex((l) => l.structural && l.line.startsWith(section))
    if (at === -1) { push('sections', `falta la sección "${section}" (si no aplica: "N/A — <reason>")`); continue }
    if (at < prev) push('sections', `sección fuera de orden: "${section}"`)
    prev = at
  }
  for (const sub of SUBSECTIONS) {
    if (!lines.some((l) => l.structural && l.line.startsWith(sub))) {
      push('sections', `falta la subsección "${sub}" dentro de "## 1. Context and goal"`)
    }
  }

  const decisionsAt = lines.findIndex((l) => l.structural && l.line.startsWith('## 2. Closed decisions'))
  if (decisionsAt !== -1) {
    let rows = 0
    for (let i = decisionsAt + 1; i < lines.length; i++) {
      if (lines[i].structural && lines[i].line.startsWith('## ')) break
      if (lines[i].structural && lines[i].line.startsWith('|')) rows++
    }
    if (rows < 3) push('decisions', 'la tabla de "Closed decisions" está vacía (cabecera + separador + al menos 1 fila)')
  }

  const tasks = []
  lines.forEach((l, i) => {
    if (!l.structural) return
    const m = TASK_HEADING.exec(l.line)
    if (m) tasks.push({ n: parseInt(m[1], 10), name: l.line, at: i })
  })
  if (!tasks.length) push('tasks', 'no hay ninguna "### Task N — <name>"')
  tasks.forEach((t, idx) => {
    if (t.n !== idx + 1) push('tasks', `numeración no consecutiva: esperaba Task ${idx + 1} y encontré "${t.name}"`)
    const end = idx + 1 < tasks.length ? tasks[idx + 1].at : lines.length
    let boundary = end
    for (let i = t.at + 1; i < end; i++) {
      if (lines[i].structural && lines[i].line.startsWith('## ')) { boundary = i; break }
    }
    const block = lines.slice(t.at + 1, boundary)
    for (const marker of TASK_MARKERS) {
      if (!block.some((l) => l.structural && l.line.includes(marker))) {
        push('tasks', `${t.name}: falta ${marker}`)
      }
    }
    if (!block.some((l) => l.fence)) push('tasks', `${t.name}: no contiene ningún bloque de código`)
  })

  lines.forEach((l, i) => {
    if (!l.structural) return
    for (const [re, label] of FORBIDDEN) {
      if (re.test(l.line)) push('placeholders', `línea ${i + 1}: token prohibido (${label})`)
    }
  })

  lines.forEach((l, i) => {
    if (!l.structural) return
    const m = CURRENT_STATE.exec(l.line)
    if (!m) return
    const path = m[1].trim()
    const body = fenceBodyAfter(lines, i + 1)
    if (body === null) { push('literality', `"Current state (${path})" sin bloque de código a continuación`); return }
    if (!readFile) return
    let real
    try {
      real = readFile(path)
    } catch (e) {
      push('literality', `no se pudo leer "${path}" para comprobar la cita: ${e.message}`)
      return
    }
    if (!String(real).includes(body)) {
      push('literality', `el bloque "Current state (${path})" NO existe verbatim en ese fichero — cita de memoria`)
    }
  })

  return { ok: violations.length === 0, violations }
}

export function planFilesForIssue(issue, paths) {
  const needle = `issue-${issue}-`
  return (paths || []).filter(
    (p) => p.startsWith('docs/superpowers/plans/') && p.endsWith('.md') && p.includes(needle),
  )
}

// checkPlans: la decisión entera del gate, pura. `candidates` es la lista de
// rutas donde buscar el plan (en --release, los ficheros que la rama
// INTRODUCE; en --check-plan, el contenido del directorio de planes). El
// mensaje devuelto es prosa terminada, con remedio — quien lo recibe solo lo
// imprime por stderr y sale con `code`.
export function checkPlans({ issue, candidates, readFile }) {
  const files = planFilesForIssue(issue, candidates)
  if (!files.length) {
    return {
      ok: false,
      code: 6,
      files,
      message:
        `no hay ningún plan prescriptivo para #${issue} entre los candidatos: falta un ` +
        `docs/superpowers/plans/YYYY-MM-DD-issue-${issue}-<slug>.md. Escríbelo con ` +
        `control-tower-loop:writing-plans-prescriptive, valídalo con --check-plan y commitéalo ` +
        `(viaja en el PR). Si ya existe en tu árbol de trabajo pero no está commiteado, commitéalo.`,
    }
  }
  for (const file of files) {
    let content
    try {
      content = readFile(file)
    } catch (e) {
      return {
        ok: false,
        code: 6,
        files,
        message: `no se ha podido leer ${file} (${e.message}) — no se afirma que el plan sea inválido, pero tampoco se puede comprobar. Arregla la lectura y reintenta.`,
      }
    }
    const result = validatePlan(content, { readFile })
    if (!result.ok) {
      const detail = result.violations.map((v) => `  - [${v.rule}] ${v.detail}`).join('\n')
      return {
        ok: false,
        code: 6,
        files,
        message: `${file} no cumple el contrato del plan (plan-contract.js):\n${detail}\nCorrige el plan, re-valida con --check-plan y vuelve a intentarlo.`,
      }
    }
  }
  return { ok: true, code: 0, files, message: `plan ok: ${files.join(', ')} cumple el contrato` }
}
