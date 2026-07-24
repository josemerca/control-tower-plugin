import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('plugin manifest', () => {
  it('plugin.json tiene name y version', () => {
    const m = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))
    expect(m.name).toBe('control-tower-loop')
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
  it('marketplace.json referencia el plugin', () => {
    const mk = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'))
    expect(mk.plugins.some((p) => p.name === 'control-tower-loop')).toBe(true)
  })
})
