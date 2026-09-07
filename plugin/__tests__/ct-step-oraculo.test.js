// Un trozo de la máquina de estados de scripts/ct-step.mjs. El preámbulo —y
// por qué son nueve ficheros y no uno— está en fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { crearHelpers, montarRepo, PLAN } from './fixtures/ct-step-harness.js'

let repo
const { ct, informe, veredicto, veredictoDeSlice, commits, estado, juzgar, tareaOk } = crearHelpers(() => repo)

beforeEach(() => { repo = montarRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

describe('next: la sesión pregunta y el oráculo contesta', () => {
  it('dice la tarea, el paso y qué despachar, sin transicionar', () => {
    const r = ct('next')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/tarea 1\/2 — la primera/)
    expect(r.stdout).toMatch(/paso: implement/)
    expect(r.stdout).toMatch(/DESPACHA UN IMPLEMENTADOR/)
    // Y con qué modelo: omitirlo hereda el de la sesión, que es el más caro.
    expect(r.stdout).toMatch(/modelo sonnet/)
    // Preguntar no avanza nada: el paso sigue siendo el mismo.
    expect(ct('next').stdout).toMatch(/paso: implement/)
    expect(estado().step).toBe('implement')
  })

  it('prepara el brief de la tarea, que es lo que el implementador necesita', () => {
    ct('next')
    const brief = join(repo, '.agent', 'run-7', 'task-1-brief.md')
    expect(existsSync(brief)).toBe(true)
    expect(readFileSync(brief, 'utf8')).toMatch(/### Task 1 — la primera/)
  })

  it('en el paso del juez prepara el paquete de revisión del ÍNDICE', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    const r = ct('next')
    expect(r.stdout).toMatch(/DESPACHA EL JUEZ .*ct-judge.*SIN Bash/)
    // La propiedad "implementador y juez leen el mismo texto" cuelga de esta
    // línea: el despacho del juez nombra el brief, o el juez nunca lo abre.
    expect(r.stdout).toMatch(/el brief de la tarea: .*task-1-brief\.md/)
    const paquete = join(repo, '.agent', 'run-7', 'task-1-review.diff')
    expect(readFileSync(paquete, 'utf8')).toMatch(/\+uno/)
  })

  it('cuando el juez devolvió la tarea, next se lo dice al implementador', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    juzgar(veredicto('FAIL', [{ severity: 'high', what: 'está mal', path: 'uno.txt', line: 1 }]))
    expect(ct('next').stdout).toMatch(/El juez devolvió esta tarea[\s\S]*uno\.txt:1: está mal/)
  })
})

// ---------------------------------------------------------------------------
// LA PROPIEDAD CENTRAL: la secuencia es mecanismo, no prosa.
// ---------------------------------------------------------------------------
describe('la guardia del paso', () => {
  it.each([
    ['commit', 'implement'],
    ['controls', 'implement'],
    ['verdict', 'implement'],
    ['global', 'implement'],
    ['slice-verdict', 'implement'],
  ])('pedir "%s" estando en "%s" se RECHAZA con 9, y dice cuál toca', (verbo, paso) => {
    const conJson = { verdict: () => ct('verdict', veredicto('PASS')), 'slice-verdict': () => ct('slice-verdict', veredictoDeSlice('PASS')) }
    const r = conJson[verbo] ? conJson[verbo]() : ct(verbo)
    expect(r.status).toBe(9)
    expect(r.stderr).toMatch(new RegExp(`el run está en "${paso}"`))
    expect(r.stderr).toMatch(/ct-step next/)
  })

  it('no se puede saltar el juez para commitear', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    const r = ct('commit')
    expect(r.status).toBe(9)
    expect(commits()).toBe(1)
  })

  it('no se puede volver a medir una tarea ya comiteada', () => {
    tareaOk('uno.txt')
    expect(estado().task).toBe(2)
    expect(ct('controls').status).toBe(9)   // la tarea 2 está en implement
  })
})

describe('el plan y el entorno', () => {
  it('un plan cuya verificación es prosa sale por 6, y ni siquiera dice qué despachar', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace(/```bash\ntest -f uno\.txt\n```/, ''))
    const r = ct('next')
    expect(r.status).toBe(6)
    expect(r.stderr).toMatch(/plan no ejecutable/)
  })

  it('fuera del worktree de un slice sale por 8', () => {
    rmSync(join(repo, '.agent', 'SLICE.md'))
    expect(ct('next').status).toBe(8)
  })

  it('con el índice sucio de antes y el run nuevo sale por 8', () => {
    writeFileSync(join(repo, 'uno.txt'), 'uno\n')
    execFileSync('git', ['add', 'uno.txt'], { cwd: repo })
    expect(ct('next').status).toBe(8)
  })

  it('un verbo desconocido es error de uso', () => {
    expect(ct('bailar').status).toBe(2)
  })
})
