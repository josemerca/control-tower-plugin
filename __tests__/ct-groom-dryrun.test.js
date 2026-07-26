import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REAL_FAILING_TABLE, REAL_DEP_TABLE, REAL_TABLE_WITH_HASH_FIXED } from './fixtures/slices-real-tables.js'
import { buildIssueBody } from '../scripts/groom.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')

// stdio explícito (finding 11 de la review final): sin esto, execFileSync
// además de capturar el stderr del hijo en `e.stderr` también lo reenvía al
// proceso padre — la salida de `npm test`. Varios tests de este fichero
// disparan rutas de error a propósito (spec inexistente, --repo faltante,
// flags colgantes de la sección de finding 3 más abajo); ese stderr es
// esperado, y stdio:['ignore','pipe','pipe'] lo mantiene disponible vía
// `e.stderr` sin ecoarlo al padre.
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']

// F5: --dry-run dejó de ser 100% offline — ahora también enumera issues
// existentes de `--repo` (lectura pura, para detectar divergencia) ANTES de
// imprimir el plan, precisamente para que el preview no informe MENOS que
// una corrida real (la misma trampa que F1 cerró para la validación de la
// tabla §9). Todos los tests de este fichero pasan `--repo o/r` bajo
// --dry-run — sin un `gh` de mentira en el PATH, esa enumeración invocaría
// el `gh` REAL de la máquina (instalado y autenticado en este sandbox)
// contra un repo que no existe. `fakeEnv()` antepone el stub de
// __tests__/fixtures/fake-gh-bin al PATH; sin overrides, ese stub responde
// "[]" (ningún issue existente) al listado de issues — exactamente
// "no hay nada con qué comparar todavía", que es la lectura correcta para
// un plan que se está creando por primera vez y preserva, sin cambios, todo
// lo que esta suite ya verificaba antes de F5.
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = (overrides = {}) => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...overrides })

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
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.milestone).toBe('Epic')
    expect(plan.issues).toHaveLength(2)
    expect(plan.issues[1].labels).toContain('type:backend')
    expect(plan.issues[1].body).toContain('merge-after #1')
    // F3: el título sale de "Slice" ("login"/"refresh"), no de "Entrega"
    // ("modelo"/"flow") — "Entrega" aparece en el cuerpo como descripción.
    expect(plan.issues[0].title).toBe('#1 login')
    expect(plan.issues[1].title).toBe('#2 refresh')
    expect(plan.issues[0].body).toContain('modelo')
    rmSync(dir, { recursive: true, force: true })
  })

  it('--project 7 aparece como número 7 en el JSON del dry-run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--project', '7', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.project).toBe(7)
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin --project, el plan lleva project: null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.project).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('spec inexistente sale con código distinto de 0 y mensaje de uso', () => {
    let threw = false
    try {
      execFileSync('node', [script, '/no/existe/spec.md', '--repo', 'o/r', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
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
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
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
      execFileSync('node', [script, spec, '--milestone', 'Epic'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
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
      execFileSync('node', [script, spec, '--repo', 'o/r', '--dry-run', '--milestone'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
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
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
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
      execFileSync('node', [script, spec, '--repo', 'o/r', '--dry-run', '--project'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
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
      execFileSync('node', [script, spec, '--repo', 'o/r', '--project', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
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
      execFileSync('node', [script, spec, '--repo', 'o/r', '--project', 'nope', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
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
      execFileSync('node', [script, spec, '--dry-run', '--milestone', 'Epic', '--repo'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
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
      execFileSync('node', [script, spec, '--repo', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
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
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
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
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
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

  // F3: el título ya no sale de "Entrega" (sale de "Slice") — "Entrega" pasó
  // a ser una columna OPCIONAL (Descripción del cuerpo), así que su ausencia
  // ya NO aborta; degrada como Tipo/Acepta/Protegido/Área/Toca (se avisa por
  // stderr, dry-run sigue funcionando). Este test antes verificaba el abort;
  // ahora verifica el nuevo contrato explícitamente para dejar constancia
  // del cambio.
  it('falta la columna "Entrega" → YA NO aborta (F3: pasó a opcional), avisa por stderr y el dry-run sigue funcionando', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const NO_ENTREGA = `## 9. Slices
| # | Slice | Tipo | Dep | Acepta | Protegido |
|---|---|---|---|---|---|
| 1 | x | backend | – | – | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, NO_ENTREGA)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues).toHaveLength(1)
    expect(plan.issues[0].title).toBe('#1 x') // título desde "Slice"
    expect(res.stderr).toMatch(/columna\s+"Entrega"/)
    expect(res.stderr).toMatch(/Descripci/i)
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
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('') // ni siquiera parcial: aborta antes de imprimir nada
      const err = e.stderr.toString()
      // Anclado al recuento (test sin dientes de la review: el mensaje trae
      // el literal "1" en su propio ejemplo, así que un /1/ suelto pasaría
      // con cualquier recuento). Ancla al principio del mensaje.
      expect(err).toMatch(/^1 fila/)
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
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      expect(e.stderr.toString()).toMatch(/ninguna fila/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  // Regresión mandatoria: la tabla REAL que disparó el incidente (importada
  // de __tests__/fixtures/slices-real-tables.js — no se parafrasea ni se
  // duplica: son las filas exactas del informe, numeración "**S1**"/"**S2**",
  // dep de S2 como "S1" sin "#", valores de Área/Toca con backticks y
  // prefijo completo de label). Antes de este fix, `/ct-groom --dry-run`
  // imprimía `{"issues": [], ...}` y salía con 0.
  it('regresión: la tabla real del incidente → exit != 0 en vez de "0 issues, exit 0"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, REAL_FAILING_TABLE)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('') // el bug original: esto imprimía {"issues":[],...} y salía 0
      const err = e.stderr.toString()
      expect(err).toMatch(/^2 fila/) // anclado al recuento: las dos filas, S1 y S2
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
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
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
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
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
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
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
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.issues[0].labels).toContain('area:medicacion')
    expect(plan.issues[0].labels).toContain('touches:pbxproj')
    expect(plan.issues[0].labels).not.toContain('area:areamedicacion')
    expect(plan.issues[0].labels).not.toContain('touches:touchespbxproj')
    rmSync(dir, { recursive: true, force: true })
  })
})

// F3 — `Tipo` decide qué addendum recibe el agente despachado
// (kickoff.js#ADDENDA, vía renderKickoff): `ADDENDA[slice.type] || ''`
// devuelve cadena vacía en silencio para cualquier valor que no sea una key
// exacta de ADDENDA. Un autor que escribe "ios"/"swift" para un slice de UI
// real obtiene una label `type:ios` de aspecto normal, pero el agente
// despachado NUNCA recibe el addendum de `ui` (el gate de screenshot
// obligatorio) — sin ningún aviso. /ct-groom debe avisar (no abortar:
// `type:ios` sigue siendo una label legítima aunque no tenga addendum),
// nombrando el valor, el slice, la consecuencia y el conjunto reconocido.
describe('ct-groom — "Tipo" con un valor que no es ninguna key de ADDENDA avisa, no aborta (F3)', () => {
  it('"Tipo" = "ios" (no es key de ADDENDA) → dry-run no aborta, la label type:ios se crea igual, y avisa por stderr con el valor, el slice, la consecuencia y el conjunto reconocido', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | pantalla | ios | pantalla de alta | – | – | – |
`)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels).toContain('type:ios') // se usa el valor igualmente
    expect(res.stderr).toMatch(/"ios"/) // el valor ofensor
    expect(res.stderr).toMatch(/Tipo/) // la columna
    expect(res.stderr).toMatch(/#1/) // el slice
    expect(res.stderr).toMatch(/addendum/i) // la consecuencia
    expect(res.stderr).toMatch(/ui/) // el conjunto reconocido incluye "ui"
    expect(res.stderr).toMatch(/backend/)
    expect(res.stderr).toMatch(/infra/)
    expect(res.stderr).toMatch(/bugfix/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('"Tipo" con un valor reconocido ("ui") no dispara ningún aviso de tipo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | pantalla | ui | pantalla de alta | – | – | – | – | – |
`)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  it('"Tipo" vacío (columna presente, celda en blanco) no dispara ningún aviso de tipo (sigue sin label type:)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | pantalla |  | pantalla de alta | – | – | – | – | – |
`)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels.some((l) => l.startsWith('type:'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  // Review de F3, finding 1: un marcador de "sin valor" en "Tipo" ("–", "-",
  // "—", etc. — el MISMO criterio que ya usan Dep/Acepta/Protegido/Área/Toca)
  // significa "ninguno", igual que la celda vacía de arriba — NO un valor
  // real desconocido. Antes del fix esto disparaba DOS síntomas a la vez:
  // (a) el aviso de "Tipo no reconocido" acusaba de error tipográfico a
  // quien escribió exactamente el marcador que el propio contrato enseña a
  // usar en todas las demás columnas, y (b) `buildLabels` (groom.js) trataba
  // "–" como truthy y emitía la label literal "type:–" — que `gh label
  // create --force` crearía de verdad en el repo del usuario, el mismo bug
  // de "area:areamedicacion" por otra puerta. Las dos formas de decir
  // "ninguno" (celda vacía, celda con marcador) deben comportarse igual.
  it.each(['-', '–', '—', '―', '−', '--'])('"Tipo" = marcador de "sin valor" ("%s") → sin aviso, y sin label "type:" (mismo trato que Tipo vacío)', (marker) => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | pantalla | ${marker} | pantalla de alta | – | – | – | – | – |
`)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels.some((l) => l.startsWith('type:'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})

// F2 — señalado por el coordinador tras verificar F1 contra el spec real:
// una celda "Dep" con contenido pero sin ninguna referencia "#N" reconocible
// (p.ej. "S1" en vez de "#1") produce deps: [] en silencio. A diferencia del
// caso de 0 slices (que al menos no crea nada), este SÍ crea el milestone y
// los issues, con exit 0, pero sin ninguna línea `merge-after` — /ct-next
// despacha slices dependientes sin esperar al merge del que dependían.
describe('ct-groom — Dep con contenido pero sin ninguna referencia #N reconocible aborta fuerte (F2)', () => {
  // Tabla tal cual la verificó el coordinador (importada de
  // __tests__/fixtures/slices-real-tables.js, columnas completadas donde el
  // mensaje original usaba "..."): "#" de las 3 filas es válido — el
  // problema es solo la columna Dep.
  it('regresión: la tabla del coordinador → exit != 0 en vez de "issues creados, exit 0, deps borrados"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, REAL_DEP_TABLE)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('') // el bug: esto imprimía el plan completo (deps: []) y salía 0
      const err = e.stderr.toString()
      // Anclado al recuento (test sin dientes de la review: /2/ suelto pasa
      // con cualquier recuento porque el propio mensaje de ejemplo contiene
      // dígitos). 2 filas malformadas (slice #2 y #3; #1 con "–" es legítimo).
      expect(err).toMatch(/^2 fila/)
      expect(err).toMatch(/"S1"/) // el valor ofensor, tal cual
      expect(err).toMatch(/#N/) // qué formato usar
      expect(err).toMatch(/#1/) // ejemplo de formato correcto
      expect(err).toMatch(/escribe\s+"–"/) // CRITICAL 1: la mitad que faltaba del mensaje
      expect(err).not.toMatch(/at \S+ \(file:/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('"–" (sin dependencias, forma legítima) no aborta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC) // SPEC del top del fichero: Dep "–" y "#1"
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    expect(JSON.parse(out).issues).toHaveLength(2)
    rmSync(dir, { recursive: true, force: true })
  })

  it('texto legítimo alrededor de una referencia #N válida ("#1 (tras el merge)") no aborta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const LEGIT = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | #1 (tras el merge) | – | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, LEGIT)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.issues[1].body).toContain('merge-after #1')
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// Review de F1/F2 — 2 Critical + 4 caminos silenciosos, verificados a nivel
// CLI end-to-end (dry-run). Los tests unitarios equivalentes viven en
// __tests__/slices.test.js contra analyzeSlicesTable directamente.
// ============================================================================

describe('ct-groom — em dash (—) en Dep no aborta; el mensaje de Dep malformado dice qué escribir (CRITICAL 1)', () => {
  it('em dash (—) en Dep no aborta — el plan se genera con deps: []', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | — | – | – |
`)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    expect(JSON.parse(out).issues).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it('regresión exacta de la secuencia del coordinador: "#" ya corregido (REAL_TABLE_WITH_HASH_FIXED) — no aborta por la fila 1 (Dep "—"), sí sigue abortando por la fila 2 (Dep "S1")', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, REAL_TABLE_WITH_HASH_FIXED)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      const err = e.stderr.toString()
      // El mensaje debe ser sobre "S1" (fila 2), NUNCA sobre "—" (fila 1,
      // que siempre significó "sin dependencias" correctamente).
      expect(err).toMatch(/^1 fila/)
      expect(err).toMatch(/"S1"/)
      expect(err).not.toMatch(/"—"/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('el mensaje de "Dep malformado" dice explícitamente qué escribir si no hay dependencias', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | ninguna | – | – |
`)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stderr.toString()).toMatch(/si no hay dependencias, escribe\s+"–"/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — negrita/cursiva alrededor del prefijo en Área/Toca no duplica la label (CRITICAL 2)', () => {
  it('"**area:medicacion**"/"**touches:pbxproj**" (negrita) → labels sin duplicar el prefijo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | – | – | **area:medicacion** | **touches:pbxproj** |
`)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.issues[0].labels).toContain('area:medicacion')
    expect(plan.issues[0].labels).toContain('touches:pbxproj')
    expect(plan.issues[0].labels).not.toContain('area:areamedicacion')
    expect(plan.issues[0].labels).not.toContain('touches:touchespbxproj')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — un hueco (línea en blanco) dentro de la tabla §9 aborta fuerte, no trunca en silencio (3)', () => {
  it('línea en blanco entre 2 filas de datos → exit != 0 en vez de "1 issue creado, exit 0" (medio epic silencioso)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | primero | – | – | – |

| 2 | b | ui | segundo | – | – | – |
`)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('') // el bug: esto imprimía 1 solo issue y salía 0
      const err = e.stderr.toString()
      expect(err).toMatch(/^1 fila/)
      expect(err).toMatch(/segundo/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

// F3: la celda con contenido obligatorio (la que, vacía, deja sin título
// fiable que construir) pasó de "Entrega" a "Slice".
describe('ct-groom — celda "Slice" vacía o fila más corta que la cabecera aborta fuerte (4, actualizado por F3)', () => {
  it('celda Slice vacía → exit != 0 en vez de un issue titulado "#1" a secas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 |  | ui | y | – | – | – |
`)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      const err = e.stderr.toString()
      expect(err).toMatch(/^1 fila/)
      expect(err).toMatch(/Slice/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('celda Entrega vacía (Slice con contenido) YA NO aborta (F3: Entrega es opcional)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui |  | – | – | – |
`)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.issues).toHaveLength(1)
    expect(plan.issues[0].title).toBe('#1 a')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — Dep apunta a un slice inexistente o a sí mismo aborta fuerte (5)', () => {
  it('auto-referencia (slice #3 depende de #3) → exit != 0, mensaje nombra la auto-referencia', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | #1 | – | – |
| 3 | c | ui | z | #3 | – | – |
`)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      const err = e.stderr.toString()
      expect(err).toMatch(/^1 referencia/)
      expect(err).toMatch(/#3.*sí mismo|sí mismo.*#3/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('referencia a un "#" inexistente (#99 en tabla de 2 slices) → exit != 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | #99 | – | – |
`)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      expect(e.stderr.toString()).toMatch(/#99/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — token Área/Toca que normaliza a vacío avisa pero no aborta (6)', () => {
  it('"area:" vacío tras el prefijo → dry-run no aborta, avisa por stderr que la label queda inerte para ese slice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | – | – | area: | – |
`)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels).not.toContain('area:')
    expect(plan.issues[0].labels.some((l) => l.startsWith('area:'))).toBe(false)
    expect(res.stderr).toMatch(/Área/)
    expect(res.stderr).toMatch(/inerte/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — "no se encontró la tabla §9" distingue "no hay tabla" de "hay tabla sin cabecera Slice/Dep"', () => {
  it('hay filas de tabla markdown pero ninguna cabecera con "Slice"/"Dep" → mensaje distinto de "no hay tabla en absoluto"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## 9. Algo\n| Foo | Bar |\n|---|---|\n| 1 | 2 |\n')
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      const err = e.stderr.toString()
      expect(err).toMatch(/cabecera/i)
      expect(err).toMatch(/Slice/)
      expect(err).not.toMatch(/ninguna tabla markdown/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin ninguna tabla markdown en absoluto → mensaje "no se encontró ninguna tabla markdown"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '# Spec sin ninguna tabla\n\nSolo prosa.\n')
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stderr.toString()).toMatch(/no se encontr.*tabla/i)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// Review round 2/5 — CRITICAL (marcado envolviendo la celda completa de una
// lista), IMPORTANTE (falsos positivos del heurístico de fin de tabla) y 3
// caminos silenciosos más, verificados a nivel CLI end-to-end.
// ============================================================================

describe('ct-groom — marcado envolviendo la CELDA COMPLETA de una lista por comas no duplica el prefijo (review round 2, CRITICAL)', () => {
  it('"**area:medicacion, area:otro**" / "`touches:pbxproj, touches:otro`" → labels correctas, sin duplicar, sin abortar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | login | backend | modelo | – | – | – | **area:medicacion, area:otro** | `touches:pbxproj, touches:otro` |\n')
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    const labels = plan.issues[0].labels
    expect(labels).toContain('area:medicacion')
    expect(labels).toContain('area:otro')
    expect(labels).toContain('touches:pbxproj')
    expect(labels).toContain('touches:otro')
    expect(labels).not.toContain('area:areamedicacion')
    expect(labels).not.toContain('touches:touchespbxproj')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — el escaneo post-hueco no arrastra una tabla ajena (review round 2, IMPORTANTE)', () => {
  it('regla horizontal ("---") antes de una tabla no relacionada, sin heading markdown → no aborta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | primero | – | – | – |

---

| Cosa | Valor |
|---|---|
| x | y |
`)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    expect(JSON.parse(out).issues).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — fila con más celdas que la cabecera aborta fuerte (review round 2, a)', () => {
  it('un "|" sin escapar en una celda (más celdas que la cabecera) → exit != 0 en vez de columnas desplazadas en silencio', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – | med | icacion | pbx |
`)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      expect(e.stderr.toString()).toMatch(/^1 fila/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

// F3: la exigencia de contenido real se movió de "Entrega" a "Slice" — un
// marcador de "sin valor" en "Entrega" ya no aborta (es "sin descripción",
// legítimo); en "Slice" sí, porque de ahí sale el título.
describe('ct-groom — "Slice" con un marcador de "sin valor" aborta fuerte (review round 2, b — actualizado por F3)', () => {
  it('"Slice" = "–" → exit != 0 en vez de un issue titulado "#1 –"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | – | ui | y | – | – | – |
`)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      expect(e.stderr.toString()).toMatch(/^1 fila/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('"Entrega" = "–" (Slice con contenido) YA NO aborta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | – | – | – | – |
`)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    expect(JSON.parse(out).issues).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — marcador de "nada" envuelto en marcado en Dep no aborta (review round 2, c)', () => {
  it('"`–`" (backtick) en Dep no aborta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |\n' +
      '|---|---|---|---|---|---|---|\n' +
      '| 1 | a | ui | x | `–` | – | – |\n')
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    expect(JSON.parse(out).issues).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it('"**–**" (negrita) en Dep no aborta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | **–** | – | – |
`)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    expect(JSON.parse(out).issues).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })
})

// Mejora de uso recomendada por el coordinador: con varios defectos a la vez
// antes solo se imprimía el primero (una noria de hasta ocho ejecuciones
// para verlos todos). Ahora se agregan todas las clases de error que
// disparan y se imprimen juntas antes de un único exit(2).
describe('ct-groom — varios defectos a la vez se reportan TODOS en una sola ejecución (mejora de uso)', () => {
  it('una fila con "#" malformado y otra con "Dep" malformado en la misma tabla → stderr trae AMBOS mensajes, un solo exit 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| **1** | a | ui | x | – | – | – |
| 2 | b | ui | y | S1 | – | – |
`)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect(e.stdout).toBe('')
      const err = e.stderr.toString()
      // Ambas clases de error deben aparecer en la MISMA ejecución — no hace
      // falta arreglar una, volver a correr, y descubrir la otra.
      expect(err).toMatch(/"#"/)
      expect(err).toMatch(/\*\*1\*\*/)
      expect(err).toMatch(/"Dep"/)
      expect(err).toMatch(/"S1"/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

// Review round 3/5 — el Critical del prefijo, tercera vez: cada token
// envuelto en SU PROPIO backtick ("`area:hoy`, `area:web`") seguía
// produciendo "area:areaweb" porque el fix de round 2 solo limpiaba los
// bordes de la celda COMPLETA o los bordes de cada pieza, por capas — y el
// split partía justo en el punto donde ninguna de las dos capas alcanzaba.
// Fix: normalizar de un tirón (backtick/asterisco fuera globalmente, guion
// bajo solo en bordes de token, split, prefijo, normalizar) en vez de
// capas. Verificado con las cuatro formas en la misma tabla, más un control
// negativo de que no se corrompe lo legítimo.
describe('ct-groom — normalización de marcado en un solo paso cierra la clase entera (review round 3)', () => {
  it('REPRODUCCIÓN EXACTA del coordinador: "`area:hoy`, `area:web`" → labels limpias, sin abortar, sin aviso', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | login | backend | modelo | – | – | – | `area:hoy`, `area:web` | – |\n')
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    const labels = plan.issues[0].labels
    expect(labels).toContain('area:hoy')
    expect(labels).toContain('area:web')
    expect(labels).not.toContain('area:areaweb')
    expect(res.stderr).toBe('') // sin ningún aviso: ambos tokens se reconocen limpios
    rmSync(dir, { recursive: true, force: true })
  })

  it('las cuatro formas de marcado en la misma tabla, más un control negativo, todas correctas en una sola ejecución', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | celda entera | backend | y | – | – | – | **area:medicacion, area:otro** | – |\n' +
      '| 2 | cada token | backend | y | – | – | – | `area:hoy`, `area:web` | – |\n' +
      '| 3 | mezcla | backend | y | – | – | – | **area:x**, `area:y` | – |\n' +
      '| 4 | anidada | backend | y | – | – | – | `**area:z**` | – |\n' +
      '| 5 | control negativo | backend | y | – | – | – | areas-comunes | mi_token |\n')
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    const labelsOf = (order) => plan.issues.find((i) => i.order === order).labels
    expect(labelsOf(1)).toEqual(expect.arrayContaining(['area:medicacion', 'area:otro']))
    expect(labelsOf(2)).toEqual(expect.arrayContaining(['area:hoy', 'area:web']))
    expect(labelsOf(3)).toEqual(expect.arrayContaining(['area:x', 'area:y']))
    expect(labelsOf(4)).toEqual(expect.arrayContaining(['area:z']))
    expect(labelsOf(5)).toEqual(expect.arrayContaining(['area:areas-comunes', 'touches:mi_token']))
    for (const order of [1, 2, 3, 4]) {
      expect(labelsOf(order).some((l) => /^area:area/.test(l))).toBe(false)
    }
    rmSync(dir, { recursive: true, force: true })
  })
})

// Review round 4/5 (última de F1) — verificado a nivel CLI: la regresión
// del guion bajo asimétrico (issue 1) y la matriz ampliada de envoltorios
// (issue 2), en una sola ejecución.
describe('ct-groom — guion bajo simétrico + prefijo invertido (review round 4)', () => {
  it('control negativo de nombres de fichero (_layout.tsx, __init__.py, trailing_) llega a las labels SIN mutilar — falla si se vuelve a ^_+/_+$ asimétrico', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | a | backend | y | – | – | – | – | _layout.tsx |
| 2 | b | backend | y | – | – | – | – | __init__.py |
| 3 | c | backend | y | – | – | – | – | trailing_ |
| 4 | d | backend | y | – | – | – | – | mi_token_largo |
| 5 | e | backend | y | – | – | – | areas-comunes | – |
`)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    const labelsOf = (order) => plan.issues.find((i) => i.order === order).labels
    expect(labelsOf(1)).toContain('touches:_layout.tsx')
    expect(labelsOf(2)).toContain('touches:__init__.py')
    expect(labelsOf(3)).toContain('touches:trailing_')
    expect(labelsOf(4)).toContain('touches:mi_token_largo')
    expect(labelsOf(5)).toContain('area:areas-comunes')
    rmSync(dir, { recursive: true, force: true })
  })

  it('matriz de envoltorios (backtick, asterisco, guion bajo, ~~, comillas rectas, paréntesis, anidado) — todas producen "area:med", ninguna duplica el prefijo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | backtick | backend | y | – | – | – | `area:med` | – |\n' +
      '| 2 | asterisco | backend | y | – | – | – | **area:med** | – |\n' +
      '| 3 | guion bajo | backend | y | – | – | – | _area:med_ | – |\n' +
      '| 4 | tachado | backend | y | – | – | – | ~~area:med~~ | – |\n' +
      '| 5 | comillas | backend | y | – | – | – | "area:med" | – |\n' +
      '| 6 | parentesis | backend | y | – | – | – | (area:med) | – |\n' +
      '| 7 | anidado | backend | y | – | – | – | `**area:med**` | – |\n')
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    for (const issue of plan.issues) {
      expect(issue.labels).toContain('area:med')
      expect(issue.labels.some((l) => /^area:area/.test(l))).toBe(false)
    }
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// F5 — el groom detecta divergencia, no solo existencia. Hasta ahora, un
// issue ya existente (encontrado por su marcador ct-order) solo disparaba
// "ya existe, no se duplica" — sin comparar NUNCA su título/labels/milestone
// contra lo que la tabla §9 produce hoy. Estos tests cubren el reporte bajo
// --dry-run (idéntico al de la corrida real, ver ct-groom-reconcile.test.js
// para esa mitad) — "un dry-run que informa menos que la corrida real es una
// trampa" aplica aquí exactamente igual que ya aplicaba a la validación de
// la tabla en F1.
// ============================================================================

const ONE_SLICE_SPEC = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema | api | db |
`
// Plan que ONE_SLICE_SPEC produce con --milestone Epic (verificado contra
// groom.js): title "#1 login", labels ['type:backend','area:api','touches:db','status:backlog'].

// matchingBody(specPath): el body EXACTO que ONE_SLICE_SPEC produce hoy —
// generado con el buildIssueBody real (no a mano) para que un "coincide en
// todo" de verdad coincida en TODO, incluidas las secciones que F5 ahora
// también compara (AC, Dependencias, Descripción, Protegido, y — review
// round 3 — el enlace al spec). Es una FUNCIÓN, no una constante: el enlace
// al spec incluye la ruta real del fichero de spec, que en estos tests es
// un directorio temporal distinto en cada `it` — hay que generarlo con la
// MISMA ruta (`spec`) que se le pasa al script en cada invocación, o la
// línea de enlace divergiría por construcción y ya no sería un "coincide en
// todo" de verdad.
function matchingBody(specPath) {
  return buildIssueBody(
    { n: 1, name: 'login', type: 'backend', entrega: 'modelo', deps: [], ac: ['AC-1.1'], protected: 'schema' },
    { specPath, specSection: '9' },
  )
}

describe('ct-groom --dry-run — detecta divergencia de un issue ya existente (F5)', () => {
  it('título/milestone/labels divergentes → se reportan por stderr, exit 3, JSON del plan idéntico al de siempre (nada se muta)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const EXISTING = {
      number: 501,
      title: '#1 iniciar sesión',
      state: 'open',
      milestone: { title: 'Sprint 1' },
      labels: [{ name: 'type:backend' }, { name: 'status:in-progress' }],
      body: '<!-- ct-order:1 -->',
    }
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
        { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[EXISTING]]) }) })
    } catch (e) {
      threw = true
      expect(e.status).toBe(3)
      const plan = JSON.parse(e.stdout) // el plan SÍ se imprime bajo drift (solo cambia el exit code)
      expect(plan.issues[0].title).toBe('#1 login')
      const err = e.stderr.toString()
      expect(err).toMatch(/slice #1.*issue #501/)
      expect(err).toMatch(/t.tulo difiere/i)
      expect(err).toMatch(/"#1 iniciar sesión"/)
      expect(err).toMatch(/"#1 login"/)
      expect(err).toMatch(/milestone difiere/)
      expect(err).toMatch(/"Sprint 1"/)
      expect(err).toMatch(/falta la label "area:api"/)
      expect(err).toMatch(/falta la label "touches:db"/)
      expect(err).not.toMatch(/status:in-progress/) // fuera del namespace que el spec compara
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin ninguna divergencia (issue existente ya coincide) → exit 0, stderr vacío', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const MATCHING = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'status:in-progress' }],
      body: matchingBody(spec),
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[MATCHING]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  it('issue cerrado sin ninguna otra divergencia → sin nota de cierre (closed por sí solo no es divergencia), exit 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const CLOSED_MATCHING = {
      number: 501,
      title: '#1 login',
      state: 'closed',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      body: matchingBody(spec),
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[CLOSED_MATCHING]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  it('issue cerrado CON divergencia → añade nota de "cerrado" avisando antes de --reconcile, exit 3', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const CLOSED_DRIFT = {
      number: 501,
      title: '#1 iniciar sesión',
      state: 'closed',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      body: '<!-- ct-order:1 -->',
    }
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
        { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[CLOSED_DRIFT]]) }) })
    } catch (e) {
      threw = true
      expect(e.status).toBe(3)
      const err = e.stderr.toString()
      expect(err).toMatch(/t.tulo difiere/i)
      expect(err).toMatch(/cerrad.*reconcile/is)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--reconcile bajo --dry-run: anuncia qué aplicaría, pero NUNCA llama a `gh issue edit` (sigue sin mutar nada), exit 3', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const argvLog = join(dir, 'argv.log')
    const EXISTING = {
      number: 501,
      title: '#1 iniciar sesión',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      body: '<!-- ct-order:1 -->',
    }
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run', '--reconcile'],
        { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[EXISTING]]), FAKE_GH_ARGV_LOG_FILE: argvLog }) })
    } catch (e) {
      threw = true
      expect(e.status).toBe(3) // dry-run nunca "resuelve" nada, incluso con --reconcile
      expect(e.stderr.toString()).toMatch(/--reconcile aplicaría.*issue edit 501/)
    }
    expect(threw).toBe(true)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/) // el anuncio no es una llamada real
    rmSync(dir, { recursive: true, force: true })
  })

  it('fallo al listar issues de GitHub bajo --dry-run (con --repo) aborta igual que la corrida real — el plan nunca se imprime', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
        { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv({ FAKE_GH_LIST_FAIL_AT: '0' }) })
    } catch (e) {
      threw = true
      expect(e.status).toBe(1)
      expect(e.stdout).toBe('') // el bug que esto evita: un dry-run que informa MENOS que la corrida real
      expect(e.stderr.toString()).toMatch(/no se pudo listar issues/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--dry-run SIN --repo: nunca invoca `gh` (comportamiento de siempre, sin nada contra qué comparar)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const argvLog = join(dir, 'argv.log')
    const out = execFileSync('node', [script, spec, '--milestone', 'Epic', '--dry-run'],
      { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv({ FAKE_GH_ARGV_LOG_FILE: argvLog }) })
    const plan = JSON.parse(out)
    expect(plan.repo).toBeNull()
    expect(existsSync(argvLog)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// Review del coordinador tras la primera versión de F5 — cobertura bajo
// --dry-run de los dos puntos de fondo (el body SÍ se compara para AC/deps;
// las labels están gateadas por columna) y confirmación explícita de que el
// exit 3 bajo --dry-run es una decisión, no una consecuencia accidental.
// ============================================================================

describe('ct-groom --dry-run — AC/Dependencias divergentes se detectan (review crítica: el body SÍ se compara para lo que lee el dispatcher)', () => {
  const SPEC_2 = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | #2 | AC-1.1, AC-1.2 | schema |
| 2 | signup | backend | registro | – | AC-2.1 | – |
`
  const ISSUE_1_DRIFT = {
    number: 501,
    title: '#1 login',
    state: 'open',
    milestone: { title: 'Epic' },
    labels: [{ name: 'type:backend' }],
    body: buildIssueBody({ n: 1, name: 'login', type: 'backend', entrega: 'modelo', deps: [], ac: ['AC-1.1'], protected: 'schema' }, { specPath: 'x', specSection: '9' }),
  }
  const ISSUE_2_MATCHING = {
    number: 502,
    title: '#2 signup',
    state: 'open',
    milestone: { title: 'Epic' },
    labels: [{ name: 'type:backend' }],
    body: buildIssueBody({ n: 2, name: 'signup', type: 'backend', entrega: 'registro', deps: [], ac: ['AC-2.1'], protected: '–' }, { specPath: 'x', specSection: '9' }),
  }

  it('reporta el AC y la dependencia faltantes por stderr, exit 3, sin mutar nada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC_2)
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], {
        encoding: 'utf8', stdio: QUIET_STDIO,
        env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[ISSUE_1_DRIFT, ISSUE_2_MATCHING]]) }),
      })
    } catch (e) {
      threw = true
      expect(e.status).toBe(3)
      const err = e.stderr.toString()
      expect(err).toMatch(/falta el criterio de aceptación "AC-1.2"/)
      expect(err).toMatch(/falta la dependencia "merge-after #2"/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--reconcile bajo --dry-run: el preview nombra las categorías (dependencias, criterios de aceptación) SIN volcar el `--body` completo, y no muta nada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC_2)
    const argvLog = join(dir, 'argv.log')
    let threw = false
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run', '--reconcile'], {
        encoding: 'utf8', stdio: QUIET_STDIO,
        env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[ISSUE_1_DRIFT, ISSUE_2_MATCHING]]), FAKE_GH_ARGV_LOG_FILE: argvLog }),
      })
    } catch (e) {
      threw = true
      expect(e.status).toBe(3)
      const err = e.stderr.toString()
      expect(err).toMatch(/--reconcile aplicaría.*issue edit 501.*--body <actualizado/)
      // el texto real del AC/dependencia no se vuelca en el mensaje de preview:
      expect(err).not.toContain('merge-after #2\n')
    }
    expect(threw).toBe(true)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/) // --dry-run jamás muta, ni con --reconcile
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom --dry-run — labels: gateadas por columna (review, punto 2)', () => {
  const NO_AREA_SPEC = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
`
  it('sin columna "Área" en la tabla: un area: puesto a mano en el issue no se reporta como "sobra", exit 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, NO_AREA_SPEC)
    const ISSUE_WITH_AREA = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:ops' }],
      body: matchingBody(spec),
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[ISSUE_WITH_AREA]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/area:ops/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom --dry-run — el exit 3 ante divergencia es una decisión explícita, no una consecuencia (review, punto 3)', () => {
  // --dry-run y la corrida real SIN --reconcile comparten el mismo 3 ante
  // la MISMA divergencia, por PARIDAD (misma condición, misma señal, sin
  // sorpresas al pasar de "revisar" a "ejecutar de verdad"). Revisión de
  // round 3 del coordinador: la justificación original de este fichero
  // ("así `groom --dry-run && groom` recibe la misma señal") estaba
  // invertida — con `&&`, un exit 3 CORTA la cadena justo cuando hay
  // divergencia que --reconcile podría aplicar, así que ese encadenamiento
  // nunca llegaría a ejecutar la corrida real. La paridad se sostiene por
  // sí sola (ver el comentario junto al `process.exit` en ct-groom.mjs);
  // este test fija esa igualdad como comportamiento observable.
  it('--dry-run y la corrida real (sin --reconcile) devuelven el MISMO exit code (3) ante la MISMA divergencia', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctg-'))
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const EXISTING = {
      number: 501,
      title: '#1 otro título',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      body: matchingBody(spec),
    }
    const envOverrides = { FAKE_GH_LIST_SEQUENCE: JSON.stringify([[EXISTING]]), FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]) }
    const dryRunRes = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv(envOverrides) })
    const realRes = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic'], { encoding: 'utf8', env: fakeEnv(envOverrides) })
    expect(dryRunRes.status).toBe(3)
    expect(realRes.status).toBe(3)
    rmSync(dir, { recursive: true, force: true })
  })
})
