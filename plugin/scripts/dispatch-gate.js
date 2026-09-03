import { STEPS } from './run-machine.js'

export const Dispatch = Object.freeze({
  LET_THROUGH: 'let-through',
  DENIED: 'denied',
})

export class DispatchVerdict {
  static letThrough() {
    return new DispatchVerdict(Dispatch.LET_THROUGH, null)
  }

  static denied(reason) {
    return new DispatchVerdict(Dispatch.DENIED, reason)
  }

  constructor(dispatch, reason) {
    this.dispatch = dispatch
    this.reason = reason
    Object.freeze(this)
  }
}

export class StepSeal {
  static #INPUT_OF = Object.freeze({
    [STEPS.IMPLEMENT]: 'el brief de la tarea',
    [STEPS.JUDGE]: 'el paquete de revisión de la tarea',
    [STEPS.SLICE_JUDGE]: 'el paquete de revisión del slice',
  })

  static SEALED_STEPS = Object.freeze(Object.keys(StepSeal.#INPUT_OF))

  static of(run) {
    return `${run.task}:${run.step}:${StepSeal.attemptOf(run)}`
  }

  static inputWrittenFor(step) {
    return StepSeal.#INPUT_OF[step] ?? null
  }

  static attemptOf(run) {
    return run.controlRetries + run.judgeRetries + run.correctionRetries + 1
  }
}

export class DispatchGate {
  static verdictFor(run, ctStepPath) {
    if (run.closed) return DispatchVerdict.letThrough()
    const input = StepSeal.inputWrittenFor(run.step)
    if (input === null) return DispatchVerdict.letThrough()
    if (run.nextSeal === StepSeal.of(run)) return DispatchVerdict.letThrough()
    return DispatchVerdict.denied(DispatchGate.#reason(run, ctStepPath, input))
  }

  static #reason(run, ctStepPath, input) {
    return [
      `El run del issue ${run.issue} está en el paso "${run.step}" y todavía no has pedido el paso.`,
      '',
      `"ct-step next" no sólo dice cuál es el paso: ESCRIBE ${input}, que es el fichero que este subagente tiene que leer. Despachado ahora se queda sin él, y eso no se ve hasta que vuelve con el trabajo hecho encima de otra cosa.`,
      '',
      'Pide el paso y despacha con lo que imprima:',
      `  node ${ctStepPath} next --plan ${run.plan} --issue ${run.issue}`,
      '',
      '"next" no transiciona el run: informa y prepara, así que pedirlo no cuesta ningún intento ni ningún descarte.',
    ].join('\n')
  }
}
