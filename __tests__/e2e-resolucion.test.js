// ============================================================================
// Los TRES estados de la celda E2E, y por qué son tres y no dos.
//
// Una celda vacía significaría dos cosas incompatibles: (a) se pensó y este
// slice no tiene nada que atravesar, y (b) nadie rellenó la columna. Mismo
// resultado, indistinguibles — y con (b) la feature queda inerte sin que nadie
// se entere. Es la ambigüedad que GATE_LABEL_NONE ya resolvió para el caso
// gemelo, con una diferencia que decide el diseño: gate:none lo DERIVA el
// plugin, y aquí la distinción sólo la sabe quien escribe el spec. No hay
// forma de derivarla, así que se declara.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { resolveE2e, resolveGates, GATES, gateLabels, gatesFromLabels } from '../scripts/gates.js'

describe('resolveE2e — los tres estados', () => {
  it('recorridos: declarado, con e2e', () => {
    const r = resolveE2e('levantado con el example\\, curl -i :9115/metrics responde 200')
    expect(r.runs).toEqual(['levantado con el example, curl -i :9115/metrics responde 200'])
    expect(r.declared).toBe(true)
    expect(r.none).toBe(false)
    expect(r.contradiction).toBe(false)
  })

  it('dos recorridos separados por coma no escapada son dos', () => {
    expect(resolveE2e('recorrido uno, recorrido dos').runs).toEqual(['recorrido uno', 'recorrido dos'])
  })

  it('el token `no` es declarado y sin e2e', () => {
    for (const cell of ['no', 'NO', ' no ', '`no`', '**no**', 'n/a', 'N/A']) {
      const r = resolveE2e(cell)
      expect(r.declared, cell).toBe(true)
      expect(r.none, cell).toBe(true)
      expect(r.runs, cell).toEqual([])
    }
  })

  it('un marcador de sin-valor es NO DECLARADO, no un `no`', () => {
    for (const cell of ['', '-', '–', '—', '―', '−', '--', '   ']) {
      const r = resolveE2e(cell)
      expect(r.declared, cell).toBe(false)
      expect(r.none, cell).toBe(false)
      expect(r.runs, cell).toEqual([])
    }
  })

  it('un recorrido que EMPIEZA por "no" es un recorrido, no el token', () => {
    const r = resolveE2e('no se puede acceder a /metrics sin levantar el server')
    expect(r.none).toBe(false)
    expect(r.runs).toEqual(['no se puede acceder a /metrics sin levantar el server'])
  })

  it('el token junto a un recorrido es una contradicción', () => {
    const r = resolveE2e('no, curl -i :9115/metrics responde 200')
    expect(r.contradiction).toBe(true)
    expect(r.declared).toBe(true)
  })

  it('un recorrido vacío entre comas se descarta en silencio', () => {
    expect(resolveE2e('uno,, dos').runs).toEqual(['uno', 'dos'])
  })
})

describe('el gate e2e derivado', () => {
  it('con recorridos, resolveGates añade e2e', () => {
    expect(resolveGates('backend', '–', 'curl -i :9115/metrics').gates).toEqual(['plan', 'e2e'])
  })

  it('con el token `no`, no lo añade', () => {
    expect(resolveGates('backend', '–', 'no').gates).toEqual(['plan'])
  })

  it('sin celda E2E (tercer argumento ausente), el comportamiento es el de hoy', () => {
    expect(resolveGates('ui', '–').gates).toEqual(['visual', 'plan'])
    expect(resolveGates('backend', '–').gates).toEqual(['plan'])
  })

  it('ningún Tipo implica e2e por sí solo', () => {
    for (const t of ['ui', 'infra', 'backend', '']) {
      expect(resolveGates(t, '–', '–').gates, t).not.toContain('e2e')
    }
  })

  it('e2e va ÚLTIMO en el orden canónico', () => {
    expect(resolveGates('ui', 'apply', 'un recorrido').gates).toEqual(['visual', 'apply', 'plan', 'e2e'])
  })

  it('el vocabulario incluye e2e con sus dos textos', () => {
    expect(Object.keys(GATES)).toEqual(['visual', 'apply', 'plan', 'e2e'])
    expect(GATES.e2e.kickoff).toMatch(/## E2E/)
    expect(GATES.e2e.kickoff).toMatch(/AGENTS\.md/)
    expect(GATES.e2e.issue).toMatch(/e2e/)
  })

  // El canal por el que el gate SOBREVIVE: /ct-next reconstruye el slice que
  // despacha a partir del ISSUE, así que un gate que no vuelva de sus labels
  // se pierde en un redespacho, en un --reopen y tras un /clear.
  it('la label sobrevive la ida y vuelta', () => {
    const gates = resolveGates('ui', '–', 'un recorrido').gates
    const labels = gateLabels(gates)
    expect(labels).toEqual(['gate:visual', 'gate:plan', 'gate:e2e'])
    const back = gatesFromLabels(labels)
    expect(back.gates).toEqual(gates)
    expect(back.declared).toBe(true)
    expect(back.unknown).toEqual([])
  })
})
