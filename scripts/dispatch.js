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
    .map((i) => ({ n: i.n, status: 'in-progress', touches: i.touches || [] }))
}

// collectTokenHolders (F13/H2): quién retiene tokens de área/touches. NO es
// lo mismo que collectInFlight, y por eso son dos funciones y no una con un
// flag: son dos RECURSOS distintos con dos criterios distintos.
//
//   - CAP (collectInFlight)        → cuántos AGENTES hay vivos ahora mismo.
//                                    Solo `in-progress`: un slice en revisión
//                                    no tiene ningún agente corriendo.
//   - TOKENS (collectTokenHolders) → sobre qué áreas hay trabajo NO MERGEADO
//                                    todavía. `in-progress` Y `in-review`: el
//                                    conflicto de contenido no acaba cuando
//                                    el agente para, acaba cuando el PR se
//                                    mergea y `main` contiene ese trabajo.
//
// El porqué completo (incluida la alternativa descartada de mantener el claim
// en `in-progress` hasta el merge) está en scripts/claim.js, junto a
// CLAIM_HOLDING_STATUSES — ahí vive el mismo criterio para el otro consumidor
// (dispatch-check.mjs#detectCollisions), y no se duplica aquí para que no
// puedan divergir: los dos ficheros describen el mismo par de estados, uno
// sobre labels crudas y otro sobre el struct ya mapeado.
export const TOKEN_HOLDING_STATUSES = ['in-progress', 'in-review']
export function collectTokenHolders(issues) {
  return (issues || [])
    .filter((i) => TOKEN_HOLDING_STATUSES.includes(i.status))
    .map((i) => ({ n: i.n, status: i.status, touches: i.touches || [] }))
}

