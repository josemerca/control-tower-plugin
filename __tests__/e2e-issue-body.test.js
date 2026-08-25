import { describe, it, expect } from 'vitest'
import { buildIssueBody, buildLabels, renderE2eContent, E2E_HEADING, GATES_HEADING } from '../scripts/groom.js'

const slice = (e2e) => ({
  n: 5, issue: null, name: 'exposición y exporter', type: 'backend',
  entrega: 'get_metrics y el router', gate: '–', deps: [],
  ac: ['un criterio'], protected: '', area: ['core'], touches: [], e2e,
})

describe('la sección ## E2E del cuerpo del issue', () => {
  it('con recorridos, se emite con uno por línea y verbatim', () => {
    const body = buildIssueBody(slice('levantado con el example\\, curl -i :9115/metrics responde 200, el server escucha en 9115'), null)
    expect(body).toContain(E2E_HEADING)
    expect(body).toContain('- levantado con el example, curl -i :9115/metrics responde 200')
    expect(body).toContain('- el server escucha en 9115')
  })

  it('con `no`, la sección NO se emite', () => {
    expect(buildIssueBody(slice('no'), null)).not.toContain(E2E_HEADING)
  })

  it('sin columna, la sección NO se emite', () => {
    expect(buildIssueBody(slice(''), null)).not.toContain(E2E_HEADING)
  })

  it('la sección va DESPUÉS de ## Gates', () => {
    const body = buildIssueBody(slice('un recorrido'), null)
    expect(body.indexOf(E2E_HEADING)).toBeGreaterThan(body.indexOf(GATES_HEADING))
  })

  it('con recorridos, la label gate:e2e se emite', () => {
    expect(buildLabels(slice('un recorrido'))).toContain('gate:e2e')
  })

  it('con `no`, la label gate:e2e NO se emite', () => {
    expect(buildLabels(slice('no'))).not.toContain('gate:e2e')
  })

  it('renderE2eContent es la única fuente de verdad del contenido', () => {
    expect(renderE2eContent(slice('uno, dos'))).toBe('- uno\n- dos')
  })
})

// El caso de mesa que fija la proporción real, y que es el argumento de todo el
// diseño: si esto produjera un e2e por slice, un epic de 8 daría 6 informes de
// relleno — la forma más segura de que nadie leyera el séptimo. Medido a mano
// sobre mo-monitoring v1 aplicando el criterio "¿hace falta el sistema en pie?".
describe('mo-monitoring v1 como caso de mesa', () => {
  const filas = [
    { n: 1, name: 'esqueleto', type: 'infra', e2e: 'no' },
    { n: 2, name: 'modelo y environment', type: 'backend', e2e: 'no' },
    { n: 3, name: 'repositorio prometheus', type: 'backend', e2e: 'no' },
    { n: 4, name: 'summary collector', type: 'backend', e2e: 'no' },
    { n: 5, name: 'exposición y exporter', type: 'backend', e2e: 'levantado con el example\\, curl -i :9115/metrics responde 200 con content type text/plain; version=0.0.4' },
    { n: 6, name: 'logging JSON', type: 'backend', e2e: 'no' },
    { n: 7, name: 'instrument y guard', type: 'backend', e2e: 'no' },
    { n: 8, name: 'golden tests de paridad', type: 'backend', e2e: 'el example compila con cargo build --examples y sirve /metrics' },
  ].map((f) => ({ ...f, issue: null, entrega: '', gate: '–', deps: [], ac: ['x'], protected: '', area: ['core'], touches: [] }))

  it('exactamente 2 de 8 producen gate:e2e', () => {
    const conE2e = filas.filter((f) => buildLabels(f).includes('gate:e2e'))
    expect(conE2e.map((f) => f.n)).toEqual([5, 8])
  })

  it('las 6 con `no` no emiten sección ## E2E', () => {
    for (const f of filas.filter((f) => f.e2e === 'no')) {
      expect(buildIssueBody(f, null), `slice #${f.n}`).not.toContain(E2E_HEADING)
    }
  })
})
