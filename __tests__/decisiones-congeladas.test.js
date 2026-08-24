import { describe, it, expect } from 'vitest'
import { readFrozenDecisions, FROZEN_DECISIONS_HEADING } from '../scripts/groom.js'

// Formato LITERAL de _TEMPLATE-execution-spec.md, verificado contra
// docs/loop/loop.body.html: la cita del usuario va DENTRO del paréntesis.
const SPEC = `# Epic

## Decisiones congeladas
- **D-1 · versión mínima** — iOS 17. *(Procedencia: hablada — «lo dijo el PO».)*
- **D-2 · nombre** — se llama Pilares. *(Procedencia: deducida de D-1.)*

## 9. Slices
`

describe('readFrozenDecisions', () => {
  it('proyecta la sección con la procedencia quitada de cada línea', () => {
    const { content } = readFrozenDecisions(SPEC)
    expect(content).toBe('- **D-1 · versión mínima** — iOS 17.\n- **D-2 · nombre** — se llama Pilares.')
  })
  it('spec sin la sección → content null y reason ausente', () => {
    const r = readFrozenDecisions('# Epic\n\nnada\n')
    expect(r.content).toBe(null)
    expect(r.reason).toBe('ausente')
  })
  it('sección presente pero vacía → content null y reason vacia', () => {
    const r = readFrozenDecisions('## Decisiones congeladas\n\n## 9. Slices\n')
    expect(r.content).toBe(null)
    expect(r.reason).toBe('vacia')
  })
  it('una cabecera ### dentro la trunca → content null, reason malformada Y el aviso nombra la línea (I3.2)', () => {
    const r = readFrozenDecisions('## Decisiones congeladas\n- **D-1** — algo.\n### sub\nmás\n')
    expect(r.content).toBe(null)
    expect(r.reason).toBe('malformada')
    expect(r.warnings.join('\n')).toContain('### sub') // el aviso nombra la línea ofensora, no solo el reason
  })
  // B2 — fallo de limpieza OBSERVABLE: un sufijo que la regex no casa (aquí, la
  // cursiva con guion bajo) NO viaja en silencio: la sección se proyecta pero
  // con un aviso que nombra la línea donde sobrevive "Procedencia".
  it('sufijo no reconocido → se proyecta CON aviso (no falla mudo)', () => {
    const r = readFrozenDecisions('## Decisiones congeladas\n- **D-1** — iOS 17. _(Procedencia: hablada.)_\n\n## 9. Slices\n')
    expect(r.content).toContain('iOS 17')
    expect(r.warnings.join('\n')).toMatch(/Procedencia/)
    expect(r.warnings.join('\n')).toContain('- **D-1** — iOS 17.') // nombra la línea
  })
  it('la cabecera se exporta con el literal correcto', () => {
    expect(FROZEN_DECISIONS_HEADING).toBe('## Decisiones congeladas')
  })
})
