import { describe, it, expect } from 'vitest'
import { statusTransitions, phaseDurations, countRequeues, countReopens, blockedEpisodes, formatDuration, harvestSlice, closingPrNumbers, STATUS_LADDER } from '../scripts/harvest.js'

// FIXTURES DEL DESPACHO 1 REAL (menoplus-app/menoplus, epic #602, 2026-08-12/13).
// No son inventados: son el timeline que devolvió `gh api .../timeline` para los
// cuatro slices, recortado a los campos que este módulo mira. Se usan tal cual
// porque la primera cosecha a mano encontró en ellos DOS formas que un fixture
// bonito no habría tenido — el empate de segundo con orden inestable (ver abajo)
// y el gate visual de 9h41 —, y perder esas formas al idealizar el fixture es
// exactamente cómo un cosechador pasa el test y miente sobre datos reales.

// Slice 1 (#659). Fíjate en 17:45:15: el `labeled status:ready` llega ANTES que
// el `unlabeled status:backlog` que lo acompaña.
const SLICE_1 = [
  { created_at: '2026-08-12T17:29:12Z', event: 'labeled', label: { name: 'area:proceso' } },
  { created_at: '2026-08-12T17:29:12Z', event: 'labeled', label: { name: 'touches:ci' } },
  { created_at: '2026-08-12T17:29:12Z', event: 'labeled', label: { name: 'status:backlog' } },
  { created_at: '2026-08-12T17:29:12Z', event: 'labeled', label: { name: 'type:infra' } },
  { created_at: '2026-08-12T17:29:13Z', event: 'labeled', label: { name: 'gate:apply' } },
  { created_at: '2026-08-12T17:45:15Z', event: 'labeled', label: { name: 'status:ready' } },
  { created_at: '2026-08-12T17:45:15Z', event: 'unlabeled', label: { name: 'status:backlog' } },
  { created_at: '2026-08-12T17:46:18Z', event: 'labeled', label: { name: 'status:in-progress' } },
  { created_at: '2026-08-12T17:46:18Z', event: 'unlabeled', label: { name: 'status:ready' } },
  { created_at: '2026-08-12T18:39:00Z', event: 'unlabeled', label: { name: 'status:in-progress' } },
  { created_at: '2026-08-12T18:39:00Z', event: 'labeled', label: { name: 'status:in-review' } },
  { created_at: '2026-08-12T18:45:58Z', event: 'closed', actor: { login: 'josemerca' } },
]

// Slice 2 (#660). MISMO segundo, ORDEN CONTRARIO: aquí el `unlabeled
// status:backlog` llega ANTES que el `labeled status:ready`. Los dos timelines
// salieron de la misma API con minutos de diferencia. Es la razón por la que la
// escalera se deriva SOLO de los `labeled`.
const SLICE_2 = [
  { created_at: '2026-08-12T17:29:15Z', event: 'labeled', label: { name: 'status:backlog' } },
  { created_at: '2026-08-12T19:12:36Z', event: 'unlabeled', label: { name: 'status:backlog' } },
  { created_at: '2026-08-12T19:12:36Z', event: 'labeled', label: { name: 'status:ready' } },
  { created_at: '2026-08-12T19:13:02Z', event: 'unlabeled', label: { name: 'status:ready' } },
  { created_at: '2026-08-12T19:13:02Z', event: 'labeled', label: { name: 'status:in-progress' } },
  { created_at: '2026-08-12T21:19:19Z', event: 'labeled', label: { name: 'status:in-review' } },
  { created_at: '2026-08-12T21:19:19Z', event: 'unlabeled', label: { name: 'status:in-progress' } },
  { created_at: '2026-08-12T21:30:32Z', event: 'closed', actor: { login: 'josemerca' } },
]

