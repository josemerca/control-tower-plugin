import { describe, it, expect } from 'vitest'
import { ownedLabelsOnly, diffLabels, diffIssue, hasDrift, formatDrift, buildReconcileEditArgs } from '../scripts/reconcile.js'

// F5 — el groom detecta divergencia, no solo existencia. Hasta ahora,
// ct-groom.mjs solo comprobaba "¿existe un issue con este marcador
// ct-order?" — si sí, "ya existe, no se duplica" y listo, sin mirar si el
// título/labels/milestone del issue siguen coincidiendo con lo que el spec
// produce HOY. Un autor que arregla la tabla §9 tras notar un label o un
// título equivocado, y vuelve a correr /ct-groom, no ve NADA: el mismo
// mensaje de éxito que si todo estuviera perfecto.
//
// Este fichero es la capa pura (testeada sin red): decide QUÉ cuenta como
// divergencia y CÓMO se reporta/aplica. ct-groom.mjs (wrapper delgado) solo
// hace de pegamento: llama a estas funciones con lo que ya trae de `gh` y
// del plan, e imprime/ejecuta lo que le devuelven.

describe('ownedLabelsOnly — el spec solo es autoridad sobre type:/area:/touches:', () => {
  it('conserva type:/area:/touches:, descarta status: y cualquier label ajena', () => {
    const labels = ['type:backend', 'area:api', 'touches:db', 'status:in-progress', 'status:backlog', 'good first issue', 'priority:high']
    expect(ownedLabelsOnly(labels)).toEqual(['type:backend', 'area:api', 'touches:db'])
  })
  it('lista vacía / undefined → []', () => {
    expect(ownedLabelsOnly([])).toEqual([])
    expect(ownedLabelsOnly(undefined)).toEqual([])
  })
})

describe('diffLabels — solo compara dentro del namespace que el spec posee', () => {
  it('sin diferencias → missing y extra vacíos', () => {
    const d = diffLabels(['type:backend', 'area:api', 'status:in-progress'], ['type:backend', 'area:api', 'status:backlog'])
    expect(d).toEqual({ missing: [], extra: [] })
  })
  it('falta una label que el spec pide → missing', () => {
    const d = diffLabels(['status:backlog'], ['type:backend', 'status:backlog'])
    expect(d.missing).toEqual(['type:backend'])
    expect(d.extra).toEqual([])
  })
  it('sobra una label type:/area:/touches: que el spec ya no produce → extra', () => {
    const d = diffLabels(['type:ios', 'status:backlog'], ['type:backend', 'status:backlog'])
    expect(d.missing).toEqual(['type:backend'])
    expect(d.extra).toEqual(['type:ios'])
  })
  // El caso concreto que motiva la feature (status:in-progress movida por
  // /ct-next o un humano tras el groom) NUNCA debe aparecer como "extra":
  // sería ruido que entrena a ignorar el resto del reporte.
  it('status:in-progress (o cualquier status: distinto de backlog) nunca aparece como extra', () => {
    const d = diffLabels(['type:backend', 'area:api', 'status:in-progress'], ['type:backend', 'area:api', 'status:backlog'])
    expect(d.extra).toEqual([])
    expect(d.missing).toEqual([])
  })
  it('una label ajena al spec (sin prefijo type:/area:/touches:) nunca se reporta', () => {
    const d = diffLabels(['type:backend', 'good first issue', 'priority:high'], ['type:backend'])
    expect(d.extra).toEqual([])
  })
})

const WANTED_ISSUE = { order: 2, title: '#2 refresh token', labels: ['type:backend', 'status:backlog'] }

