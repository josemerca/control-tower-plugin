// La tabla que decide el paso siguiente (scripts/run-machine.js).
//
// Este fichero es EXHAUSTIVO a propósito: recorre los 30 pares (paso,
// resultado) que existen y comprueba, uno a uno, o bien a dónde va el run, o
// bien que la transición LANZA. La razón es que el valor entero del diseño está
// en que la secuencia no la decida un modelo: una tabla con un hueco no es una
// tabla, es una tabla y una decisión implícita tomada por omisión.
import { describe, it, expect } from 'vitest'
import { after, newRun, STEPS, OUTCOMES, RUN_STATES, DEFAULT_BUDGETS } from '../scripts/run-machine.js'

const run = (over = {}) => ({ ...newRun({ plan: 'p.md', issue: 7, baseSha: 'abc', tasksTotal: 3 }), ...over })

const PASOS = Object.values(STEPS)
const RESULTADOS = Object.values(OUTCOMES)

// Los pares que la tabla SÍ describe. Todo lo demás tiene que lanzar.
const DESCRITOS = new Set([
  'implement/done', 'implement/discarded',
  'controls/done', 'controls/failed', 'controls/indeterminate',
  'judge/done', 'judge/failed', 'judge/corrections-ordered', 'judge/discarded',
  'commit/done', 'commit/failed',
  // §3.7: los dos pasos que corren tras la última tarea comiteada.
  'global/done', 'global/failed', 'global/indeterminate',
  'slice-judge/done', 'slice-judge/failed', 'slice-judge/discarded',
  // El e2e cierra la cola, y sólo si la slice declara recorridos.
  'e2e/done', 'e2e/failed', 'e2e/indeterminate', 'e2e/discarded',
  // over-budget lo entiende cualquier paso.
  ...PASOS.map((p) => `${p}/over-budget`),
])

describe('la tabla, entera', () => {
  it.each(PASOS.flatMap((step) => RESULTADOS.map((outcome) => [step, outcome])))(
    'el par (%s, %s) está descrito o lanza, nunca decide en silencio',
    (step, outcome) => {
      const llamada = () => after(run({ step }), outcome)
      if (DESCRITOS.has(`${step}/${outcome}`)) {
        const { state } = llamada()
        expect(Object.values(RUN_STATES)).toContain(state)
      } else {
        expect(llamada).toThrow(/transición imposible/)
      }
    },
  )

  it('el mensaje del imposible nombra el paso y el resultado, para que se pueda arreglar', () => {
    expect(() => after(run({ step: STEPS.IMPLEMENT }), OUTCOMES.FAILED))
      .toThrow(/paso "implement".*resultado "failed"/)
  })
})

describe('implement', () => {
  it('done → controls', () => {
    expect(after(run(), OUTCOMES.DONE).run.step).toBe(STEPS.CONTROLS)
  })

  it('discarded → implement otra vez, con un descarte más y SIN gastar reintento', () => {
    const { run: r } = after(run({ discards: 1, controlRetries: 1 }), OUTCOMES.DISCARDED)
    expect(r.step).toBe(STEPS.IMPLEMENT)
    expect(r.discards).toBe(2)
    expect(r.controlRetries).toBe(1)
  })
})

describe('controls', () => {
  const enControles = (over) => run({ step: STEPS.CONTROLS, ...over })

  it('done → judge', () => {
    expect(after(enControles(), OUTCOMES.DONE).run.step).toBe(STEPS.JUDGE)
  })

  it('failed vuelve a implement mientras queden reintentos, contándolos', () => {
    const primero = after(enControles(), OUTCOMES.FAILED)
    expect(primero.run.step).toBe(STEPS.IMPLEMENT)
    expect(primero.run.controlRetries).toBe(1)
    expect(primero.state).toBe(RUN_STATES.OPEN)

    const segundo = after(enControles({ controlRetries: 1 }), OUTCOMES.FAILED)
    expect(segundo.run.controlRetries).toBe(2)
    expect(segundo.state).toBe(RUN_STATES.OPEN)
  })

  it('failed con los reintentos agotados cierra en blocked-controls', () => {
    const { state } = after(enControles({ controlRetries: DEFAULT_BUDGETS.controlRetries }), OUTCOMES.FAILED)
    expect(state).toBe(RUN_STATES.BLOCKED_CONTROLS)
  })

  it('indeterminate cierra A LA PRIMERA, sin gastar los reintentos', () => {
    // No se pudo medir. Reintentar a ciegas repite el coste sin cambiar nada.
    const { run: r, state } = after(enControles(), OUTCOMES.INDETERMINATE)
    expect(state).toBe(RUN_STATES.BLOCKED_CONTROLS)
    expect(r.controlRetries).toBe(0)
  })
})