describe('statusTransitions — la escalera se deriva de los `labeled`, nunca de los `unlabeled`', () => {
  it('ignora los `unlabeled` de status: quedarse con ellos duplicaría cada peldaño', () => {
    expect(statusTransitions(SLICE_1).map((t) => t.status)).toEqual(['backlog', 'ready', 'in-progress', 'in-review'])
  })

  // ÉSTE es el test que justifica la decisión de diseño. Los dos timelines
  // reales traen el par (unlabeled viejo, labeled nuevo) en el MISMO segundo y
  // en orden CONTRARIO entre sí. Un cosechador que leyera `unlabeled` para
  // decidir "de qué estado salgo" derivaría un estado distinto para cada issue
  // sin que nada hubiera pasado distinto: ruido puro en la variable dependiente.
  it('el par unlabeled/labeled empatado a segundo da el mismo resultado en los dos órdenes observados', () => {
    const desde1 = statusTransitions(SLICE_1).map((t) => t.status)
    const desde2 = statusTransitions(SLICE_2).map((t) => t.status)
    expect(desde1).toEqual(desde2)
  })

  it('ignora labels que no son status: (area:, type:, gate:, touches:)', () => {
    const soloStatus = statusTransitions(SLICE_1).every((t) => STATUS_LADDER.includes(t.status) || t.status === 'blocked')
    expect(soloStatus).toBe(true)
  })

  it('devuelve los peldaños ordenados por tiempo aunque la API los entregue desordenados', () => {
    const revuelto = [...SLICE_1].reverse()
    expect(statusTransitions(revuelto).map((t) => t.status)).toEqual(['backlog', 'ready', 'in-progress', 'in-review'])
  })

  it('timeline vacío → sin peldaños, no un throw', () => {
    expect(statusTransitions([])).toEqual([])
  })
})

describe('phaseDurations — las tres fases del §6, en segundos', () => {
  it('slice 1: ready→claim 1m03, claim→release 52m42, release→merge 6m56', () => {
    const d = phaseDurations(statusTransitions(SLICE_1), { mergedAt: '2026-08-12T18:45:56Z' })
    expect(d.readyToClaim).toBe(63)
    expect(d.claimToRelease).toBe(3162)
    expect(d.releaseToMerge).toBe(416)
  })

  it('slice 2: el claim de 26s y las 2h06 de trabajo', () => {
    const d = phaseDurations(statusTransitions(SLICE_2), { mergedAt: '2026-08-12T21:30:31Z' })
    expect(d.readyToClaim).toBe(26)
    expect(d.claimToRelease).toBe(7577)
  })

  // La distinción que más importa de todo el módulo. Un slice que nunca llegó a
  // `in-review` NO tardó 0 segundos en llegar: no llegó. Emitir 0 metería un
  // dato falso en el denominador de cualquier media posterior — y el §6 dice
  // que la medida se cosecha, no se inventa.
  it('una fase que no ocurrió es null, JAMÁS 0', () => {
    const enVuelo = SLICE_1.filter((e) => e.label?.name !== 'status:in-review')
    const d = phaseDurations(statusTransitions(enVuelo), { mergedAt: null })
    expect(d.claimToRelease).toBeNull()
    expect(d.releaseToMerge).toBeNull()
    expect(d.readyToClaim).toBe(63)
  })

  // El gate visual del slice 3: 9h41m23 entre `in-review` y el merge, que no es
  // tiempo de máquina sino a Jose durmiendo. Se cosecha sin adorno; interpretarlo
  // es del desenlace, no del script.
  it('release→merge admite valores enormes sin recortarlos (gate visual nocturno: 9h41m23)', () => {
    const t = [
      { created_at: '2026-08-12T21:31:31Z', event: 'labeled', label: { name: 'status:ready' } },
      { created_at: '2026-08-12T21:31:51Z', event: 'labeled', label: { name: 'status:in-progress' } },
      { created_at: '2026-08-12T22:55:27Z', event: 'labeled', label: { name: 'status:in-review' } },
    ]
    const d = phaseDurations(statusTransitions(t), { mergedAt: '2026-08-13T08:36:50Z' })
    expect(d.releaseToMerge).toBe(34883)
  })

  // Sin PR mergeado no hay `mergedAt`. El cierre del issue es el sustituto
  // razonable (en este loop el `Closes` del kickoff los ata), pero NO es lo
  // mismo y quien lea la fila tiene que poder distinguirlo.
  it('sin mergedAt cae al cierre del issue y lo DECLARA en mergeSource', () => {
    const d = phaseDurations(statusTransitions(SLICE_1), { mergedAt: null, closedAt: '2026-08-12T18:45:58Z' })
    expect(d.releaseToMerge).toBe(418)
    expect(d.mergeSource).toBe('issue-closed')
  })

  it('con mergedAt, mergeSource lo dice también — la procedencia nunca es implícita', () => {
    const d = phaseDurations(statusTransitions(SLICE_1), { mergedAt: '2026-08-12T18:45:56Z' })
    expect(d.mergeSource).toBe('pr-merged')
  })

  it('ni mergedAt ni closedAt → releaseToMerge null y mergeSource null', () => {
    const d = phaseDurations(statusTransitions(SLICE_1), {})
    expect(d.releaseToMerge).toBeNull()
    expect(d.mergeSource).toBeNull()
  })
})

