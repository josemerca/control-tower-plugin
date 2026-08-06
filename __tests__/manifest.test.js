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
  // La versión vive en DOS ficheros porque dos consumidores distintos la leen:
  // Claude Code lee `.claude-plugin/plugin.json` y npm lee `package.json`. Nada
  // en el runtime obliga a que coincidan, y durante mucho tiempo no coincidieron
  // (0.1.0 contra 0.2x): quien abría el repo y miraba el `package.json` primero
  // se llevaba una versión que no era la del plugin. Este test es lo que hace
  // que el duplicado no pueda divergir en silencio — si hay que repetir una
  // verdad en dos sitios, algo tiene que atarlos.
  it('package.json y plugin.json declaran la MISMA version', () => {
    const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.version).toBe(plugin.version)
  })
  it('marketplace.json referencia el plugin', () => {
    const mk = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'))
    expect(mk.plugins.some((p) => p.name === 'control-tower-loop')).toBe(true)
  })
})
