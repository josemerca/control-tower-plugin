import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const BaselineOutcome = Object.freeze({
  GREEN: 'verde',
  RED: 'rojo',
  UNVERIFIED: 'no-verificado',
})

export class BaselineResult {
  constructor({ outcome, command, summary }) {
    this.outcome = outcome
    this.command = command
    this.summary = summary
    Object.freeze(this)
  }

  static notMeasured(summary) {
    return new BaselineResult({ outcome: BaselineOutcome.UNVERIFIED, command: null, summary })
  }

  get seedField() {
    return { outcome: this.outcome, command: this.command, summary: this.summary }
  }
}

export class TestCommandDeclaration {
  static FILES = ['AGENTS.md', '.agent/conventions.md']
  static LINE = /^[ \t]*(?:[-*+][ \t]+)?(?:\*\*)?tests?(?:\*\*)?[ \t]*:[ \t]*`([^`\n]+)`/im
  static HOW_TO_DECLARE = 'test: `<comando>`'

  static in(worktree, read) {
    for (const file of TestCommandDeclaration.FILES) {
      const declared = TestCommandDeclaration.#declaredIn(read(join(worktree, file)))
      if (declared !== null) return declared
    }

    return null
  }

  static #declaredIn(text) {
    if (text === null) return null
    const matched = text.match(TestCommandDeclaration.LINE)
    if (matched === null) return null
    const command = matched[1].trim()

    return command.length === 0 ? null : command
  }
}

export class ShellBaselineRunner {
  static SHELL = 'sh'
  static MAX_BUFFER = 20 * 1024 * 1024

  constructor({ timeoutMs }) {
    this.timeoutMs = timeoutMs
    Object.freeze(this)
  }

  get run() {
    return (command, cwd) => {
      const ran = spawnSync(ShellBaselineRunner.SHELL, ['-c', command], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: this.timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: ShellBaselineRunner.MAX_BUFFER,
      })

      return {
        code: ran.status,
        stdout: ran.stdout ?? '',
        stderr: ran.error ? `${ran.stderr ?? ''}\n${ran.error.message}` : (ran.stderr ?? ''),
      }
    }
  }
}

export class Baseline {
  static SUMMARY_MAX_CHARS = 240
  static SUMMARY_LINES = 3
  static ELLIPSIS = '…'
  static NO_COMMAND =
    `sin comando de test declarado en ${TestCommandDeclaration.FILES.join(' ni en ')} — ` +
    `decláralo con una línea «${TestCommandDeclaration.HOW_TO_DECLARE}» (p. ej. «test: \`npm test\`») ` +
    'en la sección «## Build, test & lint» de AGENTS.md'

  constructor({ run, read = Baseline.readOrNull }) {
    this.run = run
    this.read = read
    Object.freeze(this)
  }

  static readOrNull(path) {
    try {
      return readFileSync(path, 'utf8')
    } catch (failure) {
      if (failure.code === 'ENOENT' || failure.code === 'ENOTDIR' || failure.code === 'EISDIR') return null
      throw failure
    }
  }

  async measure(worktree) {
    const command = TestCommandDeclaration.in(worktree, this.read)
    if (command === null) return BaselineResult.notMeasured(Baseline.NO_COMMAND)
    const ran = await this.run(command, worktree)

    return new BaselineResult({
      outcome: Baseline.#outcomeOf(ran.code),
      command,
      summary: Baseline.#summaryOf(ran),
    })
  }

  static #outcomeOf(code) {
    if (code === 0) return BaselineOutcome.GREEN
    if (Number.isInteger(code)) return BaselineOutcome.RED

    return BaselineOutcome.UNVERIFIED
  }

  static #summaryOf({ code, stdout, stderr }) {
    const tail = `${stdout ?? ''}\n${stderr ?? ''}`
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(-Baseline.SUMMARY_LINES)
      .join(' | ')
    const head = Number.isInteger(code) ? `exit ${code}` : 'no terminó'

    return Baseline.#capped(tail.length === 0 ? head : `${head} · ${tail}`)
  }

  static #capped(text) {
    if (text.length <= Baseline.SUMMARY_MAX_CHARS) return text

    return `${text.slice(0, Baseline.SUMMARY_MAX_CHARS - Baseline.ELLIPSIS.length)}${Baseline.ELLIPSIS}`
  }
}
