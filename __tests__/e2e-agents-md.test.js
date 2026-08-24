// ============================================================================
// La sección de AGENTS.md que declara CÓMO se atraviesa este repo.
//
// El plugin gobierna repos ajenos y no puede saber cómo se pone en pie uno: en
// una librería Rust es `cargo run --example` y un puerto; en una app con
// staging es un navegador y flags. Lo declara el dueño del repo, igual que ya
// declara build/test/lint.
//
// Y OJO CON LO QUE NO SE REUTILIZA: SLICES_PRISTINE_HASHES hashea su bloque
// para detectar si el usuario lo tocó. Aquí sería al revés — esta sección es
// una PLANTILLA que el usuario TIENE que rellenar, y con hashes de pristine
// rellenarla se leería como manipulación. Mismo código, propósito opuesto: se
// toman los marcadores y la siembra, y se deja fuera versión y pristine.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const INIT = new URL('../scripts/ct-init.sh', import.meta.url).pathname

function initIn(existingAgents) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-init-e2e-'))
  spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' })
  if (existingAgents != null) writeFileSync(join(dir, 'AGENTS.md'), existingAgents)
  const r = spawnSync('bash', [INIT, dir], { encoding: 'utf8' })
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
  rmSync(dir, { recursive: true, force: true })
  return { r, agents }
}

describe('la sección de travesía en AGENTS.md', () => {
  it('se siembra con sus cinco campos y el plazo por defecto', () => {
    const { agents } = initIn(null)
    expect(agents).toContain('## Cómo se atraviesa este repo (e2e)')
    for (const f of ['Levantar:', 'Listo cuando:', 'Plazo:', 'Tirar:', 'Herramientas:', 'Fuera de límites:']) {
      expect(agents, f).toContain(f)
    }
    expect(agents).toMatch(/por defecto 60/)
  })

  it('rellenarla NO hace que el plugin deje de reconocerla', () => {
    const { agents } = initIn(null)
    const relleno = agents.replace('- Levantar:', '- Levantar:      cargo run --example serve')
    const dir = mkdtempSync(join(tmpdir(), 'ct-init-e2e2-'))
    spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' })
    writeFileSync(join(dir, 'AGENTS.md'), relleno)
    const r = spawnSync('bash', [INIT, dir], { encoding: 'utf8' })
    const after = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    rmSync(dir, { recursive: true, force: true })
    expect(r.status).toBe(0)
    expect(after).toContain('cargo run --example serve')
    expect(after).toContain('## Cómo se atraviesa este repo (e2e)')
  })

  it('no duplica la sección al correr dos veces', () => {
    const { agents } = initIn(null)
    const dir = mkdtempSync(join(tmpdir(), 'ct-init-e2e3-'))
    spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' })
    writeFileSync(join(dir, 'AGENTS.md'), agents)
    spawnSync('bash', [INIT, dir], { encoding: 'utf8' })
    const after = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    rmSync(dir, { recursive: true, force: true })
    expect(after.match(/## Cómo se atraviesa este repo \(e2e\)/g)).toHaveLength(1)
  })

  it('el contrato de la tabla de slices va por la v19 y documenta la columna E2E', () => {
    const { agents } = initIn(null)
    expect(agents).toMatch(/contrato.*v19|v19/)
    expect(agents).toContain('E2E')
  })
})
