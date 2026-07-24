import { describe, it, expect } from 'vitest'
import { parseState, renderState, composeHydration, shouldBlockStop } from '../scripts/state.js'

const SAMPLE = `---
task: "OAuth login"
status: in_progress
last_commit: abc1234
github_issue: 482
tasks:
  - {id: T001, done: true, desc: "model"}
  - {id: T007, done: false, desc: "refresh"}
---
## Current State
Login works, refresh a medias.`

describe('parseState', () => {
  it('extrae frontmatter tipado', () => {
    const { meta } = parseState(SAMPLE)
    expect(meta.status).toBe('in_progress')
    expect(meta.github_issue).toBe(482)
    expect(meta.tasks[1].done).toBe(false)
  })
  it('extrae el cuerpo en prosa', () => {
    expect(parseState(SAMPLE).body).toContain('Login works')
  })
  it('sin frontmatter → meta vacío, body entero', () => {
    const { meta, body } = parseState('solo prosa')
    expect(meta).toEqual({})
    expect(body).toBe('solo prosa')
  })
})

describe('renderState', () => {
  it('roundtrip conserva campos', () => {
    const again = parseState(renderState(parseState(SAMPLE)))
    expect(again.meta.task).toBe('OAuth login')
    expect(again.meta.tasks[0].id).toBe('T001')
  })
})

describe('composeHydration', () => {
  it('incluye estado y commits', () => {
    const out = composeHydration('ESTADO', 'abc log')
    expect(out).toContain('ESTADO')
    expect(out).toContain('abc log')
  })
  it('sin estado → cadena vacía (no inyecta ruido)', () => {
    expect(composeHydration('', 'x')).toBe('')
  })
})

describe('shouldBlockStop', () => {
  it('bloquea si HEAD avanzó más allá del STATE', () => {
    expect(shouldBlockStop({ headSha: 'def', stateSha: 'abc' })).toBe(true)
  })
  it('no bloquea si están a la par', () => {
    expect(shouldBlockStop({ headSha: 'abc', stateSha: 'abc' })).toBe(false)
  })
  it('no bloquea sin STATE previo', () => {
    expect(shouldBlockStop({ headSha: 'def', stateSha: '' })).toBe(false)
  })
  it('anti-bucle: no bloquea si stop_hook_active', () => {
    expect(shouldBlockStop({ headSha: 'def', stateSha: 'abc', stopHookActive: true })).toBe(false)
  })
})
