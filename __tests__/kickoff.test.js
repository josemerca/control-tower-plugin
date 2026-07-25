import { describe, it, expect } from 'vitest'
import { renderKickoff, buildStateSeed, ACCOUNT_MAP } from '../scripts/kickoff.js'
import { parseState } from '../scripts/state.js'

const SLICE = { n: 7, entrega: 'refresh token', type: 'backend', ac: ['AC-7.1'], deps: [1], issue: '#7' }

describe('renderKickoff', () => {
  it('universal + addendum backend', () => {
    const k = renderKickoff(SLICE, { repo: 'o/r' })
    expect(k).toContain('subagent-driven-development')
    expect(k).toContain('.agent/STATE.md')
    expect(k.toLowerCase()).toMatch(/migraci|rollback|contrato/) // addendum backend
  })
  it('addendum ui distinto', () => {
    const k = renderKickoff({ ...SLICE, type: 'ui' }, { repo: 'o/r' })
    expect(k.toLowerCase()).toMatch(/screenshot|design system/)
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
})

describe('ACCOUNT_MAP', () => {
  it('tiene personal/work y dirs', () => {
    expect(ACCOUNT_MAP.personal).toContain('menoplus')
    expect(ACCOUNT_MAP.personalDir).toMatch(/claude-personal/)
    expect(ACCOUNT_MAP.workDir).toMatch(/claude-work/)
  })
})
