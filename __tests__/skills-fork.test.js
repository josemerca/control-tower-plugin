import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROLE_BUDGETS, CODE_BUDGETS } from '../scripts/plan-contract.js'

// F32 — el fork de superpowers 6.0.3 dentro del plugin (decisión cerrada en
// F31 §5: los 11 skills usados se forkan a control-tower-loop:* y superpowers
// se desinstala). Este test fija tres cosas:
//
//   1. El ALCANCE del fork: exactamente los 11 skills decididos, ni más ni
//      menos, cada uno con su SKILL.md.
//   2. Que el fork está CERRADO sobre sí mismo: ninguna referencia al
//      namespace superpowers:* ni a los dos skills descartados
//      (requesting-code-review, using-superpowers) puede sobrevivir — un
//      cherry-pick futuro desde upstream que las reintroduzca cae aquí.
//   3. Las TRES COSTURAS reescritas (F31 §5): se comprueba tanto que el texto
//      nuevo está como que el terminal antiguo ya no está. Son prosa, no
//      código, pero son el contrato del ciclo: si un cherry-pick las pisa,
//      el ciclo vuelve a mergear solo o a saltarse la congelación.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS = join(ROOT, 'skills')

// Los 11 del barrido de uso real de F31 §5 (2.704 transcripts). Descartados:
// dispatching-parallel-agents (0 usos; su hueco lo ocupa CT entre slices),
// requesting-code-review (0 usos directos; su code-reviewer.md viaja como
// fichero DENTRO de subagent-driven-development) y using-superpowers (meta).
const FORKED = [
  'brainstorming',
  'executing-plans',
  'finishing-a-development-branch',
  'receiving-code-review',
  'subagent-driven-development',
  'systematic-debugging',
  'test-driven-development',
  'using-git-worktrees',
  'verification-before-completion',
  'writing-plans',
  'writing-skills',
]

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const read = (...parts) => readFileSync(join(SKILLS, ...parts), 'utf8')

describe('alcance del fork — los 11 skills de F31 §5, con su atribución', () => {
  it.each(FORKED)('skills/%s/SKILL.md existe', (name) => {
    expect(existsSync(join(SKILLS, name, 'SKILL.md'))).toBe(true)
  })

  it('code-reviewer.md viaja dentro de subagent-driven-development (huérfano de requesting-code-review)', () => {
    expect(existsSync(join(SKILLS, 'subagent-driven-development', 'code-reviewer.md'))).toBe(true)
  })

  it('la licencia MIT de upstream acompaña al fork', () => {
    const license = read('LICENSE-superpowers')
    expect(license).toContain('MIT License')
    expect(license).toContain('Jesse Vincent')
  })

  it('FORK.md registra la versión origen 6.0.3 para cherry-picks futuros', () => {
    expect(read('FORK.md')).toContain('6.0.3')
  })
})

describe('el fork es cerrado — nada apunta fuera de control-tower-loop', () => {
  // Un solo barrido de TODO skills/ (incluye state-template): el namespace
  // viejo y los dos skills no forkados no pueden aparecer en ningún fichero,
  // tampoco en los que hoy no los mencionan. Única exención: FORK.md, cuyo
  // trabajo es precisamente NOMBRAR lo descartado para cherry-picks futuros.
  const FORBIDDEN = [
    'superpowers:', // namespace viejo — el fork se invoca como control-tower-loop:*
    'requesting-code-review', // descartado; su prompt vive como ./code-reviewer.md
    'using-superpowers', // descartado (meta-skill de la instalación upstream)
  ]

  it.each(FORBIDDEN)('ningún fichero bajo skills/ contiene «%s»', (needle) => {
    const offenders = walk(SKILLS)
      .filter((p) => !p.endsWith('FORK.md'))
      .filter((p) => readFileSync(p, 'utf8').includes(needle))
    expect(offenders).toEqual([])
  })
})

describe('costura 1 — brainstorming termina en execution spec + congelación, no en writing-plans', () => {
  const skill = () => read('brainstorming', 'SKILL.md')

  it('el estado terminal es el execution spec en DRAFT y la petición de congelación', () => {
    expect(skill()).toContain('docs/superpowers/specs/')
    expect(skill()).toContain('-execution.md')
    expect(skill()).toContain('CONGELADA')
  })

  it('cada decisión congelada lleva procedencia y una «propuesta» no se congela', () => {
    const s = skill()
    for (const p of ['hablada', 'deducida', 'propuesta']) expect(s).toContain(p)
  })

  it('el terminal antiguo (invocar writing-plans) ya no está', () => {
    // Frágil y DECLARADO, no arreglado: la costura 6 se endureció ampliando
    // 'superpowers:' a /superpowers/i, pero aquí ese mismo ensanche choca con
    // la prosa NUEVA y correcta — el fichero dice hoy "Do NOT invoke
    // writing-plans, frontend-design, or any other implementation skill.", que
    // CONTIENE literalmente "invoke writing-plans". Una regex amplia sobre esa
    // frase (p.ej. `/invok\w*.*writing-plans/i`) marcaría como fallo la propia
    // negación que cierra la costura. Distinguir la afirmación vieja de la
    // negación nueva pide mirar el contexto (quién precede a "invoke"), y eso
    // es exactamente el tipo de regex apretada que rompe al primer
    // reformateo — se deja la comprobación literal, más frágil pero honesta.
    expect(skill()).not.toContain('The terminal state is invoking writing-plans')
    expect(skill()).not.toContain('Invoke the writing-plans skill')
  })
})

