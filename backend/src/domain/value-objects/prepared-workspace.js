export class PreparedWorkspace {
  constructor({ issueNumber, located }) {
    if (!Number.isInteger(issueNumber) || issueNumber < 1) {
      throw new Error(
        `a prepared workspace belongs to an issue numbered from one, got ${JSON.stringify(issueNumber)}`
      )
    }
    this.issueNumber = issueNumber
    this.located = located
    Object.freeze(this)
  }
}
