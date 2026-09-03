import { WorkspaceLocation } from './workspace-location.js'

export class PreparedWorkspace {
  constructor({ issueNumber, located }) {
    if (!Number.isInteger(issueNumber) || issueNumber < 1) {
      throw new Error(
        `a prepared workspace belongs to an issue numbered from one, got ${JSON.stringify(issueNumber)}`
      )
    }
    if (!(located instanceof WorkspaceLocation)) {
      throw new Error(`a prepared workspace sits somewhere on a branch, got ${JSON.stringify(located)}`)
    }
    this.issueNumber = issueNumber
    this.located = located
    Object.freeze(this)
  }
}
