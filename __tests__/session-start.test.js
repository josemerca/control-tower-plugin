import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const hook = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'session-start.js')

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
})
