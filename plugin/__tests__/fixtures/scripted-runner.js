export class RunnerAnswer {
  static ok(stdout = '') {
    return { code: 0, stdout, stderr: '' }
  }

  static failed(code, stderr) {
    return { code, stdout: '', stderr }
  }

  static failedSilently(code, stdout) {
    return { code, stdout, stderr: '' }
  }

  static failedOnBothChannels(code) {
    return { code, stdout: '', stderr: '' }
  }
}

export class ScriptedRunner {
  constructor({ program, answers, spoken }) {
    this.program = program
    this.answers = answers
    this.spoken = spoken
  }

  answerTo(asked) {
    this.spoken.push(`${this.program} ${asked}`)
    if (!Object.hasOwn(this.answers, asked)) {
      throw new Error(`nobody wrote an answer for: ${this.program} ${asked}`)
    }
    return this.answers[asked]
  }

  get forArgv() {
    return (argv) => this.answerTo(argv.join(' '))
  }

  get forCwd() {
    return (cwd) => this.answerTo(cwd)
  }
}
