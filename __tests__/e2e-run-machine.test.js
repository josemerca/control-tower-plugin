// ============================================================================
// El paso e2e en la tabla. TERMINAL, no por tarea: se entra al comitear la
// ÚLTIMA tarea, y sólo si el run declara recorridos.
//
// Por qué terminal y no por tarea: el e2e verifica lo que la SLICE entrega, y
// una tarea es un commit — pedirle a la tarea 2 de 5 que atraviese un flujo de
// usuario es pedirle que atraviese algo que todavía no existe.
//
// Y por qué en la tabla y no al lado del release: la #31 hizo que la secuencia
// la decida esta función y no la prosa de una skill. Un e2e enganchado en
// paralelo serían dos mecanismos verificando la misma entrega.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { after, newRun, deliveredRun, STEPS, OUTCOMES, RUN_STATES } from '../scripts/run-machine.js'

const enCommitDeLaUltima = (e2eRuns) => ({
  ...newRun({ plan: 'p.md', issue: 4, baseSha: 'abc', tasksTotal: 2, e2eRuns }),
  task: 2,
  step: STEPS.COMMIT,
})

describe('la entrada al paso e2e', () => {
  it('sin recorridos, la última tarea cierra en DELIVERED como hasta ahora', () => {
    const r = after(enCommitDeLaUltima([]), OUTCOMES.DONE)
    expect(r.state).toBe(RUN_STATES.DELIVERED)
  })

  it('con recorridos, la última tarea abre el paso e2e', () => {
    const r = after(enCommitDeLaUltima(['el server escucha en 9115']), OUTCOMES.DONE)
    expect(r.state).toBe(RUN_STATES.OPEN)
    expect(r.run.step).toBe(STEPS.E2E)
    expect(r.run.task).toBe(2)
  })

  it('una tarea intermedia NO entra en e2e aunque haya recorridos', () => {
    const run = { ...enCommitDeLaUltima(['un recorrido']), task: 1 }
    const r = after(run, OUTCOMES.DONE)
    expect(r.state).toBe(RUN_STATES.OPEN)
    expect(r.run.step).toBe(STEPS.IMPLEMENT)
    expect(r.run.task).toBe(2)
  })

  it('newRun guarda los recorridos y los deja congelados', () => {
    const run = newRun({ plan: 'p.md', issue: 4, baseSha: 'abc', tasksTotal: 1, e2eRuns: ['uno', 'dos'] })
    expect(run.e2eRuns).toEqual(['uno', 'dos'])
    expect(Object.isFrozen(run)).toBe(true)
  })

  it('newRun sin e2eRuns deja una lista vacía, no undefined', () => {
    expect(newRun({ plan: 'p.md', issue: 4, baseSha: 'abc', tasksTotal: 1 }).e2eRuns).toEqual([])
  })
})

describe('las transiciones del paso e2e', () => {
  const enE2e = () => after(enCommitDeLaUltima(['un recorrido']), OUTCOMES.DONE).run

  it('DONE cierra en DELIVERED', () => {
    expect(after(enE2e(), OUTCOMES.DONE).state).toBe(RUN_STATES.DELIVERED)
  })

  it('FAILED cierra en BLOCKED_E2E', () => {
    expect(after(enE2e(), OUTCOMES.FAILED).state).toBe(RUN_STATES.BLOCKED_E2E)
  })

  it('INDETERMINATE cierra en DELIVERED: no verificado NO retiene el slice', () => {
    // Deliberado: un docker que no arranca dejaría el slice en
    // status:in-progress reteniendo area:/touches: y una plaza de cap sin nadie
    // trabajando — el modo de fallo que F13 y F18 se dedicaron a quitar.
    expect(after(enE2e(), OUTCOMES.INDETERMINATE).state).toBe(RUN_STATES.DELIVERED)
  })

  it('DISCARDED repite el paso y suma un descarte', () => {
    const r = after(enE2e(), OUTCOMES.DISCARDED)
    expect(r.state).toBe(RUN_STATES.OPEN)
    expect(r.run.step).toBe(STEPS.E2E)
    expect(r.run.discards).toBe(1)
  })

  it('OVER_BUDGET corta por encima de todo, como en cualquier paso', () => {
    expect(after(enE2e(), OUTCOMES.OVER_BUDGET).state).toBe(RUN_STATES.ABORTED_BUDGET)
  })

  it('CORRECTIONS_ORDERED LANZA: el par que la tabla no describe no se interpreta', () => {
    expect(() => after(enE2e(), OUTCOMES.CORRECTIONS_ORDERED)).toThrow(/transición imposible/)
  })

  it('el run que entra no se toca nunca', () => {
    const antes = enE2e()
    after(antes, OUTCOMES.FAILED)
    expect(antes.step).toBe(STEPS.E2E)
    expect(antes.discards).toBe(0)
  })

  // El gate del release no cambia de criterio: sigue exigiendo `closed:
  // delivered`, y un run parado en e2e no lo tiene. Es lo que hace que no haga
  // falta una puerta nueva para imponer el paso.
  it('un run parado en e2e NO está entregado para deliveredRun', () => {
    const parado = enE2e()
    const r = deliveredRun(JSON.stringify({ ...parado, issue: 4 }), 4)
    expect(r.ok).toBe(false)
    expect(r.why).toMatch(/no está entregado/)
  })
})
