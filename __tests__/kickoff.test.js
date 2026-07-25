import { describe, it, expect } from 'vitest'
import { renderKickoff, buildStateSeed, ACCOUNT_MAP } from '../scripts/kickoff.js'
import { parseState } from '../scripts/state.js'

const SLICE = { n: 7, entrega: 'refresh token', type: 'backend', ac: ['AC-7.1'], deps: [1], issue: '#7' }

describe('renderKickoff', () => {
  it('backend: has backend markers, not ui/infra/bugfix', () => {
    const k = renderKickoff(SLICE, { repo: 'o/r' })
    expect(k).toContain('subagent-driven-development')
    expect(k).toContain('.agent/STATE.md')
    expect(k.toLowerCase()).toMatch(/migraci|rollback|contrato/) // backend present
    // Verify other addenda are NOT present
    expect(k.toLowerCase()).not.toMatch(/screenshot|design system/) // not ui
    expect(k.toLowerCase()).not.toMatch(/dry-run.*plan primero/) // not infra
    expect(k.toLowerCase()).not.toMatch(/reproduce-first.*test que falla/) // not bugfix
  })
  it('ui: has ui markers, not backend/infra/bugfix', () => {
    const k = renderKickoff({ ...SLICE, type: 'ui' }, { repo: 'o/r' })
    expect(k.toLowerCase()).toMatch(/screenshot|design system/) // ui present
    // Verify other addenda are NOT present
    expect(k.toLowerCase()).not.toMatch(/migraci|rollback|contrato/) // not backend
    expect(k.toLowerCase()).not.toMatch(/dry-run.*plan primero/) // not infra
    expect(k.toLowerCase()).not.toMatch(/reproduce-first.*test que falla/) // not bugfix
  })
  it('infra: has infra markers, not ui/backend/bugfix', () => {
    const k = renderKickoff({ ...SLICE, type: 'infra' }, { repo: 'o/r' })
    expect(k.toLowerCase()).toMatch(/dry-run.*plan primero/) // infra present
    // Verify other addenda are NOT present
    expect(k.toLowerCase()).not.toMatch(/screenshot|design system/) // not ui
    expect(k.toLowerCase()).not.toMatch(/migraci|rollback|contrato/) // not backend
    expect(k.toLowerCase()).not.toMatch(/reproduce-first.*test que falla/) // not bugfix
  })
  it('bugfix: has bugfix markers, not ui/backend/infra', () => {
    const k = renderKickoff({ ...SLICE, type: 'bugfix' }, { repo: 'o/r' })
    expect(k.toLowerCase()).toMatch(/reproduce-first.*test que falla/) // bugfix present
    // Verify other addenda are NOT present
    expect(k.toLowerCase()).not.toMatch(/screenshot|design system/) // not ui
    expect(k.toLowerCase()).not.toMatch(/migraci|rollback|contrato/) // not backend
    expect(k.toLowerCase()).not.toMatch(/dry-run.*plan primero/) // not infra
  })
})

// W-C: la liberación del claim (status:in-progress → status:in-review) sigue
// viviendo en el kickoff (la decide el agente, no el código) — pero tiene que
// ser el comando LITERAL con los valores reales sustituidos, no una
// descripción que el agente tenga que traducir por su cuenta y pueda no
// ejecutar nunca (ver el brief: "instruir al agente vía el prompt no es
// aceptable [para el claim] porque un prompt es advisory" — el release SÍ
// se deja en el prompt a propósito, pero con el mismo cuidado de literalidad).
describe('renderKickoff — instrucción de --release (W-C)', () => {
  it('incluye el comando literal de dispatch-check --release, con el issue y el repo reales sustituidos', () => {
    const k = renderKickoff({ ...SLICE, n: 42 }, { repo: 'o/r' })
    expect(k).toContain('dispatch-check.mjs 42 --repo o/r --release')
  })
  it('usa ${CLAUDE_PLUGIN_ROOT} para el path del script, igual que el resto de comandos del plugin', () => {
    const k = renderKickoff({ ...SLICE, n: 7 }, { repo: 'menoplus-app/menoplus' })
    expect(k).toContain('${CLAUDE_PLUGIN_ROOT}/scripts/dispatch-check.mjs 7 --repo menoplus-app/menoplus --release')
  })
})

describe('buildStateSeed', () => {
  it('produce STATE.md parseable con los campos del slice', () => {
    const seed = buildStateSeed(SLICE, { branch: 'feat/7', base: 'main' })
    const { meta } = parseState(seed)
    expect(meta.status).toBe('not_started')
    expect(meta.github_issue).toBe(7)
    expect(meta.branch).toBe('feat/7')
  })
  it('handles issue: null → github_issue: null', () => {
    const sliceNoIssue = { ...SLICE, issue: null }
    const seed = buildStateSeed(sliceNoIssue, { branch: 'feat/7', base: 'main' })
    const { meta } = parseState(seed)
    expect(meta.github_issue).toBe(null)
  })
  it('handles empty ac array → next_action falls back to "ver issue"', () => {
    const sliceEmptyAc = { ...SLICE, ac: [] }
    const seed = buildStateSeed(sliceEmptyAc, { branch: 'feat/7', base: 'main' })
    const { meta } = parseState(seed)
    expect(meta.next_action).toContain('ver issue')
  })
})

describe('ACCOUNT_MAP', () => {
  it('tiene personal/work y dirs', () => {
    expect(ACCOUNT_MAP.personal).toContain('menoplus')
    expect(ACCOUNT_MAP.personalDir).toMatch(/claude-personal/)
    expect(ACCOUNT_MAP.workDir).toMatch(/claude-work/)
  })
})
