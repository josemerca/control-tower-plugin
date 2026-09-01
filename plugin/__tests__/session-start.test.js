import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const hook = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'session-start.js')

function runHook(cwd) {
  const out = execFileSync('node', [hook], {
    input: JSON.stringify({ cwd, source: 'startup', hook_event_name: 'SessionStart' }),
    encoding: 'utf8',
  })
  return out.trim()
}

describe('session-start hook', () => {
  it('inyecta el STATE.md si existe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    mkdirSync(join(dir, '.agent'))
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\ntask: "X"\n---\n## Current State\nvoy por T7')
    const out = JSON.parse(runHook(dir))
    expect(out.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(out.hookSpecificOutput.additionalContext).toContain('voy por T7')
    rmSync(dir, { recursive: true, force: true })
  })
  it('sin STATE.md → salida vacía', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    expect(runHook(dir)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
  it('stdin malformado → salida vacía, exit 0 (no crash)', () => {
    const r = spawnSync('node', [hook], { input: 'no-json{', encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect((r.stdout || '').trim()).toBe('')
  })
  // ==========================================================================
  // F7 — a través del BUNDLE de producción (dist/session-start.js), que es lo
  // que Claude Code ejecuta de verdad, con un .agent/STATE.md real en disco.
  // Reproduce el incidente: un `next_action` que ya no se podía ejecutar,
  // inyectado sin más en toda sesión nueva del repo.
  // ==========================================================================
  function writeState(dir, text) {
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), text)
  }
  const INCIDENTE = [
    '---',
    'task: "Plan vs Propuestas"',
    'status: in_progress',
    'next_action: "Lanzar la corrida REAL de /ct-groom sobre el spec"',
    'blocked:',
    '  reason: "la corrida escribiría datos falsos"',
    '  unblock: "corregir la §9 del spec y revalidarla"',
    '---',
    '## Current State',
    'Groom preparado, sin ejecutar.',
  ].join('\n')

  it('STATE.md BLOQUEADO → el contexto inyectado abre con el aviso y declara el next_action suspendido', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeState(dir, INCIDENTE)
    const ctx = JSON.parse(runHook(dir)).hookSpecificOutput.additionalContext
    expect(ctx.split('\n')[0]).toMatch(/TRABAJO BLOQUEADO/)
    expect(ctx).toMatch(/SUSPENDIDO/)
    expect(ctx).toMatch(/No lo ejecutes/i)
    expect(ctx).toMatch(/escribiría datos falsos/)
    expect(ctx).toMatch(/corregir la §9 del spec/)
    // Y el aviso va ANTES del next_action crudo: quien lee de arriba abajo se
    // encuentra la neutralización primero.
    expect(ctx.indexOf('TRABAJO BLOQUEADO')).toBeLessThan(ctx.indexOf('Lanzar la corrida REAL'))
    rmSync(dir, { recursive: true, force: true })
  })

  it('control: el MISMO STATE.md sin el campo `blocked` se inyecta sin ningún aviso', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const sinBlocked = INCIDENTE.replace(/blocked:\n(  .*\n)+/, '')
    expect(sinBlocked).not.toContain('blocked:') // control: el campo se quitó de verdad
    writeState(dir, sinBlocked)
    const ctx = JSON.parse(runHook(dir)).hookSpecificOutput.additionalContext
    expect(ctx).not.toMatch(/TRABAJO BLOQUEADO/)
    expect(ctx).toMatch(/Lanzar la corrida REAL/) // sigue hidratando igual que siempre
    rmSync(dir, { recursive: true, force: true })
  })

  it('STATE.md con `status: blocked` (el campo equivocado, el error probable) → avisa igual y dice cuál es el bueno', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeState(dir, '---\nstatus: blocked\nnext_action: "Lanzar la corrida REAL de /ct-groom"\n---\n## Current State\nx')
    const ctx = JSON.parse(runHook(dir)).hookSpecificOutput.additionalContext
    expect(ctx.split('\n')[0]).toMatch(/TRABAJO BLOQUEADO/)
    expect(ctx).toMatch(/SUSPENDIDO/)
    expect(ctx).toMatch(/`blocked: \{reason:/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('STATE.md con el frontmatter roto → no crashea, avisa de que no se sabe si está bloqueado, exit 0 y sin stderr', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeState(dir, '---\ntask: "sin cerrar\n  ]: [\n---\n## Current State\nalgo')
    const r = spawnSync('node', [hook], { input: JSON.stringify({ cwd: dir }), encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
    expect(ctx).toMatch(/NO SE PUDO LEER/)
    expect(ctx).toMatch(/posiblemente bloqueado/i)
    rmSync(dir, { recursive: true, force: true })
  })

  it('`verify` no vacío → el contexto dice que es una comprobación PENDIENTE, no un hecho', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeState(dir, '---\nverify: "`gh issue list` devuelve 6 issues"\n---\n## Current State\nx')
    const ctx = JSON.parse(runHook(dir)).hookSpecificOutput.additionalContext
    expect(ctx).toMatch(/PENDIENTE/)
    expect(ctx).toMatch(/no un hecho ya comprobado/i)
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin fuga de stderr cuando cwd no es un repo git', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    mkdirSync(join(dir, '.agent'))
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\ntask: "X"\n---\n## Current State\nhola')
    const r = spawnSync('node', [hook], { input: JSON.stringify({ cwd: dir }), encoding: 'utf8' })
    expect(r.stderr).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
})
