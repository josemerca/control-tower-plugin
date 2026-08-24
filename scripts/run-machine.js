// ============================================================================
// RUN-MACHINE — quién decide el paso siguiente de la fase de implementación.
//
// Hoy lo decide una sesión de chat leyendo prosa (`subagent-driven-development`
// en el idioma de la skill). Aquí lo decide esta tabla, que es una función
// pura: mismo estado y mismo resultado, misma decisión, siempre, y sin que
// haga falta un modelo para tomarla.
//
// Portada de `state_machine.py` de agentic-skills y reducida a la forma de
// Control Tower: de sus siete pasos sobreviven cuatro. El de alineación no
// aplica —su equivalente es el gate `plan`, que ocurre antes de que el programa
// arranque— y `await-ci` / `await-merge` tampoco: este repo no tiene
// integración continua (D-6 sigue abierta) y el merge es una decisión humana
// con la pull request delante, que es donde la sesión para hoy.
//
// La dimensión que el original NO tiene es la TAREA: allí el run es la slice
// entera, aquí una slice son N tareas y cada una es un commit. Por eso los tres
// contadores de reintento se reinician al avanzar de tarea —cada tarea estrena
// su cuenta— mientras que los descartes y el dinero acumulan durante toda la
// slice.
//
// PURO: ni un import, ni una lectura, ni un reloj. Es lo que permite testear la
// tabla entera —incluidos los pares imposibles— sin tocar disco ni lanzar un
// proceso.
// ============================================================================

export const STEPS = Object.freeze({
  IMPLEMENT: 'implement',
  CONTROLS: 'controls',
  JUDGE: 'judge',
  COMMIT: 'commit',
  // E2E — el único paso que NO es por tarea: se entra al comitear la última y
  // sólo si la slice declara recorridos. Va aquí y no colgado de `controls`
  // porque `controls` mide lo que el PLAN prometió contra el árbol, por tarea,
  // y esto atraviesa lo que el SPEC declaró contra el sistema levantado, por
  // slice. Colgarlo de controls obligaría a que cada tarea arrastrara un e2e
  // que no le toca, o a un controls especial en la última — una rama de la
  // tabla que no describe ningún estado real.
  E2E: 'e2e',
})

export const OUTCOMES = Object.freeze({
  DONE: 'done',
  FAILED: 'failed',
  INDETERMINATE: 'indeterminate',
  CORRECTIONS_ORDERED: 'corrections-ordered',
  DISCARDED: 'discarded',
  OVER_BUDGET: 'over-budget',
})

export const RUN_STATES = Object.freeze({
  OPEN: 'open',
  DELIVERED: 'delivered',
  BLOCKED_CONTROLS: 'blocked-controls',
  BLOCKED_JUDGE: 'blocked-judge',
  BLOCKED_COMMIT: 'blocked-commit',
  // Mismo sitio y misma forma que sus tres hermanos: un cierre en fallo del que
  // sale una persona, no un reintento.
  BLOCKED_E2E: 'blocked-e2e',
  ABORTED_BUDGET: 'aborted-budget',
})

export const DEFAULT_BUDGETS = Object.freeze({
  controlRetries: 2,
  judgeRetries: 2,
  correctionRetries: 2,
})

// El run recién nacido: tarea 1, paso implement, todos los contadores a cero.
export function newRun({ plan, issue, baseSha, tasksTotal, e2eRuns }) {
  return freeze({
    plan, issue, baseSha,
    task: 1,
    tasksTotal,
    // e2eRuns — los recorridos que la columna E2E del spec declara para esta
    // slice, sembrados por /ct-next en .agent/SLICE.md (ct-step no habla con
    // GitHub). Lista vacía y no `undefined` a propósito: `[]` significa "esta
    // slice no tiene e2e" y es un dato, mientras que `undefined` no se
    // distingue de "una versión vieja escribió este run".
    e2eRuns: Array.isArray(e2eRuns) ? [...e2eRuns] : [],
    step: STEPS.IMPLEMENT,
    controlRetries: 0,
    judgeRetries: 0,
    correctionRetries: 0,
    discards: 0,
    spendUsd: 0,
  })
}

const freeze = (run) => Object.freeze({ ...run })
const con = (run, cambios) => freeze({ ...run, ...cambios })

const abierto = (run, cambios) => ({ run: con(run, cambios), state: RUN_STATES.OPEN })
const cerrado = (run, state) => ({ run: freeze(run), state })

