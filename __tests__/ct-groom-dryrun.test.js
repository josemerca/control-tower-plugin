import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir, specUrl } from './fixtures/spec-repo.js'
import { REAL_FAILING_TABLE, REAL_DEP_TABLE, REAL_TABLE_WITH_HASH_FIXED } from './fixtures/slices-real-tables.js'
import { buildIssueBody, EPIC_CONTEXT_HEADING, FROZEN_DECISIONS_HEADING } from '../scripts/groom.js'

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

const SPEC = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice (issue) | Tipo | Entrega | Dep | Acepta (AC) | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
| 2 | refresh | backend | flow | #1 | AC-2.1 | – |
`

describe('ct-groom --dry-run', () => {
  it('imprime el plan sin tocar gh', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.milestone).toBe('Epic')
    expect(plan.issues).toHaveLength(2)
    expect(plan.issues[1].labels).toContain('type:backend')
    expect(plan.issues[1].body).toContain('merge-after `#1`') // F6: código inline, GitHub no lo autoenlaza al issue #1
    // F3: el título sale de "Slice" ("login"/"refresh"), no de "Entrega"
    // ("modelo"/"flow") — "Entrega" aparece en el cuerpo como descripción.
    expect(plan.issues[0].title).toBe('#1 login')
    expect(plan.issues[1].title).toBe('#2 refresh')
    expect(plan.issues[0].body).toContain('modelo')
    rmSync(dir, { recursive: true, force: true })
  })

  it('--project 7 aparece como número 7 en el JSON del dry-run', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--project', '7', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.project).toBe(7)
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin --project, el plan lleva project: null', () => {
    const dir = makeSpecDir('ctg-')
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
    const dir = makeSpecDir('ctg-')
    const DUP_SPEC = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
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
    const dir = makeSpecDir('ctg-')
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
    const dir = makeSpecDir('ctg-')
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
    const dir = makeSpecDir('ctg-')
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
    const dir = makeSpecDir('ctg-')
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
    const dir = makeSpecDir('ctg-')
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

  // D4 (revisión de argumentos numéricos): `Number('2.9')` es 2.9 — finito y
  // > 0, así que la validación anterior lo dejaba pasar y el valor viajaba
  // tal cual hasta `gh project view 2.9`, que falla tarde y de forma confusa.
  // Un número de project es un entero o no es nada.
  for (const bad of ['2.9', '1e3', ' 3', '0x10']) {
    it(`--project ${JSON.stringify(bad)} → exit 2 (no es un entero en dígitos a secas)`, () => {
      const dir = makeSpecDir('ctg-')
      const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
      let threw = false
      try {
        execFileSync('node', [script, spec, '--repo', 'o/r', '--project', bad, '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
      } catch (e) {
        threw = true
        expect(e.status).toBe(2)
        expect((e.stdout || '') + (e.stderr || '')).toMatch(/--project inválido/)
      }
      expect(threw).toBe(true)
      rmSync(dir, { recursive: true, force: true })
    })
  }

  // F10 — `--section` queda OBSOLETO. Hasta aquí, F6 le había puesto una
  // validación de call-site (un `--section` colgante devolvía el booleano
  // `true` y el enlace al spec de TODOS los issues salía como
  // "[spec.md#true](spec.md#true)"). Esa validación era correcta para lo que
  // el flag hacía entonces, pero el flag entero era una promesa vacía: la
  // tabla §9 se localiza por su cabecera de columnas ("Slice" + "Dep"), no por
  // ningún número de sección, así que --section jamás decidió QUÉ se
  // groomeaba; solo componía el ancla del enlace... y "#9" no es un ancla que
  // exista en GitHub (el encabezado "## 9. Slices" tiene el id "9-slices").
  // Su único efecto observable era producir un enlace roto.
  //
  // Contrato nuevo: se acepta en cualquier forma (nadie ve su script romperse
  // de golpe), se ignora, y se avisa de que se ignora — que es lo que impide
  // que alguien siga creyendo que decide algo.
  it('--section con un valor real: se IGNORA (el ancla sale del encabezado real), avisa, y no rompe', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--section', '12', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/--section está obsoleto y se IGNORA/)
    const plan = JSON.parse(res.stdout)
    // Ni rastro del "12" que se pidió: el ancla es la del encabezado real.
    expect(plan.issues[0].body).not.toContain('#12')
    expect(plan.issues[0].body).toContain(specUrl('spec.md'))
    rmSync(dir, { recursive: true, force: true })
  })

  for (const [caso, argv] of [
    ['como último token (sin valor)', ['--dry-run', '--section']],
    ['seguido de otro flag (sin valor real)', ['--section', '--dry-run']],
  ]) {
    it(`--section ${caso}: ya no es un error — se ignora y se avisa, exit 0`, () => {
      const dir = makeSpecDir('ctg-')
      const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
      const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', ...argv],
        { encoding: 'utf8', env: fakeEnv() })
      expect(res.status).toBe(0)
      expect(res.stderr).toMatch(/--section está obsoleto/)
      // El agujero que F6 cerró NO puede reaparecer por la puerta de atrás:
      // el booleano `true` de un flag colgante no llega a ningún ancla.
      expect(res.stdout).not.toContain('#true')
      rmSync(dir, { recursive: true, force: true })
    })
  }

  it('sin --section no se dice nada de --section (el aviso no es ruido de fondo)', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/--section/)
    rmSync(dir, { recursive: true, force: true })
  })

  // Re-review: --repo tenía el mismo hueco (solo `if (!repo)`, que un
  // `true` colgante pasa sin avisar por ser truthy) — ahora validado igual
  // que ct-next.mjs/dispatch-check.mjs (`typeof !== 'string'`).
  it('--repo como último token (sin valor) → exit 2, nunca "true" colándose hacia gh', () => {
    const dir = makeSpecDir('ctg-')
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
    const dir = makeSpecDir('ctg-')
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
    const dir = makeSpecDir('ctg-')
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
    const dir = makeSpecDir('ctg-')
    const NO_HASH = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const NO_ENTREGA = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const BAD_HASH = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const EMPTY_TABLE = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
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
    const dir = makeSpecDir('ctg-')
    const MINIMAL = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const MINIMAL = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const MISMATCHED = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const PREFIXED = [
      '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices',
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | pantalla | ui | pantalla de alta | – | – | – | – | – |
`)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    // F6: un epic nuevo ya nunca produce stderr vacío — el groom dice qué
    // labels se inventaría y que lo creado no será despachable hasta que
    // alguien lo promueva a status:ready. Lo que este test comprueba es la
    // ausencia del AVISO de tipo, no el silencio global. F26: el spec de
    // este test tampoco trae "## Contexto del epic", así que desde T3 el
    // stderr trae ADEMÁS ese aviso — ortogonal a lo que aquí se comprueba.
    // Se ancla a la columna Tipo (la única fuente del aviso que este test
    // vigila), no a "aviso:" a secas.
    expect(res.stderr).not.toMatch(/columna Tipo/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('"Tipo" vacío (columna presente, celda en blanco) no dispara ningún aviso de tipo (sigue sin label type:)', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | pantalla |  | pantalla de alta | – | – | – | – | – |
`)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    // F6: un epic nuevo ya nunca produce stderr vacío — el groom dice qué
    // labels se inventaría y que lo creado no será despachable hasta que
    // alguien lo promueva a status:ready. Lo que este test comprueba es la
    // ausencia del AVISO de tipo, no el silencio global. F26: el spec de
    // este test tampoco trae "## Contexto del epic", así que desde T3 el
    // stderr trae ADEMÁS ese aviso — ortogonal a lo que aquí se comprueba.
    // Se ancla a la columna Tipo (la única fuente del aviso que este test
    // vigila), no a "aviso:" a secas.
    expect(res.stderr).not.toMatch(/columna Tipo/)
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | pantalla | ${marker} | pantalla de alta | – | – | – | – | – |
`)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    // F6: un epic nuevo ya nunca produce stderr vacío — el groom dice qué
    // labels se inventaría y que lo creado no será despachable hasta que
    // alguien lo promueva a status:ready. Lo que este test comprueba es la
    // ausencia del AVISO de tipo, no el silencio global. F26: el spec de
    // este test tampoco trae "## Contexto del epic", así que desde T3 el
    // stderr trae ADEMÁS ese aviso — ortogonal a lo que aquí se comprueba.
    // Se ancla a la columna Tipo (la única fuente del aviso que este test
    // vigila), no a "aviso:" a secas.
    expect(res.stderr).not.toMatch(/columna Tipo/)
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
    const dir = makeSpecDir('ctg-')
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC) // SPEC del top del fichero: Dep "–" y "#1"
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    expect(JSON.parse(out).issues).toHaveLength(2)
    rmSync(dir, { recursive: true, force: true })
  })

  it('texto legítimo alrededor de una referencia #N válida ("#1 (tras el merge)") no aborta', () => {
    const dir = makeSpecDir('ctg-')
    const LEGIT = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | – | – | – |
| 2 | b | ui | y | #1 (tras el merge) | – | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, LEGIT)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    const plan = JSON.parse(out)
    expect(plan.issues[1].body).toContain('merge-after `#1`')
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | a | ui | x | — | – | – |
`)
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    expect(JSON.parse(out).issues).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it('regresión exacta de la secuencia del coordinador: "#" ya corregido (REAL_TABLE_WITH_HASH_FIXED) — no aborta por la fila 1 (Dep "—"), sí sigue abortando por la fila 2 (Dep "S1")', () => {
    const dir = makeSpecDir('ctg-')
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
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
    const dir = makeSpecDir('ctg-')
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices\n' +
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices\n' +
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |\n' +
      '|---|---|---|---|---|---|---|\n' +
      '| 1 | a | ui | x | `–` | – | – |\n')
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    expect(JSON.parse(out).issues).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it('"**–**" (negrita) en Dep no aborta', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices\n' +
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
    // sin ningún aviso de normalización: ambos tokens se reconocen limpios
    // (F6: el stderr ya no está vacío — trae labels nuevas y el recordatorio
    // de status:backlog. F26: tampoco está vacío por "## Contexto del epic"
    // ausente — ortogonal a lo que este test vigila, así que se ancla a las
    // columnas Área/Toca en vez de "aviso:" a secas).
    expect(res.stderr).not.toMatch(/en columna (Área|Toca)/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('las cuatro formas de marcado en la misma tabla, más un control negativo, todas correctas en una sola ejecución', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices\n' +
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices\n' +
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

const ONE_SLICE_SPEC = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema | api | db |
`
// Plan que ONE_SLICE_SPEC produce con --milestone Epic (verificado contra
// groom.js): title "#1 login", labels ['type:backend','area:api','touches:db','status:backlog'].
// PLAN_LABELS_EXIST (F6): las cuatro labels del plan, ya presentes en el
// repo. Los fixtures de "todo coincide" de más abajo necesitan un mundo
// COHERENTE para poder seguir exigiendo stderr vacío: un issue que ya existe
// con esas labels implica que esas labels existen en el repo — sin esto, el
// stub respondería "el repo no tiene ninguna label" y el groom diría, con
// razón, que se crearían cuatro.
// F21: `gate:none` se une al plan (una label de gate por issue, siempre —
// ver gates.js#GATE_LABEL_NONE). Sin ella aquí, el mundo dejaría de ser
// coherente y el groom diría, con razón, que se crearía una label nueva.
const PLAN_LABELS_EXIST = JSON.stringify([[{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:plan' }, { name: 'status:backlog' }]])

// SPEC_REF_OK: la referencia al spec que ct-groom.mjs resuelve para un spec
// llamado "spec.md" dentro de un directorio de makeSpecDir (repo git con
// origin https://github.com/o/r.git) cuando el stub de `gh` confirma que el
// fichero está publicado en `main` y que el ancla existe. F10: ya NO depende
// de la ruta del directorio temporal — la ruta que va al body es la relativa
// a la raíz del repo, así que es la misma en todos los `it`.
const SPEC_REF_OK = { path: 'spec.md', heading: '9. Slices', url: specUrl('spec.md'), reason: null }

// matchingBody(): el body EXACTO que ONE_SLICE_SPEC produce hoy — generado
// con el buildIssueBody real (no a mano) para que un "coincide en todo" de
// verdad coincida en TODO, incluidas las secciones que F5 ahora también
// compara (AC, Dependencias, Descripción, Protegido, y — review round 3 — el
// enlace al spec).
function matchingBody() {
  return buildIssueBody(
    { n: 1, name: 'login', type: 'backend', entrega: 'modelo', deps: [], ac: ['AC-1.1'], protected: 'schema' },
    SPEC_REF_OK,
  )
}

describe('ct-groom --dry-run — detecta divergencia de un issue ya existente (F5)', () => {
  it('título/labels divergentes → se reportan por stderr, exit 3, JSON del plan idéntico al de siempre (nada se muta)', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const EXISTING = {
      number: 501,
      title: '#1 iniciar sesión',
      state: 'open',
      milestone: { title: 'Epic' },
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
      expect(err).toMatch(/falta la label "area:api"/)
      expect(err).toMatch(/falta la label "touches:db"/)
      expect(err).not.toMatch(/status:in-progress/) // fuera del namespace que el spec compara
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin ninguna divergencia (issue existente ya coincide) → exit 0, stderr vacío', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const MATCHING = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:plan' }, { name: 'status:in-progress' }],
      body: matchingBody(),
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[MATCHING]]), FAKE_GH_LABELS_LIST: PLAN_LABELS_EXIST }) })
    expect(res.status).toBe(0)
    // F26 + Slice 10 + decisiones: ONE_SLICE_SPEC no trae "## Contexto del
    // epic", ni "## Decisiones congeladas", ni columna "Señal", así que el
    // stderr trae los TRES avisos de ausencia — todos ortogonales a la
    // divergencia que este test vigila. Se comprueba que SOLO están esos tres
    // (nada de "difiere"/"falta la label"/etc.), en vez de exigir vacío a secas.
    const stderrLines = res.stderr.split('\n').filter(Boolean)
    expect(stderrLines).toHaveLength(3)
    expect(stderrLines.some((l) => l.includes(EPIC_CONTEXT_HEADING))).toBe(true)
    expect(stderrLines.some((l) => l.includes(FROZEN_DECISIONS_HEADING))).toBe(true)
    expect(stderrLines.some((l) => l.includes('no tiene columna "Señal"'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('issue cerrado sin ninguna otra divergencia → sin nota de cierre (closed por sí solo no es divergencia), exit 0', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const CLOSED_MATCHING = {
      number: 501,
      title: '#1 login',
      state: 'closed',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:plan' }],
      body: matchingBody(),
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[CLOSED_MATCHING]]), FAKE_GH_LABELS_LIST: PLAN_LABELS_EXIST }) })
    expect(res.status).toBe(0)
    // F6: este fixture (issue CERRADO, sin ninguna label status:) es también
    // la prueba de que el recordatorio de status:backlog no persigue a un
    // epic ya terminado: un issue cerrado no está pendiente de promoción.
    // F26 + Slice 10 + decisiones: mismo caso que el test anterior —
    // ONE_SLICE_SPEC no trae ni "## Contexto del epic", ni "## Decisiones
    // congeladas", ni columna "Señal", así que el stderr trae esos tres avisos
    // y nada más.
    const stderrLines = res.stderr.split('\n').filter(Boolean)
    expect(stderrLines).toHaveLength(3)
    expect(stderrLines.some((l) => l.includes(EPIC_CONTEXT_HEADING))).toBe(true)
    expect(stderrLines.some((l) => l.includes(FROZEN_DECISIONS_HEADING))).toBe(true)
    expect(stderrLines.some((l) => l.includes('no tiene columna "Señal"'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('issue cerrado CON divergencia → añade nota de "cerrado" avisando antes de --reconcile, exit 3', () => {
    const dir = makeSpecDir('ctg-')
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
    const dir = makeSpecDir('ctg-')
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

  // Decisión de producto (review round 5): el aviso de "--reconcile es
  // EXPERIMENTAL" se imprime en cuanto el flag está presente, CON o SIN
  // --dry-run — el aviso es sobre el riesgo del flag, no sobre si esta
  // corrida en concreto llega a mutar algo de verdad.
  it('--dry-run --reconcile → el aviso de EXPERIMENTAL también aparece (mismo riesgo, aunque dry-run nunca mute)', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run', '--reconcile'],
      { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0) // sin issues existentes, nada diverge — el aviso vive en stderr, no afecta el exit
    expect(res.stderr).toMatch(/--reconcile es EXPERIMENTAL/)
    rmSync(dir, { recursive: true, force: true })
  })
  it('--dry-run SIN --reconcile → el aviso NUNCA aparece', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    let stderrOut = ''
    try {
      execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'],
        { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    } catch (e) {
      stderrOut = e.stderr ? e.stderr.toString() : ''
    }
    expect(stderrOut).not.toMatch(/EXPERIMENTAL/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('fallo al listar issues de GitHub bajo --dry-run (con --repo) aborta igual que la corrida real — el plan nunca se imprime', () => {
    const dir = makeSpecDir('ctg-')
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

  // F10 cambia esta propiedad, y el cambio se declara en vez de borrarse: el
  // test decía "--dry-run SIN --repo nunca invoca `gh`". Ya no es cierto, y no
  // podía seguir siéndolo — el enlace al spec se VERIFICA contra GitHub
  // (¿está el fichero publicado en la rama por defecto? ¿existe el ancla?), y
  // esa verificación no depende de `--repo` sino del repositorio donde vive el
  // SPEC. Saltársela bajo --dry-run devolvería la trampa que F1 y F5 ya
  // cerraron dos veces: un preview que informa de menos que la corrida real —
  // aquí, un preview que enseña un enlace que la corrida real degradaría.
  //
  // Lo que SÍ sigue siendo cierto, y es lo que de verdad protegía este test,
  // es que --dry-run no muta nada: las únicas llamadas a `gh` sin --repo son
  // las dos LECTURAS del enlace al spec.
  it('--dry-run SIN --repo: las únicas llamadas a `gh` son las lecturas del enlace al spec — ninguna mutación', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const argvLog = join(dir, 'argv.log')
    const out = execFileSync('node', [script, spec, '--milestone', 'Epic', '--dry-run'],
      { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv({ FAKE_GH_ARGV_LOG_FILE: argvLog }) })
    const plan = JSON.parse(out)
    expect(plan.repo).toBeNull()
    const calls = readFileSync(argvLog, 'utf8').trim().split('\n')
    expect(calls).toEqual([
      'repo view o/r --json defaultBranchRef -q .defaultBranchRef.name',
      'api repos/o/r/contents/spec.md?ref=main -H Accept: application/vnd.github.html',
    ])
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
  const SPEC_2 = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
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
    body: buildIssueBody({ n: 1, name: 'login', type: 'backend', entrega: 'modelo', deps: [], ac: ['AC-1.1'], protected: 'schema' }, SPEC_REF_OK),
  }
  const ISSUE_2_MATCHING = {
    number: 502,
    title: '#2 signup',
    state: 'open',
    milestone: { title: 'Epic' },
    labels: [{ name: 'type:backend' }],
    body: buildIssueBody({ n: 2, name: 'signup', type: 'backend', entrega: 'registro', deps: [], ac: ['AC-2.1'], protected: '–' }, SPEC_REF_OK),
  }

  it('reporta el AC y la dependencia faltantes por stderr, exit 3, sin mutar nada', () => {
    const dir = makeSpecDir('ctg-')
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
      expect(err).toMatch(/falta la dependencia "merge-after `#2`"/)
    }
    expect(threw).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--reconcile bajo --dry-run: el preview nombra las categorías (dependencias, criterios de aceptación) SIN volcar el `--body` completo, y no muta nada', () => {
    const dir = makeSpecDir('ctg-')
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
      expect(err).not.toContain('merge-after `#2`\n')
    }
    expect(threw).toBe(true)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/) // --dry-run jamás muta, ni con --reconcile
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom --dry-run — labels: gateadas por columna (review, punto 2)', () => {
  const NO_AREA_SPEC = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
`
  it('sin columna "Área" en la tabla: un area: puesto a mano en el issue no se reporta como "sobra", exit 0', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, NO_AREA_SPEC)
    const ISSUE_WITH_AREA = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      // F21: `gate:none` sí la pide el spec — la columna `Tipo` está presente,
      // así que el spec SÍ tiene opinión sobre `gate:` (a diferencia de
      // `area:`, que es de lo que trata este test).
      labels: [{ name: 'type:backend' }, { name: 'area:ops' }, { name: 'gate:plan' }],
      body: matchingBody(),
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
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, ONE_SLICE_SPEC)
    const EXISTING = {
      number: 501,
      title: '#1 otro título',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:plan' }],
      body: matchingBody(),
    }
    const envOverrides = { FAKE_GH_LIST_SEQUENCE: JSON.stringify([[EXISTING]]), FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]) }
    const dryRunRes = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv(envOverrides) })
    const realRes = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic'], { encoding: 'utf8', env: fakeEnv(envOverrides) })
    expect(dryRunRes.status).toBe(3)
    expect(realRes.status).toBe(3)
    rmSync(dir, { recursive: true, force: true })
  })
})

// F23 — las dos caras del §2 del feedback de campo, medidas en producción
// sobre menoplus-app/menoplus con los issues #451–#456 de un epic anterior y
// cerrado. Antes de este arreglo, el emparejado por marcador barría el REPO
// ENTERO, así que el contrato §9 ("los # son únicos dentro de su milestone,
// no del repo") era cierto en /ct-next y falso aquí.
const TRES_SLICES = (a, b, c) => `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| ${a} | uno | backend | a | – | AC-${a}.1 | – | api | db |
| ${b} | dos | backend | b | – | AC-${b}.1 | – | api | db |
| ${c} | tres | backend | c | – | AC-${c}.1 | – | api | db |
`

// Los seis del epic anterior: cerrados, en OTRO milestone, con ct-order 1..6
// y un enlace a OTRO spec (para no disparar la puerta de la Tarea 5, que es
// una comprobación distinta — aquí lo que se prueba es el acotado).
const EPIC_ANTERIOR = [1, 2, 3, 4, 5, 6].map((n) => ({
  number: 450 + n,
  title: `#${n} slice viejo`,
  state: 'closed',
  milestone: { number: 1, title: 'Epic anterior' },
  labels: [{ name: 'type:backend' }],
  body: `> Slice \`#${n}\` del epic. Spec: [otro-spec.md](https://github.com/o/r/blob/main/otro-spec.md)\n\ncuerpo viejo\n\n<!-- ct-order:${n} -->`,
}))

describe('ct-groom — el marcador ct-order acotado por milestone (F23, §2 del feedback)', () => {
  it('cara 1: tabla §9 empezando en 1,2,3 sobre un epic anterior con 1..6 → crea los tres, cero divergencias, cero huérfanos, exit 0', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[EPIC_ANTERIOR]]) }) })
    expect(res.status).toBe(0)
    // Lo que hacía antes: emparejaba con #451/#452/#453 y reportaba el
    // milestone distinto como divergencia, sin crear nada.
    expect(res.stderr).not.toMatch(/divergencia/)
    // Y además declaraba huérfanos a #454/#455/#456 en la MISMA corrida.
    expect(res.stderr).not.toMatch(/hu.rfano/)
    // #451/#452/#453 SÍ se nombran ahora, pero sólo como el aviso no
    // bloqueante del fallo en abierto de la puerta B (su enlace apunta a otro
    // spec): la aserción de antes era `not.toMatch(/#45[123]/)` y se ha
    // afinado, no relajado — lo que importa es que ninguna de esas menciones
    // sea un emparejado, una divergencia o un huérfano.
    for (const linea of res.stderr.split('\n').filter((l) => /#45[1-6]/.test(l))) {
      expect(linea.startsWith('aviso: ')).toBe(true)
    }
    const plan = JSON.parse(res.stdout)
    expect(plan.issues.map((i) => i.order)).toEqual([1, 2, 3])
    rmSync(dir, { recursive: true, force: true })
  })

  // La MISMA cara 1, sin --dry-run. El test de arriba no puede observar el
  // arreglo: ct-groom.mjs sale antes del bucle de creación bajo --dry-run, así
  // que su única aserción sobre creación (`plan.issues.map(i => i.order)`)
  // sale de la tabla §9 y habría pasado igual ANTES del acotado. Y la
  // modalidad de fallo de este arreglo es justamente la contraria: emparejar
  // con los issues del epic anterior en vez de crear los propios. Eso sólo se
  // ve en una corrida real.
  it('cara 1, corrida REAL: crea los tres issues del epic nuevo y no empareja con ninguno de #451–#456', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo'],
      {
        encoding: 'utf8',
        env: fakeEnv({
          FAKE_GH_LIST_SEQUENCE: JSON.stringify([[EPIC_ANTERIOR]]),
          FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic nuevo', number: 2 }]),
        }),
      })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/issue creado orden #1/)
    expect(res.stdout).toMatch(/issue creado orden #2/)
    expect(res.stdout).toMatch(/issue creado orden #3/)
    // En corrida real el verbo del aviso es indicativo: aquí sí se crea.
    expect(res.stderr).toMatch(/crearé un issue nuevo para el slice #1 en "Epic nuevo"/)
    // El fallo que este arreglo cierra: "issue orden #1 ya existe (#451), no
    // se duplica". Ni el mensaje de idempotencia ni ninguno de los seis
    // números del epic anterior pueden salir por stdout.
    expect(res.stdout).not.toMatch(/issue orden #\d+ ya existe/)
    expect(res.stdout).not.toMatch(/#45[1-6]/)
    expect(res.stderr).not.toMatch(/divergencia/)
    expect(res.stderr).not.toMatch(/hu.rfano/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('cara 2: tabla §9 empezando en 7,8,9 → NO declara huérfanos a los seis del epic anterior', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(7, 8, 9))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[EPIC_ANTERIOR]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/hu.rfano/)
    expect(res.stderr).not.toMatch(/#45[1-6]/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('el huérfano legítimo — un issue DEL EPIC ACTUAL cuyo orden ya no está en la tabla — sigue avisando y sigue saliendo 3', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const HUERFANO_REAL = {
      number: 601,
      title: '#9 slice retirado',
      state: 'open',
      milestone: { number: 2, title: 'Epic nuevo' },
      labels: [{ name: 'type:backend' }],
      body: 'cuerpo\n\n<!-- ct-order:9 -->',
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[...EPIC_ANTERIOR, HUERFANO_REAL]]]) }) })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/issue #601.*ct-order:9/)
    expect(res.stderr).toMatch(/hu.rfano/)
    // El acotado no ha silenciado la señal, sólo la ha limitado a su epic:
    // ninguno de los seis del epic anterior se declara huérfano. (Sí salen
    // #451–#453 como aviso no bloqueante de la puerta B — el fallo en abierto
    // de un enlace que no casa —, así que la aserción se afina a la línea de
    // huérfano en vez de a "no aparece el número".)
    for (const linea of res.stderr.split('\n').filter((l) => /#45[1-6]/.test(l))) {
      expect(linea.startsWith('aviso: ')).toBe(true)
      expect(linea).not.toMatch(/hu.rfano/)
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('el emparejado SÍ ocurre dentro del propio epic: un issue del milestone pedido con el mismo orden no se duplica', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const DEL_EPIC = {
      number: 700,
      title: '#1 uno',
      state: 'open',
      milestone: { number: 2, title: 'Epic nuevo' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'status:backlog' }],
      body: 'cuerpo\n\n<!-- ct-order:1 -->',
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[...EPIC_ANTERIOR, DEL_EPIC]]]) }) })
    // Divergencia real (el body no trae AC ni enlace al spec) → exit 3,
    // nombrando el issue de SU epic. Lo que importa aquí es que lo encuentra.
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/slice #1.*issue #700/)
    // Y como el slice #1 YA tiene issue en este epic, el aviso de la puerta B
    // no habla de él: no hay creación posible, luego no hay duplicación
    // posible. Los slices 2 y 3, que sí se crearían, sí se avisan.
    expect(res.stderr).not.toMatch(/aviso: el slice #1 de este spec/)
    expect(res.stderr).toMatch(/aviso: el slice #2 de este spec/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — puerta A: issues sin milestone (F23)', () => {
  const SIN_MILESTONE = (number, order) => ({
    number,
    title: `#${order} suelto`,
    state: 'open',
    milestone: null,
    labels: [],
    body: `cuerpo\n\n<!-- ct-order:${order} -->`,
  })

  it('colisiona con la tabla §9 → exit 1, los nombra, y NO muta nada', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[SIN_MILESTONE(487, 2), SIN_MILESTONE(488, 3)]]]) }) })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/#487\s+ct-order:2/)
    expect(res.stderr).toMatch(/#488\s+ct-order:3/)
    expect(res.stderr).toMatch(/no se ha creado ni modificado nada/)
    expect(res.stderr).toMatch(/gh issue edit .*--milestone/)
    // El efecto, no el exit code: la puerta cae ANTES de la primera mutación,
    // que es la creación del milestone.
    expect(res.stdout).not.toMatch(/milestone creado/)
    expect(res.stdout).not.toMatch(/issue creado/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('NO colisiona con la tabla §9 → aviso que lo nombra, la corrida sigue', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[SIN_MILESTONE(487, 9)]]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/issue #487.*ct-order:9.*no tiene milestone/)
    expect(res.stderr).not.toMatch(/no se ha creado ni modificado nada/)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues.map((i) => i.order)).toEqual([1, 2, 3])
    rmSync(dir, { recursive: true, force: true })
  })

  it('bajo --dry-run la puerta también aborta: un preview que calla que la corrida real se pararía informa menos que la corrida real', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[SIN_MILESTONE(487, 2)]]]) }) })
    expect(res.status).toBe(1)
    expect(res.stdout).not.toMatch(/"issues"/) // ni siquiera se imprime el plan
    rmSync(dir, { recursive: true, force: true })
  })

  it('un issue sin milestone y SIN marcador ct-order no dice nada de nada', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const SUELTO = { number: 490, title: 'issue a mano', state: 'open', milestone: null, labels: [], body: 'sin marcador' }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[SUELTO]]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/#490/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — puerta B: el mismo epic bajo otro título (F23)', () => {
  // MISMO spec que produce el plan de este directorio de test (spec.md), pero
  // en OTRO milestone: la firma de un epic renombrado, o de una errata en
  // --milestone.
  const mismoSpecOtroEpic = (number, order) => ({
    number,
    title: `#${order} uno`,
    state: 'open',
    milestone: { number: 1, title: 'Epic anterior' },
    labels: [{ name: 'type:backend' }],
    body: buildIssueBody(
      { n: order, name: 'uno', type: 'backend', entrega: 'a', deps: [], ac: [`AC-${order}.1`], protected: '–' },
      SPEC_REF_OK,
    ),
  })

  it('mismo orden + mismo spec en otro milestone → exit 1, nombra el issue y su milestone real, no muta nada', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[mismoSpecOtroEpic(452, 2)]]]) }) })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/#452\s+ct-order:2/)
    expect(res.stderr).toMatch(/Epic anterior/)
    expect(res.stderr).toMatch(/Epic nuevo/)
    expect(res.stderr).toMatch(/no se ha creado ni modificado nada/)
    expect(res.stdout).not.toMatch(/milestone creado/)
    expect(res.stdout).not.toMatch(/issue creado/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('mismo orden pero OTRO spec → no dispara: es un epic distinto reusando números, que es lo que F23 habilita', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[EPIC_ANTERIOR]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/no se ha creado ni modificado nada/)
    // "No dispara" es no BLOQUEAR, no callarse: los tres órdenes que sí están
    // en la tabla de hoy salen como aviso (ver los tests del aviso más abajo).
    expect(res.stderr).toMatch(/aviso: el slice #1 de este spec/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('mismo spec pero un orden que NO está en la tabla de hoy → no dispara', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[mismoSpecOtroEpic(452, 8)]]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/no se ha creado ni modificado nada/)
    rmSync(dir, { recursive: true, force: true })
  })

  // El aviso del fallo en abierto. La puerta B descarta un issue de otro
  // milestone cuando su enlace al spec no casa con el nuestro — y ése es
  // exactamente el cubo del que sale un epic duplicado con exit 0 si el
  // enlace no casaba sólo porque el issue es viejo o porque su enlace quedó
  // degradado. Descartarlo en silencio era la asimetría con la puerta A, que
  // sí nombra los issues sin milestone que NO bloquean.
  it('aviso (enlace DISTINTO): nombra el issue, su milestone y el riesgo de duplicado — y no cambia el exit code', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[EPIC_ANTERIOR[1]]]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/^aviso: el slice #2 de este spec tiene un issue en otro milestone con el mismo ct-order \(#452, "Epic anterior"\)/m)
    expect(res.stderr).toMatch(/su enlace al spec no coincide con el de este spec/)
    // Bajo --dry-run el verbo es condicional: aquí no se crea nada (mismo
    // criterio que el recordatorio de status:backlog, "quedarían"/"quedan").
    expect(res.stderr).toMatch(/crearía un issue nuevo para el slice #2 en "Epic nuevo"/)
    expect(res.stderr).toMatch(/esto va a duplicarlo: compruébalo antes de seguir/)
    // No bloquea: la corrida sigue y el plan se imprime entero.
    expect(res.stderr).not.toMatch(/no se ha creado ni modificado nada/)
    expect(JSON.parse(res.stdout).issues.map((i) => i.order)).toEqual([1, 2, 3])
    rmSync(dir, { recursive: true, force: true })
  })

  // La rama `suyo === null` del fallo en abierto: un issue de otro epic con
  // marcador ct-order pero SIN línea de enlace al spec en el body. Es la más
  // probable en un repo real (issues creados a mano, o groomeados por una
  // versión anterior a la línea de enlace) y no tenía ningún test.
  it('aviso (SIN enlace al spec en el body): también se nombra, con el motivo correcto', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const SIN_ENLACE = {
      number: 470,
      title: '#2 a mano',
      state: 'open',
      milestone: { number: 1, title: 'Epic anterior' },
      labels: [],
      body: 'cuerpo escrito a mano, sin enlace al spec\n\n<!-- ct-order:2 -->',
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[SIN_ENLACE]]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/aviso:.*#470, "Epic anterior"/)
    expect(res.stderr).toMatch(/no lleva ninguna línea de enlace al spec/)
    expect(res.stderr).not.toMatch(/no se ha creado ni modificado nada/)
    rmSync(dir, { recursive: true, force: true })
  })

  // El acotado del aviso: la duplicación sólo puede ocurrir si el slice se va
  // a CREAR. Si ya tiene issue en este epic, el emparejado lo encuentra, la
  // creación se salta, y avisar sería un aviso que nadie puede satisfacer —
  // saldría en cada corrida, para siempre, sin describir ninguna pérdida
  // (mismo criterio que el filtro de cerrados de backlogPendingCount).
  it('el aviso NO sale para un slice que YA tiene issue en este epic: sin creación no hay duplicación', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const YA_EN_ESTE_EPIC = {
      number: 700,
      title: '#1 uno',
      state: 'open',
      milestone: { number: 2, title: 'Epic nuevo' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:plan' }, { name: 'status:backlog' }],
      body: buildIssueBody(
        { n: 1, name: 'uno', type: 'backend', entrega: 'a', deps: [], ac: ['AC-1.1'], protected: '–' },
        SPEC_REF_OK,
      ),
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[...EPIC_ANTERIOR, YA_EN_ESTE_EPIC]]]) }) })
    expect(res.status).toBe(0)
    // #451 lleva ct-order:1, igual que el issue que este epic ya tiene: nada
    // que duplicar, ningún aviso que lo nombre.
    expect(res.stderr).not.toMatch(/aviso: el slice #1 de este spec/)
    expect(res.stderr).not.toMatch(/#451/)
    // #452/#453 sí: los slices 2 y 3 todavía se crearían.
    expect(res.stderr).toMatch(/aviso: el slice #2 de este spec.*#452/)
    expect(res.stderr).toMatch(/aviso: el slice #3 de este spec.*#453/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('el aviso NO sale cuando el orden del issue de otro epic no está en la tabla de hoy: ahí no hay nada que duplicar', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(7, 8, 9))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[EPIC_ANTERIOR]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/aviso: el slice/)
    expect(res.stderr).not.toMatch(/#45[1-6]/)
    rmSync(dir, { recursive: true, force: true })
  })

  // El aviso afirma que este groom va a crear ese slice. En una corrida que
  // se para en seco no se crea nada, así que los avisos se emiten DESPUÉS del
  // exit de los bloqueos: un aviso que sale junto a "no se ha creado ni
  // modificado nada" se contradice con el pie de su propia corrida. Nada se
  // pierde — la corrida siguiente, ya sin bloqueo, los vuelve a calcular.
  it('cuando la puerta bloquea, el aviso no se emite: nada se va a crear, así que nada se puede duplicar', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[mismoSpecOtroEpic(452, 2), EPIC_ANTERIOR[0]]]]) }) })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/#452\s+ct-order:2/) // el bloqueo sí sale
    expect(res.stderr).toMatch(/no se ha creado ni modificado nada/)
    // #451 (ct-order:1, otro spec) habría avisado en una corrida que siguiera.
    expect(res.stderr).not.toMatch(/aviso: el slice/)
    expect(res.stderr).not.toMatch(/#451/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('las DOS puertas en la misma corrida: los dos bloques se reportan y se sale UNA sola vez', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const SIN_MS = { number: 487, title: '#3 suelto', state: 'open', milestone: null, labels: [], body: 'x\n\n<!-- ct-order:3 -->' }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[SIN_MS, mismoSpecOtroEpic(452, 2)]]]) }) })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/#487\s+ct-order:3/)   // puerta A
    expect(res.stderr).toMatch(/#452\s+ct-order:2/)   // puerta B
    // Un solo cierre: el pie aparece exactamente una vez.
    expect(res.stderr.match(/no se ha creado ni modificado nada/g)).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })
})

