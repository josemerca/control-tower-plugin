import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JUDGE_TOOLS, REVIEW_TOKEN_LABEL, VERDICT_RULES, reviewToken } from '../scripts/step-contracts.js'
import { AgentDefinition, MalformedAgentDefinition } from '../scripts/judge-agent-definition.js'
import { Agreement, BenchCase, BenchCases, CorruptCase, ExpectedVerdict, UnknownCase } from '../scripts/judge-bench-case.js'
import { BenchWorkspace } from '../scripts/judge-bench-workspace.js'
import { BenchReport, JudgeBench, RunOutcome, RunResult, SeverityCount } from '../scripts/judge-bench.js'
import { ClaudeAnswer, JudgeDispatch, MalformedClaudeAnswer, RunPaths } from '../scripts/judge-dispatch.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const here = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(here, '..')
const FIXTURES = join(here, 'fixtures', 'judge-bench')
const AGENT_PATH = join(PLUGIN_ROOT, 'agents', 'ct-judge.md')

class Cases {
  static all() {
    return BenchCases.load(FIXTURES)
  }

  static named(name) {
    return BenchCases.load(FIXTURES, { only: name })[0]
  }

  static missingTest() {
    return Cases.named('test-inexistente-en-verde')
  }

  static race() {
    return Cases.named('concurrencia-sin-hallazgo')
  }

  static correct() {
    return Cases.named('tarea-correcta')
  }
}

class Agents {
  static judge() {
    return AgentDefinition.parse(readFileSync(AGENT_PATH, 'utf8'))
  }

  static text({ frontmatter = 'name: bench-judge\ndescription: judges\ntools: Read, Write\nmodel: opus', body = 'You judge.' } = {}) {
    return `---\n${frontmatter}\n---\n${body}\n`
  }
}

class Verdicts {
  static rubric() {
    return VERDICT_RULES.map((rule) => ({ rule, result: 'measured', outcome: 'conforme' }))
  }

  static finding(rule, severity = 'high') {
    return { rule, severity, what: 'the defect', path: 'src/a.js', line: 3, evidence: 'the line' }
  }

  static fail(benchCase, rules, { severity = 'high' } = {}) {
    return JSON.stringify({ ruling: 'FAIL', review_token: benchCase.token, rubric: Verdicts.rubric(), findings: rules.map((rule) => Verdicts.finding(rule, severity)) })
  }

  static pass(benchCase, { findings = [] } = {}) {
    return JSON.stringify({ ruling: 'PASS', review_token: benchCase.token, rubric: Verdicts.rubric(), findings })
  }

  static withoutRubric(benchCase) {
    return JSON.stringify({ ruling: 'FAIL', review_token: benchCase.token, findings: [] })
  }

  static withAnotherToken() {
    return JSON.stringify({ ruling: 'PASS', review_token: reviewToken('another diff'), rubric: Verdicts.rubric(), findings: [] })
  }
}

class ClaudeSaid {
  static done({ costUsd = 0.25 } = {}) {
    return { code: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'verdict written', total_cost_usd: costUsd }), stderr: '' }
  }

  static erroredInside({ costUsd = 0.05 } = {}) {
    return { code: 0, stdout: JSON.stringify({ type: 'result', is_error: true, result: 'budget exceeded', total_cost_usd: costUsd }), stderr: '' }
  }

  static crashed() {
    return { code: 1, stdout: '', stderr: 'Error: not logged in\nrun claude login' }
  }
}

class JudgeAnswer {
  static writing(verdictText, said = ClaudeSaid.done()) {
    return { verdictText, said }
  }

  static writingNothing(said = ClaudeSaid.done()) {
    return { verdictText: null, said }
  }
}

class ScriptedJudge {
  constructor(answers) {
    this.answers = answers
    this.asked = []
  }

  static keyOf(judgeRun) {
    return `${judgeRun.caseName}#${judgeRun.attempt}`
  }

