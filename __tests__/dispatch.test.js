import { describe, it, expect } from 'vitest'
import { selectNext, resolveAccount, buildCmuxArgv, collectInFlight, planDispatch, computeReadyCandidates } from '../scripts/dispatch.js'

const ISSUES = [
  { n: 1, order: 1, status: 'in-review', deps: [], touches: ['api'] },
  { n: 2, order: 2, status: 'ready',     deps: [1], touches: ['api'] },
  { n: 3, order: 3, status: 'ready',     deps: [],  touches: ['ui'] },
  { n: 4, order: 4, status: 'ready',     deps: [],  touches: ['migration'] },
  { n: 5, order: 5, status: 'ready',     deps: [],  touches: ['migration'] },
]

// computeReadyCandidates: fix round 1 de la review de W-B (finding Important
// — la duplicación del filtro ready/deps-mergeadas entre selectNext y
// explainNoSelection era un riesgo de deriva silenciosa). Ahora es la única
// fuente de verdad de ese cómputo; estos tests la cubren directamente.
// (Fix round 2, finding 1: la nota que había aquí antes afirmaba que no
// existía una comprobación de comportamiento barata capaz de detectar una
// futura divergencia entre selectNext y explainNoSelection — la review
// corrigió eso, con razón: SÍ la hay, ver el describe
// 'explainNoSelection / selectNext — oráculo de identidad de candidato' más
// abajo, que compara contra el selectNext REAL, no contra este mismo
// helper.)
describe('computeReadyCandidates', () => {
  it('ready: solo status:ready, en el orden original', () => {
    const { ready } = computeReadyCandidates(ISSUES, [1])
    expect(ready.map((i) => i.n)).toEqual([2, 3, 4, 5])
  })
  it('readyDepsMet: además filtra por deps mergeadas, ordenado por `order` ascendente', () => {
    const { readyDepsMet } = computeReadyCandidates(ISSUES, [])
    expect(readyDepsMet.map((i) => i.n)).toEqual([3, 4, 5]) // #2 fuera: dep #1 no mergeada
  })
  it('con deps mergeadas, readyDepsMet incluye también al que las tenía pendientes', () => {
    const { readyDepsMet } = computeReadyCandidates(ISSUES, [1])
    expect(readyDepsMet.map((i) => i.n)).toEqual([2, 3, 4, 5])
  })
  it('sin ningún ready → ambos arrays vacíos', () => {
    const issues = [{ n: 1, order: 1, status: 'in-review', deps: [], touches: [] }]
    const { ready, readyDepsMet } = computeReadyCandidates(issues, [])
    expect(ready).toEqual([])
    expect(readyDepsMet).toEqual([])
  })
  // Fix round 2, finding 2: en TODOS los fixtures de este fichero (los viejos
  // y los tres de arriba), el orden del array de entrada ya coincide con el
  // orden del campo `order` — así que una implementación que filtrara bien
  // pero se olvidara del `.sort` pasaría igualmente todos los tests
  // existentes. Este fixture entra deliberadamente DESORDENADO respecto a
  // `order` (30, 10, 20) para que la aserción solo pueda pasar si de verdad
  // se ordena.
  it('readyDepsMet sale ordenado por `order` ascendente aunque el array de entrada venga desordenado', () => {
    const issues = [
      { n: 100, order: 30, status: 'ready', deps: [], touches: [] },
      { n: 200, order: 10, status: 'ready', deps: [], touches: [] },
      { n: 300, order: 20, status: 'ready', deps: [], touches: [] },
    ]
    const { readyDepsMet } = computeReadyCandidates(issues, [])
    expect(readyDepsMet.map((i) => i.order)).toEqual([10, 20, 30])
    expect(readyDepsMet.map((i) => i.n)).toEqual([200, 300, 100])
  })
})

