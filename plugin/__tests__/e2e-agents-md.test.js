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
import { fileURLToPath } from 'node:url'

const INIT = fileURLToPath(new URL('../scripts/ct-init.sh', import.meta.url))

// La versión del contrato se LEE del propio ct-init.sh (misma doctrina y misma
// razón que en ct-init.test.js): el número tecleado aquí a mano se quedó atrás
// en el primer bump ajeno a esta feature.
const CONTRACT_VERSION = Number(readFileSync(INIT, 'utf8').match(/^SLICES_CONTRACT_VERSION=(\d+)$/m)[1])

function initIn(existingAgents) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-init-e2e-'))
  spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' })
  if (existingAgents != null) writeFileSync(join(dir, 'AGENTS.md'), existingAgents)
  const r = spawnSync('bash', [INIT, dir], { encoding: 'utf8' })
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
  // #93 — el contrato salió de AGENTS.md a su propio fichero del repo
  // gobernado. Esta suite mira las DOS cosas: la sección de travesía, que sigue
  // en AGENTS.md, y la versión del contrato, que ya no está ahí.
  const contrato = readFileSync(join(dir, 'docs', 'superpowers', 'CONTRATO-SLICES.md'), 'utf8')
  rmSync(dir, { recursive: true, force: true })
  return { r, agents, contrato }
}

describe('la sección de travesía en AGENTS.md', () => {
  it('se siembra con sus seis campos y el plazo por defecto', () => {
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

  // v20 y no v19: `Señal` y `E2E` llegaron en paralelo y las dos reclamaron el
  // v19. El v19 se publicó con el bloque de `Señal`; el bloque que trae las dos
  // columnas necesita un número propio, y es éste. Lo que el test clava sigue
  // siendo lo mismo — que el bloque sembrado documenta la columna E2E y que su
  // versión es la que declara el script, no un número tecleado dos veces.
  //
  // v21: la aclaración de los DOS tokens de "no aplica" (`no` y `n/a`) subió
  // de número — un pase anterior la dejó en v20 sin bump y ningún repo
  // bootstrapeado con ese v20 podía recibirla. El test sigue clavando lo
  // mismo, ahora contra v21.
  //
  // #93: el contrato dejó de ser una sección de AGENTS.md, así que la versión
  // se busca en su fichero. Lo que el test clava no cambia: que va por la
  // versión que declara el script y que documenta la columna E2E.
  it('el contrato de la tabla de slices va por la versión que declara el script y documenta la columna E2E', () => {
    const { contrato } = initIn(null)
    expect(contrato).toContain(`<!-- ct-init:slices-contract-version: ${CONTRACT_VERSION} -->`)
    expect(contrato).toContain('E2E')
  })
})