// El par que la tabla no describe LANZA. No cae en una rama genérica y no se
// interpreta como "pues sigue por donde ibas": es la propiedad `_impossible`
// del original, y es lo que hace que un resultado nuevo —o un paso al que se
// llega por un camino que nadie pensó— sea un error ruidoso y no una decisión
// silenciosa tomada por omisión.
function imposible(run, outcome) {
  throw new Error(`transición imposible: el paso "${run.step}" no sabe qué hacer con el resultado "${outcome}"`)
}

// ============================================================================
// LA TABLA (§3.3 del spec)
//
//   after(run, outcome, budgets) → { run, state }
//
// `state` es `open` mientras el run siga vivo, y el motivo del cierre cuando no.
// Cada transición devuelve una COPIA: el run que entra no se toca nunca, así
// que quien persiste el estado puede quedarse con el anterior sin miedo.
// ============================================================================
export function after(run, outcome, budgets = DEFAULT_BUDGETS) {
  // El dinero corta por encima de todo. Da igual en qué paso esté el run: si el
  // tope está agotado, la llamada siguiente no se lanza.
  if (outcome === OUTCOMES.OVER_BUDGET) return cerrado(run, RUN_STATES.ABORTED_BUDGET)

  switch (run.step) {
    case STEPS.IMPLEMENT: return trasImplementar(run, outcome)
    case STEPS.CONTROLS: return trasLosControles(run, outcome, budgets)
    case STEPS.JUDGE: return trasElJuez(run, outcome, budgets)
    case STEPS.COMMIT: return trasElCommit(run, outcome)
    case STEPS.E2E: return trasElE2e(run, outcome)
    default: return imposible(run, outcome)
  }
}

function trasImplementar(run, outcome) {
  switch (outcome) {
    case OUTCOMES.DONE:
      return abierto(run, { step: STEPS.CONTROLS })
    // El informe del implementador que no se puede leer. No gasta reintento
    // porque no se tocó el código: lo único que respalda este camino es el tope
    // en dinero.
    case OUTCOMES.DISCARDED:
      return abierto(run, { step: STEPS.IMPLEMENT, discards: run.discards + 1 })
    default:
      return imposible(run, outcome)
  }
}

function trasLosControles(run, outcome, budgets) {
  switch (outcome) {
    case OUTCOMES.DONE:
      return abierto(run, { step: STEPS.JUDGE })
    case OUTCOMES.FAILED:
      return run.controlRetries < budgets.controlRetries
        ? abierto(run, { step: STEPS.IMPLEMENT, controlRetries: run.controlRetries + 1 })
        : cerrado(run, RUN_STATES.BLOCKED_CONTROLS)
    // No se pudo MEDIR: el comando no existe, o se colgó y saltó el tope de
    // tiempo. Reintentar a ciegas repite el coste sin cambiar nada, así que
    // cierra a la primera en vez de gastarse los dos intentos.
    case OUTCOMES.INDETERMINATE:
      return cerrado(run, RUN_STATES.BLOCKED_CONTROLS)
    default:
      return imposible(run, outcome)
  }
}

function trasElJuez(run, outcome, budgets) {
  switch (outcome) {
    case OUTCOMES.DONE:
      return abierto(run, { step: STEPS.COMMIT })
    case OUTCOMES.FAILED:
      return run.judgeRetries < budgets.judgeRetries
        ? abierto(run, { step: STEPS.IMPLEMENT, judgeRetries: run.judgeRetries + 1 })
        : cerrado(run, RUN_STATES.BLOCKED_JUDGE)
    // La diferencia entre un juez que VETA y un juez que REFUNFUÑA: un PASA con
    // hallazgos que no son de severidad baja vuelve al implementador con
    // presupuesto propio, y agotarlo ENTREGA IGUAL. Sin esta distinción, cada
    // refunfuño gastaría un reintento de veto y tres quejas menores bloquearían
    // una tarea que el juez había aprobado.
    case OUTCOMES.CORRECTIONS_ORDERED:
      return run.correctionRetries < budgets.correctionRetries
        ? abierto(run, { step: STEPS.IMPLEMENT, correctionRetries: run.correctionRetries + 1 })
        : abierto(run, { step: STEPS.COMMIT })
    // El veredicto que incumple el esquema. Como el descarte del implementador:
    // no se tocó el código, así que no gasta reintento.
    case OUTCOMES.DISCARDED:
      return abierto(run, { step: STEPS.JUDGE, discards: run.discards + 1 })
    default:
      return imposible(run, outcome)
  }
}

