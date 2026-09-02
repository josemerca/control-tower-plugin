export class RetryBudget {
  constructor({ attempts, waitSeconds }) {
    if (!Number.isInteger(attempts) || attempts < 0) {
      throw new Error(`the retries of a call are a count, got ${JSON.stringify(attempts)}`)
    }
    if (!Number.isInteger(waitSeconds) || waitSeconds < 0) {
      throw new Error(`the wait between calls is in seconds, got ${JSON.stringify(waitSeconds)}`)
    }
    this.attempts = attempts
    this.waitSeconds = waitSeconds
    Object.freeze(this)
  }
}