  get forJudgeRun() {
    return (judgeRun) => {
      const key = ScriptedJudge.keyOf(judgeRun)
      this.asked.push(judgeRun)
      if (!Object.hasOwn(this.answers, key)) throw new Error(`nobody wrote an answer for: ${key}`)
      const { verdictText, said } = this.answers[key]
      if (verdictText !== null) writeFileSync(judgeRun.verdictPath, verdictText)
      return said
    }
  }
}

class Benches {
  static YARDSTICK = '\n---\n\n## Vara de ct: conventions/defects.md\n\nno defects\n'

  static over({ root, answers, budgetUsd = 3 }) {
    const judge = new ScriptedJudge(answers)
    const bench = new JudgeBench({
      dispatch: new JudgeDispatch({ agent: Agents.judge(), pluginRoot: PLUGIN_ROOT, budgetUsd }),
      runner: judge.forJudgeRun,
      workspace: new BenchWorkspace({ root }),
      yardstick: Benches.YARDSTICK,
      agentPath: AGENT_PATH,
    })
    return { bench, judge }
  }
}

describe('the bench cases on disk', () => {
  it('the three incidents of the catalogue are there, each with the ruling the incident calls for', () => {
    const byName = Object.fromEntries(Cases.all().map((benchCase) => [benchCase.name, benchCase]))
    expect(byName['test-inexistente-en-verde'].expected.ruling).toBe('FAIL')
    expect(byName['test-inexistente-en-verde'].expected.mustFind).toEqual(['asercion-tdd'])
    expect(byName['concurrencia-sin-hallazgo'].expected.ruling).toBe('FAIL')
    expect(byName['concurrencia-sin-hallazgo'].expected.mustFind).toEqual(['decisiones-cerradas'])
    expect(byName['tarea-correcta'].expected.ruling).toBe('PASS')
    expect(byName['tarea-correcta'].expected.mustFind).toEqual([])
  })

  it('every package declares the sha256 of its own diff section, the way ct-step writes it', () => {
    for (const benchCase of Cases.all()) {
      expect(benchCase.token).toBe(reviewToken(BenchCase.diffOf(benchCase.reviewPackage)))
    }
  })

  it('every case carries the working tree the implementer left, with the files the package names as touched', () => {
    for (const benchCase of Cases.all()) {
      const touched = /## Rutas tocadas\n([\s\S]*?)\n\n## Diff/.exec(benchCase.reviewPackage)[1].split('\n').map((line) => line.replace(/^- /, ''))
      expect(touched.length).toBeGreaterThan(0)
      for (const path of touched) expect(existsSync(join(benchCase.repoDirectory, path))).toBe(true)
    }
  })

  it('every brief carries the markers the judge is told to read', () => {
    for (const benchCase of Cases.all()) {
      for (const marker of ['### Desired end state', '### Out of scope', '## 2. Closed decisions', '## 3. Reference patterns', '**Objective:**', '**Files:**', '**TDD:**', '**Tests:**', '**Verification:**']) {
        expect(benchCase.brief, `${benchCase.name} lacks ${marker}`).toContain(marker)
      }
    }
  })

  it('the missing-test case declares its TDD test as a todo with no body, which is what node --test reports green', () => {
    const benchCase = Cases.missingTest()
    const tddTest = /\*\*TDD:\*\* `it\('([^']+)'\)`/.exec(benchCase.brief)[1]
    expect(benchCase.reviewPackage).toContain(`+  it.todo('${tddTest}')`)
  })

  it('the race case checks existence and then writes, against a closed decision that names that exact sequence as forbidden', () => {
    const benchCase = Cases.race()
    expect(benchCase.reviewPackage).toContain('+    if (existsSync(lock)) {')
    expect(benchCase.reviewPackage).toContain("+    writeFileSync(lock, String(pid))")
    expect(benchCase.brief).toContain("Nunca `existsSync` seguido de una escritura")
  })
})

