import { readVerdict } from './step-contracts.js'
import { Agreement } from './judge-bench-case.js'
import { ClaudeAnswer, MalformedClaudeAnswer } from './judge-dispatch.js'

export const RunOutcome = Object.freeze({
  HIT: 'acierto',
  MISS: 'fallo',
  DISCARDED: 'descartado',
  NOT_RUN: 'no-ejecutado',
})

export class SeverityCount {
  constructor({ high = 0, medium = 0, low = 0 } = {}) {
    this.high = high
    this.medium = medium
    this.low = low
    Object.freeze(this)
  }

  static of(findings) {
    const count = { high: 0, medium: 0, low: 0 }
    for (const finding of findings) count[finding.severity] += 1
    return new SeverityCount(count)
  }

  plus(other) {
    return new SeverityCount({ high: this.high + other.high, medium: this.medium + other.medium, low: this.low + other.low })
  }
}

export class RunResult {
  constructor({ caseName, attempt, outcome, detail, costUsd, severities, directory, verdict }) {
    if (!Object.values(RunOutcome).includes(outcome)) {
      throw new Error(`outcome must be a RunOutcome member, got ${JSON.stringify(outcome)}`)
    }
    if ((outcome === RunOutcome.HIT || outcome === RunOutcome.MISS) !== (verdict !== null)) {
      throw new Error(`outcome ${outcome} disagrees with the verdict given`)
    }
    this.caseName = caseName
    this.attempt = attempt
    this.outcome = outcome
    this.detail = detail
    this.costUsd = costUsd
    this.severities = severities
    this.directory = directory
    this.verdict = verdict
    Object.freeze(this)
  }
}

export class CaseSummary {
  constructor({ caseName, results }) {
    this.caseName = caseName
    this.results = Object.freeze([...results])
    Object.freeze(this)
  }

  get runs() {
    return this.results.length
  }

  count(outcome) {
    return this.results.filter((result) => result.outcome === outcome).length
  }

  get severities() {
    return this.results.reduce((total, result) => total.plus(result.severities), new SeverityCount())
  }

  get knownCostUsd() {
    return this.results.reduce((total, result) => total + (result.costUsd ?? 0), 0)
  }

  get runsWithoutCost() {
    return this.results.filter((result) => result.costUsd === null).length
  }
}

export class BenchReport {
  constructor({ agentPath, results }) {
    this.agentPath = agentPath
    this.results = Object.freeze([...results])
    Object.freeze(this)
  }

  get cases() {
    const names = [...new Set(this.results.map((result) => result.caseName))]
    return names.map((caseName) => new CaseSummary({ caseName, results: this.results.filter((result) => result.caseName === caseName) }))
  }

  get total() {
    return new CaseSummary({ caseName: 'total', results: this.results })
  }

  get allHit() {
    return this.results.length > 0 && this.results.every((result) => result.outcome === RunOutcome.HIT)
  }

  render() {
    const rows = [...this.cases, this.total].map((summary) => BenchTable.row(summary))
    const table = BenchTable.render([BenchTable.HEADER, ...rows])
    const misses = this.results.filter((result) => result.outcome !== RunOutcome.HIT)
    const detail = misses.length
      ? ['', 'Lo que no acertó:', ...misses.map((result) => `  - ${result.caseName} #${result.attempt}: ${result.outcome} — ${result.detail} (${result.directory})`)]
      : ['', 'Todos los runs aciertan.']
    const withoutCost = this.total.runsWithoutCost
    const costNote = withoutCost ? [`Coste: ${withoutCost} run(s) sin coste legible; el total suma sólo los que lo declararon.`] : []
    return [`Banco del juez — agente: ${this.agentPath}`, '', table, ...detail, ...costNote, ''].join('\n')
  }
}

export class BenchTable {
  static HEADER = Object.freeze(['caso', 'runs', 'aciertos', 'descartes', 'no ejecutados', 'high', 'medium', 'low', 'coste USD'])

