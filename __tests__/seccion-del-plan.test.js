import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..')
const TASK_BRIEF = join(REPO_ROOT, 'skills', 'subagent-driven-development', 'scripts', 'task-brief')
const CT_STEP = join(REPO_ROOT, 'scripts', 'ct-step.mjs')
const HEADING = '### Desired end state'
const FENCE = '```'

class TheRuleWrittenInJavaScript {
  static async load() {
    const source = readFileSync(CT_STEP, 'utf8').split('\n')
    const opening = source.findIndex((line) => line.startsWith('function seccionDelPlan('))
    if (opening === -1) throw new Error(`ct-step.mjs ya no declara seccionDelPlan: la copia que este test mide no está donde dice`)
    const closing = source.findIndex((line, i) => i > opening && line === '}')
    const body = source.slice(opening, closing + 1).join('\n')
    const module = await import(`data:text/javascript,${encodeURIComponent(`export ${body}`)}`)
    return module.seccionDelPlan
  }
}

class TheRuleWrittenInAwk {
  constructor(dir) {
    this.dir = dir
  }

  extract(planPath) {
    const brief = join(this.dir, 'brief.md')
    execFileSync(TASK_BRIEF, ['--with-plan-context', planPath, '1', brief], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const lines = readFileSync(brief, 'utf8').split('\n')
    const endOfTheFirstQuotedBlock = lines.findIndex((line, i) => line.startsWith('>') && !(lines[i + 1] ?? '').startsWith('>'))
    const startOfTheSecondQuotedBlock = lines.findIndex((line, i) => i > endOfTheFirstQuotedBlock && line.startsWith('>'))
    if (endOfTheFirstQuotedBlock === -1 || startOfTheSecondQuotedBlock === -1) {
      throw new Error('task-brief ya no envuelve la sección entre dos bloques citados: este test no sabe recortarla')
    }
    return lines.slice(endOfTheFirstQuotedBlock + 1, startOfTheSecondQuotedBlock).join('\n').trim()
  }
}

class PlanMother {
  static aSectionClosedByTheNextHeadingOfTheSameLevel() {
    return [
      '# Plan', '', '## 1. Context', 'algo previo', '',
      HEADING, 'El estado final del slice.', '',
      '#### Un subapartado que no cierra la sección', 'sigue dentro', '',
      '## 2. Closed decisions', 'D-1: fuera de la sección', '',
      ...PlanMother.#aTaskSoTaskBriefHasSomethingToExtract(),
    ].join('\n')
  }

  static aSectionWhoseFencedBlockCarriesSomethingThatLooksLikeAHeading() {
    return [
      '# Plan', '',
      HEADING, 'El estado final del slice.', '',
      FENCE, '## esto no es un encabezado, es texto dentro de un cercado', '# ni esto', FENCE,
      'la línea de después del cercado', '',
      '## 2. Closed decisions', 'D-1: fuera de la sección', '',
      ...PlanMother.#aTaskSoTaskBriefHasSomethingToExtract(),
    ].join('\n')
  }

  static aPlanThatNeverDeclaredTheSection() {
    return [
      '# Plan', '', '## 1. Context', 'sin estado final declarado', '',
      ...PlanMother.#aTaskSoTaskBriefHasSomethingToExtract(),
    ].join('\n')
  }

  static aSectionDeclaredTwiceWhereOnlyTheFirstCounts() {
    return [
      '# Plan', '',
      HEADING, 'la primera, que es la que vale', '',
      '## 2. Closed decisions', 'D-1: fuera', '',
      HEADING, 'la segunda, que nadie debería leer', '',
      ...PlanMother.#aTaskSoTaskBriefHasSomethingToExtract(),
    ].join('\n')
  }

  static aHeadingWithSomethingElseTackedOntoTheSameLine() {
    return [
      '# Plan', '',
      `${HEADING} (v2)`, 'el prefijo basta para encajar', '',
      '## 2. Closed decisions', 'D-1: fuera', '',
      ...PlanMother.#aTaskSoTaskBriefHasSomethingToExtract(),
    ].join('\n')
  }

  static #aTaskSoTaskBriefHasSomethingToExtract() {
    return ['## Task 1: hacer algo', '**Files:** a.js', '']
  }
}

let seccionDelPlan
let dir
let awk

beforeAll(async () => { seccionDelPlan = await TheRuleWrittenInJavaScript.load() })
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'seccion-del-plan-')); awk = new TheRuleWrittenInAwk(dir) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('la misma regla escrita dos veces: extract_section en awk y seccionDelPlan en JavaScript', () => {
  const planes = [
    ['a_section_closed_by_the_next_heading_of_the_same_level', PlanMother.aSectionClosedByTheNextHeadingOfTheSameLevel()],
    ['a_fenced_block_carrying_something_that_looks_like_a_heading', PlanMother.aSectionWhoseFencedBlockCarriesSomethingThatLooksLikeAHeading()],
    ['a_plan_that_never_declared_the_section', PlanMother.aPlanThatNeverDeclaredTheSection()],
    ['a_section_declared_twice_where_only_the_first_counts', PlanMother.aSectionDeclaredTwiceWhereOnlyTheFirstCounts()],
    ['a_heading_with_something_else_tacked_onto_the_same_line', PlanMother.aHeadingWithSomethingElseTackedOntoTheSameLine()],
  ]

  it.each(planes)('las dos implementaciones dicen lo mismo sobre %s', (_nombre, plan) => {
    const planPath = join(dir, 'plan.md')
    writeFileSync(planPath, plan)

    expect(seccionDelPlan(plan, HEADING).trim()).toBe(awk.extract(planPath))
  })

  it('el recorte de la salida de task-brief no es vacío, o los cinco casos pasarían por comparar nada con nada', () => {
    const planPath = join(dir, 'plan.md')
    writeFileSync(planPath, PlanMother.aSectionClosedByTheNextHeadingOfTheSameLevel())

    expect(awk.extract(planPath)).toContain('El estado final del slice.')
    expect(awk.extract(planPath)).not.toContain('D-1: fuera de la sección')
  })

  it('el verbo que pega la sección en el paquete de reconciliación es el mismo que este test mide', () => {
    expect(readFileSync(CT_STEP, 'utf8')).toContain("seccionDelPlan(planText, '### Desired end state')")
  })
})