describe('ExpectedVerdict', () => {
  it('an unknown key in expected.json is a rejection, not a field to ignore', () => {
    expect(() => ExpectedVerdict.parse('{"ruling":"PASS","must_find":[],"severity":"high"}')).toThrow(/keys the bench does not read: severity/)
  })

  it('a rule the rubric does not have cannot be expected', () => {
    expect(() => ExpectedVerdict.parse('{"ruling":"FAIL","must_find":["seguridad"]}')).toThrow(/rules the rubric does not have: seguridad/)
  })

  it('a ruling that is not PASS or FAIL cannot be expected', () => {
    expect(() => ExpectedVerdict.parse('{"ruling":"MAYBE","must_find":[]}')).toThrow(/ruling must be PASS or FAIL/)
  })

  it('a verdict with the expected ruling and a finding under every expected rule is a hit', () => {
    const expected = new ExpectedVerdict({ ruling: 'FAIL', mustFind: ['asercion-tdd'], incident: '' })
    const comparison = expected.compare({ ruling: 'FAIL', findings: [Verdicts.finding('asercion-tdd'), Verdicts.finding('alcance', 'low')] })
    expect(comparison.agreement).toBe(Agreement.HIT)
  })

  it('the right ruling reached through another rule is not a hit, and the detail names both rules', () => {
    const expected = new ExpectedVerdict({ ruling: 'FAIL', mustFind: ['asercion-tdd'], incident: '' })
    const comparison = expected.compare({ ruling: 'FAIL', findings: [Verdicts.finding('alcance')] })
    expect(comparison.agreement).toBe(Agreement.RULE_NOT_FOUND)
    expect(comparison.detail).toBe('no finding under asercion-tdd; the judge reported alcance')
  })

  it('a different ruling is a miss before any rule is looked at', () => {
    const expected = new ExpectedVerdict({ ruling: 'FAIL', mustFind: ['asercion-tdd'], incident: '' })
    const comparison = expected.compare({ ruling: 'PASS', findings: [Verdicts.finding('asercion-tdd', 'low')] })
    expect(comparison.agreement).toBe(Agreement.RULING_DIFFERS)
    expect(comparison.detail).toBe('expected FAIL, the judge ruled PASS')
  })
})

describe('BenchCases', () => {
  let root

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'judge-bench-cases-'))
  })

  afterEach(() => rmSyncBestEffort(root))

  it('asking for a case that does not exist names the ones that do', () => {
    expect(() => BenchCases.load(FIXTURES, { only: 'nope' })).toThrow(UnknownCase)
    expect(() => BenchCases.load(FIXTURES, { only: 'nope' })).toThrow(/concurrencia-sin-hallazgo, tarea-correcta, test-inexistente-en-verde/)
  })

  it('a package whose token is not the sha256 of its diff is a corrupt case, not a case the judge can be measured on', () => {
    const benchCase = Cases.correct()
    const forged = benchCase.reviewPackage.replace(/^Review token: [0-9a-f]{64}$/m, `Review token: ${reviewToken('some other diff')}`)
    const directory = join(root, 'forjado')
    cpSync(benchCase.directory, directory, { recursive: true })
    writeFileSync(join(directory, 'package.md'), forged)
    expect(() => BenchCase.load(directory, 'forjado')).toThrow(CorruptCase)
    expect(() => BenchCase.load(directory, 'forjado')).toThrow(/not the sha256 of its diff section/)
  })
})

describe('AgentDefinition', () => {
  it('reads from ct-judge.md the same tools step-contracts announces and the model the frontmatter fixes', () => {
    const agent = Agents.judge()
    expect(agent.name).toBe('ct-judge')
    expect(agent.tools).toEqual(JUDGE_TOOLS.split(', '))
    expect(agent.model).toBe('opus')
    expect(agent.prompt.startsWith('You judge one task of a slice.')).toBe(true)
  })

  it('turns the file into the agents object claude -p takes, tools as a list', () => {
    const agent = AgentDefinition.parse(Agents.text())
    expect(agent.toClaudeAgents()).toEqual({ 'bench-judge': { description: 'judges', prompt: 'You judge.', tools: ['Read', 'Write'], model: 'opus' } })
  })

  it('a file without model cannot be dispatched: the bench never inherits the model of whoever runs it', () => {
    expect(() => AgentDefinition.parse(Agents.text({ frontmatter: 'name: x\ntools: Read' }))).toThrow(MalformedAgentDefinition)
    expect(() => AgentDefinition.parse(Agents.text({ frontmatter: 'name: x\ntools: Read' }))).toThrow(/lacks model/)
  })

  it('a file with no frontmatter is not an agent', () => {
    expect(() => AgentDefinition.parse('You judge.')).toThrow(/does not open with a --- frontmatter/)
  })
})