describe('countRequeues — un peldaño hacia atrás en la escalera', () => {
  it('el despacho 1 entero: cero requeues en los cuatro slices', () => {
    expect(countRequeues(statusTransitions(SLICE_1))).toBe(0)
    expect(countRequeues(statusTransitions(SLICE_2))).toBe(0)
  })

  it('in-review → in-progress cuenta 1 (el slice devuelto por la review)', () => {
    const t = [...SLICE_1, { created_at: '2026-08-12T19:00:00Z', event: 'labeled', label: { name: 'status:in-progress' } }]
    expect(countRequeues(statusTransitions(t))).toBe(1)
  })

  it('in-progress → ready también cuenta (el claim soltado)', () => {
    const t = [...SLICE_2, { created_at: '2026-08-12T22:00:00Z', event: 'labeled', label: { name: 'status:ready' } }]
    expect(countRequeues(statusTransitions(t))).toBe(1)
  })

  // `blocked` no vive en la escalera: entrar en blocked no es retroceder, es
  // salirse. Contarlo como requeue mezclaría dos fenómenos que el §6 pregunta
  // por separado (pregunta 3: reopens/blocked).
  it('pasar por blocked NO cuenta como requeue', () => {
    const t = [
      { created_at: '2026-08-12T17:45:15Z', event: 'labeled', label: { name: 'status:ready' } },
      { created_at: '2026-08-12T17:46:18Z', event: 'labeled', label: { name: 'status:in-progress' } },
      { created_at: '2026-08-12T18:00:00Z', event: 'labeled', label: { name: 'status:blocked' } },
      { created_at: '2026-08-12T19:00:00Z', event: 'labeled', label: { name: 'status:in-progress' } },
    ]
    expect(countRequeues(statusTransitions(t))).toBe(0)
  })
})

describe('countReopens', () => {
  it('el despacho 1: cero', () => {
    expect(countReopens(SLICE_1)).toBe(0)
  })
  it('cuenta los eventos `reopened`, que son de issue y no de label', () => {
    expect(countReopens([...SLICE_1, { created_at: '2026-08-13T09:00:00Z', event: 'reopened', actor: { login: 'josemerca' } }])).toBe(1)
  })
})

