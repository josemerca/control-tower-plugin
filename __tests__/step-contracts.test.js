// Lo que cruza la frontera entre la sesión y sus subagentes
// (scripts/step-contracts.js): qué se acepta como respuesta y qué escribe el
// plugin.
//
// El argv de `claude -p` ya no está: se fue con el conductor-programa (D-4
// aplazada). Lo que queda es el esquema, que con un subagente al otro lado
// importa MÁS y no menos — antes lo imponía el binario, ahora lo impone esta
// validación.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readVerdict, readReport, outcomeOfVerdict, commitMessage,
  VERDICT_SCHEMA, REPORT_SCHEMA, IMPLEMENTER_TOOLS, JUDGE_TOOLS, PATH_KINDS, VERDICT_RULES,
} from '../scripts/step-contracts.js'

const AGENTE_JUEZ = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'ct-judge.md')
// La línea `tools:` del frontmatter, que es la que decide de verdad qué puede
// hacer el juez. La constante del módulo es una copia suya.
const toolsDelAgente = () => {
  const m = /^tools:\s*(.+)$/m.exec(readFileSync(AGENTE_JUEZ, 'utf8'))
  return m ? m[1].trim() : null
}

describe('quién puede qué', () => {
  it('el juez no tiene shell, y quien se lo quita es la declaración del agente', () => {
    // Antes se lo quitaba el binario con --tools; ahora lo declara
    // agents/ct-judge.md. La propiedad es la misma: estructural, no una promesa
    // dentro del prompt. Por eso se mira el FICHERO y no sólo la constante.
    expect(toolsDelAgente()).not.toMatch(/Bash|Edit/)
    expect(JUDGE_TOOLS).not.toMatch(/Bash|Edit/)
    expect(IMPLEMENTER_TOOLS).toMatch(/Bash/)
  })

  it('la constante no puede divergir del agente que se despacha', () => {
    // Divergieron: al darle `Write` al juez —sin él no puede entregar su
    // veredicto y el paso no cierra nunca— la constante se quedó atrás, y
    // `ct-step next` pasó a anunciar unas herramientas que no eran las del juez
    // real. Un módulo puro no puede leer el fichero, así que lo que impide que
    // vuelva a pasar es este test y no el código.
    expect(JUDGE_TOOLS).toBe(toolsDelAgente())
  })

  it('el juez puede escribir su veredicto: es el canal por el que contesta', () => {
    expect(toolsDelAgente()).toMatch(/Write/)
  })
})