describe('JudgeDispatch', () => {
  const dispatch = () => new JudgeDispatch({ agent: Agents.judge(), pluginRoot: PLUGIN_ROOT, budgetUsd: 2.5 })

  it('dispatches claude -p as the agent the file declares, with its tools and model, reading cost as json and without foreign MCP servers', () => {
    const judgeRun = dispatch().compose({ benchCase: Cases.correct(), attempt: 1, runDirectory: '/work/tarea-correcta/1' })
    const argv = [...judgeRun.argv]
    expect(argv.slice(0, 2)).toEqual(['-p', judgeRun.prompt])
    expect(argv).toContain('--strict-mcp-config')
    expect(argv[argv.indexOf('--output-format') + 1]).toBe('json')
    expect(argv[argv.indexOf('--agent') + 1]).toBe('ct-judge')
    expect(argv[argv.indexOf('--max-budget-usd') + 1]).toBe('2.5')
    expect(argv[argv.indexOf('--plugin-dir') + 1]).toBe(PLUGIN_ROOT)
    const agents = JSON.parse(argv[argv.indexOf('--agents') + 1])
    expect(agents['ct-judge'].tools).toEqual(JUDGE_TOOLS.split(', '))
    expect(agents['ct-judge'].model).toBe('opus')
    expect(agents['ct-judge'].prompt).toBe(Agents.judge().prompt)
  })

  it('the prompt tells the judge the same three paths ct-step next announces and where the token comes from', () => {
    const judgeRun = dispatch().compose({ benchCase: Cases.correct(), attempt: 2, runDirectory: '/work/tarea-correcta/2' })
    const paths = new RunPaths({ issue: 52, task: 3 })
    expect(judgeRun.prompt).toContain(`el paquete de revisión: ${paths.reviewPackage}`)
    expect(judgeRun.prompt).toContain(`el brief de la tarea: ${paths.brief}`)
    expect(judgeRun.prompt).toContain(`escribe tu veredicto en: ${paths.verdict}`)
    expect(judgeRun.prompt).toContain(`"${REVIEW_TOKEN_LABEL}:"`)
    expect(judgeRun.verdictPath).toBe('/work/tarea-correcta/2/.agent/run-52/task-3-verdict.json')
    expect(judgeRun.cwd).toBe('/work/tarea-correcta/2')
  })

  it('writes in the judge room the paths ct-step uses for a run of that issue and task', () => {
    const paths = new RunPaths({ issue: 31, task: 2 })
    expect(paths.brief).toBe('.agent/run-31/task-2-brief.md')
    expect(paths.reviewPackage).toBe('.agent/run-31/task-2-review.diff')
    expect(paths.verdict).toBe('.agent/run-31/task-2-verdict.json')
  })

  it('a budget that is not a positive number is refused before anything is dispatched', () => {
    expect(() => new JudgeDispatch({ agent: Agents.judge(), pluginRoot: PLUGIN_ROOT, budgetUsd: 0 })).toThrow(/budgetUsd must be a positive number/)
  })
})

describe('ClaudeAnswer', () => {
  it('reads the cost and the error flag off the json result of claude -p', () => {
    const answer = ClaudeAnswer.parse(ClaudeSaid.done({ costUsd: 1.5 }).stdout)
    expect(answer.costUsd).toBe(1.5)
    expect(answer.isError).toBe(false)
  })

  it('a result without total_cost_usd is unreadable rather than free', () => {
    expect(() => ClaudeAnswer.parse('{"is_error":false,"result":"ok"}')).toThrow(MalformedClaudeAnswer)
    expect(() => ClaudeAnswer.parse('{"is_error":false,"result":"ok"}')).toThrow(/total_cost_usd is missing/)
  })

  it('text output is unreadable and says which flag was missing', () => {
    expect(() => ClaudeAnswer.parse('I wrote the verdict.')).toThrow(/--output-format json/)
  })
})

