// task-brief es la frontera con la decisión de José (D-4, aplazada): el
// camino por defecto de subagent-driven-development llama a este script SIN
// el flag, así que sin `--with-plan-context` su salida no puede cambiar ni un
// byte. Por eso el primer test no compara contra una expectativa escrita a
// mano, sino contra la salida del propio script en un punto fijo del
// historial — es la única vara que no puede mentir si alguien toca el script
// sin querer romper ese contrato.
//
// Ese punto fijo es el sha `2f30f9a` (el último commit anterior a esta ronda,
// justo antes de que `1c2fc61` metiera el script y este test en el MISMO
// commit) y no HEAD. Un baseline en HEAD es un baseline móvil: el script y su
// test entraron juntos, así que en un checkout limpio HEAD:script ES el
// fichero bajo prueba — se puede romper el camino sin flag y el test
// comparándose consigo mismo sigue en verde. Fijarlo a un commit anterior al
// de la introducción del contrato es lo único que deja al test comparar
// contra algo que no es el propio cambio que podría romperlo.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// Dos raíces desde que el plugin vive en plugin/: el script bajo prueba está
// dentro del plugin, pero el plan que hace de input fijo es documentación del
// REPO (docs/ no se distribuye, a propósito) y queda un nivel más arriba.
const PLUGIN_ROOT = join(here, '..')
const REPO_ROOT = join(PLUGIN_ROOT, '..')
const SCRIPT = join(PLUGIN_ROOT, 'skills', 'subagent-driven-development', 'scripts', 'task-brief')
const PLAN = join(REPO_ROOT, 'docs', 'superpowers', 'plans', '2026-08-18-los-dos-agentes-y-la-vara-del-plan.md')
const TASK = '7'
// El último commit anterior a esta ronda, anterior también a `1c2fc61` (que
// metió el script y este test en el mismo commit). Ver la nota de cabecera.
const BASELINE_SHA = '2f30f9a'

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
  it('sin el flag la salida es byte a byte la de antes de esta ronda', () => {
    const baselineScript = join(dir, 'task-brief-baseline')
    writeFileSync(baselineScript, execFileSync('git', ['show', `${BASELINE_SHA}:skills/subagent-driven-development/scripts/task-brief`], { cwd: REPO_ROOT, encoding: 'utf8' }))
    chmodSync(baselineScript, 0o755)

    const outBaseline = join(dir, 'baseline-brief.md')
    const outNew = join(dir, 'new-brief.md')

    execFileSync(baselineScript, [PLAN, TASK, outBaseline], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    execFileSync(SCRIPT, [PLAN, TASK, outNew], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

    expect(readFileSync(outNew)).toEqual(readFileSync(outBaseline))
  })

  it('con el flag añade el fin del slice y las tres secciones de vara', () => {
    const out = join(dir, 'con-flag.md')
    const r = run(['--with-plan-context', PLAN, TASK, out])
    expect(r.status).toBe(0)

    const texto = readFileSync(out, 'utf8')
    expect(texto).toContain('### Desired end state')
    expect(texto).toContain('### Out of scope')
    expect(texto).toContain('## 2. Closed decisions')
    expect(texto).toContain('## 3. Reference patterns')
    expect(texto).toMatch(/vara/i)
    expect(texto).toMatch(/ganan/i)

    // Las cuatro secciones van delante de la tarea, en el orden del plan, y la
    // tarea sigue entera.
    const idxDesired = texto.indexOf('### Desired end state')
    const idxOutOfScope = texto.indexOf('### Out of scope')
    const idxClosed = texto.indexOf('## 2. Closed decisions')
    const idxReference = texto.indexOf('## 3. Reference patterns')
    const idxTask = texto.indexOf('### Task 7')
    expect(idxDesired).toBeGreaterThanOrEqual(0)
    expect(idxOutOfScope).toBeGreaterThan(idxDesired)
    expect(idxClosed).toBeGreaterThan(idxOutOfScope)
    expect(idxReference).toBeGreaterThan(idxClosed)
    expect(idxTask).toBeGreaterThan(idxReference)
    expect(texto).toContain('el brief lleva la vara, detrás de un flag')

    // Cada sección se corta antes de la siguiente, no se traga el plan entero.
    expect(texto).not.toContain('## 4. Inventory')
  })

  // -------------------------------------------------------------------------
  // LAS CUATRO SECCIONES NO TIENEN LA MISMA AUTORIDAD. El fin del slice viaja
  // para que quien implementa y quien juzga sepan a qué sirve la tarea —era lo
  // único que la ataba a los criterios de aceptación del issue y no llegaba—,
  // pero darle autoridad de vara sería una licencia para ensanchar la tarea
  // ("sirve al fin del slice"), y eso debilita el ítem `alcance`, que hoy
  // funciona. Por eso van bajo dos líneas distintas, y por eso hay un test.
  // -------------------------------------------------------------------------
  it('el fin del slice no viaja como vara: dice que no amplía el alcance de la tarea', () => {
    const out = join(dir, 'autoridades.md')
    expect(run(['--with-plan-context', PLAN, TASK, out]).status).toBe(0)

    const texto = readFileSync(out, 'utf8')
    const idxDesired = texto.indexOf('### Desired end state')
    const cabecera = texto.slice(0, idxDesired)

    // La línea que precede al fin del slice lo desmarca de la vara.
    expect(cabecera).toMatch(/no amplía/i)
    expect(cabecera).toMatch(/\*\*Files:\*\*/)
    // Y la línea de "ganan ellas" NO cubre al fin del slice: va después, con
    // las tres que sí son vara.
    expect(cabecera).not.toMatch(/ganan/i)
    expect(texto.indexOf('ganan')).toBeGreaterThan(idxDesired)
  })

  it('si al plan le falta una sección de vara, lo dice en vez de dejar un hueco mudo', () => {
    // Un plan sin "### Out of scope" ni "## 3. Reference patterns" (pero con
    // su "## 2. Closed decisions"): las dos ausentes tienen que declararse,
    // no dejar dos líneas en blanco indistinguibles de una sección vacía.
    const planIncompleto = join(dir, 'plan-incompleto.md')
    writeFileSync(planIncompleto, [
      '# Plan de prueba',
      '',
      '## 7. Tasks',
      '',
      '### Task 1 — la única tarea',
      '',
      '**Files:**',
      '- `a.js` (create)',
      '',
    ].join('\n'))

    const out = join(dir, 'plan-incompleto-brief.md')
    const r = run(['--with-plan-context', planIncompleto, '1', out])
    expect(r.status).toBe(0)

    const texto = readFileSync(out, 'utf8')
    expect(texto).toMatch(/### Out of scope.*no encontrada en el plan/)
    expect(texto).toMatch(/## 3\. Reference patterns.*no encontrada en el plan/)
    // La línea que dice que son la vara sigue imprimiéndose igual.
    expect(texto).toMatch(/vara/i)
  })

  it('el flag desconocido sale por 2', () => {
    const out = join(dir, 'flag-desconocido.md')
    const r = run(['--nope', PLAN, TASK, out])
    expect(r.status).toBe(2)
  })
})
