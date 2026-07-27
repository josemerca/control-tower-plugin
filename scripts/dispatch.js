// Lógica pura del dispatcher: selección de slices, account map, argv de cmux.
export const SERIALIZING_TOUCHES = ['migration', 'ci', 'pbxproj']

// computeReadyCandidates: cómputo compartido de "qué issues están en
// status:ready" (`ready`) y, de esos, "cuáles tienen TODAS sus deps
// mergeadas" (`readyDepsMet`, ya ordenado por `order` ascendente — el mismo
// orden en que selectNext los procesa). Extraído (fix round 1 de la review
// de W-B) porque explainNoSelection re-derivaba esta misma cadena de filtros
// de forma independiente a selectNext: la sincronía entre las dos dependía
// de un comentario, no del compilador ni de un test — un cambio futuro en el
// criterio de "candidato ready" (un rename de campo, un filtro nuevo) podía
// desincronizar el explicador EN SILENCIO, dejando que afirmara con
// seguridad una causa de bloqueo equivocada. Con esta única función como
// fuente de verdad, selectNext y explainNoSelection ya no pueden divergir en
// ESTE cálculo — solo queda la posibilidad de que alguien, en el futuro,
// vuelva a inlinear el filtro en uno de los dos sitios en vez de llamar
// aquí; eso no lo detecta ningún test automatizado (sería un chequeo
// estático de "no reintroduzcas este patrón", no de comportamiento), así que
// queda documentado aquí en vez de fingido con una aserción que en realidad
// solo comprobaría esta misma función contra sí misma.
export function computeReadyCandidates(issues, mergedIssues) {
  const merged = new Set(mergedIssues)
  const ready = issues.filter((i) => i.status === 'ready')
  // D1 finding 2: `i.depsMalformed` (gh-issue-map.js#mapGhIssue) marca un
  // issue cuya sección "## Dependencias" existe pero no produjo NINGÚN
  // "merge-after #N" reconocible — casi seguro una reescritura humana, no
  // "sin dependencias". `deps` en ese caso es `[]`, así que el `.every(...)`
  // de abajo pasaría trivialmente y el issue se trataría como listo para
  // despachar (el "gate abierto en silencio" que describe el finding) si no
  // se excluyera aquí explícitamente — nunca se entra a considerarlo "deps
  // resueltas" mientras el estado real sea desconocido.
  const readyDepsMet = ready
    .filter((i) => !i.depsMalformed && (i.deps || []).every((d) => merged.has(d)))
    .sort((a, b) => a.order - b.order)
  return { ready, readyDepsMet }
}

// touchesConflict: el ÚNICO predicate de colisión de touches (fix round 2
// de la review de W-B, finding 3 — antes la regla vivía duplicada: en línea
// dentro del bucle de selectNext, y otra vez, por separado, dentro de
// collisionAgainstRunning). Decide si `touches` choca con `claimedTouches` —
// token compartido literal, o (si `hasSerializingClaimed` es cierto) por
// entrar en el grupo serializante migration/ci/pbxproj aunque el token
// exacto sea distinto. Devuelve `null` si no hay colisión, o
// `{ kind, token }` si la hay — `token` es el que usa collisionAgainstRunning
// para atribuir la colisión a un issue concreto; selectNext solo necesita
// saber si el resultado es no-null (para el `continue`) y si `touches` tenía
// algún touch serializante (para actualizar su propio estado de tanda,
// `hasSerializingInBatch` — ver más abajo, esa acumulación de estado NO se
// tocó: sigue siendo selectNext quien decide cuándo avanza, este helper solo
// centraliza el criterio "¿choca esto?", no el bucle que lo usa).
function touchesConflict(touches, claimedTouches, hasSerializingClaimed) {
  const sharedToken = touches.find((t) => claimedTouches.has(t))
  if (sharedToken) return { kind: 'token', token: sharedToken }
  const serializingTouch = touches.find((t) => SERIALIZING_TOUCHES.includes(t))
  if (serializingTouch && hasSerializingClaimed) return { kind: 'serializing', token: serializingTouch }
  return null
}

