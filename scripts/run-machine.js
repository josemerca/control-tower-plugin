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
  ABORTED_BUDGET: 'aborted-budget',
})

export const DEFAULT_BUDGETS = Object.freeze({
  controlRetries: 2,
  judgeRetries: 2,
  correctionRetries: 2,
})

// El run recién nacido: tarea 1, paso implement, todos los contadores a cero.
export function newRun({ plan, issue, baseSha, tasksTotal }) {
  return freeze({
    plan, issue, baseSha,
    task: 1,
    tasksTotal,
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
        : cerrado(run, RUN_STATES.DELIVERED)
    // Un commit que falla no se reintenta: si git dice que no, es el índice o
    // el mensaje, y ninguna de las dos cosas se arregla volviendo a implementar.
    case OUTCOMES.FAILED:
      return cerrado(run, RUN_STATES.BLOCKED_COMMIT)
    default:
      return imposible(run, outcome)
  }
}