describe('costura 2 — SDD sin plan escribe el plan ahora, scoped al issue', () => {
  const skill = () => read('subagent-driven-development', 'SKILL.md')

  it('la rama «no plan» manda a writing-plans-prescriptive con el issue como spec', () => {
    const s = skill()
    expect(s).toContain('Write the plan now')
    expect(s).toContain('control-tower-loop:writing-plans-prescriptive')
    expect(s).toContain('scoped to the issue')
  })

  it('la rama antigua «brainstorm first» ya no está', () => {
    // Frágil y DECLARADO, mismo motivo que la costura 1: la prosa nueva dice
    // "Do NOT go back to brainstorming", que contiene la palabra que
    // haría falta prohibir en amplio. Ensanchar a /brainstorm/i marcaría como
    // fallo esa misma negación. Se deja el literal.
    expect(skill()).not.toContain('brainstorm first')
  })
})

describe('costura 4 — el plan del slice lo escribe writing-plans-prescriptive (skill propia)', () => {
  it('la skill propia existe con su template', () => {
    expect(existsSync(join(SKILLS, 'writing-plans-prescriptive', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(SKILLS, 'writing-plans-prescriptive', 'plan-template.md'))).toBe(true)
  })

  it('es propia, no forkada: fuera de la lista FORKED', () => {
    expect(FORKED).not.toContain('writing-plans-prescriptive')
  })

  it('SDD ya no nombra a writing-plans a secas como destino de la rama «no plan»', () => {
    const s = read('subagent-driven-development', 'SKILL.md')
    expect(s).not.toMatch(/control-tower-loop:writing-plans[^-]/)
  })

  it('la skill impone la literalidad y la convención de nombre que el gate de --release busca', () => {
    const s = read('writing-plans-prescriptive', 'SKILL.md')
    expect(s).toContain('Current state (')
    expect(s).toContain('issue-<n>-')
    expect(s).toContain('--check-plan')
  })

  // F-jjponz-3 — mientras el gate leía el árbol en --release, un plan que
  // modificaba un fichero existente solo podía liberar reetiquetando sus
  // citas como prosa, y eso las saca de la comprobación en silencio. Con las
  // citas ya verificables contra la base, la skill tiene que decir las dos
  // cosas: que se cita con normalidad, y que reetiquetar no es una salida.
  it('dice dónde se verifica cada cita y prohíbe reetiquetarlas para esquivar el gate', () => {
    const s = read('writing-plans-prescriptive', 'SKILL.md')
    expect(s).toMatch(/base of the branch/i)
    expect(s).toMatch(/never relabel/i)
  })

  // F-jjponz-4 — la skill ordenaba pegar "the complete final content" de cada
  // fichero, y eso produjo un plan de 74k caracteres con el 65% de código, con
  // cinco defectos que viajaron pegados. La doctrina nueva vive en la prosa,
  // pero los NÚMEROS los manda plan-contract.js: si divergen, el agente escribe
  // planes que el validador rechaza y nadie sabe cuál de los dos manda.
  it('enumera los cuatro roles de bloque', () => {
    const s = read('writing-plans-prescriptive', 'SKILL.md')
    for (const rol of ['Current state (', 'Contract (', 'Call site (', 'Final text (']) {
      expect(s).toContain(rol)
    }
  })

  it('sus presupuestos son los del validador: la prosa y el código no pueden divergir', () => {
    const s = read('writing-plans-prescriptive', 'SKILL.md')
    const numeros = [...Object.values(ROLE_BUDGETS), CODE_BUDGETS.task, CODE_BUDGETS.chars]
    for (const n of numeros) expect(s).toContain(String(n))
  })

  it('dice que cada TAREA cabe en un folio A4, y que si no cabe la tarea son dos', () => {
    const s = read('writing-plans-prescriptive', 'SKILL.md')
    expect(s).toMatch(/one A4 page/i)
    expect(s).toMatch(/the task is two/i)
    // Y no vuelve a pedir lo que el agente NO puede hacer desde un issue
    // congelado: partir el slice.
    expect(s).not.toMatch(/the slice is two/i)
  })

  it('la doctrina del volcado ya no está', () => {
    const s = read('writing-plans-prescriptive', 'SKILL.md')
    expect(s).not.toMatch(/paste the code the plan shows/i)
    expect(s).not.toMatch(/complete final content/i)
  })

  it('dice que la configuración va en prosa y que un test va por nombre y aserción', () => {
    const s = read('writing-plans-prescriptive', 'SKILL.md')
    expect(s).toMatch(/configuration/i)
    expect(s).toMatch(/never appears as a block/i)
  })

  it('el template no pide el estado final completo y sus huecos nombran los roles', () => {
    const t = read('writing-plans-prescriptive', 'plan-template.md')
    expect(t).not.toMatch(/the complete final state/i)
    expect(t).toContain('Contract (')
    expect(t).toContain('No code — ')
  })
})

// F-jjponz-4 — costura 5. La selección de modelo de SDD daba por hecho que la
// tarea traía el código completo ("transcription plus testing") y por eso
// mandaba esas tareas al tier más barato. Desde que el plan lleva contratos y
// no cuerpos, NINGUNA tarea es transcripción: ese atajo enrutaría al modelo más
// barato justo el eslabón que ahora escribe el código.
describe('costura 5 — SDD ya no supone que la tarea trae el código completo', () => {
  const skill = () => read('subagent-driven-development', 'SKILL.md')

  it('el atajo de "transcripción" ya no existe', () => {
    // Frágil y DECLARADO, mismo motivo que las costuras 1 y 2: la prosa nueva
    // dice "never transcription", así que ensanchar la prohibición a
    // /transcription/i marcaría como fallo esa misma negación que cierra la
    // costura. Se deja la frase concreta del atajo viejo.
    expect(skill()).not.toMatch(/contains the complete code to write/i)
  })

  it('el suelo del implementador es el tier intermedio, y se dice por qué', () => {
    const s = skill()
    expect(s).toMatch(/mid-tier model as the floor/i)
    expect(s).toMatch(/contract/i)
  })

  it('FORK.md la documenta como costura, para que un cherry-pick no la pise', () => {
    const fork = readFileSync(join(SKILLS, 'FORK.md'), 'utf8')
    expect(fork).toMatch(/costura 5/i)
    expect(fork).toMatch(/subagent-driven-development/)
  })
})

describe('costura 3 — finishing-a-development-branch en repo gobernado: PR + release + PARAR', () => {
  const skill = () => read('finishing-a-development-branch', 'SKILL.md')

  it('detecta el despacho de CT por .agent/SLICE.md y no ofrece menú', () => {
    // Antes esto comprobaba las dos cadenas SUELTAS, en cualquier parte del
    // fichero: un señuelo podía dejarlas sin relación entre sí (mencionar
    // '.agent/SLICE.md' en un sitio y '--release' en otro, sin que la
    // detección llevara a "no hay menú") y aun así pasar. Ahora se exige la
    // propiedad que el nombre del test promete, en una sola frase y en el
    // mismo bloque: que detectar el fichero declare "no menu", y que el
    // camino fijo que sigue incluya el `--release`.
    const s = skill()
    expect(s).toMatch(/\.agent\/SLICE\.md`?\s+exists,\s+there is no menu/i)
    expect(s).toMatch(/no menu[\s\S]{0,300}--release/i)
  })

  it('el merge queda explícitamente en manos humanas', () => {
    expect(skill()).toMatch(/merge is (a )?human/i)
  })
})

// F39 — costura 6. `prompts/task-implementer.md` ya no lleva el ciclo de TDD
// (Test-Driven Development, desarrollo guiado por pruebas) escrito dentro:
// carga la skill forkeada. Un cherry-pick de upstream sobre
// test-driven-development ahora cambia el comportamiento del implementador de
// `ct-step`, que antes era inmune por no depender de ninguna skill del fork.
describe('costura 6 — el implementador de ct-step carga la skill del fork, no la de upstream', () => {
  const prompt = () => readFileSync(join(ROOT, 'prompts', 'task-implementer.md'), 'utf8')

  it('costura 6: el implementador carga la skill del plugin, no la de upstream', () => {
    const p = prompt()
    expect(p).toContain('control-tower-loop:test-driven-development')
    // Prohibición amplia y no el literal `superpowers:`: lo que se vigila es
    // que el implementador no acabe colgando de upstream por NINGUNA vía —
    // ni el prefijo de skill, ni una URL (github.com/obra/superpowers-skills),
    // ni el nombre del proyecto suelto en prosa. El literal con dos puntos
    // deja pasar cualquiera de esas otras formas.
    expect(p).not.toMatch(/superpowers/i)
  })
})