describe('blockedEpisodes — el ÚNICO sitio donde los `unlabeled` sí se leen', () => {
  // Coherencia deliberada, no excepción: la escalera es una máquina de estados
  // (cada `labeled` marca la entrada a un peldaño y el `unlabeled` es
  // redundante), mientras que blocked es un INTERVALO cuyo final solo lo marca
  // la retirada del label. Por eso una lo ignora y la otra lo necesita.
  it('el despacho 1: ningún episodio en los cuatro slices — A3 sin evidencia', () => {
    expect(blockedEpisodes(SLICE_1)).toEqual([])
  })

  it('un episodio cerrado trae inicio, fin y duración', () => {
    const t = [
      { created_at: '2026-08-12T18:00:00Z', event: 'labeled', label: { name: 'status:blocked' } },
      { created_at: '2026-08-12T19:30:00Z', event: 'unlabeled', label: { name: 'status:blocked' } },
    ]
    expect(blockedEpisodes(t)).toEqual([{ from: '2026-08-12T18:00:00Z', to: '2026-08-12T19:30:00Z', seconds: 5400 }])
  })

  // Un blocked que sigue abierto es el caso que MÁS importa ver — es un slice
  // parado ahora mismo. Emitirlo con seconds:null y to:null lo hace visible;
  // omitirlo lo escondería justo cuando duele.
  it('un episodio todavía abierto se emite con to y seconds a null, no se omite', () => {
    const t = [{ created_at: '2026-08-12T18:00:00Z', event: 'labeled', label: { name: 'status:blocked' } }]
    expect(blockedEpisodes(t)).toEqual([{ from: '2026-08-12T18:00:00Z', to: null, seconds: null }])
  })

  it('dos episodios separados son dos, no uno largo', () => {
    const t = [
      { created_at: '2026-08-12T18:00:00Z', event: 'labeled', label: { name: 'status:blocked' } },
      { created_at: '2026-08-12T18:30:00Z', event: 'unlabeled', label: { name: 'status:blocked' } },
      { created_at: '2026-08-12T20:00:00Z', event: 'labeled', label: { name: 'status:blocked' } },
      { created_at: '2026-08-12T20:15:00Z', event: 'unlabeled', label: { name: 'status:blocked' } },
    ]
    expect(blockedEpisodes(t)).toHaveLength(2)
  })
})

describe('formatDuration — la forma en que el desenlace del despacho 1 quedó escrito', () => {
  it('63 → 1m03', () => expect(formatDuration(63)).toBe('1m03'))
  it('3162 → 52m42', () => expect(formatDuration(3162)).toBe('52m42'))
  it('7577 → 2h06m17', () => expect(formatDuration(7577)).toBe('2h06m17'))
  it('34883 → 9h41m23', () => expect(formatDuration(34883)).toBe('9h41m23'))
  it('14 → 0m14, con el minuto explícito para que la columna alinee', () => expect(formatDuration(14)).toBe('0m14'))
  // null no es 0 aquí tampoco: la fila tiene que poder decir «no ocurrió».
  it('null → «—», nunca «0m00»', () => expect(formatDuration(null)).toBe('—'))
})

describe('closingPrNumbers — qué PR cerró el issue lo dice GitHub, no una heurística', () => {
  // ESTE TEST EXISTE POR UN BUG MEDIDO, no por precaución. La primera versión
  // de /ct-harvest resolvía el PR escaneando los `cross-referenced` del
  // timeline y quedándose con el último mergeado. Corrida contra el epic #602
  // real dio: #659→PR #665 y #660→PR #666, cuando los buenos eran #663 y #665.
  // La causa: un issue acumula referencias de PRs POSTERIORES que simplemente
  // lo MENCIONAN (el PR del slice siguiente cita al anterior), y "el último
  // mergeado" premia justamente a ésos. La cosecha salía verde y mentía — que
  // es el modo de fallo que este comando entero existe para no tener.
  //
  // La respuesta correcta no se deduce: se pregunta. GitHub mantiene
  // `closedByPullRequestsReferences` precisamente para esto.
  it('lee el campo que GitHub publica, sin heurística de recencia', () => {
    const issue = { number: 659, closedByPullRequestsReferences: [{ number: 663, repository: { name: 'menoplus', owner: { login: 'menoplus-app' } } }] }
    expect(closingPrNumbers(issue, 'menoplus-app/menoplus')).toEqual([663])
  })

  it('un issue sin PR que lo cierre (cerrado a mano, o en vuelo) → lista vacía, no null', () => {
    expect(closingPrNumbers({ number: 1, closedByPullRequestsReferences: [] }, 'o/r')).toEqual([])
    expect(closingPrNumbers({ number: 1 }, 'o/r')).toEqual([])
  })

  // Un PR de OTRO repo puede cerrar un issue de éste. Contarlo aquí traería
  // tamaños y reviews de un repo distinto a una tabla que dice ser de éste.
  it('descarta referencias de otro repositorio', () => {
    const issue = { number: 1, closedByPullRequestsReferences: [
      { number: 99, repository: { name: 'otro', owner: { login: 'menoplus-app' } } },
      { number: 663, repository: { name: 'menoplus', owner: { login: 'menoplus-app' } } },
    ] }
    expect(closingPrNumbers(issue, 'menoplus-app/menoplus')).toEqual([663])
  })

  // Dos PRs cerrando un mismo issue es raro y es señal: se devuelven los dos
  // para que el llamante lo pueda decir en voz alta, en vez de elegir uno en
  // silencio y perder el hallazgo.
  it('varios PRs cerrando el mismo issue se devuelven TODOS — es una anomalía que hay que ver', () => {
    const issue = { number: 1, closedByPullRequestsReferences: [
      { number: 10, repository: { name: 'r', owner: { login: 'o' } } },
      { number: 11, repository: { name: 'r', owner: { login: 'o' } } },
    ] }
    expect(closingPrNumbers(issue, 'o/r')).toEqual([10, 11])
  })
})

