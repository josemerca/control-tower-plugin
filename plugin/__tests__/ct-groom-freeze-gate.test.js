import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir } from './fixtures/spec-repo.js'
import { analyzeSpecFreeze } from '../scripts/groom.js'

// F32 §4.1 — groom gana UNA comprobación (la única línea de código nueva de
// todo el diseño de la congelación): exit 2 si el spec tiene
// `[NEEDS CLARIFICATION` pendientes o si `## Hipótesis` falta o está vacía.
//
// Por qué es dura y sin flag: José no lee los specs — la puerta de
// congelación (15 líneas) es su única lectura del ciclo. Si groom aceptara
// un spec sin hipótesis o con huecos sin resolver, el "lavado de decisiones"
// que la congelación cierra volvería a entrar por la puerta de al lado.
// La CALIDAD de la hipótesis la juzga el humano al congelar; groom solo
// mira PRESENCIA. Decisión de José 2026-08-07, cerrada — sin apuesta
// falsable no es un epic y no entra por groom.

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = () => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}` })

const TABLE = `## 9. Slices
| # | Slice (issue) | Tipo | Entrega | Dep | Acepta (AC) | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
`

const HYPOTHESIS = '## Hipótesis del experimento\n\nSi X, entonces Y medible.\n\n'

function runGroom(specMd) {
  const dir = makeSpecDir('ctg-freeze-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, specMd)
  try {
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    return { status: 0, stdout: out, stderr: '' }
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('analyzeSpecFreeze — el módulo puro (dos greps)', () => {
  it('spec congelable: hipótesis presente y con contenido, cero pendientes', () => {
    const r = analyzeSpecFreeze(HYPOTHESIS + TABLE)
    expect(r.hypothesis).toBe('ok')
    expect(r.clarifications).toEqual([])
  })

  it('acepta el heading corto «## Hipótesis» además del largo', () => {
    expect(analyzeSpecFreeze('## Hipótesis\n\nApuesta.\n' + TABLE).hypothesis).toBe('ok')
  })

  it('hipótesis ausente', () => {
    expect(analyzeSpecFreeze(TABLE).hypothesis).toBe('ausente')
  })

  it('hipótesis vacía (solo blancos)', () => {
    expect(analyzeSpecFreeze('## Hipótesis\n\n   \n' + TABLE).hypothesis).toBe('vacia')
  })

  it('hipótesis vacía: un comentario HTML residual de la plantilla NO cuenta como contenido', () => {
    const r = analyzeSpecFreeze('## Hipótesis\n\n<!-- escribe aquí la apuesta falsable -->\n' + TABLE)
    expect(r.hypothesis).toBe('vacia')
  })

  it('la sección de la hipótesis termina en el siguiente heading (el contenido de OTRA sección no la rellena)', () => {
    const r = analyzeSpecFreeze('## Hipótesis\n## Enfoque técnico\n\nMucho contenido aquí.\n' + TABLE)
    expect(r.hypothesis).toBe('vacia')
  })

  it('un «### Hipótesis» de nivel 3 no es la sección (el grep pre-registrado es «## Hipótesis»)', () => {
    expect(analyzeSpecFreeze('### Hipótesis\n\nApuesta.\n' + TABLE).hypothesis).toBe('ausente')
  })

  it('recoge cada [NEEDS CLARIFICATION pendiente con su línea', () => {
    const md = HYPOTHESIS + '[NEEDS CLARIFICATION: ¿qué pasa con X?]\n' + TABLE + '\nOtro [NEEDS CLARIFICATION: ¿e Y?]\n'
    const r = analyzeSpecFreeze(md)
    expect(r.clarifications).toHaveLength(2)
    expect(r.clarifications[0].line).toBeGreaterThan(0)
    expect(r.clarifications[0].raw).toContain('NEEDS CLARIFICATION')
  })
})

describe('ct-groom — la puerta de congelación (exit 2, antes de tocar nada, también bajo --dry-run)', () => {
  it('spec sin «## Hipótesis» → exit 2 y el remedio en el mensaje', () => {
    const r = runGroom(TABLE)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('## Hipótesis')
    // el mensaje dice a dónde va el trabajo sin apuesta: fuera del ciclo de epics
    expect(r.stderr).toMatch(/issue suelto|sin apuesta/i)
  })

  it('«## Hipótesis» vacía → exit 2 (presencia sin contenido no es presencia)', () => {
    const r = runGroom('## Hipótesis\n\n\n' + TABLE)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('vacía')
  })

  it('[NEEDS CLARIFICATION pendiente → exit 2, nombrando cuántos y dónde', () => {
    const r = runGroom(HYPOTHESIS + TABLE + '\n[NEEDS CLARIFICATION: ¿tabla o lista?]\n')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('[NEEDS CLARIFICATION')
    expect(r.stderr).toMatch(/línea \d+/)
  })

  it('las dos averías a la vez → los dos mensajes, un solo exit 2 (sin noria de arregla-uno-corre-otra-vez)', () => {
    const r = runGroom(TABLE + '\n[NEEDS CLARIFICATION: ¿?]\n')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('## Hipótesis')
    expect(r.stderr).toContain('[NEEDS CLARIFICATION')
  })

  it('la puerta se agrega a los errores de tabla: hipótesis ausente + tabla rota se reportan JUNTOS', () => {
    const r = runGroom('nada de tabla aquí\n')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('## Hipótesis')
    expect(r.stderr).toContain('tabla')
  })

  it('spec congelable → la puerta no dispara y el dry-run imprime su plan (exit 0)', () => {
    const r = runGroom(HYPOTHESIS + TABLE)
    expect(r.status).toBe(0)
    const plan = JSON.parse(r.stdout)
    expect(plan.issues).toHaveLength(1)
  })
})
