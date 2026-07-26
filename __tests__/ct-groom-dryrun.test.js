import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
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

// F1 — /ct-groom falla fuerte ante una tabla §9 inusable, ANTES de tocar
// GitHub y también bajo --dry-run (un dry-run que valida menos que la
// corrida real es una trampa). Las tres pruebas de silent-failure del
// informe del incidente: parseSlices devolviendo [] en silencio (defecto 1),
// duplicación de prefijo en Área/Toca (defecto 2) y columnas ausentes sin
// reportar (defecto 3).
describe('ct-groom — falla fuerte ante tabla §9 inusable (F1)', () => {
  it('sin tabla §9 en el spec → exit != 0, mensaje nombra la ausencia, ANTES de imprimir el plan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '# Spec sin sección de slices\n\nSolo prosa, ninguna tabla.\n')
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).not.toBe(0)
      expect(e.stdout).toBe('') // nunca llega a imprimir el JSON del plan
      expect(e.stderr.toString()).toMatch(/no se encontr.*tabla/i)
      expect(e.stderr.toString()).toMatch(/§9/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('falta la columna "#" → exit != 0, mensaje nombra la columna y la consecuencia (orden/dependencias)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const NO_HASH = `## 9. Slices
| Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|
| x | backend | y | – | – | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, NO_HASH)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      expect(e.stderr.toString()).toMatch(/columna\s+"#"/)
      expect(e.stderr.toString()).toMatch(/orden/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('falta la columna "Entrega" → exit != 0, mensaje nombra la columna y la consecuencia (título del issue)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const NO_ENTREGA = `## 9. Slices
| # | Slice | Tipo | Dep | Acepta | Protegido |
|---|---|---|---|---|---|
| 1 | x | backend | – | – | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, NO_ENTREGA)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      expect(e.stderr.toString()).toMatch(/columna\s+"Entrega"/)
      expect(e.stderr.toString()).toMatch(/t.tulo/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('filas con "#" no entero a secas → exit != 0, mensaje dice cuántas, muestra un valor ofensor y dice qué escribir en su lugar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const BAD_HASH = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| **S1** | x | backend | y | – | – | – |
| 2 | ok | backend | z | – | – | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, BAD_HASH)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('') // ni siquiera parcial: aborta antes de imprimir nada
      const err = e.stderr.toString()
      expect(err).toMatch(/1/) // cuántas filas
      expect(err).toMatch(/\*\*S1\*\*/) // el valor ofensor, tal cual
      expect(err).toMatch(/entero/i)
      expect(err).toMatch(/"1"/) // qué escribir en su lugar
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('tabla presente pero sin ninguna fila de datos → exit != 0, mensaje dice que no hay filas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const EMPTY_TABLE = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, EMPTY_TABLE)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      expect(e.stderr.toString()).toMatch(/ninguna fila/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  // Regresión mandatoria: la tabla REAL que disparó el incidente. No se
  // parafrasea — son las filas exactas del informe (numeración "**S1**"/
  // "**S2**", dep de S2 como "S1" sin "#", valores de Área/Toca con
  // backticks y prefijo completo de label). Antes de este fix,
  // `/ct-groom --dry-run` imprimía `{"issues": [], ...}` y salía con 0.
  const REAL_FAILING_TABLE = [
    '## 9. Slices',
    '| # | Slice | Qué entrega (visible) | Área | Toca | Depende de |',
    '|---|---|---|---|---|---|',
    '| **S1** | Segmented control + "Plan actual" | La pestaña se parte en dos… | `area:medicacion` | `touches:pbxproj` | — |',
    '| **S2** | Objetivo semanal y cumplimiento | La barra: % de la semana… | `area:medicacion` | `touches:migration` | S1 |',
    '',
  ].join('\n')

  it('regresión: la tabla real del incidente → exit != 0 en vez de "0 issues, exit 0"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, REAL_FAILING_TABLE)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('') // el bug original: esto imprimía {"issues":[],...} y salía 0
      const err = e.stderr.toString()
      expect(err).toMatch(/2/) // las dos filas, S1 y S2
      expect(err).toMatch(/\*\*S1\*\*/)
      expect(err).not.toMatch(/at \S+ \(file:/) // convención: nunca un stack trace crudo
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — avisa pero continúa ante columnas ausentes o prefijo en la columna equivocada (F1)', () => {
  it('sin columnas Tipo/Acepta/Protegido/Área/Toca → dry-run sigue funcionando, stderr avisa de cada ausencia y su consecuencia', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const MINIMAL = `## 9. Slices
| # | Slice | Entrega | Dep |
|---|---|---|---|
| 1 | login | modelo | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, MINIMAL)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    const plan = JSON.parse(out)
    expect(plan.issues).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it('el aviso de columnas ausentes se ve en stderr al capturarlo explícitamente (spawnSync)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const MINIMAL = `## 9. Slices
| # | Slice | Entrega | Dep |
|---|---|---|---|
| 1 | login | modelo | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, MINIMAL)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8' })
    expect(res.status).toBe(0) // avisa, no aborta
    expect(res.stderr).toMatch(/Tipo/)
    expect(res.stderr).toMatch(/type:/)
    expect(res.stderr).toMatch(/Acepta/)
    expect(res.stderr).toMatch(/Protegido/)
    expect(res.stderr).toMatch(/Área|Area/)
    expect(res.stderr).toMatch(/Toca/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('valor con prefijo de la otra columna ("area:x" en Toca) → dry-run no aborta, label se genera bien (touches:pbxproj, no touches:areapbxproj), y avisa', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const MISMATCHED = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | – | – | – | area:pbxproj |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, MISMATCHED)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels).toContain('touches:pbxproj')
    expect(plan.issues[0].labels).not.toContain('touches:areapbxproj')
    expect(res.stderr).toMatch(/area:pbxproj/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('valor prefijado correctamente ("area:medicacion" en Área, con backticks) → label sin duplicar el prefijo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const PREFIXED = [
      '## 9. Slices',
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | login | backend | modelo | – | – | – | `area:medicacion` | `touches:pbxproj` |',
      '',
    ].join('\n')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, PREFIXED)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    const plan = JSON.parse(out)
    expect(plan.issues[0].labels).toContain('area:medicacion')
    expect(plan.issues[0].labels).toContain('touches:pbxproj')
    expect(plan.issues[0].labels).not.toContain('area:areamedicacion')
    expect(plan.issues[0].labels).not.toContain('touches:touchespbxproj')
    rmSync(dir, { recursive: true, force: true })
  })
})
