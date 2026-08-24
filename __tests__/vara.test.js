// §3.3 del handoff (docs/prompt-juez-lo-que-queda.md): el plan es por slice, así
// que `## 3. Reference patterns` se re-escribía en cada plan y nada garantizaba
// que el slice 14 citara las mismas rutas que el slice 3. Este test cubre
// `scripts/vara.js`, el módulo que hace de la vara del repo un fichero por
// repo (`.agent/conventions.md`) en vez de una selección por slice repetida.
//
// Los tests de "ties" de más abajo son la parte que de verdad protege el
// diseño: la constante `CONVENTIONS_FILE` no puede divergir de los seis
// textos que la citan (el scaffolder que la siembra, el juez que la lee, el
// implementador, la skill y la plantilla que la enseñan, y el comando que la
// confirma) — el mismo desacople que ya sufrieron JUDGE_TOOLS y VERDICT_RULES.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONVENTIONS_FILE, seccionDeVara } from '../scripts/vara.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('CONVENTIONS_FILE', () => {
  it('es .agent/conventions.md', () => {
    expect(CONVENTIONS_FILE).toBe('.agent/conventions.md')
  })
})

describe('seccionDeVara', () => {
  it('con contenido, devuelve un bloque con el banner y el contenido verbatim', () => {
    const seccion = seccionDeVara('# vara\n- `AGENTS.md`\n')
    expect(seccion).toContain('leída directo de `.agent/conventions.md`')
    expect(seccion).toContain('# vara\n- `AGENTS.md`')
  })

  it('con null, devuelve la cadena vacía', () => {
    expect(seccionDeVara(null)).toBe('')
  })

  it('con undefined, devuelve la cadena vacía', () => {
    expect(seccionDeVara(undefined)).toBe('')
  })

  it('con una declaración en blanco, devuelve la cadena vacía (vacío no es vara)', () => {
    expect(seccionDeVara('  \n\n')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Ties: la constante no puede divergir de los textos que la enseñan.
// ---------------------------------------------------------------------------
describe('CONVENTIONS_FILE no diverge de los textos que la citan', () => {
  const leer = (...partes) => readFileSync(join(root, ...partes), 'utf8')

  it('scripts/ct-init.sh la siembra', () => {
    expect(leer('scripts', 'ct-init.sh')).toContain(CONVENTIONS_FILE)
  })

  it('prompts/task-implementer.md la nombra', () => {
    expect(leer('prompts', 'task-implementer.md')).toContain(CONVENTIONS_FILE)
  })

  it('skills/writing-plans-prescriptive/SKILL.md la nombra', () => {
    expect(leer('skills', 'writing-plans-prescriptive', 'SKILL.md')).toContain(CONVENTIONS_FILE)
  })

  it('skills/writing-plans-prescriptive/plan-template.md la nombra', () => {
    expect(leer('skills', 'writing-plans-prescriptive', 'plan-template.md')).toContain(CONVENTIONS_FILE)
  })

  it('commands/ct-init.md la nombra', () => {
    expect(leer('commands', 'ct-init.md')).toContain(CONVENTIONS_FILE)
  })

  it('agents/ct-judge.md la nombra, y la mención vive DENTRO del ítem `patrones`', () => {
    const texto = leer('agents', 'ct-judge.md')
    expect(texto).toContain(CONVENTIONS_FILE)
    // Misma regex que step-contracts.test.js usa para aislar el ítem 5: el
    // encabezado exacto hasta el siguiente ### o ##.
    const m = /^### 5\. `patrones`[\s\S]*?(?=^### |^## )/m.exec(texto)
    expect(m).not.toBeNull()
    expect(m[0]).toContain(CONVENTIONS_FILE)
  })
})
