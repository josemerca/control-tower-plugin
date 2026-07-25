import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')

// stdio explícito (finding 11 de la review final): sin esto, execFileSync
// además de capturar el stderr del hijo en `e.stderr` también lo reenvía al
// proceso padre — la salida de `npm test`. Varios tests de este fichero
// disparan rutas de error a propósito (spec inexistente, --repo faltante,
// flags colgantes de la sección de finding 3 más abajo); ese stderr es
// esperado, y stdio:['ignore','pipe','pipe'] lo mantiene disponible vía
// `e.stderr` sin ecoarlo al padre.
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']

const SPEC = `## 9. Slices
| # | Slice (issue) | Tipo | Entrega | Dep | Acepta (AC) | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
| 2 | refresh | backend | flow | #1 | AC-2.1 | – |
`

describe('ct-groom --dry-run', () => {
  it('imprime el plan sin tocar gh', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    const plan = JSON.parse(out)
    expect(plan.milestone).toBe('Epic')
    expect(plan.issues).toHaveLength(2)
    expect(plan.issues[1].labels).toContain('type:backend')
    expect(plan.issues[1].body).toContain('merge-after #1')
    rmSync(dir, { recursive: true, force: true })
  })

  it('--project 7 aparece como número 7 en el JSON del dry-run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--project', '7', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    const plan = JSON.parse(out)
    expect(plan.project).toBe(7)
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin --project, el plan lleva project: null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    const plan = JSON.parse(out)
    expect(plan.project).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('spec inexistente sale con código distinto de 0 y mensaje de uso', () => {
    let threw = false
    try {
      execFileSync('node', [script, '/no/existe/spec.md', '--repo', 'o/r', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).not.toBe(0)
      expect(e.stderr.toString()).toMatch(/no se pudo leer el spec/)
    }
    expect(threw).toBe(true)
  })

  it('spec con órdenes de slice duplicados sale con código distinto de 0 y mensaje nombrando el duplicado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const DUP_SPEC = `## 9. Slices
| # | Slice (issue) | Tipo | Entrega | Dep | Acepta (AC) | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
| 1 | login-bis | backend | modelo bis | – | AC-1.2 | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, DUP_SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      // exit 2, no exit 1 crudo de una excepción sin capturar: mismo código que
      // el resto de errores de validación de este wrapper (spec inexistente,
      // --milestone/--project/--repo inválidos).
      expect(e.status).toBe(2)
      expect(e.stderr.toString()).toMatch(/duplicad/)
      expect(e.stderr.toString()).toMatch(/1/)
      // convención del wrapper: console.error + process.exit, NUNCA un stack
      // trace de Node volcado por una excepción sin capturar.
      expect(e.stderr.toString()).not.toMatch(/at \S+ \(file:/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin --repo fuera de --dry-run sale con código distinto de 0 y mensaje de uso', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--milestone', 'Epic'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).not.toBe(0)
      expect(e.stderr.toString()).toMatch(/--repo requerido/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

// Finding 3 de la review final: el `arg()` de ct-groom.mjs (a diferencia de
// ct-next.mjs/dispatch-check.mjs) tomaba `process.argv[i+1]` literal sin
// comprobar que fuera un valor real. Verificado en vivo contra el sandbox:
// `--milestone` como último token hacía que `milestone` fuera el booleano
// `true`, y una corrida real CREABA un milestone titulado "true" enganchando
// todos los issues del epic; `--milestone --dry-run` se comía `--dry-run`
// como valor; `--project` sin valor se convertía en `1` (`Number(true)===1`).
describe('ct-groom — flags colgantes no cuelan valores falsos (review final, finding 3)', () => {
  it('--milestone como último token (sin valor) → exit 2, nunca crea/usa un milestone "true"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--dry-run', '--milestone'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '').toString()).toMatch(/--milestone/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--milestone seguido de otro flag (--dry-run) sin valor real → exit 2, no se come el flag siguiente', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '').toString()).toMatch(/--milestone/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--project como último token (sin valor) → exit 2, nunca se convierte en 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--dry-run', '--project'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '').toString()).toMatch(/--project/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--project seguido de otro flag (sin valor real) → exit 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--project', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '').toString()).toMatch(/--project/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--project no numérico → exit 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--project', 'nope', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '').toString()).toMatch(/--project/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  // Re-review: --repo tenía el mismo hueco (solo `if (!repo)`, que un
  // `true` colgante pasa sin avisar por ser truthy) — ahora validado igual
  // que ct-next.mjs/dispatch-check.mjs (`typeof !== 'string'`).
  it('--repo como último token (sin valor) → exit 2, nunca "true" colándose hacia gh', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--dry-run', '--milestone', 'Epic', '--repo'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '').toString()).toMatch(/--repo/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--repo seguido de otro flag (sin valor real) → exit 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '').toString()).toMatch(/--repo/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})
