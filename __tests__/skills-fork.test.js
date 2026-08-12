import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
})

describe('costura 3 — finishing-a-development-branch en repo gobernado: PR + release + PARAR', () => {
  const skill = () => read('finishing-a-development-branch', 'SKILL.md')

  it('detecta el despacho de CT por .agent/SLICE.md y no ofrece menú', () => {
    const s = skill()
    expect(s).toContain('.agent/SLICE.md')
    expect(s).toContain('--release')
  })

  it('el merge queda explícitamente en manos humanas', () => {
    expect(skill()).toMatch(/merge is (a )?human/i)
  })
})