describe('judge', () => {
  const enJuez = (over) => run({ step: STEPS.JUDGE, ...over })

  it('done → commit', () => {
    expect(after(enJuez(), OUTCOMES.DONE).run.step).toBe(STEPS.COMMIT)
  })

  it('failed —el veto— vuelve a implement, y agotado cierra en blocked-judge', () => {
    expect(after(enJuez(), OUTCOMES.FAILED).run.judgeRetries).toBe(1)
    expect(after(enJuez({ judgeRetries: 2 }), OUTCOMES.FAILED).state).toBe(RUN_STATES.BLOCKED_JUDGE)
  })

  it('corrections-ordered —el refunfuño— vuelve a implement con presupuesto PROPIO', () => {
    const { run: r } = after(enJuez(), OUTCOMES.CORRECTIONS_ORDERED)
    expect(r.step).toBe(STEPS.IMPLEMENT)
    expect(r.correctionRetries).toBe(1)
    // No gasta reintento de veto: son dos presupuestos distintos.
    expect(r.judgeRetries).toBe(0)
  })

  it('corrections-ordered agotado ENTREGA IGUAL: sigue a commit, no bloquea', () => {
    // Ésta es la diferencia entre un juez que veta y un juez que refunfuña. Si
    // agotar las correcciones bloqueara, tres quejas menores pararían una tarea
    // que el juez había aprobado.
    const { run: r, state } = after(enJuez({ correctionRetries: 2 }), OUTCOMES.CORRECTIONS_ORDERED)
    expect(r.step).toBe(STEPS.COMMIT)
    expect(state).toBe(RUN_STATES.OPEN)
  })

  it('discarded → juzgar otra vez, con un descarte más y sin gastar reintento', () => {
    const { run: r } = after(enJuez({ judgeRetries: 1 }), OUTCOMES.DISCARDED)
    expect(r.step).toBe(STEPS.JUDGE)
    expect(r.discards).toBe(1)
    expect(r.judgeRetries).toBe(1)
  })
})

describe('commit', () => {
  const enCommit = (over) => run({ step: STEPS.COMMIT, ...over })

  it('done avanza de tarea y devuelve el run a implement', () => {
    const { run: r, state } = after(enCommit({ task: 1 }), OUTCOMES.DONE)
    expect(r.task).toBe(2)
    expect(r.step).toBe(STEPS.IMPLEMENT)
    expect(state).toBe(RUN_STATES.OPEN)
  })

  it('done en la última tarea NO entrega: abre la fase global con los reintentos a cero', () => {
    // §3.7: tras el último commit el run ya no cierra en delivered — falta
    // correr la punta a punta (global) y juzgar el slice entero (slice-judge).
    const { run: r, state } = after(enCommit({ task: 3, tasksTotal: 3 }), OUTCOMES.DONE)
    expect(state).toBe(RUN_STATES.OPEN)
    expect(r.step).toBe(STEPS.GLOBAL)
    expect([r.controlRetries, r.judgeRetries, r.correctionRetries]).toEqual([0, 0, 0])
    // Los descartes y el dinero son de la slice entera: no se tocan aquí.
    expect(r.discards).toBe(0)
  })

  it('failed cierra en blocked-commit sin reintentar', () => {
    expect(after(enCommit(), OUTCOMES.FAILED).state).toBe(RUN_STATES.BLOCKED_COMMIT)
  })
})