  static row(summary) {
    const rate = (n) => (summary.runs === 0 ? '0 (0%)' : `${n} (${Math.round((100 * n) / summary.runs)}%)`)
    const severities = summary.severities
    return [
      summary.caseName,
      String(summary.runs),
      rate(summary.count(RunOutcome.HIT)),
      rate(summary.count(RunOutcome.DISCARDED)),
      rate(summary.count(RunOutcome.NOT_RUN)),
      String(severities.high),
      String(severities.medium),
      String(severities.low),
      summary.knownCostUsd.toFixed(4),
    ]
  }

  static render(rows) {
    const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)))
    const line = (row) => row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd()
    return [line(rows[0]), widths.map((width) => '-'.repeat(width)).join('  '), ...rows.slice(1).map(line)].join('\n')
  }
}

export class JudgeBench {
  constructor({ dispatch, runner, workspace, yardstick, agentPath }) {
    this.dispatch = dispatch
    this.runner = runner
    this.workspace = workspace
    this.yardstick = yardstick
    this.agentPath = agentPath
    Object.freeze(this)
  }

  plan({ cases, runs }) {
    if (!(Number.isInteger(runs) && runs >= 1)) throw new Error(`runs must be a positive integer, got ${JSON.stringify(runs)}`)
    const planned = []
    for (const benchCase of cases) {
      for (let attempt = 1; attempt <= runs; attempt += 1) {
        const runDirectory = this.workspace.prepare({ benchCase, attempt, yardstick: this.yardstick })
        planned.push({ benchCase, judgeRun: this.dispatch.compose({ benchCase, attempt, runDirectory }) })
      }
    }
    return planned
  }

  run({ cases, runs, onResult = () => {} }) {
    const results = []
    for (const { benchCase, judgeRun } of this.plan({ cases, runs })) {
      const result = this.#judge({ benchCase, judgeRun })
      onResult(result)
      results.push(result)
    }
    return new BenchReport({ agentPath: this.agentPath, results })
  }

  #judge({ benchCase, judgeRun }) {
    const answer = this.runner(judgeRun)
    const base = { caseName: benchCase.name, attempt: judgeRun.attempt, directory: judgeRun.cwd }
    let claude
    try {
      claude = ClaudeAnswer.parse(answer.stdout)
    } catch (error) {
      if (!(error instanceof MalformedClaudeAnswer)) throw error
      return new RunResult({
        ...base,
        outcome: RunOutcome.NOT_RUN,
        detail: `claude salió con ${answer.code} y ${error.detail}${JudgeBench.#tail(answer.stderr)}`,
        costUsd: null,
        severities: new SeverityCount(),
        verdict: null,
      })
    }
    const withCost = { ...base, costUsd: claude.costUsd }
    if (answer.code !== 0 || claude.isError) {
      return new RunResult({
        ...withCost,
        outcome: RunOutcome.NOT_RUN,
        detail: `claude salió con ${answer.code}${claude.isError ? ' e is_error' : ''}${JudgeBench.#tail(answer.stderr || claude.result)}`,
        severities: new SeverityCount(),
        verdict: null,
      })
    }
    const discarded = (detail) => new RunResult({ ...withCost, outcome: RunOutcome.DISCARDED, detail, severities: new SeverityCount(), verdict: null })
    const text = this.workspace.verdictWrittenAt(judgeRun.verdictPath)
    if (text === null) return discarded(`el juez no escribió el veredicto en ${judgeRun.verdictPath}`)
    let structured
    try {
      structured = JSON.parse(text)
    } catch (error) {
      return discarded(`el veredicto no es JSON: ${error.message}`)
    }
    const read = readVerdict(structured)
    if (read.why) return discarded(read.why)
    if (read.verdict.review_token !== benchCase.token) {
      return discarded(`el veredicto copia el token ${read.verdict.review_token.slice(0, 12)}… y el paquete declara ${benchCase.token.slice(0, 12)}…`)
    }
    const comparison = benchCase.expected.compare(read.verdict)
    return new RunResult({
      ...withCost,
      outcome: comparison.agreement === Agreement.HIT ? RunOutcome.HIT : RunOutcome.MISS,
      detail: comparison.detail,
      severities: SeverityCount.of(read.verdict.findings),
      verdict: read.verdict,
    })
  }

  static #tail(text) {
    const trimmed = String(text ?? '').trim()
    if (trimmed === '') return ''
    const lines = trimmed.split('\n')
    return `: ${lines.slice(-3).join(' | ')}`
  }
}
