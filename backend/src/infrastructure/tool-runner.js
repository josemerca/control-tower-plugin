import { execFile } from 'node:child_process'
import { ProcessOutput } from './process-output.js'

export class ToolRunner {
  static #UNKNOWN_EXIT = 1

  constructor({ bin, budgetMs }) {
    if (!Number.isInteger(budgetMs) || budgetMs < 1) {
      throw new Error(`${bin} needs a budget in milliseconds, got ${JSON.stringify(budgetMs)}`)
    }
    this.bin = bin
    this.budgetMs = budgetMs
  }

  run(argv) {
    return new Promise((resolve) => {
      execFile(this.bin, argv, { timeout: this.budgetMs }, (failure, stdout, stderr) => {
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
