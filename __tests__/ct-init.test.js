import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'ct-init.sh')

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
