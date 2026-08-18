// Las dos llamadas al modelo, en datos (scripts/harness.js): qué argv se
// construye, qué se acepta como respuesta y qué escribe el programa.
//
// La fixture de la envoltura es la salida REAL de `claude -p --output-format
// json` capturada el 2026-08-18 durante el paso 0 del spec. Un test contra una
// envoltura inventada por mí sólo demuestra que sé leer lo que yo mismo
// escribí.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  buildArgv, readEnvelope, readVerdict, readReport, outcomeOfVerdict, commitMessage,
  VERDICT_SCHEMA, REPORT_SCHEMA, IMPLEMENTER_TOOLS, JUDGE_TOOLS,
} from '../scripts/harness.js'

const here = dirname(fileURLToPath(import.meta.url))
const ENVELOPE_REAL = readFileSync(join(here, 'fixtures', 'claude-envelope-verdict.json'), 'utf8')

describe('el argv de las dos llamadas', () => {
  const argv = (over = {}) => buildArgv({ tools: JUDGE_TOOLS, schema: VERDICT_SCHEMA, prompt: 'juzga', ...over })

  it('apaga la fuente de ajustes que hidrata al agente del slice', () => {
    // Medido: sin esto, una llamada lanzada dentro del worktree nace leyendo
    // `.agent/SLICE.md` — el juez juzgaría con el contexto del implementado.
    const a = argv()
    expect(a[a.indexOf('--setting-sources') + 1]).toBe('')
  })

  it('lleva --strict-mcp-config, que es la flag que decide el presupuesto', () => {
    // 0,5552 USD contra 0,0145 USD por la misma llamada. No es una opción.
    expect(argv()).toContain('--strict-mcp-config')
  })

  it('pide la envoltura JSON, que es de donde salen coste y sesión', () => {
    const a = argv()
    expect(a[a.indexOf('--output-format') + 1]).toBe('json')
  })

  it('pasa el esquema como JSON literal, no como ruta', () => {
    // "--json-schema is not valid JSON" es lo que devuelve el binario si se le
    // pasa un fichero. Medido.
    const a = argv()
    const valor = a[a.indexOf('--json-schema') + 1]
    expect(() => JSON.parse(valor)).not.toThrow()
    expect(JSON.parse(valor)).toEqual(VERDICT_SCHEMA)
  })

  it('el prompt va el último, como argumento posicional', () => {
    expect(argv({ prompt: 'juzga esto' }).at(-1)).toBe('juzga esto')
  })

  it('al juez el binario le quita Bash; al implementador se lo da', () => {
    // Estructural: no es una promesa en prosa dentro del prompt.
    expect(JUDGE_TOOLS).not.toMatch(/Bash|Write|Edit/)
    expect(IMPLEMENTER_TOOLS).toMatch(/Bash/)
    const juez = argv()
    expect(juez[juez.indexOf('--tools') + 1]).toBe('Read,Grep,Glob')
  })
})

describe('la envoltura de --output-format json', () => {
  it('lee coste, sesión y veredicto de una salida REAL del binario', () => {
    const e = readEnvelope(ENVELOPE_REAL)
    expect(e.ok).toBe(true)
    expect(e.costUsd).toBe(0.55523)
    expect(e.sessionId).toBe('7dee1f8b-c8b8-4514-9c1d-e25d26bae6af')
    expect(e.structured).toEqual({
      ruling: 'FAIL',
      findings: [{ severity: 'high', what: expect.any(String), where: expect.any(String) }],
    })
    expect(e.denials).toEqual([])
  })

  it('una salida que no es JSON no es un modelo que respondió mal: es claude que no arrancó', () => {
    const e = readEnvelope('command not found: claude')
    expect(e.ok).toBe(false)
    expect(e.why).toMatch(/no llegó a completarse/)
  })

  it('is_error se propaga como llamada fallida, con su subtype en el motivo', () => {
    const e = readEnvelope(JSON.stringify({ is_error: true, subtype: 'error_max_turns' }))
    expect(e.ok).toBe(false)
    expect(e.why).toMatch(/error_max_turns/)
  })

  it('sin total_cost_usd el coste es 0 y no NaN, que envenenaría el acumulado', () => {
    expect(readEnvelope(JSON.stringify({ result: 'x' })).costUsd).toBe(0)
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
    ['con una severidad inventada', { ruling: 'FAIL', findings: [{ severity: 'catastrophic', what: 'x', where: 'y' }] }, /severidad desconocida/],
    ['con un hallazgo mudo', { ruling: 'FAIL', findings: [{ severity: 'high', what: '', where: 'y' }] }, /no dice qué o dónde/],
  ])('se descarta %s', (_caso, structured, motivo) => {
    const r = readVerdict(structured)
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(motivo)
  })

  it('un PASS con un hallazgo grave se descarta: se contradice a sí mismo', () => {
    // No se interpreta hacia el lado prudente. Un juez que no se entiende a sí
    // mismo no ha juzgado, y volver a preguntar cuesta menos que decidir por él.
    const r = v('PASS', [{ severity: 'high', what: 'sql injection', where: 'db.js:10' }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/contradice la rúbrica/)
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
    expect(readReport({ paths: ['src/a.js', 'src/a.test.js'], summary: 'hecho' }).report.paths).toHaveLength(2)
  })

  it.each([
    ['una ruta absoluta', ['/etc/passwd']],
    ['una ruta que se sale del worktree', ['../otro-repo/secreto.txt']],
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

describe('el modelo de cada llamada', () => {
  it('sin --model, el argv no lo menciona y manda el de la cuenta', () => {
    expect(buildArgv({ tools: JUDGE_TOOLS, schema: VERDICT_SCHEMA, prompt: 'x' })).not.toContain('--model')
  })

  it('con modelo, entra justo antes del prompt', () => {
    const a = buildArgv({ tools: JUDGE_TOOLS, schema: VERDICT_SCHEMA, prompt: 'x', model: 'haiku' })
    expect(a[a.indexOf('--model') + 1]).toBe('haiku')
    expect(a.at(-1)).toBe('x')
  })
})
