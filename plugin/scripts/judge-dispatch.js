import { join } from 'node:path'
import { REVIEW_TOKEN_LABEL } from './step-contracts.js'

export class JudgeRun {
  constructor({ caseName, attempt, cwd, argv, prompt, briefPath, packagePath, verdictPath }) {
    this.caseName = caseName
    this.attempt = attempt
    this.cwd = cwd
    this.argv = Object.freeze([...argv])
    this.prompt = prompt
    this.briefPath = briefPath
    this.packagePath = packagePath
    this.verdictPath = verdictPath
    Object.freeze(this)
  }
}

export class RunPaths {
  static AGENT_DIRECTORY = '.agent'

  constructor({ issue, task }) {
    this.issue = issue
    this.task = task
    Object.freeze(this)
  }

  get runDirectory() {
    return join(RunPaths.AGENT_DIRECTORY, `run-${this.issue}`)
  }

  get brief() {
    return join(this.runDirectory, `task-${this.task}-brief.md`)
  }

  get reviewPackage() {
    return join(this.runDirectory, `task-${this.task}-review.diff`)
  }

  get verdict() {
    return join(this.runDirectory, `task-${this.task}-verdict.json`)
  }
}

export class JudgeDispatch {
  static PERMISSION_MODE = 'acceptEdits'

  constructor({ agent, pluginRoot, budgetUsd }) {
    if (!(Number.isFinite(budgetUsd) && budgetUsd > 0)) {
      throw new Error(`budgetUsd must be a positive number, got ${JSON.stringify(budgetUsd)}`)
    }
    this.agent = agent
    this.pluginRoot = pluginRoot
    this.budgetUsd = budgetUsd
    Object.freeze(this)
  }

  compose({ benchCase, attempt, runDirectory }) {
    const paths = new RunPaths({ issue: benchCase.issue, task: benchCase.task })
    const prompt = this.#promptFor({ benchCase, paths })
    return new JudgeRun({
      caseName: benchCase.name,
      attempt,
      cwd: runDirectory,
      argv: [
        '-p', prompt,
        '--output-format', 'json',
        '--strict-mcp-config',
        '--no-session-persistence',
        '--permission-mode', JudgeDispatch.PERMISSION_MODE,
        '--max-budget-usd', String(this.budgetUsd),
        '--plugin-dir', this.pluginRoot,
        '--agents', JSON.stringify(this.agent.toClaudeAgents()),
        '--agent', this.agent.name,
      ],
      prompt,
      briefPath: join(runDirectory, paths.brief),
      packagePath: join(runDirectory, paths.reviewPackage),
      verdictPath: join(runDirectory, paths.verdict),
    })
  }

  #promptFor({ benchCase, paths }) {
    return [
      `Juzga la tarea ${benchCase.task}/${benchCase.tasksTotal} del issue #${benchCase.issue}. Sus controles ya corrieron y pasaron.`,
      `  - el paquete de revisión: ${paths.reviewPackage}`,
      `  - el brief de la tarea: ${paths.brief}`,
      '  - los logs de los controles, YA en verde, por si los quiere: (ninguno)',
      `  - escribe tu veredicto en: ${paths.verdict}`,
      `  - y COPIA en tu veredicto, campo "review_token", el "${REVIEW_TOKEN_LABEL}:" con el que abre ese paquete: es lo que hace comprobable que tu veredicto es sobre ESE código`,
    ].join('\n')
  }
}

export class MalformedClaudeAnswer extends Error {
  constructor(detail) {
    super(`the answer of claude -p cannot be read: ${detail}`)
    this.detail = detail
  }
}

export class ClaudeAnswer {
  constructor({ costUsd, isError, result }) {
    this.costUsd = costUsd
    this.isError = isError
    this.result = result
    Object.freeze(this)
  }

  static parse(stdout) {
    let raw
    try {
      raw = JSON.parse(stdout)
    } catch {
      throw new MalformedClaudeAnswer('stdout is not JSON; was --output-format json given?')
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MalformedClaudeAnswer('stdout is not a JSON object')
    if (typeof raw.total_cost_usd !== 'number') throw new MalformedClaudeAnswer('total_cost_usd is missing or not a number')
    if (typeof raw.is_error !== 'boolean') throw new MalformedClaudeAnswer('is_error is missing or not a boolean')
    return new ClaudeAnswer({
      costUsd: raw.total_cost_usd,
      isError: raw.is_error,
      result: typeof raw.result === 'string' ? raw.result : '',
    })
  }
}
