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