export function selectNext(issues, { mergedIssues = [], runningTouches = [], concurrencyCap = 1 } = {}) {
  const claimedTouches = new Set(runningTouches)
  const hasSerializingTouchInRunning = runningTouches.some((t) => SERIALIZING_TOUCHES.includes(t))
  const { readyDepsMet: ready } = computeReadyCandidates(issues, mergedIssues)

  const selected = []
  let hasSerializingInBatch = hasSerializingTouchInRunning
  for (const i of ready) {
    if (selected.length >= concurrencyCap) break
    const touches = i.touches || []
    // colisión con lo ya corriendo o ya seleccionado esta tanda (token
    // compartido), o conflicto de serialización cruzada con lo ya
    // acumulado en ESTA tanda (`hasSerializingInBatch`, que sí se va
    // actualizando conforme el bucle selecciona — esa acumulación es
    // deliberadamente estado local del bucle, no algo que el predicate
    // compartido deba conocer).
    if (touchesConflict(touches, claimedTouches, hasSerializingInBatch)) continue
    selected.push(i)
    touches.forEach((t) => claimedTouches.add(t))
    if (touches.some((t) => SERIALIZING_TOUCHES.includes(t))) hasSerializingInBatch = true
  }
  return selected
}

// collectInFlight: extrae, de la lista de issues ya mapeados (misma forma que
// consume selectNext: {n, status, touches}), los que están actualmente en
// status:in-progress — es decir, trabajo YA lanzado por una invocación
// ANTERIOR de /ct-next (o por claim.js) que sigue corriendo. Es la pieza que
// faltaba: antes, ct-next.mjs llamaba a selectNext con `runningTouches: []`
// hardcodeado, así que dos invocaciones sucesivas de /ct-next --cap 1 nunca
// se veían entre sí (ni para colisión de touches ni para el cap). Vive en
// dispatch.js (no en gh-issue-map.js) porque opera sobre la forma YA MAPEADA
// que selectNext consume, no sobre el JSON crudo de GitHub — es la misma capa
// de decisión, no de traducción de formato.
export function collectInFlight(issues) {
  return (issues || [])
    .filter((i) => i.status === 'in-progress')
    .map((i) => ({ n: i.n, touches: i.touches || [] }))
}

// collisionAgainstRunning: dado el candidato de menor orden que SÍ está
// ready con deps mergeadas, decide si colisiona con el trabajo en vuelo —
// token compartido literal, o conflicto de serialización cruzada
// (migration/ci/pbxproj con tokens distintos). null significa "no colisiona"
// (es decir: se seleccionaría si hubiera hueco de cap).
function collisionAgainstRunning(cand, inFlight) {
  const runningTouches = inFlight.flatMap((i) => i.touches || [])
  const claimedTouches = new Set(runningTouches)
  const hasSerializingInRunning = runningTouches.some((t) => SERIALIZING_TOUCHES.includes(t))
  const touches = cand.touches || []

  // Mismo predicate que usa selectNext (touchesConflict, arriba) — la regla
  // de "¿choca esto?" es una única fuente de verdad; lo que sigue aquí es
  // SOLO atribución (a qué issue en vuelo, con qué token) para el mensaje,
  // que selectNext no necesita.
  const conflict = touchesConflict(touches, claimedTouches, hasSerializingInRunning)
  if (!conflict) return null

  if (conflict.kind === 'token') {
    const withIssue = inFlight.find((i) => (i.touches || []).includes(conflict.token))
    return { reason: 'collision', kind: 'token', issue: cand.n, token: conflict.token, withIssue: withIssue ? withIssue.n : null }
  }

  const withIssue = inFlight.find((i) => (i.touches || []).some((t) => SERIALIZING_TOUCHES.includes(t)))
  const runningToken = (withIssue?.touches || []).find((t) => SERIALIZING_TOUCHES.includes(t))
  return { reason: 'collision', kind: 'serializing', issue: cand.n, token: conflict.token, runningToken, withIssue: withIssue ? withIssue.n : null }
}

