import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('hooks.json', () => {
  const h = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8'))
  it('registra SessionStart y Stop', () => {
    expect(h.hooks.SessionStart).toBeTruthy()
    expect(h.hooks.Stop).toBeTruthy()
  })
  it('usa ${CLAUDE_PLUGIN_ROOT} y apunta a ficheros existentes', () => {
    const cmds = [...h.hooks.SessionStart, ...h.hooks.Stop]
      .flatMap((e) => e.hooks).map((x) => x.command)
    for (const c of cmds) {
      expect(c).toContain('${CLAUDE_PLUGIN_ROOT}')
      const rel = c.replace('node ${CLAUDE_PLUGIN_ROOT}/', '').trim()
      expect(existsSync(join(root, rel))).toBe(true)
    }
  })
})