function trasElCommit(run, outcome) {
  switch (outcome) {
    case OUTCOMES.DONE:
      // Cada tarea estrena su cuenta de reintentos. Los descartes y el dinero
      // no: ésos son de la slice entera.
      return run.task < run.tasksTotal
        ? abierto(run, {
            task: run.task + 1,
            step: STEPS.IMPLEMENT,
            controlRetries: 0,
            judgeRetries: 0,
            correctionRetries: 0,
          })
        // Comiteada la última tarea, la slice está implementada — pero si el
        // spec declaró recorridos, todavía no está verificada de punta a punta.
        // `task` NO avanza: el paso es de la slice, no de una tarea sexta que no
        // existe. (Ojo: eso rompe la invariante `commits === task - 1` que
        // ct-step comprueba al cargar el estado — ver Task 8.)
        : (run.e2eRuns || []).length
          ? abierto(run, { step: STEPS.E2E })
          : cerrado(run, RUN_STATES.DELIVERED)
    // Un commit que falla no se reintenta: si git dice que no, es el índice o
    // el mensaje, y ninguna de las dos cosas se arregla volviendo a implementar.
    case OUTCOMES.FAILED:
      return cerrado(run, RUN_STATES.BLOCKED_COMMIT)
    default:
      return imposible(run, outcome)
  }
}

function trasElE2e(run, outcome) {
  switch (outcome) {
    case OUTCOMES.DONE:
      return cerrado(run, RUN_STATES.DELIVERED)
    // El no-verificado ENTREGA. No es indulgencia: si retuviera el run, un
    // docker que no arranca o una credencial caducada dejaría el slice en
    // status:in-progress ocupando `area:`/`touches:` y una plaza de `--cap` sin
    // nadie trabajando — el modo de fallo que F13 y F18 se dedicaron a quitar.
    // Lo que no pasa nunca es que se afirme verde: el motivo viaja en el
    // informe y `--release` lo imprime.
    case OUTCOMES.INDETERMINATE:
      return cerrado(run, RUN_STATES.DELIVERED)
    case OUTCOMES.FAILED:
      return cerrado(run, RUN_STATES.BLOCKED_E2E)
    // Un informe que no se puede leer no gasta reintento: no se tocó el código
    // ni el entorno. Mismo trato que en `implement`, y con el mismo respaldo —
    // el tope de descartes de la slice.
    case OUTCOMES.DISCARDED:
      return abierto(run, { step: STEPS.E2E, discards: run.discards + 1 })
    default:
      return imposible(run, outcome)
  }
}

// ============================================================================
// EL GATE DEL RELEASE (la mitad que lee; la que escribe está en ct-step.mjs,
// que persiste `closed: 'delivered'` al cerrar bien).
//
// `dispatch-check --release` no puede fiarse de que la sesión haya obedecido
// el kickoff — un prompt no es un gate (doctrina del documento de
// convergencia al descartar la opción (a) de F36). Esto lo convierte en
// mecanismo: sin un run de ct-step ENTREGADO, no se libera. Pura a propósito:
// recibe el contenido crudo del fichero (o null si no existe) y contesta,
// sin git ni disco, para poder probarse sola.
// ============================================================================
export function deliveredRun(raw, issue) {
  if (raw === null) {
    return { ok: false, why: `no existe .agent/run-${issue}.json: la implementación no la condujo ct-step (o el run se borró). El kickoff manda conducir con ct-step, y este gate es lo que convierte esa orden en mecanismo.` }
  }
  let run
  try { run = JSON.parse(raw) } catch (e) {
    return { ok: false, why: `.agent/run-${issue}.json no es JSON válido (${e.message}): no se puede afirmar que el run esté entregado.` }
  }
  if (Number(run.issue) !== Number(issue)) {
    return { ok: false, why: `.agent/run-${issue}.json dice issue ${run.issue}, no ${issue}: ese run es de otro slice.` }
  }
  if (run.closed !== RUN_STATES.DELIVERED) {
    return { ok: false, why: `el run del issue ${issue} no está entregado (closed: ${run.closed ?? '(ausente)'}, tarea ${run.task}/${run.tasksTotal}, paso ${run.step}): termina el run con ct-step hasta "run delivered" y reintenta.` }
  }
  return { ok: true }
}
