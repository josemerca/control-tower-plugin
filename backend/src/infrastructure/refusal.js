export class Refusal {
  constructor({ status, error }) {
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new Error(`a refusal answers with a client or server status, got ${JSON.stringify(status)}`)
    }
    if (typeof error !== 'string' || error.trim().length === 0) {
      throw new Error(`a refusal says why, got ${JSON.stringify(error)}`)
    }
    this.status = status
    this.error = error
    Object.freeze(this)
  }
}
