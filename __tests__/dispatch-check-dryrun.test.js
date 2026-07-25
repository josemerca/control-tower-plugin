import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'dispatch-check.mjs')
// Stub de `gh` para los tests de manejo de errores (review round 1, Critical
// 2): NUNCA toca la red ni ningún repo real. Se controla por variables de
// entorno — ver __tests__/fixtures/fake-gh-bin/gh.
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
function runReal(args, envOverrides = {}) {
  try {
    const out = execFileSync('node', [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...envOverrides },
    })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}
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

describe('dispatch-check — fix review round 1 (Critical 1: fixture atado a --dry-run)', () => {
  it('CT_CLAIM_FIXTURE puesto SIN --dry-run → exit 2, no decide con el fixture ni toca gh', () => {
    const fixture = { candLabels: ['touches:db'], openIssues: [], readback: [{ n: 3, labels: ['status:in-progress', 'touches:db'] }] }
    let threw = false
    try {
      // Sin PATH a fake-gh: si el script intentara invocar `gh` de verdad aquí,
      // fallaría igualmente (no hay red/auth), pero la aserción real es que
      // NUNCA llega a intentarlo — ver el mensaje de error esperado.
      execFileSync('node', [script, '3', '--repo', 'o/r'], { encoding: 'utf8', env: { ...process.env, CT_CLAIM_FIXTURE: JSON.stringify(fixture) } })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '')).toMatch(/CT_CLAIM_FIXTURE.*--dry-run/i)
    }
    expect(threw).toBe(true)
  })
})

describe('dispatch-check — fix review round 1 (Minor 1: validación de flags)', () => {
  it('--repo colgante (último token, sin valor) → exit 2', () => {
    let threw = false
    try {
      execFileSync('node', [script, '5', '--dry-run', '--repo'], { encoding: 'utf8' })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '')).toMatch(/uso:/)
    }
    expect(threw).toBe(true)
  })

  it('--repo seguido de otro flag (sin valor real) → exit 2', () => {
    let threw = false
    try {
      execFileSync('node', [script, '5', '--repo', '--dry-run'], { encoding: 'utf8' })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
    }
    expect(threw).toBe(true)
  })
})

describe('dispatch-check — fix review round 1 (Minor 2: --settle-ms/CT_CLAIM_SETTLE_MS malformado falla ruidosamente)', () => {
  it('--settle-ms "2000ms" (no numérico) → exit 2, mensaje claro', () => {
    let threw = false
    try {
      execFileSync('node', [script, '5', '--repo', 'o/r', '--dry-run', '--settle-ms', '2000ms'],
        { encoding: 'utf8', env: { ...process.env, CT_CLAIM_FIXTURE: JSON.stringify({ candLabels: [], openIssues: [], readback: [{ n: 5, labels: ['status:in-progress'] }] }) } })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '')).toMatch(/settle-ms/i)
    }
    expect(threw).toBe(true)
  })

  it('CT_CLAIM_SETTLE_MS malformado por entorno → exit 2', () => {
    let threw = false
    try {
      execFileSync('node', [script, '5', '--repo', 'o/r', '--dry-run'],
        { encoding: 'utf8', env: { ...process.env, CT_CLAIM_SETTLE_MS: 'nope', CT_CLAIM_FIXTURE: JSON.stringify({ candLabels: [], openIssues: [], readback: [{ n: 5, labels: ['status:in-progress'] }] }) } })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
    }
    expect(threw).toBe(true)
  })

  it('--settle-ms 0 explícito sigue siendo válido (no es un error)', () => {
    const fixture = { candLabels: ['touches:db'], openIssues: [], readback: [{ n: 3, labels: ['status:in-progress', 'touches:db'] }] }
    const out = execFileSync('node', [script, '3', '--repo', 'o/r', '--dry-run', '--settle-ms', '0'],
      { encoding: 'utf8', env: { ...process.env, CT_CLAIM_FIXTURE: JSON.stringify(fixture) } })
    expect(out).toMatch(/claimed #3/)
  })
})

describe('dispatch-check — fix review round 1 (Critical 2: fallos de gh() no dejan locks huérfanos silenciosos)', () => {
  it('el claim inicial falla (gh caído) → exit 1, mensaje claro, sin crash sin capturar', () => {
    const r = runReal(['11', '--repo', 'o/r', '--settle-ms', '10'], {
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:in-progress',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se pudo escribir el claim/i)
  })

  it('el readback tras el claim falla → revierte, avisa que la carrera no se pudo confirmar, exit 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-fakegh-'))
    const counterFile = join(dir, 'list-count')
    const r = runReal(['13', '--repo', 'o/r', '--settle-ms', '10'], {
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]), // primera llamada (colisión): sin choque
      FAKE_GH_LIST_FAIL_AT: '1', // segunda llamada (readback post-claim): falla
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    rmSync(dir, { recursive: true, force: true })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se puede confirmar la carrera/i)
    expect(r.out).toMatch(/revertido a status:ready/i)
  })

  it('carrera perdida y el revert también falla → avisa "carrera perdida" Y el lock huérfano con el comando manual', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-fakegh-'))
    const counterFile = join(dir, 'list-count')
    // Formato crudo de `gh issue list --json number,labels` (number/labels[].name),
    // no el {n,labels} interno — allOpen() hace ese mapeo, y el stub debe imitar
    // exactamente lo que devolvería gh de verdad.
    const readbackConLoss = [
      { number: 17, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] }, // nosotros
      { number: 5, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] },  // otro, número menor → perdemos
    ]
    const r = runReal(['17', '--repo', 'o/r', '--settle-ms', '10'], {
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], readbackConLoss]), // 1ª: sin choque; 2ª: readback con pérdida
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready', // el revert (no el claim inicial) falla
    })
    rmSync(dir, { recursive: true, force: true })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/carrera perdida/i)
    expect(r.out).toMatch(/ATENCIÓN.*#17.*bloqueado/is)
    expect(r.out).toMatch(/gh issue edit 17 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })

  it('--release cuyo gh edit falla → exit 1, mensaje claro (no crash sin capturar)', () => {
    const r = runReal(['19', '--repo', 'o/r', '--release'], {
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:in-review',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se pudo liberar #19/i)
  })
})