// explainSelectionGap: la misma cadena de motivos que explainNoSelection,
// pero IGNORANDO el cap por completo — responde "si el cap no fuera ahora
// mismo el factor limitante (pero el trabajo en vuelo siguiera reteniendo
// sus tokens), ¿se seleccionaría algo igualmente?". `null` = sí (por tanto
// subir --cap SÍ ayudaría); un objeto de razón no-null es lo que seguiría
// bloqueando aunque el cap no limitara. Nunca hace falta recorrer TODOS los
// candidatos ready-con-deps-mergeadas para el caso de colisión: selectNext
// los procesa en orden ascendente y solo salta uno por colisión
// (`continue`, nunca `break`), así que si el primero de la lista (menor
// orden) no choca, se habría seleccionado — el primero es siempre el que
// explica el bloqueo cuando lo hay.
function explainSelectionGap(issues, { mergedIssues = [], inFlight = [] } = {}) {
  const { ready, readyDepsMet } = computeReadyCandidates(issues, mergedIssues)
  if (ready.length === 0) return { reason: 'none-ready' }
  if (readyDepsMet.length === 0) {
    const merged = new Set(mergedIssues)
    // D1 finding 2: para un issue con depsMalformed, `unmetDeps` se reporta
    // vacío A PROPÓSITO — sus `deps` reales son desconocidas (la sección no
    // se pudo leer), no "todas mergeadas". `malformed: true` es la señal que
    // ct-next.mjs#formatReason usa para no imprimir una lista vacía junto a
    // "bloqueado" (una aparente contradicción) y en su lugar explicar que el
    // bloqueo es por datos ilegibles, no por trabajo pendiente.
    return {
      reason: 'deps-unmet',
      blocked: ready.map((i) => ({
        n: i.n,
        unmetDeps: i.depsMalformed ? [] : (i.deps || []).filter((d) => !merged.has(d)),
        malformed: !!i.depsMalformed,
      })),
    }
  }
  return collisionAgainstRunning(readyDepsMet[0], inFlight)
}

// explainNoSelection: cuando selectNext no elige nada, un único mensaje
// genérico ("nada ready con deps mergeadas y sin colisión") obliga al humano
// a adivinar entre cuatro causas muy distintas con remedios distintos. Esta
// función distingue, en orden de prioridad:
//   1. 'cap-full'    — el cap ya está copado por trabajo en vuelo. Incluye
//                       `wouldDispatchIfCapAllowed` (fix Minor 1 de la
//                       review): sin esto, un cap lleno SIEMPRE sugería
//                       "sube --cap", incluso cuando el candidato que
//                       quedaría también estaría bloqueado por otra causa
//                       (deps sin mergear, o colisión) — subir el cap en ese
//                       caso no cambiaría nada, y decir lo contrario es peor
//                       que no decir nada.
//   2. 'none-ready'  — no hay NINGÚN issue en status:ready.
//   3. 'deps-unmet'  — hay ready, pero ninguno tiene todas sus deps
//                       mergeadas.
//   4. 'collision'   — hay al menos un ready con deps mergeadas, pero choca
//                       con trabajo en vuelo (token compartido, o conflicto
//                       de serialización migration/ci/pbxproj).
export function explainNoSelection(issues, { mergedIssues = [], inFlight = [], cap = 1 } = {}) {
  const inFlightCount = inFlight.length
  // Se calcula SIEMPRE (incluso si el cap ya está lleno): es exactamente lo
  // que hace falta para poblar `wouldDispatchIfCapAllowed`/
  // `blockedEvenWithCap` sin duplicar la lógica de colisión/deps una segunda
  // vez para el caso "cap lleno".
  const gap = explainSelectionGap(issues, { mergedIssues, inFlight })
  if (inFlightCount >= cap) {
    return { reason: 'cap-full', inFlightCount, cap, wouldDispatchIfCapAllowed: gap === null, blockedEvenWithCap: gap }
  }
  // No debería alcanzarse con datos consistentes (`gap` no-null aquí
  // significaría que selectNext tampoco habría seleccionado nada por otra
  // razón — pero entonces planDispatch nunca habría llamado a esta función
  // con `selected.length === 0` sin ser precisamente por eso), pero nunca
  // devolvemos undefined en silencio ante una entrada inesperada.
  return gap ?? { reason: 'unknown' }
}

// planDispatch: compone collectInFlight + selectNext + explainNoSelection en
// un único punto, para que ct-next.mjs (el wrapper) nunca tenga que decidir
// nada por su cuenta — solo formatear lo que esta función ya decidió. `cap`
// es el máximo GLOBAL de agentes trabajando este repo a la vez (en vuelo +
// recién seleccionados), no un tope "por invocación": `remainingCap` es lo
// que de verdad se le pasa a selectNext como concurrencyCap.
export function planDispatch(issues, { mergedIssues = [], cap = 1 } = {}) {
  const inFlight = collectInFlight(issues)
  const runningTouches = inFlight.flatMap((i) => i.touches || [])
  const remainingCap = Math.max(0, cap - inFlight.length)
  const selected = selectNext(issues, { mergedIssues, runningTouches, concurrencyCap: remainingCap })
  const blockReason = selected.length === 0 ? explainNoSelection(issues, { mergedIssues, inFlight, cap }) : null
  return { selected, inFlight, runningTouches, remainingCap, blockReason }
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