describe('selectNext', () => {
  it('no elige un slice cuya dep no está mergeada', () => {
    const out = selectNext(ISSUES, { mergedIssues: [], runningTouches: [], concurrencyCap: 5 })
    expect(out.find((i) => i.n === 2)).toBeUndefined() // dep #1 no mergeada
  })
  it('elige el slice con dep mergeada', () => {
    const out = selectNext(ISSUES, { mergedIssues: [1], runningTouches: [], concurrencyCap: 5 })
    expect(out.some((i) => i.n === 2)).toBe(true)
  })
  it('paraleliza touches disjuntos hasta el cap', () => {
    const out = selectNext(ISSUES, { mergedIssues: [1], runningTouches: [], concurrencyCap: 2 })
    expect(out).toHaveLength(2)
  })
  it('serializa touches:migration (solo uno de #4/#5)', () => {
    const out = selectNext(ISSUES, { mergedIssues: [1], runningTouches: [], concurrencyCap: 9 })
    const migs = out.filter((i) => i.touches.includes('migration'))
    expect(migs).toHaveLength(1)
    expect(migs[0].n).toBe(4) // el de menor orden
  })
  it('no elige si su touches choca con runningTouches', () => {
    const out = selectNext(ISSUES, { mergedIssues: [1], runningTouches: ['api'], concurrencyCap: 9 })
    expect(out.find((i) => i.n === 2)).toBeUndefined()
  })
  it('respeta orden ascendente', () => {
    const out = selectNext(ISSUES, { mergedIssues: [1], runningTouches: [], concurrencyCap: 9 })
    expect(out.map((i) => i.n)).toEqual([...out.map((i) => i.n)].sort((a, b) => a - b))
  })
  it('serialización cross-type: solo uno de touches:ci o touches:migration', () => {
    const issues = [
      { n: 1, order: 1, status: 'ready', deps: [], touches: ['ci'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['migration'] },
    ]
    const out = selectNext(issues, { mergedIssues: [], runningTouches: [], concurrencyCap: 9 })
    const serializingCount = out.filter((i) => i.touches.some((t) => ['ci', 'migration'].includes(t))).length
    expect(serializingCount).toBe(1)
    expect(out[0].n).toBe(1) // menor orden
  })
  it('runningTouches:migration bloquea candidato con touches:ci', () => {
    const issues = [
      { n: 1, order: 1, status: 'ready', deps: [], touches: ['ci'] },
    ]
    const out = selectNext(issues, { mergedIssues: [], runningTouches: ['migration'], concurrencyCap: 9 })
    expect(out.find((i) => i.n === 1)).toBeUndefined()
  })
  it('no-serializing disjuntos se paralelizan (control negativo)', () => {
    const issues = [
      { n: 1, order: 1, status: 'ready', deps: [], touches: ['api'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['ui'] },
    ]
    const out = selectNext(issues, { mergedIssues: [], runningTouches: [], concurrencyCap: 2 })
    expect(out).toHaveLength(2)
  })
})

describe('collectInFlight', () => {
  it('recoge solo los issues en status:in-progress, con sus touches', () => {
    const issues = [
      { n: 1, status: 'in-progress', touches: ['api', 'ui'] },
      { n: 2, status: 'ready', touches: ['db'] },
      { n: 3, status: 'in-progress', touches: [] },
    ]
    expect(collectInFlight(issues)).toEqual([
      { n: 1, touches: ['api', 'ui'] },
      { n: 3, touches: [] },
    ])
  })
  it('issue in-progress sin touches → touches: []', () => {
    expect(collectInFlight([{ n: 1, status: 'in-progress' }])).toEqual([{ n: 1, touches: [] }])
  })
  it('sin ningún in-progress → []', () => {
    expect(collectInFlight([{ n: 1, status: 'ready', touches: ['x'] }])).toEqual([])
  })
})

// W-B (§8): antes, ct-next.mjs llamaba a selectNext con `runningTouches: []`
// hardcodeado — dos invocaciones sucesivas de /ct-next nunca se veían entre
// sí, así que ni la colisión de touches ni el cap contaban el trabajo ya en
// vuelo (status:in-progress). planDispatch es la capa pura que cierra ese
// hueco: deriva runningTouches/remainingCap de los issues ya cargados y,
// cuando no selecciona nada, explica POR QUÉ (motivo distinguible en vez de
// un mensaje genérico) para que el humano sepa qué hacer a continuación.
describe('planDispatch — cap cuenta trabajo en vuelo, y motivo de bloqueo distinguible (W-B, §8)', () => {
  it('sin nada en vuelo, hay un ready despachable → selected lo incluye y blockReason es null', () => {
    const issues = [{ n: 1, order: 1, status: 'ready', deps: [], touches: ['api'] }]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 })
    expect(plan.selected.map((i) => i.n)).toEqual([1])
    expect(plan.blockReason).toBeNull()
    expect(plan.inFlight).toEqual([])
    expect(plan.runningTouches).toEqual([])
    expect(plan.remainingCap).toBe(1)
  })

  it('runningTouches se deriva de los in-progress, no de un [] hardcodeado (el bug que motiva W-B)', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['api'] }, // choca con #1 en vuelo
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 5 })
    expect(plan.selected).toEqual([])
    expect(plan.runningTouches).toEqual(['api'])
    expect(plan.blockReason).toMatchObject({ reason: 'collision', issue: 2, token: 'api', withIssue: 1 })
  })

  // Fix Minor 1 de la review: `wouldDispatchIfCapAllowed` distingue si subir
  // --cap de verdad ayudaría. Aquí #2 no colisiona con nada en vuelo, así
  // que SÍ ayudaría (blockedEvenWithCap: null).
  it('el cap ya está copado por trabajo en vuelo → no despacha nada, aunque haya ready sin colisión (subir --cap SÍ ayudaría)', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['ui'] }, // sin colisión de touches
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 }) // cap 1, ya hay 1 en vuelo
    expect(plan.selected).toEqual([])
    expect(plan.remainingCap).toBe(0)
    expect(plan.blockReason).toEqual({
      reason: 'cap-full', inFlightCount: 1, cap: 1, wouldDispatchIfCapAllowed: true, blockedEvenWithCap: null,
    })
  })

  it('cap 2 con 1 en vuelo → queda 1 hueco, se despacha uno más si no colisiona', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['migration'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['ui'] },
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 2 })
    expect(plan.selected.map((i) => i.n)).toEqual([2])
    expect(plan.remainingCap).toBe(1)
  })

  it('nada en status:ready → blockReason none-ready', () => {
    const issues = [{ n: 1, order: 1, status: 'in-review', deps: [], touches: [] }]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 })
    expect(plan.selected).toEqual([])
    expect(plan.blockReason).toEqual({ reason: 'none-ready' })
  })

  it('ready pero con deps sin mergear → blockReason deps-unmet, lista los issues bloqueados y qué deps faltan', () => {
    const issues = [{ n: 2, order: 2, status: 'ready', deps: [1, 3], touches: [] }]
    const plan = planDispatch(issues, { mergedIssues: [3], cap: 1 }) // falta mergear el 1
    expect(plan.selected).toEqual([])
    expect(plan.blockReason).toEqual({ reason: 'deps-unmet', blocked: [{ n: 2, unmetDeps: [1] }] })
  })

  it('ready + deps mergeadas pero colisiona con serializante en vuelo (migration/ci/pbxproj, tokens distintos) → collision de tipo serializing', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['migration'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['ci'] },
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 5 })
    expect(plan.selected).toEqual([])
    expect(plan.blockReason).toEqual({ reason: 'collision', kind: 'serializing', issue: 2, token: 'ci', runningToken: 'migration', withIssue: 1 })
  })

  // Fix Minor 1: aquí, aun sin el cap lleno, el único ready seguiría bloqueado
  // por deps sin mergear — subir --cap NO ayudaría. `blockedEvenWithCap`
  // lleva el motivo real (deps-unmet) para que el mensaje no prometa en
  // falso que "sube --cap" resolvería algo.
  it('cap-full tiene prioridad como motivo reportado, pero anota que subir --cap NO ayudaría (el ready también tiene deps sin mergear)', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['x'] },
      { n: 2, order: 2, status: 'ready', deps: [99], touches: [] },
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 })
    expect(plan.blockReason).toEqual({
      reason: 'cap-full',
      inFlightCount: 1,
      cap: 1,
      wouldDispatchIfCapAllowed: false,
      blockedEvenWithCap: { reason: 'deps-unmet', blocked: [{ n: 2, unmetDeps: [99] }] },
    })
  })

  // Misma idea que el test anterior, pero la razón subyacente que sobrevive
  // a subir el cap es una COLISIÓN (no deps-unmet) — confirma que
  // `blockedEvenWithCap` propaga cualquiera de las razones de
  // explainSelectionGap, no solo deps-unmet.
  it('cap-full con el único ready colisionando (aparte de estar en vuelo) → blockedEvenWithCap trae la colisión', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['api'] }, // choca con #1 en vuelo, no solo con el cap
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 })
    expect(plan.blockReason).toEqual({
      reason: 'cap-full',
      inFlightCount: 1,
      cap: 1,
      wouldDispatchIfCapAllowed: false,
      blockedEvenWithCap: { reason: 'collision', kind: 'token', issue: 2, token: 'api', withIssue: 1 },
    })
  })
})

