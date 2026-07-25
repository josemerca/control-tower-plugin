import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'dispatch-check.mjs')
function run(issue, fixture) {
  try {
    const out = execFileSync('node', [script, String(issue), '--repo', 'o/r', '--dry-run'],
      { encoding: 'utf8', env: { ...process.env, CT_CLAIM_FIXTURE: JSON.stringify(fixture) } })
    return { code: 0, out }
  } catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') } }
}

describe('dispatch-check --dry-run', () => {
  it('colisión → exit 1', () => {
    const r = run(7, { candLabels: ['touches:db'], openIssues: [{ n: 5, labels: ['status:in-progress', 'touches:db'] }], readback: [] })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/COLLISION|colisión/i)
  })
  it('sin colisión y ganamos la carrera → exit 0 (claimed)', () => {
    const r = run(3, { candLabels: ['touches:db'], openIssues: [], readback: [{ n: 3, labels: ['status:in-progress', 'touches:db'] }] })
    expect(r.code).toBe(0)
  })
  it('carrera perdida (otro menor in-progress con token) → exit 1', () => {
    const r = run(7, { candLabels: ['touches:db'], openIssues: [], readback: [
      { n: 7, labels: ['status:in-progress', 'touches:db'] },
      { n: 5, labels: ['status:in-progress', 'touches:db'] },
    ] })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/perdid|lost/i)
  })

  it('--release → exit 0 e imprime la transición in-progress → in-review', () => {
    try {
      const out = execFileSync('node', [script, '9', '--repo', 'o/r', '--release', '--dry-run'], { encoding: 'utf8' })
      expect(out).toMatch(/released #9.*in-review/)
    } catch (e) {
      throw new Error(`no debería fallar: ${e.status} ${(e.stdout || '') + (e.stderr || '')}`)
    }
  })

  it('error de uso (sin --repo) → exit 2', () => {
    let threw = false
    try {
      execFileSync('node', [script, '9', '--dry-run'], { encoding: 'utf8' })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '')).toMatch(/uso:/)
    }
    expect(threw).toBe(true)
  })

  it('error de uso (issue no numérico) → exit 2', () => {
    let threw = false
    try {
      execFileSync('node', [script, 'nope', '--repo', 'o/r', '--dry-run'], { encoding: 'utf8' })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
    }
    expect(threw).toBe(true)
  })

  it('con CT_CLAIM_FIXTURE, la espera de asentamiento se salta (rápido incluso con --settle-ms alto)', () => {
    const fixture = { candLabels: ['touches:db'], openIssues: [], readback: [{ n: 3, labels: ['status:in-progress', 'touches:db'] }] }
    const t0 = Date.now()
    const out = execFileSync('node', [script, '3', '--repo', 'o/r', '--dry-run', '--settle-ms', '5000'],
      { encoding: 'utf8', env: { ...process.env, CT_CLAIM_FIXTURE: JSON.stringify(fixture) } })
    const elapsed = Date.now() - t0
    expect(out).toMatch(/claimed #3/)
    expect(elapsed).toBeLessThan(1000) // muy por debajo de los 5000ms configurados: la espera no debió ejecutarse
  })
})
