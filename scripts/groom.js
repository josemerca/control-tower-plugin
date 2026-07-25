// Lógica pura de grooming: de Slice[] (T1) a un plan de operaciones GitHub.
export function buildIssueTitle(slice) {
  return `#${slice.n} ${slice.entrega}`.trim()
}

export function buildLabels(slice) {
  const labels = []
  // Omit empty type to avoid emitting garbage literal "type:" to GitHub
  if (slice.type) labels.push(`type:${slice.type}`)
  labels.push('status:backlog')
  return labels
}

export function buildIssueBody(slice, { specPath, specSection }) {
  const lines = []
  lines.push(`> Slice #${slice.n} del epic. Spec: [${specPath}#${specSection}](${specPath}#${specSection})`)
  lines.push('')
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
  lines.push(slice.protected && slice.protected !== '–' ? `- 🚫 ${slice.protected}` : '- (ninguno declarado)')
  lines.push('')
  lines.push(`<!-- ct-order:${slice.n} -->`) // marcador greppable de orden para el dispatcher
  return lines.join('\n')
}

export function groomPlan(slices, { milestone, specPath, specSection }) {
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
