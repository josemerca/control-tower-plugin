import { describe, it, expect } from 'vitest'
import { LOOP_ARTIFACT_PATTERNS } from '../scripts/scope.js'

describe('el informe de e2e es un artefacto del loop', () => {
  it('docs/superpowers/e2e/** está exento del scope-gate', () => {
    expect(LOOP_ARTIFACT_PATTERNS).toContain('docs/superpowers/e2e/**')
  })

  it('es un directorio propio, no la exención del spec', () => {
    // No va al «Registro de cierre» del spec a propósito: esa exención está
    // documentada como el agujero por el que, en el incidente del despacho 1,
    // un agente metió parte de su autorización falsa.
    expect(LOOP_ARTIFACT_PATTERNS.filter((p) => p.includes('e2e'))).toHaveLength(1)
  })
})
