export class PreparedWorkspace {
  constructor({ issueNumber, located }) {
    this.issueNumber = issueNumber
    this.located = located
    Object.freeze(this)
  }
}
