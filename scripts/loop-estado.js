// Composición del estado del loop: recibe señales ya recogidas y devuelve los
// tres cubos del informe. NO hace I/O — ni red, ni procesos, ni disco.
//
// No hace I/O a propósito: todas las decisiones que importan —quién está vivo,
// quién sólo está arrancando, qué worktree no reclama nadie, y si hay algo que
// revisar— se toman aquí, y por tanto se pueden probar sin montar un repo, sin
// lanzar procesos y sin red. Quien recoja las señales es cosa suya.
//
// Tres estados para "¿está vivo?", no dos: `true`, `false`, y `null` cuando no
// se pudo comprobar. Colapsar el tercero en `false` convertiría una
// herramienta que falta en una acusación de abandono.
export function construirEstado(entrada) {
  const {
    enProgreso, mergeados, cerradosConStatus,
    worktreesEnDisco, ramasEnDisco,
    procesos, edadClaimMs, ventanaArranqueMs,
  } = entrada

  const sinComprobar = []
  if (!procesos.comprobado) sinComprobar.push(procesos.motivo)

  const worktreeSet = new Set(worktreesEnDisco)
  const ramaSet = new Set(ramasEnDisco)
  // Un worktree deja de ser huérfano en cuanto ALGÚN issue —en vuelo o ya
  // mergeado— lo reclama. Se acumula aquí desde los dos sitios.
  const worktreesExplicados = new Set()

  const enVuelo = enProgreso.map(({ n, nombre }) => {
    const hasWorktree = worktreeSet.has(String(n))
    const hasBranch = ramaSet.has(`feat/${n}`)
    if (hasWorktree) worktreesExplicados.add(String(n))

    // `null` cuando no se pudo comprobar la lista de procesos: nunca se
    // colapsa en `false`, o la ausencia de la herramienta se leería como
    // que el agente ha muerto.
    const vivo = procesos.comprobado ? procesos.porSlice.has(String(n)) : null
    const pid = procesos.comprobado ? (procesos.porSlice.get(String(n)) ?? null) : null

    const edadMs = edadClaimMs.has(n) ? edadClaimMs.get(n) : null
    // Un claim recién puesto todavía no ha tenido tiempo de arrancar el
    // proceso que lo demuestra vivo: por debajo de la ventana de arranque
    // se informa "arrancando", no "sin señal de vida".
    const arrancando = vivo === false && edadMs !== null && edadMs < ventanaArranqueMs

    if (vivo === false && edadMs === null) {
      // Edad desconocida: no se acusa. Se nombra el issue en sinComprobar
      // en vez de decidir por él.
      sinComprobar.push(`#${n}: no se pudo determinar la antigüedad del claim`)
    }

    return { n, nombre, hasWorktree, hasBranch, pid, vivo, arrancando, edadMs }
  })

  const cosecha = []
  for (const n of mergeados) {
    const hasWorktree = worktreeSet.has(String(n))
    const hasBranch = ramaSet.has(`feat/${n}`)
    if (hasWorktree || hasBranch) {
      if (hasWorktree) worktreesExplicados.add(String(n))
      cosecha.push({ n, hasWorktree, hasBranch })
    }
  }

  const worktreesHuerfanos = worktreesEnDisco.filter((w) => !worktreesExplicados.has(w))

  const residuo = {
    labels: cerradosConStatus,
    worktreesHuerfanos,
  }

  const hayHallazgoEnVuelo = enVuelo.some((s) => s.vivo === false && !s.arrancando)
  const hayHallazgos = cosecha.length > 0
    || residuo.labels.length > 0
    || residuo.worktreesHuerfanos.length > 0
    || hayHallazgoEnVuelo

  return { enVuelo, cosecha, residuo, sinComprobar, hayHallazgos }
}
