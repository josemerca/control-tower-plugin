// Lógica pura del claim endurecido (labels GitHub como lock).
function tokensOf(labels) {
  return (labels || []).filter((l) => l.startsWith('area:') || l.startsWith('touches:'))
}

export function conflictTokens(candLabels, otherLabels) {
  const other = new Set(tokensOf(otherLabels))
  return tokensOf(candLabels).filter((t) => other.has(t))
}

// ============================================================================
// F13/H2 — LA VENTANA DEL CERROJO ERA MÁS CORTA QUE LA VENTANA DEL CONFLICTO.
//
// Antes, el único estado que retenía tokens era `status:in-progress`. Pero el
// kickoff manda al agente ejecutar `--release` AL ABRIR EL PR (kickoff.js), y
// `--release` mueve a `status:in-review`. Entre ese instante y el MERGE hay
// una ventana —minutos, horas o días— en la que:
//   - el candidato siguiente ve su área libre y se despacha;
//   - `/ct-next` ramifica `feat/<n>` de la base (`main`), que TODAVÍA NO
//     contiene el trabajo del anterior;
//   - dos ramas vivas tocan el mismo dominio, sin que ninguna regla lo impida.
// Reproducido contra el código sin arreglar: `detectCollisions(['touches:db'],
// [{n:5, labels:['status:in-review','touches:db']}])` devolvía `[]`.
//
// POR QUÉ ESTA OPCIÓN Y NO "MANTENER EL CLAIM HASTA EL MERGE". La otra vía
// obvia era no soltar `in-progress` hasta el merge (que el agente NO llame a
// `--release` al abrir el PR). Se descarta por dos razones:
//   1. `in-progress` es también la moneda del CAP (`collectInFlight` en
//      dispatch.js). Un PR que tarda tres días en revisarse consumiría un
//      hueco de concurrencia durante tres días — pero no hay ningún agente
//      corriendo ahí: el cap mide AGENTES VIVOS, y ese es un recurso real y
//      distinto. Fundir los dos recursos en un solo label hace que arreglar
//      uno rompa el otro.
//   2. La detección de claims rancios (`stalenessNote` en ct-next.mjs) trata
//      un `in-progress` sin worktree/rama/sesión como posiblemente huérfano.
//      Un PR en revisión SIN sesión viva es lo NORMAL, no una anomalía: con
//      la otra vía, cada slice en revisión dispararía una falsa alarma de
//      claim huérfano.
// Por eso se separan los dos recursos: `in-review` retiene TOKENS (el
// conflicto de contenido dura hasta el merge, igual que `merge-after`) pero
// NO consume CAP (no hay agente vivo que contar). Un estado, dos
// contabilidades distintas, cada una con su propio criterio.
//
// CONSECUENCIA QUE HAY QUE DECIR EN VOZ ALTA (y se dice: ct-next.mjs
// distingue el mensaje de colisión contra `in-review` del de `in-progress`):
// esto ESTRECHA lo que el loop acepta. Un slice que antes salía mientras el
// PR anterior estaba en revisión, ahora espera al merge. Es deliberado —
// ramificar de una base sin el trabajo del que dependes es exactamente lo que
// `merge-after` existe para impedir— y crea una categoría nueva de rechazo
// ("bloqueado por un PR abierto") que necesita voz propia, no el genérico
// "espera a que termine".
//
// Y una segunda categoría, hija de la primera: un PR YA MERGEADO cuyo issue
// nadie cerró (el PR no llevaba "Closes #N") se queda en `in-review` para
// siempre reteniendo sus tokens. Antes eso era inocuo; ahora bloquea. El
// mensaje de colisión contra `in-review` lo nombra explícitamente y da el
// comando para cerrarlo.
// ============================================================================
export const CLAIM_HOLDING_STATUSES = ['status:in-progress', 'status:in-review']

// holdingStatusOf: cuál de los estados que retienen tokens tiene este issue,
// o `null` si ninguno. Devuelve el estado (no un booleano) porque quien
// pregunta necesita poder DECIR cuál es: "hay un agente trabajándolo" y "su
// PR está abierto sin mergear" son dos situaciones con dos remedios
// distintos, y colapsarlas en "colisiona" fue justo lo que dejó la ventana
// sin nombre durante toda la vida del loop.
export function holdingStatusOf(labels) {
  const ls = labels || []
  return CLAIM_HOLDING_STATUSES.find((s) => ls.includes(s)) ?? null
}

export function detectCollisions(candLabels, openIssues) {
  const out = []
  for (const iss of openIssues) {
    const status = holdingStatusOf(iss.labels)
    if (!status) continue
    const tokens = conflictTokens(candLabels, iss.labels)
    if (tokens.length) out.push({ n: iss.n, tokens, status })
  }
  return out
}

// claimLost sigue mirando SOLO `status:in-progress`, a propósito (F13/H2 —
// no es un olvido). Es un DESEMPATE entre dos claimants simultáneos, no una
// comprobación de conflicto: los dos están en `in-progress` por definición
// (acaban de escribir su claim). Un issue en `in-review` no está compitiendo
// por nada — ya ganó su claim hace rato y lo soltó a medias — y
// `detectCollisions` (paso 1, ANTES de escribir) ya lo ve y aborta, así que
// nunca se llega aquí con un `in-review` colisionante por delante. Ampliar el
// desempate a `in-review` solo añadiría una forma de perder una carrera
// contra alguien que no está corriendo.
export function claimLost(readback, self) {
  const mine = readback.find((i) => i.n === self)
  // Nuestro issue no aparece en el readback → estado ambiguo, no bloqueamos.
  if (!mine) return false
  for (const iss of readback) {
    if (iss.n === self) continue
    if (!(iss.labels || []).includes('status:in-progress')) continue
    const shared = conflictTokens(mine.labels, iss.labels).length > 0
    if (shared && iss.n < self) return true // desempate determinista: gana el menor número
  }
  return false
}
