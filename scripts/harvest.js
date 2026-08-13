// COSECHA de las variables dependientes del pre-registro (§6 del handoff F32):
// ready→claim, claim→release, release→merge, reopens, requeues, episodios
// blocked, tamaño del PR y comentarios de review.
//
// LA REGLA QUE GOBIERNA TODO ESTE FICHERO: la medida se COSECHA, no se captura.
// Cero campos manuales nuevos. Todo lo de aquí sale del timeline que GitHub ya
// escribe solo cada vez que el loop mueve una label. El único campo manual de
// la medida —los minutos de intervención humana— vive en el desenlace del epic
// y NO entra aquí a propósito: en cuanto un cosechador admite un campo a mano,
// se convierte en un formulario y muere como murió docs/medicion-slices.md.
//
// Se escribió DESPUÉS del despacho 1, no antes, y eso se nota en las decisiones:
// las tres de abajo existen porque la primera cosecha (hecha a mano sobre el
// epic #602 de menoplus, 2026-08-12/13) se topó con ellas. Ninguna se dedujo.
//
// Este módulo es PURO: no toca red ni disco. La IO vive en ct-harvest.mjs. Es
// la misma separación que gh-issue-map.js/loop-issues.js y por el mismo motivo
// (poder testear la lógica contra timelines reales sin red).

// La escalera del loop, en orden. El índice ES el peldaño: retroceder en él es
// lo que este módulo llama requeue.
//
// `blocked` NO está en la lista, y es deliberado: entrar en blocked no es
// retroceder, es salirse de la escalera. Mezclarlo con los requeues juntaría
// dos fenómenos que el §6 pregunta por separado.
export const STATUS_LADDER = ['backlog', 'ready', 'in-progress', 'in-review']

const STATUS_PREFIX = 'status:'

