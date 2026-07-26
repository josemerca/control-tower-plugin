import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ADDENDA } from '../scripts/kickoff.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'ct-init.sh')
const groomScript = join(root, 'scripts', 'ct-groom.mjs')

// F5: ct-groom.mjs --dry-run ahora también enumera issues existentes de
// `--repo` (lectura, para detectar divergencia) — sin un `gh` de mentira en
// el PATH, el único test de este fichero que invoca groomScript llamaría al
// `gh` real de la máquina contra el repo ficticio "o/r". Mismo stub y mismo
// criterio que __tests__/ct-groom-dryrun.test.js: sin overrides, responde
// "ningún issue existente", que es lo correcto para un plan recién creado.
const fakeGhDir = join(root, '__tests__', 'fixtures', 'fake-gh-bin')
const fakeGhEnv = { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}` }

// extractWorkedExample: saca el bloque de tabla markdown bajo "Ejemplo que
// parsea tal cual" del AGENTS.md sembrado por ct-init.sh — las mismas
// líneas que empiezan por "|", contiguas, hasta la primera línea que no
// empiece por "|" (la prosa "Detalle completo..." que cierra la sección).
function extractWorkedExample(agentsMd) {
  const lines = agentsMd.split('\n')
  const startIdx = lines.findIndex((l) => l.includes('Ejemplo que parsea tal cual'))
  const tableLines = []
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('|')) tableLines.push(lines[i])
    else if (tableLines.length) break
  }
  return tableLines.join('\n') + '\n'
}

describe('ct-init.sh', () => {
  it('crea .agent/STATE.md y AGENTS.md en dir vacío', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(existsSync(join(dir, '.agent', 'STATE.md'))).toBe(true)
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
  it('idempotente: no pisa un STATE.md existente', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    mkdirSync(join(dir, '.agent'))
    writeFileSync(join(dir, '.agent', 'STATE.md'), 'MÍO')
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(readFileSync(join(dir, '.agent', 'STATE.md'), 'utf8')).toBe('MÍO')
    rmSync(dir, { recursive: true, force: true })
  })
  it('idempotente: no pisa un AGENTS.md existente (preserva su contenido, solo añade la sección §9 si falta)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(dir, 'AGENTS.md'), 'MÍO-AGENTS')
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    // El contenido del usuario no se toca ni se reordena...
    expect(agents.startsWith('MÍO-AGENTS')).toBe(true)
    // ...pero, F2: la sección §9 (contrato con /ct-groom) se añade igual,
    // porque este AGENTS.md no la traía.
    expect(agents).toContain('<!-- ct-init:slices-contract -->')
    rmSync(dir, { recursive: true, force: true })
  })

  // F2: el contrato de la tabla §9 (qué columnas exige /ct-groom, qué
  // marcadores de "sin valor" acepta, qué genera cada una) hasta ahora solo
  // vivía en commands/ct-groom.md — un fichero que lee quien EJECUTA groom,
  // nunca quien ESCRIBE el spec. `ct-init` debe sembrar ese contrato en el
  // AGENTS.md del repo destino, que sí lee quien escribe specs.
  it('AGENTS.md nuevo: el esqueleto ya trae la sección §9 (contrato con /ct-groom)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('<!-- ct-init:slices-contract -->')
    expect(agents).toContain('| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |')
    rmSync(dir, { recursive: true, force: true })
  })

  // F3: el contrato sembrado escondía que "Tipo" decide el addendum del
  // agente despachado, y que el título del issue sale de "Slice" (no de
  // "Entrega") — ver el hallazgo del spec real que disparó este cambio.
  it('AGENTS.md nuevo: la sección §9 dice que "Slice" es obligatoria y alimenta el título, y que "Entrega" es opcional (Descripción)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toMatch(/\*\*Slice\*\* \*\(obligatoria\)\*/)
    expect(agents).toMatch(/T.TULO/i)
    expect(agents).toMatch(/\*\*Entrega\*\* \*\(opcional\)\*/)
    expect(agents).toContain('Descripción')
    rmSync(dir, { recursive: true, force: true })
  })

  // Review de F3, finding 2: esta aserción antes listaba los cuatro tipos
  // como literales escritos a mano ('ui'/'backend'/'infra'/'bugfix') — si
  // alguien añade un quinto addendum a ADDENDA (kickoff.js), el aviso en
  // runtime de ct-groom.mjs lo reflejaría solo (deriva de
  // Object.keys(ADDENDA)), pero este test seguiría en VERDE con la prosa
  // sembrada diciendo solo cuatro, sin detectar la deriva. Se deriva de
  // ADDENDA en vez de hardcodear una tercera copia de la lista: el test se
  // autovigila, no hace falta tocarlo cuando se añada un tipo nuevo.
  it('AGENTS.md nuevo: la sección §9 nombra TODOS los valores de "Tipo" reconocidos (derivado de ADDENDA, no una lista hardcodeada) y que deciden el addendum', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toMatch(/addendum/i)
    expect(Object.keys(ADDENDA).length).toBeGreaterThan(0) // control: si ADDENDA quedara vacío, el .every() de abajo pasaría vacío y no probaría nada
    expect(Object.keys(ADDENDA).every((t) => agents.includes(`\`${t}\``))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  // Requisito explícito: el ejemplo sembrado debe seguir parseando de
  // verdad — se extrae tal cual del AGENTS.md generado (no una copia
  // parafraseada en el test) y se pasa por ct-groom.mjs --dry-run.
  it('el ejemplo sembrado ("Ejemplo que parsea tal cual") parsea de verdad con ct-groom.mjs --dry-run: 3 issues, títulos desde "Slice"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    const table = extractWorkedExample(agents)
    expect(table).toContain('| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |')
    const specDir = mkdtempSync(join(tmpdir(), 'ct-example-'))
    const specPath = join(specDir, 'spec.md')
    writeFileSync(specPath, `## 9. Desglose en slices\n${table}`)
    const out = execFileSync('node', [groomScript, specPath, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeGhEnv })
    const plan = JSON.parse(out)
    expect(plan.issues).toHaveLength(3)
    expect(plan.issues[0].title).toBe('#1 modelo')
    expect(plan.issues[1].title).toBe('#2 api')
    expect(plan.issues[2].title).toBe('#3 pantalla')
    expect(plan.issues[0].body).toContain('tabla `medicamentos`') // Entrega -> Descripción
    rmSync(dir, { recursive: true, force: true })
    rmSync(specDir, { recursive: true, force: true })
  })

  it('AGENTS.md existente SIN la sección §9 → se añade sin tocar el resto (caso "muy editado a mano")', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const heavilyEdited = [
      '# AGENTS.md',
      '',
      '## Project overview',
      'Mi proyecto rarísimo con notas personales de Jose que no se deben perder.',
      '',
      '## Gotchas',
      '- ojo con el símbolo `#` en mis propias notas, no es un slice',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'AGENTS.md'), heavilyEdited)
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('Mi proyecto rarísimo con notas personales de Jose que no se deben perder.')
    expect(agents).toContain('ojo con el símbolo `#` en mis propias notas, no es un slice')
    expect(agents).toContain('<!-- ct-init:slices-contract -->')
    // La sección añadida va DESPUÉS del contenido existente, no lo desplaza.
    expect(agents.indexOf('notas personales')).toBeLessThan(agents.indexOf('<!-- ct-init:slices-contract -->'))
    rmSync(dir, { recursive: true, force: true })
  })

  it('AGENTS.md existente SIN salto de línea final → añade la sección §9 sin corromper la última línea del usuario', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(dir, 'AGENTS.md'), '## Gotchas\n- última línea sin salto') // sin \n final, a propósito
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('- última línea sin salto')
    expect(agents).not.toMatch(/salto<!--/) // nunca fusionadas en la misma línea
    expect(agents).not.toMatch(/salto##/)
    expect(agents).toContain('<!-- ct-init:slices-contract -->')
    rmSync(dir, { recursive: true, force: true })
  })

  it('AGENTS.md ya trae la sección §9 (editada a mano por el usuario) → no se duplica ni se pisa', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const customSection = [
      '# AGENTS.md',
      '',
      '<!-- ct-init:slices-contract -->',
      '## Formato de la tabla §9 (versión editada por Jose, con una columna extra)',
      'Texto completamente distinto al que generaría ct-init.',
      '<!-- /ct-init:slices-contract -->',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'AGENTS.md'), customSection)
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toBe(customSection) // ni una letra tocada
    const occurrences = agents.split('<!-- ct-init:slices-contract -->').length - 1
    expect(occurrences).toBe(1) // no duplicada
    rmSync(dir, { recursive: true, force: true })
  })

  // Review de F2, punto 2: si alguien se carga el marcador de APERTURA pero
  // deja el heading y el cuerpo (y el marcador de cierre), el `grep -qF` del
  // marcador de apertura no encuentra nada → el script cree que la sección
  // no está y añade una SEGUNDA copia entera, en silencio, exit 0: dos
  // headings "## Formato de la tabla §9...", un marcador de cierre huérfano.
  // Debe, en su lugar, detectar el rastro parcial (heading O cierre sin el
  // par completo) y avisar sin añadir nada.
  it('AGENTS.md con el marcador de APERTURA borrado (heading + cuerpo + cierre intactos) → avisa, no duplica', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const orphan = [
      '# AGENTS.md',
      '',
      '## Formato de la tabla §9 (contrato con /ct-groom)',
      'cuerpo custom, el usuario borró el marcador de apertura sin querer.',
      '<!-- /ct-init:slices-contract -->',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'AGENTS.md'), orphan)
    const output = execFileSync('bash', ['-c', `bash '${script}' '${dir}' 2>&1`], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toBe(orphan) // ni una letra tocada
    const headingOccurrences = agents.split('## Formato de la tabla §9').length - 1
    expect(headingOccurrences).toBe(1) // no duplicado
    expect(output.toLowerCase()).toMatch(/aviso|warning/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('AGENTS.md con el marcador de CIERRE borrado (apertura + heading + cuerpo intactos) → avisa, no duplica', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const orphan = [
      '# AGENTS.md',
      '',
      '<!-- ct-init:slices-contract -->',
      '## Formato de la tabla §9 (contrato con /ct-groom)',
      'cuerpo custom, el usuario borró el marcador de cierre sin querer.',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'AGENTS.md'), orphan)
    const output = execFileSync('bash', ['-c', `bash '${script}' '${dir}' 2>&1`], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toBe(orphan) // ni una letra tocada
    const headingOccurrences = agents.split('## Formato de la tabla §9').length - 1
    expect(headingOccurrences).toBe(1) // no duplicado
    expect(output.toLowerCase()).toMatch(/aviso|warning/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('correrlo tres veces seguidas es idempotente: la sección §9 aparece una sola vez', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    const occurrences = agents.split('<!-- ct-init:slices-contract -->').length - 1
    expect(occurrences).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  // Finding 6 de la review final: ct-next.mjs escribe cada worktree de slice
  // en <repoRoot>/.worktrees/<n>, DENTRO del propio checkout del repo
  // destino. Si ese repo no ignora `.worktrees/`, un `git add -A` en el
  // checkout principal se traga un working tree anidado entero, y un `git
  // clean -fdx` destruye worktrees vivos.
  it('añade .worktrees/ a .gitignore (crea el fichero si no existe)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.worktrees/')
    rmSync(dir, { recursive: true, force: true })
  })

  it('.gitignore ya existe con otro contenido → añade .worktrees/ sin pisar lo que ya había', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(gi).toContain('node_modules/')
    expect(gi).toContain('.worktrees/')
    rmSync(dir, { recursive: true, force: true })
  })

  it('idempotente: correrlo dos veces no duplica la línea .worktrees/ en .gitignore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    execFileSync('bash', [script, dir], { encoding: 'utf8' }) // segunda corrida
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8')
    const occurrences = gi.split('\n').filter((l) => l === '.worktrees/').length
    expect(occurrences).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  // Bloqueante de la re-review: un `.gitignore` que YA tiene contenido pero
  // no termina en salto de línea (p.ej. escrito a mano con `printf`, sin
  // `\n` final) hacía que `echo '.worktrees/' >> .gitignore` concatenara la
  // línea nueva en la MISMA línea que la última regla del usuario —
  // "node_modules/.worktrees/" — corrompiendo esa regla (deja de ignorar
  // node_modules/) y sin que .worktrees/ quedara ignorado de verdad tampoco
  // (el propósito entero del finding 6, incumplido en silencio). Reproduce
  // exactamente el caso reportado y comprueba que, tras el fix, las DOS
  // reglas quedan intactas en líneas separadas.
  it('.gitignore existente SIN salto de línea final → normaliza antes de añadir, sin corromper la regla previa', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(dir, '.gitignore'), 'node_modules/') // sin \n final, a propósito
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8')
    const lines = gi.split('\n').filter((l) => l.length > 0)
    expect(lines).toContain('node_modules/')
    expect(lines).toContain('.worktrees/')
    expect(gi).not.toMatch(/node_modules\/\.worktrees\//) // nunca concatenadas en la misma línea
    rmSync(dir, { recursive: true, force: true })
  })
})
