import { execFile } from 'node:child_process'

export class ToolRunner {
  constructor({ bin, budgetMs }) {
    if (!Number.isInteger(budgetMs) || budgetMs < 1) {
      throw new Error(`${bin} needs a budget in milliseconds, got ${JSON.stringify(budgetMs)}`)
    }
    this.bin = bin
    this.budgetMs = budgetMs
  }

  run(argv) {
    return new Promise((resolve, reject) => {
      execFile(this.bin, argv, { timeout: this.budgetMs }, (failure, stdout, stderr) => {
        if (failure === null) resolve(stdout)
        else reject(new Error(`${this.bin} ${argv[0]} failed: ${(stderr || failure.message).trim()}`))
      })
    })
  }
}
