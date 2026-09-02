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