// Fix round 2, finding 1 de la re-review: el fix round 1 afirmaba que no
// había una comprobación de comportamiento barata capaz de detectar una
// futura divergencia entre selectNext y explainNoSelection/
// explainSelectionGap — la review corrigió esa afirmación, con razón: SÍ la
// hay. Estos tests comparan el candidato que `explainNoSelection` cita en
// sus razones 'collision'/'deps-unmet' contra lo que el `selectNext` REAL
// (no una segunda llamada a computeReadyCandidates, sino el algoritmo de
// selección completo) decidiría si se le diera un hueco más de cap.
//
// Nota sobre por qué se llama a selectNext con `runningTouches: []` en vez
// de las mismas runningTouches que causaron el bloqueo original: si se
// mantuvieran, `selectNext(..., concurrencyCap: remainingCap + 1)` seguiría
// devolviendo `[]` de todas formas — ni una colisión de touches ni una dep
// sin mergear se deshacen dándole un hueco más de cap (ambas bloquean con
// independencia del cap; verificado leyendo el bucle de selectNext: el
// `continue` por colisión no depende de `concurrencyCap`), así que nunca
// habría un `[0]` real con el que comparar la identidad del candidato. Lo
// que sí es comparable, y es exactamente el riesgo que nos preocupa, es
// "¿el candidato que explainNoSelection identifica como EL bloqueado es el
// mismo que el algoritmo de selección de verdad elegiría como primero, dado
// vía libre (sin interferencia externa y con cap de sobra)?" — si en el
// futuro alguien reintroduce un cómputo de candidatos local y con errores en
// uno de los dos sitios, esta comparación se rompe porque invoca el
// selectNext REAL, no una re-derivación del mismo helper compartido.
describe('explainNoSelection / selectNext — oráculo de identidad de candidato (fix round 2, finding 1)', () => {
  it('collision: el issue que cita explainNoSelection es el mismo [0] que selectNext elegiría sin interferencia y con un hueco más de cap', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'] },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['api'] }, // choca con #1 en vuelo
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 9 })
    expect(plan.blockReason.reason).toBe('collision')

    const clean = selectNext(issues, { mergedIssues: [], runningTouches: [], concurrencyCap: plan.remainingCap + 1 })
    expect(clean[0]?.n).toBe(plan.blockReason.issue)
  })

  it('deps-unmet: el selectNext real (sin interferencia y con cap de sobra) también coincide en no seleccionar nada', () => {
    const issues = [{ n: 2, order: 2, status: 'ready', deps: [1, 3], touches: [] }]
    const plan = planDispatch(issues, { mergedIssues: [3], cap: 1 }) // falta mergear el 1
    expect(plan.blockReason.reason).toBe('deps-unmet')

    const clean = selectNext(issues, { mergedIssues: [3], runningTouches: [], concurrencyCap: plan.remainingCap + 1 })
    // deps-unmet bloquea con independencia del cap y de las touches — si el
    // selectNext real seleccionara algo aquí, sería la señal de que
    // explainSelectionGap divergió del filtro de deps que usa selectNext.
    expect(clean).toEqual([])
  })

  // Fix round 3 (re-review): el test de colisión de arriba tiene un ÚNICO
  // candidato ready+deps-mergeadas (#2; #1 queda fuera porque está
  // in-progress, no ready). Con un solo elemento, `readyDepsMet[0]` y
  // `readyDepsMet[readyDepsMet.length - 1]` SON EL MISMO elemento — así que
  // ese test no tiene poder discriminante contra la clase de regresión que
  // motivó escribir el oráculo: "el explicador elige mal entre VARIOS
  // candidatos" (una re-derivación que filtre u ordene distinto, un
  // off-by-one de índice). El sabotaje que se usó para demostrar que el
  // oráculo detecta divergencias (ver el report de fix round 2) se hizo
  // contra un fixture de DOS candidatos y nunca se commiteó — quedaba una
  // prueba de no-tautología más fuerte que el test que sí quedó en el repo.
  // Este test es ESE fixture de dos candidatos, ahora commiteado como
  // variante del oráculo (no reemplaza al de arriba: ambos se quedan, uno
  // cubre el caso más común de un único candidato bloqueado, este cubre el
  // caso con poder discriminante real entre varios).
  it('collision con VARIOS candidatos que chocan con el mismo token en vuelo: el issue citado es el de MENOR orden, no cualquiera (fixture con poder discriminante real)', () => {
    const issues = [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['x'] },
      { n: 10, order: 1, status: 'ready', deps: [], touches: ['x'] }, // choca con #1 en vuelo, orden 1 (el de menor orden)
      { n: 20, order: 2, status: 'ready', deps: [], touches: ['x'] }, // también choca, orden 2
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 9 })
    expect(plan.blockReason.reason).toBe('collision')

    const clean = selectNext(issues, { mergedIssues: [], runningTouches: [], concurrencyCap: plan.remainingCap + 1 })
    // Sin `runningTouches` externas, #10 (orden 1) ya no choca con nada y se
    // selecciona primero; #20 (orden 2) SÍ sigue chocando — pero ahora con
    // el propio `claimedTouches` de la tanda (ambos comparten el mismo
    // token 'x' entre sí), no con trabajo en vuelo, así que queda fuera y
    // `clean` solo trae a #10. Lo que importa para el oráculo es que
    // `readyDepsMet` tenía DOS elementos y la identificación de "el
    // primero" tuvo que ejercitarse de verdad: si `explainNoSelection`
    // citara #20 (p. ej. por un `readyDepsMet[length - 1]` en vez de
    // `readyDepsMet[0]`, o un sort invertido), `clean[0]` seguiría siendo
    // #10 (calculado por el `selectNext` real, no tocado) y la comparación
    // de abajo fallaría — a diferencia del test de un solo candidato de
    // arriba, donde `[0]` y `[length - 1]` son el mismo elemento y el mismo
    // sabotaje pasaría desapercibido.
    expect(clean.map((i) => i.n)).toEqual([10])
    expect(clean[0].n).toBe(plan.blockReason.issue)
  })
})

