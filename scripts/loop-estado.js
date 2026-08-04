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
    enProgreso, enRevision = [], mergeados, cerradosConStatus,
    worktreesEnDisco, ramasEnDisco,
    // sePuedeAtribuirWorktree: si se sabe QUIÉN reclama cada worktree, es
    // decir, si la lista de issues (abiertos y cerrados) se pudo leer entera.
    // Separa dos preguntas que antes viajaban en el mismo dato:
    //
    //   ¿existe .worktrees/N?   → `worktreesEnDisco`, que es una lectura de
    //                             DISCO y no depende de GitHub para nada.
    //   ¿lo reclama alguien?    → sólo contestable con los issues delante.
    //
    // El llamante vaciaba `worktreesEnDisco` cuando no tenía los issues, para
    // no fabricar huérfanos. Protegía lo correcto, pero de más: ese vaciado
    // también borraba el `hasWorktree` de los slices EN VUELO y de la cosecha,
    // y el informe acababa diciendo `worktree ✗` sobre un directorio que su
    // propio aviso acababa de nombrar. Ahora la lista real entra siempre y lo
    // único que se apaga es la atribución.
    sePuedeAtribuirWorktree = true,
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

  // enRevision: los issues abiertos en `status:in-review` — trabajo ENTREGADO
  // que espera merge. Es su propio cubo, y no es ninguno de los otros tres:
  //
  //   - No es residuo. El §2.1 del diseño enumera los tres casos del worktree
  //     huérfano (abandonado, requeueado, o de un issue cerrado sin mergear) y
  //     un `in-review` no es ninguno: su worktree suele estar ahí A PROPÓSITO,
  //     porque el PR todavía no se ha mergeado. Contándolo como hallazgo, un
  //     loop SANO con tres PRs abiertos devolvía 3 de forma permanente — el
  //     coordinador aprende a ignorar el código de salida y un vigilante que
  //     gatee sobre él queda inservible.
  //   - No es cosecha. La cosecha es lo YA MERGEADO que dejó restos en disco.
  //     Las dos cosas pueden aparecer a la vez y no se solapan.
  //
  // Por eso NO cuenta como hallazgo (ver `hayHallazgos` más abajo): es
  // informativo. Y por eso sus worktrees quedan EXPLICADOS: un `in-review` es
  // exactamente el dueño legítimo del suyo.
  const enRevisionSalida = enRevision.map(({ n, nombre }) => {
    const hasWorktree = worktreeSet.has(String(n))
    if (hasWorktree) worktreesExplicados.add(String(n))
    return { n, nombre, hasWorktree, hasBranch: ramaSet.has(`feat/${n}`) }
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

  // Huérfano = «está en disco y NINGÚN issue lo explica». La segunda mitad
  // exige tener los issues: sin ellos, `worktreesExplicados` está vacío por
  // ignorancia, no por hecho, y TODO worktree saldría acusado. Cuando no se
  // pueden atribuir no se acusa a ninguno — que es distinto de fingir que el
  // directorio no está, que es lo que hacía el vaciado del llamante.
  const worktreesHuerfanos = sePuedeAtribuirWorktree
    ? worktreesEnDisco.filter((w) => !worktreesExplicados.has(w))
    : []

  const residuo = {
    labels: cerradosConStatus,
    worktreesHuerfanos,
  }

  // Un enVuelo sin vida cuenta como hallazgo sólo si además se conoce su
  // edad: sin edad, ya viaja en `sinComprobar` con el número del issue, y
  // presentarlo TAMBIÉN como hallazgo lo dejaría indistinguible de un claim
  // abandonado de verdad —justo la acusación que la edad desconocida evita.
  const hayHallazgoEnVuelo = enVuelo.some((s) => s.vivo === false && !s.arrancando && s.edadMs !== null)
  const hayHallazgos = cosecha.length > 0
    || residuo.labels.length > 0
    || residuo.worktreesHuerfanos.length > 0
    || hayHallazgoEnVuelo

  // `worktreesExplicados` sale afuera porque el llamante necesita la MISMA
  // respuesta para otra cosa: avisar de los directorios que quedaron sin
  // explicar cuando la lista de issues está incompleta. Recalcularlo allí
  // sería duplicar el criterio de "quién reclama un worktree" en dos sitios
  // que derivarían por separado — y la primera víctima de esa deriva sería
  // justo un aviso que nombra un directorio que el informe sí explica.
  return { enVuelo, enRevision: enRevisionSalida, cosecha, residuo, sinComprobar, hayHallazgos, worktreesExplicados: [...worktreesExplicados] }
}
