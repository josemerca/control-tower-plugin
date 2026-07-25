import { describe, it, expect } from 'vitest'
import { buildIssueTitle, buildLabels, buildIssueBody, groomPlan } from '../scripts/groom.js'

const SLICE = { n: 2, issue: null, type: 'backend', entrega: 'refresh flow', deps: [1], ac: ['AC-2.1'], protected: 'schema §6' }

describe('groom puro', () => {
  it('title lleva orden + entrega', () => {
    expect(buildIssueTitle(SLICE)).toBe('#2 refresh flow')
  })
  it('labels: type + status:backlog', () => {
    expect(buildLabels(SLICE)).toEqual(['type:backend', 'status:backlog'])
  })
  it('body: link al spec, AC, deps como merge-after, protected', () => {
    const b = buildIssueBody(SLICE, { specPath: 'docs/spec.md', specSection: '9' })
    expect(b).toContain('docs/spec.md#9')
    expect(b).toContain('AC-2.1')
    expect(b).toContain('merge-after #1')
    expect(b).toContain('schema §6')
  })
  it('body sin deps → sin merge-after', () => {
    const b = buildIssueBody({ ...SLICE, deps: [] }, { specPath: 'x', specSection: '9' })
    expect(b).not.toContain('merge-after')
  })
  it('groomPlan agrega milestone + issues', () => {
    const plan = groomPlan([SLICE], { milestone: 'Epic X', specPath: 'x', specSection: '9' })
    expect(plan.milestone).toBe('Epic X')
    expect(plan.issues).toHaveLength(1)
    expect(plan.issues[0].labels).toContain('type:backend')
  })
})