// DECISIÓN 1, la que más datos salva: la escalera se deriva SOLO de los
// eventos `labeled`.
//
// Medido en el despacho 1: el par (unlabeled del estado viejo, labeled del
// nuevo) llega EMPATADO AL SEGUNDO y el orden entre ambos NO es estable entre
// issues. En el #659 el `labeled status:ready` precede al `unlabeled
// status:backlog`; en el #660, minutos después y por la misma API, el orden es
// el contrario. Un cosechador que leyera los `unlabeled` para decidir "de qué
// estado salgo" derivaría estados distintos para dos issues a los que no les
// pasó nada distinto: ruido puro inyectado en la variable dependiente.
//
// Con `labeled` solo, el empate deja de importar: cada peldaño se marca por su
// entrada, que es un evento único y sin pareja.
export function statusTransitions(events) {
  return (events || [])
    .filter((e) => e && e.event === 'labeled' && typeof e.label?.name === 'string' && e.label.name.startsWith(STATUS_PREFIX))
    .map((e) => ({ at: e.created_at, status: e.label.name.slice(STATUS_PREFIX.length) }))
    // La API los devuelve en orden cronológico, pero ordenar es barato y no
    // depender de ello evita que una paginación futura o un `--slurp` que
    // concatene páginas al revés produzca duraciones NEGATIVAS en silencio.
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

// Primera entrada a un peldaño. La PRIMERA, no la última: si un slice vuelve a
// `in-progress` tras una review, la fase claim→release del ciclo original sigue
// siendo la que va de su primer claim a su primera release. El retroceso se
// cuenta aparte, en countRequeues, en vez de deformar la duración.
function firstAt(transiciones, status) {
  const t = transiciones.find((x) => x.status === status)
  return t ? t.at : null
}

function segundosEntre(desde, hasta) {
  if (!desde || !hasta) return null
  const d = Date.parse(desde)
  const h = Date.parse(hasta)
  if (Number.isNaN(d) || Number.isNaN(h)) return null
  return Math.round((h - d) / 1000)
}

// Las tres fases del §6, en segundos.
//
// DECISIÓN 2: una fase que no ocurrió vale `null`, JAMÁS 0. Un slice que nunca
// llegó a `in-review` no tardó cero segundos en llegar: no llegó. Emitir 0
// metería un dato falso en el denominador de cualquier media posterior, y con N
// pequeña —que es todo lo que esta medida va a tener— un cero inventado mueve
// la media más que el dato real que sustituye.
//
// DECISIÓN 3: `release→merge` prefiere el merge del PR y, si no lo hay, cae al
// cierre del issue DECLARÁNDOLO en `mergeSource`. En este loop el `Closes` del
// kickoff ata los dos eventos (van a segundos uno de otro), pero no son la
// misma cosa: un issue puede cerrarse a mano sin merge. Quien lea la fila tiene
// que poder distinguir la medida de su sustituto — la procedencia nunca es
// implícita, que es la misma regla que el §4.2 impone a las decisiones.
export function phaseDurations(transiciones, { mergedAt = null, closedAt = null } = {}) {
  const ready = firstAt(transiciones, 'ready')
  const claim = firstAt(transiciones, 'in-progress')
  const release = firstAt(transiciones, 'in-review')

  const fin = mergedAt || closedAt || null
  const mergeSource = mergedAt ? 'pr-merged' : (closedAt ? 'issue-closed' : null)

  return {
    readyToClaim: segundosEntre(ready, claim),
    claimToRelease: segundosEntre(claim, release),
    releaseToMerge: segundosEntre(release, fin),
    mergeSource: release && fin ? mergeSource : null,
  }
}

// Un requeue es un peldaño hacia atrás: `in-review` → `in-progress` (la review
// devolvió el slice) o `in-progress` → `ready` (alguien soltó el claim).
//
// Los estados fuera de la escalera (hoy solo `blocked`) no participan: ni
// cuentan como retroceso al entrar, ni el peldaño desde el que se volvió se
// pierde. Por eso el "último peldaño visto" solo se actualiza con estados que
// SÍ están en la escalera.
export function countRequeues(transiciones) {
  let ultimo = -1
  let n = 0
  for (const t of transiciones) {
    const i = STATUS_LADDER.indexOf(t.status)
    if (i === -1) continue
    if (ultimo !== -1 && i < ultimo) n += 1
    ultimo = i
  }
  return n
}

// Reopens: evento de issue, no de label. Va aparte de los requeues porque
// responde a otra pregunta del §6 (la 2: ¿el spec reduce la ambigüedad o la
// desplaza?) y agregarlos escondería cuál de los dos se movió.
export function countReopens(events) {
  return (events || []).filter((e) => e && e.event === 'reopened').length
}

// Episodios de `status:blocked` — la arista de vuelta (A3 del handoff).
//
// ÉSTE es el único sitio del módulo donde los `unlabeled` SÍ se leen, y no es
// una excepción a la decisión 1 sino su otra cara: la escalera es una máquina
// de estados donde cada `labeled` marca la entrada a un peldaño y el
// `unlabeled` es redundante; blocked es un INTERVALO, y el final de un
// intervalo solo lo marca la retirada del label. Una lo ignora porque le sobra;
// la otra lo necesita porque es su única fuente.
//
// Un episodio todavía abierto se emite con `to`/`seconds` en null en vez de
// omitirse: un slice bloqueado AHORA es justo el que hay que ver.
export function blockedEpisodes(events) {
  const episodios = []
  const ordenados = (events || [])
    .filter((e) => e && e.label?.name === 'status:blocked' && (e.event === 'labeled' || e.event === 'unlabeled'))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))

  let abierto = null
  for (const e of ordenados) {
    if (e.event === 'labeled') {
      // Un `labeled` sobre un episodio ya abierto no abre otro: GitHub no
      // reetiqueta lo ya etiquetado, así que si aparece es un duplicado de la
      // API y contarlo inflaría los episodios.
      if (!abierto) abierto = { from: e.created_at, to: null, seconds: null }
    } else if (abierto) {
      abierto.to = e.created_at
      abierto.seconds = segundosEntre(abierto.from, e.created_at)
      episodios.push(abierto)
      abierto = null
    }
  }
  if (abierto) episodios.push(abierto)
  return episodios
}

