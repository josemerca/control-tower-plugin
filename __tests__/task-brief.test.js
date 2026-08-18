// task-brief es la frontera con la decisión de José (D-4, aplazada): el
// camino por defecto de subagent-driven-development llama a este script SIN
// el flag, así que sin `--with-plan-context` su salida no puede cambiar ni un
// byte. Por eso el primer test no compara contra una expectativa escrita a
// mano, sino contra la salida del propio script tal como está en HEAD — es la
// única vara que no puede mentir si alguien toca el script sin querer romper
// ese contrato.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..')
const SCRIPT = join(REPO_ROOT, 'skills', 'subagent-driven-development', 'scripts', 'task-brief')
const PLAN = join(REPO_ROOT, 'docs', 'superpowers', 'plans', '2026-08-18-los-dos-agentes-y-la-vara-del-plan.md')
const TASK = '7'

let dir

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'task-brief-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const run = (args) => {
  try {
    const stdout = execFileSync(SCRIPT, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stdout }
  } catch (e) {
    return { status: e.status, stdout: e.stdout, stderr: e.stderr }
  }
}

describe('task-brief', () => {
  it('sin el flag la salida es byte a byte la de hoy', () => {
    const headScript = join(dir, 'task-brief-head')
    writeFileSync(headScript, execFileSync('git', ['show', 'HEAD:skills/subagent-driven-development/scripts/task-brief'], { cwd: REPO_ROOT, encoding: 'utf8' }))
    chmodSync(headScript, 0o755)

    const outHead = join(dir, 'head-brief.md')
    const outNew = join(dir, 'new-brief.md')

    execFileSync(headScript, [PLAN, TASK, outHead], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    execFileSync(SCRIPT, [PLAN, TASK, outNew], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

    expect(readFileSync(outNew)).toEqual(readFileSync(outHead))
  })

  it('con el flag añade las tres secciones de vara', () => {
    const out = join(dir, 'con-flag.md')
    const r = run(['--with-plan-context', PLAN, TASK, out])
    expect(r.status).toBe(0)

    const texto = readFileSync(out, 'utf8')
    expect(texto).toContain('### Out of scope')
    expect(texto).toContain('## 2. Closed decisions')
    expect(texto).toContain('## 3. Reference patterns')
    expect(texto).toMatch(/vara/i)
    expect(texto).toMatch(/ganan/i)

    // Las tres secciones van delante de la tarea, y la tarea sigue entera.
    const idxOutOfScope = texto.indexOf('### Out of scope')
    const idxClosed = texto.indexOf('## 2. Closed decisions')
    const idxReference = texto.indexOf('## 3. Reference patterns')
    const idxTask = texto.indexOf('### Task 7')
    expect(idxOutOfScope).toBeGreaterThanOrEqual(0)
    expect(idxClosed).toBeGreaterThan(idxOutOfScope)
    expect(idxReference).toBeGreaterThan(idxClosed)
    expect(idxTask).toBeGreaterThan(idxReference)
    expect(texto).toContain('el brief lleva la vara, detrás de un flag')

    // Cada sección se corta antes de la siguiente, no se traga el plan entero.
    expect(texto).not.toContain('## 4. Inventory')
  })

  it('el flag desconocido sale por 2', () => {
    const out = join(dir, 'flag-desconocido.md')
    const r = run(['--nope', PLAN, TASK, out])
    expect(r.status).toBe(2)
  })
})