describe('harvestSlice — la fila entera, tal como salió a mano en el desenlace', () => {
  const ISSUE_1 = {
    number: 659,
    title: '#1 Encender, medir y vigilar',
    closedAt: '2026-08-12T18:45:58Z',
    labels: [{ name: 'area:proceso' }, { name: 'touches:ci' }, { name: 'type:infra' }, { name: 'gate:apply' }, { name: 'status:in-review' }],
    milestone: { title: 'V1 · M7.5 — Guardarraíles de ortografía española' },
  }
  const PR_1 = { number: 663, mergedAt: '2026-08-12T18:45:56Z', additions: 876, deletions: 67, changedFiles: 4, reviews: 0, reviewComments: 0 }

  it('reproduce la fila del slice 1 sin un solo campo manual', () => {
    const fila = harvestSlice({ events: SLICE_1, issue: ISSUE_1, pr: PR_1 })
    expect(fila.issue).toBe(659)
    expect(fila.type).toBe('infra')
    expect(fila.gate).toBe('apply')
    expect(fila.readyToClaim).toBe(63)
    expect(fila.claimToRelease).toBe(3162)
    expect(fila.releaseToMerge).toBe(416)
    expect(fila.mergeSource).toBe('pr-merged')
    expect(fila.reopens).toBe(0)
    expect(fila.requeues).toBe(0)
    expect(fila.blocked).toEqual([])
    expect(fila.pr).toBe(663)
    expect(fila.additions).toBe(876)
    expect(fila.changedFiles).toBe(4)
  })

  // El `Tipo` es la unidad de reporte que exigen las reglas de honestidad del
  // §6 («reportar por familia, nunca agregado»). Si no viaja en la fila, el
  // agregado deshonesto es el camino de menor resistencia para quien la lea.
  it('emite `type` y `gate` porque el §6 obliga a reportar por familia', () => {
    const fila = harvestSlice({ events: SLICE_1, issue: ISSUE_1, pr: PR_1 })
    expect(fila).toHaveProperty('type')
    expect(fila).toHaveProperty('gate')
  })

  it('sin PR (slice en vuelo) la fila sale igual, con los huecos en null', () => {
    const fila = harvestSlice({ events: SLICE_1, issue: { ...ISSUE_1, closedAt: null }, pr: null })
    expect(fila.pr).toBeNull()
    expect(fila.additions).toBeNull()
    expect(fila.releaseToMerge).toBeNull()
    expect(fila.claimToRelease).toBe(3162)
  })

  it('un issue sin label type: no inventa una familia', () => {
    const fila = harvestSlice({ events: SLICE_1, issue: { ...ISSUE_1, labels: [{ name: 'status:in-review' }] }, pr: PR_1 })
    expect(fila.type).toBeNull()
    expect(fila.gate).toBeNull()
  })
})
