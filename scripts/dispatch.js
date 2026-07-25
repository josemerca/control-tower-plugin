// Lógica pura del dispatcher: selección de slices, account map, argv de cmux.
export const SERIALIZING_TOUCHES = ['migration', 'ci', 'pbxproj']

export function selectNext(issues, { mergedIssues = [], runningTouches = [], concurrencyCap = 1 } = {}) {
  const merged = new Set(mergedIssues)
  const claimedTouches = new Set(runningTouches)
  const hasSerializingTouchInRunning = runningTouches.some((t) => SERIALIZING_TOUCHES.includes(t))
  const ready = issues
    .filter((i) => i.status === 'ready')
    .filter((i) => (i.deps || []).every((d) => merged.has(d)))
    .sort((a, b) => a.order - b.order)

  const selected = []
  let hasSerializingInBatch = hasSerializingTouchInRunning
  for (const i of ready) {
    if (selected.length >= concurrencyCap) break
    const touches = i.touches || []
    // colisión con lo ya corriendo o ya seleccionado esta tanda
    if (touches.some((t) => claimedTouches.has(t))) continue
    // serialización: solo un touches serializante por tanda (incluye los ya corriendo)
    const hasSerializingTouch = touches.some((t) => SERIALIZING_TOUCHES.includes(t))
    if (hasSerializingTouch && hasSerializingInBatch) continue
    selected.push(i)
    touches.forEach((t) => claimedTouches.add(t))
    if (hasSerializingTouch) hasSerializingInBatch = true
  }
  return selected
}

export function resolveAccount(repo, map) {
  if ((map.work || []).some((r) => repo === r || repo.startsWith(r))) return map.workDir
  if ((map.personal || []).some((r) => repo === r || repo.startsWith(r))) return map.personalDir
  return map.personalDir
}

export function buildCmuxArgv({ name, cwd, command }) {
  const argv = ['new-workspace']
  if (name) argv.push('--name', name)
  if (cwd) argv.push('--cwd', cwd)
  if (command) argv.push('--command', command)
  return argv
}
