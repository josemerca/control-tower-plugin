import { describe, it, expect } from 'vitest'
import { diffIssue, formatDrift, buildReconcileBody } from '../scripts/reconcile.js'
import { groomPlan, buildIssueBody } from '../scripts/groom.js'

const SPEC_REF = { path: 'spec.md', heading: null, url: null, reason: 'sin publicar' }
const SLICE = { n: 1, name: 'login', type: 'backend', entrega: '', gate: '', deps: [], ac: ['AC-1.1'], protected: 'schema', area: [], touches: [] }

// wanted: el issue que el plan dice que ESTE slice debería tener, con las
// decisiones que se le pasen (y opcionalmente contexto del epic / reason).
function wanted(frozenDecisions, opts = {}) {
  const plan = groomPlan([SLICE], {
    milestone: 'Epic', specRef: SPEC_REF,
    epicContext: opts.epicContext ?? null,
    frozenDecisions, frozenDecisionsReason: opts.frozenDecisionsReason ?? null,
  })
  return plan.issues[0]
}

// existingIssue: la forma cruda de gh api, con el body que se le pase. Labels/
// milestone/título calcados del wanted para que solo difieran las decisiones.
function existingIssue(body) {
  const w = wanted('- **D-1** — iOS 17.')
  return { number: 5, title: w.title, state: 'open', milestone: { title: 'Epic' }, labels: w.labels.map((name) => ({ name })), body }
}

describe('diffIssue — frozenDecisionsDiffers', () => {
  it('detecta divergencia cuando el spec trae decisiones y el issue no', () => {
    const existing = existingIssue(buildIssueBody(SLICE, SPEC_REF, null, null))
    const diff = diffIssue(existing, wanted('- **D-1** — iOS 17.'), 'Epic', [])
    expect(diff.frozenDecisionsDiffers).toBe(true)
  })
  it('no cuenta como divergencia cuando el motivo es malformada (unknown)', () => {
    const existing = existingIssue(buildIssueBody(SLICE, SPEC_REF, null, '- **D-1** — iOS 17.'))
    const diff = diffIssue(existing, wanted(null, { frozenDecisionsReason: 'malformada' }), 'Epic', [])
    expect(diff.frozenDecisionsDiffers).toBe(false)
  })
  it('se reporta como nota, no como divergencia (no mueve el exit code)', () => {
    const existing = existingIssue(buildIssueBody(SLICE, SPEC_REF, null, null))
    const diff = diffIssue(existing, wanted('- **D-1** — iOS 17.'), 'Epic', [])
    const rep = formatDrift(diff).join('\n')
    expect(rep).toContain('nota:')
    expect(rep).toContain('## Decisiones congeladas')
    expect(rep).not.toContain('divergencia:')
  })
})

describe('buildReconcileBody — decisiones congeladas', () => {
  it('inserta la sección en un issue que no la tenía, antes del heredado', () => {
    const existing = buildIssueBody(SLICE, SPEC_REF, null, null)
    const res = buildReconcileBody(existing, wanted('- **D-1** — iOS 17.'))
    expect(res.body).toContain('## Decisiones congeladas')
    expect(res.body).toContain('iOS 17')
    expect(res.body.indexOf('## Decisiones congeladas')).toBeLessThan(res.body.indexOf('## Contexto heredado'))
  })
  it('reescribe la sección cuando el spec cambia, Y SOLO ella (I3.5)', () => {
    const existing = buildIssueBody(SLICE, SPEC_REF, null, '- **D-1** — iOS 16.')
    const res = buildReconcileBody(existing, wanted('- **D-1** — iOS 17.'))
    expect(res.body).toContain('iOS 17')
    expect(res.body).not.toContain('iOS 16')
    // "solo ella": todo lo que NO es la sección de decisiones queda idéntico.
    const strip = (b) => b.replace(/## Decisiones congeladas\n[\s\S]*?(?=\n## |\n<!-- ct-order)/, '## Decisiones congeladas\n<X>')
    expect(strip(res.body)).toBe(strip(existing))
  })
  it('retira la sección cuando el spec ya no la trae', () => {
    const existing = buildIssueBody(SLICE, SPEC_REF, null, '- **D-1** — iOS 17.')
    const res = buildReconcileBody(existing, wanted(null))
    expect(res.body).not.toContain('## Decisiones congeladas')
  })
  it('NO retira la sección cuando el motivo es malformada (unknown)', () => {
    const existing = buildIssueBody(SLICE, SPEC_REF, null, '- **D-1** — iOS 17.')
    const res = buildReconcileBody(existing, wanted(null, { frozenDecisionsReason: 'malformada' }))
    expect(res.body).toBe(null) // nada cambió: unknown no autoriza a retirar
  })
  it('al insertar epic y decisiones en un issue viejo, el orden es epic → decisiones → heredado', () => {
    const existing = buildIssueBody(SLICE, SPEC_REF, null, null)
    const res = buildReconcileBody(existing, wanted('- **D-1** — x.', { epicContext: 'contexto común' }))
    expect(res.body.indexOf('## Contexto del epic')).toBeLessThan(res.body.indexOf('## Decisiones congeladas'))
    expect(res.body.indexOf('## Decisiones congeladas')).toBeLessThan(res.body.indexOf('## Contexto heredado'))
  })
  it('se RINDE (marca sin-ancla) cuando no hay ni heredado ni AC donde anclar (I3.6)', () => {
    // Body sin "## Contexto heredado" ni "## Acceptance criteria": no hay dónde
    // anclar la inserción. La propiedad que se fija es que las decisiones NO se
    // escriben a ciegas: se marca 'sin-ancla'. (El body puede cambiar por otros
    // bloques de reconcile —aquí el enlace al spec—; lo que importa es que las
    // decisiones se rindieron en vez de inventar una posición.)
    const sinAncla = 'algo de texto\n\n<!-- ct-order:1 -->'
    const res = buildReconcileBody(sinAncla, wanted('- **D-1** — iOS 17.'))
    expect(res.unresolvedFrozenDecisions).toBe('sin-ancla')
    expect(res.body || '').not.toContain('## Decisiones congeladas') // no se escribió a ciegas
  })
})
