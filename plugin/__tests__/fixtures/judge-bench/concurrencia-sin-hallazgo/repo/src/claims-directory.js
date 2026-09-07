import { join } from 'node:path'

export class ClaimsDirectory {
  constructor({ root }) {
    this.root = root
    Object.freeze(this)
  }

  lockOf(issue) {
    if (!Number.isInteger(issue) || issue < 1) {
      throw new RangeError(`issue must be a positive integer, got ${JSON.stringify(issue)}`)
    }
    return join(this.root, `${issue}.lock`)
  }
}
