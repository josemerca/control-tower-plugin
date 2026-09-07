export class Workbench {
  async reopen({ issueNumber, repository }) {
    throw new Error(
      `${this.constructor.name} must implement reopen({ issueNumber, repository }), asked for ${issueNumber} in ${repository}`
    )
  }
}