// Slice 10 — la columna `Señal` en el wrapper: la exención sin razón es
// hardError (exit 2, ANTES de cualquier mutación y también bajo --dry-run —
// precedente del Gate desconocido: lo que no se puede leer no puede colar en
// silencio), y la ausencia de la columna avisa POR CONSECUENCIA (el juez de
// slice medirá su ítem observabilidad como sin-vara en todo el epic).
describe('la columna Señal en el groom (Slice 10)', () => {
  const CON_SENAL = (senal1, senal2) => `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Señal |
|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema | ${senal1} |
| 2 | refresh | backend | flow | #1 | AC-2.1 | – | ${senal2} |
`

  it('una exención sin razón aborta con exit 2 nombrando la fila, la sintaxis N/A — <razón> y el remedio', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, CON_SENAL('N/A', 'métrica x'))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/slice #1: "N\/A"/)
    expect(res.stderr).toMatch(/N\/A — <razón>/)
    expect(res.stderr).toMatch(/deja la celda vacía o con "–"/)
    expect(res.stderr).toMatch(/corrige esas filas y vuelve a intentarlo/)
    // Aborta ANTES de imprimir ningún plan: bajo --dry-run tampoco sale JSON.
    expect(res.stdout).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  it('las exenciones sin razón se agregan con el resto de hardErrors en una sola corrida', () => {
    const dir = makeSpecDir('ctg-')
    // Dos defectos a la vez: la exención sin razón (Señal) y un Dep
    // malformado ("S1") — los dos mensajes deben salir en UNA sola ejecución,
    // como el resto de hardErrors agregados.
    const DOS_DEFECTOS = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Señal |
|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema | N/A — |
| 2 | refresh | backend | flow | S1 | AC-2.1 | – | – |
`
    const spec = join(dir, 'spec.md'); writeFileSync(spec, DOS_DEFECTOS)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/exención sin razón/)
    expect(res.stderr).toMatch(/sin ninguna dependencia reconocible/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('tabla sin columna Señal: aviso por consecuencia por stderr, exit 0', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, SPEC)
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/no tiene columna "Señal"/)
    // El aviso describe la CONSECUENCIA medible, no solo la ausencia.
    expect(res.stderr).toMatch(/sin sección "## Señal de observabilidad"/)
    expect(res.stderr).toMatch(/observabilidad como sin-vara/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('el dry-run enseña la sección "## Señal de observabilidad" en el body del slice que la declara y no en el que no', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, CON_SENAL('–', 'métrica `backfill_progress` con label `estado`'))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].body).not.toContain('## Señal de observabilidad')
    expect(plan.issues[1].body).toContain('## Señal de observabilidad')
    expect(plan.issues[1].body).toContain('métrica `backfill_progress` con label `estado`')
    rmSync(dir, { recursive: true, force: true })
  })

  it('la exención razonada viaja verbatim al body y no aborta nada', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, CON_SENAL('N/A — pantalla sin telemetría nueva que prometer', 'métrica x'))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].body).toContain('## Señal de observabilidad')
    expect(plan.issues[0].body).toContain('N/A — pantalla sin telemetría nueva que prometer')
    rmSync(dir, { recursive: true, force: true })
  })
})