// D2, finding 4 (auditoría del dispatch): explainSelectionGap solo miraba
// readyDepsMet[0] para decidir `wouldDispatchIfCapAllowed` en la rama
// cap-full. El razonamiento de "el primero explica el bloqueo" (comentario de
// arriba) es válido para explicar por qué selectNext, con hueco de cap DE
// VERDAD, no seleccionó nada (si el [0] choca, todos chocan — si no, se
// habría seleccionado) — pero NO es válido para el contrafactual "¿ayudaría
// subir --cap?", porque en cap-full `remainingCap` fue 0 y selectNext JAMÁS
// examinó al candidato 2: que el [0] choque no dice nada sobre si el [1]
// también lo haría. Reproducción exacta del auditor: cap=2, dos en vuelo
// (api, db), dos ready-con-deps-mergeadas — #20 (orden 1, touches:api,
// choca con el `api` en vuelo) y #21 (orden 2, touches:ui, libre). Subir el
// cap SÍ despacharía #21 — el mensaje actual afirma lo contrario.
describe('explainSelectionGap / planDispatch — cap-full debe escanear TODOS los candidatos, no solo el primero (D2, finding 4)', () => {
  it('cap-full con #20 (orden 1) chocando pero #21 (orden 2) libre → wouldDispatchIfCapAllowed debe ser true', () => {
    const issues = [
      { n: 10, order: 1, status: 'in-progress', deps: [], touches: ['api'] },
      { n: 11, order: 2, status: 'in-progress', deps: [], touches: ['db'] },
      { n: 20, order: 1, status: 'ready', deps: [], touches: ['api'] }, // choca con #10
      { n: 21, order: 2, status: 'ready', deps: [], touches: ['ui'] },  // libre — subir --cap SÍ ayudaría
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 2 }) // 2 en vuelo, cap ya lleno
    expect(plan.selected).toEqual([])
    expect(plan.blockReason.reason).toBe('cap-full')
    // Esta es la aserción que el bug rompe: mirando solo readyDepsMet[0]
    // (#20, que choca), el código actual concluye `false` — pero #21 SÍ se
    // despacharía con un hueco de cap más.
    expect(plan.blockReason.wouldDispatchIfCapAllowed).toBe(true)
    expect(plan.blockReason.blockedEvenWithCap).toBeNull()
  })

  it('cap-full con TODOS los candidatos chocando de verdad → wouldDispatchIfCapAllowed sigue false (control negativo)', () => {
    const issues = [
      { n: 10, order: 1, status: 'in-progress', deps: [], touches: ['api'] },
      { n: 20, order: 1, status: 'ready', deps: [], touches: ['api'] }, // choca
      { n: 21, order: 2, status: 'ready', deps: [], touches: ['api'] }, // también choca con #10
    ]
    const plan = planDispatch(issues, { mergedIssues: [], cap: 1 })
    expect(plan.blockReason.reason).toBe('cap-full')
    expect(plan.blockReason.wouldDispatchIfCapAllowed).toBe(false)
    // El motivo reportado debe seguir siendo el del primero (#20, menor
    // orden) — el escaneo no cambia CUÁL se cita cuando de verdad todos
    // chocan, solo evita el falso negativo del caso de arriba.
    expect(plan.blockReason.blockedEvenWithCap).toEqual({ reason: 'collision', kind: 'token', issue: 20, token: 'api', withIssue: 10 })
  })
})