describe('diffIssue — compara título, milestone y labels (namespace propio) de un issue existente contra el plan', () => {
  it('todo coincide → sin título/milestone/labels en el diff, closed=false', () => {
    const existing = { number: 42, title: '#2 refresh token', state: 'open', milestone: { title: 'Epic' }, labels: [{ name: 'type:backend' }, { name: 'status:in-progress' }] }
    const d = diffIssue(existing, WANTED_ISSUE, 'Epic')
    expect(d.title).toBeNull()
    expect(d.milestone).toBeNull()
    expect(d.labels).toEqual({ missing: [], extra: [] })
    expect(d.closed).toBe(false)
    expect(d.order).toBe(2)
    expect(d.issueNumber).toBe(42)
  })
  it('título distinto → { current, wanted }', () => {
    const existing = { number: 42, title: '#2 refrescar sesión', state: 'open', milestone: { title: 'Epic' }, labels: [{ name: 'type:backend' }] }
    const d = diffIssue(existing, WANTED_ISSUE, 'Epic')
    expect(d.title).toEqual({ current: '#2 refrescar sesión', wanted: '#2 refresh token' })
  })
  it('milestone distinto → { current, wanted }', () => {
    const existing = { number: 42, title: '#2 refresh token', state: 'open', milestone: { title: 'Sprint 1' }, labels: [{ name: 'type:backend' }] }
    const d = diffIssue(existing, WANTED_ISSUE, 'Epic')
    expect(d.milestone).toEqual({ current: 'Sprint 1', wanted: 'Epic' })
  })
  it('sin milestone en el issue (null) → current: null', () => {
    const existing = { number: 42, title: '#2 refresh token', state: 'open', milestone: null, labels: [{ name: 'type:backend' }] }
    const d = diffIssue(existing, WANTED_ISSUE, 'Epic')
    expect(d.milestone).toEqual({ current: null, wanted: 'Epic' })
  })
  it('acepta labels como array de strings además de array de {name} (tolerante a la forma de entrada)', () => {
    const existing = { number: 42, title: '#2 refresh token', state: 'open', milestone: { title: 'Epic' }, labels: ['type:backend'] }
    const d = diffIssue(existing, WANTED_ISSUE, 'Epic')
    expect(d.labels).toEqual({ missing: [], extra: [] })
  })
  it('issue cerrado → closed:true, junto con cualquier otra divergencia', () => {
    const existing = { number: 42, title: '#2 refrescar sesión', state: 'closed', milestone: { title: 'Epic' }, labels: [{ name: 'type:backend' }] }
    const d = diffIssue(existing, WANTED_ISSUE, 'Epic')
    expect(d.closed).toBe(true)
    expect(d.title).not.toBeNull()
  })
})

describe('hasDrift — closed por sí solo NO cuenta como divergencia', () => {
  it('sin título/milestone/labels divergentes → false, aunque esté cerrado', () => {
    const d = { order: 1, issueNumber: 1, closed: true, title: null, milestone: null, labels: { missing: [], extra: [] } }
    expect(hasDrift(d)).toBe(false)
  })
  it('con título divergente → true', () => {
    const d = { order: 1, issueNumber: 1, closed: false, title: { current: 'a', wanted: 'b' }, milestone: null, labels: { missing: [], extra: [] } }
    expect(hasDrift(d)).toBe(true)
  })
  it('con labels.missing no vacío → true', () => {
    const d = { order: 1, issueNumber: 1, closed: false, title: null, milestone: null, labels: { missing: ['type:x'], extra: [] } }
    expect(hasDrift(d)).toBe(true)
  })
  it('con labels.extra no vacío → true', () => {
    const d = { order: 1, issueNumber: 1, closed: false, title: null, milestone: null, labels: { missing: [], extra: ['type:x'] } }
    expect(hasDrift(d)).toBe(true)
  })
})