describe('el veredicto', () => {
  const v = (ruling, findings = []) => readVerdict({ ruling, findings })

  it('un PASA limpio se lee y vale', () => {
    expect(v('PASS').verdict).toEqual({ ruling: 'PASS', findings: [] })
  })

  it.each([
    ['sin structured_output', null, /no devolvió structured_output/],
    ['con un ruling inventado', { ruling: 'MAYBE', findings: [] }, /ruling desconocido/],
    ['con findings que no es lista', { ruling: 'PASS', findings: 'ninguno' }, /no es una lista/],
    ['con una severidad inventada', { ruling: 'FAIL', findings: [{ rule: 'contrato', severity: 'catastrophic', what: 'x', where: 'y' }] }, /severidad desconocida/],
    ['con un hallazgo mudo', { ruling: 'FAIL', findings: [{ rule: 'contrato', severity: 'high', what: '', where: 'y' }] }, /no dice qué o dónde/],
  ])('se descarta %s', (_caso, structured, motivo) => {
    const r = readVerdict(structured)
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(motivo)
  })

  it('un PASS con un hallazgo grave se descarta: se contradice a sí mismo', () => {
    // No se interpreta hacia el lado prudente. Un juez que no se entiende a sí
    // mismo no ha juzgado, y volver a preguntar cuesta menos que decidir por él.
    const r = v('PASS', [{ rule: 'contrato', severity: 'high', what: 'sql injection', where: 'db.js:10' }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/contradice la rúbrica/)
  })

  it('el hallazgo nombra la regla que incumple', () => {
    const r = v('FAIL', [{ rule: 'manipulacion-tests', severity: 'high', what: 'debilitó una aserción', where: 'a.test.js:12' }])
    expect(r.verdict.findings[0].rule).toBe('manipulacion-tests')
  })

  it('una regla fuera del enum descarta el veredicto', () => {
    // El mismo criterio que ya aplica a un ruling inventado: una regla que no
    // está en VERDICT_RULES no es un hallazgo sin justificar, es un dato que no
    // se entiende — se descarta y se vuelve a preguntar, no es un error.
    const r = v('FAIL', [{ rule: 'me-lo-invento', severity: 'high', what: 'x', where: 'y' }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/regla desconocida/)
    expect(VERDICT_RULES).not.toContain('me-lo-invento')
  })
})

describe('de veredicto a resultado de la tabla', () => {
  const o = (ruling, findings = []) => outcomeOfVerdict({ ruling, findings })

  it('FAIL es un veto', () => {
    expect(o('FAIL', [{ severity: 'high', what: 'x', where: 'y' }])).toBe('failed')
  })

  it('PASS limpio entrega', () => {
    expect(o('PASS')).toBe('done')
  })

  it('PASS con hallazgos sólo de severidad baja entrega igual', () => {
    // Si cada nimiedad volviera al implementador, el bucle no terminaría nunca.
    expect(o('PASS', [{ severity: 'low', what: 'nombre mejorable', where: 'a.js' }])).toBe('done')
  })

  it('PASS con un hallazgo medio es un refunfuño: corrige, pero no bloquea', () => {
    expect(o('PASS', [{ severity: 'medium', what: 'falta un caso', where: 'a.test.js' }])).toBe('corrections-ordered')
  })
})

describe('el informe del implementador', () => {
  it('trae las rutas que tocó, que es lo que el programa stagea', () => {
    const paths = [
      { path: 'src/a.js', kind: 'production' },
      { path: 'src/a.test.js', kind: 'test' },
    ]
    expect(readReport({ paths, summary: 'hecho' }).report.paths).toHaveLength(2)
  })

  it.each([
    ['una ruta absoluta', [{ path: '/etc/passwd', kind: 'production' }]],
    ['una ruta que se sale del worktree', [{ path: '../otro-repo/secreto.txt', kind: 'production' }]],
  ])('rechaza %s: la lista la escribe un modelo, no es un dato de confianza', (_caso, paths) => {
    const r = readReport({ paths, summary: 'hecho' })
    expect(r.report).toBeUndefined()
    expect(r.why).toMatch(/fuera del worktree/)
  })

  it('un informe sin rutas se descarta en vez de commitear el índice a ciegas', () => {
    expect(readReport({ summary: 'ya está' }).why).toMatch(/rutas tocadas/)
  })

  it('el esquema del informe pide rutas y resumen, y nada más', () => {
    expect(REPORT_SCHEMA.required).toEqual(['paths', 'summary'])
    expect(REPORT_SCHEMA.additionalProperties).toBe(false)
  })

  it('el informe declara de cada ruta si es producción o test', () => {
    const r = readReport({ paths: [{ path: 'src/a.js', kind: 'production' }], summary: 'hecho' })
    expect(r.report.paths[0].kind).toBe('production')
  })

  it('un kind desconocido descarta el informe', () => {
    // No se asume producción por defecto: un kind que no está en PATH_KINDS
    // (aquí 'infra') tira el informe entero, igual que ya hace una ruta que se
    // sale del worktree.
    const r = readReport({ paths: [{ path: 'src/a.js', kind: 'infra' }], summary: 'hecho' })
    expect(r.report).toBeUndefined()
    expect(PATH_KINDS).not.toContain('infra')
  })

  it('un informe sin kind se descarta', () => {
    const r = readReport({ paths: [{ path: 'src/a.js' }], summary: 'hecho' })
    expect(r.report).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// El mensaje de commit. El hook `commit-keyword-guard` es un PreToolUse sobre
// la herramienta Bash de una SESIÓN: un `git commit` lanzado por un programa no
// pasa por esa puerta, así que el programa se mira su propio mensaje.
// ---------------------------------------------------------------------------
describe('el mensaje que compone el programa', () => {
  const msg = (name) => commitMessage({ issue: 42, task: 2, tasksTotal: 8, name })

  it('nombra la tarea, el issue y por dónde va la slice', () => {
    expect(msg('el cliente tipado de la API').split('\n')[0])
      .toBe('el cliente tipado de la API (#42, tarea 2/8)')
  })

  it('NUNCA lleva una closing keyword, aunque el nombre de la tarea la traiga', () => {
    // El nombre viene del plan, o sea de un agente. En F27 un commit de
    // documentación que MENCIONABA "Closes #451" cerró ese issue.
    const m = msg('fixes #451 el parseo del carrito')
    expect(m).not.toMatch(/\bfixes\s*#\d+/i)
    expect(m).toContain('fixes issue 451')
  })

  it.each(['closes #1', 'resolved #99', 'Fixed #7'])('desactiva también "%s"', (nombre) => {
    expect(() => msg(nombre)).not.toThrow()
    expect(msg(nombre)).not.toMatch(/#\d+\b(?!, tarea)/)
  })

  it('el issue del propio slice viaja como referencia, no como orden de cierre', () => {
    expect(msg('una tarea')).toContain('(#42, tarea 2/8)')
  })
})