// `1m03`, `52m42`, `2h06m17`, `9h41m23` — la forma exacta en que quedó escrito
// el desenlace del despacho 1, para que la tabla cosechada y la escrita a mano
// se puedan comparar sin traducir.
//
// El minuto se imprime siempre, incluso por debajo de 60s (`0m14`): sin él la
// columna deja de alinear y el ojo compara mal, que es la mitad de para qué
// existe una tabla.
export function formatDuration(segundos) {
  if (segundos === null || segundos === undefined) return '—'
  const s = Math.max(0, Math.round(segundos))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const dosCifras = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}h${dosCifras(m)}m${dosCifras(sec)}` : `${m}m${dosCifras(sec)}`
}

// Qué PR cerró el issue. NO se deduce del timeline: se pregunta.
//
// La primera versión de /ct-harvest lo deducía —escaneaba los
// `cross-referenced` y se quedaba con el último PR mergeado— y contra el epic
// #602 real ató el issue #659 al PR #665 y el #660 al #666, cuando los buenos
// eran el #663 y el #665. La causa es estructural, no un descuido: cada PR de
// un slice cita al slice anterior, así que el issue viejo acumula referencias
// de PRs POSTERIORES y "el último mergeado" premia exactamente a los
// equivocados. La tabla salía verde y con los tamaños de PR cambiados de sitio.
//
// GitHub publica `closedByPullRequestsReferences` justamente para esto. Se lee
// tal cual y no se adivina nada.
//
// Se devuelven TODAS las referencias del propio repo, no una: dos PRs cerrando
// el mismo issue es una anomalía, y el llamante tiene que poder decirla en voz
// alta en vez de elegir en silencio y perder el hallazgo.
export function closingPrNumbers(issue, repo) {
  const refs = issue?.closedByPullRequestsReferences || []
  return refs
    .filter((r) => {
      if (!r || typeof r.number !== 'number') return false
      // Sin repo declarado en la referencia, se acepta: es el caso normal
      // dentro del mismo repositorio en algunas respuestas de la API.
      const owner = r.repository?.owner?.login
      const name = r.repository?.name
      if (!owner || !name) return true
      return `${owner}/${name}` === repo
    })
    .map((r) => r.number)
}

function labelValue(labels, prefijo) {
  const l = (labels || []).find((x) => typeof x?.name === 'string' && x.name.startsWith(prefijo))
  return l ? l.name.slice(prefijo.length) : null
}

// La fila entera de un slice, lista para una tabla o un CSV.
//
// `type` y `gate` viajan en la fila porque las reglas de honestidad del §6
// obligan a reportar POR FAMILIA y nunca agregado. Si la familia no viaja con
// el dato, el agregado deshonesto es el camino de menor resistencia para quien
// lea la cosecha — y es exactamente el error (FDR 0,08–0,31 de POSTCONDBENCH)
// que esa regla existe para evitar.
//
// Un issue sin label `type:` emite `type: null`, no una familia inventada ni la
// cadena vacía: una fila sin familia tiene que ser visiblemente inclasificable,
// no colarse en un bucket.
export function harvestSlice({ events, issue, pr }) {
  const transiciones = statusTransitions(events)
  const fases = phaseDurations(transiciones, { mergedAt: pr?.mergedAt || null, closedAt: issue?.closedAt || null })

  return {
    issue: issue?.number ?? null,
    title: issue?.title ?? null,
    milestone: issue?.milestone?.title ?? null,
    type: labelValue(issue?.labels, 'type:'),
    gate: labelValue(issue?.labels, 'gate:'),
    area: labelValue(issue?.labels, 'area:'),

    readyToClaim: fases.readyToClaim,
    claimToRelease: fases.claimToRelease,
    releaseToMerge: fases.releaseToMerge,
    mergeSource: fases.mergeSource,

    reopens: countReopens(events),
    requeues: countRequeues(transiciones),
    blocked: blockedEpisodes(events),

    pr: pr?.number ?? null,
    additions: pr?.additions ?? null,
    deletions: pr?.deletions ?? null,
    changedFiles: pr?.changedFiles ?? null,
    reviews: pr?.reviews ?? null,
    reviewComments: pr?.reviewComments ?? null,
  }
}