describe('resolveAccount', () => {
  const MAP = { personal: ['menoplus', 'control-tower'], work: ['mo.foo'], personalDir: '/p', workDir: '/w' }
  it('repo personal → personalDir', () => expect(resolveAccount('menoplus', MAP)).toBe('/p'))
  it('repo work → workDir', () => expect(resolveAccount('mo.foo', MAP)).toBe('/w'))
  it('desconocido → personalDir (default)', () => expect(resolveAccount('otro', MAP)).toBe('/p'))
})

describe('buildCmuxArgv', () => {
  it('devuelve argv sin shell, prompt como un solo elemento', () => {
    const argv = buildCmuxArgv({ name: 'r · #7 x', cwd: '/wt', command: "claude 'a b'\n#2" })
    expect(argv[0]).toBe('new-workspace')
    expect(argv).toContain('--name'); expect(argv).toContain('r · #7 x')
    expect(argv).toContain('--cwd'); expect(argv).toContain('/wt')
    expect(argv).toContain('--command')
    const ci = argv.indexOf('--command')
    expect(argv[ci + 1]).toBe("claude 'a b'\n#2") // intacto, sin escapar
  })

  // T10, hallazgo en vivo contra el sandbox: `cmux` es un cliente que habla
  // con un daemon ya en marcha por socket Unix — un env var puesto en
  // `execFileSync('cmux', argv, {env})` muere con ese proceso cliente y
  // NUNCA llega al pty real que crea el daemon. Sin pasar `--env
  // KEY=VALUE` explícitamente en el argv, CLAUDE_CONFIG_DIR no llega a la
  // sesión y esta se queda colgada en el selector interactivo de cuenta.
  it('sin env → ningún --env en el argv (compat con llamadas previas)', () => {
    const argv = buildCmuxArgv({ name: 'x', cwd: '/wt', command: 'claude' })
    expect(argv).not.toContain('--env')
  })
  it('con env → un --env KEY=VALUE por entrada, ANTES de --command', () => {
    const argv = buildCmuxArgv({ name: 'x', cwd: '/wt', command: 'claude', env: { CLAUDE_CONFIG_DIR: '/Users/x/.claude-personal' } })
    const ei = argv.indexOf('--env')
    expect(ei).toBeGreaterThan(-1)
    expect(argv[ei + 1]).toBe('CLAUDE_CONFIG_DIR=/Users/x/.claude-personal')
    expect(argv.indexOf('--env')).toBeLessThan(argv.indexOf('--command'))
  })
  it('con varias entradas de env → un --env por cada una', () => {
    const argv = buildCmuxArgv({ command: 'claude', env: { A: '1', B: '2' } })
    const envPairs = argv.reduce((acc, tok, i) => (tok === '--env' ? [...acc, argv[i + 1]] : acc), [])
    expect(envPairs).toEqual(['A=1', 'B=2'])
  })
})