// collisionBlockers (F16/H1): TODOS los issues que retienen algo que impide
// despachar a `cand`, no solo el primero que encuentra `touchesConflict`.
//
// EL DEFECTO QUE CIERRA, observado en la primera corrida real de /ct-next:
// cinco issues ocupaban el carril serializante global (cuatro `touches:ci`,
// uno `touches:migration`) y el dispatcher nombró UNO. El problema no es la
// incompletitud en abstracto: es que nombrar uno IMPLICA un remedio
// ("resuelve ese y sale") que no desbloquea nada. Quien lo leyera resolvería
// ese issue, volvería a correr, y se encontraría igual de bloqueado — cuatro
// veces seguidas. La lista de bloqueantes de un candidato es una CONJUNCIÓN
// (hay que despejarlos todos), así que una muestra de tamaño 1 no es
// "información parcial": es una instrucción equivocada.
//
// Y hay un segundo caso, más traicionero, que la atribución vieja tampoco
// podía ver: el orden de `touchesConflict` devuelve 'token' antes que
// 'serializing', así que una colisión por token compartido TAPA una colisión
// de carril que hay detrás. Verificado sin arreglar con #1 (in-review,
// touches:ci), #2 (in-review, touches:migration) y #3 (ready, touches:ci):
// el mensaje citaba a #1 por token; tras mergear #1 aparecía uno NUEVO
// citando a #2 por carril. Dos vueltas para descubrir dos paredes.
//
// Forma de cada bloqueante: `{ n, status, sharedTokens, laneTokens }`.
//   - sharedTokens → tokens que este holder retiene Y `cand` también toca
//                    (colisión literal de área).
//   - laneTokens   → tokens serializantes que este holder retiene y que
//                    bloquean a `cand` por CARRIL GLOBAL (`cand` toca algún
//                    migration/ci/pbxproj, aunque sea otro distinto). Se
//                    excluyen los que ya salen en `sharedTokens` para no
//                    contar dos veces el mismo motivo.
// Un holder aparece si tiene al menos uno de los dos no vacío.
//
// INVARIANTE con `touchesConflict` (el ÚNICO predicate de colisión, que
// sigue siendo quien decide el `continue` de selectNext): esta función
// devuelve una lista no vacía exactamente cuando aquel devuelve no-null —
// mismos dos criterios, misma unión de tokens reclamados. No se usa como
// gate (el gate sigue siendo `touchesConflict`, para que no puedan
// divergir): solo ATRIBUYE.
export function collisionBlockers(cand, holders) {
  const touches = cand.touches || []
  const candHasSerializing = touches.some((t) => SERIALIZING_TOUCHES.includes(t))
  const normalized = (holders || []).map((h) => ({ n: h.n, status: h.status ?? null, touches: h.touches || [] }))
  const anySerializingHeld = normalized.some((h) => h.touches.some((t) => SERIALIZING_TOUCHES.includes(t)))
  // El carril solo está "activo" si el candidato entra en él Y hay alguien
  // dentro: si no, un holder con touches:ci no bloquea a un candidato que no
  // toca nada serializante.
  const laneActive = candHasSerializing && anySerializingHeld
  const out = []
  for (const h of normalized) {
    const sharedTokens = h.touches.filter((t) => touches.includes(t))
    const laneTokens = laneActive
      ? h.touches.filter((t) => SERIALIZING_TOUCHES.includes(t) && !sharedTokens.includes(t))
      : []
    if (sharedTokens.length || laneTokens.length) out.push({ n: h.n, status: h.status, sharedTokens, laneTokens })
  }
  return out
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

  // F16/H1: la atribución COMPLETA viaja siempre, junto a la vieja de un solo
  // issue. Los campos `token`/`withIssue`/`withIssueStatus`/`runningToken` se
  // conservan tal cual (los consumen tests y el mensaje de un único
  // bloqueante, que no cambia); `blockers` es lo que permite decir la verdad
  // cuando son varios.
  const blockers = collisionBlockers(cand, inFlight)

  // withIssueStatus (F13/H2): la atribución ya no basta con el NÚMERO del
  // issue que retiene el token — hace falta EN QUÉ ESTADO lo retiene.
  // "colisiona con #7 (in-progress)" y "colisiona con #7 (in-review, su PR
  // sigue abierto)" son dos bloqueos con dos remedios distintos, y hasta F13
  // el segundo ni siquiera existía. `?? null` y no un default optimista: si
  // quien llama pasó holders sin `status` (los tests unitarios viejos lo
  // hacen), se dice que no se sabe en vez de afirmar 'in-progress'.
  if (conflict.kind === 'token') {
    const withIssue = inFlight.find((i) => (i.touches || []).includes(conflict.token))
    return { reason: 'collision', kind: 'token', issue: cand.n, token: conflict.token, withIssue: withIssue ? withIssue.n : null, withIssueStatus: withIssue?.status ?? null, blockers }
  }

  const withIssue = inFlight.find((i) => (i.touches || []).some((t) => SERIALIZING_TOUCHES.includes(t)))
  const runningToken = (withIssue?.touches || []).find((t) => SERIALIZING_TOUCHES.includes(t))
  return { reason: 'collision', kind: 'serializing', issue: cand.n, token: conflict.token, runningToken, withIssue: withIssue ? withIssue.n : null, withIssueStatus: withIssue?.status ?? null, blockers }
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
// depStates (F13/H4): `{ <número de issue>: <stateReason> }` SOLO para los
// issues CERRADOS que NO cuentan como mergeados ('NOT_PLANNED', 'REOPENED',
// null…). Es la información que faltaba para poder responder "¿por qué este
// slice no sale nunca?".
//
// EL AGUJERO QUE CIERRA. `filterMergedIssues` (gh-issue-map.js) considera
// satisfecha una dep si su issue está cerrado con `stateReason ===
// 'COMPLETED'`. Cerrar un slice descartado como **not planned** —que es lo
// semánticamente correcto— NO satisface la dep, y todos sus dependientes se
// quedan esperando PARA SIEMPRE. El mensaje que veías era "falta mergear #7",
// indistinguible de "#7 aún se está trabajando": una instrucción a esperar
// algo que nunca va a pasar. Verificado contra el código sin arreglar: un
// cerrado NOT_PLANNED producía exactamente `unmetDeps:[7]`, sin ninguna otra
// señal.
//
// `unmetDeps` conserva su forma (números de issue, o `null` para un orden que
// no resuelve a ningún issue) — no se cambia a objetos para no reescribir los
// consumidores existentes ni los tests que fijan esa forma. El estado viaja
// aparte, en un mapa, y ct-next.mjs#formatReason lo consulta al renderizar.
export function unresolvableDepsOf(blockedEntry, depStates = {}) {
  return (blockedEntry.unmetDeps || []).filter((d) => d != null && Object.prototype.hasOwnProperty.call(depStates, d))
}

function explainSelectionGap(issues, { mergedIssues = [], inFlight = [], depStates = {} } = {}) {
  const { ready, readyDepsMet } = computeReadyCandidates(issues, mergedIssues)
  if (ready.length === 0) {
    // F13: 'none-ready' decía "no hay nada que despachar todavía" y se
    // callaba que pudiera haber SEIS PRs abiertos esperando revisión. Con
    // `in-review` reteniendo tokens (H2) ese silencio es peor todavía: el
    // estado más común al final de un epic es "todo en revisión, nada ready",
    // y el mensaje lo pintaba como si no se hubiera empezado. `inReview` es
    // la lista de issues parados ahí — cero significa de verdad cero.
    // F16/H1, misma lente: "no hay nada que despachar TODAVÍA" manda esperar
    // algo que, con todo en `status:backlog`, no va a llegar nunca solo.
    // Promover backlog → ready es un gate HUMANO deliberado (ct-groom hasta
    // imprime un recordatorio sobre ello al terminar un groom). Verificado
    // sin arreglar: con tres issues en backlog el mensaje era exactamente el
    // mismo que con CERO issues abiertos — dos situaciones con remedios
    // opuestos (promover vs. groomear / revisar --repo), indistinguibles.
    // `total` es el número de issues ABIERTOS que llegaron hasta aquí: cero
    // significa que no hay nada que mirar, no que todo esté hecho.
    const all = issues || []
    return {
      reason: 'none-ready',
      inReview: all.filter((i) => i.status === 'in-review').map((i) => i.n),
      backlog: all.filter((i) => i.status === 'backlog').map((i) => i.n),
      inProgress: all.filter((i) => i.status === 'in-progress').map((i) => i.n),
      total: all.length,
    }
  }
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
      depStates,
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
// `tokenHolders` (F13/H2) es el conjunto que retiene TOKENS (in-progress +
// in-review); `inFlight` sigue siendo el que consume CAP (solo in-progress).
// Cuando no se pasa `tokenHolders` (los tests unitarios previos a F13, que
// solo conocían un conjunto) se usa `inFlight` — así una llamada vieja
// mantiene exactamente su semántica anterior en vez de perder silenciosamente
// la mitad de los poseedores.
export function explainNoSelection(issues, { mergedIssues = [], inFlight = [], tokenHolders, cap = 1, depStates = {} } = {}) {
  const inFlightCount = inFlight.length
  const holders = tokenHolders ?? inFlight
  // Se calcula SIEMPRE (incluso si el cap ya está lleno): es exactamente lo
  // que hace falta para poblar `wouldDispatchIfCapAllowed`/
  // `blockedEvenWithCap` sin duplicar la lógica de colisión/deps una segunda
  // vez para el caso "cap lleno".
  const gap = explainSelectionGap(issues, { mergedIssues, inFlight: holders, depStates })
  if (inFlightCount >= cap) {
    // `inFlight` viaja entero (no solo su conteo) porque el mensaje de
    // "cap lleno" necesita poder cruzar CADA issue que ocupa el cap contra
    // la evidencia local de que algo lo está trabajando de verdad — ver
    // F13/H3 en ct-next.mjs#formatBlockReason. Antes solo llegaba el número,
    // así que un claim MUERTO que copara el cap sin compartir ningún token
    // con nadie era completamente invisible: "sube --cap, o espera a que
    // termine alguno", esperando a un agente que ya no existe.
    return { reason: 'cap-full', inFlightCount, inFlight, cap, wouldDispatchIfCapAllowed: gap === null, blockedEvenWithCap: gap }
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
//
// F13/H2 — DOS CONJUNTOS, NO UNO. `inFlight` (solo `in-progress`) decide el
// CAP; `tokenHolders` (`in-progress` + `in-review`) decide los TOKENS. Antes
// `runningTouches` salía de `inFlight`, así que soltar el claim a
// `in-review` al abrir el PR liberaba también los tokens — la ventana del
// cerrojo terminaba al abrir el PR, mientras la del conflicto llega hasta el
// merge. `remainingCap` sigue calculándose con `inFlight.length`: un PR en
// revisión no ocupa a nadie.
export function planDispatch(issues, { mergedIssues = [], cap = 1, depStates = {} } = {}) {
  const inFlight = collectInFlight(issues)
  const tokenHolders = collectTokenHolders(issues)
  const runningTouches = tokenHolders.flatMap((i) => i.touches || [])
  const remainingCap = Math.max(0, cap - inFlight.length)
  const selected = selectNext(issues, { mergedIssues, runningTouches, concurrencyCap: remainingCap })
  const blockReason = selected.length === 0 ? explainNoSelection(issues, { mergedIssues, inFlight, tokenHolders, cap, depStates }) : null
  return { selected, inFlight, tokenHolders, runningTouches, remainingCap, blockReason }
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

// F29 — nombre de comando aceptable para el binario del agente.
// Deliberadamente estrecho: ni rutas (`/`), ni espacios, ni nada que un shell
// pueda interpretar. Quien necesite una ruta absoluta que ponga el directorio
// en el PATH de su shell de login, que es de todos modos quien resuelve el
// nombre de verdad.
const ACCOUNT_BIN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

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
  // F29 — los binarios son OPCIONALES en el mapa (uno anterior a F29 no los
  // trae, y sigue valiendo: resolveAccount cae a `claude`, que es lo que se
  // tecleaba entonces), pero si están tienen que ser un nombre de comando a
  // secas. El valor viaja SIN COMILLAS a dos sitios —`command -v <bin>` dentro
  // del launcher y la propia línea del agente— así que un espacio o un `;`
  // aquí no son un nombre raro: son inyección de shell en un script que se
  // sourcea en el shell de login del usuario.
  for (const key of ['personalBin', 'workBin']) {
    const b = map[key]
    if (b === undefined) continue
    if (typeof b !== 'string' || !ACCOUNT_BIN_RE.test(b)) {
      errors.push(`ACCOUNT_MAP.${key} (${JSON.stringify(b)}) no es un nombre de comando válido — solo letras, dígitos, punto, guion y guion bajo, empezando por letra o dígito (p.ej. "claude-personal"). Se teclea sin comillas en el shell de login que abre cmux`)
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
    return { dir: map.personalDir, bin: personalBinOf(map), account: 'personal', pattern: null, matched: false, conflictPattern: null, slugMalformed: true }
  }
  const workPattern = (map.work || []).find((p) => matchesAccountPattern(slug, p)) ?? null
  const personalPattern = (map.personal || []).find((p) => matchesAccountPattern(slug, p)) ?? null
  if (workPattern) {
    return { dir: map.workDir, bin: workBinOf(map), account: 'work', pattern: workPattern, matched: true, conflictPattern: personalPattern, slugMalformed: false }
  }
  if (personalPattern) {
    return { dir: map.personalDir, bin: personalBinOf(map), account: 'personal', pattern: personalPattern, matched: true, conflictPattern: null, slugMalformed: false }
  }
  return { dir: map.personalDir, bin: personalBinOf(map), account: 'personal', pattern: null, matched: false, conflictPattern: null, slugMalformed: false }
}

// F29 — `bin` viaja junto a `dir` porque salen de la MISMA decisión y tienen
// que poder decirse en la misma frase. Un mapa sin binarios (anterior a F29)
// cae a `claude`, que es literalmente lo que se tecleaba antes: el defecto
// conserva el comportamiento, no lo adivina. El caso que NO se contempla —a
// propósito— es un binario por repo o por slice: la cuenta es lo único que
// distingue a un wrapper de otro, y hacerlos independientes permitiría teclear
// `claude-work` con el config dir personal.
const personalBinOf = (map) => map?.personalBin || DEFAULT_AGENT_BIN
const workBinOf = (map) => map?.workBin || DEFAULT_AGENT_BIN
export const DEFAULT_AGENT_BIN = 'claude'

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

// ============================================================================
// F20/H1 — REENVIAR LA LÍNEA, PORQUE NO HAY FORMA DE NO TECLEARLA.
//
// Lo que se midió contra el cmux real de esta máquina (y no se dedujo de la
// ayuda), con siete lanzamientos y sus pantallas leídas:
//
//   - `--command` teclea: «Send text+Enter to the new workspace after
//     creation». Ya lo decía F19.
//   - `--layout '{"pane":{"surfaces":[{"type":"terminal","command":"…"}]}}'`
//     TAMBIÉN teclea. Es la vía que F19 dejó apuntada como posible exec y no
//     pudo probar. Medida: el texto aparece ECOADO detrás del prompt en la
//     pantalla de la sesión, y el proceso lanzado cuelga de `-/bin/zsh`
//     (login) → `login -flp … exec -l /bin/zsh` → cmux. Y de propina,
//     `--cwd` se IGNORA cuando se pasa `--layout` (el `$PWD` medido fue el
//     directorio por defecto, no el pedido).
//   - `new-surface` no acepta ningún `--command`; el único tipo que ejecuta
//     un binario por su cuenta es `agent-session --provider claude`, que es
//     la sesión de Claude propia de cmux: no admite argumentos de `claude`
//     ni un prompt, así que no sirve para despachar un slice.
//   - `--env` SÍ llega al shell (medido: `CLAUDE_CONFIG_DIR` visible dentro),
//     pero `ZDOTDIR` NO: cmux/Ghostty lo usa para su propia integración de
//     shell y llega VACÍO. Es decir, tampoco se puede inyectar un rc propio
//     que arranque el agente sin teclear.
//
// Conclusión: en esta versión de cmux no hay ninguna vía de exec. El tecleo
// se queda, y lo que se endurece es la recuperación: si el centinela no
// aparece, se REENVÍA la misma línea a la misma sesión (`send` + `send-key
// Enter`). Que eso sea seguro depende por completo de la guarda de
// idempotencia del launcher (ver launch-sentinel.js#buildLauncherScript).
//
// `send` y `send-key` van SEPARADOS porque `cmux send` no añade Enter — hay
// que mandarlo aparte (medido: tras un `send` a secas el texto se queda en la
// línea de edición sin ejecutarse).
export function buildCmuxSendArgv({ workspace, text }) {
  return ['send', '--workspace', workspace, text]
}

export function buildCmuxSendKeyArgv({ workspace, key = 'Enter' }) {
  return ['send-key', '--workspace', workspace, key]
}

// EL NOMBRE DE LA SESIÓN DE UN SLICE, en un solo sitio.
//
// Era una plantilla suelta dentro del bucle de despacho de ct-next.mjs, y con
// un consumidor no pasaba nada. Ahora hay DOS: quien crea la workspace
// (`buildCmuxArgv({ name })`) y quien la busca para mandarle una línea — el
// reenvío de la línea de arranque, y desde esta ronda el vigilante del `-OK`,
// que corre en OTRO PROCESO y no puede heredar la variable.
//
// Y buscarla es por igualdad exacta del título (`w.title === name`): no hay
// identificador estable que cmux nos devuelva al crearla y podamos guardar, así
// que el nombre ES el handle. Un espacio de más en una de las dos copias hace
// que el vigilante no encuentre nunca la sesión — se apaga en su primer sondeo
// diciendo que ya no existe (exit 4), o sea que el go de esa persona no se
// entrega y el mensaje culpa a la sesión en vez de al desajuste. Es el mismo
// desacople que este repo ya pagó tres veces (JUDGE_TOOLS, VERDICT_RULES,
// PACKAGE_SECTIONS).
export function cmuxSessionName({ repoName, issue, sliceName }) {
  return `${repoName} · #${issue} ${sliceName}`
}

// ============================================================================
// F20/H2 — EL CAMINO FELIZ NO RECOGÍA NADA.
//
// TODOS los caminos del plugin que borran un worktree son de FALLO: el
// huérfano de un despacho abortado, el worktree que bloquea un despacho nuevo,
// las precondiciones de `--requeue`. Ninguno cubre el ÉXITO. Observado en el
// primer slice que terminó bien (issue #451 de un repo real): PR mergeado,
// issue cerrado… y `.worktrees/451` + `feat/451` seguían en disco, y el
// `claude` de esa sesión llevaba TRECE HORAS vivo con su trabajo entregado
// (leído en `cmux debug-terminals`: la superficie de ese worktree con
// `created=48111s`). Con seis slices son seis checkouts completos del repo,
// seis ramas muertas y seis agentes zombis.
//
// Y hay un filo añadido: `/ct-next` se NIEGA a despachar si `.worktrees/<n>`
// ya existe. El residuo de un slice TERMINADO bloquea cualquier reintento
// futuro de ese mismo slice.
//
// POR QUÉ ESTO DETECTA Y NO BORRA. Borrar el worktree de alguien que sigue
// trabajando es irreversible, y el plugin ya tiene ese criterio tomado dos
// veces (`--requeue` exige que no queden ni worktree ni rama; F19 decidió no
// revertir un claim ante un centinela ausente). "Mergeado" no es lo mismo que
// "nadie está tocando eso": un humano puede tener cambios sin pushear en ese
// worktree, o el agente puede seguir escribiendo. Lo que NO es aceptable es
// que nadie lo mencione nunca — que es lo que pasaba. Así que se nombra, con
// los comandos exactos, y la decisión de ejecutarlos es humana.
//
// `mergedIssues` es la lista de issues cerrados como *completed* que ya usa el
// dispatcher para resolver `merge-after` — es decir, exactamente "los slices
// cuyo trabajo ya está en la base". No se inventa ninguna fuente nueva.
//
// Forma de cada entrada: `{ n, worktree, branch, hasWorktree, hasBranch,
// cmuxTitle }`. `cmuxTitle` es `null` si no se localizó sesión, y `undefined`
// no se usa nunca: "no se miró" viaja como `cmuxChecked: false` en el
// resultado global, no camuflado en una entrada.
export function collectFinishedResidue(mergedIssues, { worktreeDirs = [], branchNames = [], cmuxTitles = null, worktreePathOf, branchNameOf } = {}) {
  const dirs = new Set((worktreeDirs || []).map(String))
  const branches = new Set(branchNames || [])
  const out = []
  for (const n of mergedIssues || []) {
    if (n == null) continue
    const hasWorktree = dirs.has(String(n))
    const branch = branchNameOf ? branchNameOf(n) : `feat/${n}`
    const hasBranch = branches.has(branch)
    if (!hasWorktree && !hasBranch) continue
    // El título de la sesión de cmux lo construye este mismo dispatcher como
    // `<repo> · #<n> <nombre>`; aquí solo se busca el `#<n>` como token
    // completo para no casar #45 dentro de #451.
    const cmuxTitle = cmuxTitles === null
      ? null
      : (cmuxTitles.find((t) => new RegExp(`(^|\\s)#${n}(\\s|$)`).test(String(t))) ?? null)
    out.push({
      n,
      worktree: worktreePathOf ? worktreePathOf(n) : `.worktrees/${n}`,
      branch,
      hasWorktree,
      hasBranch,
      cmuxTitle,
    })
  }
  return out.sort((a, b) => a.n - b.n)
}

// formatFinishedResidueWarning: un solo aviso para toda la cosecha pendiente.
// Uno por slice serían seis líneas idénticas en un repo con seis slices
// terminados — el mismo criterio de F16/H1 sobre los bloqueantes: cuando la
// lista crece, lo accionable es el recuento y el comando, no el desglose.
// `null` = no hay nada que recoger (o no se pudo mirar, que lo dice quien
// llama).
export function formatFinishedResidueWarning(residue, { repo } = {}) {
  if (!residue || residue.length === 0) return null
  const conSesion = residue.filter((r) => r.cmuxTitle)
  const lineas = residue.map((r) => {
    const partes = []
    if (r.hasWorktree) partes.push(`worktree ${r.worktree}`)
    if (r.hasBranch) partes.push(`rama ${r.branch}`)
    if (r.cmuxTitle) partes.push(`sesión de cmux "${r.cmuxTitle}" todavía abierta`)
    return `  #${r.n}: ${partes.join(', ')}`
  })
  const comandos = residue.map((r) => {
    const cmds = []
    if (r.hasWorktree) cmds.push(`git worktree remove --force ${r.worktree}`)
    if (r.hasBranch) cmds.push(`git branch -D ${r.branch}`)
    return `  ${cmds.join(' && ')}`
  })
  const sesiones = conSesion.length
    ? `\n${conSesion.length} de ${conSesion.length === 1 ? 'ellos tiene' : 'ellos tienen'} además su sesión de cmux abierta: ese \`claude\` sigue vivo con el trabajo YA entregado (en el caso que originó esto llevaba trece horas). Ciérralas a mano cuando compruebes que no hay nada dentro — el loop crea agentes y hasta ahora no enterraba a ninguno.`
    : ''
  return `cosecha pendiente: ${residue.length} slice(s) de ${repo || 'este repo'} con el trabajo YA mergeado siguen dejando residuo en este checkout:\n${lineas.join('\n')}\nNo se borra solo, y es deliberado: un worktree puede tener cambios sin pushear, y borrarlo es irreversible (el mismo criterio por el que \`--requeue\` se niega a actuar mientras existan). Compruébalo y límpialo tú:\n${comandos.join('\n')}\nMientras siga ahí, \`/ct-next\` se NEGARÁ a redespachar cualquiera de esos números: el worktree existente es una precondición que corta el despacho.${sesiones}`
}
