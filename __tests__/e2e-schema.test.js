// ============================================================================
// El contrato del informe de e2e: JSON del agente -> un OUTCOME que la tabla
// consume. Hermano de readVerdict/readReport, no copia: mismo patrón (validar a
// mano, cero dependencias nuevas), otro contenido.
//
// LO QUE NO PUEDE COMPROBAR, Y SE DICE PORQUE UN LÍMITE DICHO ES OPERABLE: que
// la salida sea real. Nada impide que un agente invente un stdout — la misma
// clase de agujero que el plugin ya reconoce sobre el `-OK`. Lo único que lo
// acota es exigir el comando REPRODUCIBLE: una salida inventada se cae en
// cuanto alguien la pega.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { readE2eReport } from '../scripts/step-contracts.js'
import { OUTCOMES } from '../scripts/run-machine.js'

const A = 'el server escucha en 9115 por defecto y en el puerto indicado si se pasa'
const B = 'el example compila y sirve /metrics'

const verde = (run) => ({
  run, verdict: 'verde',
  brought_up: 'cargo run --example serve',
  evidence: [{ command: 'curl -sS -o /dev/null -w "%{http_code}" localhost:9115/metrics', output: '200' }],
})
const rojo = (run) => ({ run, verdict: 'rojo', brought_up: 'cargo run --example serve', expected: '200', actual: '404', repro: 'curl -i localhost:9115/metrics', refuted_by: 'que el puerto lo ocupe otro proceso' })
const sinVerificar = (run) => ({ run, verdict: 'no-verificado', reason: 'la sección de AGENTS.md está sin rellenar', unblock: 'rellenar "Levantar" y "Listo cuando"' })

describe('readE2eReport', () => {
  it('todo verde → DONE', () => {
    const r = readE2eReport({ runs: [verde(A)] }, [A])
    expect(r.outcome).toBe(OUTCOMES.DONE)
    expect(r.runs).toHaveLength(1)
  })

  it('un rojo → FAILED', () => {
    expect(readE2eReport({ runs: [rojo(A)] }, [A]).outcome).toBe(OUTCOMES.FAILED)
  })

  it('verde + no-verificado → DONE, con el motivo dentro', () => {
    const r = readE2eReport({ runs: [verde(A), sinVerificar(B)] }, [A, B])
    expect(r.outcome).toBe(OUTCOMES.DONE)
    expect(r.runs.find((x) => x.run === B).reason).toMatch(/AGENTS\.md/)
  })

  it('structured ausente o no objeto → DISCARDED', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      expect(readE2eReport(bad, [A]).outcome, JSON.stringify(bad)).toBe(OUTCOMES.DISCARDED)
    }
  })

  it('falta la entrada de un recorrido → DISCARDED, aunque el otro esté verde', () => {
    const r = readE2eReport({ runs: [verde(A)] }, [A, B])
    expect(r.outcome).toBe(OUTCOMES.DISCARDED)
    expect(r.why).toContain(B)
  })

  it('una entrada de más → DISCARDED', () => {
    const r = readE2eReport({ runs: [verde(A), verde(B)] }, [A])
    expect(r.outcome).toBe(OUTCOMES.DISCARDED)
    expect(r.why).toContain(B)
  })

  it('un `run` que no es idéntico al declarado → DISCARDED', () => {
    const r = readE2eReport({ runs: [verde('el server escucha en 9115')] }, [A])
    expect(r.outcome).toBe(OUTCOMES.DISCARDED)
  })

  it('un verdict fuera de los tres → DISCARDED', () => {
    expect(readE2eReport({ runs: [{ ...verde(A), verdict: 'ok' }] }, [A]).outcome).toBe(OUTCOMES.DISCARDED)
  })

  it('un verde sin evidence → DISCARDED', () => {
    expect(readE2eReport({ runs: [{ ...verde(A), evidence: [] }] }, [A]).outcome).toBe(OUTCOMES.DISCARDED)
    const sinSalida = { ...verde(A), evidence: [{ command: 'curl x', output: '' }] }
    expect(readE2eReport({ runs: [sinSalida] }, [A]).outcome).toBe(OUTCOMES.DISCARDED)
  })

  it('un no-verificado sin reason ni unblock → DISCARDED', () => {
    expect(readE2eReport({ runs: [{ run: A, verdict: 'no-verificado' }] }, [A]).outcome).toBe(OUTCOMES.DISCARDED)
  })

  // Finding 2 de la review de Task 8: un rojo a medias no se descartaba, y
  // `escribirInformeE2e` (ct-step.mjs) confía en que lo que llega aquí ya está
  // validado — sin esta rama, un rojo sin uno de sus cuatro campos colaba
  // "undefined" literal en el markdown de la pull request.
  it('un rojo sin uno de los cuatro campos que lo sostienen → DISCARDED', () => {
    for (const campo of ['expected', 'actual', 'repro', 'refuted_by']) {
      const incompleto = { ...rojo(A) }
      delete incompleto[campo]
      const r = readE2eReport({ runs: [incompleto] }, [A])
      expect(r.outcome, campo).toBe(OUTCOMES.DISCARDED)
    }
  })

  it('EL ROJO GANA AL MAL FORMADO', () => {
    // Un rojo dice algo del PRODUCTO; un formato roto, del informe. Emitiendo
    // el descarte primero, el agente arreglaría el formato, reintentaría y sólo
    // ENTONCES vería el rojo: dos vueltas para un dato que ya se tenía.
    const r = readE2eReport({ runs: [rojo(A)] }, [A, B])
    expect(r.outcome).toBe(OUTCOMES.FAILED)
  })

  it('sin recorridos declarados no se llama a esto, pero si se llama no revienta', () => {
    expect(readE2eReport({ runs: [] }, []).outcome).toBe(OUTCOMES.DONE)
  })
})
