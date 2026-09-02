import { execFile } from 'node:child_process'

export class ProcessOutput {
  constructor({ code, stdout, stderr }) {
    this.code = code
    this.stdout = stdout
    this.stderr = stderr
    Object.freeze(this)
  }

  get failed() {
    return this.code !== 0
  }
}

export class ToolRunner {
  static #UNKNOWN_EXIT = 1

  constructor({ bin, budgetMs }) {
    if (!Number.isInteger(budgetMs) || budgetMs < 1) {
      throw new Error(`${bin} needs a budget in milliseconds, got ${JSON.stringify(budgetMs)}`)
    }
    this.bin = bin
    this.budgetMs = budgetMs
  }

  run(argv, { cwd } = {}) {
    return new Promise((resolve) => {
      execFile(this.bin, argv, { timeout: this.budgetMs, cwd }, (failure, stdout, stderr) => {
        resolve(new ProcessOutput({
          code: ToolRunner.#codeOf(failure),
          stdout,
          stderr: failure === null ? stderr : (stderr.trim() || failure.message),
        }))
      })
    })
  }

  static #codeOf(failure) {
    if (failure === null) return 0

    return Number.isInteger(failure.code) ? failure.code : ToolRunner.#UNKNOWN_EXIT
  }
}