describe('JudgeBench', () => {
  let root

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'judge-bench-'))
  })

  afterEach(() => rmSyncBestEffort(root))

  it('prepares each run with the working tree of the case, the brief closed by the ct yardstick and the package verbatim', () => {
    const { bench } = Benches.over({ root, answers: {} })
    const benchCase = Cases.missingTest()
    const [{ judgeRun }] = bench.plan({ cases: [benchCase], runs: 1 })
    expect(judgeRun.cwd).toBe(join(root, 'test-inexistente-en-verde', '1'))
    expect(readFileSync(join(judgeRun.cwd, 'test', 'verdict-file.js'), 'utf8')).toContain("it.todo('an unreadable verdict file is a discard, not a crash')")
    expect(readFileSync(judgeRun.briefPath, 'utf8')).toBe(benchCase.brief + Benches.YARDSTICK)
    expect(readFileSync(judgeRun.packagePath, 'utf8')).toBe(benchCase.reviewPackage)
    expect(existsSync(judgeRun.verdictPath)).toBe(false)
  })

  it('plans one run per case and attempt, each in its own directory, without asking claude anything', () => {
    const { bench, judge } = Benches.over({ root, answers: {} })
    const planned = bench.plan({ cases: Cases.all(), runs: 2 })
    expect(planned.map(({ judgeRun }) => ScriptedJudge.keyOf(judgeRun))).toEqual([
      'concurrencia-sin-hallazgo#1', 'concurrencia-sin-hallazgo#2',
      'tarea-correcta#1', 'tarea-correcta#2',
      'test-inexistente-en-verde#1', 'test-inexistente-en-verde#2',
    ])
    expect(new Set(planned.map(({ judgeRun }) => judgeRun.cwd)).size).toBe(6)
    expect(judge.asked).toEqual([])
  })

  it('a FAIL with a finding under the expected rule is a hit, and its cost is what claude declared', () => {
    const benchCase = Cases.missingTest()
    const { bench } = Benches.over({ root, answers: { 'test-inexistente-en-verde#1': JudgeAnswer.writing(Verdicts.fail(benchCase, ['asercion-tdd']), ClaudeSaid.done({ costUsd: 0.7 })) } })
    const report = bench.run({ cases: [benchCase], runs: 1 })
    expect(report.results.map((result) => [result.outcome, result.costUsd])).toEqual([[RunOutcome.HIT, 0.7]])
    expect(report.results[0].severities).toEqual(new SeverityCount({ high: 1 }))
    expect(report.allHit).toBe(true)
  })

  it('a PASS on the missing-test case is a miss that says which ruling was expected', () => {
    const benchCase = Cases.missingTest()
    const { bench } = Benches.over({ root, answers: { 'test-inexistente-en-verde#1': JudgeAnswer.writing(Verdicts.pass(benchCase)) } })
    const [result] = bench.run({ cases: [benchCase], runs: 1 }).results
    expect(result.outcome).toBe(RunOutcome.MISS)
    expect(result.detail).toBe('expected FAIL, the judge ruled PASS')
  })

  it('a FAIL for the wrong reason is a miss, not a hit: the rule is what the telemetry counts', () => {
    const benchCase = Cases.race()
    const { bench } = Benches.over({ root, answers: { 'concurrencia-sin-hallazgo#1': JudgeAnswer.writing(Verdicts.fail(benchCase, ['alcance'])) } })
    const [result] = bench.run({ cases: [benchCase], runs: 1 }).results
    expect(result.outcome).toBe(RunOutcome.MISS)
    expect(result.detail).toBe('no finding under decisiones-cerradas; the judge reported alcance')
  })

  it('a PASS with only low findings on the correct case is a hit, and the lows are counted', () => {
    const benchCase = Cases.correct()
    const { bench } = Benches.over({ root, answers: { 'tarea-correcta#1': JudgeAnswer.writing(Verdicts.pass(benchCase, { findings: [Verdicts.finding('test-desiderata', 'low')] })) } })
    const [result] = bench.run({ cases: [benchCase], runs: 1 }).results
    expect(result.outcome).toBe(RunOutcome.HIT)
    expect(result.severities).toEqual(new SeverityCount({ low: 1 }))
  })

  it('a judge that writes no verdict file is a discard that names the path it should have written', () => {
    const benchCase = Cases.correct()
    const { bench } = Benches.over({ root, answers: { 'tarea-correcta#1': JudgeAnswer.writingNothing() } })
    const [result] = bench.run({ cases: [benchCase], runs: 1 }).results
    expect(result.outcome).toBe(RunOutcome.DISCARDED)
    expect(result.detail).toBe(`el juez no escribió el veredicto en ${join(root, 'tarea-correcta', '1', '.agent', 'run-52', 'task-3-verdict.json')}`)
    expect(result.costUsd).toBe(0.25)
  })

  it('a verdict that does not pass VERDICT_SCHEMA is a discard with the same reason ct-step verdict would give', () => {
    const benchCase = Cases.correct()
    const { bench } = Benches.over({ root, answers: { 'tarea-correcta#1': JudgeAnswer.writing(Verdicts.withoutRubric(benchCase)) } })
    const [result] = bench.run({ cases: [benchCase], runs: 1 }).results
    expect(result.outcome).toBe(RunOutcome.DISCARDED)
    expect(result.detail).toBe('el veredicto no trae el recorrido de la rúbrica')
  })

  it('a verdict that is not JSON is a discard, not a crash of the bench', () => {
    const benchCase = Cases.correct()
    const { bench } = Benches.over({ root, answers: { 'tarea-correcta#1': JudgeAnswer.writing('```json\n{"ruling":"PASS"}\n```') } })
    const [result] = bench.run({ cases: [benchCase], runs: 1 }).results
    expect(result.outcome).toBe(RunOutcome.DISCARDED)
    expect(result.detail).toMatch(/^el veredicto no es JSON: /)
  })

  it('a verdict carrying another package token is a discard: it is not a verdict on this code', () => {
    const benchCase = Cases.correct()
    const { bench } = Benches.over({ root, answers: { 'tarea-correcta#1': JudgeAnswer.writing(Verdicts.withAnotherToken()) } })
    const [result] = bench.run({ cases: [benchCase], runs: 1 }).results
    expect(result.outcome).toBe(RunOutcome.DISCARDED)
    expect(result.detail).toMatch(/^el veredicto copia el token [0-9a-f]{12}… y el paquete declara [0-9a-f]{12}…$/)
  })

  it('claude exiting non-zero without json is a run that did not happen, with no cost to sum and the stderr tail as detail', () => {
    const benchCase = Cases.correct()
    const { bench } = Benches.over({ root, answers: { 'tarea-correcta#1': JudgeAnswer.writingNothing(ClaudeSaid.crashed()) } })
    const [result] = bench.run({ cases: [benchCase], runs: 1 }).results
    expect(result.outcome).toBe(RunOutcome.NOT_RUN)
    expect(result.costUsd).toBe(null)
    expect(result.detail).toBe('claude salió con 1 y stdout is not JSON; was --output-format json given?: Error: not logged in | run claude login')
  })

  it('claude answering is_error keeps its cost and does not read whatever verdict is on disk', () => {
    const benchCase = Cases.correct()
    const { bench } = Benches.over({ root, answers: { 'tarea-correcta#1': JudgeAnswer.writing(Verdicts.pass(benchCase), ClaudeSaid.erroredInside({ costUsd: 0.05 })) } })
    const [result] = bench.run({ cases: [benchCase], runs: 1 }).results
    expect(result.outcome).toBe(RunOutcome.NOT_RUN)
    expect(result.costUsd).toBe(0.05)
    expect(result.detail).toBe('claude salió con 0 e is_error: budget exceeded')
  })

  it('every run is asked once, in case order and attempt order, and a run nobody scripted stops the bench', () => {
    const benchCase = Cases.correct()
    const { bench } = Benches.over({ root, answers: { 'tarea-correcta#1': JudgeAnswer.writing(Verdicts.pass(benchCase)) } })
    expect(() => bench.run({ cases: [benchCase], runs: 2 })).toThrow('nobody wrote an answer for: tarea-correcta#2')
  })

  it('the report sums the cost of every run that declared one and says how many did not', () => {
    const [race, correct, missing] = [Cases.race(), Cases.correct(), Cases.missingTest()]
    const { bench } = Benches.over({
      root,
      answers: {
        'concurrencia-sin-hallazgo#1': JudgeAnswer.writing(Verdicts.fail(race, ['decisiones-cerradas']), ClaudeSaid.done({ costUsd: 1 })),
        'tarea-correcta#1': JudgeAnswer.writing(Verdicts.pass(correct), ClaudeSaid.done({ costUsd: 0.5 })),
        'test-inexistente-en-verde#1': JudgeAnswer.writingNothing(ClaudeSaid.crashed()),
      },
    })
    const report = bench.run({ cases: [race, correct, missing], runs: 1 })
    expect(report.total.knownCostUsd).toBe(1.5)
    expect(report.total.runsWithoutCost).toBe(1)
    expect(report.allHit).toBe(false)
  })
})