describe('formatDrift — una línea legible por campo, nombrando slice, issue, actual y spec', () => {
  it('sin divergencia → [] (silencio real, no solo "no se detectó nada")', () => {
    const d = { order: 3, issueNumber: 9, closed: false, title: null, milestone: null, labels: { missing: [], extra: [] } }
    expect(formatDrift(d)).toEqual([])
  })
  it('issue cerrado SIN otra divergencia → [] (closed solo no es divergencia, y no se anota si no hay nada más que decir)', () => {
    const d = { order: 3, issueNumber: 9, closed: true, title: null, milestone: null, labels: { missing: [], extra: [] } }
    expect(formatDrift(d)).toEqual([])
  })
  it('título divergente → línea con slice, issue, actual y spec', () => {
    const d = { order: 2, issueNumber: 42, closed: false, title: { current: 'X', wanted: 'Y' }, milestone: null, labels: { missing: [], extra: [] } }
    const lines = formatDrift(d)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/#2/)
    expect(lines[0]).toMatch(/#42/)
    expect(lines[0]).toMatch(/"X"/)
    expect(lines[0]).toMatch(/"Y"/)
  })
  it('milestone divergente (sin milestone actual) → "(ninguno)" en vez de "null"', () => {
    const d = { order: 2, issueNumber: 42, closed: false, title: null, milestone: { current: null, wanted: 'Epic' }, labels: { missing: [], extra: [] } }
    const lines = formatDrift(d)
    expect(lines[0]).toMatch(/\(ninguno\)/)
    expect(lines[0]).toMatch(/"Epic"/)
  })
  it('una línea por label faltante y por label sobrante', () => {
    const d = { order: 2, issueNumber: 42, closed: false, title: null, milestone: null, labels: { missing: ['type:backend'], extra: ['type:ios'] } }
    const lines = formatDrift(d)
    expect(lines).toHaveLength(2)
    expect(lines.find((l) => l.includes('type:backend'))).toMatch(/falta/i)
    expect(lines.find((l) => l.includes('type:ios'))).toMatch(/sobra/i)
  })
  it('issue cerrado CON otra divergencia → añade una nota de "cerrado" al final, avisando antes de --reconcile', () => {
    const d = { order: 2, issueNumber: 42, closed: true, title: { current: 'X', wanted: 'Y' }, milestone: null, labels: { missing: [], extra: [] } }
    const lines = formatDrift(d)
    expect(lines.length).toBe(2)
    expect(lines[lines.length - 1]).toMatch(/cerrad/i)
    expect(lines[lines.length - 1]).toMatch(/reconcile/i)
  })
})

describe('buildReconcileEditArgs — traduce un diff a los flags de `gh issue edit`', () => {
  it('sin divergencia → []', () => {
    const d = { order: 1, issueNumber: 1, closed: false, title: null, milestone: null, labels: { missing: [], extra: [] } }
    expect(buildReconcileEditArgs(d)).toEqual([])
  })
  it('título divergente → --title', () => {
    const d = { order: 1, issueNumber: 1, closed: false, title: { current: 'a', wanted: 'b' }, milestone: null, labels: { missing: [], extra: [] } }
    expect(buildReconcileEditArgs(d)).toEqual(['--title', 'b'])
  })
  it('milestone divergente → --milestone', () => {
    const d = { order: 1, issueNumber: 1, closed: false, title: null, milestone: { current: null, wanted: 'Epic' }, labels: { missing: [], extra: [] } }
    expect(buildReconcileEditArgs(d)).toEqual(['--milestone', 'Epic'])
  })
  it('labels: --add-label por cada missing, --remove-label por cada extra', () => {
    const d = { order: 1, issueNumber: 1, closed: false, title: null, milestone: null, labels: { missing: ['type:backend', 'area:api'], extra: ['type:ios'] } }
    expect(buildReconcileEditArgs(d)).toEqual(['--add-label', 'type:backend', '--add-label', 'area:api', '--remove-label', 'type:ios'])
  })
  it('combina todos los campos divergentes en una sola llamada', () => {
    const d = { order: 1, issueNumber: 1, closed: true, title: { current: 'a', wanted: 'b' }, milestone: { current: 'x', wanted: 'y' }, labels: { missing: ['type:backend'], extra: ['type:ios'] } }
    expect(buildReconcileEditArgs(d)).toEqual(['--title', 'b', '--milestone', 'y', '--add-label', 'type:backend', '--remove-label', 'type:ios'])
  })
})
