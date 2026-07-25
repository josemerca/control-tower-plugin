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

export function buildCmuxArgv({ name, cwd, command, env }) {
  const argv = ['new-workspace']
  if (name) argv.push('--name', name)
  if (cwd) argv.push('--cwd', cwd)
  // --env es REPETIBLE y viaja dentro del PROTOCOLO de cmux (el cliente CLI
  // habla por socket Unix con un daemon YA EN MARCHA) — a diferencia de
  // `execFileSync('cmux', argv, { env })`, que solo fija el entorno del
  // propio proceso cliente de cmux (muere en cuanto envía la petición): el
  // pty real lo crea el daemon, que lleva corriendo desde antes con SU
  // PROPIO entorno fijado en su arranque, así que un env var puesto en el
  // cliente nunca llega al pty. Hay que pedírselo al daemon explícitamente
  // con --env KEY=VALUE. Confirmado en vivo contra el sandbox real (T10):
  // sin esto, la sesión se queda colgada en el selector interactivo de
  // cuenta de claude-account-picker (espera un humano tecleando 1/2 en
  // /dev/tty) en vez de arrancar ya con CLAUDE_CONFIG_DIR resuelto.
  if (env) for (const [k, v] of Object.entries(env)) argv.push('--env', `${k}=${v}`)
  if (command) argv.push('--command', command)
  return argv
}
