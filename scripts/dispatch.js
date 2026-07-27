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
// bloqueando aunque el cap no limitara.
//
// D2, finding 4 (auditoría del dispatch) — fix: ANTES esta función miraba
// solo `readyDepsMet[0]`, con el razonamiento de que "selectNext procesa en
// orden ascendente y solo salta uno por colisión, así que si el primero no
// choca se habría seleccionado". Ese razonamiento es válido para explicar por
// qué el selectNext REAL, con hueco de cap DE VERDAD (remainingCap > 0), no
// seleccionó nada (si el [0] no chocara, se habría seleccionado, contradicción
// con "no seleccionó nada" — luego, si no seleccionó nada, el [0] SÍ choca, y
// de hecho todos chocan). Pero es exactamente el razonamiento EQUIVOCADO para
// el contrafactual "¿ayudaría subir --cap?" en el caso cap-full: ahí
// `remainingCap` fue 0, así que el selectNext real NUNCA examinó al
// candidato 2 en adelante — que el [0] choque no informa en absoluto sobre si
// el [1] también lo haría. Reproducido por el auditor: cap=2, dos en vuelo
// (api, db), #20 (orden 1, touches:api) choca con el `api` en vuelo pero #21
// (orden 2, touches:ui) está libre — subir --cap SÍ despacharía #21, y el
// código viejo afirmaba lo contrario mirando solo #20.
//
// La corrección: escanear TODOS los candidatos ready-con-deps-mergeadas, en
// el mismo orden que selectNext, hasta encontrar UNO que no choque con el
// trabajo en vuelo — ese es, por construcción, el mismo que
// selectNext(..., concurrencyCap: 1) elegiría si el cap diera un hueco más
// ahora mismo (el trabajo en vuelo sin cambiar): el bucle real de selectNext
// solo se detiene por colisión (`continue`) o por agotar el cap, así que con
// un solo hueco disponible acaba seleccionando exactamente al primero de la
// lista que no choque con `runningTouches`. Si NINGUNO de los candidatos está
// libre, se reporta el motivo del primero (igual que antes) — el escaneo no
// cambia CUÁL se cita cuando de verdad todos chocan, solo cierra el falso
// negativo de arriba.
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
  for (const cand of readyDepsMet) {
    const collision = collisionAgainstRunning(cand, inFlight)
    if (!collision) return null // este candidato SÍ se despacharía con un hueco de cap más
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

// ============================================================================
// Mapa de cuentas (D4, defecto 1 — el más grave de esa tanda).
//
// QUÉ ESTABA ROTO. La versión anterior recibía el repo YA DESPOJADO del owner
// (`repo.split('/').pop()` en ct-next.mjs) y casaba por prefijo de nombre:
//
//   if ((map.work || []).some((r) => repo === r || repo.startsWith(r))) ...
//
// Con el mapa real de kickoff.js (`work: ['mo.', 'mercadona']`), verificado
// por construcción antes de tocar nada:
//   - `mercadona/mo.boilerplate.fastapi` → 'mo.boilerplate.fastapi' →
//     startsWith('mo.') → cuenta de TRABAJO. Correcto, por casualidad.
//   - `mercadona/algun-tool-interno` → 'algun-tool-interno' → no casa con
//     NADA → cae al default → cuenta PERSONAL. Código de trabajo corriendo
//     bajo la cuenta personal, en silencio.
//   - la entrada 'mercadona' de la lista `work` NO PODÍA CASAR JAMÁS: el
//     owner se tiraba antes de llegar aquí. Configuración que aparenta hacer
//     algo y no hace nada.
//   - `startsWith` sin frontera y SIN PEDIRLO: con `personal:
//     ['control-tower']`, un repo `control-tower-de-otro` (de cualquier
//     owner) casaba igual, aunque el autor solo hubiera escrito un nombre
//     exacto. Ahora un literal es un literal y el prefijo hay que pedirlo
//     con un `*` (`mo.*`). OJO, para no vender más de lo que es: el mapa por
//     defecto SIGUE incluyendo `*/mo.*`, así que
//     `<cualquier-owner>/mo.nada-que-ver` sigue yendo a la cuenta de
//     trabajo. Eso es deliberado — conserva el comportamiento actual para
//     repos `mo.*` que vivan fuera de la org `mercadona`, y hoy no hay
//     evidencia de cuáles son — pero ahora es una decisión ESCRITA en el
//     mapa, no un efecto colateral del matcher.
//
// FORMA DE PATRÓN NUEVA (documentada también en kickoff.js, donde vive el
// mapa por defecto): un patrón es `<owner>/<repo>` — SIEMPRE las dos mitades,
// nunca un nombre suelto, para que el owner cuente de verdad. Cada mitad es:
//   - un literal exacto      → `mercadona`, `control-tower`
//   - `*`                    → cualquier cosa
//   - un prefijo con `*` al final → `mo.*` (casa `mo.foo`, no `momento`)
// El `*` solo se admite como segmento entero o como ÚLTIMO carácter de un
// segmento: cualquier otra posición es un patrón malformado (error, nunca
// una interpretación inventada). La comparación es case-insensitive, igual
// que ya hace ensureRepoIdentity en ct-next.mjs con el remote.
//
// Esto ESTRECHA lo que el sistema acepta, y ese estrechamiento crea dos
// categorías nuevas que NO pueden pasar calladas (ver ct-next.mjs, que las
// imprime antes de lanzar nada):
//   1. repos que ya no casan con ningún patrón y caen al default;
//   2. repos que casan con una cuenta DISTINTA de la que el mapa viejo les
//      daba (`resolveAccountLegacy`, más abajo, existe solo para poder
//      detectar esto y decirlo en voz alta).
const ACCOUNT_PATTERN_SYNTAX = '<owner>/<repo>, donde cada mitad es un literal exacto, `*` (cualquier cosa), o un prefijo terminado en `*` (p.ej. `mo.*`)'

function segmentPatternError(seg, which) {
  if (seg.length === 0) return `la mitad de ${which} está vacía (${ACCOUNT_PATTERN_SYNTAX})`
  const star = seg.indexOf('*')
  if (star === -1) return null
  if (seg === '*') return null
  // Un segmento con DOS o más `*` cae también aquí, y no en una comprobación
  // aparte: si hay más de uno, el primero no puede ser el último carácter.
  if (star !== seg.length - 1) {
    return `la mitad de ${which} ("${seg}") usa "*" en una posición que este matcher NO interpreta — solo se admite "*" como segmento entero o como último carácter (${ACCOUNT_PATTERN_SYNTAX})`
  }
  return null
}

// accountPatternError: `null` si el patrón es válido, o un mensaje que
// explica exactamente qué tiene mal. Nunca "arregla" un patrón dudoso por su
// cuenta: un mapa mal escrito tiene que doler al arrancar, no producir un
// matching a medias que mande trabajo a la cuenta equivocada.
export function accountPatternError(pattern) {
  if (typeof pattern !== 'string') return `no es una cadena (es ${pattern === null ? 'null' : typeof pattern})`
  if (pattern.length === 0) return 'patrón vacío'
  if (pattern !== pattern.trim()) return `tiene espacios al principio o al final ("${pattern}") — quítalos, no se recortan solos para no casar por accidente algo que el autor no escribió`
  const parts = pattern.split('/')
  if (parts.length !== 2) {
    return parts.length < 2
      ? `le falta el owner: un patrón es ${ACCOUNT_PATTERN_SYNTAX} — un nombre suelto ("${pattern}") ya no se acepta, porque era justo lo que hacía que el owner no contara`
      : `tiene más de un "/" (${ACCOUNT_PATTERN_SYNTAX})`
  }
  return segmentPatternError(parts[0], 'owner') || segmentPatternError(parts[1], 'repo')
}

function segmentMatches(value, seg) {
  if (seg === '*') return true
  if (seg.endsWith('*')) return value.startsWith(seg.slice(0, -1))
  return value === seg
}

// parseRepoSlug: `owner/repo` en minúsculas, o `null` si el slug no tiene
// exactamente esa forma. Devolver `null` (en vez de adivinar) es lo que
// permite a ct-next.mjs rechazar un `--repo` malformado con un mensaje claro
// en vez de resolver una cuenta a partir de algo que no es un repo.
export function parseRepoSlug(slug) {
  if (typeof slug !== 'string') return null
  const parts = slug.split('/')
  if (parts.length !== 2) return null
  // Sin `trim()` a propósito: recortar aquí haría que `--repo " o/r"` pasara
  // la validación mientras el RESTO del script (la URL de `gh api
  // repos/<repo>/issues`, el título del workspace) sigue usando la cadena
  // cruda, con el espacio dentro — es decir, validaríamos una cosa y
  // usaríamos otra. Los nombres de owner/repo de GitHub son
  // [A-Za-z0-9._-]: cualquier espacio es un error del que hay que avisar,
  // no algo que arreglar en silencio.
  if (!parts[0] || !parts[1]) return null
  if (/\s/.test(slug)) return null
  return { owner: parts[0].toLowerCase(), name: parts[1].toLowerCase() }
}

export function matchesAccountPattern(slug, pattern) {
  if (accountPatternError(pattern)) return false
  const parsed = parseRepoSlug(slug)
  if (!parsed) return false
  const [ownerSeg, repoSeg] = pattern.toLowerCase().split('/')
  return segmentMatches(parsed.owner, ownerSeg) && segmentMatches(parsed.name, repoSeg)
}

// validateAccountMap: lista de errores (vacía = mapa sano). Se llama al
// ARRANCAR de ct-next.mjs, antes de tocar gh o el filesystem — el requisito
// explícito es que un mapa mal formado no pueda descubrirse cuando ya se han
// lanzado tres agentes. La existencia EN DISCO de los directorios no se
// comprueba aquí (esta capa es pura, sin IO): eso lo hace ct-next.mjs sobre
// el directorio que de verdad va a usar, también antes de lanzar nada.
export function validateAccountMap(map) {
  if (!map || typeof map !== 'object') return ['ACCOUNT_MAP no es un objeto']
  const errors = []
  for (const key of ['personal', 'work']) {
    const list = map[key]
    if (list === undefined) {
      errors.push(`ACCOUNT_MAP.${key} no está definido — pon [] explícitamente si de verdad no hay ningún patrón para esa cuenta`)
      continue
    }
    if (!Array.isArray(list)) {
      errors.push(`ACCOUNT_MAP.${key} debe ser un array de patrones, no ${typeof list}`)
      continue
    }
    list.forEach((p, i) => {
      const e = accountPatternError(p)
      if (e) errors.push(`ACCOUNT_MAP.${key}[${i}] inválido: ${e}`)
    })
  }
  for (const key of ['personalDir', 'workDir']) {
    const d = map[key]
    if (typeof d !== 'string' || d.trim().length === 0) {
      errors.push(`ACCOUNT_MAP.${key} debe ser una ruta absoluta no vacía`)
    } else if (!d.startsWith('/')) {
      errors.push(`ACCOUNT_MAP.${key} ("${d}") no es una ruta absoluta — CLAUDE_CONFIG_DIR viaja al daemon de cmux, que la resuelve desde SU propio cwd, no desde el tuyo`)
    }
  }
  return errors
}

// resolveAccount: recibe el slug COMPLETO (`owner/repo`), nunca el nombre
// suelto. Devuelve siempre un objeto — el `dir` a secas ya no basta, porque
// quien llama necesita poder decir en voz alta POR QUÉ cuenta se ha optado y
// si fue por una regla real o por el default:
//   { dir, account, pattern, matched, conflictPattern, slugMalformed }
//   - matched=false  → ninguna regla casó; `dir` es el default (personal) y
//                      `pattern` es null. ct-next.mjs lo anuncia siempre.
//   - conflictPattern → el repo casaba TAMBIÉN con un patrón de la otra
//                      cuenta. Gana `work` (deliberado: código de trabajo
//                      bajo la cuenta personal es el fallo caro; al revés es
//                      molesto pero no filtra nada), pero la ambigüedad se
//                      anuncia en vez de resolverse en silencio.
export function resolveAccount(slug, map) {
  const parsed = parseRepoSlug(slug)
  if (!parsed) {
    return { dir: map.personalDir, account: 'personal', pattern: null, matched: false, conflictPattern: null, slugMalformed: true }
  }
  const workPattern = (map.work || []).find((p) => matchesAccountPattern(slug, p)) ?? null
  const personalPattern = (map.personal || []).find((p) => matchesAccountPattern(slug, p)) ?? null
  if (workPattern) {
    return { dir: map.workDir, account: 'work', pattern: workPattern, matched: true, conflictPattern: personalPattern, slugMalformed: false }
  }
  if (personalPattern) {
    return { dir: map.personalDir, account: 'personal', pattern: personalPattern, matched: true, conflictPattern: null, slugMalformed: false }
  }
  return { dir: map.personalDir, account: 'personal', pattern: null, matched: false, conflictPattern: null, slugMalformed: false }
}

// resolveAccountLegacy: reimplementa, TAL CUAL, el algoritmo viejo (nombre
// suelto + startsWith, con el owner descartado) sobre las listas viejas que
// `map.legacy` conserva. NO es código muerto ni nostalgia: es la única forma
// de responder a "¿este repo, que hoy funciona, cambia de cuenta con el
// arreglo?" — y ese es un requisito explícito del encargo, porque estrechar
// el matching reclasifica repos y una reclasificación silenciosa de cuenta
// es exactamente el tipo de divergencia que esta tanda de trabajo existe
// para eliminar.
//
// Criterio de retirada (para quien lo lea dentro de seis meses): en cuanto
// el aviso de reclasificación deje de aparecer en las corridas reales de los
// repos que se usan de verdad, `map.legacy` y esta función se pueden borrar
// juntas — no tienen ningún otro consumidor.
export function resolveAccountLegacy(slug, map) {
  const legacy = map?.legacy
  if (!legacy) return null
  const name = String(slug ?? '').split('/').pop()
  const hits = (list) => (list || []).some((r) => name === r || name.startsWith(r))
  if (hits(legacy.work)) return { dir: map.workDir, account: 'work', matched: true }
  if (hits(legacy.personal)) return { dir: map.personalDir, account: 'personal', matched: true }
  return { dir: map.personalDir, account: 'personal', matched: false }
}
// ============================================================================

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