describe('BenchReport', () => {
  const result = (overrides) => new RunResult({
    caseName: 'tarea-correcta', attempt: 1, outcome: RunOutcome.HIT, detail: 'PASS with the expected findings',
    costUsd: 0.5, severities: new SeverityCount(), directory: '/w/tarea-correcta/1', verdict: { ruling: 'PASS' }, ...overrides,
  })

  it('renders one row per case with hit and discard rates, the severities and the cost, plus a total row', () => {
    const report = new BenchReport({
      agentPath: '/p/agents/ct-judge.md',
      results: [
        result({ caseName: 'test-inexistente-en-verde', attempt: 1, severities: new SeverityCount({ high: 1, low: 2 }), costUsd: 1, verdict: { ruling: 'FAIL' } }),
        result({ caseName: 'test-inexistente-en-verde', attempt: 2, outcome: RunOutcome.DISCARDED, detail: 'el veredicto no trae el recorrido de la rúbrica', verdict: null, costUsd: 0.5 }),
        result({ caseName: 'tarea-correcta', attempt: 1, severities: new SeverityCount({ medium: 1 }), costUsd: 0.25 }),
        result({ caseName: 'tarea-correcta', attempt: 2, costUsd: 0.25 }),
      ],
    })
    const text = report.render()
    expect(text).toContain('Banco del juez — agente: /p/agents/ct-judge.md')
    expect(text).toMatch(/caso\s+runs\s+aciertos\s+descartes\s+no ejecutados\s+high\s+medium\s+low\s+coste USD/)
    expect(text).toMatch(/test-inexistente-en-verde\s+2\s+1 \(50%\)\s+1 \(50%\)\s+0 \(0%\)\s+1\s+0\s+2\s+1\.5000/)
    expect(text).toMatch(/tarea-correcta\s+2\s+2 \(100%\)\s+0 \(0%\)\s+0 \(0%\)\s+0\s+1\s+0\s+0\.5000/)
    expect(text).toMatch(/total\s+4\s+3 \(75%\)\s+1 \(25%\)\s+0 \(0%\)\s+1\s+1\s+2\s+2\.0000/)
    expect(text).toContain('  - test-inexistente-en-verde #2: descartado — el veredicto no trae el recorrido de la rúbrica (/w/tarea-correcta/1)')
  })

  it('a report where every run hit says so instead of listing nothing', () => {
    const text = new BenchReport({ agentPath: '/p/a.md', results: [result({})] }).render()
    expect(text).toContain('Todos los runs aciertan.')
    expect(text).not.toContain('Lo que no acertó')
  })

  it('a hit or a miss carries its verdict and anything else carries none', () => {
    expect(() => result({ outcome: RunOutcome.DISCARDED, verdict: { ruling: 'PASS' } })).toThrow(/disagrees with the verdict/)
    expect(() => result({ outcome: RunOutcome.HIT, verdict: null })).toThrow(/disagrees with the verdict/)
  })
})
