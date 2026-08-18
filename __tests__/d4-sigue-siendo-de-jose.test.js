// ============================================================================
// D-4 SIGUE SIENDO UNA DECISIÓN DE JOSÉ, Y ESTO LO COMPRUEBA.
//
// El documento de convergencia (docs/convergencia-tres-loops.md) tiene la
// decisión D-4 —"¿el orquestador de CT deja de ser una sesión de chat?"—
// APLAZADA, con dueño José y con un cuándo: "se revisa al cerrar F38". Y en su
// sección de frontera lo dice más claro todavía: el orquestador como programa
// "se aplaza, no se descarta […] no se aborda en estas cuatro rondas".
//
// `ct-step` está construido para no tocar esa decisión: la sesión sigue
// conduciendo y sólo pregunta el paso siguiente. Pero "no cambia el camino por
// defecto" es, escrito así, una PROMESA — y en este repo una comprobación que
// sólo se documenta no existe (misma doctrina que skills-fork.test.js con las
// tres costuras del fork, y que commit-keyword-guard: una puerta, no un aviso).
//
// Este fichero es esa puerta. Si alguien mete ct-step en el camino que recorre
// una sesión despachada sin querer, la suite se pone roja y dice de quién es la
// decisión. El día que José apruebe D-4, este test se borra en el mismo commit
// que lo enchufe — y ese commit será, por fin, la decisión tomada por su dueño.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = (p) => readFileSync(join(root, p), 'utf8')

// Una MENCIÓN en un comentario es legítima (explicar por qué algo existe);
// una INVOCACIÓN no lo es. Se distinguen por la forma: invocar es nombrar el
// fichero ejecutable o el comando con un verbo detrás.
const INVOCACION = /(node\s+\S*ct-step\.mjs|ct-step\s+(next|report|controls|verdict|commit)|scripts\/ct-step\.mjs)/

const sinComentarios = (texto) => texto
  .split('\n')
  .filter((l) => !/^\s*(\/\/|#|\*|<!--)/.test(l))
  .join('\n')

describe('el camino por defecto de una sesión despachada no invoca ct-step', () => {
  it('los cuatro slash commands no lo invocan', () => {
    for (const f of readdirSync(join(root, 'commands'))) {
      expect(sinComentarios(leer(join('commands', f)))).not.toMatch(INVOCACION)
    }
  })

  it('el kickoff que recibe el agente no lo invoca (mencionarlo en un comentario del código sí vale)', () => {
    // kickoff.js:256 es la línea que nombra subagent-driven-development. Ésa es
    // la línea que cambiaría el día que D-4 se apruebe, y es de una línea.
    expect(sinComentarios(leer('scripts/kickoff.js'))).not.toMatch(INVOCACION)
  })

  it('ninguna skill lo manda ejecutar', () => {
    const skills = readdirSync(join(root, 'skills'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
    for (const d of skills) {
      const skill = join('skills', d.name, 'SKILL.md')
      if (!existsSync(join(root, skill))) continue
      expect(sinComentarios(leer(skill))).not.toMatch(INVOCACION)
    }
  })

  it('ningún hook lo invoca', () => {
    for (const f of readdirSync(join(root, 'hooks'))) {
      if (!f.endsWith('.js')) continue
      expect(sinComentarios(leer(join('hooks', f)))).not.toMatch(INVOCACION)
    }
    expect(leer('hooks/hooks.json')).not.toMatch(/ct-step/)
  })

  it('el dispatcher no lo invoca: /ct-next sigue lanzando lo que lanzaba', () => {
    expect(sinComentarios(leer('scripts/ct-next.mjs'))).not.toMatch(INVOCACION)
    expect(sinComentarios(leer('scripts/dispatch.js'))).not.toMatch(INVOCACION)
  })
})

describe('y el documento de convergencia sigue diciendo lo que este test defiende', () => {
  it('D-4 sigue aplazada y con dueño en el documento', () => {
    // Si alguien resuelve D-4 en el documento, este test falla y toca revisar el
    // de arriba: la barrera dejaría de tener sentido, y eso es exactamente el
    // momento en el que hay que mirarla.
    const doc = leer('docs/convergencia-tres-loops.md')
    const fila = doc.split('\n').find((l) => l.includes('| D-4 |'))
    expect(fila, 'la fila de D-4 desapareció del documento de convergencia').toBeTruthy()
    expect(fila).toMatch(/José/)
    expect(fila).toMatch(/Aplazada/i)
  })
})
