#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AgentDefinition, MalformedAgentDefinition } from './judge-agent-definition.js'
import { BenchCases, CorruptCase, UnknownCase } from './judge-bench-case.js'
import { BenchWorkspace } from './judge-bench-workspace.js'
import { JudgeBench } from './judge-bench.js'
import { JudgeDispatch } from './judge-dispatch.js'
import { PluginYardstick } from './plugin-yardstick.js'
import { shQuote } from './shquote.js'

class ExitCode {
  static ALL_HIT = 0
  static SOME_MISSED = 1
  static USAGE = 2
  static PRECONDITION = 3
}

class BenchArguments {
  static USAGE = 'uso: judge-bench.mjs --agent <ruta al .md del agente> [--runs N] [--case <nombre>] [--dry-run] [--budget-usd <n>] [--cases <dir>]'
  static DEFAULT_RUNS = 5
  static DEFAULT_BUDGET_USD = 3
  static PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
  static DEFAULT_CASES = join(BenchArguments.PLUGIN_ROOT, '__tests__', 'fixtures', 'judge-bench')

  constructor({ agentPath, runs, only, dryRun, budgetUsd, casesRoot }) {
    this.agentPath = agentPath
    this.runs = runs
    this.only = only
    this.dryRun = dryRun
    this.budgetUsd = budgetUsd
    this.casesRoot = casesRoot
    Object.freeze(this)
  }

  static parse(argv) {
    const value = (flag) => {
      const at = argv.indexOf(flag)
      if (at === -1) return undefined
      const next = argv[at + 1]
      if (typeof next !== 'string' || next.startsWith('--')) throw new Error(`${flag} necesita un valor`)
      return next
    }
    const agentPath = value('--agent')
    if (agentPath === undefined) throw new Error('falta --agent')
    const runs = value('--runs') === undefined ? BenchArguments.DEFAULT_RUNS : Number(value('--runs'))
    if (!(Number.isInteger(runs) && runs >= 1)) throw new Error(`--runs debe ser un entero positivo, no ${JSON.stringify(value('--runs'))}`)
    const budgetUsd = value('--budget-usd') === undefined ? BenchArguments.DEFAULT_BUDGET_USD : Number(value('--budget-usd'))
    if (!(Number.isFinite(budgetUsd) && budgetUsd > 0)) throw new Error(`--budget-usd debe ser un número positivo, no ${JSON.stringify(value('--budget-usd'))}`)
    return new BenchArguments({
      agentPath: resolve(agentPath),
      runs,
      only: value('--case') ?? null,
      dryRun: argv.includes('--dry-run'),
      budgetUsd,
      casesRoot: resolve(value('--cases') ?? BenchArguments.DEFAULT_CASES),
    })
  }
}

class ClaudeRunner {
  static BINARY = 'claude'
  static MAX_BUFFER = 64 * 1024 * 1024

  constructor({ timeoutMs }) {
    if (!(Number.isInteger(timeoutMs) && timeoutMs > 0)) throw new Error(`timeoutMs must be a positive integer, got ${JSON.stringify(timeoutMs)}`)
    this.timeoutMs = timeoutMs
    Object.freeze(this)
  }

  get forJudgeRun() {
    return (judgeRun) => {
      try {
        const stdout = execFileSync(ClaudeRunner.BINARY, judgeRun.argv, {
          cwd: judgeRun.cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: this.timeoutMs,
          killSignal: 'SIGKILL',
          maxBuffer: ClaudeRunner.MAX_BUFFER,
        })
        return { code: 0, stdout, stderr: '' }
      } catch (error) {
        const code = typeof error.status === 'number' ? error.status : -1
        return { code, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? error.message ?? '') }
      }
    }
  }

  static isInstalled() {
    try {
      execFileSync(ClaudeRunner.BINARY, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 })
      return true
    } catch {
      return false
    }
  }
}

class CtYardstick {
  static read(pluginRoot) {
    const documents = PluginYardstick.FILES.map((name) => {
      try {
        return { name, content: readFileSync(join(pluginRoot, PluginYardstick.DIRECTORY, name), 'utf8') }
      } catch {
        return { name, content: null }
      }
    })
    const missing = PluginYardstick.missingDocuments(documents)
    if (missing.length) throw new Error(`la vara de ct no se puede leer: falta o está vacío ${missing.join(', ')} en ${join(pluginRoot, PluginYardstick.DIRECTORY)}`)
    return PluginYardstick.composeSection(documents)
  }
}

class Program {
  static TIMEOUT_MS = 30 * 60 * 1000

  static main(argv) {
    let args
    try {
      args = BenchArguments.parse(argv)
    } catch (error) {
      console.error(`${error.message} — ${BenchArguments.USAGE}`)
      return ExitCode.USAGE
    }
    let agent
    let cases
    let yardstick
    try {
      agent = AgentDefinition.parse(readFileSync(args.agentPath, 'utf8'))
      cases = BenchCases.load(args.casesRoot, { only: args.only })
      yardstick = CtYardstick.read(BenchArguments.PLUGIN_ROOT)
    } catch (error) {
      if (!(error instanceof MalformedAgentDefinition || error instanceof CorruptCase || error instanceof UnknownCase || error.code === 'ENOENT' || /vara de ct|cases directory/.test(error.message))) throw error
      console.error(`no se puede montar el banco: ${error.message}`)
      return ExitCode.PRECONDITION
    }
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'judge-bench-'))
    const bench = new JudgeBench({
      dispatch: new JudgeDispatch({ agent, pluginRoot: BenchArguments.PLUGIN_ROOT, budgetUsd: args.budgetUsd }),
      runner: new ClaudeRunner({ timeoutMs: Program.TIMEOUT_MS }).forJudgeRun,
      workspace: new BenchWorkspace({ root: workspaceRoot }),
      yardstick,
      agentPath: args.agentPath,
    })
    if (args.dryRun) {
      for (const { judgeRun } of bench.plan({ cases: cases, runs: args.runs })) {
        console.log(`# ${judgeRun.caseName} #${judgeRun.attempt}`)
        console.log(`cd ${shQuote(judgeRun.cwd)} && ${ClaudeRunner.BINARY} ${judgeRun.argv.map(shQuote).join(' ')}`)
      }
      console.error(`dry-run: ${cases.length} caso(s) × ${args.runs} run(s) preparados en ${workspaceRoot}; nada ejecutado.`)
      return ExitCode.ALL_HIT
    }
    if (!ClaudeRunner.isInstalled()) {
      console.error(`no se puede montar el banco: \`${ClaudeRunner.BINARY}\` no está en el PATH o no responde a --version.`)
      return ExitCode.PRECONDITION
    }
    console.error(`banco del juez: ${cases.length} caso(s) × ${args.runs} run(s); directorio de trabajo ${workspaceRoot}`)
    const report = bench.run({
      cases,
      runs: args.runs,
      onResult: (result) => console.error(`  ${result.caseName} #${result.attempt}: ${result.outcome} — ${result.detail}${result.costUsd === null ? '' : ` (${result.costUsd.toFixed(4)} USD)`}`),
    })
    console.log(report.render())
    console.log(`Directorio de trabajo con briefs, paquetes y veredictos: ${workspaceRoot}`)
    return report.allHit ? ExitCode.ALL_HIT : ExitCode.SOME_MISSED
  }
}

process.exit(Program.main(process.argv.slice(2)))