describe('global (§3.7-A: la punta a punta del plan la corre el programa)', () => {
  const enGlobal = (over) => run({ step: STEPS.GLOBAL, ...over })

  it('done → slice-judge', () => {
    expect(after(enGlobal(), OUTCOMES.DONE).run.step).toBe(STEPS.SLICE_JUDGE)
  })

  it('failed cierra blocked-global A LA PRIMERA, sin reintentar', () => {
    // Todo está comiteado: reintentar mide el mismo árbol y repite el coste
    // sin cambiar nada.
    expect(after(enGlobal(), OUTCOMES.FAILED).state).toBe(RUN_STATES.BLOCKED_GLOBAL)
  })

  it('indeterminate cierra blocked-global igual que failed', () => {
    expect(after(enGlobal(), OUTCOMES.INDETERMINATE).state).toBe(RUN_STATES.BLOCKED_GLOBAL)
  })
})

describe('slice-judge (§3.7-B: la coherencia entre tareas sí tiene juez)', () => {
  const enJuezDeSlice = (over) => run({ step: STEPS.SLICE_JUDGE, ...over })

  it('done cierra en delivered', () => {
    expect(after(enJuezDeSlice(), OUTCOMES.DONE).state).toBe(RUN_STATES.DELIVERED)
  })

  it('failed cierra blocked-slice-judge sin reintentos ni corrections-ordered', () => {
    // Aquí no queda un implementador con trabajo stageado al que devolver:
    // todo es commit. Un FAIL cierra el run.
    expect(after(enJuezDeSlice(), OUTCOMES.FAILED).state).toBe(RUN_STATES.BLOCKED_SLICE_JUDGE)
  })

  it('discarded vuelve a slice-judge con un descarte más, sin gastar reintento', () => {
    const { run: r, state } = after(enJuezDeSlice({ discards: 2 }), OUTCOMES.DISCARDED)
    expect(state).toBe(RUN_STATES.OPEN)
    expect(r.step).toBe(STEPS.SLICE_JUDGE)
    expect(r.discards).toBe(3)
  })
})

describe('qué se reinicia al avanzar de tarea y qué no', () => {
  it('los tres reintentos vuelven a cero; los descartes y el dinero siguen', () => {
    const gastado = enCurso()
    const { run: r } = after(gastado, OUTCOMES.DONE)
    expect([r.controlRetries, r.judgeRetries, r.correctionRetries]).toEqual([0, 0, 0])
    expect(r.discards).toBe(4)
    expect(r.spendUsd).toBe(12.5)
  })

  function enCurso() {
    return run({
      step: STEPS.COMMIT, task: 1,
      controlRetries: 2, judgeRetries: 1, correctionRetries: 2,
      discards: 4, spendUsd: 12.5,
    })
  }
})

describe('el dinero corta por encima de todo', () => {
  it.each(PASOS)('over-budget cierra el run en aborted-budget desde %s', (step) => {
    expect(after(run({ step }), OUTCOMES.OVER_BUDGET).state).toBe(RUN_STATES.ABORTED_BUDGET)
  })
})

describe('el run que entra no se toca nunca', () => {
  it('la transición devuelve una copia y deja el original intacto', () => {
    const antes = run()
    const { run: despues } = after(antes, OUTCOMES.DONE)
    expect(antes.step).toBe(STEPS.IMPLEMENT)
    expect(despues).not.toBe(antes)
  })

  it('el run está congelado: escribirle encima no cuela un estado a espaldas de la tabla', () => {
    const r = newRun({ plan: 'p.md', issue: 7, baseSha: 'abc', tasksTotal: 2 })
    expect(Object.isFrozen(r)).toBe(true)
    expect(() => { 'use strict'; r.task = 99 }).toThrow()
  })
})

describe('presupuestos a medida', () => {
  it('con cero reintentos de control, el primer rojo ya bloquea', () => {
    const { state } = after(run({ step: STEPS.CONTROLS }), OUTCOMES.FAILED, { ...DEFAULT_BUDGETS, controlRetries: 0 })
    expect(state).toBe(RUN_STATES.BLOCKED_CONTROLS)
  })

  it('con más presupuesto de correcciones, el refunfuño sigue volviendo a implement', () => {
    const { run: r } = after(run({ step: STEPS.JUDGE, correctionRetries: 2 }), OUTCOMES.CORRECTIONS_ORDERED,
      { ...DEFAULT_BUDGETS, correctionRetries: 5 })
    expect(r.step).toBe(STEPS.IMPLEMENT)
    expect(r.correctionRetries).toBe(3)
  })
})
