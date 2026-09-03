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
    // Genérico sobre TODOS los eventos del fichero, no sobre una lista escrita a
    // mano: enumerarlos aquí hacía que un hook nuevo quedara sin comprobar y el
    // test siguiera verde — es decir, un test que no podía fallar.
    const eventos = Object.values(h.hooks).flat()
    for (const e of eventos) {
      expect(e.hooks, `evento sin la clave "hooks": ${JSON.stringify(e)}`).toBeTruthy()
    }
    const cmds = eventos.flatMap((e) => e.hooks).map((x) => x.command)
    expect(cmds.length).toBeGreaterThan(0)
    for (const c of cmds) {
      expect(c).toContain('${CLAUDE_PLUGIN_ROOT}')
      const rel = c.replace('node ${CLAUDE_PLUGIN_ROOT}/', '').trim()
      expect(existsSync(join(root, rel))).toBe(true)
    }
  })
  it('registra el PreToolUse de la puerta del despacho, sobre Task', () => {
    const pre = h.hooks.PreToolUse
    expect(pre).toBeTruthy()
    const sobreTask = pre.filter((e) => e.matcher === 'Task')
    expect(sobreTask.length).toBeGreaterThan(0)
    expect(JSON.stringify(sobreTask)).toContain('dispatch-guard.js')
  })
  it('registra el PreToolUse de la puerta de closing keywords, sobre Bash', () => {
    const pre = h.hooks.PreToolUse
    expect(pre).toBeTruthy()
    const sobreBash = pre.filter((e) => e.matcher === 'Bash')
    expect(sobreBash.length).toBeGreaterThan(0)
    expect(JSON.stringify(sobreBash)).toContain('commit-keyword-guard.js')
  })
})
